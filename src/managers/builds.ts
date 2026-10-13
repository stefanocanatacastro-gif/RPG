// Fighters made in the fighter maker: heroes and enemies with their own name,
// look, stats, moves and (for enemies) traits, rewards and attack pattern.
//
// Storage: each person's fighters are one document, builds/<their id>, in the
// game link's database. Everyone who opens the link reads everyone's (the
// community), only the owner can change theirs. Outside the link they live in
// this browser. At start-up every fighter found is turned into normal game data
// (CharacterDef / EnemyDef) so battles, the sandbox and the simulator use them
// like built-in ones.

import type {
  AiRule,
  CharacterDef,
  CommandType,
  EnemyDef,
  EnemyProp,
  ItemDef,
  MoveDef,
  MoveStep,
} from '../types/data';
import { Database } from './database';
import { addStrings, t } from './strings';
import { registerSpriteKey } from './sprite_keys';
import { artifactDb, viewerId, type DbLike } from './artifact_db';
import type { BattleSetup } from './battle_setup';

/** The colour slots of the wrestler body. */
export const COLOR_SLOTS = ['skin', 'mask', 'shirt', 'trunks', 'boots'] as const;
export type ColorSlot = (typeof COLOR_SLOTS)[number];

/** Colours offered for each slot. */
export const PALETTE: number[] = [
  0xf4ead2, 0xd99b6c, 0xb07850, 0x7a4a30, 0x4a2c20, 0xffb238, 0xf2c14e, 0xd8314b, 0x8f1f33, 0x2a6fd8,
  0x1d2a4a, 0x3fa7f0, 0x5fd068, 0x2e7a3a, 0x9f6fd8, 0x5b3a8a, 0x1b1622, 0x5b5068, 0xa79cb6, 0xff70a0,
];

/** The pictures a fighter can have: standing, attacking, getting hit. */
export const POSES = ['idle', 'attack', 'hurt'] as const;
export type Pose = (typeof POSES)[number];

/** How an uploaded picture is drawn in the game. */
export interface PictureSettings {
  /** Height on screen, in game pixels. */
  height: number;
  /** Size of one picture pixel in game pixels: 1 = smooth, 2–4 = chunkier pixel art. */
  pixel: number;
  /** A dark 1-pixel outline around the figure. */
  outline: boolean;
  /** The picture faces left: turn it to face right (the way heroes face). */
  flip: boolean;
  /** How much the paper-cutout animations move: 0 still, 1 calm, 2 normal, 3 lively. */
  motion?: number;
}

/** How much room a fighter takes: huge ones are bosses that fill half the ring. */
export type FighterSize = 'normal' | 'big' | 'huge';

export const DEFAULT_PICTURE: PictureSettings = {
  height: 96,
  pixel: 2,
  outline: true,
  flip: false,
  motion: 2,
};

export interface FighterLook {
  /** 'wrestler' = the animated wrestler body in custom colours, 'picture' = uploaded pictures, or a sprite key. */
  base: string;
  colors?: Partial<Record<ColorSlot, number>>;
  /** Uploaded pictures (background cleared, cropped, PNG data URLs). Idle is the main one. */
  pictures?: Partial<Record<Pose, string>>;
  picture?: PictureSettings;
}

/** A special rule in an enemy's pattern, on top of how often it uses each move. */
export interface CustomAiRule {
  move: string;
  /**
   * opener    — on the first round
   * hp_below  — whenever its HP is at or below `value`%
   * ally_hurt — when a teammate is at or below `value`% (for healing moves)
   * every     — every `value` rounds
   */
  when: 'opener' | 'hp_below' | 'ally_hurt' | 'every';
  value?: number;
}

export interface CustomFighter {
  /** Unique within its maker's set (f1, f2…). */
  id: string;
  kind: 'hero' | 'enemy';
  name: string;
  look: FighterLook;
  hp: number;
  attack: number;
  defence: number;
  moves: string[];
  /** Heroes: Grit to spend on moves. */
  grit?: number;
  /** Enemies. */
  props?: EnemyProp[];
  xp?: number;
  coins?: number;
  /** Enemies: how often each move is picked (0 = never). */
  weights?: Record<string, number>;
  /** Enemies: a move used whenever HP is at half or below. */
  lowHpMove?: string;
  /** Enemies: how big they are (bosses can be huge). */
  size?: FighterSize;
  /** Enemies: special rules (up to 4) on top of the weights. */
  rules?: CustomAiRule[];
  scout?: string;
  /** A nickname shown with the name ("The Harbor Hammer"). */
  title?: string;
  /** What they shout: enemies at the start of a fight, heroes when they play to the crowd. */
  line?: string;
  /** Heroes: a short story. */
  bio?: string;
}

