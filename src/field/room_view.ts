// Draws a grey-box room in 3D style from its outline:
//   - a distant backdrop that scrolls slower than the room,
//   - the floor in unit tiles, clipped to the outline (so cut corners are exact),
//   - walls on the back-facing edges, a see-through cage fence on the
//     front-facing edges (if the room has one), and the stage lip below,
//   - every block as a box with a lit top and a shaded front,
//   - decorative ropes (ring ropes) sorted with everything else.
// Real tilesets replace these flat colours later; shapes and positions stay.

import Phaser from 'phaser';
import { GAME_WIDTH as W } from '../systems/integer_scale';
import {
  U,
  DEPTH_PX,
  WORLD,
  project,
  blockDepth,
  sortDepth,
  depthOnBlock,
  edges,
  outlineOf,
  gatesOf,
  roomPixelBounds,
  type Block,
  type Pt,
  type RoomShape,
} from './world';
import type { RoomDef } from './room_types';
import { GAME_HEIGHT as H } from '../systems/integer_scale';

const BLOCK_COLORS: Record<string, { top: number; front: number; edge: number; line: number }> = {
  crate: { top: 0xa3763f, front: 0x7a5530, edge: 0xc08a4a, line: 0x4a3220 },
  step: { top: 0x8a7f99, front: 0x5b5068, edge: 0xa79cb6, line: 0x3a3045 },
  platform: { top: 0x6b5f7c, front: 0x463c55, edge: 0x8a7f99, line: 0x2b2338 },
  post: { top: 0x9aa0b4, front: 0x6b7088, edge: 0xc6cad8, line: 0x2b2338 },
  ring: { top: 0xd9c9a8, front: 0x8f1f33, edge: 0xefe3c6, line: 0x5e1422 },
};

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
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
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

const px = (x: number, z: number, y = 0) => project({ x, y, z });

