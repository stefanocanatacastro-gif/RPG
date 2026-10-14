// Fighters drawn from frame-by-frame sprite sheets. The sheet is sliced into
// frames named like any animated sprite (idle_00, walk_03…), so battles and the
// field play them without knowing where they came from. Animations the sheet
// doesn't have are made from its first idle frame, paper-cutout style.

import type Phaser from 'phaser';
import { SHEET_ANIMS, SHEET_ONCE, type SheetAnim, type SheetLook } from '../managers/builds';
import { animKey, buildAnimations } from './anim_builder';
import { bends, decodePicture, decodedPicture, loadImage } from './pictures';
import { hardenAlpha, removeBackground, type Pixels } from './picture_ops';
import { detectGrid, guessAnims, hasTransparency } from './sheet_ops';
import { storeImage } from '../managers/artifact_db';

const drawn = new Map<string, string>();

/** Paper-cutout stand-ins, made when the sheet has no such row. */
const FALLBACK: SheetAnim[] = ['walk', 'chop', 'hurt'];
const FALLBACK_FPS: Record<string, number> = { walk: 10, chop: 12, hurt: 8 };

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * Makes (or remakes) a sheet look's texture under `key`, with its animations.
 * Returns false while the sheet is still loading (it is drawn on a later call).
 * Nothing may be showing the texture while it's replaced.
 */
export function drawSheetLook(scene: Phaser.Scene, key: string, sheet: SheetLook): boolean {
  const sig = `${sheet.url.length}:${sheet.url.slice(-48)}:${JSON.stringify({ ...sheet, url: '' })}`;
  if (drawn.get(key) === sig && scene.textures.exists(key)) return true;
  const img = decodedPicture(sheet.url);
  if (!img) {
    void decodePicture(sheet.url);
    return false;
  }
  const { frameW: fw, frameH: fh } = sheet;
  const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
  const idle = sheet.anims.idle ?? { start: 0, count: 1, fps: 6 };
  const missing = FALLBACK.filter((a) => !sheet.anims[a]);
  const all = bends(1);
  // room around a bent frame to lean and hop
  const mx = Math.ceil(fw * 0.25);
  const my = Math.ceil(fh * 0.12);
  const bw = fw + mx * 2;
  const bh = fh + my;
  const extra = missing.reduce((n, a) => n + all[a as 'walk' | 'chop' | 'hurt'].length, 0);

  // the atlas: the sheet as it is, and a strip of bent frames under it
  const atlas = canvas(Math.max(img.naturalWidth, extra * bw), img.naturalHeight + (extra ? bh : 0));
  const ctx = atlas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const flipCell = (sx: number, sy: number) => {
    // a sheet drawn facing left: mirror each frame where it is
    ctx.save();
    ctx.translate(sx + fw, sy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, fw, fh, 0, 0, fw, fh);
    ctx.restore();
  };
  if (sheet.flip) {
    const rows = Math.floor(img.naturalHeight / fh);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) flipCell(c * fw, r * fh);
  } else ctx.drawImage(img, 0, 0);

  const frames: { name: string; x: number; y: number; w: number; h: number }[] = [];
  for (const a of SHEET_ANIMS) {
    const run = sheet.anims[a];
    if (!run) continue;
    for (let i = 0; i < run.count; i++) {
      const cell = run.start + i;
      frames.push({
        name: `${a}_${String(i).padStart(2, '0')}`,
        x: (cell % cols) * fw,
        y: Math.floor(cell / cols) * fh,
        w: fw,
        h: fh,
      });
    }
  }
  if (extra) {
    const src = canvas(fw, fh);
    const sctx = src.getContext('2d')!;
    sctx.drawImage(atlas, (idle.start % cols) * fw, Math.floor(idle.start / cols) * fh, fw, fh, 0, 0, fw, fh);
    const frame = canvas(bw, bh);
    const f = frame.getContext('2d')!;
    let i = 0;
    for (const a of missing)
      all[a as 'walk' | 'chop' | 'hurt'].forEach((b, n) => {
        f.setTransform(1, 0, 0, 1, 0, 0);
        f.clearRect(0, 0, bw, bh);
        f.imageSmoothingEnabled = false;
        // feet stay planted at the bottom centre of the cell
        f.translate(Math.round(bw / 2 + (b.dx ?? 0) * fw), Math.round(bh - (b.dy ?? 0) * fh));
        if (b.rot) f.rotate(b.rot);
        if (b.lean) f.transform(1, 0, -b.lean, 1, 0, 0);
        f.scale(b.sx ?? 1, b.sy ?? 1);
        f.drawImage(src, -fw / 2, -fh);
        const x = i * bw;
        const y = img.naturalHeight;
        // crisp edges after bending
        const px = f.getImageData(0, 0, bw, bh);
        const p: Pixels = { data: px.data, w: bw, h: bh };
        hardenAlpha(p);
        f.putImageData(px, 0, 0);
        ctx.drawImage(frame, x, y);
        frames.push({ name: `${a}_${String(n).padStart(2, '0')}`, x, y, w: bw, h: bh });
        i++;
      });
  }

  for (const a of SHEET_ANIMS) {
    const ak = animKey(key, a);
    if (scene.anims.exists(ak)) scene.anims.remove(ak);
  }
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, atlas)!;
  // bent frames are bigger than cells, with the feet at the same bottom centre
  for (const fr of frames) tex.add(fr.name, 0, fr.x, fr.y, fr.w, fr.h);
  const fps: Record<string, number> = { ...FALLBACK_FPS };
  for (const a of SHEET_ANIMS) if (sheet.anims[a]) fps[a] = sheet.anims[a]!.fps;
  buildAnimations(scene, key, { fps, once: SHEET_ONCE });
  drawn.set(key, sig);
  return true;
}