/** A saved fight: a sandbox setup with a title. */
export interface Encounter {
  /** Unique within its maker's set (b1, b2…). */
  id: string;
  title: string;
  setup: BattleSetup;
  savedAt?: string;
}

/** An item made in the item maker. One kind of effect each. */
export interface CustomItem {
  /** Unique within its maker's set (i1, i2…). */
  id: string;
  name: string;
  desc: string;
  kind: 'heal' | 'grit' | 'damage' | 'boost' | 'revive';
  /** HP healed, Grit given, damage dealt, or HP after a revive. */
  amount: number;
  /** Damage: one opponent or all of them. Heal/boost: the user, or a chosen ally. */
  target: 'self' | 'ally' | 'single' | 'all';
  attackUp?: number;
  defenceUp?: number;
  turns?: number;
  /** Colour of its icon. */
  color?: number;
}

/** A move made in the move maker: an attack or a heal, for heroes or for enemies. */
export interface CustomMove {
  /** Unique within its maker's set (m1, m2…). */
  id: string;
  name: string;
  desc: string;
  /** Who can learn it in the fighter maker. */
  user: 'hero' | 'enemy';
  kind: 'attack' | 'heal';
  /** Attack: power per hit (plus the user's attack). Heal: HP restored. */
  power: number;
  /** Attack: how many hits. */
  hits: number;
  gritCost: number;
  /** How the user gets there: runs in, jumps in, or hits from where they stand. */
  approach: 'run' | 'jump' | 'stay';
  /** Attack: the front opponent, any one, or all of them at once. Heal: the user, or a chosen ally. */
  target: 'front' | 'single' | 'all' | 'self' | 'ally';
  /** Heroes: the action command that powers it up. */
  command: 'timed_press' | 'hold_release' | 'stomp' | 'none';
  reachesAir: boolean;
  reachesSpiky: boolean;
  piercing: boolean;
  /** Enemies: turns spent winding up first (0 = none). */
  charge: number;
}

export type CreationKind = 'fighter' | 'move' | 'item' | 'encounter';

export interface BuildSet {
  fighters: CustomFighter[];
  encounters?: Encounter[];
  items?: CustomItem[];
  moves?: CustomMove[];
  savedAt?: string;
}

const LOCAL_KEY = 'kid-chispa.builds';
/** Everything one person makes is one saved document; pictures count toward this. */
export const MAX_SET_CHARS = 900_000;
let afterChange: (() => Promise<void> | void) | null = null;
let db: DbLike | null = null;
let uid: string | null = null;
/** Everyone's sets, by owner id ('me' outside the link). */
const sets = new Map<string, BuildSet>();
const looks = new Map<string, FighterLook>();
const sizes = new Map<string, FighterSize>();

/** Short owner tag used in fighter ids: c.<owner>.<id>. */
function ownerTag(owner: string): string {
  return owner === 'me' ? 'me' : owner.replace(/^u_/, '').slice(0, 8);
}

export function myOwnerId(): string {
  return uid ?? 'me';
}

/** An encounter's id across everyone's sets. */
export function encounterKey(owner: string, localId: string): string {
  return `${ownerTag(owner)}.${localId}`;
}

export function globalId(owner: string, localId: string): string {
  return `c.${ownerTag(owner)}.${localId}`;
}

export function isCustomId(id: string): boolean {
  return id.startsWith('c.');
}

export function isMine(id: string): boolean {
  return id.startsWith(`c.${ownerTag(myOwnerId())}.`);
}

/** Texture key for a fighter's look. */
function textureFor(gid: string, look: FighterLook): string {
  return look.base === 'wrestler' || look.base === 'picture'
    ? `spr_custom_${gid.replace(/\./g, '_')}`
    : look.base;
}

