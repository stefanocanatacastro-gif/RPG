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
  type FighterSize,
  type PictureSettings,
  type Pose,
} from '../managers/builds';
import { animKey, buildAnimations } from './anim_builder';
import { drawSheetLook } from './sheets';

/** Largest kept upload, in pixels (the source the game texture is drawn from). */
export const SOURCE_MAX = 160;
/** Widest a fighter may be drawn, in game pixels. */
export const MAX_DRAW_W = 192;

/** How wide and tall a fighter's picture may be, by size class (huge bosses get the most room). */
export function maxWidthFor(size?: FighterSize): number {
  return size === 'huge' ? 384 : size === 'big' ? 288 : MAX_DRAW_W;
}
export function maxHeightFor(size?: FighterSize): number {
  return size === 'huge' ? 384 : size === 'big' ? 256 : 192;
}

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

/** A picture already decoded, or undefined. */
export function decodedPicture(url: string): HTMLImageElement | undefined {
  return decoded.get(url);
}

/** Decodes a stored picture once (they're needed synchronously when drawing). */
export async function decodePicture(url: string): Promise<HTMLImageElement> {
  const have = decoded.get(url);
  if (have) return have;
  const img = await loadImage(url);
  decoded.set(url, img);
  return img;
}

/** Draws a picture with the fighter's settings at its own pixel scale (1 = one picture pixel), outlined, facing right. */
function renderSmall(url: string, s: PictureSettings, maxW: number): HTMLCanvasElement | null {
  const img = decoded.get(url);
  if (!img) return null;
  const pixel = pixelOf(s);
  const size = fitSize(
    img.naturalWidth,
    img.naturalHeight,
    Math.max(8, Math.round(s.height / pixel)),
    Math.round(maxW / pixel),
  );
  // one pixel of room on each side for the outline
  const small = canvas(size.w + 2, size.h + 2);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (s.flip) {
    ctx.translate(small.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, 1, 1, size.w, size.h);
  const px = pixelsOf(small);
  hardenAlpha(px);
  if (s.outline) addOutline(px);
  putPixels(small, px);
  return small;
}

const pixelOf = (s: PictureSettings) => Math.max(1, Math.min(4, Math.round(s.pixel)));

/** How a frame bends the picture, paper-cutout style (TTYD): squash, lean, tilt, hop. */
interface Bend {
  /** Stretch across / up. */
  sx?: number;
  sy?: number;
  /** Lean: how far the top moves sideways, as a share of the height (+ = forward). */
  lean?: number;
  /** Tilt in radians (+ = forward). */
  rot?: number;
  /** Shift, as a share of the picture's width / height (+ = forward / up). */
  dx?: number;
  dy?: number;
}

/** The frames of each animation, for a motion amount k (0 = still, 1 = normal, 1.5 = lively). */
export function bends(k: number): Record<'idle' | 'walk' | 'chop' | 'hurt', Bend[]> {
  return {
    idle: [
      {},
      { sx: 1 + 0.015 * k, sy: 1 - 0.02 * k },
      { sx: 1 + 0.03 * k, sy: 1 - 0.04 * k },
      { sx: 1 + 0.015 * k, sy: 1 - 0.02 * k },
    ],
    walk: [
      { lean: 0.06 * k, sx: 1 + 0.02 * k, sy: 1 - 0.03 * k },
      { lean: 0.06 * k, dy: 0.05 * k },
      { lean: 0.06 * k, sx: 1 + 0.02 * k, sy: 1 - 0.03 * k },
      { lean: 0.06 * k, dy: 0.05 * k },
    ],
    chop: [
      { lean: -0.1 * k, sx: 1 - 0.03 * k, sy: 1 + 0.03 * k },
      { lean: 0.2 * k, sx: 1 + 0.06 * k, dx: 0.1 * k },
      { lean: 0.12 * k, dx: 0.07 * k },
      { lean: 0.04 * k },
    ],
    hurt: [
      { rot: -0.14 * k, dx: -0.08 * k, sy: 1 - 0.05 * k },
      { rot: -0.09 * k, dx: -0.05 * k },
      { rot: -0.03 * k },
    ],
  };
}

/** Frames per second of each animation; chop and hurt play once. */
const FPS = { idle: 5, walk: 10, chop: 12, hurt: 8 };

/**
 * Makes (or remakes) a picture look's texture under `key`: an atlas with
 * idle, walk, chop (attack) and hurt frames, made by bending the pictures like
 * paper cutouts, plus its animations, so battles treat it like any animated
 * sprite. The attack and hurt pictures are used for those animations when the
 * fighter has them. Returns false while a picture is still being decoded.
 * Nothing may be showing the texture while it's replaced.
 */
export function drawPictureLook(
  scene: Phaser.Scene,
  key: string,
  look: FighterLook,
  maxW = MAX_DRAW_W,
): boolean {
  const s = look.picture ?? DEFAULT_PICTURE;
  const urls = look.pictures ?? {};
  if (!urls.idle) return true;
  const sig = `${POSES.map((p) => (urls[p] ? `${urls[p]!.length}:${urls[p]!.slice(-40)}` : '-')).join('|')}:${JSON.stringify(s)}:${maxW}`;
  if (drawn.get(key) === sig && scene.textures.exists(key)) return true;
  const small: Partial<Record<Pose, HTMLCanvasElement>> = {};
  let ready = true;
  for (const pose of POSES) {
    const url = urls[pose];
    if (!url) continue;
    const c = renderSmall(url, s, maxW);
    if (!c) {
      ready = false;
      void decodePicture(url);
    } else small[pose] = c;
  }
  if (!ready || !small.idle) return false;

  const k = (s.motion ?? 2) / 2;
  const pixel = pixelOf(s);
  const all = bends(k);
  const sources: Record<keyof typeof all, HTMLCanvasElement> = {
    idle: small.idle,
    walk: small.idle,
    chop: small.attack ?? small.idle,
    hurt: small.hurt ?? small.idle,
  };
  // one frame size for everything, with room to lean and hop
  const sw = Math.max(...Object.values(sources).map((c) => c.width));
  const sh = Math.max(...Object.values(sources).map((c) => c.height));
  const mx = Math.ceil(sw * 0.25);
  const my = Math.ceil(sh * 0.12);
  const fw = sw + mx * 2;
  const fh = sh + my;
  const list: { name: string; src: HTMLCanvasElement; b: Bend }[] = [];
  for (const anim of Object.keys(all) as (keyof typeof all)[])
    all[anim].forEach((b, i) =>
      list.push({ name: `${anim}_${String(i).padStart(2, '0')}`, src: sources[anim], b }),
    );

  const atlas = canvas(fw * pixel * list.length, fh * pixel);
  const actx = atlas.getContext('2d')!;
  actx.imageSmoothingEnabled = false;
  const frame = canvas(fw, fh);
  const fctx = frame.getContext('2d')!;
  list.forEach(({ src, b }, i) => {
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fw, fh);
    fctx.imageSmoothingEnabled = false;
    // feet stay planted at the bottom centre
    fctx.translate(Math.round(fw / 2 + (b.dx ?? 0) * src.width), Math.round(fh - (b.dy ?? 0) * src.height));
    if (b.rot) fctx.rotate(b.rot);
    if (b.lean) fctx.transform(1, 0, -b.lean, 1, 0, 0);
    fctx.scale(b.sx ?? 1, b.sy ?? 1);
    fctx.drawImage(src, -src.width / 2, -src.height);
    actx.drawImage(frame, i * fw * pixel, 0, fw * pixel, fh * pixel);
  });
  // crisp edges again after bending
  const px = pixelsOf(atlas);
  hardenAlpha(px);
  putPixels(atlas, px);

  // stop anything still playing this look's animations before replacing them
  for (const anim of Object.keys(all)) {
    const ak = animKey(key, anim);
    if (scene.anims.exists(ak)) scene.anims.remove(ak);
  }
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, atlas)!;
  list.forEach(({ name }, i) => tex.add(name, 0, i * fw * pixel, 0, fw * pixel, fh * pixel));
  buildAnimations(scene, key, { fps: FPS, once: ['chop', 'hurt'] });
  drawn.set(key, sig);
  return true;
}

