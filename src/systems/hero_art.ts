// Kid Chispa's finished art: a frame-by-frame sprite sheet (96x96 frames, one
// row per animation; art/sprites/kid_chispa.png, re-cut from the painted sheet
// art/sprites/kid_chispa_v3_source.png by tools/art/recut_kid_chispa.py). It
// replaces the test wrestler wherever Kid Chispa appears, unless you gave him a
// skin. Earlier looks are kept as art/sprites/kid_chispa_v1.png and _v2.png.

import type Phaser from 'phaser';
import sheetUrl from '../assets/kid_chispa.png';
import type { SheetLook } from '../managers/builds';
import { drawSheetLook } from './sheets';
import { decodePicture } from './pictures';

export const HERO_ART = 'spr_kid_chispa';

export const HERO_SHEET: SheetLook = {
  url: sheetUrl,
  w: 768,
  h: 576,
  frameW: 96,
  frameH: 96,
  anims: {
    idle: { start: 0, count: 6, fps: 6 },
    walk: { start: 8, count: 8, fps: 12 },
    chop: { start: 16, count: 8, fps: 16 },
    hurt: { start: 24, count: 4, fps: 12 },
    ko: { start: 32, count: 6, fps: 10 },
    win: { start: 40, count: 6, fps: 8 },
  },
};

/** Loads and slices the hero sheet (start-up). */
export async function prepareHeroArt(scene: Phaser.Scene): Promise<void> {
  try {
    await decodePicture(HERO_SHEET.url);
    drawSheetLook(scene, HERO_ART, HERO_SHEET);
  } catch {
    /* the test wrestler stands in */
  }
}

/** Kid Chispa's texture: his finished art once it's loaded, else the test wrestler. */
export function heroSprite(scene: Phaser.Scene): string {
  return scene.textures.exists(HERO_ART) ? HERO_ART : 'spr_test_dummy';
}
