// On-screen controls for phones: a d-pad, A / B / C buttons and a menu button.
// Runs on top of every scene; shows itself only while touch is the device in use.
// Each finger is tracked separately, so you can hold a direction and press A.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { input, type Action } from '../systems/input';
import { bus } from '../managers/event_bus';
import { UI } from '../ui/theme';
import { pixelText } from '../ui/pixel_text';

interface Button {
  action: Action;
  x: number;
  y: number;
  r: number;
  label: string;
}

const PAD = { x: 70, y: H - 74, r: 50 };
const BUTTONS: Button[] = [
  { action: 'confirm', x: W - 52, y: H - 84, r: 28, label: 'A' },
  { action: 'cancel', x: W - 112, y: H - 50, r: 24, label: 'B' },
  { action: 'partner', x: W - 108, y: H - 118, r: 18, label: 'C' },
  { action: 'menu', x: W - 30, y: 28, r: 18, label: 'M' },
];

export class TouchControlsScene extends Phaser.Scene {
  private gfx!: Phaser.GameObjects.Graphics;
  private held = new Map<number, Action[]>();
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'touch_controls', active: false });
  }

  create(): void {
    this.input.addPointer(3);
    this.gfx = this.add.graphics();
    const labels = BUTTONS.map((b) => pixelText(this, b.x, b.y - 8, b.label, 16, '#f4ead2').setAlpha(0.8));
    this.layer = this.add.container(0, 0, [this.gfx, ...labels]);
    this.draw(new Set());

    const zones = [
      { x: PAD.x, y: PAD.y, r: PAD.r + 14 },
      ...BUTTONS.map((b) => ({ x: b.x, y: b.y, r: b.r + 8 })),
    ];
    const show = (on: boolean) => {
      this.layer.setVisible(on);
      input.setTouchZones(on ? zones : []);
      if (!on) {
        this.held.clear();
        input.clearTouch();
      }
    };
    show(input.device === 'touch');
    const off = bus.on('input.device', ({ device }) => show(device === 'touch'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);

    const update = (p: Phaser.Input.Pointer) => {
      if (!this.layer.visible) return;
      const before = this.held.get(p.id) ?? [];
      const after = p.isDown ? this.hit(p.x, p.y) : [];
      for (const a of before)
        if (!after.includes(a) && !this.heldElsewhere(a, p.id)) input.setTouch(a, false);
      for (const a of after) input.setTouch(a, true);
      if (after.length) this.held.set(p.id, after);
      else this.held.delete(p.id);
      this.draw(new Set([...this.held.values()].flat()));
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, update);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, update);
    this.input.on(Phaser.Input.Events.POINTER_UP, update);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, update);
  }

  private heldElsewhere(a: Action, pointerId: number): boolean {
    for (const [id, acts] of this.held) if (id !== pointerId && acts.includes(a)) return true;
    return false;
  }

  /** Which actions a finger at (x, y) presses. The d-pad allows diagonals. */
  private hit(x: number, y: number): Action[] {
    const dx = x - PAD.x;
    const dy = y - PAD.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= PAD.r + 14) {
      if (dist < 10) return [];
      const ang = Math.atan2(dy, dx); // 0 = right
      const out: Action[] = [];
      const deg = (ang * 180) / Math.PI;
      if (deg > -67.5 && deg < 67.5) out.push('right');
      if (deg > 112.5 || deg < -112.5) out.push('left');
      if (deg > 22.5 && deg < 157.5) out.push('down');
      if (deg < -22.5 && deg > -157.5) out.push('up');
      return out;
    }
    for (const b of BUTTONS) if ((x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 8) ** 2) return [b.action];
    return [];
  }

  private draw(active: Set<Action>): void {
    const g = this.gfx;
    g.clear();
    // d-pad: a plus shape
    const arm = 18;
    const len = PAD.r;
    g.fillStyle(UI.void, 0.45).fillCircle(PAD.x, PAD.y, PAD.r + 6);
    const dirs: [Action, number, number, number, number][] = [
      ['up', PAD.x - arm / 2, PAD.y - len, arm, len - arm / 2],
      ['down', PAD.x - arm / 2, PAD.y + arm / 2, arm, len - arm / 2],
      ['left', PAD.x - len, PAD.y - arm / 2, len - arm / 2, arm],
      ['right', PAD.x + arm / 2, PAD.y - arm / 2, len - arm / 2, arm],
    ];
    g.fillStyle(UI.borderHi, 0.75).fillRect(PAD.x - arm / 2, PAD.y - arm / 2, arm, arm);
    for (const [a, x, y, w, h] of dirs) {
      g.fillStyle(active.has(a) ? UI.spark : UI.borderHi, active.has(a) ? 0.95 : 0.75).fillRect(x, y, w, h);
    }
    for (const b of BUTTONS) {
      const on = active.has(b.action);
      g.fillStyle(UI.void, 0.45).fillCircle(b.x, b.y, b.r + 3);
      g.fillStyle(on ? UI.spark : b.action === 'confirm' ? UI.rope : UI.borderHi, on ? 0.95 : 0.75);
      g.fillCircle(b.x, b.y, b.r);
    }
  }
}
