// Game Over: Chispa lost a fight the story doesn't allow losing. Continue
// loads the newest save (usually the autosave from entering the room); the
// other choice goes back to the title.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { MenuList, type MenuItem } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { UI, css } from '../ui/theme';
import { t } from '../managers/strings';
import { SceneLoader } from '../managers/scene_loader';
import { SaveManager } from '../managers/save_manager';
import { startFromSave } from '../managers/game_flow';

export class GameOverScene extends Phaser.Scene {
  /** For the browser test. */
  menu: MenuList | null = null;
  private busy = false;

  constructor() {
    super('game_over');
  }

  create(): void {
    this.busy = false;
    this.cameras.main.setBackgroundColor(0x07050a);
    // a single spotlight on an empty ring floor
    const g = this.add.graphics();
    g.fillStyle(0x1b1526).fillEllipse(W / 2, H - 70, 420, 70);
    g.fillStyle(0x2a2236, 0.8).fillEllipse(W / 2, H - 70, 260, 40);
    g.fillStyle(0xfff1c4, 0.05).fillTriangle(W / 2 - 20, 0, W / 2 + 20, 0, W / 2 + 160, H - 70);
    g.fillStyle(0xfff1c4, 0.05).fillTriangle(W / 2 - 20, 0, W / 2 - 160, H - 70, W / 2 + 160, H - 70);

    const shadow = pixelText(this, W / 2 + 3, 92 + 3, t('gameover.title'), 32, '#1b0a10');
    const title = pixelText(this, W / 2, 92, t('gameover.title'), 32, css(UI.rope));
    for (const o of [shadow, title]) o.setScale(1, 0);
    this.tweens.add({ targets: [shadow, title], scaleY: 1, duration: 260, delay: 200, ease: 'Back.easeOut' });
    pixelText(this, W / 2, 132, t('gameover.note'), 8, css(UI.inkDim));

    const latest = SaveManager.latest();
    const items: MenuItem[] = [
      {
        label: t('gameover.continue'),
        value: 'continue',
        disabled: !latest,
        reason: t('gameover.no_save'),
      },
      { label: t('gameover.title_screen'), value: 'title' },
    ];
    const desc = pixelText(this, W / 2, H - 30, '', 8, css(UI.inkDim));
    this.time.delayedCall(600, () => {
      this.menu = new MenuList(this, W / 2 - 150, 176, {
        width: 300,
        rows: items.length,
        rowHeight: 24,
        items,
        descText: desc,
        cancellable: false,
        onSelect: (item) => this.choose(item.value),
      });
      // the menu widens to fit its longest line: centre what it became
      this.menu.x = Math.round((W - this.menu.getBounds().width) / 2);
      if (!latest) this.menu.setCursor(1);
    });
    this.cameras.main.fadeIn(500, 7, 5, 10);
  }

  private choose(value: string): void {
    if (this.busy) return;
    this.busy = true;
    const slot = SaveManager.latest();
    const data = value === 'continue' && slot ? SaveManager.load(slot) : null;
    if (!data) {
      SceneLoader.goto(this, 'title');
      return;
    }
    startFromSave(this, data);
  }
}
