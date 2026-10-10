// The 3D world: every position in a room is (x, y, z) in world units.
//   x  — left to right along the room
//   z  — depth: 0 is the front edge of the floor, larger is farther back
//   y  — height above the floor
// One unit is 32 px across the screen at the front edge of the floor. The
// camera looks at the stage in perspective (like TTYD's field camera): farther
// back, things are smaller and closer to the middle of the screen. A screen is
// 20 units wide, and rooms are a whole number of screens wide.
//
// A room's floor is a convex outline in the x–z plane: a rectangle by default,
// or any convex shape such as an octagon. Walls run along its edges, and gates
// are gaps in an edge you can walk out through.
//
// This file is pure maths (no Phaser) so it can be unit-tested.

import world from '../data/world.json';

export const WORLD = world;
export const U = world.unitPx;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A point on the floor plan: [x, z]. */
export type Pt = [number, number];

/** A solid box standing on the floor (crate, step, platform, ring). */
export interface Block {
  x: number;
  z: number;
  /** Size along x, z and height. */
  w: number;
  d: number;
  h: number;
  kind?: string;
}

/** A gap in one edge of the outline. t0–t1 run from 0 (edge start) to 1 (edge end). */
export interface Gate {
  edge: number;
  t0: number;
  t1: number;
}

export interface RoomShape {
  /** Width in units (a multiple of WORLD.screenUnits). */
  width: number;
  /** Depth in units. */
  depth: number;
  blocks: Block[];
  /** Floor outline, counter-clockwise from the front. Defaults to the full rectangle. */
  outline?: Pt[];
  gates?: Gate[];
  /** Rectangle rooms: openings in the side walls as z ranges (turned into gates). */
  openings?: { side: 'west' | 'east'; z0: number; z1: number }[];
}

// ── Outlines ───────────────────────────────────────────────────────────

export function rectOutline(width: number, depth: number): Pt[] {
  return [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ];
}

/**
 * An octagon filling width × depth with its corners cut by `cut` units
 * (a 45° cut in world space). Edges, counter-clockwise from the front:
 * 0 front, 1 front-right, 2 right, 3 back-right, 4 back, 5 back-left, 6 left, 7 front-left.
 */
export function octagonOutline(width: number, depth: number, cut: number): Pt[] {
  return [
    [cut, 0],
    [width - cut, 0],
    [width, cut],
    [width, depth - cut],
    [width - cut, depth],
    [cut, depth],
    [0, depth - cut],
    [0, cut],
  ];
}

export function outlineOf(shape: RoomShape): Pt[] {
  return shape.outline ?? rectOutline(shape.width, shape.depth);
}

/** Gates, including side openings of rectangle rooms converted to edge gaps. */
export function gatesOf(shape: RoomShape): Gate[] {
  const gates = [...(shape.gates ?? [])];
  if (!shape.outline) {
    for (const o of shape.openings ?? []) {
      // rectangle edges: 1 = east (z goes 0→depth), 3 = west (z goes depth→0)
      if (o.side === 'east') gates.push({ edge: 1, t0: o.z0 / shape.depth, t1: o.z1 / shape.depth });
      else gates.push({ edge: 3, t0: 1 - o.z1 / shape.depth, t1: 1 - o.z0 / shape.depth });
    }
  }
  return gates;
}

interface EdgeInfo {
  a: Pt;
  b: Pt;
  len: number;
  /** Unit normal pointing into the room. */
  nx: number;
  nz: number;
}

export function edges(outline: Pt[]): EdgeInfo[] {
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    return { a, b, len, nx: -dz / len, nz: dx / len };
  });
}

/** Signed distance inside an edge (positive = inside) and position t along it. */
function edgeCoords(e: EdgeInfo, x: number, z: number): { s: number; t: number } {
  const px = x - e.a[0];
  const pz = z - e.a[1];
  return { s: px * e.nx + pz * e.nz, t: (px * (e.b[0] - e.a[0]) + pz * (e.b[1] - e.a[1])) / (e.len * e.len) };
}

export function insideOutline(outline: Pt[], x: number, z: number, margin = 0): boolean {
  return edges(outline).every((e) => edgeCoords(e, x, z).s >= margin);
}

