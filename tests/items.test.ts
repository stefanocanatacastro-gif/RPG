import { describe, expect, it } from 'vitest';
import { Database } from '../src/managers/database';
import { BattleEngine } from '../src/battle/engine';
import { Builds, globalId, myOwnerId, toItemDef, itemSummary, type CustomItem } from '../src/managers/builds';
import { simulate, SKILLS } from '../src/battle/simulate';
import { setupProblems, simSetupOf, type BattleSetup } from '../src/managers/battle_setup';

const hero = Database.character('chispa');

describe('stat boosts', () => {
  it('raise damage for the next turns of their holder, then wear off', () => {
    const b = new BattleEngine(Database, hero, { hp: 10, maxHp: 10 }, Database.formation('test_dummy'), 1);
    b.begin(null);
    b.beginHeroAction();
    b.applyBoost('hero', 2, 1, 2);
    const dummy = b.enemies()[0].id;
    const boosted = b.hit('hero', dummy, 'chop').damage;
    b.endHeroAction();
    // two more turns boosted, then back to normal
    const turns: number[] = [];
    for (let i = 0; i < 3; i++) {
      while (b.nextEnemyPlan()) b.endEnemyAction();
      b.beginHeroAction();
      turns.push(b.hit('hero', dummy, 'chop').damage);
      b.endHeroAction();
    }
    expect(boosted).toBe(4);
    expect(turns).toEqual([4, 4, 2]);
  });
});

describe('made items', () => {
  const mk = (over: Partial<CustomItem>): CustomItem => ({
    id: 'i1',
    name: 'Thing',
    desc: '',
    kind: 'heal',
    amount: 5,
    target: 'self',
    ...over,
  });

  it('become normal items with the right effect and target', () => {
    expect(toItemDef('me', mk({ kind: 'damage', amount: 2, target: 'all' }))).toMatchObject({
      target: 'all',
      effect: { damage: 2 },
      category: 'damage',
    });
    expect(toItemDef('me', mk({ kind: 'heal', target: 'ally' }))).toMatchObject({
      target: 'ally',
      effect: { heal: 5 },
    });
    expect(toItemDef('me', mk({ kind: 'boost', attackUp: 2, turns: 4 }))).toMatchObject({
      category: 'buff',
      effect: { attackUp: 2, defenceUp: 0, turns: 4 },
    });
    expect(itemSummary(mk({ kind: 'damage', amount: 3, target: 'single' }))).toBe(
      'Deals 3 damage to one opponent.',
    );
  });

  it('saved items join the game and can go in an encounter bag', async () => {
    await Builds.saveMine({ items: [mk({ id: 'i1', name: 'Big Soda', amount: 8 })] });
    const id = globalId(myOwnerId(), 'i1');
    expect(Database.item(id).effect.heal).toBe(8);
    const setup: BattleSetup = {
      hero: 'chispa',
      maxHp: 10,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: null,
      enemies: [{ id: 'dock_goon', slot: 'front' }],
      stage: 'arena',
      firstStrike: null,
      items: [id, 'gone_item'],
    };
    expect(setupProblems(setup)).toEqual(['an item in its bag no longer exists']);
  });

  it('the simulator uses healing items, and they help', () => {
    const base: BattleSetup = {
      hero: 'chispa',
      maxHp: 10,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: null,
      enemies: [
        { id: 'spiky_bouncer', slot: 'front' },
        { id: 'gull_flyer', slot: 'air' },
        { id: 'dock_goon', slot: 'back' },
      ],
      stage: 'arena',
      firstStrike: null,
    };
    const without = simulate(simSetupOf(base, SKILLS[2]), 200, 5);
    const withBag = simulate(
      simSetupOf({ ...base, items: ['water_bottle', 'water_bottle', 'smelling_salts'] }, SKILLS[2]),
      200,
      5,
    );
    expect(withBag.wins).toBeGreaterThan(without.wins);
  });
});
