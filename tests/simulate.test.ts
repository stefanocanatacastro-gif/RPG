import { describe, it, expect } from 'vitest';
import { Database } from '../src/managers/database';
import { simulate, simulateFight, SKILLS, type SimSetup } from '../src/battle/simulate';

const skill = (id: string) => SKILLS.find((s) => s.id === id)!;
const setup = (formation: string, skillId: string, over: Partial<SimSetup> = {}): SimSetup => ({
  db: Database,
  hero: Database.character('chispa'),
  maxHp: 10,
  maxGrit: 5,
  attack: 1,
  defence: 0,
  formation: Database.formation(formation),
  firstStrike: null,
  skill: skill(skillId),
  ...over,
});

describe('battle simulator', () => {
  it('replays a fight exactly from its seed', () => {
    const s = setup('test_crew', 'skilled');
    expect(simulateFight(s, 42)).toEqual(simulateFight(s, 42));
  });

  it('a perfect player beats two goons every time', () => {
    const r = simulate(setup('test_goons', 'perfect'), 50);
    expect(r.wins).toBe(50);
    expect(r.avgHpLeft).toBeGreaterThan(5);
  });

  it('better timing means more wins and less damage taken', () => {
    const good = simulate(setup('test_crew', 'skilled'), 100);
    const bad = simulate(setup('test_crew', 'none'), 100);
    expect(good.wins).toBeGreaterThanOrEqual(bad.wins);
    expect(good.avgTaken).toBeLessThan(bad.avgTaken);
  });

  it('stats matter: a stronger hero wins in fewer rounds', () => {
    const base = simulate(setup('test_crew', 'skilled'), 100);
    const strong = simulate(setup('test_crew', 'skilled', { attack: 3, maxHp: 30 }), 100);
    expect(strong.wins).toBe(100);
    expect(strong.avgRounds).toBeLessThan(base.avgRounds || 99);
  });

  it('every fight ends', () => {
    const r = simulate(setup('test_dummy', 'none', { attack: 0 }), 5);
    expect(r.wins + r.losses + r.timeouts).toBe(5);
  });
});
