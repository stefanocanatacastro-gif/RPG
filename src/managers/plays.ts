// Play records for battles: how often each one was played and won, by whom.
// Each person keeps one document, plays/<their id>, that only they can change
// and everyone can read; totals (plays, clears, clear rate) are added up across
// all of them, like likes. Outside the game link, records live in this browser.

import { artifactDb, viewerId, type DbLike } from './artifact_db';

const LOCAL_KEY = 'kid-chispa.plays';

/** One person's record on one battle. */
export interface PlayRecord {
  plays: number;
  wins: number;
  /** Fewest rounds to win. */
  best?: number;
  /** When they last played it (for "played recently"). */
  at?: string;
}

let db: DbLike | null = null;
let uid: string | null = null;
const all = new Map<string, Record<string, PlayRecord>>();
const me = () => uid ?? 'me';

export async function loadPlays(timeoutMs = 4000): Promise<void> {
  db = await artifactDb(timeoutMs);
  uid = db ? await viewerId(timeoutMs) : null;
  all.clear();
  if (db && uid) {
    try {
      const snap = await db.collection('plays').get();
      for (const d of snap.docs) {
        const json = d.data()?.json;
        if (typeof json === 'string') all.set(d.id, JSON.parse(json));
      }
      return;
    } catch {
      db = null;
    }
  }
  uid = null;
  try {
    all.set('me', JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}'));
  } catch {
    all.set('me', {});
  }
}

/** How hard a battle has proved, from everyone's clear rate (null until enough plays). */
export type Difficulty = 'easy' | 'normal' | 'expert' | 'super expert';
export const MIN_PLAYS_FOR_DIFFICULTY = 5;

export function difficultyOf(clearRate: number): Difficulty {
  return clearRate >= 0.7
    ? 'easy'
    : clearRate >= 0.4
      ? 'normal'
      : clearRate >= 0.15
        ? 'expert'
        : 'super expert';
}

export const Plays = {
  /** Everyone's totals on a battle. */
  totals(key: string): { plays: number; clears: number; players: number; rate: number | null } {
    let plays = 0;
    let clears = 0;
    let players = 0;
    for (const recs of all.values()) {
      const r = recs[key];
      if (!r) continue;
      plays += r.plays;
      clears += r.wins;
      players++;
    }
    return { plays, clears, players, rate: plays ? clears / plays : null };
  },

  /** Its difficulty from the clear rate, once enough people have tried it. */
  difficulty(key: string): Difficulty | null {
    const t = Plays.totals(key);
    return t.plays >= MIN_PLAYS_FOR_DIFFICULTY && t.rate !== null ? difficultyOf(t.rate) : null;
  },

  mine(key: string): PlayRecord | undefined {
    return all.get(me())?.[key];
  },

  /** Records a finished fight (not play-tests). Resolves once saved. */
  async record(key: string, won: boolean, rounds: number): Promise<PlayRecord> {
    const recs = all.get(me()) ?? {};
    all.set(me(), recs);
    const r = recs[key] ?? { plays: 0, wins: 0 };
    r.plays++;
    if (won) {
      r.wins++;
      r.best = r.best ? Math.min(r.best, rounds) : rounds;
    }
    r.at = new Date().toISOString();
    recs[key] = r;
    const json = JSON.stringify(recs);
    try {
      if (db && uid) await db.doc(`plays/${uid}`).set({ json });
      else localStorage.setItem(LOCAL_KEY, json);
    } catch {
      /* the record lasts for this visit */
    }
    return r;
  },
};
