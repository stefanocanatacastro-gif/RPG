// Debug menu (dev builds only). F1 or a triple-tap in the top-left corner opens
// it over whatever is running and freezes the game underneath. From here you
// can jump to a room, start any battle, toggle god mode, hitboxes and FPS,
// and give yourself coins or items.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { MenuList, panel, type MenuItem } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { Database } from '../managers/database';
import { gameState, hasGame, newGame } from '../managers/game_state';
import { SceneLoader } from '../managers/scene_loader';
import { debugState, setDebug, type DebugKey } from '../systems/debug_state';
import { rng } from '../systems/rng';
import { t } from '../managers/strings';

/** Scenes that are part of the game itself (the ones the debug menu acts on). */
const OVERLAYS = new Set(['debug', 'transition', 'touch_controls']);

export class DebugMenuScene extends Phaser.Scene {
  private open = false;
  private layer!: Phaser.GameObjects.Container;
  private menu: MenuList | null = null;
  private status!: Phaser.GameObjects.Text;
  private paused: string[] = [];
  private fpsText!: Phaser.GameObjects.Text;
  private taps: number[] = [];

  constructor() {
    super({ key: 'debug' });
  }

  create(): void {
    this.layer = this.add.container(0, 0).setVisible(false).setDepth(10);
    const shade = this.add.rectangle(0, 0, W, H, UI.void, 0.72).setOrigin(0);
    const box = panel(this, 140, 24, 360, 312, { fill: UI.panelHi, border: UI.rope });
    const title = pixelText(this, W / 2, 36, 'DEBUG', 16, css(UI.spark));
    this.status = pixelText(this, W / 2, 312, '', 8, css(UI.inkDim));
    this.layer.add([shade, box, title, this.status]);

    this.fpsText = pixelText(this, W - 6, 6, '', 8, css(UI.good))
      .setOrigin(1, 0)
      .setDepth(20)
      .setVisible(false);

    this.input.keyboard?.on('keydown-F1', (e: KeyboardEvent) => {
      e.preventDefault();
      this.toggle();
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.x > 44 || p.y > 44) return;
      const now = this.time.now;
      this.taps = [...this.taps.filter((ts) => now - ts < 700), now];
      if (this.taps.length >= 3) {
        this.taps = [];
        this.toggle();
      }
    });
  }

  update(): void {
    if (debugState.fps) {
      this.fpsText.setVisible(true).setText(`${Math.round(this.game.loop.actualFps)} FPS`);
    } else this.fpsText.setVisible(false);
  }

  /** The topmost running game scene (the one battles return to). */
  private host(): Phaser.Scene | null {
    const scenes = this.game.scene.getScenes(false) as Phaser.Scene[];
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i];
      if (!OVERLAYS.has(s.scene.key) && (s.scene.isActive() || s.scene.isPaused())) return s;
    }
    return null;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private show(): void {
    if (SceneLoader.isBusy()) return;
    this.open = true;
    this.scene.bringToTop();
    this.paused = [];
    for (const s of this.game.scene.getScenes(true) as Phaser.Scene[]) {
      if (!OVERLAYS.has(s.scene.key)) {
        s.scene.pause();
        this.paused.push(s.scene.key);
      }
    }
    this.layer.setVisible(true);
    this.showMain();
  }

  private close(): void {
    this.open = false;
    this.menu?.destroy();
    this.menu = null;
    this.layer.setVisible(false);
    for (const key of this.paused) this.scene.resume(key);
    this.paused = [];
  }

  private ensureGame(): void {
    if (!hasGame()) newGame(Database.character('chispa'));
  }

  private setMenu(
    items: MenuItem[],
    onSelect: (item: MenuItem) => void,
    onCancel: () => void,
    cursor = 0,
  ): void {
    this.menu?.destroy();
    this.menu = new MenuList(this, 160, 62, {
      width: 320,
      rows: 9,
      items,
      onSelect,
      onCancel,
    });
    this.menu.setCursor(cursor);
    this.layer.add(this.menu);
  }

  private flash(msg: string): void {
    this.status.setText(msg);
  }

  private showMain(cursor = 0): void {
    const onOff = (k: DebugKey) => (debugState[k] ? 'ON' : 'off');
    const items: MenuItem[] = [
      { label: 'Start battle', value: 'battle', right: '>' },
      { label: 'Warp to room', value: 'warp', right: '>' },
      { label: 'God mode', value: 'god', right: onOff('god') },
      { label: 'Hitboxes', value: 'hitboxes', right: onOff('hitboxes') },
      { label: 'Show FPS', value: 'fps', right: onOff('fps') },
      { label: 'Give 100 coins', value: 'coins' },
      { label: 'Give item', value: 'item', right: '>' },
      { label: 'Toggle flag', value: 'flag', right: '>' },
      { label: 'New RNG seed', value: 'seed' },
      { label: 'Close', value: 'close' },
    ];
    this.flash(`seed ${rng.seed}`);
    this.setMenu(
      items,
      (item) => {
        const i = items.indexOf(item);
        switch (item.value) {
          case 'battle':
            return this.showBattles();
          case 'warp':
            return this.showRooms();
          case 'item':
            return this.showItems();
          case 'flag':
            return this.showFlags();
          case 'god':
          case 'hitboxes':
          case 'fps':
            setDebug(item.value, !debugState[item.value]);
            return this.showMain(i);
          case 'coins':
            this.ensureGame();
            gameState().addCoins(100);
            this.flash(`coins: ${gameState().data.coins}`);
            return;
          case 'seed': {
            rng.setState((Math.random() * 0xffffffff) >>> 0);
            this.flash(`rng position ${rng.getState()}`);
            return;
          }
          case 'close':
            return this.close();
        }
      },
      () => this.close(),
      cursor,
    );
  }

  private showBattles(): void {
    const items = Database.data.formations.map((f) => ({
      label: f.id,
      value: f.id,
      right: String(f.enemies.length),
      desc: f.enemies.map((e) => t(Database.enemy(e.enemy).name)).join(', '),
    }));
    this.setMenu(
      items,
      (item) => {
        const host = this.host();
        if (!host) return this.flash('no scene to return to');
        this.ensureGame();
        this.close();
        SceneLoader.startBattle(host, 'battle', {
          formation: item.value,
          firstStrike: null,
          returnTo: host.scene.key,
        });
      },
      () => this.showMain(0),
    );
  }

  private showRooms(): void {
    const rooms = ['test_a', 'test_b', 'test_octagon'];
    this.setMenu(
      rooms.map((r) => ({ label: r, value: r })),
      (item) => {
        const host = this.host();
        if (!host) return;
        this.ensureGame();
        this.close();
        SceneLoader.enterRoom(host, 'field_test', { room: item.value, spawn: 'start' });
      },
      () => this.showMain(1),
    );
  }

  private showItems(): void {
    this.setMenu(
      Database.data.items.map((it) => ({ label: t(it.name), value: it.id })),
      (item) => {
        this.ensureGame();
        const ok = gameState().addItem(item.value);
        this.flash(ok ? `bag: ${gameState().data.items.length}/10` : 'bag is full');
      },
      () => this.showMain(6),
    );
  }

  private showFlags(): void {
    this.ensureGame();
    const keys = ['met_pip', 'ch1_started', 'brick_defeated'];
    const list = () => keys.map((k) => ({ label: k, value: k, right: gameState().isSet(k) ? 'ON' : 'off' }));
    this.setMenu(
      list(),
      (item) => {
        gameState().setFlag(item.value, !gameState().isSet(item.value));
        const c = this.menu?.cursor ?? 0;
        this.menu?.setItems(list());
        this.menu?.setCursor(c);
      },
      () => this.showMain(7),
    );
  }
}

// small helper so other scenes can show the "debug available" hint
export function debugHint(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Image {
  return tinyText(scene, x, y, 'F1 OR TRIPLE-TAP TOP-LEFT: DEBUG', css(UI.inkDim)).setOrigin(0).setScale(2);
}