/** Far background, drawn into a texture; scrolls slower than the room sideways. */
function drawBackdrop(
  scene: Phaser.Scene,
  room: RoomDef,
  roomPx: number,
  top: number,
  bottomY: number,
): void {
  const parallax = 0.3;
  const w = Math.ceil(W + (roomPx - W) * parallax) + 2;
  const h = Math.max(8, Math.ceil(bottomY - top));
  const key = `__bg_${room.backdrop}_${w}_${h}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, w, h)!;
    const ctx = tex.getContext();
    const img = ctx.createImageData(w, h);
    const ramps: Record<string, number[]> = {
      harbor: [0x1b1430, 0x2b1d44, 0x4a2a52, 0x7a3a50, 0xc0584a],
      warehouse: [0x0e0b14, 0x14101c, 0x1b1526, 0x221a30, 0x2a2038],
      arena: [0x07060b, 0x0d0a14, 0x151022, 0x1d1530, 0x271b3c],
    };
    const ramp = ramps[room.backdrop] ?? ramps.warehouse;
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
    const rand = rng(room.backdrop.length * 97);
    if (room.backdrop === 'harbor') {
      ctx.fillStyle = '#140f22';
      for (let x = 0; x < w;) {
        const bw = 40 + Math.floor(rand() * 60);
        const bh = 14 + Math.floor(rand() * Math.min(40, h * 0.6));
        ctx.fillRect(x, h - bh, bw, bh);
        if (rand() < 0.35) {
          const cx = x + bw / 2;
          ctx.fillRect(cx, h - bh - 30, 3, 30);
          ctx.fillRect(cx - 18, h - bh - 30, 40, 3);
        }
        for (let wy = h - bh + 6; wy < h - 4; wy += 8)
          for (let wx = x + 5; wx < x + bw - 5; wx += 9)
            if (rand() < 0.25) {
              ctx.fillStyle = '#ffb238';
              ctx.fillRect(wx, wy, 2, 2);
              ctx.fillStyle = '#140f22';
            }
        x += bw + Math.floor(rand() * 12);
      }
    } else if (room.backdrop === 'arena') {
      // lighting truss, hanging lamps and tiers of crowd in the dark
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
      const tiers = Math.max(3, Math.floor((h - 60) / 22));
      for (let t = 0; t < tiers; t++) {
        const y = 60 + t * 22;
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
    } else {
      ctx.fillStyle = '#08060c';
      for (let x = 10; x < w; x += 70) ctx.fillRect(x, 0, 4, h);
      ctx.fillRect(0, 12, w, 4);
    }
    tex.refresh();
  }
  scene.add.image(0, top, key).setOrigin(0).setScrollFactor(parallax, 1).setDepth(-300000);
}

export interface RoomView {
  roomPx: number;
  bounds: { top: number; bottom: number };
}

export function drawRoom(scene: Phaser.Scene, room: RoomDef, shape: RoomShape): RoomView {
  const width = shape.width;
  const roomPx = width * U;
  const outline = outlineOf(shape);
  const es = edges(outline);
  const gates = gatesOf(shape);
  const bounds = roomPixelBounds(room.depth, room.wallHeight, H);
  const pal = room.palette;
  const backFloorY = px(0, room.depth).y;

  drawBackdrop(scene, room, roomPx, bounds.top, backFloorY + 4);

  // ground outside the outline (only visible around cut corners)
  const g0 = scene.add.graphics().setDepth(-250000);
  g0.fillStyle(0x0b0910).fillRect(0, backFloorY, roomPx, H - backFloorY);

  // floor tiles, clipped to the outline, a little darker toward the back
  const g = scene.add.graphics().setDepth(-200000);
  for (let z = 0; z < room.depth; z++) {
    const f = 1 - (z / room.depth) * 0.28;
    for (let x = 0; x < width; x++) {
      const cell = clipToOutline(
        [
          [x, z],
          [x + 1, z],
          [x + 1, z + 1],
          [x, z + 1],
        ],
        outline,
      );
      if (cell.length < 3) continue;
      g.fillStyle(shade(pal.floor[(x + z) % 2], f));
      g.fillPoints(
        cell.map(([cx, cz]) => new Phaser.Math.Vector2(cx * U, WORLD.floorFrontY - cz * DEPTH_PX)),
        true,
      );
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

  const walls = scene.add.graphics().setDepth(-150000);
  const lip = scene.add.graphics().setDepth(-190000);
  const fence = scene.add.graphics().setDepth(800000);
  const fenceColor = pal.fence ?? 0x9aa0b4;

  es.forEach((e, i) => {
    const backFacing = e.nz < -0.01;
    const frontFacing = e.nz > 0.01;
    for (const [t0, t1] of solidSpans(i)) {
      const [ax, az] = lerpPt(e, t0);
      const [bx, bz] = lerpPt(e, t1);
      if (backFacing) {
        // wall face rising from the floor edge
        const h = room.wallHeight;
        const quad = [px(ax, az), px(bx, bz), px(bx, bz, h), px(ax, az, h)];
        const lit = 0.75 + Math.abs(e.nz) * 0.25; // diagonal walls slightly darker
        walls.fillStyle(shade(pal.wall[0], lit));
        walls.fillPoints(
          quad.map((p) => new Phaser.Math.Vector2(p.x, p.y)),
          true,
        );
        walls.lineStyle(1, shade(pal.wall[1], lit));
        for (let y = 0.5; y < h; y += 0.5) {
          const p = px(ax, az, y);
          const q = px(bx, bz, y);
          walls.lineBetween(p.x, p.y, q.x, q.y);
        }
        const p = px(ax, az, h);
        const q = px(bx, bz, h);
        walls.lineStyle(2, 0xffffff, 0.08).lineBetween(p.x, p.y, q.x, q.y);
        // contact shadow at the foot of the wall
        const f0 = px(ax, az);
        const f1 = px(bx, bz);
        walls.lineStyle(4, 0x000000, 0.3).lineBetween(f0.x, f0.y - 2, f1.x, f1.y - 2);
      }
      if (frontFacing) {
        // stage lip under the edge
        const quad = [px(ax, az), px(bx, bz), px(bx, bz, -LIP_UNITS), px(ax, az, -LIP_UNITS)];
        lip.fillStyle(shade(pal.lip, 0.8 + e.nz * 0.2));
        lip.fillPoints(
          quad.map((p) => new Phaser.Math.Vector2(p.x, p.y)),
          true,
        );
        const top0 = px(ax, az);
        const top1 = px(bx, bz);
        lip.lineStyle(1, 0xffffff, 0.1).lineBetween(top0.x, top0.y, top1.x, top1.y);
        if (room.fence) drawFence(fence, ax, az, bx, bz, fenceColor);
      }
    }
    // gates: lit floor strip and posts
    for (const [t0, t1] of gaps(i)) {
      const [ax, az] = lerpPt(e, t0);
      const [bx, bz] = lerpPt(e, t1);
      const n = 0.6;
      const strip = [
        [ax, az],
        [bx, bz],
        [bx + e.nx * n, bz + e.nz * n],
        [ax + e.nx * n, az + e.nz * n],
      ].map(([x, z]) => {
        const p = px(x, z);
        return new Phaser.Math.Vector2(p.x, p.y);
      });
      g.fillStyle(0xffb238, 0.35).fillPoints(strip, true);
      for (const [x, z] of [
        [ax, az],
        [bx, bz],
      ]) {
        const b = px(x, z);
        const t = px(x, z, Math.max(room.wallHeight * 0.6, FENCE_UNITS + 0.4));
        const post = scene.add.graphics().setDepth(backFacingOrSide(e) ? -140000 : 800001);
        post.fillStyle(0x5b5068).fillRect(b.x - 3, t.y, 6, b.y - t.y);
        post.fillStyle(0xffb238).fillRect(b.x - 3, t.y, 6, 4);
      }
    }
  });

  for (const b of room.blocks) drawBlock(scene, b);
  for (const r of room.ropes ?? []) drawRope(scene, r.from, r.to, r.heights, r.base ?? 0, room.blocks);
  return { roomPx, bounds };
}

function backFacingOrSide(e: { nz: number }): boolean {
  return e.nz <= 0.01;
}

/** Chain-link cage fence along a front-facing edge: posts, rails and a see-through mesh. */
function drawFence(
  g: Phaser.GameObjects.Graphics,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  color: number,
): void {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.round(len / 0.25));
  const at = (t: number, y: number) => px(ax + (bx - ax) * t, az + (bz - az) * t, y);
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
      const p = at(t0, y0);
      const q = at(t1, y1);
      g.lineBetween(p.x, p.y, q.x, q.y);
    }
  }
  // rails
  for (const y of [0.05, FENCE_UNITS]) {
    const p = at(0, y);
    const q = at(1, y);
    g.lineStyle(2, color, 0.85).lineBetween(p.x, p.y, q.x, q.y);
  }
  // posts every ~3 units
  const posts = Math.max(1, Math.round(len / 3));
  for (let i = 0; i <= posts; i++) {
    const b = at(i / posts, 0);
    const t = at(i / posts, FENCE_UNITS + 0.15);
    g.fillStyle(0x3a3045).fillRect(b.x - 2, t.y, 5, b.y - t.y);
    g.fillStyle(color).fillRect(b.x - 2, t.y, 3, b.y - t.y);
  }
}

function drawRope(
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  heights: number[],
  base: number,
  blocks: Block[],
): void {
  // a rope on a raised surface (a ring) sorts with whatever stands on it;
  // side ropes sort at their back end so wrestlers inside cover them
  const mx = (from[0] + to[0]) / 2;
  const mz = (from[1] + to[1]) / 2;
  const under = blocks.find((b) => b.h > 0 && mx >= b.x && mx <= b.x + b.w && mz >= b.z && mz <= b.z + b.d);
  const z = from[0] === to[0] ? Math.max(from[1], to[1]) : Math.min(from[1], to[1]);
  const depth = under ? depthOnBlock(under, z) + 2 : sortDepth(z) + 3;
  const g = scene.add.graphics().setDepth(depth);
  for (const h of heights) {
    const p = px(from[0], from[1], base + h);
    const q = px(to[0], to[1], base + h);
    g.lineStyle(3, 0xd8314b).lineBetween(p.x, p.y, q.x, q.y);
    g.lineStyle(1, 0xff6b7d).lineBetween(p.x, p.y - 1, q.x, q.y - 1);
  }
}

export function drawBlock(scene: Phaser.Scene, b: Block): Phaser.GameObjects.Graphics {
  const c = BLOCK_COLORS[b.kind ?? 'crate'] ?? BLOCK_COLORS.crate;
  const g = scene.add.graphics().setDepth(blockDepth(b));
  const x0 = b.x * U;
  const w = b.w * U;
  const topBack = project({ x: b.x, y: b.h, z: b.z + b.d }).y;
  const topFront = project({ x: b.x, y: b.h, z: b.z }).y;
  const base = project({ x: b.x, y: 0, z: b.z }).y;
  g.fillStyle(0x000000, 0.25).fillRect(x0 - 2, base - b.d * DEPTH_PX, w + 6, b.d * DEPTH_PX + 3);
  g.fillStyle(c.top).fillRect(x0, topBack, w, topFront - topBack);
  g.fillStyle(c.edge).fillRect(x0, topBack, w, 1);
  g.fillStyle(c.edge).fillRect(x0, topFront - 1, w, 1);
  g.fillStyle(c.front).fillRect(x0, topFront, w, base - topFront);
  g.fillStyle(c.line).fillRect(x0, base - 1, w, 1);
  g.fillStyle(c.line)
    .fillRect(x0, topFront, 1, base - topFront)
    .fillRect(x0 + w - 1, topFront, 1, base - topFront);
  if (b.kind === 'crate' && base - topFront >= 20) {
    g.fillStyle(c.line)
      .fillRect(x0 + 4, topFront + 5, w - 8, 1)
      .fillRect(x0 + 4, base - 6, w - 8, 1);
    const fh = base - topFront - 12;
    for (let i = 0; i < w - 8; i++)
      g.fillRect(x0 + 4 + i, topFront + 6 + Math.round((i * fh) / (w - 8)), 1, 1);
  }
  if (b.kind === 'ring') {
    // apron panels and a canvas border
    g.fillStyle(c.line);
    for (let x = x0 + 32; x < x0 + w; x += 64) g.fillRect(x, topFront + 2, 1, base - topFront - 4);
    g.fillStyle(0xffffff, 0.12).fillRect(x0 + 6, topBack + 4, w - 12, topFront - topBack - 8);
  }
  return g;
}
