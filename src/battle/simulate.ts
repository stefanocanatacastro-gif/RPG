// Headless battle simulator for balancing. Plays whole fights through the real
// BattleEngine with no scene: the hero follows a simple sensible plan and the
// player's timing is rolled from a skill profile. Running a line-up a few
// hundred times answers "how hard is this fight?" in a second.

import { BattleEngine, computeDamage, type Lookup } from './engine';
import { missEndsCombo, ratingMult, type Rating } from './commands';
import { Rng } from '../systems/rng';
import type { CharacterDef, FormationDef } from '../types/data';
import rules from '../data/battle_rules.json';

/** How well the simulated player times things, as chances (the rest misses). */
export interface Skill {
  id: string;
  great: number;
  good: number;
  block: number;
  reversal: number;
}

export const SKILLS: Skill[] = [
  { id: 'perfect', great: 1, good: 0, block: 1, reversal: 0 },
  { id: 'skilled', great: 0.5, good: 0.4, block: 0.6, reversal: 0.1 },
  { id: 'casual', great: 0.15, good: 0.5, block: 0.35, reversal: 0.02 },
  { id: 'none', great: 0, good: 0, block: 0, reversal: 0 },
];

export interface SimSetup {
  db: Lookup;
  hero: CharacterDef;
  maxHp: number;
  maxGrit: number;
  /** A partner fighting alongside, at full HP. */
  partner?: CharacterDef;
  attack: number;
  defence: number;
  formation: FormationDef;
  firstStrike: 'player' | 'enemy' | null;
  skill: Skill;
}

export interface FightOutcome {
  result: 'win' | 'lose' | 'timeout';
  rounds: number;
  hpLeft: number;
  dealt: number;
  taken: number;
}

export interface SimReport {
  runs: number;
  wins: number;
  losses: number;
  timeouts: number;
  /** Averages over won fights. */
  avgRounds: number;
  avgHpLeft: number;
  minHpLeft: number;
  avgTaken: number;
}

const MAX_ROUNDS = 40;

function roll(rng: Rng, s: Skill): Rating {
  const r = rng.next();
  return r < s.great ? 'great' : r < s.great + s.good ? 'good' : 'miss';
}

function rollGuard(rng: Rng, s: Skill): 'none' | 'block' | 'reversal' {
  const r = rng.next();
  return r < s.reversal ? 'reversal' : r < s.reversal + s.block ? 'block' : 'none';
}

