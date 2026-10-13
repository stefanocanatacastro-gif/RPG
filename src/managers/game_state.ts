// GameState: the one place that holds the player's progress. Everything that
// would go into a save file lives here and nowhere else, and every change goes
// through a method so the EventBus hears about it.

import type { CharacterDef } from '../types/data';
import rules from '../data/rules.json';
import { addXp as addXpRule } from '../battle/progression';
import { bus as defaultBus, EventBus, type FlagValue, type GameEvents } from './event_bus';

/** Bump when SaveData changes shape, and add a step to MIGRATIONS that upgrades the previous version. */
export const SAVE_VERSION = 1;

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;
/** MIGRATIONS[n] upgrades a version-n save to version n + 1. */
export const MIGRATIONS: Record<number, Migration> = {};

/**
 * Brings a save from any older version up to the current one, one step at a
 * time, so saves made with earlier builds keep working. A save from a newer
 * build than this one can't be read.
 */
export function migrateSave(
  raw: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SAVE_VERSION,
): SaveData {
  let s = structuredClone(raw);
  let v = typeof s.version === 'number' ? s.version : 0;
  if (v > target) throw new Error(`This save is from a newer version of the game (save format ${v})`);
  while (v < target) {
    const step = migrations[v];
    if (!step) throw new Error(`No way to upgrade a save from format ${v}`);
    s = step(s);
    v++;
    s.version = v;
  }
  return s as unknown as SaveData;
}
export const ITEM_CAP = 10;

export type Facing = 'left' | 'right' | 'up' | 'down';

export interface PartyMember {
  id: string;
  hp: number;
  maxHp: number;
}

export interface SaveData {
  version: number;
  party: PartyMember[];
  /** Partner currently out (null before Pip joins). */
  activePartner: string | null;
  grit: number;
  maxGrit: number;
  pp: number;
  level: number;
  xp: number;
  coins: number;
  fanTokens: number;
  items: string[];
  keyItems: string[];
  patches: string[];
  equippedPatches: string[];
  belts: string[];
  flags: Record<string, FlagValue>;
  room: string;
  pos: { x: number; y: number };
  facing: Facing;
  playTimeMs: number;
}

export function freshSave(hero: CharacterDef): SaveData {
  return {
    version: SAVE_VERSION,
    party: [{ id: hero.id, hp: hero.hp, maxHp: hero.hp }],
    activePartner: null,
    grit: hero.grit,
    maxGrit: hero.grit,
    pp: 3,
    level: 1,
    xp: 0,
    coins: 0,
    fanTokens: 0,
    items: [],
    keyItems: [],
    patches: [],
    equippedPatches: [],
    belts: [],
    flags: {},
    room: rules.newGame.room,
    pos: { x: 0, y: 0 },
    facing: 'right',
    playTimeMs: 0,
  };
}

export class GameState {
  private d: SaveData;

  constructor(
    initial: SaveData,
    private bus: EventBus<GameEvents> = defaultBus,
  ) {
    this.d = structuredClone(initial);
  }

  /** Read-only view of everything (for HUDs, save screens, crash reports). */
  get data(): Readonly<SaveData> {
    return this.d;
  }

  // ── Party, HP and Grit ──────────────────────────────────────────────
  member(id: string): PartyMember {
    const m = this.d.party.find((p) => p.id === id);
    if (!m) throw new Error(`"${id}" is not in the party`);
    return m;
  }

  hero(): PartyMember {
    return this.d.party[0];
  }

  /** The partner currently out with Chispa, or null (before Pip joins). */
  partner(): PartyMember | null {
    return this.d.activePartner ? this.member(this.d.activePartner) : null;
  }

  /** A partner joins (or comes back out). Joining for the first time starts at full HP. */
  addPartner(def: CharacterDef): void {
    if (!this.d.party.some((m) => m.id === def.id))
      this.d.party.push({ id: def.id, hp: def.hp, maxHp: def.hp });
    this.d.activePartner = def.id;
    this.bus.emit('party.changed', { partner: def.id });
  }

