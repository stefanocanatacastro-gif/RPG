// Sprite studio: bring your own art. Upload a frame-by-frame sprite sheet for
// any fighter (a skin for Kid Chispa, Pip or a built-in enemy, or the look of
// one of your own fighters), check how it was cut into frames, pick which
// frames make each animation, and watch it play next to Kid Chispa at the size
// it will have in the ring. Animations a sheet doesn't have are made from its
// first idle frame, paper-cutout style. SAVE keeps every change; TRY opens the
// sandbox with that fighter.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { pickFile } from '../ui/pick_file';
import { textFieldOpen } from '../ui/text_field';
import { SceneLoader } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { animKey } from '../systems/anim_builder';
import {
  Builds,
  SHEET_ANIMS,
  SHEET_ANIM_LABEL,
  SHEET_FPS,
  SHEET_FRAME,
  globalId,
  myOwnerId,
  type CustomFighter,
  type FighterLook,
  type FighterSize,
  type SheetAnim,
  type SheetLook,
} from '../managers/builds';
import { decodePicture, decodedPicture } from '../systems/pictures';
import { drawSheetLook, importSheet, sheetPixels } from '../systems/sheets';
import { detectGrid, fitRuns, frameSizes, guessAnims } from '../systems/sheet_ops';

const TOP = 40;
const LIST = { x: 6, y: TOP + 6, w: 176, h: H - TOP - 40 };
const SHEET = { x: LIST.x + LIST.w + 8, y: TOP + 6, w: 470, h: 262 };
const STAGE = { x: SHEET.x, y: SHEET.y + SHEET.h + 8, w: SHEET.w, h: H - 40 - (SHEET.y + SHEET.h + 8) };
const PROPS = { x: SHEET.x + SHEET.w + 8, y: TOP + 6, w: W - (SHEET.x + SHEET.w + 8) - 6, h: H - TOP - 40 };
const ROW = 18;
const SHEET_TEX = 'spr_studio_sheet';
const PREVIEW_TEX = 'spr_studio_preview';

/** Whose look is being made: a skin for a built-in fighter, or one of your own fighters. */
type Target = { kind: 'skin'; id: string } | { kind: 'mine'; id: string };

interface Row {
  label: string;
  value: () => string;
  head?: boolean;
  /** Click on the row. */
  edit?: () => void;
  /** The < > arrows. */
  step?: (dir: number) => void;
  /** Highlighted (the selected animation). */
  hot?: () => boolean;
}

export class SpriteStudioScene extends Phaser.Scene {
  target: Target = { kind: 'skin', id: 'chispa' };
  /** Animation being edited (cells clicked on the sheet go to it). */
  sel: SheetAnim = 'idle';
  dirty = false;
  /** Working copies, saved together. */
  skins: Record<string, FighterLook> = {};
  fighters: CustomFighter[] = [];
  clearBackground = true;
  zoom = 2;
  compare = true;
  private pendingStart: number | null = null;
  private listScroll = 0;
  private propScroll = 0;
  private rows: Row[] = [];
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private status = '';
  private statusColor: number = UI.inkDim;
  private sheetView!: Phaser.GameObjects.Image;
  private preview!: Phaser.GameObjects.Sprite;
  private reference!: Phaser.GameObjects.Sprite;
  private shownSheet = '';
  /** Where the sheet is drawn, and at what scale (for clicks on cells). */
  private sheetBox = { x: 0, y: 0, scale: 1 };

  constructor() {
    super('sprite_studio');
  }

