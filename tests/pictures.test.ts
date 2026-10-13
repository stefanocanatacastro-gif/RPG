import { describe, expect, it } from 'vitest';
import {
  addOutline,
  edgeColor,
  fitSize,
  hardenAlpha,
  removeBackground,
  visibleBox,
  type Pixels,
} from '../src/systems/picture_ops';
import { Builds, MAX_SET_CHARS, newFighter, rulesToAi, ruleText, toDefs } from '../src/managers/builds';
import { Database } from '../src/managers/database';
import { BattleEngine } from '../src/battle/engine';
import { t } from '../src/managers/strings';

/** A w×h picture filled with one colour, with a block of another colour at (x, y). */
function pic(
  w: number,
  h: number,
  bg: number[],
  block?: { x: number; y: number; w: number; h: number; c: number[] },
): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = block && x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
      const c = inside ? block!.c : bg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return { data, w, h };
}

const alpha = (p: Pixels, x: number, y: number) => p.data[(y * p.w + x) * 4 + 3];

describe('picture clean-up', () => {
  it('finds the background colour on the edge', () => {
    expect(edgeColor(pic(10, 10, [250, 250, 250]))).toEqual([250, 250, 250]);
  });

  it('clears a flat background but keeps the figure, even its background-coloured parts inside', () => {
    // white background, a dark figure with a white "eye" fully inside it
    const p = pic(20, 20, [255, 255, 255], { x: 5, y: 4, w: 10, h: 12, c: [30, 40, 50] });
    p.data.set([255, 255, 255, 255], (8 * 20 + 9) * 4);
    const cleared = removeBackground(p);
    expect(cleared).toBe(20 * 20 - 10 * 12);
    expect(alpha(p, 0, 0)).toBe(0);
    expect(alpha(p, 6, 6)).toBe(255);
    expect(alpha(p, 9, 8)).toBe(255); // the eye stays
    expect(visibleBox(p)).toEqual({ x: 5, y: 4, w: 10, h: 12 });
  });

  it('hardens soft edges and outlines the shape', () => {
    const p = pic(6, 6, [0, 0, 0], { x: 2, y: 2, w: 2, h: 2, c: [200, 0, 0] });
    for (let i = 3; i < p.data.length; i += 4) p.data[i] = 0;
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ])
      p.data[(y * 6 + x) * 4 + 3] = 200;
    p.data[(0 * 6 + 0) * 4 + 3] = 60;
    hardenAlpha(p);
    expect(alpha(p, 2, 2)).toBe(255);
    expect(alpha(p, 0, 0)).toBe(0);
    addOutline(p);
    expect(alpha(p, 1, 2)).toBe(255);
    expect(alpha(p, 4, 3)).toBe(255);
    expect(alpha(p, 1, 1)).toBe(0); // corners stay clear
    expect(visibleBox(p)).toEqual({ x: 1, y: 1, w: 4, h: 4 });
  });

  it('fits a picture to a height, never wider than allowed', () => {
    expect(fitSize(100, 200, 96, 192)).toEqual({ w: 48, h: 96 });
    expect(fitSize(400, 100, 96, 192)).toEqual({ w: 192, h: 48 });
  });
});

