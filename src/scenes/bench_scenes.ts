// Dev-hub test screens: input tester, UI kit, animations and palettes, and the
// data report. Each one exercises one foundation on its own.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { ACTIONS, input } from '../systems/input';
import { animKey, paletteSwap } from '../systems/anim_builder';
import { TEST_COLORS } from '../systems/test_sprites';
import { placeholderKeys } from '../systems/placeholder';
import { Bar, BAR_STYLES, MenuList, confirmDialog, drawPanel, panel, type MenuItem } from '../ui/components';
import { benchBackdrop, hintLine } from '../ui/bench';
import { pixelText } from '../ui/pixel_text';
import { UI, css } from '../ui/theme';
import { SceneLoader } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { englishKeys } from '../managers/strings';
import { allSpriteKeys } from '../managers/asset_packs';

function backToHub(scene: Phaser.Scene, cursor: number): void {
  SceneLoader.goto(scene, 'dev_hub', { cursor });
}

// ── Input tester ──────────────────────────────────────────────────────

export class InputTestScene extends Phaser.Scene {
  private cells: { action: string; box: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }[] = [];
  private device!: Phaser.GameObjects.Text;
  private log!: Phaser.GameObjects.Text;
  private leaving = false;

  constructor() {
    super('input_test');
  }

  create(): void {
    this.leaving = false;
    this.cells = [];
    benchBackdrop(this, 'INPUT TESTER', 'keyboard · gamepad · touch');
    this.device = pixelText(this, 24, 84, '', 24, css(UI.spark)).setOrigin(0, 0);
    ACTIONS.forEach((a, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = 24 + col * 183;
      const y = 138 + row * 90;
      const box = this.add.graphics();
      box.setPosition(x, y);
      const label = pixelText(this, x + 84, y + 21, '', 16).setOrigin(0.5, 0);
      this.cells.push({ action: a, box, label });
    });
    pixelText(this, 24, 330, 'Last presses (newest first):', 16, css(UI.inkDim)).setOrigin(0, 0);
    this.log = pixelText(this, 24, 357, '', 16).setOrigin(0, 0).setLineSpacing(6);
    pixelText(this, W / 2, H - 30, 'Press MENU (Esc / Start / M) to go back', 16, css(UI.inkDim));
  }

  update(): void {
    this.device.setText(`Device in use: ${input.device.toUpperCase()}`);
    for (const c of this.cells) {
      const down = input.isDown(c.action as never);
      c.box.clear();
      drawPanel(c.box, 0, 0, 168, 72, {
        fill: down ? UI.spark : UI.panel,
        border: down ? UI.ink : UI.border,
      });
      c.label.setText(`${c.action.toUpperCase()}\n\n${input.prompt(c.action as never)}`);
      c.label.setColor(down ? css(UI.void) : css(UI.ink));
    }
    this.log.setText(
      input.history
        .slice(0, 6)
        .map((h) => `${h.action.padEnd(8)} ${h.device}`)
        .join('\n'),
    );
    if (!this.leaving && input.justPressed('menu')) {
      this.leaving = true;
      backToHub(this, 1);
    }
  }
}

// ── UI kit ────────────────────────────────────────────────────────────

export class UiKitScene extends Phaser.Scene {
  constructor() {
    super('ui_kit');
  }

  create(): void {
    benchBackdrop(this, 'UI KIT', 'panels · menus · bars · dialog');
    let hp = 10;
    let grit = 5;
    let hype = 2;
    const bars = this.add.container(552, 96);
    const g = this.add.graphics();
    drawPanel(g, 0, 0, 384, 138);
    const hpBar = new Bar(this, 21, 24, 342, BAR_STYLES.hp, hp, 10);
    const gritBar = new Bar(this, 21, 57, 342, BAR_STYLES.grit, grit, 5);
    const hypeBar = new Bar(this, 21, 90, 342, BAR_STYLES.hype, hype, 6);
    bars.add([g, hpBar, gritBar, hypeBar]);

    panel(this, 552, 258, 384, 96, { fill: UI.panelHi });
    pixelText(this, 744, 279, 'A raised panel', 16);
    pixelText(this, 744, 309, 'for pop-ups and notes', 16, css(UI.inkDim));

    const desc = pixelText(this, 24, 450, '', 16)
      .setOrigin(0, 0)
      .setWordWrapWidth(W - 48);
    const filler: MenuItem[] = ['Steel Chair', 'Water Bottle', 'Protein Shake', 'Ring Bell', 'Sandwich'].map(
      (n, i) => ({
        label: n,
        value: `f${i}`,
        right: String(i + 1),
        desc: 'A filler row to show the list scrolling.',
      }),
    );
    const items: MenuItem[] = [
      { label: 'Lose 3 HP', value: 'hurt', desc: 'Shows the pale "ghost" that drains after a hit.' },
      { label: 'Heal 2 HP', value: 'heal', desc: 'Bars fill straight away when you gain.' },
      { label: 'Spend 2 Grit', value: 'grit', right: '2', desc: 'Greys out when Grit runs low.' },
      { label: 'Cheer (+1 Hype)', value: 'hype', desc: 'The Hype meter fills from crowd reactions.' },
      { label: 'Ask a question', value: 'ask', desc: 'Opens the Yes/No dialog. No is the default.' },
      {
        label: 'Locked move',
        value: 'locked',
        disabled: true,
        reason: 'Disabled items say why: "Needs the 2nd belt".',
      },
      ...filler,
    ];
    const refresh = () => {
      items[2].disabled = grit < 2;
      items[2].reason = 'Not enough Grit.';
      const c = menu.cursor;
      menu.setItems(items);
      menu.setCursor(c);
    };
    const menu = new MenuList(this, 24, 96, {
      width: 504,
      rows: 8,
      items,
      descText: desc,
      onSelect: (item) => {
        if (item.value === 'hurt') hpBar.setValue((hp = Math.max(0, hp - 3)));
        if (item.value === 'heal') hpBar.setValue((hp = Math.min(10, hp + 2)));
        if (item.value === 'grit') gritBar.setValue((grit = Math.max(0, grit - 2)));
        if (item.value === 'hype') hypeBar.setValue((hype = Math.min(6, hype + 1)));
        if (item.value === 'ask') {
          menu.active = false;
          confirmDialog(this, 'Replay the last match?', (yes) => {
            desc.setText(yes ? 'You chose Yes.' : 'You chose No.');
            menu.focus();
          });
          return;
        }
        if (item.value === 'grit' && grit < 2) grit = 5; // refill for testing once empty
        refresh();
      },
      onCancel: () => {
        menu.active = false;
        backToHub(this, 2);
      },
    });
    hintLine(this, [
      ['confirm', 'choose'],
      ['cancel', 'hub'],
    ]);
  }
}

