// A procedurally drawn test wrestler atlas, so the animation builder, palette
// swaps and the battle code can be exercised before real art exists. Frames are
// named the same way real exports will be: idle_00, walk_00…, chop_00…

import type Phaser from 'phaser';

export const TEST_COLORS = {
  outline: 0x1b1622,
  skin: 0xd99b6c,
  mask: 0xffb238,
  maskEye: 0x1b1622,
  shirt: 0x2a6fd8,
  shirtHi: 0x4c8df0,
  trunks: 0xd8314b,
  boots: 0xf4ead2,
};

const FW = 48;
const FH = 64;

type Pose = { bob: number; legL: number; legR: number; arm: number; lean: number };

const POSES: Record<string, Pose[]> = {
  idle: [
    { bob: 0, legL: 0, legR: 0, arm: 0, lean: 0 },
    { bob: 1, legL: 0, legR: 0, arm: 0, lean: 0 },
  ],
  walk: [
    { bob: 0, legL: -3, legR: 3, arm: 1, lean: 0 },
    { bob: 1, legL: 0, legR: 0, arm: 0, lean: 0 },
    { bob: 0, legL: 3, legR: -3, arm: -1, lean: 0 },
    { bob: 1, legL: 0, legR: 0, arm: 0, lean: 0 },
  ],
  chop: [
    { bob: 0, legL: -2, legR: 2, arm: -8, lean: -2 },
    { bob: 0, legL: -3, legR: 3, arm: -12, lean: -3 },
    { bob: 1, legL: 3, legR: -2, arm: 12, lean: 3 },
    { bob: 0, legL: 1, legR: 0, arm: 6, lean: 1 },
  ],
  hurt: [
    { bob: 1, legL: 1, legR: -1, arm: -4, lean: -4 },
    { bob: 0, legL: 0, legR: 0, arm: -2, lean: -2 },
  ],
};

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function drawFrame(ctx: CanvasRenderingContext2D, ox: number, p: Pose): void {
  const C = TEST_COLORS;
  const r = (x: number, y: number, w: number, h: number, c: number) => {
    ctx.fillStyle = hex(c);
    ctx.fillRect(ox + x, y, w, h);
  };
  const cx = 24 + p.lean;
  const top = 6 + p.bob;
  // legs + boots
  r(cx - 9 + p.legL, top + 36, 8, 16, C.outline);
  r(cx - 8 + p.legL, top + 37, 6, 13, C.skin);
  r(cx - 9 + p.legL, top + 48, 9, 9, C.boots);
  r(cx + 1 + p.legR, top + 36, 8, 16, C.outline);
  r(cx + 2 + p.legR, top + 37, 6, 13, C.skin);
  r(cx + 1 + p.legR, top + 48, 9, 9, C.boots);
  // trunks
  r(cx - 11, top + 30, 22, 9, C.outline);
  r(cx - 10, top + 31, 20, 7, C.trunks);
  // body
  r(cx - 12, top + 14, 24, 18, C.outline);
  r(cx - 11, top + 15, 22, 16, C.shirt);
  r(cx - 11, top + 15, 22, 3, C.shirtHi);
  // back arm
  r(cx - 16, top + 16, 6, 14, C.outline);
  r(cx - 15, top + 17, 4, 12, C.skin);
  // head with mask
  r(cx - 8, top, 16, 15, C.outline);
  r(cx - 7, top + 1, 14, 13, C.mask);
  r(cx - 7, top + 10, 14, 4, C.skin);
  r(cx + 1, top + 5, 3, 3, C.maskEye);
  r(cx + 5, top + 5, 2, 3, C.maskEye);
  // front arm, swings with the pose
  const ay = top + 16 + Math.min(0, p.arm);
  const ax = cx + 10 + Math.max(0, p.arm);
  r(ax, ay, 6, 14, C.outline);
  r(ax + 1, ay + 1, 4, 12, C.skin);
}

/** Adds the "spr_test_dummy" atlas to the texture manager (once). */
export function makeTestWrestler(scene: Phaser.Scene, key = 'spr_test_dummy'): string {
  if (scene.textures.exists(key)) return key;
  const frames: [string, Pose][] = [];
  for (const [anim, poses] of Object.entries(POSES)) {
    poses.forEach((p, i) => frames.push([`${anim}_${String(i).padStart(2, '0')}`, p]));
  }
  const canvas = document.createElement('canvas');
  canvas.width = FW * frames.length;
  canvas.height = FH;
  const ctx = canvas.getContext('2d')!;
  frames.forEach(([, p], i) => drawFrame(ctx, i * FW, p));
  const tex = scene.textures.addCanvas(key, canvas)!;
  frames.forEach(([name], i) => tex.add(name, 0, i * FW, 0, FW, FH));
  return key;
}
