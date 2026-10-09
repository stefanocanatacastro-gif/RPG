// Battle stub: a placeholder for the battle system (next group of work). It
// proves the round trip: the field sleeps, this scene reads the formation from
// the Database, lays fighters out in their slots, changes GameState through
// the EventBus, and hands a result back to the field.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { MenuList, Bar, BAR_STYLES, drawPanel, type MenuItem } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText, tinyTextWidth } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { SceneLoader, type BattleStart } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { gameState } from '../managers/game_state';
import { bus, type BattleResult } from '../managers/event_bus';
import { t } from '../managers/strings';
import { animKey } from '../systems/anim_builder';
import { Rng } from '../systems/rng';
import { debugState } from '../systems/debug_state';
import type { FormationSlot } from '../types/data';

const FLOOR_Y = 286;
const SLOT_POS: Record<FormationSlot, { x: number; y: number }> = {
  front: { x: 420, y: FLOOR_Y },
  back: { x: 528, y: FLOOR_Y - 6 },
  air: { x: 470, y: FLOOR_Y - 92 },
};

export class BattleTestScene extends Phaser.Scene {
  private start!: BattleStart;
  private menu!: MenuList;
  private done = false;
  private rng!: Rng;
  private hero!: Phaser.GameObjects.Sprite;

  constructor() {
    super('battle_test');
  }

  create(start: BattleStart): void {
    this.start = start;
    this.done = false;
    this.rng = new Rng();
    this.registry.set('battleSeed', this.rng.seed);
    const formation = Database.formation(start.formation);

    this.drawStage();

    // hero
    this.add.ellipse(200, FLOOR_Y, 44, 8, 0x000000, 0.3);
    this.hero = this.add.sprite(200, FLOOR_Y, 'spr_test_dummy', 'idle_00').setOrigin(0.5, 1);
    this.hero.play(animKey('spr_test_dummy', 'idle'));

    // enemies by slot (a second enemy in the same slot steps further back)
    const used: Record<string, number> = {};
    for (const slot of formation.enemies) {
      const def = Database.enemy(slot.enemy);
      const n = (used[slot.slot] = (used[slot.slot] ?? 0) + 1) - 1;
      const pos = SLOT_POS[slot.slot];
      const x = pos.x + n * 70;
      if (slot.slot !== 'air') this.add.ellipse(x, FLOOR_Y, 40, 8, 0x000000, 0.3);
      const s = this.add.image(x, pos.y, def.sprite).setOrigin(0.5, 1);
      if (slot.slot === 'air') {
        this.tweens.add({
          targets: s,
          y: pos.y - 6,
          duration: 420,
          yoyo: true,
          repeat: -1,
          ease: 'Stepped',
          easeParams: [2],
        });
      }
      const name = t(def.name);
      pixelText(this, x, s.y - s.height - 28, `${name} ${def.hp}`, 8, css(UI.ink));
      const bar = new Bar(this, x - 36, s.y - s.height - 16, 72, BAR_STYLES.hp, def.hp, def.hp, true);
      bar.setDepth(5);
    }

    this.buildHud();
    this.buildMenu();

    if (start.firstStrike === 'player') this.banner('FIRST STRIKE!', UI.spark);
    else if (start.firstStrike === 'enemy') this.banner('AMBUSHED!', UI.rope);

    const seed = `SEED ${this.rng.seed}`;
    tinyText(this, W - 8 - tinyTextWidth(seed) * 2, H - 14, seed, css(UI.inkDim))
      .setOrigin(0)
      .setScale(2);
  }