/** An enemy's special rules as engine AI rules. */
export function rulesToAi(rules: CustomAiRule[]): AiRule[] {
  return rules.map((r): AiRule => {
    const pct = Math.max(1, Math.min(100, r.value ?? 50)) / 100;
    switch (r.when) {
      case 'opener':
        return { move: r.move, weight: 1, priority: 2, fromRound: 1, everyRounds: 9999 };
      case 'hp_below':
        return { move: r.move, weight: 1, priority: 1, whenHpBelow: pct };
      case 'ally_hurt':
        return { move: r.move, weight: 1, priority: 1, whenAllyHpBelow: pct };
      case 'every': {
        const n = Math.max(2, Math.min(9, r.value ?? 3));
        return { move: r.move, weight: 1, priority: 1, fromRound: n, everyRounds: n };
      }
    }
  });
}

/** A rule in words, for the maker and cards. */
export function ruleText(r: CustomAiRule, moveName: string): string {
  switch (r.when) {
    case 'opener':
      return `${moveName} to open the fight`;
    case 'hp_below':
      return `${moveName} when its HP is at ${r.value ?? 50}% or less`;
    case 'ally_hurt':
      return `${moveName} when a teammate is at ${r.value ?? 50}% or less`;
    case 'every':
      return `${moveName} every ${r.value ?? 3} rounds`;
  }
}

/** Turns a maker's fighter into normal game data. */
export function toDefs(owner: string, f: CustomFighter): { char?: CharacterDef; foe?: EnemyDef } {
  const gid = globalId(owner, f.id);
  const name = `${gid}.name`;
  addStrings({ [name]: f.name || 'Nameless' });
  const sprite = textureFor(gid, f.look);
  if (f.look.base === 'wrestler' || f.look.base === 'picture') registerSpriteKey(sprite);
  const extra: { title?: string; line?: string } = {};
  if (f.title) {
    extra.title = `${gid}.title`;
    addStrings({ [extra.title]: f.title });
  }
  if (f.line) {
    extra.line = `${gid}.line`;
    addStrings({ [extra.line]: f.line });
  }
  looks.set(gid, f.look);
  sizes.set(gid, f.kind === 'enemy' ? (f.size ?? 'normal') : 'normal');
  if (f.kind === 'hero')
    return {
      char: {
        id: gid,
        name,
        sprite,
        hp: f.hp,
        grit: f.grit ?? 5,
        attack: f.attack,
        defence: f.defence,
        moves: [...f.moves],
        ...extra,
      },
    };
  const scout = `${gid}.scout`;
  addStrings({ [scout]: f.scout || 'A fighter from the community.' });
  const weights = f.weights ?? {};
  const ai: AiRule[] = f.moves
    .filter((m) => (weights[m] ?? 1) > 0)
    .map((m) => ({ move: m, weight: weights[m] ?? 1 }));
  if (f.lowHpMove && f.moves.includes(f.lowHpMove))
    ai.push({ move: f.lowHpMove, weight: 1, priority: 1, whenHpBelow: 0.5 });
  ai.push(...rulesToAi((f.rules ?? []).filter((r) => f.moves.includes(r.move))));
  if (ai.length === 0 && f.moves[0]) ai.push({ move: f.moves[0], weight: 1 });
  return {
    foe: {
      id: gid,
      name,
      sprite,
      level: 1,
      hp: f.hp,
      attack: f.attack,
      defence: f.defence,
      xp: f.xp ?? 1,
      coins: f.coins ?? 0,
      props: [...(f.props ?? [])],
      moves: [...f.moves],
      ai,
      scout,
      ...extra,
      ...(f.size && f.size !== 'normal' ? { size: f.size } : {}),
    },
  };
}

