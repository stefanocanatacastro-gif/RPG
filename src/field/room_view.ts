// Draws a grey-box room in perspective from its outline:
//   - a backdrop in three layers, each scrolling at its own speed,
//   - the floor in unit tiles, clipped to the outline (so cut corners are exact),
//   - walls on the back-facing and side edges, a see-through cage fence on the
//     front-facing edges (if the room has one), and the stage lip below,
//   - every block as a box with a lit top, a shaded front and, in perspective,
//     the side that faces the middle of the screen,
//   - decorative ropes (ring ropes) sorted with everything else,
//   - haze: colours fade toward the room's fog colour with depth,
//   - pools and shafts of light, and contact shadows,
//   - foreground silhouettes between the camera and the room.
// Because the camera is in perspective, the room is redrawn whenever the
// camera moves sideways (see RoomView.update). Shapes and positions come from
// data; real tilesets replace these flat colours later.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import {
  U,
  projectExact,
  depthScale,
  blockDepth,
  sortDepth,
  depthOnBlock,
  edges,
  outlineOf,
  gatesOf,
  roomPixelBounds,
  fogAmount,
  mixColor,
  groundAt,
  type Block,
  type Pt,
  type RoomShape,
} from './world';
import type { RoomDef, LightDef, ForegroundDef } from './room_types';

const BLOCK_COLORS: Record<string, { top: number; front: number; side: number; edge: number; line: number }> =
  {
    crate: { top: 0xa3763f, front: 0x7a5530, side: 0x5e4226, edge: 0xc08a4a, line: 0x4a3220 },
    step: { top: 0x8a7f99, front: 0x5b5068, side: 0x463c55, edge: 0xa79cb6, line: 0x3a3045 },
    platform: { top: 0x6b5f7c, front: 0x463c55, side: 0x352d42, edge: 0x8a7f99, line: 0x2b2338 },
    post: { top: 0x9aa0b4, front: 0x6b7088, side: 0x50546a, edge: 0xc6cad8, line: 0x2b2338 },
    ring: { top: 0xd9c9a8, front: 0x8f1f33, side: 0x6a1626, edge: 0xefe3c6, line: 0x5e1422 },
  };

/** Haze colour per backdrop, used when a room doesn't set its own. */
const FOG: Record<string, number> = { harbor: 0x2b1d44, warehouse: 0x14101c, arena: 0x151022 };

const LIP_UNITS = 0.6;
const FENCE_UNITS = 1.6;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Clips a polygon to a convex outline (Sutherland–Hodgman). Points are [x, z]. */
export function clipToOutline(poly: Pt[], outline: Pt[]): Pt[] {
  let out = poly;
  for (const e of edges(outline)) {
    const inside = (p: Pt) => (p[0] - e.a[0]) * e.nx + (p[1] - e.a[1]) * e.nz >= -1e-9;
    const cross = (p: Pt, q: Pt): Pt => {
      const sp = (p[0] - e.a[0]) * e.nx + (p[1] - e.a[1]) * e.nz;
      const sq = (q[0] - e.a[0]) * e.nx + (q[1] - e.a[1]) * e.nz;
      const t = sp / (sp - sq);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i];
      const q = input[(i + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cross(p, q));
    }
    if (out.length === 0) break;
  }
  return out;
}

type V3 = [number, number, number]; // x, y, z

/** Everything that draws in world space needs the camera centre and the haze. */
interface Lens {
  cx: number;
  fog: number;
  depth: number;
}

const pt = (l: Lens, x: number, y: number, z: number) => projectExact({ x, y, z }, l.cx);

function fill(g: Phaser.GameObjects.Graphics, l: Lens, pts: V3[], color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  fillProjected(
    g,
    pts.map(([x, y, z]) => pt(l, x, y, z)),
  );
}

/** Fills a convex polygon already in pixels; triangles and quads skip the general triangulator. */
function fillProjected(g: Phaser.GameObjects.Graphics, p: { x: number; y: number }[]): void {
  if (p.length === 3) g.fillTriangle(p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y);
  else if (p.length === 4) {
    g.fillTriangle(p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y);
    g.fillTriangle(p[0].x, p[0].y, p[2].x, p[2].y, p[3].x, p[3].y);
  } else
    g.fillPoints(
      p.map((q) => new Phaser.Math.Vector2(q.x, q.y)),
      true,
    );
}

