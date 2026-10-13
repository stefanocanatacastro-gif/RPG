import type { Block, Pt } from './world';
import type { Facing } from '../managers/game_state';

/**
 * Text in a room: a string-table key, or the words themselves written into the
 * room (English, plus Spanish when it's been translated). The room editor
 * writes the second form.
 */
export type RoomText = string | { en: string; es?: string };

/**
 * Story-flag conditions any door, enemy or object can carry:
 * `if` — only while this flag is set; `unless` — only while it isn't.
 */
export interface Condition {
  if?: string;
  unless?: string;
}

/** A door or gate that's there but shut until its condition holds. */
export interface Lock {
  /** Flag that must be set for the way to open. */
  requires?: string;
  /** What the player is told when they try a locked way (string key). */
  lockedText?: RoomText;
}

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
  doors?: ({ side: 'west' | 'east'; z0: number; z1: number; room: string; spawn: string } & Lock)[];
  /** Shaped rooms: gaps in an outline edge (edge index, 0–1 along it). */
  gates?: ({ edge: number; t0: number; t1: number; room: string; spawn: string } & Lock)[];
  /** Haze colour things fade into toward the back (defaults to the backdrop's). */
  fog?: number;
  /** Pools of light on the floor (or on a block top), optionally with a beam from above. */
  lights?: LightDef[];
  /** Silhouettes between the camera and the room (z < 0), drawn in front of everything. */
  foreground?: ForegroundDef[];
  /** Named spawn points: [x, z, facing]. */
  spawns: Record<string, [number, number, Facing]>;
  enemies: FieldEnemyDef[];
  /** People, signs, chests, heal blocks and story triggers. */
  objects?: ObjectDef[];
}

export interface FieldEnemyDef extends Condition {
  id: string;
  enemy: string;
  formation: string;
  x: number;
  z: number;
  patrol: number;
  /**
   * false = beaten for good (story fights, bosses): a flag remembers the win.
   * Others come back the next time you enter the room.
   */
  respawn?: boolean;
}

interface ObjectBase extends Condition {
  id: string;
  x: number;
  z: number;
}

/** Someone to talk to. Lines are string keys, shown one after another. */
export interface NpcDef extends ObjectBase {
  kind: 'npc';
  sprite: string;
  name: RoomText;
  lines: RoomText[];
  /** Set once the player has heard them out. */
  setFlag?: string;
}

export interface SignDef extends ObjectBase {
  kind: 'sign';
  lines: RoomText[];
}

/** An item box: opens once (its flag remembers), gives the item. */
export interface ChestDef extends ObjectBase {
  kind: 'chest';
  item: string;
  flag: string;
}

/** Restores the party's HP and Grit. */
export interface HealDef extends ObjectBase {
  kind: 'heal';
}

/** An invisible area that fires when walked into: sets a flag and/or shows lines. */
export interface TriggerDef extends ObjectBase {
  kind: 'trigger';
  w: number;
  d: number;
  setFlag?: string;
  lines?: RoomText[];
  /** Fires only once (needs setFlag to remember). Default true. */
  once?: boolean;
}

export type ObjectDef = NpcDef | SignDef | ChestDef | HealDef | TriggerDef;

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

export interface RoomExit extends Lock {
  room: string;
  spawn: string;
}
