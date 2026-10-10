import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  judgePress,
  judgeRelease,
  judgeStomp,
  holdFill,
  missEndsCombo,
  ratingMult,
  ringRadius,
} from '../src/battle/commands';

describe('stomp (double jump)', () => {
  const c = COMMANDS.stomp;
  const land = 1000;
  it('succeeds when pressed just before landing', () => {
    expect(judgeStomp([land - 20], land).rating).toBe('great');
    expect(judgeStomp([land - c.windowMs + 5], land).rating).toBe('good');
    expect(judgeStomp([land + c.lateMs - 5], land).rating).not.toBe('miss');
  });
  it('locks you out when the first press is too early, even if you press again on time', () => {
    expect(judgeStomp([land - c.windowMs - 30, land - 10], land)).toEqual({ rating: 'miss', note: 'early' });
  });
  it('misses when late or never pressed', () => {
    expect(judgeStomp([land + c.lateMs + 10], land)).toEqual({ rating: 'miss', note: 'late' });
    expect(judgeStomp([], land)).toEqual({ rating: 'miss', note: 'none' });
  });
  it('decides the combo, not the damage', () => {
    expect(missEndsCombo('stomp')).toBe(true);
    expect(ratingMult('stomp', 'miss')).toBe(1);
  });
});

describe('precision press', () => {
  const c = COMMANDS.timed_press;
  it('rates by distance from the moment the ring lines up', () => {
    expect(judgePress(500 + 20, 500).rating).toBe('great');
    expect(judgePress(500 - c.goodMs + 5, 500).rating).toBe('good');
    expect(judgePress(500 - c.goodMs - 5, 500)).toEqual({ rating: 'miss', note: 'early' });
    expect(judgePress(500 + c.goodMs + 5, 500)).toEqual({ rating: 'miss', note: 'late' });
    expect(judgePress(null, 500)).toEqual({ rating: 'miss', note: 'none' });
  });
  it('closes the ring onto the target exactly at the perfect moment', () => {
    expect(ringRadius(0, 0)).toBe(c.startRadius);
    expect(ringRadius(c.closeMs, 0)).toBeCloseTo(c.targetRadius);
  });
  it('scales damage by rating', () => {
    expect(ratingMult('timed_press', 'great')).toBe(1.5);
    expect(ratingMult('timed_press', 'miss')).toBe(0.5);
    expect(missEndsCombo('timed_press')).toBe(false);
  });
});

describe('precision release', () => {
  const c = COMMANDS.hold_release;
  it('rates by how full the bar was on release', () => {
    expect(judgeRelease(c.fillMs * 0.5)).toEqual({ rating: 'miss', note: 'early' });
    expect(judgeRelease(c.fillMs * 0.85).rating).toBe('good');
    expect(judgeRelease(c.fillMs * 0.95).rating).toBe('great');
    expect(judgeRelease(c.fillMs + c.overMs - 10).rating).toBe('great');
  });
  it('fizzles when held too long or never pressed', () => {
    expect(judgeRelease(c.fillMs + c.overMs + 10)).toEqual({ rating: 'miss', note: 'overheld' });
    expect(judgeRelease(null)).toEqual({ rating: 'miss', note: 'none' });
  });
  it('fills the bar from 0 to 1', () => {
    expect(holdFill(0)).toBe(0);
    expect(holdFill(c.fillMs / 2)).toBe(0.5);
    expect(holdFill(c.fillMs * 3)).toBe(1);
  });
});

import { judgeGuard } from '../src/battle/commands';
import { BattleEngine } from '../src/battle/engine';
import { Database } from '../src/managers/database';

describe('Block and Reversal', () => {
  const c = COMMANDS.guard;
  const hit = 2000;
  it('blocks with a generous window and reverses with a tight one', () => {
    expect(judgeGuard({ button: 'block', t: hit - c.blockWindowMs + 10 }, hit).result).toBe('block');
    expect(judgeGuard({ button: 'reversal', t: hit - c.reversalWindowMs + 10 }, hit).result).toBe('reversal');
    expect(judgeGuard({ button: 'reversal', t: hit - c.blockWindowMs + 10 }, hit)).toEqual({
      result: 'none',
      note: 'early',
    });
  });
  it('misses when late, early or never pressed', () => {
    expect(judgeGuard({ button: 'block', t: hit + c.lateMs + 5 }, hit)).toEqual({
      result: 'none',
      note: 'late',
    });
    expect(judgeGuard({ button: 'block', t: hit - c.blockWindowMs - 5 }, hit)).toEqual({
      result: 'none',
      note: 'early',
    });
    expect(judgeGuard(null, hit).result).toBe('none');
  });

  const hero = Database.character('chispa');
  const battle = () =>
    new BattleEngine(Database, hero, { hp: 10, maxHp: 10 }, Database.formation('test_goons'), 3);

  it('a Block takes 1 off the hit, a Reversal takes all of it and hits back', () => {
    const b = battle();
    expect(b.hit('e0', 'hero', 'goon_shove', 1, 'none').damage).toBe(2);
    expect(b.hit('e0', 'hero', 'goon_shove', 1, 'block').damage).toBe(1);
    const r = b.hit('e0', 'hero', 'goon_shove', 1, 'reversal');
    expect(r.damage).toBe(0);
    expect(r.counter).toBe(1);
    expect(b.get('e0').hp).toBe(3);
  });

  it('wins the fight when a Reversal knocks out the last enemy', () => {
    const b = battle();
    b.begin('enemy');
    b.get('e1').hp = 0;
    b.get('e0').hp = 1;
    const p = b.nextEnemyPlan()!;
    expect(b.hit(p.actor, 'hero', p.move, 1, 'reversal').attackerKo).toBe(true);
    b.endEnemyAction();
    expect(b.phase).toBe('victory');
  });
});