/** Every stored image a look draws from. */
export function lookUrls(look: FighterLook): string[] {
  if (look.base === 'picture') return Object.values(look.pictures ?? {}).filter((u): u is string => !!u);
  if (look.base === 'sheet' && look.sheet) return [look.sheet.url];
  return [];
}

/**
 * Decodes every picture and sheet any fighter (or skin) uses and draws their
 * textures (start-up, and after each save).
 */
export async function preparePictures(scene: Phaser.Scene): Promise<void> {
  const looks: { key: string; look: FighterLook; maxW: number }[] = [];
  for (const { owner, set } of Builds.allSets())
    for (const f of set.fighters) {
      if (!lookUrls(f.look).length) continue;
      const l = Builds.lookOf(globalId(owner, f.id));
      if (l) looks.push({ ...l, maxW: maxWidthFor(l.size) });
    }
  for (const id of Object.keys(Builds.mySkins())) {
    const l = Builds.skinOf(id);
    if (l && lookUrls(l.look).length) looks.push({ ...l, maxW: maxWidthFor(l.size) });
  }
  await Promise.all(
    looks.flatMap((l) => lookUrls(l.look).map((u) => decodePicture(u).catch(() => undefined))),
  );
  for (const l of looks) drawLook(scene, l.key, l.look, l.maxW);
}

/** Draws a picture or sheet look's texture (false while still loading). */
export function drawLook(scene: Phaser.Scene, key: string, look: FighterLook, maxW: number): boolean {
  if (look.base === 'sheet') return look.sheet ? drawSheetLook(scene, key, look.sheet) : true;
  if (look.base === 'picture') return drawPictureLook(scene, key, look, maxW);
  return true;
}
