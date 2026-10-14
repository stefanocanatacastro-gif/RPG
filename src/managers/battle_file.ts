// Battle files: a battle packed into one .json file you can send to anyone,
// with everything it needs to be played elsewhere: the made fighters in it
// (with their pictures and sprite sheets), the moves they know, the items in
// the bag. Importing adds them to your own set under new ids and the battle
// to YOURS, ready to fight. Built-in fighters, moves and items travel by id.

import { Database } from './database';
import {
  Builds,
  globalId,
  isCustomId,
  myOwnerId,
  type CustomFighter,
  type CustomItem,
  type CustomMove,
  type Encounter,
  type FighterLook,
} from './builds';
import { setupHash, setupProblems, type BattleSetup } from './battle_setup';
import { storeImage } from './artifact_db';

export const FILE_FORMAT = 'kid-chispa-battle';
export const FILE_VERSION = 1;
/** Battle files end in this (an allowed download type everywhere). */
export const FILE_SUFFIX = '.chispa.json';

export interface BattleFile {
  format: typeof FILE_FORMAT;
  version: number;
  exportedAt: string;
  /** Who made it (as they wish to be credited). */
  maker: string;
  /** Whether its maker beat it as it is. */
  cleared: boolean;
  battle: { title: string; desc: string; setup: BattleSetup };
  /** Made things, by the id the setup (and each other) use in this file. */
  fighters: { id: string; fighter: CustomFighter }[];
  moves: { id: string; move: CustomMove }[];
  items: { id: string; item: CustomItem }[];
}

// ── Exporting ───────────────────────────────────────────────────────────

/** Every move id a made fighter uses, anywhere. */
function movesOf(f: CustomFighter): string[] {
  return [
    ...f.moves,
    ...Object.keys(f.weights ?? {}),
    ...(f.lowHpMove ? [f.lowHpMove] : []),
    ...(f.rules ?? []).map((r) => r.move),
    ...(f.phase2?.moves ?? []),
  ];
}

/** An image stored with the game link, read back as a data URL so the file carries it. */
async function inline(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read a picture for the file.'));
    r.readAsDataURL(blob);
  });
}

async function inlineLook(look: FighterLook): Promise<FighterLook> {
  const out = structuredClone(look);
  if (out.pictures)
    for (const k of Object.keys(out.pictures) as (keyof typeof out.pictures)[])
      if (out.pictures[k]) out.pictures[k] = await inline(out.pictures[k]!);
  if (out.sheet) out.sheet.url = await inline(out.sheet.url);
  return out;
}

/** Packs a battle and everything made it needs into a file. */
export async function packBattle(
  battle: { title: string; desc?: string; setup: BattleSetup },
  maker: string,
  cleared: boolean,
): Promise<BattleFile> {
  const s = battle.setup;
  const file: BattleFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    maker,
    cleared,
    battle: { title: battle.title, desc: battle.desc ?? '', setup: structuredClone(s) },
    fighters: [],
    moves: [],
    items: [],
  };
  const want = new Set<string>();
  for (const id of [s.hero, s.partner, ...s.enemies.map((e) => e.id), ...(s.items ?? [])])
    if (id && isCustomId(id)) want.add(id);
  const seen = new Set<string>();
  // fighters bring their moves along
  while (want.size) {
    const id = want.values().next().value!;
    want.delete(id);
    if (seen.has(id)) continue;
    seen.add(id);
    const found = Builds.findMade(id);
    if (!found) throw new Error(`Something in this battle no longer exists (${id}).`);
    if (found.kind === 'fighter') {
      file.fighters.push({ id, fighter: { ...found.thing, look: await inlineLook(found.thing.look) } });
      for (const m of movesOf(found.thing)) if (isCustomId(m) && !seen.has(m)) want.add(m);
    } else if (found.kind === 'move') file.moves.push({ id, move: found.thing });
    else file.items.push({ id, item: found.thing });
  }
  return file;
}

/** A file name from the battle's title. */
export function fileNameFor(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'battle';
  return `${base}${FILE_SUFFIX}`;
}

// ── Importing ───────────────────────────────────────────────────────────

const isStr = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max;
const isImage = (v: unknown): v is string =>
  typeof v === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v);

/** Reads a battle file, or says what's wrong with it. */
export function readBattleFile(text: string): BattleFile {
  let f: BattleFile;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a battle file (it can't be read).");
  }
  if (!f || f.format !== FILE_FORMAT) throw new Error("That file isn't a Kid Chispa battle file.");
  if (typeof f.version !== 'number' || f.version > FILE_VERSION)
    throw new Error('That battle was made with a newer version of the game: update to play it.');
  const b = f.battle;
  if (!b || !isStr(b.title, 64) || !b.setup || !Array.isArray(b.setup.enemies))
    throw new Error('That battle file is damaged (no battle in it).');
  for (const list of [f.fighters, f.moves, f.items])
    if (!Array.isArray(list)) throw new Error('That battle file is damaged.');
  // pictures must be pictures carried in the file: nothing is fetched from elsewhere
  for (const { fighter } of f.fighters) {
    const l = fighter?.look;
    if (!l || !isStr(fighter.name, 64)) throw new Error('That battle file has a damaged fighter.');
    for (const u of Object.values(l.pictures ?? {}))
      if (u && !isImage(u)) throw new Error('That battle file has a damaged picture.');
    if (l.sheet && !isImage(l.sheet.url)) throw new Error('That battle file has a damaged sprite sheet.');
  }
  return f;
}

