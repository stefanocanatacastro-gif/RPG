// Every room in the game. Each file in src/data/rooms holds a set of rooms by
// id (one file per chapter, plus the grey-box test rooms); they're merged here.
// Rooms made or changed in the room editor are laid on top at start-up (see
// managers/room_store.ts), so ROOMS is the live set and BUILTIN_ROOMS the
// rooms as shipped in the code.

import type { RoomDef } from './room_types';

const files = import.meta.glob<Record<string, RoomDef>>('../data/rooms/*.json', {
  eager: true,
  import: 'default',
});

export const BUILTIN_ROOMS: Readonly<Record<string, RoomDef>> = Object.freeze(
  Object.assign({}, ...Object.values(files)),
);

export const ROOMS: Record<string, RoomDef> = structuredClone({ ...BUILTIN_ROOMS });
