import { describe, expect, it } from 'vitest';
import { Database } from '../src/managers/database';
import { BattleEngine } from '../src/battle/engine';
import { simulate, SKILLS } from '../src/battle/simulate';
import { cleanConditions, conditionLines, HAZARDS, SPECIALS } from '../src/battle/conditions';
import { formationOf, setupProblems, simSetupOf, type BattleSetup } from '../src/managers/battle_setup';
import type { BattleConditions, FormationDef } from '../src/types/data';

const hero = Database.character('chispa');
const pip = Database.character('pip');

const withCond = (id: string, conditions: BattleConditions): FormationDef => ({
  ...Database.formation(id),
  conditions,
});

const engine = (f: FormationDef, seed = 1, hp = 10) =>
  new BattleEngine(Database, hero, { hp, maxHp: hp }, f, seed);

/** Runs enemy turns until the round ends or the fight does. */
const enemyTurns = (b: BattleEngine) => {
  while (b.phase === 'enemy') {
    b.nextEnemyPlan();
    b.endEnemyAction();
  }
};

describe('ring conditions data', () => {
  it('hazards and specials are well formed', () => {
    expect(new Set(HAZARDS.map((h) => h.id)).size).toBe(HAZARDS.length);
    for (const h of HAZARDS) expect(h.short.length).toBeLessThanOrEqual(10);
    for (const s of SPECIALS) expect(s.cost).toBeGreaterThan(0);
  });

  it('a plain match has no conditions, and cleaning keeps only real changes', () => {
    expect(cleanConditions({ goal: 'ko', crowd: 'normal', mood: 'fair', hazards: [] })).toBeUndefined();
    expect(cleanConditions({ goal: 'survive', rounds: 99, noRun: true })).toEqual({
      goal: 'survive',
      rounds: 20,
      noRun: true,
    });
    expect(conditionLines({ goal: 'timed', rounds: 4, hazards: ['spotlight'] })).toEqual([
      'Win within 4 rounds',
      'Spotlight',
    ]);
  });

  it('a plain match uses no extra random numbers', () => {
    const a = engine(Database.formation('test_crew'), 7);
    const b = engine(withCond('test_crew', {}), 7);
    a.begin(null);
    b.begin(null);
    expect(a.rng.getState()).toBe(b.rng.getState());
  });

  it('setups carry conditions into the formation, and unknown hazards are flagged', () => {
    const s: BattleSetup = {
      hero: 'chispa',
      maxHp: 10,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: null,
      enemies: [{ id: 'dock_goon', slot: 'front' }],
      stage: 'arena',
      firstStrike: null,
      items: ['water_bottle'],
      conditions: { noItems: true, hazards: ['spotlight'] },
    };
    expect(formationOf(s).conditions).toEqual({ noItems: true, hazards: ['spotlight'] });
    expect(simSetupOf(s, SKILLS[0]).items).toEqual([]);
    expect(setupProblems({ ...s, conditions: { hazards: ['lava'] } })).toContain(
      'one of its hazards no longer exists',
    );
  });
});

describe('goals', () => {
  it('surviving the rounds wins, and only pays for knocked-out opponents', () => {
    const b = engine(withCond('test_dummy', { goal: 'survive', rounds: 2 }), 1, 99);
    b.begin(null);
    for (let i = 0; i < 2; i++) {
      b.beginHeroAction();
      b.defend();
      b.endHeroAction();
      enemyTurns(b);
    }
    expect(b.phase).toBe('victory');
    expect(b.endReason).toBe('survived');
    expect(b.round).toBe(2);
    expect(b.rewards()).toEqual({ xp: 0, coins: 0 });
  });

  it('running out of rounds loses', () => {
    const b = engine(withCond('test_dummy', { goal: 'timed', rounds: 1 }), 1, 99);
    b.begin(null);
    b.beginHeroAction();
    b.defend();
    b.endHeroAction();
    enemyTurns(b);
    expect(b.phase).toBe('defeat');
    expect(b.endReason).toBe('timeup');
  });

  it('no running means no running', () => {
    const b = engine(withCond('test_dummy', { noRun: true }));
    b.begin(null);
    for (let i = 0; i < 20; i++) expect(b.tryRun()).toBe(false);
  });
});

