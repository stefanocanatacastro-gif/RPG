// Every room in the game. Each file in src/data/rooms holds a set of rooms by
// id (one file per chapter, plus the grey-box test rooms); they're merged here.

import type { RoomDef } from './room_types';

const files = import.meta.glob<Record<string, RoomDef>>('../data/rooms/*.json', {
  eager: true,
  import: 'default',
});

export const ROOMS: Record<string, RoomDef> = Object.assign({}, ...Object.values(files));
