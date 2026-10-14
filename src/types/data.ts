import type { RoomDef } from '../field/room_types';

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
  /** Made fighters: a nickname shown with the name. */
  title?: StringKey;
  /** Made fighters: what they shout (when playing to the crowd). */
  line?: StringKey;
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
  /** Made fighters: a nickname shown with the name. */
  title?: StringKey;
  /** Made fighters: what they shout at the start of a fight. */
  line?: StringKey;
  /** How much room they take in the ring: big ones need more, huge bosses half the ring. Default normal. */
  size?: 'normal' | 'big' | 'huge';
  /** How they arrive: walking in from the side or dropping from the rafters, with their name in lights. Huge ones walk in unless set to none. */
  entrance?: 'walk' | 'drop' | 'none';
  /** A second phase: below some HP they change pattern and get stronger (bosses). */
  phase2?: PhaseDef;
}

/** What changes when a boss enters its second phase. */
export interface PhaseDef {
  /** Starts the first time HP falls to this share of max HP or below (0–1). */
  atHp: number;
  attack?: number;
  defence?: number;
  /** HP restored when it starts. */
  heal?: number;
  /** The moves and pattern it uses from then on. */
  moves: string[];
  ai: AiRule[];
  /** What it shouts when it starts. */
  line?: StringKey;
}

export type MoveCategory = 'strike' | 'aerial' | 'grapple' | 'enemy' | 'partner';
export type TargetRule =
  | 'single'
  | 'all'
  | 'all_ground'
  | 'front'
  | 'self'
  | 'partner'
  | 'ally_lowest'
  /** Items: Chispa or the partner, the user's choice. */
  | 'ally';
export type CommandType =
  'none' | 'stomp' | 'timed_press' | 'hold_release' | 'mash' | 'rotate' | 'sequence' | 'ring';

export type MoveStep =
  | { do: 'walk_to_target' }
  | { do: 'jump_to_target' }
  | { do: 'anim'; anim: string; wait?: number }
  | { do: 'command' }
  | { do: 'hit'; mult?: number }
  | { do: 'heal' }
  /** Partner Scout: shows the target's stats and Scout text. */
  | { do: 'scout' }
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
  effect: {
    heal?: number;
    grit?: number;
    damage?: number;
    attackUp?: number;
    defenceUp?: number;
    /** How many of the target's turns a boost lasts. */
    turns?: number;
    /** Gets Chispa back up with this much HP when he's knocked out (works by itself, not from the menu). */
    revive?: number;
  };
  price: number;
}

export type FormationSlot = 'front' | 'back' | 'air';

export interface FormationDef {
  id: string;
  enemies: { enemy: string; slot: FormationSlot }[];
  stage: string;
  music?: string;
  /** A fight the story lets you lose (no Game Over): the story goes on either way. */
  loseOk?: boolean;
  /** Ring hazards, a goal other than "knock everyone out", house rules and the crowd. */
  conditions?: BattleConditions;
}

/** A ring hazard (hazards.json). What each kind does lives in the battle engine. */
export interface HazardDef {
  id: string;
  name: string;
  /** Fits a menu label (up to 10 letters). */
  short: string;
  desc: string;
  /**
   * falling   — at the start of a round, with `chance`, `damage` to a random fighter
   * slip      — run-in moves may slip (`chance`): the move misses, the attacker takes `damage`
   * burn      — aerial moves cost their user `damage`
   * spotlight — each round a random fighter hits `attack` harder
   */
  kind: 'falling' | 'slip' | 'burn' | 'spotlight';
  chance?: number;
  damage?: number;
  attack?: number;
}

/** How full the arena is: scales how fast Hype builds. */
export type CrowdSize = 'quiet' | 'normal' | 'packed';
/** Who the crowd is behind: fair (nobody), home (you: throws you snacks), away (them: throws junk at you), rowdy (junk at anyone). */
export type CrowdMood = 'fair' | 'home' | 'away' | 'rowdy';

/** Everything about a fight besides who's in it. All optional: none means a plain match. */
export interface BattleConditions {
  hazards?: string[];
  /** ko: knock them all out (default). timed: …within `rounds` rounds. survive: stay up for `rounds` rounds. */
  goal?: 'ko' | 'timed' | 'survive';
  rounds?: number;
  noItems?: boolean;
  noRun?: boolean;
  crowd?: CrowdSize;
  mood?: CrowdMood;
}

/** A Hype special (specials.json): paid for with Hype by Chispa or the partner. */
export interface SpecialDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** party: everyone standing on your side. enemies: every standing opponent. */
  target: 'party' | 'enemies';
  effect: { heal?: number; damage?: number; attackUp?: number; defenceUp?: number; turns?: number };
}

/** A look for the battle arena: colours for every part, and how full the stands are. */
export interface StageDef {
  id: string;
  name: string;
  /** Backdrop gradient, rafters to stands (5 colours). */
  sky: string[];
  floor: string;
  /** Stand rows, front to back (7). */
  rows: string[];
  shirts: string[];
  /** Share of seats filled, 0–1. */
  crowd: number;
  /** Front, sides, top rail. */
  barricade: string[];
  mats: string[];
  /** Apron face, shadow, top edge. */
  apron: string[];
  emblem: string;
  /** Canvas edge, canvas, spotlight pool, logo. */
  canvas: string[];
  /** Post, highlight, cap. */
  post: string[];
  buckle: string[];
  rope: string[];
  truss: string;
  light: string;
}

export interface GameData {
  characters: CharacterDef[];
  enemies: EnemyDef[];
  moves: MoveDef[];
  items: ItemDef[];
  formations: FormationDef[];
  stages: StageDef[];
  /** Every room, by id (src/data/rooms/*.json). */
  rooms: Record<string, RoomDef>;
}
