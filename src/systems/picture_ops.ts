// Pixel operations for fighter pictures, on plain RGBA arrays (no DOM, so they
// can be tested): clear a flat background, crop to what's left, harden soft
// edges, and outline the shape.

export interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

const at = (p: Pixels, x: number, y: number) => (y * p.w + x) * 4;

function close(d: Uint8ClampedArray, i: number, rgb: [number, number, number], tol: number): boolean {
  return (
    Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol
  );
}

/** The most common colour along the picture's edge (to 16 levels), as the background guess. */
export function edgeColor(p: Pixels): [number, number, number] | null {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const look = (x: number, y: number) => {
    const i = at(p, x, y);
    if (p.data[i + 3] < 128) return;
    const k = ((p.data[i] >> 4) << 8) | ((p.data[i + 1] >> 4) << 4) | (p.data[i + 2] >> 4);
    const c = counts.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += p.data[i];
    c.g += p.data[i + 1];
    c.b += p.data[i + 2];
    counts.set(k, c);
  };
  for (let x = 0; x < p.w; x++) {
    look(x, 0);
    look(x, p.h - 1);
  }
  for (let y = 0; y < p.h; y++) {
    look(0, y);
    look(p.w - 1, y);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return null;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

/**
 * Clears the background: every pixel connected to the edge whose colour is
 * close to the edge's main colour turns transparent. Areas of the same colour
 * inside the figure (not touching the edge through it) are kept. Returns how
 * many pixels were cleared.
 */
export function removeBackground(p: Pixels, tol = 40): number {
  const rgb = edgeColor(p);
  if (!rgb) return 0;
  const seen = new Uint8Array(p.w * p.h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const n = y * p.w + x;
    if (seen[n]) return;
    seen[n] = 1;
    const i = n * 4;
    if (p.data[i + 3] < 128 || close(p.data, i, rgb, tol)) stack.push(n);
  };
  for (let x = 0; x < p.w; x++) {
    push(x, 0);
    push(x, p.h - 1);
  }
  for (let y = 0; y < p.h; y++) {
    push(0, y);
    push(p.w - 1, y);
  }
  let cleared = 0;
  while (stack.length) {
    const n = stack.pop()!;
    const i = n * 4;
    if (p.data[i + 3] !== 0) cleared++;
    p.data[i + 3] = 0;
    const x = n % p.w;
    const y = (n - x) / p.w;
    if (x > 0) push(x - 1, y);
    if (x < p.w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < p.h - 1) push(x, y + 1);
  }
  return cleared;
}

/** The smallest box holding every visible pixel, or null when nothing is visible. */
export function visibleBox(p: Pixels, alphaMin = 16): { x: number; y: number; w: number; h: number } | null {
  let x0 = p.w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[at(p, x, y) + 3] >= alphaMin) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Pixel-art edges: every pixel becomes fully visible or fully clear. */
export function hardenAlpha(p: Pixels, cut = 128): void {
  for (let i = 3; i < p.data.length; i += 4) p.data[i] = p.data[i] >= cut ? 255 : 0;
}

/** Draws a 1-pixel outline around the visible shape (in the picture's own pixels). */
export function addOutline(p: Pixels, rgb: [number, number, number] = [0x1b, 0x16, 0x22]): void {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[at(p, x, y) + 3] >= 128;
  const edge: number[] = [];
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)))
        edge.push(at(p, x, y));
  for (const i of edge) {
    p.data[i] = rgb[0];
    p.data[i + 1] = rgb[1];
    p.data[i + 2] = rgb[2];
    p.data[i + 3] = 255;
  }
}

/** Size of the drawn picture in game pixels, keeping its shape: `height` tall, at most `maxW` wide. */
export function fitSize(srcW: number, srcH: number, height: number, maxW: number): { w: number; h: number } {
  let h = height;
  let w = Math.max(1, Math.round((srcW * h) / srcH));
  if (w > maxW) {
    w = maxW;
    h = Math.max(1, Math.round((srcH * w) / srcW));
  }
  return { w, h };
}
