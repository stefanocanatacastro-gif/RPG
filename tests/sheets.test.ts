import { describe, expect, it } from 'vitest';
import {
  cellUsed,
  detectGrid,
  fitRuns,
  frameSizes,
  guessAnims,
  hasTransparency,
} from '../src/systems/sheet_ops';
import type { Pixels } from '../src/systems/picture_ops';
import { Builds, globalId, newFighter, toDefs } from '../src/managers/builds';

/** A see-through sheet with a figure (fw-2·pad wide, standing on the bottom) in each listed cell. */
function sheet(cols: number, rows: number, fw: number, fh: number, cells: number[][], pad = 12): Pixels {
  const w = cols * fw;
  const h = rows * fh;
  const data = new Uint8ClampedArray(w * h * 4);
  cells.forEach((rowCells, r) => {
    for (const c of rowCells)
      for (let y = r * fh + 10; y < (r + 1) * fh; y++)
        for (let x = c * fw + pad; x < (c + 1) * fw - pad; x++) data.set([200, 80, 60, 255], (y * w + x) * 4);
  });
  return { data, w, h };
}

describe('sprite sheets', () => {
  it('finds the frame grid of a template-style sheet (one row per animation)', () => {
    const p = sheet(8, 6, 96, 96, [[0, 1, 2, 3], [0, 1, 2, 3, 4, 5], [0, 1, 2], [0, 1], [], [0]]);
    expect(detectGrid(p)).toEqual({ frameW: 96, frameH: 96, cols: 8, rows: 6 });
  });

  it('finds big and huge frames too, and a single strip', () => {
    expect(detectGrid(sheet(6, 4, 144, 144, [[0, 1, 2, 3, 4, 5], [0, 1], [0], [0]])).frameW).toBe(144);
    expect(detectGrid(sheet(4, 2, 240, 240, [[0, 1, 2, 3], [0]])).frameH).toBe(240);
    const strip = detectGrid(sheet(6, 1, 64, 64, [[0, 1, 2, 3, 4, 5]], 4));
    expect([strip.frameW, strip.frameH, strip.cols]).toEqual([64, 64, 6]);
  });

  it('a strip whose figures touch: square frames as tall as the strip', () => {
    const p = sheet(5, 1, 80, 80, [[0, 1, 2, 3, 4]], 0);
    expect(detectGrid(p)).toMatchObject({ frameW: 80, frameH: 80, cols: 5 });
  });

  it('guesses animations from the rows, in template order, as long as their drawn frames', () => {
    const p = sheet(8, 6, 96, 96, [[0, 1, 2, 3], [0, 1, 2, 3, 4, 5], [0, 1, 2], [0, 1], [], [0, 1, 2, 3]]);
    const g = detectGrid(p);
    const a = guessAnims(p, g);
    expect(a.idle).toMatchObject({ start: 0, count: 4 });
    expect(a.walk).toMatchObject({ start: 8, count: 6 });
    expect(a.chop).toMatchObject({ start: 16, count: 3 });
    expect(a.hurt).toMatchObject({ start: 24, count: 2 });
    expect(a.ko).toBeUndefined();
    expect(a.win).toMatchObject({ start: 40, count: 4 });
    expect(cellUsed(p, g, 4)).toBe(false);
  });

  it('a single strip is all idle; runs are kept inside a re-cut sheet', () => {
    const p = sheet(6, 1, 64, 64, [[0, 1, 2, 3, 4, 5]], 4);
    expect(guessAnims(p, detectGrid(p)).idle).toMatchObject({ start: 0, count: 6 });
    expect(
      fitRuns({ idle: { start: 0, count: 6, fps: 6 }, walk: { start: 9, count: 2, fps: 9 } }, 4),
    ).toEqual({
      idle: { start: 0, count: 4, fps: 6 },
    });
    expect(frameSizes(384)).toContain(96);
    expect(hasTransparency(p)).toBe(true);
  });

  it('a made fighter with a sheet look gets a texture of its own; skins are yours', async () => {
    const f = newFighter('enemy', 'f3');
    f.look = {
      base: 'sheet',
      sheet: {
        url: 'data:x',
        w: 384,
        h: 96,
        frameW: 96,
        frameH: 96,
        anims: { idle: { start: 0, count: 4, fps: 6 } },
      },
    };
    expect(toDefs('me', f).foe!.sprite).toBe('spr_custom_c_me_f3');
    expect(Builds.lookOf(globalId('me', 'f3'))?.look.base).toBe('sheet');
    await Builds.saveMine({ skins: { chispa: { base: 'sheet', sheet: f.look.sheet } } });
    expect(Builds.skinOf('chispa')?.key).toBe('spr_skin_chispa');
    expect(Builds.skinOf('pip')).toBeNull();
    expect(Builds.skinOf('agent_brick')).toBeNull();
    await Builds.saveMine({ skins: { agent_brick: { base: 'sheet', sheet: f.look.sheet } } });
    expect(Builds.skinOf('agent_brick')?.size).toBe('huge');
    expect(Builds.skinOf('chispa')).toBeNull();
    // saving fighters keeps the skins
    await Builds.saveMine({ fighters: [] });
    expect(Builds.skinOf('agent_brick')).not.toBeNull();
    await Builds.saveMine({ skins: {} });
  });
});
