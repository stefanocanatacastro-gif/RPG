import { describe, expect, it } from 'vitest';
import {
  project,
  spriteScale,
  depthScale,
  fogAmount,
  mixColor,
  moveBody,
  groundAt,
  cameraX,
  sortDepth,
  WORLD,
  U,
  type Body,
  type RoomShape,
} from '../src/field/world';

const room: RoomShape = {
  width: 40,
  depth: 8,
  blocks: [
    { x: 10, z: 2, w: 2, d: 2, h: 1 }, // crate, too tall to walk up
    { x: 20, z: 2, w: 1, d: 3, h: 0.25 }, // a step
    { x: 21, z: 2, w: 1, d: 3, h: 0.5 }, // next step
  ],
  openings: [{ side: 'east', z0: 3, z1: 5 }],
};

function body(x: number, z: number, y = 0): Body {
  return { x, y, z, vy: 0, r: WORLD.actorRadius, grounded: y === 0 };
}

function walk(b: Body, dx: number, dz: number, frames: number): void {
  for (let i = 0; i < frames; i++) moveBody(room, b, dx / frames, dz / frames, 1 / 60);
}

describe('world projection', () => {
  it('is unchanged at the front edge: full scale, height at full scale', () => {
    expect(project({ x: 2, y: 0, z: 0 }, 10)).toEqual({ x: 2 * U, y: WORLD.floorFrontY, s: 1 });
    expect(project({ x: 2, y: 1, z: 0 }, 10).y).toBe(WORLD.floorFrontY - U);
  });

  it('draws farther things smaller and closer to the middle of the screen', () => {
    const cx = 10;
    const near = project({ x: 2, y: 0, z: 1 }, cx);
    const far = project({ x: 2, y: 0, z: 8 }, cx);
    expect(far.s).toBeLessThan(near.s);
    expect(far.y).toBeLessThan(near.y); // still higher up the screen
    expect(far.x).toBeGreaterThan(near.x); // pulled toward the centre (x = 10)
    // a point right at the camera centre doesn't drift sideways with depth
    expect(project({ x: cx, y: 0, z: 8 }, cx).x).toBe(cx * U);
    // near the front, depth still climbs at about half scale
    expect(WORLD.floorFrontY - project({ x: 2, y: 0, z: 0.25 }, cx).y).toBeCloseTo(0.25 * U * 0.5, 0);
  });

  it('shrinks sprites in clean steps and never to nothing', () => {
    expect(spriteScale(0)).toBe(1);
    const s = spriteScale(12);
    expect(s).toBeLessThan(1);
    expect((s / WORLD.spriteScaleStep) % 1).toBe(0);
    expect(spriteScale(1e6)).toBeGreaterThan(0);
    expect(depthScale(20)).toBeLessThan(depthScale(5));
  });

  it('fades into the haze with depth, up to the limit', () => {
    expect(fogAmount(0, 8)).toBe(0);
    expect(fogAmount(8, 8)).toBe(WORLD.fogMax);
    expect(fogAmount(4, 8)).toBeCloseTo(WORLD.fogMax / 2);
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });

  it('draws farther things first', () => {
    expect(sortDepth(1)).toBeGreaterThan(sortDepth(5));
  });

  it('keeps the camera inside the room', () => {
    expect(cameraX(1, 40, 640)).toBe(0);
    expect(cameraX(39, 40, 640)).toBe(40 * U - 640);
    expect(cameraX(20, 40, 640)).toBe(20 * U - 320);
  });
});

describe('world movement', () => {
  it('stops at a crate taller than a step and slides along it', () => {
    const b = body(8, 3);
    walk(b, 3, 0, 30);
    expect(b.x).toBeLessThan(10 - WORLD.actorRadius + 0.01);
    walk(b, 0, 1, 10);
    expect(b.z).toBeCloseTo(4, 1);
  });

  it('climbs small steps automatically', () => {
    const b = body(19, 3);
    walk(b, 2.5, 0, 60);
    expect(b.y).toBeCloseTo(0.5, 5);
  });

  it('can jump onto a crate and stand on it', () => {
    const b = body(9.3, 3);
    b.vy = WORLD.jumpSpeed;
    b.grounded = false;
    for (let i = 0; i < 60; i++) moveBody(room, b, 1.4 / 60, 0, 1 / 60);
    expect(b.y).toBe(1);
    expect(groundAt(room, b.x, b.z, b.r).y).toBe(1);
  });

  it('falls off the edge of a crate', () => {
    const b = body(11, 3, 1);
    b.grounded = true;
    walk(b, 3, 0, 60);
    expect(b.y).toBe(0);
  });

  it('only lets you leave through an opening', () => {
    const blocked = body(39, 1);
    walk(blocked, 3, 0, 30);
    expect(blocked.x).toBeLessThanOrEqual(40 - WORLD.actorRadius);
    const open = body(39, 4);
    walk(open, 3, 0, 30);
    expect(open.x).toBeGreaterThan(40);
  });
});

import { octagonOutline, insideOutline, exitGate, cameraY, roomPixelBounds } from '../src/field/world';

describe('octagon rooms', () => {
  const octo: RoomShape = {
    width: 60,
    depth: 28,
    blocks: [],
    outline: octagonOutline(60, 28, 10),
    gates: [{ edge: 6, t0: 0.4, t1: 0.6 }], // left wall, middle
  };

  it('knows inside from outside the cut corners', () => {
    const o = octo.outline!;
    expect(insideOutline(o, 30, 14)).toBe(true);
    expect(insideOutline(o, 1, 1)).toBe(false); // the cut front-left corner
    expect(insideOutline(o, 59, 27)).toBe(false); // the cut back-right corner
  });

  it('slides along a slanted wall instead of passing through it', () => {
    const b: Body = { x: 12, y: 0, z: 3, vy: 0, r: WORLD.actorRadius, grounded: true };
    for (let i = 0; i < 120; i++) moveBody(octo, b, -0.05, 0, 1 / 60);
    // pushed up the front-left diagonal (x + z >= 10), not into the corner
    expect(b.x + b.z).toBeGreaterThanOrEqual(10 + WORLD.actorRadius * Math.SQRT2 - 0.01);
    expect(b.z).toBeGreaterThan(3);
  });

  it('lets you out only through the gate', () => {
    const wall: Body = { x: 2, y: 0, z: 20, vy: 0, r: WORLD.actorRadius, grounded: true };
    for (let i = 0; i < 60; i++) moveBody(octo, wall, -0.1, 0, 1 / 60);
    expect(wall.x).toBeGreaterThanOrEqual(WORLD.actorRadius - 0.01);
    const gate: Body = { x: 2, y: 0, z: 14, vy: 0, r: WORLD.actorRadius, grounded: true };
    for (let i = 0; i < 60; i++) moveBody(octo, gate, -0.1, 0, 1 / 60);
    expect(gate.x).toBeLessThan(0);
    expect(exitGate(octo, gate.x, gate.z)).toBe(0);
  });

  it('scrolls the camera vertically in deep rooms', () => {
    const bounds = roomPixelBounds(28, 16, 360); // tall back wall: taller than the screen in perspective
    expect(bounds.top).toBeLessThan(0);
    const front = cameraY(340, bounds, 360);
    const back = cameraY(340 - 27 * 16, bounds, 360);
    expect(front).toBe(0);
    expect(back).toBeLessThan(front);
    expect(back).toBeGreaterThanOrEqual(bounds.top);
  });
});
