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
    g.fillStyle(0x1b1526).fillEllipse(W / 2, H - 105, 630, 105);
    g.fillStyle(0x2a2236, 0.8).fillEllipse(W / 2, H - 105, 390, 60);
    g.fillStyle(0xfff1c4, 0.05).fillTriangle(W / 2 - 30, 0, W / 2 + 30, 0, W / 2 + 240, H - 105);
    g.fillStyle(0xfff1c4, 0.05).fillTriangle(W / 2 - 30, 0, W / 2 - 240, H - 105, W / 2 + 240, H - 105);

    const shadow = pixelText(this, W / 2 + 4, 138 + 4, t('gameover.title'), 48, '#1b0a10');
    const title = pixelText(this, W / 2, 138, t('gameover.title'), 48, css(UI.rope));
    for (const o of [shadow, title]) o.setScale(1, 0);
    this.tweens.add({ targets: [shadow, title], scaleY: 1, duration: 260, delay: 200, ease: 'Back.easeOut' });
    pixelText(this, W / 2, 198, t('gameover.note'), 16, css(UI.inkDim));

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
    const desc = pixelText(this, W / 2, H - 45, '', 16, css(UI.inkDim));
    this.time.delayedCall(600, () => {
      this.menu = new MenuList(this, W / 2 - 225, 264, {
        width: 450,
        rows: items.length,
        rowHeight: 36,
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