/** Turns a made item into normal game data. */
export function toItemDef(owner: string, it: CustomItem): ItemDef {
  const gid = globalId(owner, it.id);
  addStrings({ [`${gid}.name`]: it.name || 'Mystery item', [`${gid}.desc`]: it.desc || itemSummary(it) });
  const effect: ItemDef['effect'] =
    it.kind === 'heal'
      ? { heal: it.amount }
      : it.kind === 'grit'
        ? { grit: it.amount }
        : it.kind === 'damage'
          ? { damage: it.amount }
          : it.kind === 'revive'
            ? { revive: it.amount }
            : { attackUp: it.attackUp ?? 0, defenceUp: it.defenceUp ?? 0, turns: it.turns ?? 3 };
  const target =
    it.kind === 'damage'
      ? it.target === 'all'
        ? 'all'
        : 'single'
      : it.kind === 'heal' || it.kind === 'boost'
        ? it.target === 'ally'
          ? 'ally'
          : 'self'
        : 'self';
  return {
    id: gid,
    name: `${gid}.name`,
    desc: `${gid}.desc`,
    icon: '',
    category: it.kind === 'damage' ? 'damage' : it.kind === 'boost' ? 'buff' : 'heal',
    target,
    effect,
    price: Math.max(1, it.amount * 2),
  };
}

/** Turns a made move into normal game data, with steps the battle scene can play. */
export function toMoveDef(owner: string, m: CustomMove): MoveDef {
  const gid = globalId(owner, m.id);
  const name = `${gid}.name`;
  addStrings({ [name]: m.name || 'Mystery move', [`${name}.desc`]: m.desc || moveSummary(m) });
  const heal = m.kind === 'heal';
  // enemies don't run action commands; an attack on everyone is thrown from where you stand
  const command: CommandType = m.user === 'enemy' || heal ? 'none' : m.command;
  const approach = heal || m.target === 'all' ? 'stay' : command === 'stomp' ? 'jump' : m.approach;
  const steps: MoveStep[] = [];
  if (approach === 'run') steps.push({ do: 'walk_to_target' });
  if (approach === 'jump') steps.push({ do: 'jump_to_target' });
  if (heal) steps.push({ do: 'heal' });
  else {
    const hits = Math.max(1, Math.min(5, m.hits));
    for (let i = 0; i < hits; i++) {
      if (command === 'stomp' || (command !== 'none' && i === 0)) steps.push({ do: 'command' });
      if (approach !== 'jump' && i === 0) steps.push({ do: 'anim', anim: 'chop' });
      steps.push({ do: 'hit' });
    }
  }
  steps.push({ do: 'return' });
  const target = heal
    ? m.user === 'enemy'
      ? 'ally_lowest'
      : m.target === 'ally'
        ? 'ally'
        : 'self'
    : m.target === 'all' || m.target === 'front'
      ? m.target
      : 'single';
  const def: MoveDef = {
    id: gid,
    name,
    category: m.user === 'enemy' ? 'enemy' : approach === 'jump' ? 'aerial' : 'strike',
    gritCost: m.user === 'enemy' ? 0 : m.gritCost,
    power: heal ? 0 : m.power,
    target,
    command,
    reaches: { airborne: m.reachesAir || approach === 'jump', spiky: m.reachesSpiky },
    steps,
  };
  if (m.piercing && !heal) def.piercing = true;
  if (heal) def.heal = Math.max(1, m.power);
  if (m.user === 'enemy' && !heal && m.charge > 0) def.charge = Math.min(3, m.charge);
  return def;
}

const COMMAND_WORD: Record<CustomMove['command'], string> = {
  timed_press: 'press on time',
  hold_release: 'hold and let go',
  stomp: 'press on every landing',
  none: 'no command',
};

/** One line saying what a move does (its description when none is written). */
export function moveSummary(m: CustomMove): string {
  if (m.kind === 'heal')
    return m.user === 'enemy'
      ? `Heals the most hurt teammate ${m.power} HP.`
      : `Heals ${m.target === 'ally' ? 'a chosen ally' : 'the user'} ${m.power} HP.`;
  const who =
    m.target === 'all' ? 'every opponent' : m.target === 'front' ? 'the opponent in front' : 'one opponent';
  const hits = m.hits > 1 ? `${m.hits} hits of ${m.power}` : `power ${m.power}`;
  const extra = [
    m.piercing ? 'ignores defence' : '',
    m.user === 'enemy' && m.charge > 0 ? `winds up ${m.charge} turn${m.charge > 1 ? 's' : ''}` : '',
    m.user === 'hero' ? COMMAND_WORD[m.command] : '',
  ].filter(Boolean);
  return `Hits ${who}, ${hits}${extra.length ? ` (${extra.join(', ')})` : ''}.`;
}