function line(g: Phaser.GameObjects.Graphics, l: Lens, a: V3, b: V3): void {
  const p = pt(l, a[0], a[1], a[2]);
  const q = pt(l, b[0], b[1], b[2]);
  g.lineBetween(p.x, p.y, q.x, q.y);
}

/** A colour faded into the haze for its depth. */
const hazed = (l: Lens, c: number, z: number) => mixColor(c, l.fog, fogAmount(z, l.depth));

// ── Backdrop ───────────────────────────────────────────────────────────

interface BackdropLayer {
  parallax: number;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => void;
}

function gradient(ctx: CanvasRenderingContext2D, w: number, h: number, ramp: number[]): void {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const pos = (y / Math.max(1, h - 1)) * (ramp.length - 1);
    const lo = Math.min(Math.floor(pos), ramp.length - 2);
    const frac = pos - lo;
    for (let x = 0; x < w; x++) {
      const c = frac * 16 > BAYER4[(y & 3) * 4 + (x & 3)] ? ramp[lo + 1] : ramp[lo];
      const i = (y * w + x) * 4;
      img.data[i] = (c >> 16) & 255;
      img.data[i + 1] = (c >> 8) & 255;
      img.data[i + 2] = c & 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A row of blocky silhouettes along the bottom, with a few lit windows. */
function skyline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  o: { color: string; min: number; max: number; widths: [number, number]; windows: number; cranes: number },
): void {
  ctx.fillStyle = o.color;
  for (let x = -Math.floor(rand() * 20); x < w;) {
    const bw = o.widths[0] + Math.floor(rand() * (o.widths[1] - o.widths[0]));
    const bh = Math.min(h - 4, o.min + Math.floor(rand() * (o.max - o.min)));
    ctx.fillRect(x, h - bh, bw, bh);
    if (rand() < o.cranes) {
      const cx = x + bw / 2;
      ctx.fillRect(cx, h - bh - 30, 3, 30);
      ctx.fillRect(cx - 18, h - bh - 30, 40, 3);
    }
    for (let wy = h - bh + 6; wy < h - 4; wy += 8)
      for (let wx = x + 5; wx < x + bw - 5; wx += 9)
        if (rand() < o.windows) {
          ctx.fillStyle = '#ffb238';
          ctx.fillRect(wx, wy, 2, 2);
          ctx.fillStyle = o.color;
        }
    x += bw + Math.floor(rand() * 12);
  }
}

const BACKDROPS: Record<string, BackdropLayer[]> = {
  harbor: [
    {
      parallax: 0.06,
      paint: (ctx, w, h) => gradient(ctx, w, h, [0x1b1430, 0x2b1d44, 0x4a2a52, 0x7a3a50, 0xc0584a]),
    },
    {
      parallax: 0.16,
      paint: (ctx, w, h, rand) =>
        skyline(ctx, w, h, rand, {
          color: '#3a2448',
          min: 30,
          max: 70,
          widths: [30, 70],
          windows: 0.04,
          cranes: 0,
        }),
    },
    {
      parallax: 0.32,
      paint: (ctx, w, h, rand) =>
        skyline(ctx, w, h, rand, {
          color: '#140f22',
          min: 14,
          max: 54,
          widths: [40, 100],
          windows: 0.25,
          cranes: 0.35,
        }),
    },
  ],
  warehouse: [
    {
      parallax: 0.06,
      paint: (ctx, w, h) => gradient(ctx, w, h, [0x0e0b14, 0x14101c, 0x1b1526, 0x221a30, 0x2a2038]),
    },
    {
      parallax: 0.16,
      paint: (ctx, w, h) => {
        // far columns, faint
        ctx.fillStyle = '#100c17';
        for (let x = 30; x < w; x += 110) ctx.fillRect(x, 0, 10, h);
      },
    },
    {
      parallax: 0.32,
      paint: (ctx, w, h) => {
        ctx.fillStyle = '#08060c';
        for (let x = 10; x < w; x += 70) ctx.fillRect(x, 0, 4, h);
        ctx.fillRect(0, 12, w, 4);
        for (let x = 40; x < w; x += 140) {
          ctx.fillRect(x - 1, 16, 2, 20);
          ctx.fillStyle = '#ffd98a';
          ctx.fillRect(x - 4, 36, 8, 2);
          ctx.fillStyle = '#08060c';
        }
      },
    },
  ],
  arena: [
    {
      parallax: 0.04,
      paint: (ctx, w, h) => gradient(ctx, w, h, [0x07060b, 0x0d0a14, 0x151022, 0x1d1530, 0x271b3c]),
    },
    {
      parallax: 0.14,
      paint: (ctx, w, h, rand) => {
        // tiers of crowd in the dark, with camera flashes
        const tiers = Math.max(3, Math.floor((h - 50) / 22));
        for (let t = 0; t < tiers; t++) {
          const y = 50 + t * 22;
          const col = ['#191325', '#201830', '#281e3b', '#30244a'][t % 4];
          ctx.fillStyle = col;
          ctx.fillRect(0, y + 8, w, 22);
          for (let x = Math.floor(rand() * 10); x < w; x += 9 + Math.floor(rand() * 4)) {
            ctx.fillRect(x, y + 2 - Math.floor(rand() * 3), 6, 7);
            if (rand() < 0.04) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(x + 2, y + 2, 2, 2);
              ctx.fillStyle = col;
            }
          }
        }
      },
    },
    {
      parallax: 0.3,
      paint: (ctx, w) => {
        // lighting truss and hanging lamps
        ctx.fillStyle = '#2b2338';
        ctx.fillRect(0, 10, w, 3);
        ctx.fillRect(0, 22, w, 3);
        for (let x = 0; x < w; x += 12) ctx.fillRect(x, 13, 2, 9);
        for (let x = 30; x < w; x += 90) {
          ctx.fillStyle = '#14101b';
          ctx.fillRect(x - 5, 25, 10, 8);
          ctx.fillStyle = '#fff1c4';
          ctx.fillRect(x - 3, 32, 6, 2);
        }
      },
    },
  ],
};

