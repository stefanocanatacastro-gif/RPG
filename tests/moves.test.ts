import { describe, expect, it } from 'vitest';
import { Database, validateGameData } from '../src/managers/database';
import {
  Builds,
  globalId,
  myOwnerId,
  newFighter,
  newMove,
  toMoveDef,
  moveSummary,
  fromBuiltinMove,
  tidyMove,
} from '../src/managers/builds';
import { BattleEngine } from '../src/battle/engine';
import { simulate, SKILLS } from '../src/battle/simulate';
import { setupProblems, simSetupOf, type BattleSetup } from '../src/managers/battle_setup';
import core from '../src/data/packs/core.json';
import prologue from '../src/data/packs/c0_prologue.json';
import { runtimeSpriteKeys } from '../src/managers/sprite_keys';
import { englishKeys } from '../src/managers/strings';

const hits = (steps: { do: string }[]) => steps.filter((s) => s.do === 'hit').length;

describe('made moves', () => {
  it('turn into normal moves with playable steps', () => {
    const m = {
      ...newMove('hero', 'm1'),
      power: 3,
      hits: 2,
      approach: 'jump' as const,
      command: 'stomp' as const,
    };
    const d = toMoveDef('me', m);
    expect(d).toMatchObject({ id: 'c.me.m1', power: 3, command: 'stomp', category: 'aerial', gritCost: 1 });
    expect(d.reaches.airborne).toBe(true);
    expect(d.steps.map((s) => s.do)).toEqual([
      'jump_to_target',
      'command',
      'hit',
      'command',
      'hit',
      'return',
    ]);
  });

  it('enemy moves have no command or Grit, and can wind up', () => {
    const d = toMoveDef('me', { ...newMove('enemy', 'm2'), charge: 2, command: 'hold_release', gritCost: 4 });
    expect(d).toMatchObject({ command: 'none', gritCost: 0, charge: 2, category: 'enemy' });
  });

  it('an attack on everyone is thrown from where you stand; heals aim at your own side', () => {
    const all = toMoveDef('me', { ...newMove('hero', 'm3'), target: 'all', approach: 'run' });
    expect(all.target).toBe('all');
    expect(all.steps.some((s) => s.do === 'walk_to_target')).toBe(false);
    const heal = toMoveDef('me', { ...newMove('hero', 'm4'), kind: 'heal', power: 4, target: 'ally' });
    expect(heal).toMatchObject({ target: 'ally', heal: 4, command: 'none' });
    expect(heal.steps.map((s) => s.do)).toEqual(['heal', 'return']);
    const medic = toMoveDef('me', { ...newMove('enemy', 'm5'), kind: 'heal', power: 3 });
    expect(medic.target).toBe('ally_lowest');
    expect(moveSummary({ ...newMove('enemy', 'm5'), kind: 'heal', power: 3 })).toMatch(/teammate 3 HP/);
  });

  it('tidying keeps settings sensible, and built-ins read back', () => {
    const m = { ...newMove('hero', 'x'), kind: 'heal' as const };
    tidyMove(m);
    expect(m.target).toBe('ally');
    m.user = 'enemy';
    tidyMove(m);
    expect(m.command).toBe('none');
    const chop = fromBuiltinMove(Database.move('chop'), 'v');
    expect(chop).toMatchObject({ approach: 'run', target: 'front', command: 'timed_press', hits: 1 });
    expect(hits(toMoveDef('me', chop).steps)).toBe(1);
  });

  it('saved moves join the game, fighters can learn them, and pass the data checks', async () => {
    const owner = myOwnerId();
    const area = { ...newMove('hero', 'm1'), name: 'Tornado', target: 'all' as const, power: 2, gritCost: 0 };
    const patch = {
      ...newMove('hero', 'm2'),
      name: 'Patch',
      kind: 'heal' as const,
      power: 3,
      target: 'ally' as const,
    };
    const slam = { ...newMove('enemy', 'm3'), name: 'Crowd Slam', target: 'all' as const, power: 1 };
    const hero = {
      ...newFighter('hero', 'f1'),
      moves: [globalId(owner, 'm1'), globalId(owner, 'm2'), 'chop'],
    };
    const foe = { ...newFighter('enemy', 'f2'), moves: [globalId(owner, 'm3')], weights: {} };
    await Builds.saveMine({ moves: [area, patch, slam], fighters: [hero, foe] });
    expect(Database.move(globalId(owner, 'm1')).target).toBe('all');
    const problems = validateGameData(Database.data, {
      spriteKeys: new Set([
        ...[...core.images, ...prologue.images].map((i) => i.key),
        ...runtimeSpriteKeys(),
      ]),
      stringKeys: englishKeys(),
    });
    expect(problems.filter((p) => p.id.startsWith('c.'))).toEqual([]);

    // in a fight: the area move hits both goons, the heal targets your own side
    const e = new BattleEngine(
      Database,
      Database.character(globalId(owner, 'f1')),
      { hp: 10, maxHp: 10 },
      Database.formation('test_goons'),
      1,
    );
    e.begin(null);
    const aoe = globalId(owner, 'm1');
    expect(e.canUseMove(aoe, 0).ok).toBe(true);
    expect(e.victimsOf('hero', aoe, e.targetsFor(aoe)[0].id)).toHaveLength(2);
    expect(e.targetsFor(globalId(owner, 'm2')).map((f) => f.id)).toEqual(['hero']);
    // an enemy's area move lands on the whole party
    expect(e.victimsOf('e0', globalId(owner, 'm3'), 'hero')).toEqual(['hero']);

    const s: BattleSetup = {
      hero: globalId(owner, 'f1'),
      maxHp: 10,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: 'pip',
      enemies: [
        { id: globalId(owner, 'f2'), slot: 'front' },
        { id: 'dock_goon', slot: 'back' },
      ],
      stage: 'arena',
      firstStrike: null,
    };
    expect(setupProblems(s)).toEqual([]);
    const r = simulate(simSetupOf(s, SKILLS[1]), 40, 5);
    expect(r.wins).toBeGreaterThan(0);

    // deleting a move: fighters forget it on the next load, setups still play
    await Builds.saveMine({ moves: [patch, slam] });
    expect(Database.character(globalId(owner, 'f1')).moves).not.toContain(aoe);
    expect(setupProblems(s)).toEqual([]);
    await Builds.saveMine({ moves: [], fighters: [] });
  });
});
