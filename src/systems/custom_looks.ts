// Drawing made fighters: the wrestler body recoloured for each one.

import Phaser from 'phaser';
import { paletteSwap } from './anim_builder';
import { TEST_COLORS } from './test_sprites';
import { Builds, type ColorSlot } from '../managers/builds';

/** Colours each texture was last painted with, so unchanged looks aren't repainted. */
const painted = new Map<string, string>();

/**
 * The wrestler body recoloured; its animations come along. Repainting replaces
 * the texture, so nothing may be showing it at that moment.
 */
export function paintWrestler(
  scene: Phaser.Scene,
  key: string,
  colors: Partial<Record<ColorSlot, number>>,
): void {
  const sig = JSON.stringify(colors);
  if (painted.get(key) === sig && scene.textures.exists(key)) return;
  painted.set(key, sig);
  const C = TEST_COLORS;
  const lighter = (c: number) => {
    const col = Phaser.Display.Color.IntegerToColor(c).lighten(12);
    return Phaser.Display.Color.GetColor(col.red, col.green, col.blue);
  };
  const map: Record<number, number> = {};
  if (colors.skin !== undefined) map[C.skin] = colors.skin;
  if (colors.mask !== undefined) map[C.mask] = colors.mask;
  if (colors.shirt !== undefined) {
    map[C.shirt] = colors.shirt;
    map[C.shirtHi] = lighter(colors.shirt);
  }
  if (colors.trunks !== undefined) map[C.trunks] = colors.trunks;
  if (colors.boots !== undefined) map[C.boots] = colors.boots;
  paletteSwap(scene, 'spr_test_dummy', key, map, {
    fps: { idle: 3, walk: 8, chop: 12, hurt: 6 },
    once: ['chop', 'hurt'],
  });
}

/** Makes sure a made fighter's coloured texture exists (made on first use). */
export function ensureLook(scene: Phaser.Scene, gid: string): void {
  const l = Builds.lookOf(gid);
  if (!l || l.look.base !== 'wrestler') return;
  paintWrestler(scene, l.key, l.look.colors ?? {});
}