function drawBackdrop(
  scene: Phaser.Scene,
  room: RoomDef,
  roomPx: number,
  top: number,
  bottomY: number,
): void {
  const layers = BACKDROPS[room.backdrop] ?? BACKDROPS.warehouse;
  const h = Math.max(8, Math.ceil(bottomY - top));
  layers.forEach((layer, i) => {
    const w = Math.ceil(W + (roomPx - W) * layer.parallax) + 2;
    const key = `__bg_${room.backdrop}_${i}_${w}_${h}`;
    if (!scene.textures.exists(key)) {
      const tex = scene.textures.createCanvas(key, w, h)!;
      layer.paint(tex.getContext(), w, h, rng(room.backdrop.length * 97 + i * 13));
      tex.refresh();
    }
    scene.add
      .image(0, top, key)
      .setOrigin(0)
      .setScrollFactor(layer.parallax, 1)
      .setDepth(-300000 + i);
  });
}

// ── The room ──────────────────────────────────────────────────────────

export interface RoomView {
  roomPx: number;
  bounds: { top: number; bottom: number };
  /** The haze colour things fade into with depth. */
  fog: number;
  /**
   * Redraws the room for the camera centred on world x = cx. Cheap to call every
   * frame. focusX (drawing-space pixels) is where the player is, so foreground
   * pieces in front of them turn see-through.
   */
  update(cx: number, timeMs: number, focusX?: number): void;
  /** How lit a spot on the floor is by the room's lights (0 = not at all, 1 = fully). */
  lightAt(x: number, z: number): number;
}

interface FloorCell {
  pts: Pt[];
  color: number;
  z: number;
  x: number;
}