describe('deeper made fighters', () => {
  it('special rules become engine AI rules', () => {
    expect(
      rulesToAi([
        { move: 'a', when: 'opener' },
        { move: 'b', when: 'hp_below', value: 30 },
        { move: 'c', when: 'ally_hurt', value: 60 },
        { move: 'd', when: 'every', value: 3 },
      ]),
    ).toEqual([
      { move: 'a', weight: 1, priority: 2, fromRound: 1, everyRounds: 9999 },
      { move: 'b', weight: 1, priority: 1, whenHpBelow: 0.3 },
      { move: 'c', weight: 1, priority: 1, whenAllyHpBelow: 0.6 },
      { move: 'd', weight: 1, priority: 1, fromRound: 3, everyRounds: 3 },
    ]);
    expect(ruleText({ move: 'x', when: 'every', value: 4 }, 'Slam')).toBe('Slam every 4 rounds');
  });

  it('an opener is used on round 1 only, and a nickname and line come along', () => {
    const f = {
      ...newFighter('enemy', 'f9'),
      moves: ['goon_shove', 'running_lariat'],
      weights: { goon_shove: 1, running_lariat: 0 },
      rules: [{ move: 'running_lariat', when: 'opener' as const }],
      title: 'The Harbor Hammer',
      line: 'You picked the wrong dock.',
    };
    const { foe } = toDefs('me', f);
    expect(t(foe!.title!)).toBe('The Harbor Hammer');
    expect(t(foe!.line!)).toBe('You picked the wrong dock.');
    Database.registerCustom('c.me.', [], [foe!]);
    const e = new BattleEngine(
      Database,
      Database.character('chispa'),
      { hp: 10, maxHp: 10 },
      { id: 't', enemies: [{ enemy: foe!.id, slot: 'front' }], stage: 'arena' },
      1,
    );
    e.begin(null);
    const me = e.enemies()[0];
    expect(e.chooseEnemyMove(me)).toBe('running_lariat');
    e.round = 2;
    for (let i = 0; i < 10; i++) expect(e.chooseEnemyMove(me)).toBe('goon_shove');
    Database.unregisterCustom('c.me.');
  });

  it('picture looks get their own texture key, and a set too big to save is refused', async () => {
    const f = {
      ...newFighter('hero', 'f8'),
      look: { base: 'picture', pictures: { idle: 'data:image/png;base64,AAAA' } },
    };
    expect(toDefs('me', f).char!.sprite).toBe('spr_custom_c_me_f8');
    const huge = { ...f, look: { ...f.look, pictures: { idle: 'x'.repeat(MAX_SET_CHARS) } } };
    await expect(Builds.saveMine({ fighters: [huge] })).rejects.toThrow(/too big/);
  });
});

describe('sizes and paper animation', () => {
  it('normal line-ups keep their spacing; big and huge ones push the rest back inside the ropes', async () => {
    const { enemyXs, ARENA } = await import('../src/battle/stage_layout');
    expect(enemyXs(['normal', 'normal'])).toEqual([ARENA.enemyX[0], ARENA.enemyX[1]]);
    const xs = enemyXs(['huge', 'normal', 'normal']);
    expect(xs[1] - xs[0]).toBeGreaterThan(xs[2] - xs[1]);
    expect(xs[2]).toBeLessThanOrEqual(ARENA.ring.half + 0.1);
    const crowd = enemyXs(['huge', 'big', 'normal', 'normal']);
    expect(crowd.every((x, i) => i === 0 || x > crowd[i - 1])).toBe(true);
    expect(crowd[3]).toBeLessThanOrEqual(ARENA.ring.half + 0.1);
  });

  it('a huge boss can’t be staggered out of its wind-up', () => {
    const f = { ...newFighter('enemy', 'f7'), size: 'huge' as const };
    const { foe } = toDefs('me', f);
    expect(foe!.size).toBe('huge');
    Database.registerCustom('c.me.', [], [foe!]);
    const e = new BattleEngine(
      Database,
      Database.character('chispa'),
      { hp: 10, maxHp: 10 },
      { id: 't', enemies: [{ enemy: foe!.id, slot: 'front' }], stage: 'arena' },
      1,
    );
    const boss = e.enemies()[0];
    expect(boss.size).toBe('huge');
    boss.charging = { move: 'goon_shove', turnsLeft: 1 };
    expect(e.breakCharge(boss.id)).toBe(false);
    expect(boss.charging).toBeDefined();
    Database.unregisterCustom('c.me.');
  });

  it('paper animations: still at motion 0, and every animation has frames', async () => {
    const { bends } = await import('../src/systems/pictures');
    const still = bends(0);
    for (const frames of Object.values(still))
      for (const b of frames) for (const v of Object.values(b)) expect([0, 1, -0]).toContain(v);
    const normal = bends(1);
    expect(normal.idle).toHaveLength(4);
    expect(normal.chop[1].lean).toBeGreaterThan(0);
    expect(normal.hurt[0].rot).toBeLessThan(0);
  });
});
