import { describe, expect, it, vi } from 'vitest';
import { Rng } from '../src/systems/rng';
import { EventBus, type GameEvents } from '../src/managers/event_bus';
import { GameState, freshSave, ITEM_CAP } from '../src/managers/game_state';
import { Database, validateGameData } from '../src/managers/database';
import type { GameData } from '../src/types/data';
import en from '../src/strings/en.json';
import es from '../src/strings/es.json';
import core from '../src/data/packs/core.json';
import prologue from '../src/data/packs/c0_prologue.json';

const hero = Database.character('chispa');

describe('Rng', () => {
  it('replays the same sequence from the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('resumes from a saved position', () => {
    const a = new Rng(99);
    a.next();
    a.next();
    const pos = a.getState();
    const expected = [a.next(), a.next()];
    const b = new Rng(1);
    b.setState(pos);
    expect([b.next(), b.next()]).toEqual(expected);
  });

  it('keeps int() inside its range and respects weights', () => {
    const r = new Rng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 3000; i++) {
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      counts[
        r.weighted([
          { value: 'a' as const, weight: 3 },
          { value: 'b' as const, weight: 1 },
        ])
      ]++;
    }
    expect(counts.a / counts.b).toBeGreaterThan(2.4);
    expect(counts.a / counts.b).toBeLessThan(3.8);
  });
});

describe('EventBus', () => {
  it('delivers, unsubscribes and handles once()', () => {
    const bus = new EventBus<GameEvents>();
    const fn = vi.fn();
    const off = bus.on('coins.changed', fn);
    bus.once('coins.changed', fn);
    bus.emit('coins.changed', { coins: 5, delta: 5 });
    bus.emit('coins.changed', { coins: 6, delta: 1 });
    off();
    bus.emit('coins.changed', { coins: 7, delta: 1 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(bus.count('coins.changed')).toBe(0);
  });
});

describe('GameState', () => {
  it('caps items at 10 and reports a full bag', () => {
    const bus = new EventBus<GameEvents>();
    const full = vi.fn();
    bus.on('item.full', full);
    const gs = new GameState(freshSave(hero), bus);
    for (let i = 0; i < ITEM_CAP; i++) expect(gs.addItem('water_bottle')).toBe(true);
    expect(gs.addItem('steel_chair')).toBe(false);
    expect(full).toHaveBeenCalledOnce();
    expect(gs.takeItem('water_bottle')).toBe('water_bottle');
    expect(gs.data.items.length).toBe(ITEM_CAP - 1);
  });

  it('clamps HP, Grit and coins', () => {
    const gs = new GameState(freshSave(hero), new EventBus<GameEvents>());
    gs.setHp('chispa', 999);
    expect(gs.hero().hp).toBe(hero.hp);
    gs.setHp('chispa', -4);
    expect(gs.hero().hp).toBe(0);
    expect(gs.spendGrit(99)).toBe(false);
    expect(gs.spendGrit(2)).toBe(true);
    expect(gs.data.grit).toBe(hero.grit - 2);
    gs.addCoins(-50);
    expect(gs.data.coins).toBe(0);
  });

  it('snapshots and restores without sharing objects', () => {
    const gs = new GameState(freshSave(hero), new EventBus<GameEvents>());
    gs.addCoins(12);
    gs.setFlag('met_pip');
    const snap = gs.snapshot();
    gs.addCoins(30);
    gs.setFlag('met_pip', false);
    gs.restore(snap);
    expect(gs.data.coins).toBe(12);
    expect(gs.isSet('met_pip')).toBe(true);
    snap.coins = 500;
    expect(gs.data.coins).toBe(12);
  });
});

describe('Database', () => {
  const ctx = {
    spriteKeys: new Set([...core.images, ...prologue.images].map((i) => i.key)),
    stringKeys: new Set(Object.keys(en)),
  };

  it('ships with no data problems', () => {
    expect(validateGameData(Database.data, ctx)).toEqual([]);
  });

  it('catches broken references and typos', () => {
    const broken: GameData = structuredClone(Database.data);
    broken.characters[0].moves.push('chopp');
    broken.enemies[0].sprite = 'spr_missing';
    broken.enemies[1].ai.push({ move: 'dive_peck', weight: 1 });
    broken.formations[0].enemies.push({ enemy: 'nobody', slot: 'front' });
    broken.moves[0].steps = broken.moves[0].steps.filter((s) => s.do !== 'hit');
    broken.items.push({ ...broken.items[0] });
    const msgs = validateGameData(broken, ctx).map((p) => `${p.file}:${p.id}:${p.message}`);
    expect(msgs).toContain('characters:chispa:unknown move "chopp"');
    expect(msgs).toContain('enemies:dock_goon:sprite "spr_missing" is not in any asset pack');
    expect(msgs).toContain(`enemies:spiky_bouncer:AI uses "dive_peck", which isn't in its move list`);
    expect(msgs).toContain('formations:test_goons:unknown enemy "nobody"');
    expect(msgs).toContain('moves:chop:never hits (no "hit" step)');
    expect(msgs).toContain('items:steel_chair:duplicate id');
  });

  it('catches broken rooms', () => {
    const broken: GameData = structuredClone(Database.data);
    const b = broken.rooms.test_b;
    b.doors![0].spawn = 'nowhere';
    b.objects!.push({ id: 'chest_b', kind: 'chest', x: 1, z: 1, item: 'golden_belt', flag: '' });
    b.objects!.push({ id: 't1', kind: 'trigger', x: 1, z: 1, w: 1, d: 1 });
    b.objects!.push({ id: 'n1', kind: 'npc', x: 1, z: 1, sprite: 'spr_nobody', name: 'npc.dock_kid', lines: [] });
    b.enemies.push({ id: 'b9', enemy: 'dock_goon', formation: 'nope', x: 1, z: 1, patrol: 1 });
    const msgs = validateGameData(broken, ctx).map((p) => `${p.file}:${p.id}:${p.message}`);
    expect(msgs).toContain(`rooms:test_b · exit to test_a:spawn "nowhere" doesn't exist there`);
    expect(msgs).toContain('rooms:test_b · chest_b:duplicate id in this room');
    expect(msgs).toContain('rooms:test_b · chest_b:unknown item "golden_belt"');
    expect(msgs).toContain('rooms:test_b · chest_b:needs a flag to remember it was opened');
    expect(msgs).toContain('rooms:test_b · t1:fires once, so it needs setFlag to remember');
    expect(msgs).toContain('rooms:test_b · n1:sprite "spr_nobody" is not in any asset pack');
    expect(msgs).toContain('rooms:test_b · n1:has nothing to say');
    expect(msgs).toContain('rooms:test_b · b9:unknown formation "nope"');
  });

  it('has Spanish text for every English string', () => {
    const missing = Object.keys(en).filter((k) => !(k in es));
    expect(missing).toEqual([]);
  });
});

import { groupFrames } from '../src/systems/anim_builder';

describe('Animation builder', () => {
  it('groups frame names into ordered animations', () => {
    const g = groupFrames(['chop_02', 'idle_01', 'chop_00', 'idle_00', 'chop_01', 'chop_10', 'logo']);
    expect(g.get('chop')).toEqual(['chop_00', 'chop_01', 'chop_02', 'chop_10']);
    expect(g.get('idle')).toEqual(['idle_00', 'idle_01']);
    expect(g.has('logo')).toBe(false);
  });
});