/** Decodes a sheet so it can be drawn (start-up, and after each save). */
export function loadSheet(sheet: SheetLook): Promise<unknown> {
  return decodePicture(sheet.url).catch(() => undefined);
}

/** Biggest sheet accepted, each way. */
export const SHEET_MAX_SIDE = 4096;
/** Biggest sheet kept inline (when there's no asset store to put it in). */
export const SHEET_MAX_INLINE = 600_000;

/**
 * Reads an uploaded sprite sheet: clears a flat background when the sheet has
 * none see-through (and `clearBackground`), finds the frame grid and guesses
 * the animations, then stores it with the game link (or inline).
 */
export async function importSheet(file: Blob | string, clearBackground: boolean): Promise<SheetLook> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w > SHEET_MAX_SIDE || h > SHEET_MAX_SIDE)
    throw new Error(`That sheet is ${w}×${h}: keep it under ${SHEET_MAX_SIDE} pixels each way.`);
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px: Pixels = { data: data.data, w, h };
  if (clearBackground && !hasTransparency(px)) {
    removeBackground(px);
    ctx.putImageData(data, 0, 0);
  }
  const grid = detectGrid(px);
  const anims = guessAnims(px, grid);
  if (!anims.idle) anims.idle = { start: 0, count: 1, fps: 6 };
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that sheet.'))), 'image/png'),
  );
  let url = await storeImage(blob);
  if (!url) {
    url = c.toDataURL('image/png');
    if (url.length > SHEET_MAX_INLINE)
      throw new Error(
        `That sheet is ${Math.round(url.length / 1024)} KB: without the game link's file storage the most is ${Math.round(SHEET_MAX_INLINE / 1024)} KB. Trim empty space or use fewer frames.`,
      );
  }
  await decodePicture(url);
  return { url, w, h, frameW: grid.frameW, frameH: grid.frameH, anims };
}

/** A decoded sheet's pixels (to find its grid again after the frame size changes). */
export function sheetPixels(url: string): Pixels | null {
  const img = decodedPicture(url);
  if (!img) return null;
  const c = canvas(img.naturalWidth, img.naturalHeight);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { data: d.data, w: c.width, h: c.height };
}