describe('hazards', () => {
  it('burning ropes cost aerial moves 1 HP, not run-ins', () => {
    const b = engine(withCond('test_dummy', { hazards: ['burning_ropes'] }));
    b.begin(null);
    expect(b.moveHazard('hero', 'elbow_drop')).toMatchObject({ damage: 1, slip: false });
    expect(b.hero.hp).toBe(9);
    expect(b.moveHazard('hero', 'chop').damage).toBe(0);
  });

  it('a slippery canvas makes some run-ins slip, never aerials', () => {
    let slips = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = engine(withCond('test_dummy', { hazards: ['slippery_canvas'] }), seed);
      b.begin(null);
      if (b.moveHazard('hero', 'chop').slip) slips++;
      expect(b.moveHazard('hero', 'elbow_drop').slip).toBe(false);
    }
    expect(slips).toBeGreaterThan(20);
    expect(slips).toBeLessThan(90);
  });

  it('the spotlight picks someone each round, and they hit harder', () => {
    const b = engine(withCond('test_dummy', { hazards: ['spotlight'] }));
    b.begin(null);
    const ev = b.takeEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('spotlight');
    const dummy = b.enemies()[0].id;
    b.spotlight = 'hero';
    const lit = b.hit('hero', dummy, 'chop').damage;
    b.spotlight = null;
    const plain = b.hit('hero', dummy, 'chop').damage;
    expect(lit).toBe(plain + 1);
  });

  it('falling lights can knock someone out at the start of a round', () => {
    let fell = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const b = engine(withCond('test_dummy', { hazards: ['falling_light'] }), seed, 3);
      b.begin(null);
      const ev = b.takeEvents();
      if (ev.length) {
        fell++;
        b.settle();
        const t = b.get(ev[0].target);
        expect(t.hp).toBe(Math.max(0, t.maxHp - 3));
        if (t.id === 'hero') expect(b.phase).toBe('defeat');
      }
    }
    expect(fell).toBeGreaterThan(10);
  });
});

describe('crowd and Hype', () => {
  it('a packed house builds Hype faster than a quiet one, up to the max', () => {
    const quiet = engine(withCond('test_dummy', { crowd: 'quiet' }));
    const packed = engine(withCond('test_dummy', { crowd: 'packed' }));
    expect(quiet.gainHype('appeal')).toBeLessThan(packed.gainHype('appeal'));
    for (let i = 0; i < 20; i++) packed.gainHype('great');
    expect(packed.hype).toBe(packed.maxHype);
  });

  it('specials cost Hype: Rally heals the party, Showstopper hits every opponent', () => {
    const b = new BattleEngine(Database, hero, { hp: 4, maxHp: 10 }, Database.formation('test_crew'), 1, {
      def: pip,
      hp: 2,
      maxHp: pip.hp,
    });
    b.begin(null);
    expect(b.canUseSpecial('rally')).toBe(false);
    b.hype = 10;
    b.beginHeroAction();
    const r = b.useSpecial('rally');
    expect(r.heals.map((h) => h.amount)).toEqual([4, 4]);
    expect(b.hype).toBe(7);
    const before = b.enemies().map((e) => e.hp);
    const hits = b.useSpecial('showstopper').hits;
    expect(hits).toHaveLength(before.length);
    expect(b.enemies(false).map((e) => e.hp)).toEqual(before.map((h) => Math.max(0, h - 4)));
    expect(b.hype).toBe(0);
  });

  it('a hostile crowd throws junk at your team only', () => {
    let hits = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const b = engine(withCond('test_crew', { mood: 'away' }), seed);
      b.begin(null);
      for (const ev of b.takeEvents()) {
        expect(ev.kind).toBe('throw');
        expect(b.get(ev.target).side).toBe('hero');
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(5);
  });

  it('the simulator copes with every condition at once', () => {
    const s: BattleSetup = {
      hero: 'chispa',
      maxHp: 12,
      attack: 1,
      defence: 0,
      grit: 5,
      partner: 'pip',
      enemies: [
        { id: 'dock_goon', slot: 'front' },
        { id: 'dock_goon', slot: 'back' },
      ],
      stage: 'arena',
      firstStrike: null,
      items: ['water_bottle'],
      conditions: {
        hazards: HAZARDS.map((h) => h.id),
        goal: 'survive',
        rounds: 6,
        crowd: 'packed',
        mood: 'rowdy',
      },
    };
    const r = simulate(simSetupOf(s, SKILLS[1]), 60, 3);
    expect(r.wins + r.losses + r.timeouts).toBe(60);
    expect(r.timeouts).toBe(0);
  });
});
