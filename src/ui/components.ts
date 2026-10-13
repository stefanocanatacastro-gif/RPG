// Shared UI kit: pixel panels, a menu list with cursor and scrolling, HP/Grit/Hype
// bars, and a Yes/No confirm dialog. Every menu works with keyboard, gamepad and
// touch through the input actions.

import Phaser from 'phaser';
import { input } from '../systems/input';
import { pixelText } from './pixel_text';
import { tinyText, tinyTextWidth } from './tiny_font';
import { UI, css } from './theme';
import { t } from '../managers/strings';

// ── Panel ─────────────────────────────────────────────────────────────

export interface PanelStyle {
  fill?: number;
  border?: number;
  alpha?: number;
}

/** Draws a pixel panel: dark border, notched corners, a 1px highlight inside. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  style: PanelStyle = {},
): void {
  const fill = style.fill ?? UI.panel;
  const border = style.border ?? UI.border;
  const a = style.alpha ?? 1;
  g.fillStyle(border, a);
  g.fillRect(x + 2, y, w - 4, h);
  g.fillRect(x, y + 2, w, h - 4);
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle(fill, a);
  g.fillRect(x + 3, y + 3, w - 6, h - 6);
  g.fillStyle(UI.panelHi, a);
  g.fillRect(x + 3, y + 3, w - 6, 1);
  g.fillRect(x + 3, y + 3, 1, h - 6);
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, style?: PanelStyle) {
  const g = scene.add.graphics();
  drawPanel(g, x, y, w, h, style);
  return g;
}

// ── Menu list ─────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  value: string;
  /** Shown on the right of the row (a cost, a count). */
  right?: string;
  /** Description shown in the description line while the item is highlighted. */
  desc?: string;
  disabled?: boolean;
  /** Why it's disabled ("Not enough Grit"). Shown in place of desc. */
  reason?: string;
}

export interface MenuOptions {
  width: number;
  rows?: number;
  rowHeight?: number;
  items: MenuItem[];
  /** A text object elsewhere on screen that shows the highlighted item's desc/reason. */
  descText?: Phaser.GameObjects.Text;
  onSelect?: (item: MenuItem, index: number) => void;
  onCancel?: () => void;
  onChange?: (item: MenuItem, index: number) => void;
  /** Whether Cancel is allowed (top-level menus may not allow it). */
  cancellable?: boolean;
}

const REPEAT_DELAY = 300;
const REPEAT_EVERY = 90;

