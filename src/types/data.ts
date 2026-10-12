// TypeScript types for every game-data JSON file. The Database checks the JSON
// against these at startup, so a typo in a data file shows up as a clear problem
// in the dev build instead of a crash halfway through a battle.

/** Text shown to the player is a string-table key (see src/strings). */
export type StringKey = string;

export interface CharacterDef {
  id: string;
  name: StringKey;
  sprite: string;
  hp: number;
  grit: number;
  attack: number;
  defence: number;
  moves: string[];
}

export type EnemyProp = 'spiky' | 'airborne' | 'armoured' | 'flips' | 'fiery';

export interface AiRule {
  move: string;
  weight: number;
  /**
   * Among rules whose conditions hold, only the highest priority are considered
   * (default 0); weights then pick between those. Use it for "always do X when…".
   */
  priority?: number;
  /** Only when the enemy's HP is at or below this fraction (0–1). */
  whenHpBelow?: number;
  /** Only when some other enemy's HP is at or below this fraction (0–1). */
  whenAllyHpBelow?: number;
  /** Only on rounds fromRound, fromRound + everyRounds, … (a repeating pattern). */
  everyRounds?: number;
  /** First round this rule can apply (default 1). */
  fromRound?: number;
}

export interface EnemyDef {
  id: string;
  name: StringKey;
  sprite: string;
  level: number;
  hp: number;
  attack: number;
  defence: number;
  xp: number;
  coins: number;
  props: EnemyProp[];
  moves: string[];
  ai: AiRule[];
  /** Pip's Scout description. */
  scout: StringKey;
}

export type MoveCategory = 'strike' | 'aerial' | 'grapple' | 'enemy' | 'partner';
export type TargetRule = 'single' | 'all' | 'all_ground' | 'front' | 'self' | 'partner' | 'ally_lowest';
export type CommandType =
  'none' | 'stomp' | 'timed_press' | 'hold_release' | 'mash' | 'rotate' | 'sequence' | 'ring';

export type MoveStep =
  | { do: 'walk_to_target' }
  | { do: 'jump_to_target' }
  | { do: 'anim'; anim: string; wait?: number }
  | { do: 'command' }
  | { do: 'hit'; mult?: number }
  | { do: 'heal' }
  | { do: 'return' }
  | { do: 'wait'; ms: number };

export interface MoveDef {
  id: string;
  name: StringKey;
  category: MoveCategory;
  gritCost: number;
  power: number;
  target: TargetRule;
  command: CommandType;
  /** Which enemy types this move can reach. */
  reaches: { airborne: boolean; spiky: boolean };
  piercing?: boolean;
  /** Turns spent winding up before the move lands (the user is visibly charging meanwhile). */
  charge?: number;
  /** HP restored to the target (support moves, with a "heal" step). */
  heal?: number;
  steps: MoveStep[];
}

export type ItemCategory = 'heal' | 'damage' | 'buff' | 'key';

export interface ItemDef {
  id: string;
  name: StringKey;
  desc: StringKey;
  icon: string;
  category: ItemCategory;
  target: TargetRule;
  effect: { heal?: number; grit?: number; damage?: number; attackUp?: number; turns?: number };
  price: number;
}

export type FormationSlot = 'front' | 'back' | 'air';

export interface FormationDef {
  id: string;
  enemies: { enemy: string; slot: FormationSlot }[];
  stage: string;
  music?: string;
  /** Hazards that may trigger during this fight (M3). */
  hazards?: string[];
}

export interface GameData {
  characters: CharacterDef[];
  enemies: EnemyDef[];
  moves: MoveDef[];
  items: ItemDef[];
  formations: FormationDef[];
}
