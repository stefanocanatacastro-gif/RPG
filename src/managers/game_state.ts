// GameState: the one place that holds the player's progress. Everything that
// would go into a save file lives here and nowhere else, and every change goes
// through a method so the EventBus hears about it.

import type { CharacterDef } from '../types/data';
import { addXp as addXpRule } from '../battle/progression';
import { bus as defaultBus, EventBus, type FlagValue, type GameEvents } from './event_bus';

export const SAVE_VERSION = 1;
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
    room: 'test_a',
    pos: { x: 120, y: 260 },
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
    this.d.pos = { x: Math.round(x), y: Math.round(y) };
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
    if (save.version !== SAVE_VERSION) throw new Error(`Save version ${save.version} isn't supported yet`);
    this.d = structuredClone(save);
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
