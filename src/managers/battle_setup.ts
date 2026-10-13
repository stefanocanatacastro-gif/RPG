// What defines a fight built outside the story (sandbox, encounters), and the
// plain-data helpers around it. No Phaser here, so tests can use it.

import { Database } from './database';
import type { BattleConditions, FormationSlot, FormationDef } from '../types/data';
import { HAZARDS, cleanConditions } from '../battle/conditions';
import type { BattleEngine } from '../battle/engine';
import type { SimSetup, Skill } from '../battle/simulate';

/** Everything that defines a fight. Encounters store exactly this. */
export interface BattleSetup {
  hero: string;
  maxHp: number;
  attack: number;
  defence: number;
  grit: number;
  partner: string | null;
  enemies: { id: string; slot: FormationSlot }[];
  stage: string;
  firstStrike: 'player' | 'enemy' | null;
  /** What's in the bag at the start (item ids, up to 10). */
  items?: string[];
  /** Hazards, goal, house rules and crowd. Missing means a plain match. */
  conditions?: BattleConditions;
}

export function formationOf(s: BattleSetup): FormationDef {
  const f: FormationDef = {
    id: 'custom',
    enemies: s.enemies.map((e) => ({ enemy: e.id, slot: e.slot })),
    stage: s.stage,
  };
  const c = cleanConditions(s.conditions);
  if (c) f.conditions = c;
  return f;
}

/** What's wrong with a setup (a fighter deleted by its maker, no opponents…), or [] if it can be played. */
export function setupProblems(s: BattleSetup): string[] {
  const out: string[] = [];
  const chars = new Set(Database.data.characters.map((c) => c.id));
  const foes = new Set(Database.data.enemies.map((e) => e.id));
  if (!chars.has(s.hero)) out.push('its hero no longer exists');
  if (s.partner && !chars.has(s.partner)) out.push('its partner no longer exists');
  if (s.enemies.length === 0) out.push('it has no opponents');
  if (s.enemies.some((e) => !foes.has(e.id))) out.push('one of its opponents no longer exists');
  if (!Database.data.stages.some((st) => st.id === s.stage)) out.push('its arena no longer exists');
  const things = new Set(Database.data.items.map((i) => i.id));
  if ((s.items ?? []).some((i) => !things.has(i))) out.push('an item in its bag no longer exists');
  if ((s.conditions?.hazards ?? []).some((h) => !HAZARDS.some((x) => x.id === h)))
    out.push('one of its hazards no longer exists');
  return out;
}

/** The fight in numbers, read from the battle log. */
export function fightSummary(e: BattleEngine) {
  const sum = (re: RegExp) =>
    e.log.reduce((a, l) => {
      const m = l.match(re);
      return a + (m ? Number(m[1]) : 0);
    }, 0);
  const count = (re: RegExp) => e.log.filter((l) => re.test(l)).length;
  return {
    rounds: e.round,
    hp: e.hero.hp,
    maxHp: e.hero.maxHp,
    dealt:
      sum(/^(?:hero|partner) \S+ e\d+ -(\d+)/) +
      sum(/^dmg e\d+ -(\d+)/) +
      sum(/^(?:hero|partner) reversal e\d+ -(\d+)/),
    taken: sum(/^e\d+ \S+ (?:hero|partner) -(\d+)/),
    great: count(/^cmd \S+ great/),
    good: count(/^cmd \S+ good/),
    miss: count(/^cmd \S+ miss/),
    blocks: count(/^guardcmd block/),
    reversals: count(/^guardcmd reversal/),
    unguarded: count(/^guardcmd none/),
    seed: e.rng.seed,
  };
}

/** The simulator's view of a setup. */
export function simSetupOf(s: BattleSetup, skill: Skill): SimSetup {
  return {
    db: Database,
    hero: Database.character(s.hero),
    maxHp: s.maxHp,
    maxGrit: s.grit,
    attack: s.attack,
    defence: s.defence,
    partner: s.partner && s.partner !== s.hero ? Database.character(s.partner) : undefined,
    formation: formationOf(s),
    firstStrike: s.firstStrike,
    skill,
    items: s.conditions?.noItems ? [] : [...(s.items ?? [])],
  };
}