// ── Animations and palette swaps ──────────────────────────────────────

export class AnimTestScene extends Phaser.Scene {
  constructor() {
    super('anim_test');
  }

  create(): void {
    benchBackdrop(this, 'ANIMATIONS', 'built from frame names');
    const tex = 'spr_test_dummy';
    const anims = ['idle', 'walk', 'chop', 'hurt'];
    anims.forEach((a, i) => {
      const x = 135 + i * 180;
      this.add.sprite(x, 220, tex, `${a}_00`).setOrigin(0.5, 1).play(animKey(tex, a));
      pixelText(this, x, 230, a.toUpperCase(), 16);
    });

    // palette swaps: same frames, different colours
    const C = TEST_COLORS;
    paletteSwap(this, tex, 'spr_test_dummy_red', {
      [C.shirt]: 0xb02a40,
      [C.shirtHi]: 0xd8314b,
      [C.mask]: 0x2a6fd8,
    });
    paletteSwap(this, tex, 'spr_test_dummy_shadow', {
      [C.shirt]: 0x2b2338,
      [C.shirtHi]: 0x3a3045,
      [C.mask]: 0x1b1622,
      [C.skin]: 0x5b5068,
      [C.trunks]: 0x5e1422,
      [C.boots]: 0x8a7f99,
      [C.maskEye]: 0xff4d6d,
    });
    const variants: [string, string][] = [
      [tex, 'BASE'],
      ['spr_test_dummy_red', 'RIVAL'],
      ['spr_test_dummy_shadow', 'SHADOW (CH. 8)'],
    ];
    variants.forEach(([key, label], i) => {
      const x = 195 + i * 285;
      this.add.sprite(x, 420, key, 'walk_00').setOrigin(0.5, 1).play(animKey(key, 'walk'));
      pixelText(this, x, 430, label, 16, css(UI.inkDim));
    });
    pixelText(this, W / 2, 280, 'Palette swaps: one sprite, many variants', 16, css(UI.spark));

    const leave = () => backToHub(this, 3);
    let gone = false;
    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      if (!gone && (input.justPressed('cancel') || input.justPressed('confirm'))) {
        gone = true;
        leave();
      }
    });
    hintLine(this, [['cancel', 'hub']]);
  }
}

// ── Data report ───────────────────────────────────────────────────────

export class DataReportScene extends Phaser.Scene {
  constructor() {
    super('data_report');
  }

  create(): void {
    benchBackdrop(this, 'DATA REPORT', 'what the database loaded');
    const c = Database.counts();
    const sprites = allSpriteKeys();
    const missingArt = placeholderKeys().filter((k) => sprites.has(k));
    const lines = [
      `characters.json   ${c.characters}`,
      `enemies.json      ${c.enemies}`,
      `moves.json        ${c.moves}`,
      `items.json        ${c.items}`,
      `formations.json   ${c.formations}`,
      '',
      `sprites declared  ${sprites.size}`,
      `still placeholder ${missingArt.length}`,
      `strings (EN)      ${englishKeys().size}`,
    ];
    pixelText(this, 36, 90, lines.join('\n'), 8).setOrigin(0, 0).setLineSpacing(9);

    const problems = Database.problems();
    pixelText(
      this,
      510,
      90,
      problems.length ? `${problems.length} PROBLEMS` : 'NO PROBLEMS',
      16,
      css(problems.length ? UI.rope : UI.good),
    ).setOrigin(0, 0);
    const body = problems.length
      ? problems
          .slice(0, 14)
          .map((p) => `${p.file} · ${p.id}\n  ${p.message}`)
          .join('\n')
      : 'Every reference checks out:\nmoves, sprites, enemies,\nformations and text keys.\n\nBreak something in a JSON\nfile and it shows up here\nwith the file and the id.';
    pixelText(this, 510, 132, body, 8, css(UI.inkDim))
      .setOrigin(0, 0)
      .setLineSpacing(4)
      .setWordWrapWidth(W - 534);

    let gone = false;
    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      if (!gone && (input.justPressed('cancel') || input.justPressed('confirm'))) {
        gone = true;
        backToHub(this, 4);
      }
    });
    hintLine(this, [['cancel', 'hub']]);
  }
}
