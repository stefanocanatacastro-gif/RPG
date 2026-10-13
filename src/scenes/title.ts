import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { pixelText } from '../ui/pixel_text';
import { tinyText, tinyTextWidth } from '../ui/tiny_font';
import { versionLabel } from '../systems/version';
import { t } from '../managers/strings';
import { newGame } from '../managers/game_state';
import { MenuList, type MenuItem } from '../ui/components';
import { SaveManager, type SlotId } from '../managers/save_manager';
import { pickSlot } from '../ui/save_slots';
import { startFromSave, startNewGame } from '../managers/game_flow';
import { Database } from '../managers/database';
import { SceneLoader } from '../managers/scene_loader';
import { input } from '../systems/input';

// Title card at 640×360: an arena at night. Dithered sky, lighting truss, an
// entrance portal with chasing bulbs, four rows of crowd, spotlights crossing on
// the ring, and Kid Chispa (placeholder box until his sprite exists) centre-ring.

const C = {
  ramp: [0x0b0910, 0x110c18, 0x171121, 0x1e162b, 0x261c36, 0x2f2342],
  floor: 0x100c16,
  truss: 0x2b2338,
  trussHi: 0x46395a,
  can: 0x14101b,
  lamp: 0xfff1c4,
  crowd: [0x241b33, 0x2e2341, 0x3a2d50, 0x47375f],
  skin: [0x3b2d4a, 0x47385a],
  sign: 0xe8dfc8,
  signInk: [0xd8314b, 0x2a6fd8, 0xffb238],
  rail: 0x4a3f5c,
  portal: 0x1a1424,
  portalGlow: [0x5e1422, 0x8f1f33, 0xd8314b, 0xff7a3d],
  bulbOff: 0x5a4a2a,
  bulbOn: 0xffe08a,
  canvas: 0xd9c9a8,
  canvasLit: 0xefe3c6,
  canvasShade: 0xb3a183,
  apron: 0x8f1f33,
  apronDark: 0x5e1422,
  apronHi: 0xb02a40,
  rope: 0xd8314b,
  ropeHi: 0xff6b7d,
  post: 0x8a7f99,
  postDark: 0x5b5068,
  pad: 0x2a4fb8,
  padHi: 0x4c78e0,
  gold: 0xf2c14e,
  goldHi: 0xffe08a,
  goldDark: 0xa3761d,
  steps: 0x5b5068,
  stepsHi: 0x7a6e8a,
  ink: 0xf4ead2,
};