/** Which gate (index into gatesOf) a point has walked out through, or -1. */
export function exitGate(shape: RoomShape, x: number, z: number): number {
  const es = edges(outlineOf(shape));
  return gatesOf(shape).findIndex((g) => {
    const { s, t } = edgeCoords(es[g.edge], x, z);
    return s < 0 && t >= g.t0 && t <= g.t1;
  });
}

/** Keeps a footprint of radius r inside the outline, except where it's passing through a gate. */
function constrain(shape: RoomShape, b: { x: number; z: number; r: number }): void {
  const es = edges(outlineOf(shape));
  const gates = gatesOf(shape);
  for (let pass = 0; pass < 2; pass++) {
    es.forEach((e, i) => {
      const { s, t } = edgeCoords(e, b.x, b.z);
      if (s >= b.r) return;
      const gap = gates.find((g) => g.edge === i && t >= g.t0 && t <= g.t1);
      if (gap) {
        // inside the gate: only keep clear of its two posts
        const margin = b.r / e.len;
        if (t >= gap.t0 + margin && t <= gap.t1 - margin) return;
      }
      b.x += e.nx * (b.r - s);
      b.z += e.nz * (b.r - s);
    });
  }
}

// ── Projection and drawing order ──────────────────────────────────────
//
// A perspective camera, like TTYD's: things farther back are drawn smaller
// and pulled toward the middle of the screen, so floors converge, side walls
// show, and the near parts of a room slide past faster than the far parts as
// the camera scrolls.
//
//   s(z)  = 1 / (1 + k·z)                 size at depth z (1 at the front edge)
//   x_px  = cx·U + (x − cx)·U·s           cx = the world x at the screen centre
//   y_px  = H0 + (F − H0)·s − y·U·s       H0 = the horizon line
//
// F − H0 = U·depthScale / k, so right at the front edge depth still climbs the
// screen at the old half-scale rate. At the front (z = 0) nothing changes:
// sizes and positions there are exactly what they were before perspective.
// k = world.perspective; 0 gives the old flat projection.

const K = world.perspective;
const F = world.floorFrontY;
const HORIZON_SPAN = K > 0 ? (U * world.depthScale) / K : 0;

/** How large something at depth z is drawn (1 at the front edge, smaller farther back). */
export function depthScale(z: number): number {
  return K > 0 ? 1 / (1 + K * z) : 1;
}

/** depthScale snapped to steps so sprites shrink in a few clean sizes instead of shimmering. */
export function spriteScale(z: number): number {
  const step = world.spriteScaleStep;
  return Math.max(step, Math.round(depthScale(z) / step) * step);
}

/**
 * World position → pixel position in the room's drawing space (before camera
 * scroll). cx is the world x the camera is centred on; `s` is the draw scale there.
 */
export function project(p: Vec3, cx: number): { x: number; y: number; s: number } {
  if (K <= 0) {
    return {
      x: Math.round(p.x * U),
      y: Math.round(F - p.z * U * world.depthScale - p.y * U),
      s: 1,
    };
  }
  const s = depthScale(p.z);
  return {
    x: Math.round(cx * U + (p.x - cx) * U * s),
    y: Math.round(F - HORIZON_SPAN + HORIZON_SPAN * s - p.y * U * s),
    s,
  };
}

/** The same projection without rounding, for drawing smooth polygon edges. */
export function projectExact(p: Vec3, cx: number): { x: number; y: number } {
  if (K <= 0) return { x: p.x * U, y: F - p.z * U * world.depthScale - p.y * U };
  const s = depthScale(p.z);
  return { x: cx * U + (p.x - cx) * U * s, y: F - HORIZON_SPAN + HORIZON_SPAN * s - p.y * U * s };
}

/** The world x at the middle of the screen for a given horizontal camera scroll (pixels). */
export function cameraCentre(scrollX: number, screenW: number): number {
  return (scrollX + screenW / 2) / U;
}

/**
 * How much of a colour fades into the room's haze at depth z: 0 at the front,
 * up to world.fogMax at the back wall.
 */
export function fogAmount(z: number, roomDepth: number): number {
  return Math.max(0, Math.min(1, z / Math.max(1, roomDepth))) * world.fogMax;
}

