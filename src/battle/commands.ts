// Action commands: the timing challenges that make each move hit harder.
//
//   stomp         — the classic double jump. Press just before you land on the
//                   opponent; get it right and you bounce for another hit, miss
//                   and the move ends after this hit. Pressing too early locks
//                   you out, so mashing doesn't work.
//   timed_press   — precision press. A ring closes in on the target; press the
//                   moment it lines up.
//   hold_release  — precision release. Hold the button while a bar fills and
//                   let go inside the lit zone. Hold too long and it fizzles.
//
// The functions here only judge timing, so they can be unit-tested; the battle
// scene draws the prompts and feeds them the times. All numbers are in
// battle_rules.json.

import rules from '../data/battle_rules.json';

export type Rating = 'great' | 'good' | 'miss';
/** Why a command missed, shown to help the player learn the timing. */
export type MissNote = 'early' | 'late' | 'none' | 'overheld';

export interface CommandResult {
  rating: Rating;
  note?: MissNote;
}

export const COMMANDS = rules.actionCommands;

/** Damage multiplier for a rating (stomp hits don't change damage; they decide whether the combo continues). */
export function ratingMult(command: string, rating: Rating): number {
  if (command === 'stomp' || command === 'none') return 1;
  return rules.ratingMult[rating];
}

/** Whether a miss on this command ends the move's remaining hits. */
export function missEndsCombo(command: string): boolean {
  return command === 'stomp';
}

/**
 * Double jump. `presses` are the times the button went down while falling;
 * `landAt` is when the attacker touches the opponent.
 */
export function judgeStomp(presses: number[], landAt: number, cfg = COMMANDS.stomp): CommandResult {
  const first = presses[0];
  if (first === undefined) return { rating: 'miss', note: 'none' };
  const d = first - landAt; // negative = before landing
  if (d < -cfg.windowMs) return { rating: 'miss', note: 'early' };
  if (d > cfg.lateMs) return { rating: 'miss', note: 'late' };
  return { rating: Math.abs(d) <= cfg.greatMs ? 'great' : 'good' };
}

/** Precision press: one press, judged by how far it was from the moment the ring lines up. */
export function judgePress(
  press: number | null,
  perfectAt: number,
  cfg = COMMANDS.timed_press,
): CommandResult {
  if (press === null) return { rating: 'miss', note: 'none' };
  const d = press - perfectAt;
  if (Math.abs(d) <= cfg.greatMs) return { rating: 'great' };
  if (Math.abs(d) <= cfg.goodMs) return { rating: 'good' };
  return { rating: 'miss', note: d < 0 ? 'early' : 'late' };
}

/** Ring size for a precision press: shrinks from the start size to the target size at perfectAt. */
export function ringRadius(now: number, startAt: number, cfg = COMMANDS.timed_press): number {
  const p = (now - startAt) / cfg.closeMs;
  return cfg.startRadius + (cfg.targetRadius - cfg.startRadius) * p;
}

/** How full the hold bar is (0–1) after holding for `heldMs`. */
export function holdFill(heldMs: number, cfg = COMMANDS.hold_release): number {
  return Math.max(0, Math.min(1, heldMs / cfg.fillMs));
}

/**
 * Precision release. `heldMs` is how long the button was held when released
 * (null if it was never pressed). Holding past full + overMs fizzles.
 */
export function judgeRelease(heldMs: number | null, cfg = COMMANDS.hold_release): CommandResult {
  if (heldMs === null) return { rating: 'miss', note: 'none' };
  if (heldMs > cfg.fillMs + cfg.overMs) return { rating: 'miss', note: 'overheld' };
  const fill = holdFill(heldMs, cfg);
  if (fill >= cfg.greatFrom) return { rating: 'great' };
  if (fill >= cfg.goodFrom) return { rating: 'good' };
  return { rating: 'miss', note: 'early' };
}

// ── Guarding against enemy attacks ────────────────────────────────────

export type GuardButton = 'block' | 'reversal';
export interface GuardJudgement {
  result: 'none' | 'block' | 'reversal';
  note?: MissNote;
}

/**
 * Block (A) or Reversal (B), judged on the first press during the enemy's
 * strike. Block has a generous window before contact; Reversal a tight one.
 * The first press is the only one that counts, so mashing locks you out.
 */
export function judgeGuard(
  press: { button: GuardButton; t: number } | null,
  contactAt: number,
  cfg = COMMANDS.guard,
): GuardJudgement {
  if (!press) return { result: 'none', note: 'none' };
  const d = press.t - contactAt;
  if (d > cfg.lateMs) return { result: 'none', note: 'late' };
  const window = press.button === 'block' ? cfg.blockWindowMs : cfg.reversalWindowMs;
  if (d < -window) return { result: 'none', note: 'early' };
  return { result: press.button };
}
