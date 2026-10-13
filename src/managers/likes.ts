// Likes in the community gallery. Each person keeps one document listing what
// they like, likes/<their id>, which only they can change and everyone can
// read; counts are added up across all of them. Outside the game link, likes
// live in this browser (yours only).

import { artifactDb, viewerId, type DbLike } from './artifact_db';

const LOCAL_KEY = 'kid-chispa.likes';
let db: DbLike | null = null;
let uid: string | null = null;
/** Everyone's liked keys, by person. */
const all = new Map<string, Set<string>>();

/** What a like points at: kind and the creation's key, e.g. "fighter:ab12cd34.f1". */
export type LikeKey = string;

export async function loadLikes(timeoutMs = 4000): Promise<void> {
  db = await artifactDb(timeoutMs);
  uid = db ? await viewerId(timeoutMs) : null;
  all.clear();
  if (db && uid) {
    try {
      const snap = await db.collection('likes').get();
      for (const d of snap.docs) {
        const json = d.data()?.json;
        if (typeof json === 'string') all.set(d.id, new Set(JSON.parse(json) as string[]));
      }
      return;
    } catch {
      db = null;
    }
  }
  uid = null;
  try {
    all.set('me', new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as string[]));
  } catch {
    all.set('me', new Set());
  }
}

const me = () => uid ?? 'me';

export const Likes = {
  count(key: LikeKey): number {
    let n = 0;
    for (const s of all.values()) if (s.has(key)) n++;
    return n;
  },
  mine(key: LikeKey): boolean {
    return all.get(me())?.has(key) ?? false;
  },
  /** Likes or un-likes; resolves once saved. */
  async toggle(key: LikeKey): Promise<boolean> {
    const set = all.get(me()) ?? new Set<string>();
    all.set(me(), set);
    const on = !set.has(key);
    if (on) set.add(key);
    else set.delete(key);
    const json = JSON.stringify([...set]);
    if (db && uid) await db.doc(`likes/${uid}`).set({ json });
    else
      try {
        localStorage.setItem(LOCAL_KEY, json);
      } catch {
        /* lasts for this visit */
      }
    return on;
  },
};
