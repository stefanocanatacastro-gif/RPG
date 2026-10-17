// Sprite sheets, on plain RGBA arrays (no DOM, so they can be tested): find the
// frame grid, tell empty cells from drawn ones, and guess which rows are which
// animation.

import type { Pixels } from './picture_ops';
import { SHEET_ANIMS, SHEET_FPS, type SheetAnim, type SheetRun } from '../managers/builds';

export interface Grid {
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
}

const ALPHA_MIN = 16;

/** Which columns (or rows) have nothing drawn in them. */
function emptyLines(p: Pixels, vertical: boolean): boolean[] {
  const n = vertical ? p.w : p.h;
  const m = vertical ? p.h : p.w;
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    let empty = true;
    for (let j = 0; j < m && empty; j++) {
      const x = vertical ? i : j;
      const y = vertical ? j : i;
      if (p.data[(y * p.w + x) * 4 + 3] >= ALPHA_MIN) empty = false;
    }
    out.push(empty);
  }
  return out;
}

/** Widest run of drawn lines (no frame can be narrower than the widest figure). */
function widestRun(empty: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const e of empty) {
    run = e ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * The frame size along one side: the smallest size that splits the sheet
 * evenly, is at least as wide as the widest figure, and where every cut falls
 * on an empty line (no figure is cut in two). The whole side when nothing fits.
 */
function pitch(empty: boolean[], min: number): number {
  const n = empty.length;
  const widest = widestRun(empty);
  for (let d = Math.max(min, widest, 1); d < n; d++) {
    if (n % d) continue;
    let ok = true;
    for (let cut = d; cut < n && ok; cut += d) if (!empty[cut] || !empty[cut - 1]) ok = false;
    if (ok) return d;
  }
  return n;
}

/** Sizes a sheet's side can be cut into evenly (at least `min` pixels). */
export function frameSizes(side: number, min = 16, max = 512): number[] {
  const out: number[] = [];
  for (let d = min; d <= Math.min(side, max); d++) if (side % d === 0) out.push(d);
  if (!out.length) out.push(side);
  return out;
}

/** Whether a pixel is drawn. */
function solid(p: Pixels, x: number, y: number): boolean {
  return p.data[(y * p.w + x) * 4 + 3] >= ALPHA_MIN;
}

/**
 * How much a square grid of `d` cuts through drawn things: the share of
 * pixel pairs across its cut lines that are drawn on both sides. A grid that
 * runs between the figures scores near 0 even when feet stand on the cell's
 * bottom row or a knocked-out figure pokes over the edge; one that slices
 * through the figures scores high.
 */
function cutCost(p: Pixels, d: number): number {
  let pairs = 0;
  let cut = 0;
  for (let x = d; x < p.w; x += d)
    for (let y = 0; y < p.h; y++) {
      pairs++;
      if (solid(p, x - 1, y) && solid(p, x, y)) cut++;
    }
  for (let y = d; y < p.h; y += d)
    for (let x = 0; x < p.w; x++) {
      pairs++;
      if (solid(p, x, y - 1) && solid(p, x, y)) cut++;
    }
  return pairs ? cut / pairs : 1;
}

/** Most a square grid may cut through drawn pixels and still be the sheet's grid. */
const CUT_TOLERANCE = 0.02;

/**
 * The sheet's square frame size: the smallest square that splits it evenly
 * into at least two cells without cutting through the figures. Null when no
 * square grid fits (frames that aren't square, or figures that touch).
 */
function squareGrid(p: Pixels, min: number): number | null {
  for (let d = min; d <= Math.min(p.w, p.h, 512); d++) {
    if (p.w % d || p.h % d || (p.w / d) * (p.h / d) < 2) continue;
    if (cutCost(p, d) <= CUT_TOLERANCE) return d;
  }
  return null;
}

/**
 * Finds the frame grid of a sheet. Templates use square frames, so a square
 * grid that runs between the figures wins; otherwise frames are found from
 * the empty rows and columns between them.
 */
export function detectGrid(p: Pixels, min = 16): Grid {
  const sq = squareGrid(p, min);
  if (sq) return { frameW: sq, frameH: sq, cols: p.w / sq, rows: p.h / sq };
  const cols = emptyLines(p, true);
  const rows = emptyLines(p, false);
  let frameW = pitch(cols, min);
  let frameH = pitch(rows, min);
  // a single strip: square frames as tall as the sheet, when they fit
  if (frameW === p.w && p.h < p.w && p.w % p.h === 0) frameW = p.h;
  // square frames when the sheet allows it (rows found with gaps can be too small)
  if (frameW !== frameH && p.h % frameW === 0 && frameW >= widestRun(rows)) frameH = frameW;
  return { frameW, frameH, cols: Math.floor(p.w / frameW), rows: Math.floor(p.h / frameH) };
}

/** Whether a cell has anything drawn in it. */
export function cellUsed(p: Pixels, g: Grid, cell: number): boolean {
  const cx = (cell % g.cols) * g.frameW;
  const cy = Math.floor(cell / g.cols) * g.frameH;
  for (let y = cy; y < cy + g.frameH; y++)
    for (let x = cx; x < cx + g.frameW; x++) if (p.data[(y * p.w + x) * 4 + 3] >= ALPHA_MIN) return true;
  return false;
}

/**
 * A first guess at the animations. Several rows: one animation per row, in the
 * template order (idle, walk, attack, hurt, knocked out, victory), each as long
 * as its drawn cells from the left. One row: every drawn cell is the idle.
 */
export function guessAnims(p: Pixels, g: Grid): Partial<Record<SheetAnim, SheetRun>> {
  const out: Partial<Record<SheetAnim, SheetRun>> = {};
  if (g.rows === 1) {
    let count = 0;
    while (count < g.cols && cellUsed(p, g, count)) count++;
    if (count) out.idle = { start: 0, count, fps: SHEET_FPS.idle };
    return out;
  }
  for (let r = 0; r < Math.min(g.rows, SHEET_ANIMS.length); r++) {
    let count = 0;
    while (count < g.cols && cellUsed(p, g, r * g.cols + count)) count++;
    const anim = SHEET_ANIMS[r];
    if (count) out[anim] = { start: r * g.cols, count, fps: SHEET_FPS[anim] };
  }
  return out;
}

/** Keeps runs inside the sheet (after the frame size changes). */
export function fitRuns(
  anims: Partial<Record<SheetAnim, SheetRun>>,
  cells: number,
): Partial<Record<SheetAnim, SheetRun>> {
  const out: Partial<Record<SheetAnim, SheetRun>> = {};
  for (const a of SHEET_ANIMS) {
    const r = anims[a];
    if (!r || r.start >= cells) continue;
    out[a] = { ...r, count: Math.max(1, Math.min(r.count, cells - r.start)) };
  }
  return out;
}

/** Whether the sheet has any see-through pixels (an exported sprite sheet does). */
export function hasTransparency(p: Pixels): boolean {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] < 255) return true;
  return false;
}
