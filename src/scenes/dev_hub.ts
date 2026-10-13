import Phaser from 'phaser';
import { GAME_WIDTH as W } from '../systems/integer_scale';
import { MenuList } from '../ui/components';
import { benchBackdrop, hintLine } from '../ui/bench';
import { pixelText } from '../ui/pixel_text';
import { UI, css } from '../ui/theme';
import { SceneLoader } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { versionLabel } from '../systems/version';

// Dev hub: one screen that reaches every foundation test.
export class DevHubScene extends Phaser.Scene {
  constructor() {
    super('dev_hub');
  }

  create(data: { cursor?: number }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    benchBackdrop(this, t('hub.title'), versionLabel());
    pixelText(this, 24, 72, t('hub.subtitle'), 16, css(UI.inkDim)).setOrigin(0, 0);

    const desc = pixelText(this, 664, 108, '', 16)
      .setOrigin(0, 0)
      .setWordWrapWidth(W - 688)
      .setLineSpacing(8);
    const problems = Database.problems();
    const c = Database.counts();
    const dataLine = `${c.characters + c.enemies + c.moves + c.items + c.formations} data entries · ${
      problems.length === 0 ? 'no problems' : `${problems.length} problem${problems.length > 1 ? 's' : ''}`
    }`;
    pixelText(this, 664, 400, dataLine, 16, css(problems.length ? UI.rope : UI.good))
      .setOrigin(0, 0)
      .setWordWrapWidth(W - 688);

    const targets: Record<string, string> = {
      field: 'field',
      sandbox: 'battle_sandbox',
      editor: 'room_editor',
      maker: 'fighter_maker',
      items: 'item_maker',
      encounters: 'encounters',
      moves: 'move_maker',
      gallery: 'gallery',
      input: 'input_test',
      ui: 'ui_kit',
      anim: 'anim_test',
      data: 'data_report',
      back: 'title',
    };
    const keys = Object.keys(targets);
    const menu = new MenuList(this, 24, 102, {
      width: 552,
      rows: 9,
      rowHeight: 36,
      items: keys.map((k) => ({ label: t(`hub.${k}`), value: k, desc: t(`hub.${k}.desc`) })),
      descText: desc,
      cancellable: true,
      onSelect: (item) => {
        menu.active = false;
        const entry = item.value === 'field' ? { room: 'test_a', spawn: 'start' } : { from: 'hub' };
        SceneLoader.goto(this, targets[item.value], entry);
      },
      onCancel: () => {
        menu.active = false;
        SceneLoader.goto(this, 'title');
      },
    });
    if (data?.cursor) menu.setCursor(data.cursor);

    hintLine(this, [
      ['confirm', 'open'],
      ['cancel', 'title'],
    ]);
    pixelText(this, 664, 470, t('hub.debug_hint'), 8, css(UI.inkDim))
      .setOrigin(0, 0)
      .setWordWrapWidth(W - 688);
  }
}