/** A fingerprint of the file's battle, so importing the same one twice adds it once. */
function fileKey(f: BattleFile): string {
  return setupHash({ ...f.battle.setup, title: f.battle.title, maker: f.maker } as unknown as BattleSetup);
}

/** Pictures from a file go to the game link's file storage when it has one (keeps your set small). */
async function storeLook(look: FighterLook): Promise<FighterLook> {
  const out = structuredClone(look);
  const keep = async (u: string) => {
    const blob = await (await fetch(u)).blob();
    return (await storeImage(blob)) ?? u;
  };
  if (out.pictures)
    for (const k of Object.keys(out.pictures) as (keyof typeof out.pictures)[])
      if (out.pictures[k]) out.pictures[k] = await keep(out.pictures[k]!);
  if (out.sheet) out.sheet.url = await keep(out.sheet.url);
  return out;
}

/**
 * Adds a battle file's fighters, moves and items to your set under new ids, and
 * the battle to YOURS. Returns the battle's id there (the existing one when the
 * same battle was imported before).
 */
export async function importBattle(f: BattleFile): Promise<{ id: string; again: boolean }> {
  const missing = missingBuiltIns(f);
  if (missing.length)
    throw new Error(
      `That battle needs things this version of the game doesn't have (${missing.join(', ')}): update to play it.`,
    );
  const key = fileKey(f);
  const set = Builds.mySet();
  const encounters = set.encounters ?? [];
  const before = encounters.find((e) => e.imported?.key === key);
  if (before) return { id: before.id, again: true };
  const fighters = set.fighters;
  const moves = set.moves ?? [];
  const items = set.items ?? [];
  const me = myOwnerId();
  const nextId = (prefix: string, used: { id: string }[]) => {
    const ids = new Set(used.map((x) => x.id));
    let n = 1;
    while (ids.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  // file ids → ids in your set
  const map = new Map<string, string>();
  const to = (id: string) => map.get(id) ?? id;
  for (const { id, move } of f.moves) {
    const local = nextId('m', moves);
    moves.push({ ...move, id: local });
    map.set(id, globalId(me, local));
  }
  for (const { id, item } of f.items) {
    const local = nextId('i', items);
    items.push({ ...item, id: local });
    map.set(id, globalId(me, local));
  }
  for (const { id } of f.fighters) {
    const local = nextId('f', fighters);
    fighters.push({ id: local } as CustomFighter); // reserve the id
    map.set(id, globalId(me, local));
  }
  for (const { id, fighter } of f.fighters) {
    const local = to(id).split('.').pop()!;
    const fx: CustomFighter = {
      ...fighter,
      id: local,
      look: await storeLook(fighter.look),
      moves: fighter.moves.map(to),
      ...(fighter.weights
        ? { weights: Object.fromEntries(Object.entries(fighter.weights).map(([m, w]) => [to(m), w])) }
        : {}),
      ...(fighter.lowHpMove ? { lowHpMove: to(fighter.lowHpMove) } : {}),
      ...(fighter.rules ? { rules: fighter.rules.map((r) => ({ ...r, move: to(r.move) })) } : {}),
      ...(fighter.phase2 ? { phase2: { ...fighter.phase2, moves: fighter.phase2.moves.map(to) } } : {}),
    };
    fighters[fighters.findIndex((x) => x.id === local)] = fx;
  }
  const s = structuredClone(f.battle.setup);
  s.hero = to(s.hero);
  if (s.partner) s.partner = to(s.partner);
  s.enemies = s.enemies.map((e) => ({ ...e, id: to(e.id) }));
  s.items = (s.items ?? []).map(to);
  const enc: Encounter = {
    id: nextId('b', encounters),
    title: f.battle.title.slice(0, 32),
    setup: s,
    savedAt: new Date().toISOString(),
    ...(f.battle.desc ? { desc: f.battle.desc.slice(0, 140) } : {}),
    imported: {
      maker: (f.maker || 'Someone').slice(0, 32),
      key,
      cleared: !!f.cleared,
      at: new Date().toISOString(),
    },
  };
  encounters.push(enc);
  await Builds.saveMine({ fighters, moves, items, encounters });
  // a built-in fighter, move or item this version doesn't have
  const problems = setupProblems(s);
  if (problems.length) throw new Error(`Imported, but it can't be played here: ${problems[0]}.`);
  return { id: enc.id, again: false };
}

/** What a file holds, in a line (before importing it). */
export function describeFile(f: BattleFile): string {
  const made = [
    f.fighters.length ? `${f.fighters.length} made fighter${f.fighters.length === 1 ? '' : 's'}` : '',
    f.moves.length ? `${f.moves.length} move${f.moves.length === 1 ? '' : 's'}` : '',
    f.items.length ? `${f.items.length} item${f.items.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const foes = f.battle.setup.enemies.length;
  return `"${f.battle.title}" by ${f.maker} · ${foes} opponent${foes === 1 ? '' : 's'}${made.length ? ` · with ${made.join(', ')}` : ''}`;
}

/** Whether every built-in thing a file uses exists in this version (made ones travel inside it). */
export function missingBuiltIns(f: BattleFile): string[] {
  const s = f.battle.setup;
  const out: string[] = [];
  const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id);
  for (const id of [s.hero, s.partner].filter((x): x is string => !!x && !isCustomId(x)))
    if (!has(Database.data.characters, id)) out.push(id);
  for (const e of s.enemies) if (!isCustomId(e.id) && !has(Database.data.enemies, e.id)) out.push(e.id);
  for (const i of s.items ?? []) if (!isCustomId(i) && !has(Database.data.items, i)) out.push(i);
  if (!has(Database.data.stages, s.stage)) out.push(s.stage);
  return out;
}