/** A built-in move as maker data (for showing and copying). */
export function fromBuiltinMove(def: MoveDef, id: string): CustomMove {
  const hits = def.steps.filter((s) => s.do === 'hit').length;
  const approach = def.steps.some((s) => s.do === 'jump_to_target')
    ? 'jump'
    : def.steps.some((s) => s.do === 'walk_to_target')
      ? 'run'
      : 'stay';
  const command =
    (['timed_press', 'hold_release', 'stomp'] as const).find((c) => c === def.command) ?? 'none';
  return {
    id,
    name: t(def.name),
    desc: '',
    user: def.category === 'enemy' ? 'enemy' : 'hero',
    kind: def.heal ? 'heal' : 'attack',
    power: def.heal ?? def.power,
    hits: Math.max(1, hits),
    gritCost: def.gritCost,
    approach,
    target: def.heal
      ? 'ally'
      : def.target === 'all' || def.target === 'front'
        ? def.target
        : def.target === 'self'
          ? 'self'
          : 'single',
    command,
    reachesAir: def.reaches.airborne,
    reachesSpiky: def.reaches.spiky,
    piercing: !!def.piercing,
    charge: def.charge ?? 0,
  };
}

/** Keeps a move's settings consistent after a change (heals have no hits, enemies no commands…). */
export function tidyMove(m: CustomMove): void {
  if (m.kind === 'heal') {
    if (m.user === 'hero' && m.target !== 'self' && m.target !== 'ally') m.target = 'ally';
    m.power = Math.max(1, m.power);
  } else if (m.target === 'self' || m.target === 'ally') m.target = 'front';
  if (m.user === 'enemy') {
    m.command = 'none';
    m.gritCost = 0;
  } else m.charge = 0;
  if (m.user === 'hero' && m.kind === 'attack' && m.command === 'none') m.command = 'timed_press';
}

/** Default numbers for a new move. */
export function newMove(user: 'hero' | 'enemy', id: string): CustomMove {
  return {
    id,
    name: 'New Move',
    desc: '',
    user,
    kind: 'attack',
    power: 2,
    hits: 1,
    gritCost: user === 'hero' ? 1 : 0,
    approach: 'run',
    target: 'front',
    command: user === 'hero' ? 'timed_press' : 'none',
    reachesAir: false,
    reachesSpiky: true,
    piercing: false,
    charge: 0,
  };
}

/** One line saying what an item does (its description when none is written). */
export function itemSummary(it: CustomItem): string {
  const who = it.target === 'ally' ? 'Chispa or the partner' : 'the user';
  switch (it.kind) {
    case 'heal':
      return `Heals ${it.amount} HP for ${who}.`;
    case 'grit':
      return `Restores ${it.amount} Grit.`;
    case 'damage':
      return `Deals ${it.amount} damage to ${it.target === 'all' ? 'every opponent' : 'one opponent'}.`;
    case 'revive':
      return `Gets the hero back up with ${it.amount} HP when knocked out. Works by itself.`;
    case 'boost': {
      const up = [it.attackUp ? `attack +${it.attackUp}` : '', it.defenceUp ? `defence +${it.defenceUp}` : '']
        .filter(Boolean)
        .join(', ');
      return `${up || 'No boost'} for ${it.turns ?? 3} turns (${who}).`;
    }
  }
}

function register(owner: string, set: BuildSet): void {
  const chars: CharacterDef[] = [];
  const foes: EnemyDef[] = [];
  for (const f of set.fighters) {
    const d = toDefs(owner, f);
    if (d.char) chars.push(d.char);
    if (d.foe) foes.push(d.foe);
  }
  const things = (set.items ?? []).map((it) => toItemDef(owner, it));
  const moves = (set.moves ?? []).map((m) => toMoveDef(owner, m));
  Database.registerCustom(`c.${ownerTag(owner)}.`, chars, foes, things, moves);
}

