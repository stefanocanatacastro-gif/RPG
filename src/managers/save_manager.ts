// Save slots: three the player chooses (at save blocks) plus an autosave
// written every time a room is entered. Continue on the title loads whichever
// is newest.
//
// In the game link, saves live in the viewer's own private corner of the
// link's database (data/users/<their id>/), so they follow the player to any
// browser and nobody else can see them. Anywhere else they go into this
// browser's local storage.

import type { SaveData } from './game_state';
import { migrateSave } from './game_state';
import { artifactDb, viewerId, type DbLike } from './artifact_db';

export const SLOTS = ['auto', '1', '2', '3'] as const;
export type SlotId = (typeof SLOTS)[number];

/** What the slot list shows without loading the whole save. */
export interface SlotMeta {
  savedAt: string;
  room: string;
  roomName: string;
  level: number;
  playTimeMs: number;
  coins: number;
  partner: string | null;
}

interface Stored {
  json: string;
  meta: SlotMeta;
}

const LOCAL_KEY = 'kid-chispa.saves';
let db: DbLike | null = null;
let uid: string | null = null;
const cache = new Map<SlotId, Stored>();

function readLocal(): Partial<Record<SlotId, Stored>> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeLocal(): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* storage blocked: saves last for this visit */
  }
}

const docPath = (slot: SlotId) => `data/users/${uid}/save_${slot}`;

/** Reads every slot once at start-up so the title screen can list them straight away. */
export async function loadSaveSlots(timeoutMs = 4000): Promise<'shared' | 'local'> {
  cache.clear();
  db = await artifactDb(timeoutMs);
  uid = db ? await viewerId(timeoutMs) : null;
  if (db && uid) {
    try {
      const snap = await db.collection(`data/users/${uid}`).get();
      for (const d of snap.docs) {
        const slot = d.id.replace(/^save_/, '') as SlotId;
        const body = d.data() as Stored | undefined;
        if (SLOTS.includes(slot) && body?.json) cache.set(slot, body);
      }
      return 'shared';
    } catch {
      db = null;
    }
  }
  db = null;
  for (const [slot, body] of Object.entries(readLocal())) if (body) cache.set(slot as SlotId, body);
  return 'local';
}

export const SaveManager = {
  backend: (): 'shared' | 'local' => (db && uid ? 'shared' : 'local'),

  meta(slot: SlotId): SlotMeta | null {
    return cache.get(slot)?.meta ?? null;
  },

  hasAny(): boolean {
    return cache.size > 0;
  },

  /** The most recently saved slot, for Continue. */
  latest(): SlotId | null {
    let best: SlotId | null = null;
    for (const [slot, s] of cache) if (!best || s.meta.savedAt > cache.get(best)!.meta.savedAt) best = slot;
    return best;
  },

  async save(slot: SlotId, data: SaveData, roomName: string): Promise<void> {
    const body: Stored = {
      json: JSON.stringify(data),
      meta: {
        savedAt: new Date().toISOString(),
        room: data.room,
        roomName,
        level: data.level,
        playTimeMs: Math.round(data.playTimeMs),
        coins: data.coins,
        partner: data.activePartner,
      },
    };
    cache.set(slot, body);
    if (db && uid) await db.doc(docPath(slot)).set(body as unknown as Record<string, unknown>);
    else writeLocal();
  },

  /** The save in a slot, upgraded to the current save format. */
  load(slot: SlotId): SaveData | null {
    const s = cache.get(slot);
    return s ? migrateSave(JSON.parse(s.json)) : null;
  },

  async remove(slot: SlotId): Promise<void> {
    cache.delete(slot);
    if (db && uid) await db.doc(docPath(slot)).delete();
    else writeLocal();
  },
};

/** "1:05" style play time. */
export function playTime(ms: number): string {
  const min = Math.floor(ms / 60000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
