// Shared look for the dev-hub test screens: dark backdrop with a faint 32px
// grid (the tile size) and a header strip.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { pixelText } from './pixel_text';
import { tinyText } from './tiny_font';
import { UI, css } from './theme';
import { input, type Action } from '../systems/input';

export function benchBackdrop(scene: Phaser.Scene, title: string, sub?: string): void {
  const g = scene.add.graphics();
  g.fillStyle(UI.void).fillRect(0, 0, W, H);
  g.fillStyle(0x15111c);
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 1);
  g.fillStyle(UI.panel).fillRect(0, 0, W, 40);
  g.fillStyle(UI.rope).fillRect(0, 40, W, 2);
  pixelText(scene, 16, 12, title, 16, css(UI.spark)).setOrigin(0, 0);
  if (sub)
    tinyText(scene, W - 16, 17, sub.toUpperCase(), css(UI.inkDim))
      .setOrigin(1, 0)
      .setScale(2);
}

/** A bottom hint line whose button names follow the device in use. */
export function hintLine(scene: Phaser.Scene, parts: [Action, string][]): Phaser.GameObjects.Text {
  const txt = pixelText(scene, W / 2, H - 20, '', 8, css(UI.inkDim));
  const render = () => txt.setText(parts.map(([a, label]) => `${input.prompt(a)}: ${label}`).join('   '));
  render();
  scene.events.on(Phaser.Scenes.Events.UPDATE, render);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
    scene.events.off(Phaser.Scenes.Events.UPDATE, render),
  );
  return txt;
}