export function drawRoom(scene: Phaser.Scene, room: RoomDef, shape: RoomShape): RoomView {
  const width = shape.width;
  const roomPx = width * U;
  const outline = outlineOf(shape);
  const es = edges(outline);
  const gates = gatesOf(shape);
  const bounds = roomPixelBounds(room.depth, room.wallHeight, H);
  const pal = room.palette;
  const fog = room.fog ?? FOG[room.backdrop] ?? 0x14101c;
  const lights = room.lights ?? [];

  // the backdrop stops just below where the back wall meets the floor
  const backFloorY = projectExact({ x: 0, y: 0, z: room.depth }, width / 2).y;
  drawBackdrop(scene, room, roomPx, bounds.top, backFloorY + 4);

  // the floor, clipped to the outline and worked out once: each row is one
  // strip in the first colour, with the checkerboard's other tiles on top
  const rows: FloorCell[] = [];
  const cells: FloorCell[] = [];
  for (let z = 0; z < room.depth; z++) {
    const f = 1 - (z / room.depth) * 0.2;
    const strip = clipToOutline(
      [
        [0, z],
        [width, z],
        [width, z + 1],
        [0, z + 1],
      ],
      outline,
    );
    if (strip.length >= 3) rows.push({ pts: strip, color: shade(pal.floor[0], f), z: z + 0.5, x: width / 2 });
    for (let x = 0; x < width; x++) {
      if ((x + z) % 2 === 0) continue;
      const pts = clipToOutline(
        [
          [x, z],
          [x + 1, z],
          [x + 1, z + 1],
          [x, z + 1],
        ],
        outline,
      );
      if (pts.length >= 3)
        cells.push({ pts, color: shade(pal.floor[(x + z) % 2], f), z: z + 0.5, x: x + 0.5 });
    }
  }

  // which part of each edge is open (gates), as [t0, t1] gaps
  const gaps = (i: number) =>
    gates.filter((gt) => gt.edge === i).map((gt) => [gt.t0, gt.t1] as [number, number]);
  const solidSpans = (i: number): [number, number][] => {
    const spans: [number, number][] = [];
    let t = 0;
    for (const [a, b] of gaps(i).sort((p, q) => p[0] - q[0])) {
      if (a > t) spans.push([t, a]);
      t = Math.max(t, b);
    }
    if (t < 1) spans.push([t, 1]);
    return spans;
  };
  const lerpPt = (e: (typeof es)[number], t: number): Pt => [
    e.a[0] + (e.b[0] - e.a[0]) * t,
    e.a[1] + (e.b[1] - e.a[1]) * t,
  ];

  const gGround = scene.add.graphics().setDepth(-250000);
  const gFloor = scene.add.graphics().setDepth(-200000);
  // light is drawn with ordinary blending: an additive blend would break the
  // renderer's batch at every light layer, which costs a lot on phones
  const gPools = scene.add.graphics().setDepth(-199000);
  const gLip = scene.add.graphics().setDepth(-190000);
  const gWalls = scene.add.graphics().setDepth(-150000);
  const gBackPosts = scene.add.graphics().setDepth(-140000);
  const gBeams = scene.add.graphics().setDepth(700000);
  const gFence = scene.add.graphics().setDepth(800000);
  const gFrontPosts = scene.add.graphics().setDepth(800001);
  const gFore = scene.add.graphics().setDepth(850000);
  const blocks = room.blocks.map((b) => ({ b, g: scene.add.graphics().setDepth(blockDepth(b)) }));
  const ropes = (room.ropes ?? []).map((r) => ({
    r,
    g: scene.add.graphics().setDepth(ropeDepth(r, room.blocks)),
  }));
  // a light pool on a raised block draws on that block's top, under anyone standing there
  const raisedPools = lights.map((lt) => {
    const top = groundAt(shape, lt.x, lt.z, 0.01);
    return top.block ? scene.add.graphics().setDepth(blockDepth(top.block) + 0.5) : null;
  });

  let lastCx = Number.NaN;

  const drawStatic = (l: Lens) => {
    for (const g of [gGround, gFloor, gPools, gLip, gWalls, gBackPosts, gBeams, gFence, gFrontPosts])
      g.clear();

    // ground outside the outline (cut corners, beyond the gates)
    gGround
      .fillStyle(mixColor(0x0b0910, fog, 0.3))
      .fillRect(-W, backFloorY - 2, roomPx + 2 * W, H - backFloorY + 2);

    // floor: row strips, then the other tiles, skipping the ones off screen
    const half = W / 2 / U + 1.5;
    for (const c of rows) {
      gFloor.fillStyle(hazed(l, c.color, c.z));
      fillProjected(
        gFloor,
        c.pts.map(([x, z]) => pt(l, x, 0, z)),
      );
    }
    for (const c of cells) {
      if (Math.abs(c.x - l.cx) * depthScale(c.z) > half) continue;
      gFloor.fillStyle(hazed(l, c.color, c.z));
      fillProjected(
        gFloor,
        c.pts.map(([x, z]) => pt(l, x, 0, z)),
      );
    }

    // rectangle rooms: the back wall carries on past the side walls, so the
    // gap beside a side wall (and the view through a side door) isn't open sky
    if (!room.outline) {
      const h = room.wallHeight;
      for (const [x0, x1] of [
        [-16, 0],
        [width, width + 16],
      ]) {
        fill(
          gWalls,
          l,
          [
            [x0, 0, room.depth],
            [x1, 0, room.depth],
            [x1, h, room.depth],
            [x0, h, room.depth],
          ],
          hazed(l, shade(pal.wall[0], 0.55), room.depth),
        );
        gWalls.lineStyle(1, hazed(l, shade(pal.wall[1], 0.55), room.depth));
        for (let y = 0.5; y < h; y += 0.5) line(gWalls, l, [x0, y, room.depth], [x1, y, room.depth]);
      }
    }

    es.forEach((e, i) => {
      const backFacing = e.nz < -0.01;
      const frontFacing = e.nz > 0.01;
      const side = !backFacing && !frontFacing;
      for (const [t0, t1] of solidSpans(i)) {
        const [ax, az] = lerpPt(e, t0);
        const [bx, bz] = lerpPt(e, t1);
        if (backFacing || side) {
          // wall face rising from the floor edge; side walls catch less light
          const h = room.wallHeight;
          const midZ = (az + bz) / 2;
          const lit = side ? 0.62 : 0.75 + Math.abs(e.nz) * 0.25;
          if (!side)
            fill(
              gWalls,
              l,
              [
                [ax, 0, az],
                [bx, 0, bz],
                [bx, h, bz],
                [ax, h, az],
              ],
              hazed(l, shade(pal.wall[0], lit), midZ),
            );
          // courses of bricks, split along long side walls so the haze follows depth
          const pieces = side ? Math.max(1, Math.ceil(Math.abs(bz - az))) : 1;
          for (let k = 0; k < pieces; k++) {
            const p0: Pt = [ax + ((bx - ax) * k) / pieces, az + ((bz - az) * k) / pieces];
            const p1: Pt = [ax + ((bx - ax) * (k + 1)) / pieces, az + ((bz - az) * (k + 1)) / pieces];
            const zMid = (p0[1] + p1[1]) / 2;
            if (side)
              fill(
                gWalls,
                l,
                [
                  [p0[0], 0, p0[1]],
                  [p1[0], 0, p1[1]],
                  [p1[0], h, p1[1]],
                  [p0[0], h, p0[1]],
                ],
                hazed(l, shade(pal.wall[0], lit), zMid),
              );
            gWalls.lineStyle(1, hazed(l, shade(pal.wall[1], lit), zMid));
            for (let y = 0.5; y < h; y += 0.5) line(gWalls, l, [p0[0], y, p0[1]], [p1[0], y, p1[1]]);
          }
          gWalls.lineStyle(2, 0xffffff, 0.08);
          line(gWalls, l, [ax, h, az], [bx, h, bz]);
          // contact shadow where the wall meets the floor
          gWalls.lineStyle(5, 0x000000, 0.35);
          line(gWalls, l, [ax, 0.06, az], [bx, 0.06, bz]);
          gWalls.lineStyle(9, 0x000000, 0.12);
          line(gWalls, l, [ax, 0.12, az], [bx, 0.12, bz]);
        }
        if (frontFacing) {
          // stage lip under the edge
          fill(
            gLip,
            l,
            [
              [ax, 0, az],
              [bx, 0, bz],
              [bx, -LIP_UNITS, bz],
              [ax, -LIP_UNITS, az],
            ],
            shade(pal.lip, 0.8 + e.nz * 0.2),
          );
          gLip.lineStyle(1, 0xffffff, 0.1);
          line(gLip, l, [ax, 0, az], [bx, 0, bz]);
          if (room.fence) drawFence(gFence, l, ax, az, bx, bz, pal.fence ?? 0x9aa0b4);
        }
      }
      // gates: lit floor strip and posts
      for (const [t0, t1] of gaps(i)) {
        const [ax, az] = lerpPt(e, t0);
        const [bx, bz] = lerpPt(e, t1);
        const n = 0.6;
        fill(
          gFloor,
          l,
          [
            [ax, 0, az],
            [bx, 0, bz],
            [bx + e.nx * n, 0, bz + e.nz * n],
            [ax + e.nx * n, 0, az + e.nz * n],
          ],
          0xffb238,
          0.35,
        );
        const postG = e.nz <= 0.01 ? gBackPosts : gFrontPosts;
        for (const [x, z] of [
          [ax, az],
          [bx, bz],
        ]) {
          const b = pt(l, x, 0, z);
          const t = pt(l, x, Math.max(room.wallHeight * 0.6, FENCE_UNITS + 0.4), z);
          const w = Math.max(3, Math.round(6 * depthScale(z)));
          postG.fillStyle(hazed(l, 0x5b5068, z)).fillRect(b.x - w / 2, t.y, w, b.y - t.y);
          postG.fillStyle(hazed(l, 0xffb238, z)).fillRect(b.x - w / 2, t.y, w, 4);
        }
      }
    });

    // light pools and shafts
    lights.forEach((lt, i) => drawLight(raisedPools[i] ?? gPools, gBeams, l, lt, shape, room.wallHeight));

    for (const { b, g } of blocks) {
      g.clear();
      drawBlock(g, l, b);
    }
    for (const { r, g } of ropes) {
      g.clear();
      drawRope(g, l, r.from, r.to, r.heights, r.base ?? 0);
    }
  };

  return {
    roomPx,
    bounds,
    fog,
    update(cx: number, timeMs: number, focusX?: number) {
      const l: Lens = { cx, fog, depth: room.depth };
      if (Math.abs(cx - lastCx) * U >= 0.5 || Number.isNaN(lastCx)) {
        lastCx = cx;
        drawStatic(l);
      }
      gFore.clear();
      for (const f of room.foreground ?? []) drawForeground(gFore, l, f, room.wallHeight, timeMs, focusX);
    },
    lightAt(x: number, z: number) {
      let lit = 0;
      for (const lt of lights) lit += Math.max(0, 1 - Math.hypot(x - lt.x, z - lt.z) / lt.r);
      return Math.min(1, lit);
    },
  };
}