/** Mixes colour a toward b by t (0–1). */
export function mixColor(a: number, b: number, t: number): number {
  const m = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Draw order: farther back is drawn first; things on top of a block draw after it. */
export function sortDepth(z: number, onTopOfFront?: number): number {
  const zKey = onTopOfFront !== undefined ? Math.min(z, onTopOfFront - 0.01) : z;
  return Math.round(100000 - zKey * 1000);
}

export function blockDepth(b: Block): number {
  return sortDepth(b.z) + 1;
}

/**
 * Draw order for something standing on (or attached to) a block's top: after
 * the block itself, and still front-to-back among other things on that block,
 * so a wrestler in the ring covers the back ropes but not the front ones.
 */
export function depthOnBlock(b: Block, z: number): number {
  return blockDepth(b) + 1 + Math.round(Math.max(0, b.z + b.d - z) * 5);
}

// ── Movement ──────────────────────────────────────────────────────────

function overlaps(x: number, z: number, r: number, b: Block): boolean {
  return x + r > b.x && x - r < b.x + b.w && z + r > b.z && z - r < b.z + b.d;
}

/** Height of the ground under a footprint, and which block (if any) provides it. */
export function groundAt(shape: RoomShape, x: number, z: number, r: number): { y: number; block?: Block } {
  let best: { y: number; block?: Block } = { y: 0 };
  for (const b of shape.blocks) {
    if (overlaps(x, z, r * 0.6, b) && b.h > best.y) best = { y: b.h, block: b };
  }
  return best;
}

/** The highest surface the actor could stand on without climbing more than a step. */
function supportAt(shape: RoomShape, x: number, z: number, r: number, feetY: number): number {
  let top = 0;
  for (const b of shape.blocks) {
    if (b.h <= feetY + world.stepHeight && overlaps(x, z, r * 0.6, b)) top = Math.max(top, b.h);
  }
  return top;
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vy: number;
  r: number;
  grounded: boolean;
}

/**
 * Moves a body by (dx, dz) and applies gravity over dt seconds. Blocks taller
 * than a step stop sideways movement unless the body is above them; small
 * height differences are climbed automatically (stairs). Walls follow the
 * room outline, so slanted walls slide you along them.
 */
export function moveBody(shape: RoomShape, b: Body, dx: number, dz: number, dt: number): void {
  const blocked = (x: number, z: number) =>
    shape.blocks.some((k) => k.h > b.y + world.stepHeight && overlaps(x, z, b.r, k));

  // move along each axis separately so you slide along blocks
  if (dx !== 0 && !blocked(b.x + dx, b.z)) b.x += dx;
  if (dz !== 0 && !blocked(b.x, b.z + dz)) b.z += dz;
  constrain(shape, b);

  // vertical: gravity, landing, stepping up
  const support = supportAt(shape, b.x, b.z, b.r, b.y);
  if (b.grounded && support > b.y) b.y = support; // walked up a step
  b.vy -= world.gravity * dt;
  b.y += b.vy * dt;
  if (b.y <= support) {
    b.y = support;
    b.vy = 0;
    b.grounded = true;
  } else b.grounded = false;
}

/** Horizontal (x–z) distance between two points. */
export function flatDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ── Camera ────────────────────────────────────────────────────────────

/** Camera scroll in pixels so the player sits near the middle, clamped to the room. */
export function cameraX(playerX: number, roomWidth: number, screenW: number): number {
  const target = playerX * U - screenW / 2;
  return Math.max(0, Math.min(roomWidth * U - screenW, target));
}

/** Vertical extent of a room in drawing pixels: from the top of the back wall to the bottom of the screen. */
export function roomPixelBounds(
  depth: number,
  wallHeight: number,
  screenH: number,
): { top: number; bottom: number } {
  // y doesn't depend on the camera's x, so any cx works here
  return { top: Math.min(0, project({ x: 0, y: wallHeight, z: depth }, 0).y - 24), bottom: screenH };
}

/** Vertical camera scroll: keeps the player a little below the middle, clamped to the room. */
export function cameraY(
  playerScreenY: number,
  bounds: { top: number; bottom: number },
  screenH: number,
): number {
  const target = playerScreenY - screenH * 0.58;
  return Math.max(bounds.top, Math.min(bounds.bottom - screenH, target));
}
