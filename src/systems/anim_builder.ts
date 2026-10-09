// Animation builder: turns a texture atlas whose frames are named
// "<animation>_<frame>" (idle_00, idle_01, chop_00…) into Phaser animations
// automatically, so new art needs no code. Animation keys are "<texture>:<anim>".
// Also makes palette-swapped copies of a sprite (enemy variants, Ch. 8 shadows).

import type Phaser from 'phaser';

export interface AnimOptions {
  /** Frames per second, per animation or as a default. */
  fps?: number | Record<string, number>;
  /** Animations that play once instead of looping (default: everything except idle/walk/run loops). */
  once?: string[];
}

const LOOPING_BY_DEFAULT = ['idle', 'walk', 'run', 'dizzy', 'sleep', 'talk', 'fall'];

/** Groups frame names by animation, sorted by their frame number. */
export function groupFrames(frameNames: string[]): Map<string, string[]> {
  const groups = new Map<string, { name: string; n: number }[]>();
  for (const name of frameNames) {
    const m = /^(.+)_(\d+)$/.exec(name);
    if (!m) continue;
    const [, anim, num] = m;
    if (!groups.has(anim)) groups.set(anim, []);
    groups.get(anim)!.push({ name, n: Number(num) });
  }
  const out = new Map<string, string[]>();
  for (const [anim, frames] of groups)
    out.set(
      anim,
      frames.sort((a, b) => a.n - b.n).map((f) => f.name),
    );
  return out;
}

export function animKey(texture: string, anim: string): string {
  return `${texture}:${anim}`;
}

/** Creates every animation found in the texture's frame names. Returns the animation names. */
export function buildAnimations(scene: Phaser.Scene, texture: string, opts: AnimOptions = {}): string[] {
  const tex = scene.textures.get(texture);
  const groups = groupFrames(tex.getFrameNames());
  for (const [anim, frames] of groups) {
    const key = animKey(texture, anim);
    if (scene.anims.exists(key)) scene.anims.remove(key);
    const fps = typeof opts.fps === 'number' ? opts.fps : (opts.fps?.[anim] ?? 8);
    const loops = opts.once ? !opts.once.includes(anim) : LOOPING_BY_DEFAULT.includes(anim);
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: texture, frame })),
      frameRate: fps,
      repeat: loops ? -1 : 0,
    });
  }
  return [...groups.keys()];
}

/**
 * Makes a copy of a texture with colours replaced (exact matches, 0xRRGGBB → 0xRRGGBB)
 * and the same frames, then builds its animations. Used for enemy variants.
 */
export function paletteSwap(
  scene: Phaser.Scene,
  src: string,
  dst: string,
  map: Record<number, number>,
  opts?: AnimOptions,
): void {
  if (scene.textures.exists(dst)) scene.textures.remove(dst);
  const srcTex = scene.textures.get(src);
  const img = srcTex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const rgb = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    const to = map[rgb];
    if (to !== undefined) {
      px[i] = (to >> 16) & 255;
      px[i + 1] = (to >> 8) & 255;
      px[i + 2] = to & 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  const out = scene.textures.addCanvas(dst, canvas)!;
  for (const name of srcTex.getFrameNames()) {
    const f = srcTex.get(name);
    out.add(name, 0, f.cutX, f.cutY, f.cutWidth, f.cutHeight);
  }
  buildAnimations(scene, dst, opts);
}
