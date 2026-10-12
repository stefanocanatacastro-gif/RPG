// Experience and levels. The XP needed to go from one level to the next grows
// steadily (numbers in battle_rules.json). Choosing what a level-up improves
// (HP, Grit or PP, like TTYD) comes with the core systems milestone; for now a
// level-up fully restores HP and Grit.

import rules from '../data/battle_rules.json';

const L = rules.levelUp;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return L.xpBase + L.xpGrowth * (level - 1);
}

export interface XpResult {
  level: number;
  xp: number;
  levelsGained: number;
}

/** Adds XP, rolling over into as many levels as it covers. */
export function addXp(level: number, xp: number, gained: number): XpResult {
  let lv = level;
  let total = xp + Math.max(0, Math.round(gained));
  let levelsGained = 0;
  while (lv < L.maxLevel && total >= xpToNext(lv)) {
    total -= xpToNext(lv);
    lv++;
    levelsGained++;
  }
  if (lv >= L.maxLevel) total = 0;
  return { level: lv, xp: total, levelsGained };
}