function drawLight(
  pool: Phaser.GameObjects.Graphics,
  beams: Phaser.GameObjects.Graphics,
  l: Lens,
  lt: LightDef,
  shape: RoomShape,
  wallHeight: number,
): void {
  const color = lt.color ?? 0xffe9b0;
  const y = groundAt(shape, lt.x, lt.z, 0.01).y;
  // banded pool: three rings, brightest in the middle (a pixel-art falloff)
  const segs = 28;
  for (const [f, a] of [
    [1, 0.08],
    [0.72, 0.08],
    [0.45, 0.1],
  ] as const) {
    const ring: V3[] = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      ring.push([lt.x + Math.cos(t) * lt.r * f, y, lt.z + Math.sin(t) * lt.r * f]);
    }
    fill(pool, l, ring, color, a);
  }
  if (!lt.beam) return;
  // a shaft from high above, widening down to the pool
  const top = wallHeight + 6;
  const narrow = lt.r * 0.15;
  const wide = lt.r * 0.85;
  fill(
    beams,
    l,
    [
      [lt.x - narrow, top, lt.z],
      [lt.x + narrow, top, lt.z],
      [lt.x + wide, y, lt.z],
      [lt.x - wide, y, lt.z],
    ],
    color,
    0.05,
  );
  fill(
    beams,
    l,
    [
      [lt.x - narrow * 0.5, top, lt.z],
      [lt.x + narrow * 0.5, top, lt.z],
      [lt.x + wide * 0.55, y, lt.z],
      [lt.x - wide * 0.55, y, lt.z],
    ],
    color,
    0.05,
  );
}

