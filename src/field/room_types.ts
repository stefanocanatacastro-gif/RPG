import type { Block, Pt } from './world';
import type { Facing } from '../managers/game_state';

/** A room as stored in data. All sizes and positions are world units. */
export interface RoomDef {
  name: string;
  /** Width in whole screens (1 screen = 20 units). */
  screens: number;
  /** Depth in units. */
  depth: number;
  /** Back wall height in units. */
  wallHeight: number;
  backdrop: string;
  palette: { floor: number[]; wall: number[]; lip: number; fence?: number };
  /** Floor shape: omitted = full rectangle; { "octagon": cut } or explicit points [x, z]. */
  outline?: { octagon: number } | Pt[];
  /** Front-facing edges get a see-through cage fence instead of nothing. */
  fence?: boolean;
  blocks: Block[];
  /** Decorative ropes between two floor points, at the given heights. */
  ropes?: { from: Pt; to: Pt; heights: number[]; base?: number }[];
  /** Rectangle rooms: doors in the side walls. */
  doors?: { side: 'west' | 'east'; z0: number; z1: number; room: string; spawn: string }[];
  /** Shaped rooms: gaps in an outline edge (edge index, 0–1 along it). */
  gates?: { edge: number; t0: number; t1: number; room: string; spawn: string }[];
  /** Haze colour things fade into toward the back (defaults to the backdrop's). */
  fog?: number;
  /** Pools of light on the floor (or on a block top), optionally with a beam from above. */
  lights?: LightDef[];
  /** Silhouettes between the camera and the room (z < 0), drawn in front of everything. */
  foreground?: ForegroundDef[];
  /** Named spawn points: [x, z, facing]. */
  spawns: Record<string, [number, number, Facing]>;
  enemies: { id: string; enemy: string; formation: string; x: number; z: number; patrol: number }[];
}

export interface LightDef {
  x: number;
  z: number;
  /** Radius in units. */
  r: number;
  color?: number;
  /** Draw a shaft of light coming down from above. */
  beam?: boolean;
}

/**
 * pillar: a dark column; crowd: a row of heads; barrier: a low railing.
 * Placed at x (and repeated every `every` units up to `to`), at depth z (< 0).
 */
export interface ForegroundDef {
  kind: 'pillar' | 'crowd' | 'barrier';
  x: number;
  z: number;
  to?: number;
  every?: number;
}

export interface RoomExit {
  room: string;
  spawn: string;
}
