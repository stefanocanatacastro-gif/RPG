// The save-slot list, used by save blocks (save) and the title screen (load).
// Fixed to the screen, so it works in scrolling rooms too.

import Phaser from 'phaser';
import { GAME_WIDTH as W } from '../systems/integer_scale';
import { MenuList, drawPanel, type MenuItem } from './components';
import { pixelText } from './pixel_text';
import { UI, css } from './theme';
import { t, tf } from '../managers/strings';
import { SaveManager, playTime, type SlotId } from '../managers/save_manager';

const TOP = 2_100_000;

/** Lets the player pick a slot; resolves null on Cancel. */
export function pickSlot(scene: Phaser.Scene, mode: 'save' | 'load'): Promise<SlotId | null> {
  const slots: SlotId[] = mode === 'save' ? ['1', '2', '3'] : ['auto', '1', '2', '3'];
  const items: MenuItem[] = slots.map((slot) => {
    const m = SaveManager.meta(slot);
    const name = slot === 'auto' ? t('save.slot.auto') : tf('save.slot.n', { n: slot });
    return {
      label: m ? `${name}  ${m.roomName}` : `${name}  ${t('save.empty')}`,
      value: slot,
      right: m ? `LV ${m.level}  ${playTime(m.playTimeMs)}` : undefined,
      disabled: mode === 'load' && !m,
      reason: t('save.empty'),
      desc: m ? tf('save.when', { date: new Date(m.savedAt).toLocaleString() }) : '',
    };
  });
  const pw = 500;
  const ph = 60 + items.length * 26;
  const px = (W - pw) / 2;
  const py = 60;
  const g = scene.add.graphics().setScrollFactor(0).setDepth(TOP);
  drawPanel(g, px, py, pw, ph, { alpha: 0.97 });
  const title = pixelText(
    scene,
    W / 2,
    py + 16,
    t(mode === 'save' ? 'save.title' : 'save.load_title'),
    16,
    css(UI.spark),
  )
    .setScrollFactor(0)
    .setDepth(TOP);
  const desc = pixelText(scene, px + 16, py + ph - 20, '', 8, css(UI.inkDim))
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(TOP);
  return new Promise((resolve) => {
    const done = (v: SlotId | null) => {
      menu.destroy();
      g.destroy();
      title.destroy();
      desc.destroy();
      resolve(v);
    };
    const menu = new MenuList(scene, px + 12, py + 34, {
      width: pw - 24,
      rows: items.length,
      items,
      descText: desc,
      cancellable: true,
      onSelect: (item) => done(item.value as SlotId),
      onCancel: () => done(null),
    });
    menu.setScrollFactor(0).setDepth(TOP + 1);
    // start on the newest save when loading
    const latest = SaveManager.latest();
    if (mode === 'load' && latest) menu.setCursor(slots.indexOf(latest));
  });
}
