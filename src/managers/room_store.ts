// Where rooms made in the room editor are kept.
//
// In the published game link, they go into the link's own database (the
// artifact's `db` capability), shared by everyone who opens it: Stefano builds
// a room, anyone playing the link walks into it, and Claude can read it back to
// put it into the project's room files. Anywhere else (the local dev server,
// the browser test) they go into this browser's local storage instead.
//
// Each saved room is one document: rooms/<id> = { json, savedAt }.

import { ROOMS, BUILTIN_ROOMS } from '../field/rooms';
import type { RoomDef } from '../field/room_types';

type Backend = 'shared' | 'local' | 'none';

interface DocSnap {
  exists: boolean;
  id: string;
  data(): Record<string, unknown> | undefined;
}
interface DbLike {
  collection(path: string): { get(): Promise<{ docs: DocSnap[] }> };
  doc(path: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
}

const LOCAL_KEY = 'kid-chispa.rooms';
let backend: Backend = 'none';
let db: DbLike | null = null;
/** Ids of rooms that differ from (or don't exist in) the shipped files. */
const edited = new Set<string>();

function readLocal(): Record<string, RoomDef> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeLocal(all: Record<string, RoomDef>): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: edits last for this visit only */
  }
}

/** Connects to wherever saved rooms live and lays them over the shipped ones. */
export async function loadSavedRooms(timeoutMs = 4000): Promise<Backend> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    db = (await Promise.race([claude.use('db').catch(() => null), timeout])) as DbLike | null;
  }
  let saved: Record<string, RoomDef> = {};
  if (db) {
    try {
      const snap = await db.collection('rooms').get();
      for (const d of snap.docs) {
        const json = d.data()?.json;
        if (typeof json === 'string') saved[d.id] = JSON.parse(json);
      }
      backend = 'shared';
    } catch {
      db = null;
    }
  }
  if (!db) {
    saved = readLocal();
    backend = 'local';
  }
  for (const [id, room] of Object.entries(saved)) {
    ROOMS[id] = room;
    edited.add(id);
  }
  return backend;
}

export const RoomStore = {
  backend: (): Backend => backend,
  isEdited: (id: string) => edited.has(id),
  isBuiltin: (id: string) => id in BUILTIN_ROOMS,
  editedIds: () => [...edited],

  /** Saves a room as it is now in ROOMS. */
  async save(id: string): Promise<void> {
    const room = ROOMS[id];
    if (db)
      await db.doc(`rooms/${id}`).set({ json: JSON.stringify(room), savedAt: new Date().toISOString() });
    else {
      const all = readLocal();
      all[id] = room;
      writeLocal(all);
    }
    edited.add(id);
  },

  /** Drops the saved version: a shipped room goes back to how it is in the code, a new room is removed. */
  async revert(id: string): Promise<void> {
    if (db) await db.doc(`rooms/${id}`).delete();
    else {
      const all = readLocal();
      delete all[id];
      writeLocal(all);
    }
    edited.delete(id);
    if (id in BUILTIN_ROOMS) ROOMS[id] = structuredClone(BUILTIN_ROOMS[id]);
    else delete ROOMS[id];
  },
};