/** Chain-link cage fence along a front-facing edge: posts, rails and a see-through mesh. */
function drawFence(
  g: Phaser.GameObjects.Graphics,
  l: Lens,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  color: number,
): void {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.round(len / 0.25));
  const at = (t: number, y: number): V3 => [ax + (bx - ax) * t, y, az + (bz - az) * t];
  // mesh: two sets of diagonals
  g.lineStyle(1, color, 0.22);
  const k = Math.min(1, (FENCE_UNITS * 0.9) / len);
  for (let i = -steps; i <= steps; i++) {
    const t = i / steps;
    for (const dir of [1, -1]) {
      let t0 = t;
      let t1 = t + dir * k;
      let y0 = 0.05;
      let y1 = FENCE_UNITS;
      // trim to the panel
      if (t1 < 0 || t1 > 1) {
        const cut = t1 < 0 ? -t1 : t1 - 1;
        const f = 1 - cut / k;
        t1 = t0 + dir * k * f;
        y1 = y0 + (FENCE_UNITS - y0) * f;
      }
      if (t0 < 0 || t0 > 1) {
        const cut = t0 < 0 ? -t0 : t0 - 1;
        const f = cut / k;
        t0 = t0 + dir * k * f;
        y0 = y0 + (FENCE_UNITS - y0) * f;
      }
      if (t0 < -1e-6 || t0 > 1 + 1e-6 || t1 < -1e-6 || t1 > 1 + 1e-6 || y0 >= y1) continue;
      line(g, l, at(t0, y0), at(t1, y1));
    }
  }
  // rails
  g.lineStyle(2, color, 0.85);
  for (const y of [0.05, FENCE_UNITS]) line(g, l, at(0, y), at(1, y));
  // posts every ~3 units
  const posts = Math.max(1, Math.round(len / 3));
  for (let i = 0; i <= posts; i++) {
    const [x, , z] = at(i / posts, 0);
    const b = pt(l, x, 0, z);
    const t = pt(l, x, FENCE_UNITS + 0.15, z);
    const w = Math.max(3, Math.round(5 * depthScale(z)));
    g.fillStyle(0x3a3045).fillRect(b.x - 2, t.y, w, b.y - t.y);
    g.fillStyle(color).fillRect(b.x - 2, t.y, Math.max(2, w - 2), b.y - t.y);
  }
}

