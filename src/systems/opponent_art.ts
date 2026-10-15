// The built-in fighters' finished art (the opponents and Pip, the partner): frame-by-frame sprite sheets drawn by
// tools/art/opponents.py and tools/art/pip.py (one row per animation, like Kid Chispa's). They
// replace the placeholder boxes wherever an opponent appears, unless you gave
// it a skin.

import type Phaser from 'phaser';
import type { SheetLook } from '../managers/builds';
import { drawSheetLook } from './sheets';
import { decodePicture } from './pictures';
import dockGoon from '../assets/opponents/dock_goon.png';
import spikyBouncer from '../assets/opponents/spiky_bouncer.png';
import gullFlyer from '../assets/opponents/gull_flyer.png';
import sparringDummy from '../assets/opponents/sparring_dummy.png';
import ringsideBruiser from '../assets/opponents/ringside_bruiser.png';
import cornerMedic from '../assets/opponents/corner_medic.png';
import agentBrick from '../assets/opponents/agent_brick.png';
import tugboatTony from '../assets/opponents/tugboat_tony.png';
import rafterKing from '../assets/opponents/rafter_king.png';
import pip from '../assets/opponents/pip.png';

/** The usual rows: idle 4, walk 8, attack 6, hurt 3, knocked out 4, victory 4. */
function look(url: string, frame: number, fps: Partial<Record<'idle' | 'walk' | 'chop', number>> = {}): SheetLook {
  return {
    url,
    w: frame * 8,
    h: frame * 6,
    frameW: frame,
    frameH: frame,
    anims: {
      idle: { start: 0, count: 4, fps: fps.idle ?? 5 },
      walk: { start: 8, count: 8, fps: fps.walk ?? 12 },
      chop: { start: 16, count: 6, fps: fps.chop ?? 12 },
      hurt: { start: 24, count: 3, fps: 10 },
      ko: { start: 32, count: 4, fps: 9 },
      win: { start: 40, count: 4, fps: 8 },
    },
  };
}

export const OPPONENT_ART: Record<string, SheetLook> = {
  dock_goon: look(dockGoon, 96),
  spiky_bouncer: look(spikyBouncer, 96),
  gull_flyer: look(gullFlyer, 96, { idle: 8, walk: 12 }),
  sparring_dummy: look(sparringDummy, 96, { idle: 4 }),
  ringside_bruiser: look(ringsideBruiser, 96, { chop: 10 }),
  corner_medic: look(cornerMedic, 96),
  agent_brick: look(agentBrick, 240, { idle: 4, walk: 8, chop: 9 }),
  tugboat_tony: look(tugboatTony, 144, { idle: 4, walk: 10, chop: 10 }),
  rafter_king: look(rafterKing, 144),
  pip: look(pip, 120, { idle: 5, walk: 12, chop: 10 }),
};

export const artKey = (id: string) => `spr_art_${id}`;

/** Loads and slices every opponent's sheet (start-up). */
export async function prepareOpponentArt(scene: Phaser.Scene): Promise<void> {
  await Promise.all(
    Object.entries(OPPONENT_ART).map(async ([id, sheet]) => {
      try {
        await decodePicture(sheet.url);
        drawSheetLook(scene, artKey(id), sheet);
      } catch {
        /* the placeholder box stands in */
      }
    }),
  );
}

/** An opponent's finished art, when it has some and it's loaded. */
export function opponentArt(scene: Phaser.Scene, id: string): string | null {
  return OPPONENT_ART[id] && scene.textures.exists(artKey(id)) ? artKey(id) : null;
}
