// Placeholder art: any sprite that has no art yet (or fails to load) becomes a
// coloured box with its key written on it, so code never waits on art.
// The colour comes from a hash of the key, so the same thing always looks the same.

import Phaser from 'phaser';

export interface PlaceholderSpec {
  key: string;
  w: number;
  h: number;
  /** Optional fixed colour (0xRRGGBB); otherwise derived from the key. */
  color?: number;
  /** Short label drawn on the box; defaults to the key without its type prefix. */
  label?: string;
}

const generated = new Set<string>();

export function colorForKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  return Phaser.Display.Color.HSLToColor(hue, 0.55, 0.5).color;
}

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function makePlaceholder(scene: Phaser.Scene, spec: PlaceholderSpec): void {
  const { key, w, h } = spec;
  if (scene.textures.exists(key)) {
    if (!generated.has(key)) return; // real art already loaded
    scene.textures.remove(key);
  }
  const color = spec.color ?? colorForKey(key);
  const dark = Phaser.Display.Color.IntegerToColor(color).darken(35).color;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = css(dark);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = css(color);
  ctx.fillRect(1, 1, w - 2, h - 2);
  // diagonal "missing art" stripe
  ctx.fillStyle = css(dark);
  for (let i = 0; i < Math.max(w, h); i += 1) {
    const x = i;
    const y = Math.round((i * h) / w);
    if (x > 1 && x < w - 2 && y > 1 && y < h - 2) ctx.fillRect(x, y, 1, 1);
  }
  const label = (spec.label ?? key.replace(/^[a-z]+_/, '')).toUpperCase();
  if (w >= 12 && h >= 8) {
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const maxChars = Math.max(1, Math.floor((w - 2) / 4.5));
    const lines: string[] = [];
    for (let i = 0; i < label.length && lines.length < Math.floor((h - 2) / 9); i += maxChars) {
      lines.push(label.slice(i, i + maxChars));
    }
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 9));
  }
  tex.refresh();
  generated.add(key);
}

export function isPlaceholder(key: string): boolean {
  return generated.has(key);
}

export function placeholderKeys(): string[] {
  return [...generated];
}
