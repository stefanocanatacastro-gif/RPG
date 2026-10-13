// A 3×5 pixel font for small print (version tag, debug readouts, tiny HUD numbers)
// where the 8px body font is too wide. Text is drawn into a canvas texture, so it
// stays perfectly crisp at any integer zoom.

import Phaser from 'phaser';

const G: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001011001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '.': '000000000000010',
  '-': '000000111000000',
  ':': '000010000010000',
  '/': '001001010100100',
  '·': '000000010000000',
  '!': '010010010000010',
  '?': '110001010000010',
  ' ': '000000000000000',
  _: '000000000000111',
  '(': '010100100100010',
  ')': '010001001001010',
  '#': '101111101111101',
  '+': '000010111010000',
  '*': '000101010101000',
  ',': '000000000010100',
  "'": '010010000000000',
};

export const TINY_GLYPH_W = 3;
export const TINY_GLYPH_H = 5;

export function tinyTextWidth(text: string): number {
  return text.length ? text.length * (TINY_GLYPH_W + 1) - 1 : 0;
}

let counter = 0;

/** Draws `text` (upper-cased) and returns an Image positioned at x,y with the given origin. */
export function tinyText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color = '#f4ead2',
  shadow?: string,
): Phaser.GameObjects.Image {
  const str = text.toUpperCase();
  const pad = shadow ? 1 : 0;
  const w = Math.max(1, tinyTextWidth(str) + pad);
  const h = TINY_GLYPH_H + pad;
  const key = `__tiny_${counter++}`;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  const paint = (ox: number, oy: number, fill: string) => {
    ctx.fillStyle = fill;
    [...str].forEach((ch, i) => {
      const bits = G[ch] ?? G['?'];
      for (let p = 0; p < 15; p++) {
        if (bits[p] === '1') ctx.fillRect(ox + i * 4 + (p % 3), oy + Math.floor(p / 3), 1, 1);
      }
    });
  };
  if (shadow) paint(1, 1, shadow);
  paint(0, 0, color);
  tex.refresh();
  const img = scene.add.image(x, y, key);
  img.once(Phaser.GameObjects.Events.DESTROY, () => scene.textures.remove(key));
  return img;
}