  create(data?: { target?: Target }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.skins = Builds.mySkins();
    this.fighters = Builds.mine();
    this.dirty = false;
    this.listScroll = 0;
    this.propScroll = 0;
    this.pendingStart = null;
    this.shownSheet = '';
    this.target = data?.target ?? { kind: 'skin', id: 'chispa' };
    this.sel = 'idle';
    this.cameras.main.setBackgroundColor(UI.void);
    const frame = this.add.graphics();
    for (const r of [LIST, SHEET, STAGE, PROPS])
      drawPanel(frame, r.x - 2, r.y - 2, r.w + 4, r.h + 4, { alpha: 1 });
    // the ring the preview stands on
    const floorY = STAGE.y + STAGE.h - 22;
    frame.fillStyle(0xc9b994).fillRect(STAGE.x, floorY - 6, STAGE.w, STAGE.y + STAGE.h - floorY + 6);
    frame.fillStyle(0xd9c9a8).fillRect(STAGE.x, floorY - 6, STAGE.w, 4);
    frame
      .fillStyle(0xb02a40)
      .fillRect(STAGE.x, floorY - 46, STAGE.w, 2)
      .fillRect(STAGE.x, floorY - 76, STAGE.w, 2);
    this.sheetView = this.add.image(0, 0, '__WHITE').setOrigin(0).setVisible(false);
    this.reference = this.add
      .sprite(STAGE.x + 90, floorY, 'spr_test_dummy', 'idle_00')
      .setOrigin(0.5, 1)
      .play(animKey('spr_test_dummy', 'idle'));
    this.preview = this.add
      .sprite(STAGE.x + STAGE.w / 2 + 40, floorY, 'spr_test_dummy', 'idle_00')
      .setOrigin(0.5, 1);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.onWheel(p, dy),
    );
    const onKey = (e: KeyboardEvent) => {
      if (textFieldOpen || !this.scene.isActive()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save();
      } else if (e.key === 'Escape') this.leave();
    };
    // a sheet dropped on the page, or pasted, goes to the fighter on screen
    const onDrag = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file && this.scene.isActive()) void this.useSheet(file);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (textFieldOpen || !this.scene.isActive()) return;
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (file) void this.useSheet(file);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('dragover', onDrag);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', onDrag);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    });
    this.setStatus('Pick a fighter, then upload (or drop, or paste) a sprite sheet: one row per animation.');
    this.refresh();
  }

  // ── The fighter being dressed ───────────────────────────────────────

  private mineFighter(): CustomFighter | undefined {
    const tg = this.target;
    return tg.kind === 'mine' ? this.fighters.find((f) => f.id === tg.id) : undefined;
  }

  /** The current target's look, if it has one of its own. */
  private look(): FighterLook | undefined {
    return this.target.kind === 'skin' ? this.skins[this.target.id] : this.mineFighter()?.look;
  }

  /** The sheet being edited, if any. */
  sheet(): SheetLook | undefined {
    const l = this.look();
    return l?.base === 'sheet' ? l.sheet : undefined;
  }

  private setSheet(sheet: SheetLook | undefined): void {
    const tg = this.target;
    if (tg.kind === 'skin') {
      if (sheet) this.skins[tg.id] = { base: 'sheet', sheet };
      else delete this.skins[tg.id];
    } else {
      const f = this.mineFighter();
      if (!f) return;
      f.look = sheet
        ? { ...f.look, base: 'sheet', sheet }
        : { base: 'wrestler', colors: f.look.colors ?? {} };
    }
    this.dirty = true;
  }

  private targetName(): string {
    const tg = this.target;
    if (tg.kind === 'mine') return this.mineFighter()?.name ?? '?';
    const c = Database.data.characters.find((x) => x.id === tg.id);
    const e = Database.data.enemies.find((x) => x.id === tg.id);
    return t((c ?? e)?.name ?? tg.id);
  }

  private targetSize(): FighterSize {
    const tg = this.target;
    if (tg.kind === 'mine') {
      const f = this.mineFighter();
      return f?.kind === 'enemy' ? (f.size ?? 'normal') : 'normal';
    }
    return Database.data.enemies.find((e) => e.id === tg.id)?.size ?? 'normal';
  }

  private setStatus(text: string, color: number = UI.inkDim): void {
    this.status = text;
    this.statusColor = color;
  }

  // ── Actions ─────────────────────────────────────────────────────────

  private async upload(): Promise<void> {
    const file = await pickFile();
    if (file) await this.useSheet(file);
  }

  /** Reads a sheet and gives it to the fighter on screen. Also used by the browser test with a data URL. */
  async useSheet(file: Blob | string): Promise<void> {
    if (this.target.kind === 'mine' && !this.mineFighter()) return;
    this.setStatus('Reading the sheet…');
    this.refresh();
    try {
      const sheet = await importSheet(file, this.clearBackground);
      const old = this.sheet();
      if (old?.flip) sheet.flip = true;
      this.setSheet(sheet);
      this.sel = 'idle';
      this.pendingStart = null;
      const n = Object.keys(sheet.anims).length;
      const want = SHEET_FRAME[this.targetSize()];
      const size =
        sheet.frameH < want * 0.6 || sheet.frameH > want * 1.6
          ? ` Frames are ${sheet.frameW}×${sheet.frameH}: ${this.targetSize()} fighters are drawn about ${want}×${want}.`
          : '';
      this.setStatus(
        `Cut into ${sheet.frameW}×${sheet.frameH} frames, ${n} animation${n === 1 ? '' : 's'} found. SAVE to keep it.${size}`,
        size ? UI.spark : UI.good,
      );
    } catch (e) {
      this.setStatus(String((e as { message?: string }).message ?? e), UI.rope);
    }
    this.refresh();
  }

  /** Cuts the sheet into a new frame size and guesses its animations again. */
  private reframe(frameW: number, frameH: number): void {
    const s = this.sheet();
    if (!s) return;
    const px = sheetPixels(s.url);
    const next = { ...s, frameW, frameH };
    if (px) {
      const grid = { frameW, frameH, cols: Math.floor(s.w / frameW), rows: Math.floor(s.h / frameH) };
      next.anims = guessAnims(px, grid);
      if (!next.anims.idle) next.anims.idle = { start: 0, count: 1, fps: SHEET_FPS.idle };
    } else next.anims = fitRuns(s.anims, Math.floor(s.w / frameW) * Math.floor(s.h / frameH));
    this.setSheet(next);
  }

  /** Cuts the sheet the way it was found when uploaded. */
  private autoFrame(): void {
    const s = this.sheet();
    const px = s && sheetPixels(s.url);
    if (!s || !px) return;
    const g = detectGrid(px);
    this.reframe(g.frameW, g.frameH);
  }

  /** A click on a sheet cell: the selected animation starts there, a second click ends it. */
  clickCell(cell: number): void {
    const s = this.sheet();
    if (!s) return;
    const fps = s.anims[this.sel]?.fps ?? SHEET_FPS[this.sel];
    if (this.pendingStart !== null && cell >= this.pendingStart) {
      s.anims[this.sel] = { start: this.pendingStart, count: cell - this.pendingStart + 1, fps };
      this.pendingStart = null;
    } else {
      s.anims[this.sel] = { start: cell, count: 1, fps };
      this.pendingStart = cell;
    }
    this.setSheet({ ...s, anims: { ...s.anims } });
    this.refresh();
  }

  async save(): Promise<boolean> {
    try {
      this.setStatus('Saving…');
      this.refresh();
      await Builds.saveMine({ skins: this.skins, fighters: this.fighters });
      this.dirty = false;
      this.setStatus(
        Builds.backend() === 'shared'
          ? 'Saved to the game link. Skins are only worn in your games; your own fighters wear theirs for everyone.'
          : 'Saved in this browser.',
        UI.good,
      );
      this.refresh();
      return true;
    } catch (e) {
      this.setStatus(`Not saved: ${String((e as { message?: string }).message ?? e)}`, UI.rope);
      this.refresh();
      return false;
    }
  }

  /** Saves, then opens the sandbox with this fighter in it. */
  async tryIt(): Promise<void> {
    if (this.dirty && !(await this.save())) return;
    const tg = this.target;
    const id = tg.kind === 'mine' ? globalId(myOwnerId(), tg.id) : tg.id;
    const hero = Database.data.characters.some((c) => c.id === id);
    SceneLoader.goto(this, 'battle_sandbox', hero ? { hero: id } : { enemy: id });
  }

  private leave(): void {
    SceneLoader.goto(this, 'dev_hub', { cursor: 8 });
  }

  // ── Input ───────────────────────────────────────────────────────────

  private topButtons(): { label: string; x: number; act: () => void }[] {
    const defs: [string, () => void][] = [
      ['UPLOAD', () => void this.upload()],
      ['SAVE', () => void this.save()],
      ['TRY', () => void this.tryIt()],
      ['BACK', () => this.leave()],
    ];
    let x = W - 8;
    const out: { label: string; x: number; act: () => void }[] = [];
    for (const [label, act] of defs.reverse()) {
      x -= label.length * 8 + 22;
      out.unshift({ label, x, act });
    }
    return out;
  }

  private listEntries(): { label: string; target?: Target; head?: boolean }[] {
    const out: { label: string; target?: Target; head?: boolean }[] = [];
    const mark = (has: boolean) => (has ? '* ' : '  ');
    out.push({ label: 'BUILT-IN (skins)', head: true });
    for (const c of Database.data.characters.filter((c) => !c.id.startsWith('c.')))
      out.push({ label: `${mark(!!this.skins[c.id])}${t(c.name)}`, target: { kind: 'skin', id: c.id } });
    for (const e of Database.data.enemies.filter((e) => !e.id.startsWith('c.')))
      out.push({ label: `${mark(!!this.skins[e.id])}${t(e.name)}`, target: { kind: 'skin', id: e.id } });
    out.push({ label: 'YOUR FIGHTERS', head: true });
    for (const f of this.fighters)
      out.push({ label: `${mark(f.look.base === 'sheet')}${f.name}`, target: { kind: 'mine', id: f.id } });
    if (!this.fighters.length) out.push({ label: '  (make some first)' });
    return out;
  }

  private visibleRows(): number {
    return Math.floor((LIST.h - 8) / ROW);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (textFieldOpen) return;
    if (p.y < TOP) {
      for (const b of this.topButtons())
        if (p.x >= b.x && p.x < b.x + b.label.length * 8 + 16) return b.act();
      return;
    }
    if (p.x < LIST.x + LIST.w) {
      const i = Math.floor((p.y - LIST.y - 1) / ROW) + this.listScroll;
      const e = this.listEntries()[i];
      if (e?.target) this.pick(e.target);
      return;
    }
    if (p.x < SHEET.x + SHEET.w) {
      if (p.y < SHEET.y + SHEET.h) {
        const s = this.sheet();
        if (!s) return void this.upload();
        const { x, y, scale } = this.sheetBox;
        const cx = Math.floor((p.x - x) / (s.frameW * scale));
        const cy = Math.floor((p.y - y) / (s.frameH * scale));
        const cols = Math.floor(s.w / s.frameW);
        const rows = Math.floor(s.h / s.frameH);
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) this.clickCell(cy * cols + cx);
      }
      return;
    }
    const i = Math.floor((p.y - PROPS.y - 1) / ROW) + this.propScroll;
    const row = this.rows[i];
    if (!row || row.head) return;
    const vx = PROPS.x + 104;
    if (row.step && p.x < vx + 14) row.step(-1);
    else if (row.step && p.x > PROPS.x + PROPS.w - 22) row.step(1);
    else if (row.edit) row.edit();
    else row.step?.(1);
    this.refresh();
  }

  pick(target: Target): void {
    this.target = target;
    this.sel = 'idle';
    this.pendingStart = null;
    this.propScroll = 0;
    this.refresh();
  }

  private onWheel(p: Phaser.Input.Pointer, dy: number): void {
    const d = dy > 0 ? 3 : -3;
    if (p.x < LIST.x + LIST.w)
      this.listScroll = Phaser.Math.Clamp(
        this.listScroll + d,
        0,
        Math.max(0, this.listEntries().length - this.visibleRows()),
      );
    else if (p.x >= PROPS.x)
      this.propScroll = Phaser.Math.Clamp(
        this.propScroll + d,
        0,
        Math.max(0, this.rows.length - this.visibleRows()),
      );
    this.refresh();
  }

  // ── Property rows ───────────────────────────────────────────────────

  private buildRows(): Row[] {
    const rows: Row[] = [];
    const s = this.sheet();
    const changed = () => {
      if (s) this.setSheet({ ...s, anims: { ...s.anims } });
    };
    rows.push({ label: 'SHEET', value: () => '', head: true });
    rows.push({
      label: 'Sheet',
      value: () => (s ? `${s.w}×${s.h} (click: replace)` : 'click to upload…'),
      edit: () => void this.upload(),
    });
    rows.push({
      label: 'Clear bg',
      value: () => (this.clearBackground ? 'if it has none' : 'never'),
      step: () => (this.clearBackground = !this.clearBackground),
    });
    if (s) {
      const sizes = (side: number) => frameSizes(side);
      const stepSize = (side: 'w' | 'h', dir: number) => {
        const list = sizes(side === 'w' ? s.w : s.h);
        const cur = side === 'w' ? s.frameW : s.frameH;
        const i = Phaser.Math.Clamp(list.indexOf(cur) + dir, 0, list.length - 1);
        if (side === 'w') this.reframe(list[i], s.frameH);
        else this.reframe(s.frameW, list[i]);
      };
      rows.push({ label: 'Frame W', value: () => `${s.frameW} px`, step: (d) => stepSize('w', d) });
      rows.push({ label: 'Frame H', value: () => `${s.frameH} px`, step: (d) => stepSize('h', d) });
      rows.push({ label: 'Cut', value: () => 'find frames again', edit: () => this.autoFrame() });
      rows.push({
        label: 'Faces',
        value: () => (s.flip ? 'left (turned)' : 'right'),
        step: () => {
          s.flip = !s.flip;
          changed();
        },
      });
      rows.push({ label: 'ANIMATIONS', value: () => '', head: true });
      for (const a of SHEET_ANIMS)
        rows.push({
          label: SHEET_ANIM_LABEL[a],
          value: () => {
            const r = s.anims[a];
            if (!r) return a === 'ko' || a === 'win' ? '— (none)' : '— (paper)';
            return r.count === 1 ? `cell ${r.start + 1}` : `cells ${r.start + 1}–${r.start + r.count}`;
          },
          hot: () => this.sel === a,
          edit: () => {
            this.sel = a;
            this.pendingStart = null;
          },
          step: (d) => {
            this.sel = a;
            const r = s.anims[a];
            const cells = Math.floor(s.w / s.frameW) * Math.floor(s.h / s.frameH);
            if (r) r.start = Phaser.Math.Clamp(r.start + d, 0, cells - r.count);
            else s.anims[a] = { start: 0, count: 1, fps: SHEET_FPS[a] };
            changed();
          },
        });
      const r = s.anims[this.sel];
      rows.push({ label: `${SHEET_ANIM_LABEL[this.sel].toUpperCase()}`, value: () => '', head: true });
      if (r) {
        rows.push({
          label: 'Frames',
          value: () => String(r.count),
          step: (d) => {
            const cells = Math.floor(s.w / s.frameW) * Math.floor(s.h / s.frameH);
            r.count = Phaser.Math.Clamp(r.count + d, 1, cells - r.start);
            changed();
          },
        });
        rows.push({
          label: 'Speed',
          value: () => `${r.fps} fps`,
          step: (d) => {
            r.fps = Phaser.Math.Clamp(r.fps + d, 1, 30);
            changed();
          },
        });
        if (this.sel !== 'idle')
          rows.push({
            label: 'Remove',
            value: () => (this.sel === 'ko' || this.sel === 'win' ? 'no animation' : 'use paper motion'),
            edit: () => {
              delete s.anims[this.sel];
              changed();
            },
          });
      } else
        rows.push({
          label: 'Not set',
          value: () => 'click its cells',
          edit: () => (this.pendingStart = null),
        });
    }
    rows.push({ label: 'PREVIEW', value: () => '', head: true });
    rows.push({
      label: 'Zoom',
      value: () => `${this.zoom}× (game size: 1×)`,
      step: () => (this.zoom = this.zoom === 1 ? 2 : 1),
    });
    rows.push({
      label: 'Next to',
      value: () => (this.compare ? 'Kid Chispa' : 'nobody'),
      step: () => (this.compare = !this.compare),
    });
    if (s)
      rows.push({
        label: 'Original',
        value: () => (this.target.kind === 'skin' ? 'take the skin off' : 'back to the wrestler'),
        edit: () => {
          this.setSheet(undefined);
          this.setStatus('Sheet removed. SAVE to make it final.');
        },
      });
    return rows;
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  refresh(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.dyn.push(o);
      return o;
    };
    const txt = (x: number, y: number, s: string, color: number = UI.ink, size: 8 | 16 = 8) =>
      add(pixelText(this, x, y, s, size, css(color)).setOrigin(0, 0));
    const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

    // top bar
    const bar = add(this.add.graphics());
    bar.fillStyle(UI.panel).fillRect(0, 0, W, TOP);
    bar.fillStyle(UI.rope).fillRect(0, TOP - 2, W, 2);
    txt(12, 12, 'SPRITE STUDIO', UI.spark, 16);
    txt(250, 16, fit(this.targetName().toUpperCase(), 26), UI.ink);
    for (const b of this.topButtons()) {
      const hot = b.label === 'SAVE' && this.dirty;
      bar.fillStyle(hot ? 0x5a3a10 : UI.panelHi).fillRect(b.x, 8, b.label.length * 8 + 16, 24);
      txt(b.x + 8, 16, b.label, hot ? UI.spark : UI.ink);
    }

    // list
    this.listEntries()
      .slice(this.listScroll, this.listScroll + this.visibleRows())
      .forEach((e, k) => {
        const y = LIST.y + 6 + k * ROW;
        const sel = e.target && JSON.stringify(e.target) === JSON.stringify(this.target);
        if (sel) add(this.add.rectangle(LIST.x, y - 5, LIST.w, ROW, UI.panelHi).setOrigin(0));
        txt(LIST.x + 4, y, fit(e.label, 21), e.head || sel ? UI.spark : UI.ink);
      });

    this.drawSheet(add, txt);
    this.drawPreview(txt);

    // rows
    this.rows = this.buildRows();
    this.rows.slice(this.propScroll, this.propScroll + this.visibleRows()).forEach((r, k) => {
      const y = PROPS.y + 6 + k * ROW;
      if (r.head) return void txt(PROPS.x + 8, y, r.label, UI.spark);
      const hot = r.hot?.();
      if (hot) add(this.add.rectangle(PROPS.x, y - 5, PROPS.w, ROW, UI.panelHi).setOrigin(0));
      txt(PROPS.x + 8, y, fit(r.label, 12), hot ? UI.spark : UI.inkDim);
      if (r.step) {
        txt(PROPS.x + 104, y, '<', UI.spark);
        txt(PROPS.x + PROPS.w - 16, y, '>', UI.spark);
      }
      txt(PROPS.x + 118, y, fit(r.value(), 19), r.edit && !r.step ? 0x9fd8ff : UI.ink);
    });

    // status
    add(
      pixelText(this, 10, H - 30, this.status, 8, css(this.statusColor))
        .setOrigin(0, 0)
        .setWordWrapWidth(W - 150)
        .setLineSpacing(3),
    );
    add(
      tinyText(
        this,
        W - 8,
        H - 8,
        `SAVES: ${Builds.backend() === 'shared' ? 'LINK' : 'BROWSER'}${this.dirty ? ' · UNSAVED' : ''}`,
        css(this.dirty ? UI.spark : UI.border),
      ).setOrigin(1, 1),
    );
  }

  /** The sheet, with its frame grid, each animation's cells marked and the selected one lit. */
  private drawSheet(
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    txt: (x: number, y: number, s: string, color?: number, size?: 8 | 16) => Phaser.GameObjects.Text,
  ): void {
    const s = this.sheet();
    if (!s) {
      this.sheetView.setVisible(false);
      const want = SHEET_FRAME[this.targetSize()];
      const lines = [
        'No sprite sheet yet.',
        '',
        'Click here (or UPLOAD, or drop / paste a PNG).',
        '',
        `${this.targetSize().toUpperCase()} fighter: draw ${want}×${want} frames,`,
        'facing right, feet on the bottom guide line,',
        'one row per animation:',
        'idle · walk · attack · hurt · knocked out · victory',
        '',
        'Missing walk, attack or hurt rows are made',
        'from the first idle frame, paper-cutout style.',
      ];
      lines.forEach((l, i) => txt(SHEET.x + 16, SHEET.y + 16 + i * 18, l, i === 0 ? UI.spark : UI.inkDim));
      return;
    }
    const img = decodedPicture(s.url);
    if (!img) {
      txt(SHEET.x + 16, SHEET.y + 16, 'Loading the sheet…', UI.inkDim);
      void decodePicture(s.url).then(() => this.refresh());
      return;
    }
    if (this.shownSheet !== s.url) {
      if (this.textures.exists(SHEET_TEX)) {
        this.sheetView.setTexture('__WHITE');
        this.textures.remove(SHEET_TEX);
      }
      this.textures.addImage(SHEET_TEX, img);
      this.shownSheet = s.url;
    }
    // fit the sheet: whole-number zoom when it fits, else shrink
    const room = { w: SHEET.w - 12, h: SHEET.h - 26 };
    const fitScale = Math.min(room.w / s.w, room.h / s.h);
    const scale = fitScale >= 1 ? Math.min(4, Math.floor(fitScale)) : fitScale;
    const x = SHEET.x + 6;
    const y = SHEET.y + 20;
    this.sheetBox = { x, y, scale };
    // checkerboard behind it, so see-through parts show
    const g = add(this.add.graphics());
    const sw = s.w * scale;
    const sh = s.h * scale;
    for (let cy = 0; cy < sh; cy += 8)
      for (let cx = 0; cx < sw; cx += 8)
        g.fillStyle(((cx + cy) / 8) % 2 ? 0x2a2436 : 0x221d2c).fillRect(
          x + cx,
          y + cy,
          Math.min(8, sw - cx),
          Math.min(8, sh - cy),
        );
    this.sheetView.setTexture(SHEET_TEX).setPosition(x, y).setScale(scale).setVisible(true);
    this.children.bringToTop(this.sheetView);
    const over = add(this.add.graphics());
    const cols = Math.floor(s.w / s.frameW);
    const rows = Math.floor(s.h / s.frameH);
    const cw = s.frameW * scale;
    const ch = s.frameH * scale;
    // each animation's cells, the selected one brightest
    SHEET_ANIMS.forEach((a, k) => {
      const r = s.anims[a];
      if (!r) return;
      const color = [0x5fd068, 0x3fa7f0, 0xd8314b, 0xf2c14e, 0x9f6fd8, 0xff70a0][k];
      for (let i = 0; i < r.count; i++) {
        const cell = r.start + i;
        const cx = x + (cell % cols) * cw;
        const cy = y + Math.floor(cell / cols) * ch;
        over.fillStyle(color, a === this.sel ? 0.28 : 0.1).fillRect(cx, cy, cw, ch);
        if (a === this.sel) over.lineStyle(2, color, 1).strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);
      }
    });
    over.lineStyle(1, 0x8a7f99, 0.6);
    for (let c = 0; c <= cols; c++) over.lineBetween(x + c * cw, y, x + c * cw, y + rows * ch);
    for (let r = 0; r <= rows; r++) over.lineBetween(x, y + r * ch, x + cols * cw, y + r * ch);
    this.children.bringToTop(over);
    const hint =
      this.pendingStart !== null
        ? `click the last ${SHEET_ANIM_LABEL[this.sel]} frame`
        : `click cells: ${SHEET_ANIM_LABEL[this.sel]}`;
    txt(SHEET.x + 6, SHEET.y + 4, `${s.frameW}×${s.frameH} · ${cols}×${rows} · ${hint}`, UI.inkDim);
  }

  /** The fighter on a strip of ring next to Kid Chispa, playing the selected animation. */
  private drawPreview(
    txt: (x: number, y: number, s: string, color?: number) => Phaser.GameObjects.Text,
  ): void {
    const s = this.sheet();
    // both drawn at one scale, so sizes compare true; shrunk when the tallest doesn't fit
    const fitZoom = Math.min(this.zoom, (STAGE.h - 30) / Math.max(96, s?.frameH ?? 96));
    this.reference.setVisible(this.compare).setScale(fitZoom);
    this.preview.stop().setTexture('spr_test_dummy', 'idle_00');
    if (!s || !drawSheetLook(this, PREVIEW_TEX, s)) {
      this.preview.setVisible(false);
      if (s) void decodePicture(s.url).then(() => this.refresh());
      return;
    }
    this.preview.setVisible(true).setTexture(PREVIEW_TEX, 'idle_00').setScale(fitZoom);
    this.preview.x = this.compare ? STAGE.x + STAGE.w / 2 + 60 : STAGE.x + STAGE.w / 2;
    const anim = this.anims.exists(animKey(PREVIEW_TEX, this.sel)) ? this.sel : 'idle';
    const once = anim !== 'idle' && anim !== 'walk';
    this.preview.play({ key: animKey(PREVIEW_TEX, anim), repeat: -1, repeatDelay: once ? 600 : 0 });
    txt(
      STAGE.x + 6,
      STAGE.y + 4,
      `${SHEET_ANIM_LABEL[anim]}${s.anims[anim] ? '' : ' (paper motion)'} · shown ${Math.round(fitZoom * 100) / 100}× (true size compared)`,
      UI.inkDim,
    );
  }
}
