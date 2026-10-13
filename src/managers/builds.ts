// Fighters made in the fighter maker: heroes and enemies with their own name,
// look, stats, moves and (for enemies) traits, rewards and attack pattern.
//
// Storage: each person's fighters are one document, builds/<their id>, in the
// game link's database. Everyone who opens the link reads everyone's (the
// community), only the owner can change theirs. Outside the link they live in
// this browser. At start-up every fighter found is turned into normal game data
// (CharacterDef / EnemyDef) so battles, the sandbox and the simulator use them
// like built-in ones.

import type { AiRule, CharacterDef, EnemyDef, EnemyProp, ItemDef } from '../types/data';
import { Database } from './database';
import { addStrings } from './strings';
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

export interface FighterLook {
  /** 'wrestler' = the animated wrestler body in custom colours, or an existing sprite key. */
  base: string;
  colors?: Partial<Record<ColorSlot, number>>;
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
  scout?: string;
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

export interface BuildSet {
  fighters: CustomFighter[];
  encounters?: Encounter[];
  items?: CustomItem[];
  savedAt?: string;
}

const LOCAL_KEY = 'kid-chispa.builds';
let db: DbLike | null = null;
let uid: string | null = null;
/** Everyone's sets, by owner id ('me' outside the link). */
const sets = new Map<string, BuildSet>();
const looks = new Map<string, FighterLook>();

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
  return look.base === 'wrestler' ? `spr_custom_${gid.replace(/\./g, '_')}` : look.base;
}

/** Turns a maker's fighter into normal game data. */
export function toDefs(owner: string, f: CustomFighter): { char?: CharacterDef; foe?: EnemyDef } {
  const gid = globalId(owner, f.id);
  const name = `${gid}.name`;
  addStrings({ [name]: f.name || 'Nameless' });
  const sprite = textureFor(gid, f.look);
  if (f.look.base === 'wrestler') registerSpriteKey(sprite);
  looks.set(gid, f.look);
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
  Database.registerCustom(`c.${ownerTag(owner)}.`, chars, foes, things);
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

  /** Saves this person's set (any of fighters, encounters, items) and refreshes the game data. */
  async saveMine(update: {
    fighters?: CustomFighter[];
    encounters?: Encounter[];
    items?: CustomItem[];
  }): Promise<void> {
    const cur = sets.get(myOwnerId());
    const set: BuildSet = {
      fighters: structuredClone(update.fighters ?? cur?.fighters ?? []),
      encounters: structuredClone(update.encounters ?? cur?.encounters ?? []),
      items: structuredClone(update.items ?? cur?.items ?? []),
      savedAt: new Date().toISOString(),
    };
    if (db && uid) await db.doc(`builds/${uid}`).set({ json: JSON.stringify(set), savedAt: set.savedAt! });
    else
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(set));
      } catch {
        /* lasts for this visit */
      }
    sets.set(myOwnerId(), set);
    register(myOwnerId(), set);
  },

  /** A made fighter's look and texture key (for drawing it). */
  lookOf(gid: string): { look: FighterLook; key: string } | null {
    const look = looks.get(gid);
    return look ? { look, key: textureFor(gid, look) } : null;
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
