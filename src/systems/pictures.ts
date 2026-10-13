// Uploaded fighter pictures. An upload is cleaned once (background cleared,
// cropped, shrunk) and kept as a small PNG in the fighter's look; the game
// texture is drawn from it with the fighter's settings (height, pixel size,
// outline, facing), so those can change any time without uploading again.

import type Phaser from 'phaser';
import { addOutline, fitSize, hardenAlpha, removeBackground, visibleBox, type Pixels } from './picture_ops';
import {
  Builds,
  DEFAULT_PICTURE,
  POSES,
  globalId,
  type FighterLook,
  type PictureSettings,
  type Pose,
} from '../managers/builds';

/** Largest kept upload, in pixels (the source the game texture is drawn from). */
export const SOURCE_MAX = 160;
/** Widest a fighter may be drawn, in game pixels. */
export const MAX_DRAW_W = 192;

const decoded = new Map<string, HTMLImageElement>();
const drawn = new Map<string, string>();

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function pixelsOf(c: HTMLCanvasElement): Pixels {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { data: img.data, w: c.width, h: c.height };
}

function putPixels(c: HTMLCanvasElement, p: Pixels): void {
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(p.w, p.h);
  img.data.set(p.data);
  ctx.putImageData(img, 0, 0);
}

/** Loads an image from a file or a URL. */
export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error('That file is not a picture this browser can read.'));
    img.src = url;
  });
}

/**
 * Cleans an upload: shrinks big pictures, clears a flat background (when asked),
 * crops to the figure and keeps at most SOURCE_MAX pixels each way.
 * Returns a PNG data URL.
 */
export async function cleanPicture(file: Blob | string, clearBackground: boolean): Promise<string> {
  const img = await loadImage(file);
  // work on a manageable copy
  const work = fitSize(img.naturalWidth, img.naturalHeight, Math.min(img.naturalHeight, 400), 400);
  const c = canvas(work.w, work.h);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = pixelsOf(c);
  if (clearBackground) {
    removeBackground(px);
    putPixels(c, px);
  }
  const box = visibleBox(px);
  if (!box) throw new Error('The picture came out empty: try again without clearing the background.');
  const out = fitSize(box.w, box.h, Math.min(box.h, SOURCE_MAX), SOURCE_MAX);
  const o = canvas(out.w, out.h);
  const octx = o.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

/** Decodes a stored picture once (they're needed synchronously when drawing). */
export async function decodePicture(url: string): Promise<HTMLImageElement> {
  const have = decoded.get(url);
  if (have) return have;
  const img = await loadImage(url);
  decoded.set(url, img);
  return img;
}

/** Draws a picture with the fighter's settings into a canvas (null until it's decoded). */
export function renderPicture(url: string, s: PictureSettings): HTMLCanvasElement | null {
  const img = decoded.get(url);
  if (!img) return null;
  const pixel = Math.max(1, Math.min(4, Math.round(s.pixel)));
  const size = fitSize(
    img.naturalWidth,
    img.naturalHeight,
    Math.max(8, Math.round(s.height / pixel)),
    Math.round(MAX_DRAW_W / pixel),
  );
  // one pixel of room on each side for the outline
  const small = canvas(size.w + 2, size.h + 2);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 1, 1, size.w, size.h);
  const px = pixelsOf(small);
  hardenAlpha(px);
  if (s.outline) addOutline(px);
  putPixels(small, px);
  const big = canvas(small.width * pixel, small.height * pixel);
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = false;
  if (s.flip) {
    bctx.translate(big.width, 0);
    bctx.scale(-1, 1);
  }
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

/** Texture key for one of a look's poses (idle is the main key). */
export function poseKey(key: string, pose: Pose): string {
  return pose === 'idle' ? key : `${key}_${pose}`;
}

/**
 * Makes (or remakes) the textures for a picture look under `key`. Returns false
 * while a picture is still being decoded. Nothing may be showing a texture
 * that gets replaced.
 */
export function drawPictureLook(
  textures: Phaser.Textures.TextureManager,
  key: string,
  look: FighterLook,
): boolean {
  const s = look.picture ?? DEFAULT_PICTURE;
  let ready = true;
  for (const pose of POSES) {
    const url = look.pictures?.[pose];
    const k = poseKey(key, pose);
    if (!url) {
      if (drawn.has(k) && textures.exists(k)) textures.remove(k);
      drawn.delete(k);
      continue;
    }
    const sig = `${url.length}:${url.slice(-48)}:${JSON.stringify(s)}`;
    if (drawn.get(k) === sig && textures.exists(k)) continue;
    const c = renderPicture(url, s);
    if (!c) {
      ready = false;
      void decodePicture(url);
      continue;
    }
    if (textures.exists(k)) textures.remove(k);
    textures.addCanvas(k, c);
    drawn.set(k, sig);
  }
  return ready;
}

/** Decodes every picture any fighter uses and draws their textures (start-up, and after each save). */
export async function preparePictures(textures: Phaser.Textures.TextureManager): Promise<void> {
  const looks: { key: string; look: FighterLook }[] = [];
  for (const { owner, set } of Builds.allSets())
    for (const f of set.fighters) {
      if (f.look.base !== 'picture') continue;
      const l = Builds.lookOf(globalId(owner, f.id));
      if (l) looks.push(l);
    }
  await Promise.all(
    looks.flatMap((l) =>
      Object.values(l.look.pictures ?? {}).map((u) => decodePicture(u!).catch(() => undefined)),
    ),
  );
  for (const l of looks) drawPictureLook(textures, l.key, l.look);
}
