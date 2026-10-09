// Turns room data into the shape the movement rules use, plus the list of exits
// in the same order as the shape's gates.

import { WORLD, octagonOutline, type RoomShape } from './world';
import type { RoomDef, RoomExit } from './room_types';

export function buildShape(room: RoomDef): { shape: RoomShape; exits: RoomExit[] } {
  const width = room.screens * WORLD.screenUnits;
  const outline = Array.isArray(room.outline)
    ? room.outline
    : room.outline
      ? octagonOutline(width, room.depth, room.outline.octagon)
      : undefined;
  if (outline) {
    const gates = room.gates ?? [];
    return {
      shape: {
        width,
        depth: room.depth,
        blocks: room.blocks,
        outline,
        gates: gates.map(({ edge, t0, t1 }) => ({ edge, t0, t1 })),
      },
      exits: gates.map(({ room: r, spawn }) => ({ room: r, spawn })),
    };
  }
  const doors = room.doors ?? [];
  return {
    shape: {
      width,
      depth: room.depth,
      blocks: room.blocks,
      openings: doors.map(({ side, z0, z1 }) => ({ side, z0, z1 })),
    },
    exits: doors.map(({ room: r, spawn }) => ({ room: r, spawn })),
  };
}
