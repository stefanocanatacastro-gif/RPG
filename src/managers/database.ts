// Database: loads every game-data JSON file, checks it at startup and gives
// lookups by id. Validation is a pure function so tests can feed it broken data.

import type {
  CharacterDef,
  EnemyDef,
  FormationDef,
  GameData,
  ItemDef,
  MoveDef,
  MoveStep,
  TargetRule,
} from '../types/data';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import moves from '../data/moves.json';
import items from '../data/items.json';
import formations from '../data/formations.json';

export interface Problem {
  file: string;
  id: string;
  message: string;
}

export interface ValidationContext {
  /** Sprite/texture keys declared in the asset packs. */
  spriteKeys?: Set<string>;
  /** String-table keys available in English. */
  stringKeys?: Set<string>;
}

const TARGETS: TargetRule[] = ['single', 'all', 'all_ground', 'front', 'self', 'partner'];
const CATEGORIES = ['strike', 'aerial', 'grapple', 'enemy', 'partner'];
const COMMANDS = ['none', 'stomp', 'timed_press', 'hold_release', 'mash', 'rotate', 'sequence', 'ring'];
const STEPS = ['walk_to_target', 'jump_to_target', 'anim', 'command', 'hit', 'return', 'wait'];
const PROPS = ['spiky', 'airborne', 'armoured', 'flips', 'fiery'];
const ITEM_CATS = ['heal', 'damage', 'buff', 'key'];
const SLOTS = ['front', 'back', 'air'];

export function validateGameData(data: GameData, ctx: ValidationContext = {}): Problem[] {
  const problems: Problem[] = [];
  const add = (file: string, id: string, message: string) => problems.push({ file, id, message });

  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const checkIds = (file: string, list: { id: string }[]) => {
    const seen = new Set<string>();
    list.forEach((e, i) => {
      if (typeof e.id !== 'string' || !e.id) add(file, `#${i}`, 'missing id');
      else if (seen.has(e.id)) add(file, e.id, 'duplicate id');
      seen.add(e.id);
    });
    return seen;
  };
  const checkString = (file: string, id: string, field: string, key: unknown) => {
    if (typeof key !== 'string' || !key) add(file, id, `${field} is missing`);
    else if (ctx.stringKeys && !ctx.stringKeys.has(key))
      add(file, id, `${field} "${key}" has no English text`);
  };
  const checkSprite = (file: string, id: string, key: unknown) => {
    if (typeof key !== 'string' || !key) add(file, id, 'sprite is missing');
    else if (ctx.spriteKeys && !ctx.spriteKeys.has(key))
      add(file, id, `sprite "${key}" is not in any asset pack`);
  };
  const checkStats = (file: string, id: string, obj: Record<string, unknown>, fields: string[]) => {
    for (const f of fields) {
      if (!isNum(obj[f])) add(file, id, `${f} must be a number`);
      else if ((obj[f] as number) < 0) add(file, id, `${f} can't be negative`);
    }
  };

  const moveIds = checkIds('moves', data.moves);
  const enemyIds = checkIds('enemies', data.enemies);
  checkIds('characters', data.characters);
  checkIds('items', data.items);
  checkIds('formations', data.formations);

  const checkMoveRefs = (file: string, id: string, list: unknown) => {
    if (!Array.isArray(list)) return add(file, id, 'moves must be a list');
    for (const m of list) if (!moveIds.has(m)) add(file, id, `unknown move "${m}"`);
  };

  for (const m of data.moves as MoveDef[]) {
    checkString('moves', m.id, 'name', m.name);
    if (!CATEGORIES.includes(m.category)) add('moves', m.id, `unknown category "${m.category}"`);
    if (!TARGETS.includes(m.target)) add('moves', m.id, `unknown target "${m.target}"`);
    if (!COMMANDS.includes(m.command)) add('moves', m.id, `unknown command "${m.command}"`);
    checkStats('moves', m.id, m as unknown as Record<string, unknown>, ['gritCost', 'power']);
    if (!m.reaches || typeof m.reaches.airborne !== 'boolean' || typeof m.reaches.spiky !== 'boolean')
      add('moves', m.id, 'reaches needs airborne and spiky (true/false)');
    if (!Array.isArray(m.steps) || m.steps.length === 0) add('moves', m.id, 'needs at least one step');
    else {
      (m.steps as MoveStep[]).forEach((s, i) => {
        if (!STEPS.includes(s.do)) add('moves', m.id, `step ${i + 1}: unknown action "${s.do}"`);
        if (s.do === 'anim' && !s.anim) add('moves', m.id, `step ${i + 1}: anim needs a name`);
      });
      const hasHit = m.steps.some((s) => s.do === 'hit');
      if (!hasHit) add('moves', m.id, 'never hits (no "hit" step)');
      const hasCmd = m.steps.some((s) => s.do === 'command');
      if (m.command !== 'none' && !hasCmd) add('moves', m.id, 'has an action command but no "command" step');
      if (m.command === 'none' && hasCmd) add('moves', m.id, 'has a "command" step but command is "none"');
    }
  }

  for (const c of data.characters as CharacterDef[]) {
    checkString('characters', c.id, 'name', c.name);
    checkSprite('characters', c.id, c.sprite);
    checkStats('characters', c.id, c as unknown as Record<string, unknown>, [
      'hp',
      'grit',
      'attack',
      'defence',
    ]);
    if (isNum(c.hp) && c.hp < 1) add('characters', c.id, 'hp must be at least 1');
    checkMoveRefs('characters', c.id, c.moves);
  }

  for (const e of data.enemies as EnemyDef[]) {
    checkString('enemies', e.id, 'name', e.name);
    checkString('enemies', e.id, 'scout', e.scout);
    checkSprite('enemies', e.id, e.sprite);
    checkStats('enemies', e.id, e as unknown as Record<string, unknown>, [
      'level',
      'hp',
      'attack',
      'defence',
      'xp',
      'coins',
    ]);
    if (isNum(e.hp) && e.hp < 1) add('enemies', e.id, 'hp must be at least 1');
    for (const p of e.props ?? []) if (!PROPS.includes(p)) add('enemies', e.id, `unknown property "${p}"`);
    checkMoveRefs('enemies', e.id, e.moves);
    if (!Array.isArray(e.ai) || e.ai.length === 0) add('enemies', e.id, 'needs at least one AI rule');
    else
      for (const r of e.ai) {
        if (!e.moves?.includes(r.move))
          add('enemies', e.id, `AI uses "${r.move}", which isn't in its move list`);
        if (!isNum(r.weight) || r.weight <= 0)
          add('enemies', e.id, `AI weight for "${r.move}" must be above 0`);
      }
  }

  for (const it of data.items as ItemDef[]) {
    checkString('items', it.id, 'name', it.name);
    checkString('items', it.id, 'desc', it.desc);
    if (!ITEM_CATS.includes(it.category)) add('items', it.id, `unknown category "${it.category}"`);
    if (!TARGETS.includes(it.target)) add('items', it.id, `unknown target "${it.target}"`);
    checkStats('items', it.id, it as unknown as Record<string, unknown>, ['price']);
    if (!it.effect || Object.keys(it.effect).length === 0) add('items', it.id, 'has no effect');
  }

  for (const f of data.formations as FormationDef[]) {
    if (!Array.isArray(f.enemies) || f.enemies.length === 0) add('formations', f.id, 'has no enemies');
    else if (f.enemies.length > 5) add('formations', f.id, 'has more than 5 enemies');
    else
      for (const s of f.enemies) {
        if (!enemyIds.has(s.enemy)) add('formations', f.id, `unknown enemy "${s.enemy}"`);
        if (!SLOTS.includes(s.slot)) add('formations', f.id, `unknown slot "${s.slot}"`);
      }
    if (!f.stage) add('formations', f.id, 'stage is missing');
  }

  return problems;
}

