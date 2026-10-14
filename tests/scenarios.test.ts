import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/data/scenarios';
import { setupProblems, simSetupOf } from '../src/managers/battle_setup';
import { SKILLS, simulate } from '../src/battle/simulate';
import { Database } from '../src/managers/database';

describe('showcase fights', () => {
  it('have unique ids and can all be played', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) expect(setupProblems(s.setup), s.id).toEqual([]);
  });

  it('show off big, huge and drop-in bosses', () => {
    const sizes = new Set(
      SCENARIOS.flatMap((s) => s.setup.enemies.map((e) => Database.enemy(e.id).size ?? 'normal')),
    );
    expect([...sizes].sort()).toEqual(['big', 'huge', 'normal']);
    expect(Database.enemy('rafter_king').entrance).toBe('drop');
  });

  it('are winnable by a skilled player, and the first one by a casual one', () => {
    for (const s of SCENARIOS) {
      const [skilled, casual] = [SKILLS[1], SKILLS[2]].map((k) => {
        const r = simulate(simSetupOf(s.setup, k), 200, 7);
        return Math.round((100 * r.wins) / r.runs);
      });

      expect(skilled, `${s.id} skilled`).toBeGreaterThanOrEqual(60);
      if (s.id === 'dock_rumble') expect(casual).toBeGreaterThanOrEqual(80);
    }
  });
});