function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Paints a vertical colour ramp with 4×4 ordered dithering into a canvas texture. */
function ditherRamp(scene: Phaser.Scene, key: string, w: number, h: number, ramp: number[]): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const steps = ramp.length - 1;
  for (let y = 0; y < h; y++) {
    const pos = (y / (h - 1)) * steps;
    const lo = Math.min(Math.floor(pos), steps - 1);
    const frac = pos - lo;
    for (let x = 0; x < w; x++) {
      const c = frac * 16 > BAYER4[(y & 3) * 4 + (x & 3)] ? ramp[lo + 1] : ramp[lo];
      const i = (y * w + x) * 4;
      img.data[i] = (c >> 16) & 255;
      img.data[i + 1] = (c >> 8) & 255;
      img.data[i + 2] = c & 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

export class TitleScene extends Phaser.Scene {
  private started = false;
  private prompt!: Phaser.GameObjects.Text;
  /** The title menu, once Start has been pressed (the browser test reads it). */
  menu: MenuList | null = null;
  private busy = false;

  constructor() {
    super('title');
  }

  create(): void {
    this.started = false;
    this.menu = null;
    this.busy = false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const rand = rng(1931);

    // ── Sky and arena floor ────────────────────────────────────────────
    ditherRamp(this, '__title_sky', W, 250, C.ramp);
    this.add.image(0, 0, '__title_sky').setOrigin(0);
    this.add.rectangle(0, 250, W, H - 250, C.floor).setOrigin(0);

    const g = this.add.graphics();

    // ── Lighting truss across the top ─────────────────────────────────
    g.fillStyle(C.truss).fillRect(0, 4, W, 3).fillRect(0, 15, W, 3);
    g.lineStyle(1, C.truss);
    for (let x = 0; x < W; x += 12) {
      g.lineBetween(x, 7, x + 6, 15);
      g.lineBetween(x + 6, 15, x + 12, 7);
    }
    g.fillStyle(C.trussHi).fillRect(0, 4, W, 1).fillRect(0, 15, W, 1);
    const cans = [60, 120, 200, 440, 520, 580];
    for (const cx of cans) {
      g.fillStyle(C.can)
        .fillRect(cx - 5, 18, 10, 9)
        .fillRect(cx - 1, 17, 2, 2);
      g.fillStyle(C.lamp).fillRect(cx - 3, 26, 6, 2);
    }
    const glows = this.add.graphics();
    for (const cx of cans) {
      glows.fillStyle(C.lamp, 0.12).fillCircle(cx, 28, 9);
      glows.fillStyle(C.lamp, 0.18).fillCircle(cx, 28, 5);
    }

    // ── Entrance portal with chasing bulbs ─────────────────────────────
    const px = W / 2 - 74;
    const py = 136;
    const pw = 148;
    const ph = 72;
    g.fillStyle(C.portal).fillRect(px - 10, py - 10, pw + 20, ph + 10);
    for (let i = 0; i < C.portalGlow.length; i++) {
      const inset = i * 8;
      g.fillStyle(C.portalGlow[i]).fillRect(px + inset, py + inset, pw - inset * 2, ph - inset);
    }
    const bulbs: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 9; i++) {
      const by = py - 6 + i * 10;
      bulbs.push(this.add.rectangle(px - 6, by, 3, 3, C.bulbOff).setOrigin(0));
      bulbs.push(this.add.rectangle(px + pw + 3, by, 3, 3, C.bulbOff).setOrigin(0));
    }
    for (let i = 0; i < 15; i++) {
      bulbs.push(this.add.rectangle(px + i * 10 + 1, py - 7, 3, 3, C.bulbOff).setOrigin(0));
    }
    let chase = 0;
    const lightBulbs = () => {
      bulbs.forEach((b, i) => b.setFillStyle(i % 3 === chase % 3 ? C.bulbOn : C.bulbOff));
      chase++;
    };
    lightBulbs();
    if (!reduced) this.time.addEvent({ delay: 180, loop: true, callback: lightBulbs });

    // ── Crowd: four rows, nearer rows larger and lighter ───────────────
    const crowd = this.add.graphics();
    const rows = [
      { y: 188, head: 4, step: 7, color: C.crowd[0] },
      { y: 202, head: 5, step: 8, color: C.crowd[1] },
      { y: 218, head: 6, step: 10, color: C.crowd[2] },
      { y: 236, head: 8, step: 12, color: C.crowd[3] },
    ];
    rows.forEach((row, ri) => {
      crowd.fillStyle(row.color).fillRect(0, row.y + row.head, W, 260 - row.y);
      for (let x = Math.floor(rand() * row.step); x < W + row.step; x += row.step + Math.floor(rand() * 3)) {
        const hy = row.y - Math.floor(rand() * 3);
        const s = row.head;
        crowd.fillStyle(row.color).fillRect(x, hy, s, s); // head
        crowd.fillRect(x - Math.ceil(s / 2), hy + s - 1, s * 2, s); // shoulders
        if (ri >= 1 && rand() < 0.12) {
          // raised arm
          crowd.fillRect(x + s + 1, hy - s, Math.max(2, s / 3), s * 1.6);
        }
        if (ri >= 2 && rand() < 0.07) {
          // fan sign
          const sw = s * 2 + 6;
          const sh = s + 4;
          const sx = x - 3;
          const sy = hy - sh - 4;
          crowd.fillStyle(C.postDark).fillRect(sx + sw / 2 - 1, sy + sh, 2, 5);
          crowd.fillStyle(C.sign).fillRect(sx, sy, sw, sh);
          crowd.fillStyle(C.signInk[Math.floor(rand() * 3)]).fillRect(sx + 2, sy + 2, sw - 4, 2);
          crowd.fillRect(sx + 2, sy + sh - 4, sw - 8, 2);
          crowd.fillStyle(row.color);
        }
      }
    });
    // barricade
    crowd.fillStyle(C.rail).fillRect(0, 248, W, 3);
    for (let x = 6; x < W; x += 40) crowd.fillRect(x, 248, 2, 10);

    // Camera flashes in the crowd
    const flashes = Array.from({ length: 8 }, () =>
      this.add.rectangle(0, 0, 2, 2, 0xffffff).setOrigin(0).setVisible(false),
    );
    if (!reduced) {
      this.time.addEvent({
        delay: 160,
        loop: true,
        callback: () => {
          const f = flashes[Math.floor(Math.random() * flashes.length)];
          f.setPosition(Math.floor(Math.random() * W), 186 + Math.floor(Math.random() * 56));
          f.setVisible(true);
          this.time.delayedCall(70, () => f.setVisible(false));
        },
      });
    }

    // ── Spotlights from the truss onto the ring ───────────────────────
    const ringCX = W / 2;
    const ringCY = 258;
    const beams = this.add.graphics();
    const drawBeams = (s: number) => {
      beams.clear();
      const sources: [number, number][] = [
        [120, 28],
        [520, 28],
        [W / 2, -10],
      ];
      sources.forEach(([sx, sy], i) => {
        const dx = i === 2 ? 0 : Math.round(s * (i === 0 ? 1 : -1) * 18);
        const tx = ringCX + dx;
        const spread = i === 2 ? 70 : 54;
        beams.fillStyle(C.lamp, i === 2 ? 0.06 : 0.05);
        beams.fillTriangle(sx - 3, sy, sx + 3, sy, tx + spread, ringCY);
        beams.fillTriangle(sx - 3, sy, tx - spread, ringCY, tx + spread, ringCY);
      });
    };
    drawBeams(0);
    if (!reduced) {
      const sweep = { v: 0 };
      this.tweens.add({
        targets: sweep,
        v: 1,
        duration: 4600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: () => drawBeams(Math.round((sweep.v - 0.5) * 8) / 4),
      });
    }

    // ── Ring ──────────────────────────────────────────────────────────
    const ring = this.add.graphics();
    const backY = 238;
    const frontY = 278;
    const bl = 150;
    const br = W - 150;
    const fl = 100;
    const fr = W - 100;
    // canvas (trapezoid), shaded front lip, light pool
    ring.fillStyle(C.canvas);
    ring.fillPoints(
      [
        { x: bl, y: backY },
        { x: br, y: backY },
        { x: fr, y: frontY },
        { x: fl, y: frontY },
      ],
      true,
    );
    ring.fillStyle(C.canvasLit).fillEllipse(ringCX, 260, 200, 26);
    ring.fillStyle(C.canvasShade).fillRect(fl, frontY - 3, fr - fl, 3);
    // apron
    ring.fillStyle(C.apron).fillRect(fl - 6, frontY, fr - fl + 12, 34);
    ring.fillStyle(C.apronHi).fillRect(fl - 6, frontY, fr - fl + 12, 2);
    ring.fillStyle(C.apronDark).fillRect(fl - 6, frontY + 30, fr - fl + 12, 4);
    for (let x = fl + 20; x < fr; x += 40) ring.fillRect(x, frontY + 2, 1, 28);
    // gold spark emblem on the apron
    ring.fillStyle(C.goldDark).fillPoints(
      [
        { x: ringCX + 2, y: frontY + 5 },
        { x: ringCX - 8, y: frontY + 19 },
        { x: ringCX, y: frontY + 18 },
        { x: ringCX - 4, y: frontY + 31 },
        { x: ringCX + 10, y: frontY + 14 },
        { x: ringCX + 2, y: frontY + 15 },
        { x: ringCX + 8, y: frontY + 5 },
      ],
      true,
    );
    ring.fillStyle(C.gold).fillPoints(
      [
        { x: ringCX + 1, y: frontY + 4 },
        { x: ringCX - 9, y: frontY + 18 },
        { x: ringCX - 1, y: frontY + 17 },
        { x: ringCX - 5, y: frontY + 30 },
        { x: ringCX + 9, y: frontY + 13 },
        { x: ringCX + 1, y: frontY + 14 },
        { x: ringCX + 7, y: frontY + 4 },
      ],
      true,
    );
    // ring steps, right side
    for (let s = 0; s < 3; s++) {
      ring.fillStyle(C.steps).fillRect(fr + 8 + s * 8, frontY + 8 + s * 9, 32 - s * 8, 26 - s * 9);
      ring.fillStyle(C.stepsHi).fillRect(fr + 8 + s * 8, frontY + 8 + s * 9, 32 - s * 8, 2);
    }

    const ropeYs = (base: number, gap: number) => [base - gap, base - gap * 2, base - gap * 3];
    const backRopes = ropeYs(backY, 12);
    const frontRopes = ropeYs(frontY, 16);
    const post = (x: number, baseY: number, top: number, w: number, padYs: number[], dim: boolean) => {
      ring.fillStyle(dim ? C.postDark : C.post).fillRect(x - w / 2, top, w, baseY - top);
      for (const py2 of padYs) {
        ring.fillStyle(dim ? C.pad : C.padHi).fillRect(x - w / 2 - 2, py2 - 3, w + 4, 7);
        ring.fillStyle(C.pad).fillRect(x - w / 2 - 2, py2 + 2, w + 4, 2);
      }
    };
    // back posts and ropes (behind Chispa)
    post(bl, backY, backY - 44, 5, backRopes, true);
    post(br, backY, backY - 44, 5, backRopes, true);
    for (const y of backRopes) ring.fillStyle(C.rope).fillRect(bl, y, br - bl, 2);
    // side ropes from back post to front post
    ring.lineStyle(2, C.rope);
    for (let i = 0; i < 3; i++) {
      ring.lineBetween(bl, backRopes[i] + 1, fl, frontRopes[i] + 1);
      ring.lineBetween(br, backRopes[i] + 1, fr, frontRopes[i] + 1);
    }

    // ── Kid Chispa (placeholder) with a stepped idle bob ──────────────
    this.add.ellipse(ringCX, 266, 40, 8, 0x000000, 0.25);
    const chispa = this.add.image(ringCX, 266, 'spr_chispa').setOrigin(0.5, 1);
    if (!reduced) {
      this.tweens.add({
        targets: chispa,
        y: 264,
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Stepped',
        easeParams: [1],
      });
    }

    // front posts and ropes pass in front of him, like a real ring
    const front = this.add.graphics();
    for (const y of frontRopes) {
      front.fillStyle(C.rope).fillRect(fl, y, fr - fl, 3);
      front.fillStyle(C.ropeHi).fillRect(fl, y, fr - fl, 1);
    }
    const frontPost = (x: number) => {
      front.fillStyle(C.post).fillRect(x - 4, frontY - 56, 8, 56);
      front.fillStyle(C.ink, 0.25).fillRect(x - 4, frontY - 56, 2, 56);
      for (const y of frontRopes) {
        front.fillStyle(C.padHi).fillRect(x - 6, y - 4, 12, 9);
        front.fillStyle(C.pad).fillRect(x - 6, y + 3, 12, 2);
      }
    };
    frontPost(fl);
    frontPost(fr);

    // Dust motes drifting through the centre light
    if (!reduced) {
      for (let i = 0; i < 26; i++) {
        const m = this.add
          .rectangle(ringCX - 60 + rand() * 120, 40 + rand() * 200, 1, 1, C.lamp, 0.5)
          .setOrigin(0);
        this.tweens.add({
          targets: m,
          y: m.y - 30 - rand() * 30,
          x: m.x + (rand() - 0.5) * 16,
          alpha: 0,
          duration: 3000 + rand() * 3000,
          repeat: -1,
          delay: rand() * 3000,
        });
      }
    }

    // ── Logo: two-tone fill over a dark outline ───────────────────────
    const name = t('title.name');
    const logoY = 40;
    for (const [ox, oy] of [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
      [3, 3],
      [4, 4],
    ]) {
      pixelText(this, W / 2 + ox, logoY + oy, name, 32, '#3a0d18');
    }
    pixelText(this, W / 2, logoY, name, 32, '#ff8a2a');
    const top = pixelText(this, W / 2, logoY, name, 32, '#ffd35c');
    top.setCrop(0, 0, top.width, 16);
    pixelText(this, W / 2 + 2, 84 + 2, t('title.subtitle'), 16, '#3a0d18');
    pixelText(this, W / 2, 84, t('title.subtitle'), 16, '#f4ead2');

    // Seven belts, empty for now
    const belts = this.add.graphics();
    const beltW = 34;
    const gap = 10;
    const total = 7 * beltW + 6 * gap;
    for (let i = 0; i < 7; i++) {
      const bx = Math.round((W - total) / 2) + i * (beltW + gap);
      const by = 108;
      belts.fillStyle(C.goldDark).fillRect(bx, by + 4, beltW, 8);
      belts.fillStyle(0x6b4a12).fillRect(bx, by + 10, beltW, 2);
      belts.fillStyle(C.goldDark).fillRect(bx + 9, by - 1, 16, 18);
      belts.fillStyle(C.gold).fillRect(bx + 10, by, 14, 16);
      belts.fillStyle(C.goldHi).fillRect(bx + 10, by, 14, 2);
      belts.fillStyle(C.goldDark).fillRect(bx + 14, by + 4, 6, 8);
      belts
        .fillStyle(C.gold)
        .fillRect(bx + 3, by + 6, 3, 4)
        .fillRect(bx + beltW - 6, by + 6, 3, 4);
    }

    // ── Prompt and version ────────────────────────────────────────────
    const touch = this.sys.game.device.input.touch && !this.sys.game.device.os.desktop;
    this.prompt = pixelText(this, W / 2, 324, t(touch ? 'title.tap_start' : 'title.press_start'), 16);
    if (!reduced) {
      this.time.addEvent({
        delay: 530,
        loop: true,
        callback: () => this.prompt.setVisible(this.started || !this.prompt.visible),
      });
    }
    const v = versionLabel();
    tinyText(this, W - 6 - tinyTextWidth(v) * 2, H - 14, v, '#8a7f99')
      .setOrigin(0)
      .setScale(2);

    // ── Input: keyboard, mouse/touch and gamepad all start ────────────
    this.input.keyboard?.on('keydown-F8', () => this.testCrash());
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      const debugCorner = p.x < 44 && p.y < 44;
      if (!debugCorner && !input.onTouchControl(p.x, p.y) && !this.started) this.start();
    });

    this.cameras.main.fadeIn(400, 11, 9, 16);
  }

  update(): void {
    if (!this.started && (input.justPressed('confirm') || input.justPressed('menu'))) this.start();
  }

  /** Start pressed: the title menu replaces the prompt. */
  private start(): void {
    if (this.started) return;
    this.started = true;
    this.cameras.main.flash(120, 255, 178, 56);
    this.prompt.setVisible(false);
    this.time.delayedCall(150, () => this.openMenu());
  }

  private openMenu(): void {
    const saved = SaveManager.hasAny();
    const items: MenuItem[] = [];
    if (saved) items.push({ label: t('title.continue'), value: 'continue' });
    items.push({ label: t('title.new_game'), value: 'new' });
    if (saved) items.push({ label: t('title.load'), value: 'load' });
    items.push({ label: t('title.dev_hub'), value: 'dev' });
    const w = 220;
    const x = (W - w) / 2;
    const y = H - items.length * 22 - 40;
    this.menu = new MenuList(this, x, y, {
      width: w,
      rows: items.length,
      rowHeight: 22,
      items,
      cancellable: false,
      onSelect: (item) => void this.choose(item.value),
    });
  }

  private async choose(value: string): Promise<void> {
    if (this.busy || !this.menu) return;
    if (value === 'continue') {
      const slot = SaveManager.latest();
      if (slot) return this.play(slot);
    } else if (value === 'load') {
      this.menu.active = false;
      const slot = await pickSlot(this, 'load');
      this.menu.active = true;
      if (slot) return this.play(slot);
    } else if (value === 'new') {
      this.busy = true;
      startNewGame(this);
    } else {
      this.busy = true;
      newGame(Database.character('chispa'));
      SceneLoader.goto(this, 'dev_hub');
    }
  }

  /** Loads a save and walks back in where it was made. */
  private play(slot: SlotId): void {
    const data = SaveManager.load(slot);
    if (!data) return;
    this.busy = true;
    startFromSave(this, data);
  }

  /** M0 check of the error overlay: press F8 on the title screen. */
  private testCrash(): void {
    throw new Error('Test crash from the title screen (F8)');
  }
}
