// The battle stage: a ring under the lights with the crowd behind it, drawn in
// the same fixed-angle 3D style as the field. Returns where fighters stand.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';

export const STAGE = {
  /** Feet line for fighters standing on the canvas. */
  floorY: 268,
  heroX: 296,
  /** Enemies stand from here, one slot every enemyStep pixels. */
  enemyX: 416,
  enemyStep: 64,
  /** How far above the canvas flyers hover. */
  airLift: 88,
  canvasBack: 214,
  canvasFront: 286,
  left: 70,
  right: W - 70,
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function drawStage(scene: Phaser.Scene): { frontRopes: Phaser.GameObjects.Graphics } {
  // dithered dark backdrop
  const key = '__battle_bg';
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, W, H)!;
    const ctx = tex.getContext();
    const img = ctx.createImageData(W, H);
    const ramp = [0x07060b, 0x0e0a16, 0x161024, 0x1f1631, 0x281c3f];
    for (let y = 0; y < H; y++) {
      const pos = Math.min(1, y / 230) * (ramp.length - 1);
      const lo = Math.min(Math.floor(pos), ramp.length - 2);
      const frac = pos - lo;
      for (let x = 0; x < W; x++) {
        const c = frac * 16 > BAYER4[(y & 3) * 4 + (x & 3)] ? ramp[lo + 1] : ramp[lo];
        const i = (y * W + x) * 4;
        img.data[i] = (c >> 16) & 255;
        img.data[i + 1] = (c >> 8) & 255;
        img.data[i + 2] = c & 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }
  scene.add.image(0, 0, key).setOrigin(0).setDepth(-100);

  const g = scene.add.graphics().setDepth(-90);
  // crowd tiers
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tiers = [0x1a1426, 0x221a31, 0x2b213d, 0x362a4c];
  tiers.forEach((col, t) => {
    const y = 120 + t * 22;
    g.fillStyle(col).fillRect(0, y + 8, W, 80);
    for (let x = Math.floor(rand() * 10); x < W; x += 10 + t * 2 + Math.floor(rand() * 4)) {
      const s = 5 + t;
      g.fillRect(x, y - Math.floor(rand() * 3), s, s + 2);
    }
  });
  // lighting truss
  g.fillStyle(0x2b2338).fillRect(0, 8, W, 3).fillRect(0, 20, W, 3);
  for (let x = 0; x < W; x += 12) g.fillRect(x, 11, 2, 9);
  for (const cx of [100, 220, 420, 540]) {
    g.fillStyle(0x14101b).fillRect(cx - 5, 23, 10, 8);
    g.fillStyle(0xfff1c4).fillRect(cx - 3, 30, 6, 2);
  }
  // spotlight pool on the ring
  const beams = scene.add.graphics().setDepth(-80);
  beams.fillStyle(0xfff1c4, 0.05);
  beams.fillTriangle(W / 2 - 4, 0, W / 2 + 4, 0, W / 2 + 250, STAGE.canvasFront);
  beams.fillTriangle(W / 2 - 4, 0, W / 2 - 250, STAGE.canvasFront, W / 2 + 250, STAGE.canvasFront);

  // ring: canvas, apron, posts, back ropes
  const ring = scene.add.graphics().setDepth(-70);
  const { left, right, canvasBack: cb, canvasFront: cf } = STAGE;
  ring.fillStyle(0xd9c9a8).fillRect(left, cb, right - left, cf - cb);
  ring.fillStyle(0xefe3c6, 0.6).fillEllipse(W / 2, (cb + cf) / 2 + 6, 420, 46);
  ring.fillStyle(0xb3a183).fillRect(left, cf - 3, right - left, 3);
  ring.fillStyle(0x8f1f33).fillRect(left - 6, cf, right - left + 12, 34);
  ring.fillStyle(0xb02a40).fillRect(left - 6, cf, right - left + 12, 2);
  ring.fillStyle(0x5e1422).fillRect(left - 6, cf + 30, right - left + 12, 4);
  for (let x = left + 40; x < right; x += 80) ring.fillRect(x, cf + 2, 1, 28);
  // back posts and ropes
  for (const x of [left + 2, right - 2]) {
    ring.fillStyle(0x5b5068).fillRect(x - 3, cb - 64, 6, 64);
    for (let i = 0; i < 3; i++) ring.fillStyle(0x2a4fb8).fillRect(x - 5, cb - 58 + i * 18, 10, 7);
  }
  for (let i = 0; i < 3; i++)
    ring.fillStyle(0xb02a40).fillRect(left + 2, cb - 56 + i * 18, right - left - 4, 2);

  // front corner posts are drawn over the fighters
  const front = scene.add.graphics().setDepth(50);
  for (const x of [left - 2, right + 2]) {
    front.fillStyle(0x8a7f99).fillRect(x - 4, cf - 84, 8, 84);
    for (let i = 0; i < 3; i++) {
      front.fillStyle(0x4c78e0).fillRect(x - 6, cf - 78 + i * 22, 12, 9);
    }
  }
  // (front ropes are left out, like TTYD's open stage front, so they never hide a fighter)
  return { frontRopes: front };
}

/** Where a fighter stands: x by side and order, y lifted for flyers. */
export function homeOf(side: 'hero' | 'enemy', order: number, airborne: boolean): { x: number; y: number } {
  if (side === 'hero') return { x: STAGE.heroX, y: STAGE.floorY };
  return { x: STAGE.enemyX + order * STAGE.enemyStep, y: STAGE.floorY - (airborne ? STAGE.airLift : 0) };
}