export class MenuList extends Phaser.GameObjects.Container {
  cursor = 0;
  active = true;
  private top = 0;
  private items: MenuItem[];
  private opts: Required<Pick<MenuOptions, 'rows' | 'rowHeight' | 'width'>> & MenuOptions;
  private bg: Phaser.GameObjects.Graphics;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private rightTexts: Phaser.GameObjects.Text[] = [];
  private arrow: Phaser.GameObjects.Graphics;
  private scrollMarks: Phaser.GameObjects.Graphics;
  private holdDir = 0;
  private holdSince = 0;
  private lastRepeat = 0;
  /** Input is ignored briefly after creation so the press that opened a menu doesn't also pick in it. */
  private readyAt: number;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: MenuOptions) {
    super(scene, x, y);
    this.items = opts.items;
    this.readyAt = scene.time.now + 120;
    // Panels grow to fit the longest label, so text never spills out.
    const longest = Math.max(0, ...opts.items.map((i) => i.label.length));
    const longestRight = Math.max(0, ...opts.items.map((i) => (i.right ?? '').length));
    const fit = 51 + longest * 24 + (longestRight ? longestRight * 24 + 30 : 0) + 21;
    this.opts = {
      ...opts,
      rows: Math.min(opts.items.length, opts.rows ?? 6),
      rowHeight: opts.rowHeight ?? 39,
      width: Math.max(opts.width, fit),
    };
    const { width, rowHeight } = this.opts;
    const rows = Math.max(1, this.opts.rows);
    this.opts.rows = rows;
    const h = rows * rowHeight + 24;

    this.bg = scene.add.graphics();
    drawPanel(this.bg, 0, 0, width, h);
    this.add(this.bg);

    for (let i = 0; i < rows; i++) {
      const y = 12 + i * rowHeight + Math.floor((rowHeight - 24) / 2);
      const txt = pixelText(scene, 0, y, '', 24).setOrigin(0, 0).setX(51);
      const right = pixelText(scene, 0, y, '', 24)
        .setOrigin(1, 0)
        .setX(width - 21);
      this.rowTexts.push(txt);
      this.rightTexts.push(right);
      this.add([txt, right]);
    }
    this.arrow = scene.add.graphics();
    this.arrow.fillStyle(UI.spark).fillTriangle(0, 0, 0, 18, 12, 9);
    this.add(this.arrow);
    this.scrollMarks = scene.add.graphics();
    this.add(this.scrollMarks);

    scene.add.existing(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () =>
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this),
    );

    this.setSize(width, h);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onTap, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () =>
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onTap, this),
    );

    // start on the first enabled item
    const first = this.items.findIndex((i) => !i.disabled);
    this.cursor = first >= 0 ? first : 0;
    this.render();
  }

  get boxWidth(): number {
    return this.opts.width;
  }

  get boxHeight(): number {
    return this.opts.rows * this.opts.rowHeight + 24;
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    this.cursor = Math.min(this.cursor, Math.max(0, items.length - 1));
    this.render();
  }

  setCursor(i: number): void {
    this.cursor = Math.max(0, Math.min(i, this.items.length - 1));
    this.render();
  }

  /** Re-arms the input guard (call when re-activating a menu after a sub-menu closes). */
  focus(): void {
    this.active = true;
    this.readyAt = this.scene.time.now + 120;
  }

  current(): MenuItem | undefined {
    return this.items[this.cursor];
  }

  private move(dir: number): void {
    if (this.items.length === 0) return;
    this.cursor = (this.cursor + dir + this.items.length) % this.items.length;
    this.render();
    this.opts.onChange?.(this.items[this.cursor], this.cursor);
  }

  private choose(index: number): void {
    const item = this.items[index];
    if (!item) return;
    if (item.disabled) {
      this.scene.cameras.main.shake(80, 0.004);
      return;
    }
    this.opts.onSelect?.(item, index);
  }

  private tick(time: number): void {
    if (!this.active || !this.visible) return;
    // gentle 2-step cursor bob
    this.arrow.x = 21 + (Math.floor(time / 300) % 2) * 2;
    if (time < this.readyAt) return;
    const dir = input.isDown('up') ? -1 : input.isDown('down') ? 1 : 0;
    if (dir !== 0 && (input.justPressed('up') || input.justPressed('down'))) {
      this.move(dir);
      this.holdDir = dir;
      this.holdSince = time;
      this.lastRepeat = time;
    } else if (dir !== 0 && dir === this.holdDir) {
      if (time - this.holdSince > REPEAT_DELAY && time - this.lastRepeat > REPEAT_EVERY) {
        this.move(dir);
        this.lastRepeat = time;
      }
    } else this.holdDir = 0;

    if (input.justPressed('confirm')) this.choose(this.cursor);
    else if (input.justPressed('cancel') && this.opts.cancellable !== false) this.opts.onCancel?.();
  }

  private onTap(p: Phaser.Input.Pointer): void {
    if (!this.active || !this.visible || this.scene.time.now < this.readyAt) return;
    if (input.onTouchControl(p.x, p.y)) return;
    const m = this.getWorldTransformMatrix();
    const lx = p.x - m.tx;
    const ly = p.y - m.ty - 12;
    if (lx < 0 || lx > this.opts.width || ly < 0) return;
    const row = Math.floor(ly / this.opts.rowHeight);
    if (row >= this.opts.rows) return;
    const index = this.top + row;
    if (index >= this.items.length) return;
    this.cursor = index;
    this.render();
    this.choose(index);
  }

  private render(): void {
    const { rows, rowHeight, width } = this.opts;
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + rows) this.top = this.cursor - rows + 1;
    for (let i = 0; i < rows; i++) {
      const item = this.items[this.top + i];
      const txt = this.rowTexts[i];
      const right = this.rightTexts[i];
      txt.setText(item?.label ?? '');
      right.setText(item?.right ?? '');
      const col = item?.disabled ? css(UI.inkDim) : this.top + i === this.cursor ? css(UI.ink) : '#d8cdb5';
      txt.setColor(col);
      right.setColor(item?.disabled ? css(UI.inkDim) : css(UI.spark));
    }
    this.arrow.y = 12 + (this.cursor - this.top) * rowHeight + Math.floor((rowHeight - 18) / 2);
    this.scrollMarks.clear();
    this.scrollMarks.fillStyle(UI.inkDim);
    const cx = width - 15;
    if (this.top > 0) this.scrollMarks.fillTriangle(cx - 6, 12, cx + 6, 12, cx, 4);
    if (this.top + rows < this.items.length) {
      const by = this.boxHeight - 12;
      this.scrollMarks.fillTriangle(cx - 6, by, cx + 6, by, cx, by + 8);
    }
    const item = this.items[this.cursor];
    if (this.opts.descText && item) {
      this.opts.descText.setText(item.disabled ? (item.reason ?? '') : (item.desc ?? ''));
      this.opts.descText.setColor(item.disabled ? css(UI.rope) : css(UI.ink));
    }
  }
}

// ── Bars ──────────────────────────────────────────────────────────────

