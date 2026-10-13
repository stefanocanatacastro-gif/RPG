// Curtain wipe: two red theatre curtains close from the sides in stepped frames
// (a paper-stage feel), the scene changes behind them, then they open again.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';

const STEPS = 8;
const STEP_MS = 32;
const RED = 0x8f1f33;
const RED_DARK = 0x5e1422;
const RED_HI = 0xb02a40;
const GOLD = 0xf2c14e;

export class TransitionScene extends Phaser.Scene {
  private gfx!: Phaser.GameObjects.Graphics;
  private amount = 0; // 0 open, 1 closed

  constructor() {
    super({ key: 'transition' });
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();
    if (this.amount <= 0) return;
    const half = Math.ceil((W / 2) * this.amount) + 2;
    const curtain = (x0: number, dir: 1 | -1) => {
      const left = dir === 1 ? x0 : x0 - half;
      g.fillStyle(RED).fillRect(left, 0, half, H);
      // folds
      for (let i = 0; i < half; i += 24) {
        const fx = dir === 1 ? x0 + i : x0 - i - 9;
        g.fillStyle(RED_DARK).fillRect(fx, 0, 6, H);
        g.fillStyle(RED_HI).fillRect(fx + 7, 0, 3, H);
      }
      // gold trim on the leading edge and along the top
      const edge = dir === 1 ? x0 + half - 6 : x0 - half;
      g.fillStyle(GOLD).fillRect(edge, 0, 6, H);
    };
    curtain(0, 1);
    curtain(W, -1);
    g.fillStyle(RED_DARK).fillRect(0, 0, W, 21);
    g.fillStyle(GOLD).fillRect(0, 21, W, 3);
  }

  private animate(to: 0 | 1): Promise<void> {
    return new Promise((resolve) => {
      const from = this.amount;
      let step = 0;
      this.time.addEvent({
        delay: STEP_MS,
        repeat: STEPS - 1,
        callback: () => {
          step++;
          const t = step / STEPS;
          this.amount = from + (to - from) * (1 - (1 - t) * (1 - t));
          this.draw();
          if (step === STEPS) {
            this.amount = to;
            this.draw();
            resolve();
          }
        },
      });
    });
  }

  close(): Promise<void> {
    this.scene.bringToTop();
    return this.animate(1);
  }

  open(): Promise<void> {
    return this.animate(0);
  }
}
