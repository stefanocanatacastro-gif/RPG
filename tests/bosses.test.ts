import { describe, expect, it } from 'vitest';
import { newFighter, toDefs } from '../src/managers/builds';
import { Database } from '../src/managers/database';
import { BattleEngine } from '../src/battle/engine';
import { SKILLS, simulate } from '../src/battle/simulate';
import { t } from '../src/managers/strings';

function fight(formation: string) {
  return new BattleEngine(
    Database,
    Database.character('chispa'),
    { hp: 20, maxHp: 20 },
    Database.formation(formation),
    1,
  );
}

describe('bosses', () => {
  it('Agent Brick is a huge boss that walks in', () => {
    const b = Database.enemy('agent_brick');
    expect(b.size).toBe('huge');
    expect(b.entrance).toBe('walk');
    expect(b.phase2?.atHp).toBe(0.5);
    expect(t(b.phase2!.line!)).not.toBe(b.phase2!.line);
  });

  it('switches to phase 2 at half HP: stronger, new pattern, reported once', () => {
    const e = fight('test_boss');
    const boss = e.enemies().find((f) => f.defId === 'agent_brick')!;
    const atk = boss.attack;
    expect(boss.phase).toBe(1);
    e.damage(boss.id, Math.floor(boss.maxHp / 2) - 1);
    expect(boss.phase).toBe(1);
    expect(e.takePhaseChanges()).toEqual([]);
    e.damage(boss.id, 1);
    expect(boss.phase).toBe(2);
    expect(boss.attack).toBe(atk + 1);
    expect(boss.ai).toBe(Database.enemy('agent_brick').phase2!.ai);
    expect(e.takePhaseChanges()).toEqual([boss.id]);
    expect(e.takePhaseChanges()).toEqual([]);
    // only once
    e.damage(boss.id, 1);
    expect(e.takePhaseChanges()).toEqual([]);
  });

  it('a knockout blow skips phase 2', () => {
    const e = fight('test_boss');
    const boss = e.enemies().find((f) => f.defId === 'agent_brick')!;
    e.damage(boss.id, boss.maxHp);
    expect(boss.hp).toBe(0);
    expect(e.takePhaseChanges()).toEqual([]);
  });

  it('the simulator can beat the boss fight', () => {
    const hero = Database.character('chispa');
    const r = simulate(
      {
        db: Database,
        hero,
        maxHp: 30,
        maxGrit: 10,
        attack: hero.attack + 2,
        defence: hero.defence + 1,
        formation: Database.formation('test_boss'),
        firstStrike: null,
        skill: SKILLS[1],
      },
      20,
    );
    expect(r.wins).toBeGreaterThan(0);
  });

  it('made bosses: entrance and phase 2 become game data', () => {
    const f = {
      ...newFighter('enemy', 'f9'),
      entrance: 'drop' as const,
      phase2: {
        atHp: 0.25,
        attack: 2,
        defence: 1,
        heal: 5,
        moves: ['running_lariat'],
        line: 'No more mister nice goon!',
      },
    };
    const { foe } = toDefs('me', f);
    expect(foe!.entrance).toBe('drop');
    expect(foe!.phase2).toMatchObject({
      atHp: 0.25,
      attack: 2,
      defence: 1,
      heal: 5,
      moves: ['running_lariat'],
    });
    expect(foe!.phase2!.ai.some((r) => r.move === 'running_lariat' && r.everyRounds === 2)).toBe(true);
    expect(t(foe!.phase2!.line!)).toBe('No more mister nice goon!');

    // a stat-only phase keeps the old moves and pattern
    const g = {
      ...newFighter('enemy', 'f10'),
      phase2: { atHp: 0.5, attack: 1, defence: 0, heal: 0, moves: [] },
    };
    const d = toDefs('me', g).foe!;
    expect(d.phase2!.moves).toEqual(d.moves);
    expect(d.phase2!.ai).toEqual(d.ai);
    expect(d.entrance).toBeUndefined();

    Database.registerCustom('c.me.', [], [foe!, d]);
    expect(Database.enemy(foe!.id).phase2?.moves).toEqual(['running_lariat']);
    expect(Database.enemy(d.id).phase2).toBeDefined();
    Database.unregisterCustom('c.me.');
  });
});
