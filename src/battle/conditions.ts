// Ring conditions: hazards, goals, house rules, the crowd and Hype specials.
// Plain data and small helpers, shared by the engine, the simulator, the
// sandbox and the encounter cards.

import type { BattleConditions, CrowdMood, CrowdSize, HazardDef, SpecialDef } from '../types/data';
import hazards from '../data/hazards.json';
import specials from '../data/specials.json';

export const HAZARDS = hazards as HazardDef[];
export const SPECIALS = specials as SpecialDef[];

export function hazard(id: string): HazardDef {
  const h = HAZARDS.find((x) => x.id === id);
  if (!h) throw new Error(`No hazard "${id}"`);
  return h;
}

export function special(id: string): SpecialDef {
  const s = SPECIALS.find((x) => x.id === id);
  if (!s) throw new Error(`No special "${id}"`);
  return s;
}

export const CROWD_SIZES: CrowdSize[] = ['quiet', 'normal', 'packed'];
export const CROWD_MOODS: CrowdMood[] = ['fair', 'home', 'away', 'rowdy'];

/** How much Hype a crowd gives for the same moment. */
export const CROWD_MULT: Record<CrowdSize, number> = { quiet: 0.5, normal: 1, packed: 1.5 };
/** Share of seats filled when the crowd size overrides the stage's own. */
export const CROWD_DENSITY: Record<CrowdSize, number> = { quiet: 0.25, normal: 0.7, packed: 1 };

export const CROWD_LABEL: Record<CrowdSize, string> = { quiet: 'Quiet', normal: 'Normal', packed: 'Packed' };
export const MOOD_LABEL: Record<CrowdMood, string> = {
  fair: 'Fair',
  home: 'On your side',
  away: 'Against you',
  rowdy: 'Rowdy',
};
export const MOOD_DESC: Record<CrowdMood, string> = {
  fair: 'The crowd just watches.',
  home: 'Your fans: now and then they throw you a snack (heals 2).',
  away: 'Their fans: now and then they throw junk at your team (1 damage).',
  rowdy: 'Anything goes: now and then junk flies at anyone in the ring (1 damage).',
};

export const GOAL_LABEL = { ko: 'Knock them all out', timed: 'Win within', survive: 'Survive' } as const;

/** Whether there's anything unusual about this fight. */
export function hasConditions(c?: BattleConditions): boolean {
  if (!c) return false;
  return !!(
    c.hazards?.length ||
    (c.goal && c.goal !== 'ko') ||
    c.noItems ||
    c.noRun ||
    (c.crowd && c.crowd !== 'normal') ||
    (c.mood && c.mood !== 'fair')
  );
}

/** Only the parts that differ from a plain match, or undefined when there are none. */
export function cleanConditions(c?: BattleConditions): BattleConditions | undefined {
  if (!hasConditions(c)) return undefined;
  const out: BattleConditions = {};
  if (c!.hazards?.length) out.hazards = [...c!.hazards];
  if (c!.goal && c!.goal !== 'ko') {
    out.goal = c!.goal;
    out.rounds = Math.max(1, Math.min(20, c!.rounds ?? 5));
  }
  if (c!.noItems) out.noItems = true;
  if (c!.noRun) out.noRun = true;
  if (c!.crowd && c!.crowd !== 'normal') out.crowd = c!.crowd;
  if (c!.mood && c!.mood !== 'fair') out.mood = c!.mood;
  return out;
}

/** The goal in a few words, e.g. "Survive 5 rounds". */
export function goalText(c?: BattleConditions): string {
  if (!c?.goal || c.goal === 'ko') return 'Knock them all out';
  return c.goal === 'timed' ? `Win within ${c.rounds ?? 5} rounds` : `Survive ${c.rounds ?? 5} rounds`;
}

/** Short lines describing the conditions, for cards and the HUD. */
export function conditionLines(c?: BattleConditions): string[] {
  if (!hasConditions(c)) return [];
  const out: string[] = [];
  if (c!.goal && c!.goal !== 'ko') out.push(goalText(c));
  for (const id of c!.hazards ?? []) {
    const h = HAZARDS.find((x) => x.id === id);
    if (h) out.push(h.name);
  }
  if (c!.noItems) out.push('No items');
  if (c!.noRun) out.push('No running');
  if (c!.crowd && c!.crowd !== 'normal') out.push(`${CROWD_LABEL[c!.crowd]} crowd`);
  if (c!.mood && c!.mood !== 'fair') out.push(`Crowd: ${MOOD_LABEL[c!.mood].toLowerCase()}`);
  return out;
}
