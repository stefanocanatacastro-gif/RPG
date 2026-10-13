// Where things are in the battle arena: the perspective, the ring, and where
// each fighter stands. No drawing here (see stage.ts), so tests can use it.

export const ARENA = {
  width: 1440,
  height: 900,
  /** Perspective: screen centre x, horizon y, focal length, camera height (units). */
  cx: 720,
  horizon: 225,
  f: 780,
  camH: 3.2,
  ring: { half: 3.6, near: 6.4, far: 13.6, canvasY: 1 },
  /** Depth line the fighters stand on. */
  fighterZ: 9.6,
  heroX: -2.3,
  /** The partner stands a step in front of Chispa, toward the opponents (as in TTYD). */
  partnerX: -1.3,
  enemyX: [0.9, 2.0, 3.1, 3.4],
  flyerLift: 1.6,
};

export function P(X: number, Y: number, Z: number): { x: number; y: number } {
  const s = ARENA.f / Z;
  return { x: ARENA.cx + X * s, y: ARENA.horizon + (ARENA.camH - Y) * s };
}

/** Pixels per arena unit at a depth. */
export const unitPx = (Z: number) => ARENA.f / Z;

const ringTop = ARENA.ring.canvasY;
const FLOOR_Y = P(0, ringTop, ARENA.fighterZ).y;

export const STAGE = {
  /** Feet line for fighters standing on the canvas. */
  floorY: Math.round(FLOOR_Y),
  heroX: Math.round(P(ARENA.heroX, ringTop, ARENA.fighterZ).x),
};

/** Ring room each size of opponent takes, in arena units. */
const ROOM = { normal: 1.1, big: 1.6, huge: 2.6 };

/**
 * Where opponents stand across the ring (arena X, front to back). A line-up of
 * normal-sized ones keeps the classic spacing; bigger ones push the rest back,
 * squeezed to fit inside the ropes.
 */
export function enemyXs(sizes: ('normal' | 'big' | 'huge')[]): number[] {
  if (sizes.every((s) => s === 'normal'))
    return sizes.map((_, i) => ARENA.enemyX[Math.min(i, ARENA.enemyX.length - 1)]);
  const start = 0.35;
  const end = ARENA.ring.half + 0.1;
  const total = sizes.reduce((a, s) => a + ROOM[s], 0);
  const k = start + total > end ? (end - start) / total : 1;
  let at = start;
  return sizes.map((s) => {
    const x = at + (ROOM[s] * k) / 2;
    at += ROOM[s] * k;
    return x;
  });
}

/** Where a fighter stands: hero on the left, enemies across the ring (at arena X `x`), flyers above it. */
export function homeOf(
  side: 'hero' | 'enemy',
  order: number,
  airborne: boolean,
  x?: number,
): { x: number; y: number } {
  if (side === 'hero') {
    if (order === 0) return { x: STAGE.heroX, y: STAGE.floorY };
    return { x: Math.round(P(ARENA.partnerX, ringTop, ARENA.fighterZ).x), y: STAGE.floorY };
  }
  const X = x ?? ARENA.enemyX[Math.min(order, ARENA.enemyX.length - 1)];
  const p = P(X, ringTop + (airborne ? ARENA.flyerLift : 0), ARENA.fighterZ);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
