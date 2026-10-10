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
