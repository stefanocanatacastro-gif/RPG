// A simple text box along the bottom of the screen: an optional name tag, text
// typed out a few letters at a time, Confirm to finish a line or go to the next.
// Signs, chests and people use it now; the dialogue system (bubbles over the
// speaker, choices, portraits) will build on it.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { input } from '../systems/input';
import { drawPanel } from './components';
import { pixelText } from './pixel_text';
import { UI, css } from './theme';

export interface Line {
  name?: string;
  text: string;
}

const CHARS_PER_SEC = 60;
const BOX = { x: 24, w: W - 48, h: 126, y: H - 126 - 21 };

export class MessageBox {
  /** True while a message is on screen (the browser test reads it). */
  open = false;

  constructor(private scene: Phaser.Scene) {}

  /** Shows the lines one after another; resolves when the last one is dismissed. */
  async show(lines: Line[]): Promise<void> {
    if (lines.length === 0) return;
    this.open = true;
    const s = this.scene;
    const top = 2_000_000;
    const g = s.add.graphics().setScrollFactor(0).setDepth(top);
    drawPanel(g, BOX.x, BOX.y, BOX.w, BOX.h, { alpha: 0.97 });
    const tagG = s.add.graphics().setScrollFactor(0).setDepth(top);
    const tag = pixelText(s, BOX.x + 30, BOX.y - 20, '', 16, css(UI.spark))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(top + 1);
    const body = pixelText(s, BOX.x + 24, BOX.y + 21, '', 24, css(UI.ink))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(top + 1)
      .setWordWrapWidth(BOX.w - 48)
      .setLineSpacing(9);
    const more = pixelText(s, BOX.x + BOX.w - 27, BOX.y + BOX.h - 24, '>', 16, css(UI.spark))
      .setScrollFactor(0)
      .setDepth(top + 1);
    const parts = [g, tagG, tag, body, more];

    for (const line of lines) {
      tagG.clear();
      tag.setText(line.name ? line.name.toUpperCase() : '');
      if (line.name) drawPanel(tagG, BOX.x + 12, BOX.y - 30, tag.width + 36, 33, { alpha: 0.97 });
      await this.typeLine(body, more, line.text);
    }
    for (const p of parts) p.destroy();
    this.open = false;
  }

  private typeLine(
    body: Phaser.GameObjects.Text,
    more: Phaser.GameObjects.Text,
    text: string,
  ): Promise<void> {
    const s = this.scene;
    return new Promise((resolve) => {
      const start = s.time.now;
      let done = false;
      body.setText('');
      more.setVisible(false);
      const tick = () => {
        const shown = Math.min(text.length, Math.floor(((s.time.now - start) / 1000) * CHARS_PER_SEC));
        if (!done) {
          body.setText(text.slice(0, shown));
          if (shown >= text.length) {
            done = true;
            more.setVisible(true);
          }
        } else more.setVisible(Math.floor(s.time.now / 300) % 2 === 0);
        if (s.time.now - start < 150 || !input.justPressed('confirm')) return;
        if (!done) {
          // first press finishes the line
          done = true;
          body.setText(text);
          more.setVisible(true);
          return;
        }
        s.events.off(Phaser.Scenes.Events.UPDATE, tick);
        resolve();
      };
      s.events.on(Phaser.Scenes.Events.UPDATE, tick);
    });
  }
}
