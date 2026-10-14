import { describe, expect, it } from 'vitest';
import { Builds, globalId, newFighter, newMove } from '../src/managers/builds';
import { Database } from '../src/managers/database';
import { setupProblems, type BattleSetup } from '../src/managers/battle_setup';
import {
  importBattle,
  missingBuiltIns,
  packBattle,
  readBattleFile,
  FILE_FORMAT,
} from '../src/managers/battle_file';
import { SCENARIOS } from '../src/data/scenarios';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('battle files', () => {
  it('pack a battle with its made fighter, move, item and pictures, and import it as someone else would', async () => {
    const move = { ...newMove('enemy', 'm1'), name: 'Harbor Hook' };
    const foe = {
      ...newFighter('enemy', 'f1'),
      name: 'Crane Operator',
      look: { base: 'picture', pictures: { idle: PNG } },
      moves: ['goon_shove', globalId('me', 'm1')],
      weights: { goon_shove: 1, [globalId('me', 'm1')]: 2 },
      rules: [{ move: globalId('me', 'm1'), when: 'opener' as const }],
    };
    const item = {
      id: 'i1',
      name: 'Tug Rope',
      desc: '',
      kind: 'damage' as const,
      amount: 2,
      target: 'all' as const,
    };
    await Builds.saveMine({ fighters: [foe], moves: [move], items: [item], encounters: [] });
    const setup: BattleSetup = {
      hero: 'chispa',
      maxHp: 10,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: null,
      enemies: [
        { id: globalId('me', 'f1'), slot: 'front' },
        { id: 'dock_goon', slot: 'front' },
      ],
      stage: 'dockside',
      firstStrike: null,
      items: [globalId('me', 'i1'), 'water_bottle'],
    };
    expect(setupProblems(setup)).toEqual([]);
    const file = await packBattle({ title: 'Crane Game', desc: 'Watch the hook.', setup }, 'Stefano', true);
    expect(file.format).toBe(FILE_FORMAT);
    expect(file.fighters.map((f) => f.fighter.name)).toEqual(['Crane Operator']);
    expect(file.moves.map((m) => m.move.name)).toEqual(['Harbor Hook']);
    expect(file.items.map((i) => i.item.name)).toEqual(['Tug Rope']);
    const text = JSON.stringify(file);

    // someone else's game: they already have things under the same local ids
    await Builds.saveMine({
      fighters: [{ ...newFighter('hero', 'f1'), name: 'Their Hero' }],
      moves: [{ ...newMove('hero', 'm1'), name: 'Their Move' }],
      items: [],
      encounters: [],
    });
    const r = await importBattle(readBattleFile(text));
    expect(r.again).toBe(false);
    const enc = Builds.myEncounters().find((e) => e.id === r.id)!;
    expect(enc.title).toBe('Crane Game');
    expect(enc.imported).toMatchObject({ maker: 'Stefano', cleared: true });
    expect(setupProblems(enc.setup)).toEqual([]);
    const crane = Builds.mine().find((f) => f.name === 'Crane Operator')!;
    expect(crane.id).not.toBe('f1');
    const hook = Builds.myMoves().find((m) => m.name === 'Harbor Hook')!;
    expect(hook.id).not.toBe('m1');
    expect(crane.moves).toContain(globalId('me', hook.id));
    expect(crane.rules![0].move).toBe(globalId('me', hook.id));
    expect(Object.keys(crane.weights!)).toContain(globalId('me', hook.id));
    expect(crane.look.pictures!.idle).toBe(PNG);
    expect(enc.setup.enemies[0].id).toBe(globalId('me', crane.id));
    expect(Database.enemy(enc.setup.enemies[0].id).moves).toContain(globalId('me', hook.id));
    // their own things are untouched
    expect(Builds.mine().find((f) => f.id === 'f1')!.name).toBe('Their Hero');
    // importing the same file again adds nothing
    const again = await importBattle(readBattleFile(text));
    expect(again).toEqual({ id: r.id, again: true });
    expect(Builds.myEncounters()).toHaveLength(1);
    await Builds.saveMine({ fighters: [], moves: [], items: [], encounters: [] });
  });

  it('showcase fights travel by id alone', async () => {
    const f = await packBattle(SCENARIOS[6], 'Showcase', true);
    expect(f.fighters).toEqual([]);
    expect(missingBuiltIns(f)).toEqual([]);
  });

  it('refuses files that are not battles, damaged ones, newer ones, and pictures from elsewhere', async () => {
    expect(() => readBattleFile('hello')).toThrow(/isn't a battle file/);
    expect(() => readBattleFile('{"format":"something"}')).toThrow(/isn't a Kid Chispa/);
    const ok = await packBattle(SCENARIOS[0], 'X', true);
    expect(() => readBattleFile(JSON.stringify({ ...ok, version: 99 }))).toThrow(/newer version/);
    const bad = {
      ...ok,
      fighters: [
        {
          id: 'c.x.f1',
          fighter: {
            ...newFighter('enemy', 'f1'),
            look: { base: 'picture', pictures: { idle: 'https://example.com/a.png' } },
          },
        },
      ],
    };
    expect(() => readBattleFile(JSON.stringify(bad))).toThrow(/damaged picture/);
    const unknown = {
      ...ok,
      battle: {
        ...ok.battle,
        setup: { ...ok.battle.setup, enemies: [{ id: 'mega_goon', slot: 'front' as const }] },
      },
    };
    expect(missingBuiltIns(unknown)).toEqual(['mega_goon']);
    await expect(importBattle(unknown)).rejects.toThrow(/update to play it/);
  });
});
