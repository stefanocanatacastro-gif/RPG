// Rooms made or changed in the room editor. On the published game they're kept
// in the page's own database (shared, and readable by Claude to copy into the
// code); anywhere else (local dev server) in this browser's storage. At startup
// the saved versions replace the built-in rooms, so edits play straight away.
//
// Each saved room carries its own text (`strings`): the editor gives typed text
// keys like room.<room>.<thing>.<n>, and those are added to the string table.

import { ROOMS } from './rooms';
import type { RoomDef } from './room_types';
import { addStrings } from '../managers/strings';

export interface SavedRoom {
  room: RoomDef;
  strings: Record<string, string>;
  savedAt: string;
}

type DocSnap = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };
interface Db {
  collection(path: string): {
    get(): Promise<{ docs: DocSnap[] }>;
    doc(id: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
  };
}
type ClaudeRuntime = { use(name: string): Promise<unknown> };

const LOCAL_KEY = 'kc.rooms';
const COLLECTION = 'rooms';

let db: Db | null = null;
let kind: 'shared' | 'browser' = 'browser';
/** The built-in version of every room, before any saved edits. */
const builtIn: Record<string, RoomDef> = structuredClone(ROOMS);
const saved: Record<string, SavedRoom> = {};

/** Where edits go: the published page's database, or this browser only. */
export function storeKind(): 'shared' | 'browser' {
  return kind;
}

export function isEdited(id: string): boolean {
  return id in saved;
}

export function isBuiltIn(id: string): boolean {
  return id in builtIn;
}

export function savedStrings(id: string): Record<string, string> {
  return { ...(saved[id]?.strings ?? {}) };
}

function readLocal(): Record<string, SavedRoom> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, SavedRoom>;
  } catch {
    return {};
  }
}

function writeLocal(all: Record<string, SavedRoom>): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    // storage blocked or full: edits last until the page closes
  }
}

function apply(id: string, s: SavedRoom): void {
  saved[id] = s;
  ROOMS[id] = structuredClone(s.room);
  addStrings(s.strings);
}

/** Finds the page database (if this is the published game) and loads saved rooms. */
export async function initRoomStore(timeoutMs = 4000): Promise<void> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (claude?.use) {
    const got = await Promise.race([
      claude.use('db').catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    db = (got as Db | null) ?? null;
  }
  kind = db ? 'shared' : 'browser';
  try {
    if (db) {
      const snap = await db.collection(COLLECTION).get();
      for (const d of snap.docs) {
        const body = d.data() as unknown as SavedRoom | undefined;
        if (body?.room) apply(d.id, body);
      }
      return;
    }
  } catch {
    // database unreachable: fall back to this browser's copy
    kind = 'browser';
    db = null;
  }
  for (const [id, s] of Object.entries(readLocal())) if (s?.room) apply(id, s);
}

/** Saves a room (and its text). Resolves with where it went. */
export async function saveRoom(
  id: string,
  room: RoomDef,
  strings: Record<string, string>,
): Promise<'shared' | 'browser'> {
  const s: SavedRoom = {
    room: structuredClone(room),
    strings: { ...strings },
    savedAt: new Date().toISOString(),
  };
  if (db) {
    await db
      .collection(COLLECTION)
      .doc(id)
      .set(s as unknown as Record<string, unknown>);
  } else {
    const all = readLocal();
    all[id] = s;
    writeLocal(all);
  }
  apply(id, s);
  return kind;
}

/** Drops the saved edits: built-in rooms go back to how they ship, new rooms are deleted. */
export async function revertRoom(id: string): Promise<void> {
  if (db) await db.collection(COLLECTION).doc(id).delete();
  else {
    const all = readLocal();
    delete all[id];
    writeLocal(all);
  }
  delete saved[id];
  if (builtIn[id]) ROOMS[id] = structuredClone(builtIn[id]);
  else delete ROOMS[id];
}
