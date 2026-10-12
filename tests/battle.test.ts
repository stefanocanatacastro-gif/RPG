import { describe, expect, it } from 'vitest';
import { BattleEngine, computeDamage } from '../src/battle/engine';
import { Database } from '../src/managers/database';

const hero = Database.character('chispa');
const fresh = () => ({ hp: hero.hp, maxHp: hero.hp });

function battle(formation: string, seed = 42): BattleEngine {
  return new BattleEngine(Database, hero, fresh(), Database.formation(formation), seed);
}

describe('damage formula', () => {
  it('is power + attack − defence, never below zero', () => {
    expect(computeDamage(1, 1, 0)).toBe(2);
    expect(computeDamage(1, 1, 5)).toBe(0);
    expect(computeDamage(1, 1, 5, { piercing: true })).toBe(2);
    expect(computeDamage(3, 1, 0, { mult: 1.5 })).toBe(6);
    expect(computeDamage(1, 1, 0, { guard: 1 })).toBe(1);
  });
});

describe('targeting', () => {
  const b = battle('test_mixed');
  const [, spiky, gull, goon] = b.fighters;

  it('orders enemies front, flyer, back', () => {
    expect([spiky.defId, gull.defId, goon.defId]).toEqual(['spiky_bouncer', 'gull_flyer', 'dock_goon']);
    expect(gull.airborne).toBe(true);
  });

  it('lets a Chop reach only the front enemy on the ground', () => {
    expect(b.canTarget('chop', spiky.id).ok).toBe(true);
    expect(b.canTarget('chop', goon.id)).toEqual({ ok: false, reason: 'notFront' });
    expect(b.canTarget('chop', gull.id)).toEqual({ ok: false, reason: 'airborne' });
  });

  it('keeps an Elbow Drop off the spiky enemy but lets it reach the flyer', () => {
    expect(b.canTarget('elbow_drop', spiky.id)).toEqual({ ok: false, reason: 'spiky' });
    expect(b.canTarget('elbow_drop', gull.id).ok).toBe(true);
    expect(b.canTarget('elbow_drop', goon.id).ok).toBe(true);
  });

  it('greys out a Body Slam when the only front enemy is spiky, and when Grit is short', () => {
    expect(b.canUseMove('body_slam', 5)).toEqual({ ok: false, reason: 'noTarget' });
    const g = battle('test_goons');
    expect(g.canUseMove('body_slam', 1)).toEqual({ ok: false, reason: 'notEnoughGrit' });
    expect(g.canUseMove('body_slam', 2).ok).toBe(true);
  });
});

describe('turn flow', () => {
  it('runs hero turn, then each enemy, then a new round', () => {
    const b = battle('test_goons');
    b.begin(null);
    expect(b.phase).toBe('command');
    b.beginHeroAction();
    b.hit('hero', 'e0', 'chop');
    b.endHeroAction();
    expect(b.phase).toBe('enemy');
    const plans = [];
    let p;
    while ((p = b.nextEnemyPlan())) {
      plans.push(p);
      b.hit(p.actor, p.target, p.move);
      b.endEnemyAction();
    }
    expect(plans.map((x) => x.actor)).toEqual(['e0', 'e1']);
    expect(b.phase).toBe('command');
    expect(b.round).toBe(2);
    expect(b.hero.hp).toBe(hero.hp - 4);
  });

  it('lets enemies act first after an enemy First Strike', () => {
    const b = battle('test_goons');
    b.begin('enemy');
    expect(b.phase).toBe('enemy');
    expect(b.nextEnemyPlan()?.actor).toBe('e0');
  });

  it('wins when every enemy is down and adds up the rewards', () => {
    const b = battle('test_goons');
    b.begin(null);
    let guard = 0;
    while (b.phase !== 'victory' && guard++ < 20) {
      b.beginHeroAction();
      const target = b.targetsFor('chop')[0];
      b.hit('hero', target.id, 'chop');
      b.endHeroAction();
      let p;
      while (b.phase === 'enemy' && (p = b.nextEnemyPlan())) {
        b.hit(p.actor, p.target, p.move);
        b.endEnemyAction();
      }
    }
    expect(b.phase).toBe('victory');
    expect(b.rewards()).toEqual({ xp: 4, coins: 4 });
  });

  it('loses when the hero reaches 0 HP', () => {
    const b = new BattleEngine(Database, hero, { hp: 2, maxHp: 10 }, Database.formation('test_goons'), 1);
    b.begin('enemy');
    const p = b.nextEnemyPlan()!;
    b.hit(p.actor, p.target, p.move);
    b.endEnemyAction();
    expect(b.phase).toBe('defeat');
  });

  it('defending takes a point off each hit until the next turn', () => {
    const b = battle('test_goons');
    b.begin(null);
    b.defend();
    b.endHeroAction();
    const p = b.nextEnemyPlan()!;
    expect(b.hit(p.actor, p.target, p.move).damage).toBe(1);
  });
});

