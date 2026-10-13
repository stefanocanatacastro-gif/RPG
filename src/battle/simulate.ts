// Headless battle simulator for balancing. Plays whole fights through the real
// BattleEngine with no scene: the hero follows a simple sensible plan and the
// player's timing is rolled from a skill profile. Running a line-up a few
// hundred times answers "how hard is this fight?" in a second.

import { BattleEngine, computeDamage, type Lookup } from './engine';
import { missEndsCombo, ratingMult, type Rating } from './commands';
import { Rng } from '../systems/rng';
import type { CharacterDef, FormationDef } from '../types/data';
import rules from '../data/battle_rules.json';
import { SPECIALS } from './conditions';

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
  /** Item ids in the bag. The simulated player heals when low and keeps revives for a knockout. */
  items?: string[];
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
  const bag = setup.formation.conditions?.noItems ? [] : [...(setup.items ?? [])];
  const itemOf = (id: string) => db.item(id);
  /** Takes the first bag item matching, if any. */
  const take = (match: (fx: ReturnType<typeof itemOf>['effect']) => boolean): string | null => {
    const i = bag.findIndex((id) => match(itemOf(id).effect));
    return i < 0 ? null : bag.splice(i, 1)[0];
  };
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

  /** Knocked out with a revive in the bag: back up. */
  const revive = () => {
    if (e.hero.hp > 0) return;
    const rev = take((fx) => !!fx.revive);
    if (rev) e.hero.hp = Math.min(e.hero.maxHp, itemOf(rev).effect.revive!);
  };
  const special = (id: string) => SPECIALS.find((x) => x.id === id);
  /** Grades a hit or block for Hype, as the scene does. */
  const hypeFor = (r: Rating) => {
    if (r === 'great') e.gainHype('great');
    else if (r === 'good') e.gainHype('good');
  };

  for (let guard = 0; guard < 1000 && e.round <= MAX_ROUNDS; guard++) {
    // the ring and the crowd at the start of a round
    if (e.takeEvents().length) {
      revive();
      e.settle();
      continue;
    }
    if (e.phase === 'command') {
      const me = e.acting;
      // Hype to spend: the big finish on a crowd, a rally when hurt
      const show = special('showstopper');
      const rally = special('rally');
      if (show && e.canUseSpecial(show.id) && e.enemies().length >= 2) {
        e.beginHeroAction();
        for (const r of e.useSpecial(show.id).hits) dealt += r.damage;
        e.endHeroAction();
        continue;
      }
      if (rally && e.canUseSpecial(rally.id) && me.hp <= me.maxHp * 0.5) {
        e.beginHeroAction();
        e.useSpecial(rally.id);
        e.endHeroAction();
        continue;
      }
      // low on HP with a healing item in the bag: use it instead of attacking
      if (me.hp <= me.maxHp * 0.35) {
        const heal = take((fx) => !!fx.heal);
        if (heal) {
          e.beginHeroAction();
          e.healHero(itemOf(heal).effect.heal!, e.turn);
          e.endHeroAction();
          continue;
        }
      }
      let best: { move: string; target: string; s: number } | null = null;
      for (const id of e.acting.moves) {
        if (!e.canUseMove(id, grit).ok) continue;
        for (const t of e.targetsFor(id)) {
          const s = score(id, t.id);
          if (!best || s > best.s) best = { move: id, target: t.id, s };
        }
      }
      if (!best) {
        e.beginHeroAction();
        // nothing to hit: play to the crowd if it's worth it, otherwise guard
        if (e.hype < e.maxHype) e.appeal();
        else e.defend();
        e.endHeroAction();
        continue;
      }
      const m = db.move(best.move);
      grit -= m.gritCost;
      e.beginHeroAction();
      const hz = e.moveHazard(e.turn, best.move);
      if (hz.slip || hz.ko) {
        revive();
        e.endHeroAction();
        continue;
      }
      let rating: Rating | null = m.command !== 'none' && m.command !== 'stomp' ? roll(rng, skill) : null;
      for (const step of m.steps) {
        if (step.do !== 'hit') continue;
        if (e.get(best.target).hp <= 0) break;
        const r: Rating = m.command === 'stomp' ? roll(rng, skill) : (rating ?? 'good');
        const mult = (step.mult ?? 1) * (m.command === 'none' ? 1 : ratingMult(m.command, r));
        const res = e.hit(e.turn, best.target, best.move, mult);
        dealt += res.damage;
        if (m.command !== 'none') hypeFor(r);
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
        else if (plan.kind !== 'charge' && !e.moveHazard(plan.actor, plan.move).slip) {
          for (const step of m.steps) {
            const victim = e.get(plan.target);
            if (step.do !== 'hit' || victim.hp <= 0 || e.get(plan.actor).hp <= 0) continue;
            const before = victim.hp;
            e.hit(plan.actor, plan.target, plan.move, step.mult ?? 1, rollGuard(rng, skill));
            taken += before - victim.hp;
          }
        }
      }
      revive();
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