/** A rope on a raised surface (a ring) sorts with whatever stands on it; side ropes sort at their back end. */
function ropeDepth(r: { from: Pt; to: Pt }, blocks: Block[]): number {
  const mx = (r.from[0] + r.to[0]) / 2;
  const mz = (r.from[1] + r.to[1]) / 2;
  const under = blocks.find((b) => b.h > 0 && mx >= b.x && mx <= b.x + b.w && mz >= b.z && mz <= b.z + b.d);
  const z = r.from[0] === r.to[0] ? Math.max(r.from[1], r.to[1]) : Math.min(r.from[1], r.to[1]);
  return under ? depthOnBlock(under, z) + 2 : sortDepth(z) + 3;
}

function drawRope(
  g: Phaser.GameObjects.Graphics,
  l: Lens,
  from: Pt,
  to: Pt,
  heights: number[],
  base: number,
): void {
  const z = (from[1] + to[1]) / 2;
  const w = Math.max(2, Math.round(3 * depthScale(Math.min(from[1], to[1]))));
  for (const h of heights) {
    g.lineStyle(w, hazed(l, 0xd8314b, z));
    line(g, l, [from[0], base + h, from[1]], [to[0], base + h, to[1]]);
    g.lineStyle(1, hazed(l, 0xff6b7d, z));
    const a = pt(l, from[0], base + h, from[1]);
    const b = pt(l, to[0], base + h, to[1]);
    g.lineBetween(a.x, a.y - 1, b.x, b.y - 1);
  }
}

function drawBlock(g: Phaser.GameObjects.Graphics, l: Lens, b: Block): void {
  const c = BLOCK_COLORS[b.kind ?? 'crate'] ?? BLOCK_COLORS.crate;
  const x0 = b.x;
  const x1 = b.x + b.w;
  const z0 = b.z;
  const z1 = b.z + b.d;
  const h = b.h;
  const zMid = (z0 + z1) / 2;
  const hz = (col: number, z: number) => hazed(l, col, z);

  // soft contact shadow on the floor, a little wider than the block
  fill(
    g,
    l,
    [
      [x0 - 0.15, 0, z0 - 0.12],
      [x1 + 0.2, 0, z0 - 0.12],
      [x1 + 0.2, 0, z1 + 0.05],
      [x0 - 0.15, 0, z1 + 0.05],
    ],
    0x000000,
    0.3,
  );
  // in perspective you see the side facing the middle of the screen
  if (x1 < l.cx)
    fill(
      g,
      l,
      [
        [x1, 0, z0],
        [x1, 0, z1],
        [x1, h, z1],
        [x1, h, z0],
      ],
      hz(c.side, zMid),
    );
  else if (x0 > l.cx)
    fill(
      g,
      l,
      [
        [x0, 0, z0],
        [x0, 0, z1],
        [x0, h, z1],
        [x0, h, z0],
      ],
      hz(c.side, zMid),
    );
  // top and front
  fill(
    g,
    l,
    [
      [x0, h, z0],
      [x1, h, z0],
      [x1, h, z1],
      [x0, h, z1],
    ],
    hz(c.top, zMid),
  );
  fill(
    g,
    l,
    [
      [x0, 0, z0],
      [x1, 0, z0],
      [x1, h, z0],
      [x0, h, z0],
    ],
    hz(c.front, z0),
  );
  // edges: lit rims on top, a dark line at the base and the corners
  g.lineStyle(1, hz(c.edge, z0));
  line(g, l, [x0, h, z0], [x1, h, z0]);
  line(g, l, [x0, h, z1], [x1, h, z1]);
  g.lineStyle(1, hz(c.line, z0));
  line(g, l, [x0, 0, z0], [x1, 0, z0]);
  line(g, l, [x0, 0, z0], [x0, h, z0]);
  line(g, l, [x1, 0, z0], [x1, h, z0]);

  const frontPx = h * U * depthScale(z0);
  if (b.kind === 'crate' && frontPx >= 20) {
    const ix = 0.12 * b.w;
    const iy = 0.15 * h;
    g.lineStyle(1, hz(c.line, z0));
    line(g, l, [x0 + ix, h - iy, z0], [x1 - ix, h - iy, z0]);
    line(g, l, [x0 + ix, iy, z0], [x1 - ix, iy, z0]);
    line(g, l, [x0 + ix, h - iy, z0], [x1 - ix, iy, z0]);
  }
  if (b.kind === 'ring') {
    // apron panels and a canvas border
    g.lineStyle(1, hz(c.line, z0));
    for (let x = x0 + 1; x < x1; x += 2) line(g, l, [x, 0.06, z0], [x, h - 0.06, z0]);
    fill(
      g,
      l,
      [
        [x0 + 0.2, h, z0 + 0.3],
        [x1 - 0.2, h, z0 + 0.3],
        [x1 - 0.2, h, z1 - 0.3],
        [x0 + 0.2, h, z1 - 0.3],
      ],
      0xffffff,
      0.1,
    );
  }
}