/** Loads every set it can see (all of them, in the link) and adds the fighters to the game. */
export async function loadBuilds(timeoutMs = 4000): Promise<'shared' | 'local'> {
  db = await artifactDb(timeoutMs);
  uid = db ? await viewerId(timeoutMs) : null;
  sets.clear();
  if (db && uid) {
    try {
      const snap = await db.collection('builds').get();
      for (const d of snap.docs) {
        const json = d.data()?.json;
        if (typeof json === 'string') sets.set(d.id, JSON.parse(json));
      }
    } catch {
      db = null;
    }
  }
  if (!db || !uid) {
    db = null;
    uid = null;
    try {
      const local = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as BuildSet | null;
      if (local) sets.set('me', local);
    } catch {
      /* no storage */
    }
  }
  // everyone's moves first, so fighters can use moves from other people's sets
  for (const [owner, set] of sets)
    Database.registerCustom(
      `c.${ownerTag(owner)}.`,
      [],
      [],
      [],
      (set.moves ?? []).map((m) => toMoveDef(owner, m)),
    );
  for (const [owner, set] of sets) register(owner, set);
  return db ? 'shared' : 'local';
}

export const Builds = {
  backend: (): 'shared' | 'local' => (db ? 'shared' : 'local'),

  /** This person's own fighters (editable copies). */
  mine(): CustomFighter[] {
    return structuredClone(sets.get(myOwnerId())?.fighters ?? []);
  },

  /** Everyone else's fighters, with their owner, for browsing and copying. */
  others(): { owner: string; fighter: CustomFighter }[] {
    const out: { owner: string; fighter: CustomFighter }[] = [];
    for (const [owner, set] of sets)
      if (owner !== myOwnerId()) for (const f of set.fighters) out.push({ owner, fighter: f });
    return out;
  },

  /** This person's own encounters. */
  myEncounters(): Encounter[] {
    return structuredClone(sets.get(myOwnerId())?.encounters ?? []);
  },

  /** Everyone else's encounters, with their owner. */
  otherEncounters(): { owner: string; encounter: Encounter }[] {
    const out: { owner: string; encounter: Encounter }[] = [];
    for (const [owner, set] of sets)
      if (owner !== myOwnerId()) for (const e of set.encounters ?? []) out.push({ owner, encounter: e });
    return out;
  },

  /** This person's own items. */
  myItems(): CustomItem[] {
    return structuredClone(sets.get(myOwnerId())?.items ?? []);
  },

  /** Everyone else's items, with their owner. */
  otherItems(): { owner: string; item: CustomItem }[] {
    const out: { owner: string; item: CustomItem }[] = [];
    for (const [owner, set] of sets)
      if (owner !== myOwnerId()) for (const it of set.items ?? []) out.push({ owner, item: it });
    return out;
  },

  /** This person's own moves. */
  myMoves(): CustomMove[] {
    return structuredClone(sets.get(myOwnerId())?.moves ?? []);
  },

  /** Everyone else's moves, with their owner. */
  otherMoves(): { owner: string; move: CustomMove }[] {
    const out: { owner: string; move: CustomMove }[] = [];
    for (const [owner, set] of sets)
      if (owner !== myOwnerId()) for (const m of set.moves ?? []) out.push({ owner, move: m });
    return out;
  },

  /** Everyone's sets, by owner (for the gallery). */
  allSets(): { owner: string; set: BuildSet }[] {
    return [...sets].map(([owner, set]) => ({ owner, set: structuredClone(set) }));
  },

  /** Saves this person's set (any of fighters, encounters, items, moves) and refreshes the game data. */
  async saveMine(update: {
    fighters?: CustomFighter[];
    encounters?: Encounter[];
    items?: CustomItem[];
    moves?: CustomMove[];
  }): Promise<void> {
    const cur = sets.get(myOwnerId());
    const set: BuildSet = {
      fighters: structuredClone(update.fighters ?? cur?.fighters ?? []),
      encounters: structuredClone(update.encounters ?? cur?.encounters ?? []),
      items: structuredClone(update.items ?? cur?.items ?? []),
      moves: structuredClone(update.moves ?? cur?.moves ?? []),
      savedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(set);
    if (json.length > MAX_SET_CHARS)
      throw new Error(
        `too big to save (${Math.round(json.length / 1024)} KB of ${Math.round(MAX_SET_CHARS / 1024)}): use fewer or smaller pictures`,
      );
    if (db && uid) await db.doc(`builds/${uid}`).set({ json, savedAt: set.savedAt! });
    else
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(set));
      } catch {
        /* lasts for this visit */
      }
    sets.set(myOwnerId(), set);
    register(myOwnerId(), set);
    await afterChange?.();
  },

  /** Runs after every save (the game uses it to draw new pictures). */
  onChange(fn: () => Promise<void> | void): void {
    afterChange = fn;
  },

  /** How big this person's set is when saved, and the most it may be. */
  sizeOf(update: { fighters?: CustomFighter[] }): { chars: number; max: number } {
    const cur = sets.get(myOwnerId());
    const set = { ...(cur ?? { fighters: [] }), ...update };
    return { chars: JSON.stringify(set).length, max: MAX_SET_CHARS };
  },

  /**
   * Copies someone's creation into your own set (a remix you can change) and
   * saves. Returns the copy's local id. Fighters keep the moves they know,
   * wherever those came from.
   */
  async copyIn(
    kind: CreationKind,
    thing: CustomFighter | CustomMove | CustomItem | Encounter,
  ): Promise<string> {
    const cur = sets.get(myOwnerId());
    const next = (prefix: string, used: { id: string }[]) => {
      const ids = new Set(used.map((x) => x.id));
      for (let n = 1; ; n++) if (!ids.has(`${prefix}${n}`)) return `${prefix}${n}`;
    };
    if (kind === 'fighter') {
      const list = structuredClone(cur?.fighters ?? []);
      const id = next('f', list);
      list.push({ ...structuredClone(thing as CustomFighter), id });
      await Builds.saveMine({ fighters: list });
      return id;
    }
    if (kind === 'move') {
      const list = structuredClone(cur?.moves ?? []);
      const id = next('m', list);
      list.push({ ...structuredClone(thing as CustomMove), id });
      await Builds.saveMine({ moves: list });
      return id;
    }
    if (kind === 'item') {
      const list = structuredClone(cur?.items ?? []);
      const id = next('i', list);
      list.push({ ...structuredClone(thing as CustomItem), id });
      await Builds.saveMine({ items: list });
      return id;
    }
    const list = structuredClone(cur?.encounters ?? []);
    const id = next('b', list);
    list.push({ ...structuredClone(thing as Encounter), id, savedAt: new Date().toISOString() });
    await Builds.saveMine({ encounters: list });
    return id;
  },

  /** A made fighter's look and texture key (for drawing it). */
  lookOf(gid: string): { look: FighterLook; key: string; size: FighterSize } | null {
    const look = looks.get(gid);
    return look ? { look, key: textureFor(gid, look), size: sizes.get(gid) ?? 'normal' } : null;
  },
};