  /** Sends the partner away (debug and story scenes). */
  dismissPartner(): void {
    this.d.activePartner = null;
    this.bus.emit('party.changed', { partner: null });
  }

  setHp(id: string, hp: number): void {
    const m = this.member(id);
    m.hp = Math.max(0, Math.min(m.maxHp, Math.round(hp)));
    this.bus.emit('hp.changed', { who: id, hp: m.hp, maxHp: m.maxHp });
  }

  heal(id: string, amount: number): void {
    this.setHp(id, this.member(id).hp + amount);
  }

  setGrit(grit: number): void {
    this.d.grit = Math.max(0, Math.min(this.d.maxGrit, Math.round(grit)));
    this.bus.emit('grit.changed', { grit: this.d.grit, maxGrit: this.d.maxGrit });
  }

  /** Spends Grit if there is enough; returns false (and spends nothing) otherwise. */
  spendGrit(cost: number): boolean {
    if (cost > this.d.grit) return false;
    this.setGrit(this.d.grit - cost);
    return true;
  }

  /** Adds XP and levels up as far as it reaches. A level-up restores HP and Grit. Returns levels gained. */
  addXp(amount: number): number {
    const r = addXpRule(this.d.level, this.d.xp, amount);
    this.d.level = r.level;
    this.d.xp = r.xp;
    if (r.levelsGained > 0) {
      for (const m of this.d.party) this.setHp(m.id, m.maxHp);
      this.setGrit(this.d.maxGrit);
    }
    return r.levelsGained;
  }

  // ── Coins and items ────────────────────────────────────────────────
  addCoins(delta: number): void {
    const before = this.d.coins;
    this.d.coins = Math.max(0, Math.min(999, before + Math.round(delta)));
    this.bus.emit('coins.changed', { coins: this.d.coins, delta: this.d.coins - before });
  }

  /** Adds an item if there's room (TTYD-style 10 slots). Returns false when full. */
  addItem(id: string): boolean {
    if (this.d.items.length >= ITEM_CAP) {
      this.bus.emit('item.full', { id });
      return false;
    }
    this.d.items.push(id);
    this.bus.emit('item.added', { id, count: this.d.items.length });
    return true;
  }

  /** Removes the item at a slot (or the first of that id). Returns the id removed. */
  takeItem(idOrSlot: string | number): string | null {
    const i = typeof idOrSlot === 'number' ? idOrSlot : this.d.items.indexOf(idOrSlot);
    if (i < 0 || i >= this.d.items.length) return null;
    return this.d.items.splice(i, 1)[0];
  }

  hasItem(id: string): boolean {
    return this.d.items.includes(id) || this.d.keyItems.includes(id);
  }

  // ── Story flags ────────────────────────────────────────────────────
  setFlag(key: string, value: FlagValue = true): void {
    this.d.flags[key] = value;
    this.bus.emit('flag.set', { key, value });
  }

  flag(key: string): FlagValue | undefined {
    return this.d.flags[key];
  }

  isSet(key: string): boolean {
    return Boolean(this.d.flags[key]);
  }

  // ── Location ───────────────────────────────────────────────────────
  setLocation(room: string, x: number, y: number, facing: Facing): void {
    this.d.room = room;
    // world units (x across, y = depth), kept to two decimals
    this.d.pos = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    this.d.facing = facing;
  }

  addPlayTime(ms: number): void {
    this.d.playTimeMs += ms;
  }

  // ── Snapshots (saves, and restoring after a lost battle) ───────────
  snapshot(): SaveData {
    return structuredClone(this.d);
  }

  restore(save: SaveData): void {
    this.d = migrateSave(save as unknown as Record<string, unknown>);
  }
}

let current: GameState | null = null;

/** The running game's state. Created by newGame() on the title screen. */
export function gameState(): GameState {
  if (!current) throw new Error('No game in progress: call newGame() first');
  return current;
}

export function newGame(hero: CharacterDef): GameState {
  current = new GameState(freshSave(hero));
  return current;
}

export function hasGame(): boolean {
  return current !== null;
}