/** Silhouettes between the camera and the room. z < 0, so they're larger and scroll faster. */
function drawForeground(
  g: Phaser.GameObjects.Graphics,
  l: Lens,
  f: ForegroundDef,
  wallHeight: number,
  timeMs: number,
  focusX?: number,
): void {
  const xs: number[] = [];
  const to = f.to ?? f.x;
  const every = Math.max(0.5, f.every ?? 1);
  for (let x = f.x; x <= to + 1e-6; x += every) xs.push(x);
  const s = depthScale(f.z);
  for (const [i, x] of xs.entries()) {
    const p = pt(l, x, 0, f.z);
    if (p.x < l.cx * U - W || p.x > l.cx * U + W) continue;
    if (f.kind === 'pillar') {
      const w = 0.9;
      // see-through while the player is behind it
      const hidesFocus = focusX !== undefined && Math.abs(p.x - focusX) < (w / 2) * U * s + 22;
      const a = hidesFocus ? 0.3 : 1;
      fill(
        g,
        l,
        [
          [x - w / 2, -3, f.z],
          [x + w / 2, -3, f.z],
          [x + w / 2, wallHeight + 8, f.z],
          [x - w / 2, wallHeight + 8, f.z],
        ],
        0x050408,
        a,
      );
      fill(
        g,
        l,
        [
          [x - w / 2, -3, f.z],
          [x - w / 2 + 0.12, -3, f.z],
          [x - w / 2 + 0.12, wallHeight + 8, f.z],
          [x - w / 2, wallHeight + 8, f.z],
        ],
        0x1a1424,
        a,
      );
    } else if (f.kind === 'crowd') {
      // heads and shoulders bobbing out of step with each other
      const bob = Math.round(Math.sin(timeMs / 260 + i * 1.7) * 1.5) * s;
      const head = pt(l, x, 0.75, f.z);
      g.fillStyle(0x07060b);
      g.fillCircle(head.x, head.y + bob, 0.32 * U * s);
      g.fillRect(head.x - 0.45 * U * s, head.y + bob + 0.2 * U * s, 0.9 * U * s, 1.2 * U * s);
      if (i % 5 === 2) {
        // a raised arm
        g.fillRect(head.x + 0.3 * U * s, head.y + bob - 0.7 * U * s, 0.16 * U * s, 0.9 * U * s);
      }
    } else if (f.kind === 'barrier') {
      // a low railing segment from this x to the next
      const x1 = Math.min(x + every, to + every);
      g.lineStyle(Math.max(2, Math.round(4 * s)), 0x0b0912);
      for (const y of [0.15, 0.7]) line(g, l, [x, y - 0.6, f.z], [x1, y - 0.6, f.z]);
      fill(
        g,
        l,
        [
          [x - 0.08, -1, f.z],
          [x + 0.08, -1, f.z],
          [x + 0.08, 0.2, f.z],
          [x - 0.08, 0.2, f.z],
        ],
        0x0b0912,
      );
    }
  }
}