/** Default stats for a new fighter. */
export function newFighter(kind: 'hero' | 'enemy', id: string): CustomFighter {
  if (kind === 'hero')
    return {
      id,
      kind,
      name: 'New Hero',
      look: { base: 'wrestler', colors: { shirt: 0x5fd068, trunks: 0x1d2a4a, mask: 0xf4ead2 } },
      hp: 10,
      grit: 5,
      attack: 1,
      defence: 0,
      moves: ['chop', 'elbow_drop'],
    };
  return {
    id,
    kind,
    name: 'New Rival',
    look: { base: 'wrestler', colors: { shirt: 0x8f1f33, trunks: 0x1b1622, mask: 0x1b1622 } },
    hp: 6,
    attack: 1,
    defence: 0,
    moves: ['goon_shove'],
    props: [],
    xp: 2,
    coins: 2,
    weights: { goon_shove: 1 },
  };
}

export interface Creation {
  kind: CreationKind;
  owner: string;
  /** Id within its maker's set. */
  id: string;
  /** What likes point at. */
  key: string;
  name: string;
  thing: CustomFighter | CustomMove | CustomItem | Encounter;
}

/** Everything everyone has made, of one kind. */
export function creations(kind: CreationKind): Creation[] {
  const out: Creation[] = [];
  for (const { owner, set } of Builds.allSets()) {
    const list: { id: string; name?: string; title?: string }[] =
      kind === 'fighter'
        ? set.fighters
        : kind === 'move'
          ? (set.moves ?? [])
          : kind === 'item'
            ? (set.items ?? [])
            : (set.encounters ?? []);
    for (const x of list)
      out.push({
        kind,
        owner,
        id: x.id,
        key: `${kind}:${encounterKey(owner, x.id)}`,
        name: x.name ?? x.title ?? x.id,
        thing: x as Creation['thing'],
      });
  }
  return out;
}