// ── Runtime database ────────────────────────────────────────────────────

const DATA: GameData = {
  characters: characters as CharacterDef[],
  enemies: enemies as EnemyDef[],
  moves: moves as MoveDef[],
  items: items as ItemDef[],
  formations: formations as FormationDef[],
};

function index<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((e) => [e.id, e]));
}

const maps = {
  characters: index(DATA.characters),
  enemies: index(DATA.enemies),
  moves: index(DATA.moves),
  items: index(DATA.items),
  formations: index(DATA.formations),
};

let lastProblems: Problem[] = [];

function lookup<T>(map: Map<string, T>, kind: string, id: string): T {
  const v = map.get(id);
  if (!v) throw new Error(`Unknown ${kind} "${id}"`);
  return v;
}

export const Database = {
  data: DATA,
  validate(ctx: ValidationContext): Problem[] {
    lastProblems = validateGameData(DATA, ctx);
    for (const p of lastProblems) console.warn(`[data] ${p.file}.json · ${p.id}: ${p.message}`);
    return lastProblems;
  },
  problems: () => lastProblems,
  character: (id: string) => lookup(maps.characters, 'character', id),
  enemy: (id: string) => lookup(maps.enemies, 'enemy', id),
  move: (id: string) => lookup(maps.moves, 'move', id),
  item: (id: string) => lookup(maps.items, 'item', id),
  formation: (id: string) => lookup(maps.formations, 'formation', id),
  counts: () => ({
    characters: DATA.characters.length,
    enemies: DATA.enemies.length,
    moves: DATA.moves.length,
    items: DATA.items.length,
    formations: DATA.formations.length,
  }),
};