export interface BarStyle {
  fill: number;
  back: number;
  label: string;
}

export const BAR_STYLES = {
  hp: { fill: UI.hp, back: UI.hpBack, label: 'HP' },
  grit: { fill: UI.grit, back: UI.gritBack, label: 'GRIT' },
  hype: { fill: UI.hype, back: UI.hypeBack, label: 'HYPE' },
} satisfies Record<string, BarStyle>;

/** A labelled bar. Losses leave a pale "ghost" that drains after a moment. */
export class Bar extends Phaser.GameObjects.Container {
  value: number;
  max: number;
  private gfx: Phaser.GameObjects.Graphics;
  private readout: Phaser.GameObjects.Image | null = null;
  private ghost: number;
  private ghostTween?: Phaser.Tweens.Tween;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private barW: number,
    private style: BarStyle,
    value: number,
    max: number,
    /** Compact bars (over enemies) have no label or number. */
    private compact = false,
  ) {
    super(scene, x, y);
    this.value = value;
    this.max = max;
    this.ghost = value;
    this.gfx = scene.add.graphics();
    if (!compact)
      this.add(tinyText(scene, 0, 0, style.label, css(UI.ink), css(UI.void)).setOrigin(0).setScale(3));
    this.add(this.gfx);
    scene.add.existing(this);
    this.draw();
  }

  private labelW(): number {
    return this.compact ? 3 : tinyTextWidth(this.style.label) * 3 + 12;
  }

  setValue(value: number, max = this.max, animate = true): void {
    const before = this.value;
    this.value = Math.max(0, Math.min(max, value));
    this.max = max;
    this.ghostTween?.stop();
    if (animate && this.value < before) {
      this.ghost = before;
      const o = { g: before };
      this.ghostTween = this.scene.tweens.add({
        targets: o,
        g: this.value,
        delay: 350,
        duration: 400,
        onUpdate: () => {
          this.ghost = o.g;
          this.draw();
        },
      });
    } else this.ghost = this.value;
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    const x0 = this.labelW();
    const bw = this.barW - x0 - (this.compact ? 3 : 78);
    const h = this.compact ? 9 : 15;
    g.clear();
    g.fillStyle(UI.void).fillRect(x0 - 3, -1, bw + 6, h + 5);
    g.fillStyle(this.style.back).fillRect(x0, 1, bw, h);
    const frac = (v: number) => (this.max > 0 ? Math.round((bw * v) / this.max) : 0);
    g.fillStyle(UI.ghost, 0.85).fillRect(x0, 1, frac(this.ghost), h);
    g.fillStyle(this.style.fill).fillRect(x0, 1, frac(this.value), h);
    g.fillStyle(0xffffff, 0.25).fillRect(x0, 1, frac(this.value), 3);
    this.readout?.destroy();
    if (this.compact) return;
    const txt = `${this.value}/${this.max}`;
    this.readout = tinyText(this.scene, this.barW - tinyTextWidth(txt) * 3, 0, txt, css(UI.ink), css(UI.void))
      .setOrigin(0)
      .setScale(3);
    this.add(this.readout);
  }
}

// ── Confirm dialog ────────────────────────────────────────────────────

/** Modal Yes/No question. Cancel counts as No. Returns a function that closes it. */
export function confirmDialog(
  scene: Phaser.Scene,
  question: string,
  onAnswer: (yes: boolean) => void,
): () => void {
  const { width: W, height: H } = scene.scale;
  const w = 600;
  const q = pixelText(scene, W / 2, 0, question, 24);
  q.setWordWrapWidth(w - 60)
    .setAlign('center')
    .setLineSpacing(9);
  const boxH = Math.ceil(q.height) + 48;
  const menuH = 2 * 39 + 24;
  const top = Math.round((H - boxH - 12 - menuH) / 2);
  q.setY(top + 24);
  const shade = scene.add.rectangle(0, 0, W, H, UI.void, 0.6).setOrigin(0).setInteractive();
  const g = panel(scene, (W - w) / 2, top, w, boxH, { fill: UI.panelHi });
  const parts: Phaser.GameObjects.GameObject[] = [shade, g, q];
  const close = () => {
    for (const p of parts) p.destroy();
  };
  const menu = new MenuList(scene, (W - 240) / 2, top + boxH + 12, {
    width: 240,
    items: [
      { label: t('common.yes'), value: 'yes' },
      { label: t('common.no'), value: 'no' },
    ],
    onSelect: (item) => {
      close();
      onAnswer(item.value === 'yes');
    },
    onCancel: () => {
      close();
      onAnswer(false);
    },
  });
  menu.setCursor(1); // default to No, the safe answer
  parts.push(menu);
  shade.setDepth(1000);
  g.setDepth(1001);
  q.setDepth(1002);
  menu.setDepth(1002);
  return close;
}
