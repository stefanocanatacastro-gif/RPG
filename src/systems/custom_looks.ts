// Drawing made fighters: the wrestler body recoloured for each one.

import Phaser from 'phaser';
import { paletteSwap } from './anim_builder';
import { TEST_COLORS } from './test_sprites';
import { Builds, type ColorSlot } from '../managers/builds';
import { drawLook, maxWidthFor } from './pictures';
import { Database } from '../managers/database';
import { opponentArt } from './opponent_art';

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

/** Makes sure a made fighter's texture exists: the recoloured wrestler, its pictures or its sheet. */
export function ensureLook(scene: Phaser.Scene, gid: string): void {
  const l = Builds.lookOf(gid);
  if (!l) return;
  if (l.look.base === 'wrestler') paintWrestler(scene, l.key, l.look.colors ?? {});
  else drawLook(scene, l.key, l.look, maxWidthFor(l.size));
}

/** Whether a made fighter is drawn from uploaded pictures (they face right, and have no animations). */
export function isPictureLook(gid: string): boolean {
  return Builds.lookOf(gid)?.look.base === 'picture';
}

/**
 * The texture to draw a fighter with: your skin when you gave it one, a made
 * fighter's own look, or `fallback` (its usual sprite); a skin still loading
 * falls back too. `ownSize`: the art was made at its size (pictures and
 * sheets), so big and huge fighters aren't scaled up again.
 */
export function fighterTexture(
  scene: Phaser.Scene,
  defId: string,
  fallback: string,
): { key: string; ownSize: boolean } {
  const own = (base: string) => base === 'picture' || base === 'sheet';
  const skin = Builds.skinOf(defId);
  if (skin) {
    if (skin.look.base === 'wrestler') paintWrestler(scene, skin.key, skin.look.colors ?? {});
    else drawLook(scene, skin.key, skin.look, maxWidthFor(skin.size));
    if (scene.textures.exists(skin.key)) return { key: skin.key, ownSize: own(skin.look.base) };
    return { key: fallback, ownSize: false };
  }
  const l = Builds.lookOf(defId);
  if (l) {
    ensureLook(scene, defId);
    return { key: l.key, ownSize: own(l.look.base) };
  }
  // the built-in opponents' finished art, drawn at their size
  const art = opponentArt(scene, defId);
  if (art) return { key: art, ownSize: true };
  return { key: fallback, ownSize: false };
}

/** A built-in fighter's usual sprite (Kid Chispa uses the test wrestler until his real art exists). */
export function baseSprite(defId: string): string {
  if (defId === 'chispa') return 'spr_kid_chispa';
  return (
    Database.data.characters.find((c) => c.id === defId)?.sprite ??
    Database.data.enemies.find((e) => e.id === defId)?.sprite ??
    'spr_test_dummy'
  );
}
