import { describe, expect, it } from 'vitest';
import { Database, validateGameData } from '../src/managers/database';
import { Builds, globalId, newFighter, toDefs, loadBuilds, myOwnerId } from '../src/managers/builds';
import { runtimeSpriteKeys } from '../src/managers/sprite_keys';
import core from '../src/data/packs/core.json';
import prologue from '../src/data/packs/c0_prologue.json';
import { englishKeys } from '../src/managers/strings';
import { BattleEngine } from '../src/battle/engine';
import { simulate, SKILLS } from '../src/battle/simulate';
import { setupProblems, simSetupOf, type BattleSetup } from '../src/managers/battle_setup';

const ctx = () => ({
  spriteKeys: new Set([...[...core.images, ...prologue.images].map((i) => i.key), ...runtimeSpriteKeys()]),
  stringKeys: englishKeys(),
});

describe('fighter maker data', () => {
  it('turns a made hero into a normal character', () => {
    const f = { ...newFighter('hero', 'f1'), name: 'La Chancla', hp: 14, attack: 2 };
    const d = toDefs('me', f);
    expect(d.char).toMatchObject({ id: 'c.me.f1', hp: 14, attack: 2, moves: ['chop', 'elbow_drop'] });
    expect(Database.data.moves.some((m) => m.id === 'chop')).toBe(true);
  });

  it('turns a made enemy into an enemy with an attack pattern', () => {
    const f = {
      ...newFighter('enemy', 'f2'),
      moves: ['goon_shove', 'running_lariat'],
      weights: { goon_shove: 3, running_lariat: 1 },
      lowHpMove: 'running_lariat',
    };
    const { foe } = toDefs('me', f);
    expect(foe!.ai).toEqual([
      { move: 'goon_shove', weight: 3 },
      { move: 'running_lariat', weight: 1 },
      { move: 'running_lariat', weight: 1, priority: 1, whenHpBelow: 0.5 },
    ]);
  });

  it('saved fighters join the game data and pass the data checks', async () => {
    await loadBuilds();
    const hero = { ...newFighter('hero', 'f1'), name: 'Test Hero' };
    const foe = { ...newFighter('enemy', 'f2'), name: 'Test Rival', hp: 3 };
    await Builds.saveMine({ fighters: [hero, foe] });
    const hid = globalId(myOwnerId(), 'f1');
    const eid = globalId(myOwnerId(), 'f2');
    expect(Database.character(hid).hp).toBe(10);
    expect(Database.enemy(eid).hp).toBe(3);
    const mine = validateGameData(Database.data, ctx()).filter((p) => p.id.startsWith('c.'));
    expect(mine).toEqual([]);
    // and they fight
    const r = simulate(
      {
        db: Database,
        hero: Database.character(hid),
        maxHp: 10,
        maxGrit: 5,
        attack: 1,
        defence: 0,
        formation: { id: 'x', stage: 'arena', enemies: [{ enemy: eid, slot: 'front' }] },
        firstStrike: null,
        skill: SKILLS[0],
      },
      10,
    );
    expect(r.wins).toBe(10);
    const b = new BattleEngine(
      Database,
      Database.character(hid),
      { hp: 10, maxHp: 10 },
      { id: 'x', stage: 'arena', enemies: [{ enemy: eid, slot: 'front' }] },
      1,
    );
    expect(b.enemies()[0].defId).toBe(eid);
  });

  it('saving again replaces the old set (deleted fighters disappear)', async () => {
    await Builds.saveMine({ fighters: [{ ...newFighter('hero', 'f9'), name: 'Only One' }] });
    expect(Database.data.characters.filter((c) => c.id.startsWith('c.')).map((c) => c.id)).toEqual([
      globalId(myOwnerId(), 'f9'),
    ]);
    expect(Database.data.enemies.some((e) => e.id.startsWith('c.'))).toBe(false);
  });
});

describe('encounters', () => {
  it('saves encounters next to fighters without losing either', async () => {
    const hero = { ...newFighter('hero', 'f1'), name: 'Encounter Hero' };
    await Builds.saveMine({ fighters: [hero] });
    const hid = globalId(myOwnerId(), 'f1');
    const setup: BattleSetup = {
      hero: hid,
      maxHp: 12,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: 'pip',
      enemies: [{ id: 'dock_goon', slot: 'front' }],
      stage: 'dockside',
      firstStrike: null,
    };
    await Builds.saveMine({ encounters: [{ id: 'b1', title: 'Harbor Brawl', setup }] });
    expect(Builds.mine().map((f) => f.name)).toEqual(['Encounter Hero']);
    expect(Builds.myEncounters()[0].title).toBe('Harbor Brawl');
    expect(setupProblems(setup)).toEqual([]);
    const r = simulate(simSetupOf(setup, SKILLS[0]), 20);
    expect(r.wins).toBe(20);
  });

  it('says why an encounter can no longer be played', () => {
    const broken: BattleSetup = {
      hero: 'c.gone.f1',
      maxHp: 10,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: null,
      enemies: [{ id: 'c.gone.f2', slot: 'front' }],
      stage: 'nowhere',
      firstStrike: null,
    };
    expect(setupProblems(broken)).toEqual([
      'its hero no longer exists',
      'one of its opponents no longer exists',
      'its arena no longer exists',
    ]);
  });
});