describe('enemy AI', () => {
  it('picks moves by weight and replays exactly from the same seed', () => {
    const pick = (seed: number) => {
      const b = battle('test_mixed', seed);
      return Array.from({ length: 30 }, () => b.chooseEnemyMove(b.get('e0')));
    };
    const a = pick(7);
    expect(pick(7)).toEqual(a);
    const shoves = a.filter((m) => m === 'goon_shove').length;
    expect(shoves).toBeGreaterThan(12); // weight 2 of 3
    expect(shoves).toBeLessThan(28);
  });
});

import { xpToNext, addXp } from '../src/battle/progression';
import { GameState, freshSave } from '../src/managers/game_state';
import { EventBus, type GameEvents } from '../src/managers/event_bus';

describe('enemy AI patterns', () => {
  const crew = (seed = 5) => new BattleEngine(Database, hero, fresh(), Database.formation('test_crew'), seed);
  const bruiser = (b: BattleEngine) => b.fighters.find((f) => f.defId === 'ringside_bruiser')!;

  it('the Bruiser winds up on round 1, unleashes it on round 2, winds up again on round 3', () => {
    const b = crew();
    b.begin(null);
    const kinds: string[] = [];
    for (let round = 1; round <= 3; round++) {
      b.beginHeroAction();
      b.defend();
      b.endHeroAction();
      let p;
      while ((p = b.nextEnemyPlan())) {
        if (p.actor === bruiser(b).id) kinds.push(p.kind);
        b.endEnemyAction();
      }
    }
    expect(kinds).toEqual(['charge', 'release', 'charge']);
  });

  it('a broken charge means no lariat next turn', () => {
    const b = crew();
    b.begin(null);
    b.beginHeroAction();
    b.defend();
    b.endHeroAction();
    while (b.nextEnemyPlan()) b.endEnemyAction();
    expect(bruiser(b).charging).toBeTruthy();
    expect(b.breakCharge(bruiser(b).id)).toBe(true);
    b.beginHeroAction();
    b.endHeroAction();
    const plans = [];
    let p;
    while ((p = b.nextEnemyPlan())) {
      plans.push(p);
      b.endEnemyAction();
    }
    expect(plans.find((x) => x.actor === bruiser(b).id)?.kind).toBe('attack');
  });

  it('the Medic heals the most hurt teammate, and only when someone is hurt', () => {
    const b = crew();
    b.begin(null);
    const medic = b.fighters.find((f) => f.defId === 'corner_medic')!;
    expect(b.chooseEnemyMove(medic)).toBe('goon_shove');
    const goon = b.fighters.find((f) => f.defId === 'dock_goon')!;
    goon.hp = 1;
    bruiser(b).hp = 7;
    expect(b.lowestAlly(medic)?.id).toBe(goon.id);
    expect(b.chooseEnemyMove(medic)).toBe('patch_up');
    expect(b.healFighter(goon.id, 3)).toBe(3);
  });
});

describe('levels', () => {
  it('needs more XP for each level', () => {
    expect(xpToNext(1)).toBe(10);
    expect(xpToNext(2)).toBe(15);
  });
  it('rolls XP over into levels', () => {
    expect(addXp(1, 8, 4)).toEqual({ level: 2, xp: 2, levelsGained: 1 });
    expect(addXp(1, 0, 30)).toEqual({ level: 3, xp: 5, levelsGained: 2 });
    expect(addXp(1, 0, 3)).toEqual({ level: 1, xp: 3, levelsGained: 0 });
  });
  it('a level-up restores HP and Grit', () => {
    const gs = new GameState(freshSave(hero), new EventBus<GameEvents>());
    gs.setHp('chispa', 2);
    gs.setGrit(0);
    expect(gs.addXp(12)).toBe(1);
    expect(gs.hero().hp).toBe(hero.hp);
    expect(gs.data.grit).toBe(gs.data.maxGrit);
    expect(gs.data.level).toBe(2);
  });
});