/** One fight. `seed` drives both the engine and the timing rolls, so a fight replays exactly. */
export function simulateFight(setup: SimSetup, seed: number): FightOutcome {
  const { db, skill } = setup;
  const p = setup.partner;
  const e = new BattleEngine(
    db,
    setup.hero,
    { hp: setup.maxHp, maxHp: setup.maxHp },
    setup.formation,
    seed,
    p ? { def: p, hp: p.hp, maxHp: p.hp } : undefined,
  );
  e.hero.attack = setup.attack;
  e.hero.defence = setup.defence;
  const rng = new Rng(seed ^ 0x5eed);
  let grit = setup.maxGrit;
  let dealt = 0;
  let taken = 0;

  if (setup.firstStrike === 'player') {
    const t = e.frontGround() ?? e.enemies()[0];
    if (t) dealt += e.damage(t.id, rules.firstStrikeDamage + e.hero.attack).damage;
  }
  e.begin(setup.firstStrike === 'enemy' ? 'enemy' : null);
  if (e.enemies().length === 0) e.phase = 'victory';

  /** Expected damage of a move on a target, with a bonus for KOs and for taking out healers. */
  const score = (moveId: string, targetId: string): number => {
    const m = db.move(moveId);
    const t = e.get(targetId);
    const hits = m.steps.filter((s) => s.do === 'hit').length;
    const mult =
      skill.great * ratingMult(m.command, 'great') +
      skill.good * ratingMult(m.command, 'good') +
      (1 - skill.great - skill.good) * ratingMult(m.command, 'miss');
    const per = computeDamage(m.power, e.acting.attack, t.defence, { mult, piercing: m.piercing });
    // a double jump only keeps going on a successful press
    const keep = m.command === 'stomp' ? skill.great + skill.good : 1;
    let total = 0;
    for (let i = 0, p = 1; i < hits; i++, p *= keep) total += per * p;
    let s = Math.min(total, t.hp);
    if (total >= t.hp) s += 2;
    if (db.enemy(t.defId).ai.some((r) => db.move(r.move).heal)) s *= 1.5;
    if (t.charging) s *= 1.3;
    return s - m.gritCost * 0.05;
  };

  for (let guard = 0; guard < 1000 && e.round <= MAX_ROUNDS; guard++) {
    if (e.phase === 'command') {
      let best: { move: string; target: string; s: number } | null = null;
      for (const id of e.acting.moves) {
        if (!e.canUseMove(id, grit).ok) continue;
        for (const t of e.targetsFor(id)) {
          const s = score(id, t.id);
          if (!best || s > best.s) best = { move: id, target: t.id, s };
        }
      }
      if (!best) {
        e.defend();
        e.endHeroAction();
        continue;
      }
      const m = db.move(best.move);
      grit -= m.gritCost;
      e.beginHeroAction();
      let rating: Rating | null = m.command !== 'none' && m.command !== 'stomp' ? roll(rng, skill) : null;
      for (const step of m.steps) {
        if (step.do !== 'hit') continue;
        if (e.get(best.target).hp <= 0) break;
        const r: Rating = m.command === 'stomp' ? roll(rng, skill) : (rating ?? 'good');
        const mult = (step.mult ?? 1) * (m.command === 'none' ? 1 : ratingMult(m.command, r));
        const res = e.hit(e.turn, best.target, best.move, mult);
        dealt += res.damage;
        if (r === 'great' && !res.ko) e.breakCharge(best.target);
        rating = null;
        if (m.command === 'stomp' && r === 'miss' && missEndsCombo('stomp')) break;
      }
      e.endHeroAction();
    } else if (e.phase === 'enemy') {
      const plan = e.nextEnemyPlan();
      if (plan) {
        const m = db.move(plan.move);
        if (plan.kind === 'support') e.healFighter(plan.target, m.heal ?? 0);
        else if (plan.kind !== 'charge') {
          for (const step of m.steps) {
            const victim = e.get(plan.target);
            if (step.do !== 'hit' || victim.hp <= 0 || e.get(plan.actor).hp <= 0) continue;
            const before = victim.hp;
            e.hit(plan.actor, plan.target, plan.move, step.mult ?? 1, rollGuard(rng, skill));
            taken += before - victim.hp;
          }
        }
      }
      e.endEnemyAction();
    } else break;
  }

  const result = e.phase === 'victory' ? 'win' : e.phase === 'defeat' ? 'lose' : 'timeout';
  return { result, rounds: e.round, hpLeft: e.hero.hp, dealt, taken };
}

/** Runs a line-up `runs` times with consecutive seeds from `seed`. */
export function simulate(setup: SimSetup, runs: number, seed = 1): SimReport {
  const out = Array.from({ length: runs }, (_, i) => simulateFight(setup, (seed + i * 7919) >>> 0));
  const wins = out.filter((o) => o.result === 'win');
  const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  return {
    runs,
    wins: wins.length,
    losses: out.filter((o) => o.result === 'lose').length,
    timeouts: out.filter((o) => o.result === 'timeout').length,
    avgRounds: avg(wins.map((o) => o.rounds)),
    avgHpLeft: avg(wins.map((o) => o.hpLeft)),
    minHpLeft: wins.length ? Math.min(...wins.map((o) => o.hpLeft)) : 0,
    avgTaken: avg(out.map((o) => o.taken)),
  };
}