  private drawStage(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0b0910).fillRect(0, 0, W, H);
    // crowd
    for (let row = 0; row < 4; row++) {
      const y = 120 + row * 22;
      const col = [0x1a1426, 0x221a31, 0x2b213d, 0x362a4c][row];
      g.fillStyle(col).fillRect(0, y + 10, W, 60);
      for (let x = (row * 5) % 12; x < W; x += 12 + row * 2) g.fillRect(x, y - (x % 3), 6 + row, 8 + row);
    }
    // ring
    g.fillStyle(0xb3a183).fillRect(60, FLOOR_Y - 46, W - 120, 52);
    g.fillStyle(0xd9c9a8).fillRect(60, FLOOR_Y - 46, W - 120, 46);
    g.fillStyle(0x8f1f33).fillRect(54, FLOOR_Y + 6, W - 108, 30);
    g.fillStyle(0x5e1422).fillRect(54, FLOOR_Y + 32, W - 108, 4);
    for (let i = 0; i < 3; i++) g.fillStyle(0xd8314b).fillRect(60, FLOOR_Y - 120 + i * 22, W - 120, 2);
    for (const x of [56, W - 64]) {
      g.fillStyle(0x8a7f99).fillRect(x, FLOOR_Y - 132, 8, 132);
      for (let i = 0; i < 3; i++) g.fillStyle(0x4c78e0).fillRect(x - 2, FLOOR_Y - 124 + i * 22, 12, 8);
    }
    pixelText(this, W / 2, 16, 'BATTLE STUB', 8, css(UI.inkDim));
    pixelText(this, W / 2, 30, 'The real battle system is the next group of work', 8, css(UI.inkDim));
  }

  private buildHud(): void {
    const gs = gameState();
    const box = this.add.graphics();
    drawPanel(box, 8, 48, 230, 46, { alpha: 0.92 });
    const hp = new Bar(this, 20, 58, 206, BAR_STYLES.hp, gs.hero().hp, gs.hero().maxHp);
    const grit = new Bar(this, 20, 76, 206, BAR_STYLES.grit, gs.data.grit, gs.data.maxGrit);
    const offs = [
      bus.on('hp.changed', (e) => hp.setValue(e.hp, e.maxHp)),
      bus.on('grit.changed', (e) => grit.setValue(e.grit, e.maxGrit)),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));
  }

  private items(): MenuItem[] {
    const gs = gameState();
    const bag = gs.data.items;
    return [
      { label: 'Win (stub)', value: 'win', desc: 'End the fight as a win and collect the coins.' },
      {
        label: 'Take 2 damage',
        value: 'hurt',
        desc: debugState.god ? 'God mode is on: no damage.' : 'Lose 2 HP, to test the HUD.',
      },
      {
        label: 'Use item',
        value: 'item',
        right: String(bag.length),
        disabled: bag.length === 0,
        reason: 'Your bag is empty. Give items from the debug menu.',
        desc: 'Use the first item in the bag.',
      },
      {
        label: 'Spend 2 Grit',
        value: 'grit',
        right: '2',
        disabled: gs.data.grit < 2,
        reason: 'Not enough Grit.',
        desc: 'Spend Grit, to test greyed-out options.',
      },
      { label: 'Run away', value: 'run', desc: 'Leave the fight. The enemy stays in the room.' },
    ];
  }

  private buildMenu(): void {
    const desc = pixelText(this, 16, H - 40, '', 8)
      .setOrigin(0, 0)
      .setWordWrapWidth(W - 160);
    this.menu = new MenuList(this, 8, 98, {
      width: 230,
      rows: 5,
      rowHeight: 22,
      items: this.items(),
      descText: desc,
      cancellable: false,
      onSelect: (item) => this.act(item.value),
    });
    this.menu.setDepth(10);
  }

  private act(what: string): void {
    if (this.done) return;
    const gs = gameState();
    const hero = gs.hero();
    switch (what) {
      case 'win':
        return this.finish('win');
      case 'run':
        return this.finish('run');
      case 'hurt':
        if (!debugState.god) {
          gs.setHp(hero.id, hero.hp - 2);
          this.hero.play(animKey('spr_test_dummy', 'hurt'));
          this.hero.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () =>
            this.hero.play(animKey('spr_test_dummy', 'idle')),
          );
          this.cameras.main.shake(120, 0.008);
        }
        break;
      case 'item': {
        const id = gs.takeItem(0);
        if (id) {
          const def = Database.item(id);
          if (def.effect.heal) gs.heal(hero.id, def.effect.heal);
          if (def.effect.grit) gs.setGrit(gs.data.grit + def.effect.grit);
          bus.emit('item.used', { id, by: hero.id });
          this.banner(t(def.name).toUpperCase(), UI.good);
        }
        break;
      }
      case 'grit':
        gs.spendGrit(2);
        break;
    }
    const c = this.menu.cursor;
    this.menu.setItems(this.items());
    this.menu.setCursor(c);
  }

  private banner(text: string, color: number): void {
    const b = pixelText(this, W / 2, 150, text, 24, css(color)).setDepth(20);
    this.tweens.add({
      targets: b,
      y: 140,
      alpha: 0,
      delay: 700,
      duration: 400,
      onComplete: () => b.destroy(),
    });
  }

  private finish(result: BattleResult): void {
    this.done = true;
    this.menu.active = false;
    if (result === 'win') {
      const f = Database.formation(this.start.formation);
      const coins = f.enemies.reduce((s, e) => s + Database.enemy(e.enemy).coins, 0);
      gameState().addCoins(coins);
      this.banner(`+${coins} COINS`, UI.spark);
    }
    this.time.delayedCall(result === 'win' ? 700 : 150, () =>
      SceneLoader.endBattle(this, this.start.returnTo, {
        result,
        formation: this.start.formation,
        fieldEnemyId: this.start.fieldEnemyId,
      }),
    );
  }
}
