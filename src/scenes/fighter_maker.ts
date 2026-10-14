// Fighter maker (step 1 of the battle builder): make heroes and enemies with
// their own name, look, stats and moves; enemies also get traits, rewards and
// how often they use each move. SAVE stores your set (in the game link, where
// everyone can see and copy it); TRY opens the battle sandbox with the fighter
// in place. Anyone else's fighter, or a built-in one, can be copied and changed.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { editText, textFieldOpen } from '../ui/text_field';
import { pickFile } from '../ui/pick_file';
import { SceneLoader } from '../managers/scene_loader';
import { Database, validateGameData } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { allSpriteKeys } from '../managers/asset_packs';
import { englishKeys } from '../managers/strings';
import { animKey } from '../systems/anim_builder';
import {
  Builds,
  COLOR_SLOTS,
  DEFAULT_PICTURE,
  PALETTE,
  globalId,
  myOwnerId,
  newFighter,
  ruleText,
  toDefs,
  type CustomAiRule,
  type CustomFighter,
  type Pose,
} from '../managers/builds';
import type { EnemyProp } from '../types/data';
import { paintWrestler } from '../systems/custom_looks';
import { drawSheetLook } from '../systems/sheets';
import { cleanPicture, decodePicture, drawPictureLook, maxHeightFor, maxWidthFor } from '../systems/pictures';

const TOP = 40;
const LIST = { x: 6, y: TOP + 6, w: 220, h: H - TOP - 40 };
const PREVIEW = { x: LIST.x + LIST.w + 8, y: TOP + 6, w: 250, h: H - TOP - 40 };
const PROPS = {
  x: PREVIEW.x + PREVIEW.w + 8,
  y: TOP + 6,
  w: W - (PREVIEW.x + PREVIEW.w + 8) - 6,
  h: H - TOP - 40,
};
const ROW = 18;
const PREVIEW_KEY = 'spr_maker_preview';
const PREVIEW_PIC = 'spr_maker_picture';
const POSE_LABEL: Record<Pose, string> = { idle: 'Standing', attack: 'Attacking', hurt: 'Getting hit' };
type PreviewAnim = 'idle' | 'walk' | 'chop' | 'hurt';
const PREVIEW_ANIMS: PreviewAnim[] = ['idle', 'walk', 'chop', 'hurt'];
const ANIM_LABEL: Record<PreviewAnim, string> = {
  idle: 'standing',
  walk: 'walking',
  chop: 'attacking',
  hurt: 'getting hit',
};
const MOTION_LABEL = ['still', 'calm', 'normal', 'lively'];
const SIZES = ['normal', 'big', 'huge'] as const;
const ENTRANCES = ['auto', 'walk', 'drop', 'none'] as const;
const ENTRANCE_LABEL = {
  auto: 'auto (huge ones walk in)',
  walk: 'walks in, crowd roars',
  drop: 'drops from the rafters',
  none: 'already in the ring',
};
/** Phase 2 start points (0 = off). */
const PHASE_AT = [0, 0.75, 0.5, 0.25];
const SIZE_LABEL = {
  normal: 'normal',
  big: 'big (takes more room)',
  huge: 'huge boss (half the ring)',
};
const RULE_WHEN: CustomAiRule['when'][] = ['opener', 'hp_below', 'ally_hurt', 'every'];

/** What's selected in the list. */
type Pick =
  | { src: 'mine'; i: number }
  | { src: 'other'; owner: string; f: CustomFighter }
  | { src: 'builtin'; kind: 'hero' | 'enemy'; id: string };

interface Row {
  label: string;
  value: () => string;
  step?: (dir: -1 | 1, big: boolean) => void;
  edit?: () => void;
  head?: boolean;
  swatch?: () => number | undefined;
}

/** A built-in character or enemy as an editable fighter (for copying). */
function fromBuiltin(kind: 'hero' | 'enemy', id: string, newId: string): CustomFighter {
  if (kind === 'hero') {
    const c = Database.character(id);
    return {
      id: newId,
      kind,
      name: `${t(c.name)} copy`,
      look: id === 'chispa' ? { base: 'wrestler', colors: {} } : { base: c.sprite },
      hp: c.hp,
      grit: c.grit,
      attack: c.attack,
      defence: c.defence,
      moves: [...c.moves],
    };
  }
  const e = Database.enemy(id);
  const weights: Record<string, number> = {};
  for (const r of e.ai) if (!r.whenHpBelow) weights[r.move] = Math.min(5, (weights[r.move] ?? 0) + r.weight);
  return {
    id: newId,
    kind,
    name: `${t(e.name)} copy`,
    look: { base: e.sprite },
    hp: e.hp,
    attack: e.attack,
    defence: e.defence,
    moves: [...e.moves],
    props: [...e.props],
    ...(e.size && e.size !== 'normal' ? { size: e.size } : {}),
    xp: e.xp,
    coins: e.coins,
    weights,
    lowHpMove: e.ai.find((r) => r.whenHpBelow)?.move,
    scout: t(e.scout),
    ...(e.entrance ? { entrance: e.entrance } : {}),
    ...(e.phase2
      ? {
          phase2: {
            atHp: e.phase2.atHp,
            attack: e.phase2.attack ?? 0,
            defence: e.phase2.defence ?? 0,
            heal: e.phase2.heal ?? 0,
            moves: e.phase2.moves.slice(0, 3),
            ...(e.phase2.line ? { line: t(e.phase2.line) } : {}),
          },
        }
      : {}),
  };
}

export class FighterMakerScene extends Phaser.Scene {
  mine: CustomFighter[] = [];
  pick: Pick | null = null;
  dirty = false;
  private listScroll = 0;
  private propScroll = 0;
  private rows: Row[] = [];
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private status = '';
  private statusColor: number = UI.inkDim;
  problems: string[] = [];
  private preview!: Phaser.GameObjects.Sprite;
  /** Clear a flat background from uploads (a maker setting, not saved with the fighter). */
  clearBackground = true;
  /** Which animation the preview plays. */
  previewAnim: PreviewAnim = 'idle';

  constructor() {
    super('fighter_maker');
  }

  create(data?: { select?: string }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.mine = Builds.mine();
    this.dirty = false;
    this.listScroll = 0;
    this.propScroll = 0;
    this.pick = this.mine.length ? { src: 'mine', i: 0 } : { src: 'builtin', kind: 'hero', id: 'chispa' };
    if (data?.select) {
      const i = this.mine.findIndex((f) => globalId(myOwnerId(), f.id) === data.select);
      if (i >= 0) this.pick = { src: 'mine', i };
    }
    this.cameras.main.setBackgroundColor(UI.void);
    const frame = this.add.graphics();
    for (const r of [LIST, PREVIEW, PROPS])
      drawPanel(frame, r.x - 2, r.y - 2, r.w + 4, r.h + 4, { alpha: 1 });
    // the preview ring
    frame.fillStyle(0xc9b994).fillEllipse(PREVIEW.x + PREVIEW.w / 2, PREVIEW.y + 248, 200, 36);
    frame.fillStyle(0xd9c9a8).fillEllipse(PREVIEW.x + PREVIEW.w / 2, PREVIEW.y + 248, 156, 26);
    this.preview = this.add
      .sprite(PREVIEW.x + PREVIEW.w / 2, PREVIEW.y + 252, 'spr_test_dummy', 'idle_00')
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
    window.addEventListener('keydown', onKey);
    // a picture dropped on the page, or pasted, becomes the standing picture
    const onDrag = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file && this.scene.isActive()) void this.usePicture('idle', file);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (textFieldOpen || !this.scene.isActive()) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) void this.usePicture('idle', file);
    };
    window.addEventListener('dragover', onDrag);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', onDrag);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    });
    this.setStatus(
      Builds.backend() === 'shared'
        ? 'Your fighters save to the game link, where everyone can see and copy them.'
        : 'Your fighters save in this browser (not the shared game link).',
    );
    this.refresh();
  }

  // ── The fighter being looked at ─────────────────────────────────────

  /** The selected fighter as maker data (built-ins converted for display). */
  private current(): CustomFighter | null {
    const p = this.pick;
    if (!p) return null;
    if (p.src === 'mine') return this.mine[p.i] ?? null;
    if (p.src === 'other') return p.f;
    return fromBuiltin(p.kind, p.id, 'view');
  }

  private editable(): boolean {
    return this.pick?.src === 'mine';
  }

  private nextId(): string {
    const used = new Set(this.mine.map((f) => f.id));
    for (let n = 1; ; n++) if (!used.has(`f${n}`)) return `f${n}`;
  }

  private changed(): void {
    this.dirty = true;
    this.refresh();
  }

  private setStatus(text: string, color: number = UI.inkDim): void {
    this.status = text;
    this.statusColor = color;
  }

  // ── Actions ─────────────────────────────────────────────────────────

  private addFighter(kind: 'hero' | 'enemy'): void {
    this.mine.push(newFighter(kind, this.nextId()));
    this.pick = { src: 'mine', i: this.mine.length - 1 };
    this.propScroll = 0;
    this.changed();
  }

  private copy(): void {
    const p = this.pick;
    if (!p || p.src === 'mine') {
      if (p?.src === 'mine') {
        const c = structuredClone(this.mine[p.i]);
        c.id = this.nextId();
        c.name = `${c.name} 2`;
        this.mine.push(c);
        this.pick = { src: 'mine', i: this.mine.length - 1 };
        this.changed();
      }
      return;
    }
    const c =
      p.src === 'other'
        ? { ...structuredClone(p.f), id: this.nextId() }
        : fromBuiltin(p.kind, p.id, this.nextId());
    this.mine.push(c);
    this.pick = { src: 'mine', i: this.mine.length - 1 };
    this.setStatus('Copied into your fighters. Change anything, then SAVE.');
    this.changed();
  }

  private remove(): void {
    if (this.pick?.src !== 'mine') return;
    this.mine.splice(this.pick.i, 1);
    this.pick = this.mine.length ? { src: 'mine', i: Math.max(0, this.pick.i - 1) } : null;
    this.setStatus('Removed. SAVE to make it final.');
    this.changed();
  }

  async save(): Promise<void> {
    if (this.problems.length) {
      this.setStatus(`Fix first: ${this.problems[0]}`, UI.rope);
      return this.refresh();
    }
    this.setStatus('Saving…');
    this.refresh();
    try {
      await Builds.saveMine({ fighters: this.mine });
      this.dirty = false;
      this.setStatus(
        Builds.backend() === 'shared' ? 'Saved to the game link.' : 'Saved in this browser.',
        UI.good,
      );
    } catch (e) {
      this.setStatus(`Couldn't save: ${(e as { message?: string }).message ?? e}`, UI.rope);
    }
    this.refresh();
  }

  /** Opens the sandbox with this fighter as the hero or the first opponent (saving first). */
  async tryIt(): Promise<void> {
    const f = this.current();
    if (!f) return;
    let id: string;
    if (this.pick?.src === 'mine') {
      if (this.dirty) await this.save();
      if (this.dirty) return; // save failed or has problems
      id = globalId(myOwnerId(), f.id);
    } else if (this.pick?.src === 'other') id = globalId(this.pick.owner, f.id);
    else id = this.pick!.id;
    SceneLoader.goto(this, 'battle_sandbox', f.kind === 'hero' ? { hero: id } : { enemy: id });
  }

  private leave(): void {
    SceneLoader.goto(this, 'dev_hub', { cursor: 3 });
  }

  /** Opens the file picker for one of the fighter's pictures. */
  private async uploadPicture(pose: Pose): Promise<void> {
    const file = await pickFile();
    if (file) await this.usePicture(pose, file);
  }

  /**
   * Cleans a picture and gives it to the selected fighter (yours only); its
   * look becomes "picture". Also used by the browser test with a data URL.
   */
  async usePicture(pose: Pose, file: Blob | string): Promise<void> {
    const f = this.pick?.src === 'mine' ? this.mine[this.pick.i] : null;
    if (!f) {
      this.setStatus('Pick (or COPY) one of your fighters first, then add a picture.', UI.rope);
      return this.refresh();
    }
    this.setStatus('Reading the picture…');
    this.refresh();
    try {
      const url = await cleanPicture(file, this.clearBackground);
      await decodePicture(url);
      f.look = {
        ...f.look,
        base: 'picture',
        pictures: { ...(f.look.pictures ?? {}), [pose]: url },
        picture: f.look.picture ?? { ...DEFAULT_PICTURE },
      };
      this.previewAnim = pose === 'attack' ? 'chop' : pose === 'hurt' ? 'hurt' : 'idle';
      const kb = Math.round((url.length * 0.75) / 1024);
      this.setStatus(`${POSE_LABEL[pose]} picture added (${kb} KB). SAVE to keep it.`, UI.good);
      this.changed();
    } catch (e) {
      this.setStatus(String((e as { message?: string }).message ?? e), UI.rope);
      this.refresh();
    }
  }

  /** Saves, then opens the Sprite studio on this fighter (it edits saved fighters). */
  private async openStudio(f: CustomFighter): Promise<void> {
    if (this.dirty) {
      await this.save();
      if (this.dirty) return;
    }
    SceneLoader.goto(this, 'sprite_studio', { target: { kind: 'mine', id: f.id } });
  }

  // ── Input ───────────────────────────────────────────────────────────

  private topButtons(): { label: string; x: number; act: () => void }[] {
    const defs: [string, () => void][] = [
      ['+HERO', () => this.addFighter('hero')],
      ['+ENEMY', () => this.addFighter('enemy')],
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

  /** Every entry in the left list, in order. */
  private listEntries(): { label: string; pick?: Pick; head?: boolean; mine?: boolean }[] {
    const out: { label: string; pick?: Pick; head?: boolean; mine?: boolean }[] = [];
    out.push({ label: 'YOURS', head: true });
    this.mine.forEach((f, i) =>
      out.push({ label: `${f.kind === 'hero' ? 'H' : 'E'} ${f.name}`, pick: { src: 'mine', i }, mine: true }),
    );
    if (!this.mine.length) out.push({ label: '(none yet)' });
    const others = Builds.others();
    if (others.length) {
      out.push({ label: 'COMMUNITY', head: true });
      for (const o of others)
        out.push({
          label: `${o.fighter.kind === 'hero' ? 'H' : 'E'} ${o.fighter.name}`,
          pick: { src: 'other', owner: o.owner, f: o.fighter },
        });
    }
    out.push({ label: 'BUILT-IN', head: true });
    for (const c of Database.data.characters.filter((c) => !c.id.startsWith('c.')))
      out.push({ label: `H ${t(c.name)}`, pick: { src: 'builtin', kind: 'hero', id: c.id } });
    for (const e of Database.data.enemies.filter((e) => !e.id.startsWith('c.')))
      out.push({ label: `E ${t(e.name)}`, pick: { src: 'builtin', kind: 'enemy', id: e.id } });
    return out;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (textFieldOpen) return;
    const big = (p.event as MouseEvent).shiftKey;
    if (p.y < TOP) {
      for (const b of this.topButtons())
        if (p.x >= b.x && p.x < b.x + b.label.length * 8 + 16) return b.act();
      return;
    }
    if (p.x < LIST.x + LIST.w) {
      const i = Math.floor((p.y - LIST.y - 1) / ROW) + this.listScroll;
      const e = this.listEntries()[i];
      if (e?.pick) {
        this.pick = e.pick;
        this.propScroll = 0;
        this.refresh();
      }
      return;
    }
    if (p.x < PREVIEW.x + PREVIEW.w) {
      // COPY / DELETE under the preview
      const by = PREVIEW.y + PREVIEW.h - 30;
      if (p.y >= by && p.y < by + 24) {
        if (p.x < PREVIEW.x + PREVIEW.w / 2) this.copy();
        else this.remove();
      }
      return;
    }
    if (!this.editable()) return;
    const i = Math.floor((p.y - PROPS.y - 1 - (this.editable() ? 0 : 18)) / ROW) + this.propScroll;
    const row = this.rows[i];
    if (!row || row.head) return;
    const vx = PROPS.x + 120;
    if (row.step && p.x < vx + 14) row.step(-1, big);
    else if (row.step && p.x > PROPS.x + PROPS.w - 22) row.step(1, big);
    else if (row.edit) row.edit();
    else row.step?.(1, big);
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

  private visibleRows(): number {
    return Math.floor((LIST.h - 8) / ROW);
  }

  // ── Property rows ───────────────────────────────────────────────────

  private buildRows(f: CustomFighter): Row[] {
    const rows: Row[] = [];
    const num = (
      label: string,
      key: 'hp' | 'attack' | 'defence' | 'grit' | 'xp' | 'coins',
      min: number,
      max: number,
    ): Row => ({
      label,
      value: () => String(f[key] ?? 0),
      step: (dir, big) => {
        f[key] = Phaser.Math.Clamp((f[key] ?? 0) + dir * (big ? 5 : 1), min, max);
        this.changed();
      },
    });
    const toggleProp = (label: string, prop: EnemyProp): Row => ({
      label,
      value: () => ((f.props ?? []).includes(prop) ? 'yes' : 'no'),
      step: () => {
        const ps = new Set(f.props ?? []);
        if (ps.has(prop)) ps.delete(prop);
        else ps.add(prop);
        f.props = [...ps];
        this.changed();
      },
    });
    const rowY = () => PROPS.y + (rows.length - this.propScroll) * ROW;

    const text = (
      label: string,
      key: 'name' | 'title' | 'line' | 'bio' | 'scout',
      max: number,
      placeholder: string,
    ): Row => ({
      label,
      value: () => f[key] || '—',
      edit: async () => {
        const v = await editText(this, {
          x: PROPS.x,
          y: rowY(),
          w: PROPS.w,
          value: f[key] ?? '',
          placeholder,
        });
        if (v === null) return;
        if (key === 'name') {
          if (v.trim()) f.name = v.trim().slice(0, max);
        } else f[key] = v.trim().slice(0, max) || undefined;
        this.changed();
      },
    });
    rows.push(text('Name', 'name', 24, 'Name'));
    rows.push(text('Title', 'title', 28, 'A nickname, e.g. The Harbor Hammer'));
    rows.push(
      text(
        'Line',
        'line',
        90,
        f.kind === 'hero' ? 'What they shout to the crowd' : 'What they say before the bell',
      ),
    );
    if (f.kind === 'hero') rows.push(text('Story', 'bio', 160, 'A short story'));
    else rows.push(text('Scout', 'scout', 140, "What Pip's Scout says about them"));

    rows.push({ label: 'LOOK', value: () => '', head: true });
    const looks = [
      'wrestler',
      'picture',
      'sheet',
      ...[...allSpriteKeys()]
        .filter((k) => k.startsWith('spr_c0_') || k === 'spr_pip' || k === 'spr_sparring_dummy')
        .sort(),
    ];
    rows.push({
      label: 'Look',
      value: () =>
        f.look.base === 'wrestler'
          ? 'wrestler (recolour it)'
          : f.look.base === 'picture'
            ? 'your pictures'
            : f.look.base === 'sheet'
              ? 'sprite sheet'
              : f.look.base.replace(/^spr_(c0_)?/, ''),
      step: (dir) => {
        const i = looks.indexOf(f.look.base);
        f.look = { ...f.look, base: looks[(i + dir + looks.length) % looks.length] };
        this.changed();
      },
    });
    if (f.look.base === 'wrestler')
      for (const slot of COLOR_SLOTS)
        rows.push({
          label: `  ${slot}`,
          value: () => (f.look.colors?.[slot] === undefined ? 'default' : ''),
          swatch: () => f.look.colors?.[slot],
          step: (dir) => {
            const cur = f.look.colors?.[slot];
            const i = cur === undefined ? -1 : PALETTE.indexOf(cur);
            const n = i + dir;
            const colors = { ...(f.look.colors ?? {}) };
            if (n < 0 || n >= PALETTE.length) delete colors[slot];
            else colors[slot] = PALETTE[n];
            f.look = { ...f.look, colors };
            this.changed();
          },
        });
    if (f.look.base === 'sheet')
      rows.push({
        label: '  Sheet',
        value: () =>
          f.look.sheet
            ? `${f.look.sheet.frameW}×${f.look.sheet.frameH} frames (click: studio)`
            : 'click: open Sprite studio',
        edit: () => void this.openStudio(f),
      });
    if (f.look.base === 'picture') {
      const pic = () => (f.look.picture ??= { ...DEFAULT_PICTURE });
      for (const pose of ['idle', 'attack', 'hurt'] as Pose[]) {
        const url = () => f.look.pictures?.[pose];
        rows.push({
          label: `  ${POSE_LABEL[pose]}`,
          value: () => {
            const u = url();
            return u
              ? `picture · ${Math.round((u.length * 0.75) / 1024)} KB (click: replace)`
              : 'click to upload…';
          },
          edit: () => void this.uploadPicture(pose),
          step:
            pose === 'idle'
              ? undefined
              : () => {
                  // left/right on attack and hurt: remove that picture
                  if (!url()) return void this.uploadPicture(pose);
                  const pictures = { ...(f.look.pictures ?? {}) };
                  delete pictures[pose];
                  f.look = { ...f.look, pictures };
                  this.changed();
                },
        });
      }
      rows.push({
        label: '  Clear bg',
        value: () => (this.clearBackground ? 'yes, on upload' : 'no, keep it'),
        step: () => {
          this.clearBackground = !this.clearBackground;
          this.refresh();
        },
      });
      const picNum = (label: string, key: 'height' | 'pixel', min: number, max: number, by: number): Row => ({
        label,
        value: () =>
          key === 'height'
            ? `${pic().height} px tall`
            : `${pic().pixel}${pic().pixel === 1 ? ' (smooth)' : ''}`,
        step: (dir) => {
          pic()[key] = Phaser.Math.Clamp(pic()[key] + dir * by, min, max);
          this.changed();
        },
      });
      rows.push(
        picNum('  Height', 'height', 48, maxHeightFor(f.kind === 'enemy' ? f.size : 'normal'), 8),
        picNum('  Pixel size', 'pixel', 1, 4, 1),
      );
      rows.push({
        label: '  Motion',
        value: () => MOTION_LABEL[pic().motion ?? 2],
        step: (dir) => {
          pic().motion = Phaser.Math.Clamp((pic().motion ?? 2) + dir, 0, 3);
          this.changed();
        },
      });
      rows.push({
        label: '  Outline',
        value: () => (pic().outline ? 'yes' : 'no'),
        step: () => {
          pic().outline = !pic().outline;
          this.changed();
        },
      });
      rows.push({
        label: '  Faces',
        value: () => (pic().flip ? 'left (turned)' : 'right'),
        step: () => {
          pic().flip = !pic().flip;
          this.changed();
        },
      });
    }
    if (f.look.base !== 'picture' && !this.anims.exists(animKey(this.previewKey(f), 'walk'))) {
      // nothing to preview: a still sprite
    } else
      rows.push({
        label: '  Preview',
        value: () => ANIM_LABEL[this.previewAnim],
        step: (dir) => {
          this.previewAnim = PREVIEW_ANIMS[(PREVIEW_ANIMS.indexOf(this.previewAnim) + dir + 4) % 4];
          this.refresh();
        },
      });
    if (f.kind === 'enemy')
      rows.push({
        label: '  Size',
        value: () => SIZE_LABEL[f.size ?? 'normal'],
        step: (dir) => {
          const i = SIZES.indexOf(f.size ?? 'normal');
          f.size = SIZES[(i + dir + SIZES.length) % SIZES.length];
          if (f.size === 'normal') delete f.size;
          if (f.look.picture) f.look.picture.height = Math.min(f.look.picture.height, maxHeightFor(f.size));
          this.changed();
        },
      });
    if (f.kind === 'enemy')
      rows.push({
        label: '  Entrance',
        value: () => ENTRANCE_LABEL[f.entrance ?? 'auto'],
        step: (dir) => {
          const i = ENTRANCES.indexOf(f.entrance ?? 'auto');
          f.entrance = ENTRANCES[(i + dir + ENTRANCES.length) % ENTRANCES.length];
          if (f.entrance === 'auto') delete f.entrance;
          this.changed();
        },
      });

    rows.push({ label: 'STATS', value: () => '', head: true });
    rows.push(num('HP', 'hp', 1, 99), num('Attack', 'attack', 0, 20), num('Defence', 'defence', 0, 20));
    if (f.kind === 'hero') rows.push(num('Grit', 'grit', 0, 30));
    else {
      rows.push(num('XP', 'xp', 0, 99), num('Coins', 'coins', 0, 99));
      rows.push(toggleProp('Spiky', 'spiky'), toggleProp('Flying', 'airborne'));
    }

    // moves: heroes switch them on and off; enemies get a weight (how often)
    rows.push({ label: f.kind === 'hero' ? 'MOVES' : 'MOVES (how often)', value: () => '', head: true });
    const pool = Database.data.moves.filter((m) =>
      f.kind === 'hero' ? m.category !== 'enemy' : m.category === 'enemy',
    );
    for (const m of pool) {
      if (f.kind === 'hero')
        rows.push({
          label: `  ${t(m.name)}`,
          value: () => (f.moves.includes(m.id) ? `yes${m.gritCost ? ` (${m.gritCost} grit)` : ''}` : '—'),
          step: () => {
            f.moves = f.moves.includes(m.id) ? f.moves.filter((x) => x !== m.id) : [...f.moves, m.id];
            this.changed();
          },
        });
      else
        rows.push({
          label: `  ${t(m.name)}`,
          value: () => {
            const w = f.moves.includes(m.id) ? (f.weights?.[m.id] ?? 1) : 0;
            return w ? `${'#'.repeat(w)} ${w}${m.heal ? ' heal' : m.charge ? ' charged' : ''}` : '—';
          },
          step: (dir) => {
            const w = Phaser.Math.Clamp((f.moves.includes(m.id) ? (f.weights?.[m.id] ?? 1) : 0) + dir, 0, 5);
            f.weights = { ...(f.weights ?? {}), [m.id]: w };
            f.moves = w > 0 ? [...new Set([...f.moves, m.id])] : f.moves.filter((x) => x !== m.id);
            this.changed();
          },
        });
    }
    if (f.kind === 'enemy') {
      this.ruleRows(f, rows);
      this.phaseRows(f, rows);
    }
    return rows;
  }

  /** An enemy's second phase: when it starts, what it gains, and its new moves. */
  private phaseRows(f: CustomFighter, rows: Row[]): void {
    rows.push({ label: 'PHASE 2 (boss)', value: () => '', head: true });
    rows.push({
      label: '  Starts at',
      value: () => (f.phase2 ? `${Math.round(f.phase2.atHp * 100)}% HP` : 'off'),
      step: (dir) => {
        const k = PHASE_AT.indexOf(f.phase2?.atHp ?? 0) + dir;
        const at = PHASE_AT[(k + PHASE_AT.length) % PHASE_AT.length];
        if (!at) delete f.phase2;
        else f.phase2 = { ...(f.phase2 ?? { attack: 1, defence: 0, heal: 0, moves: [] }), atHp: at };
        this.changed();
      },
    });
    const p = f.phase2;
    if (!p) return;
    const stat = (label: string, key: 'attack' | 'defence' | 'heal', max: number): Row => ({
      label,
      value: () => (p[key] ? `+${p[key]}` : '—'),
      step: (dir) => {
        p[key] = Phaser.Math.Clamp(p[key] + dir, 0, max);
        this.changed();
      },
    });
    rows.push(stat('  Attack', 'attack', 5), stat('  Defence', 'defence', 5), stat('  Heals HP', 'heal', 50));
    const pool = Database.data.moves.filter((m) => m.category === 'enemy');
    const name = (id: string) => (pool.some((m) => m.id === id) ? t(Database.move(id).name) : '(gone)');
    for (let i = 0; i < 3; i++) {
      if (i > p.moves.length) break;
      rows.push({
        label: `  New move ${i + 1}`,
        value: () => (p.moves[i] ? name(p.moves[i]) : i === 0 ? 'keep old moves' : '—'),
        step: (dir) => {
          // cycle through enemy moves; past either end clears the slot
          const k = p.moves[i]
            ? pool.findIndex((m) => m.id === p.moves[i]) + dir
            : dir > 0
              ? 0
              : pool.length - 1;
          if (k < 0 || k >= pool.length) p.moves.splice(i, 1);
          else p.moves[i] = pool[k].id;
          this.changed();
        },
      });
    }
    const at = rows.length;
    rows.push({
      label: '  Phase line',
      value: () => p.line || '—',
      edit: async () => {
        const v = await editText(this, {
          x: PROPS.x,
          y: PROPS.y + (at - this.propScroll) * ROW,
          w: PROPS.w,
          value: p.line ?? '',
          placeholder: 'What they shout when they get serious',
        });
        if (v === null) return;
        p.line = v.trim().slice(0, 90) || undefined;
        this.changed();
      },
    });
  }

  /** An enemy's special rules: up to 4, each a move and when to use it. */
  private ruleRows(f: CustomFighter, rows: Row[]): void {
    // the old single "when hurt" move becomes a rule
    if (f.lowHpMove && this.editable()) {
      f.rules = [...(f.rules ?? []), { move: f.lowHpMove, when: 'hp_below', value: 50 }];
      f.lowHpMove = undefined;
    }
    const rules = f.rules ?? [];
    rows.push({ label: 'PATTERN (special rules)', value: () => '', head: true });
    const name = (id: string) =>
      Database.data.moves.some((m) => m.id === id) ? t(Database.move(id).name) : '(gone)';
    rules.forEach((r, i) => {
      rows.push({
        label: `  Rule ${i + 1}`,
        value: () => ruleText(r, name(r.move)),
        step: (dir) => {
          // cycle the condition; past the last one removes the rule
          const k = RULE_WHEN.indexOf(r.when) + dir;
          if (k < 0 || k >= RULE_WHEN.length) f.rules = rules.filter((x) => x !== r);
          else {
            r.when = RULE_WHEN[k];
            r.value = r.when === 'every' ? 3 : r.when === 'opener' ? undefined : 50;
          }
          this.changed();
        },
      });
      rows.push({
        label: '    move',
        value: () => name(r.move),
        step: (dir) => {
          if (!f.moves.length) return;
          const k = f.moves.indexOf(r.move);
          r.move = f.moves[(k + dir + f.moves.length) % f.moves.length];
          this.changed();
        },
      });
      if (r.when !== 'opener')
        rows.push({
          label: r.when === 'every' ? '    rounds' : '    at HP %',
          value: () => String(r.value ?? (r.when === 'every' ? 3 : 50)),
          step: (dir) => {
            r.value =
              r.when === 'every'
                ? Phaser.Math.Clamp((r.value ?? 3) + dir, 2, 9)
                : Phaser.Math.Clamp((r.value ?? 50) + dir * 10, 10, 90);
            this.changed();
          },
        });
    });
    if (rules.length < 4)
      rows.push({
        label: '  + Add rule',
        value: () => (f.moves.length ? 'click to add' : 'needs a move first'),
        edit: () => {
          if (!f.moves.length) return;
          f.rules = [...rules, { move: f.moves[0], when: 'opener' }];
          this.changed();
        },
      });
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  private validate(f: CustomFighter | null): void {
    this.problems = [];
    if (!f || this.pick?.src !== 'mine') return;
    if (!f.moves.length) this.problems.push('needs at least one move');
    if (f.look.base === 'picture' && !f.look.pictures?.idle)
      this.problems.push('needs a standing picture (click Standing)');
    // check it as real game data
    const d = toDefs(myOwnerId(), f);
    const data = {
      ...Database.data,
      characters: d.char
        ? [...Database.data.characters.filter((c) => c.id !== d.char!.id), d.char]
        : Database.data.characters,
      enemies: d.foe
        ? [...Database.data.enemies.filter((e) => e.id !== d.foe!.id), d.foe]
        : Database.data.enemies,
    };
    const keys = allSpriteKeys();
    keys.add(d.char?.sprite ?? d.foe!.sprite);
    const id = d.char?.id ?? d.foe!.id;
    for (const p of validateGameData(data, { spriteKeys: keys, stringKeys: englishKeys() }))
      if (p.id === id) this.problems.push(p.message);
  }

  refresh(): void {
    const f = this.current();
    this.validate(f);
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
    txt(12, 12, 'FIGHTER MAKER', UI.spark, 16);
    for (const b of this.topButtons()) {
      const hot = b.label === 'SAVE' && this.dirty;
      bar.fillStyle(hot ? 0x5a3a10 : UI.panelHi).fillRect(b.x, 8, b.label.length * 8 + 16, 24);
      txt(b.x + 8, 16, b.label, hot ? UI.spark : UI.ink);
    }

    // list
    const entries = this.listEntries();
    entries.slice(this.listScroll, this.listScroll + this.visibleRows()).forEach((e, k) => {
      const y = LIST.y + 6 + k * ROW;
      const sel = e.pick && JSON.stringify(e.pick) === JSON.stringify(this.pick);
      if (sel) add(this.add.rectangle(LIST.x, y - 5, LIST.w, ROW, UI.panelHi).setOrigin(0));
      txt(LIST.x + 6, y, fit(e.label, 26), e.head ? UI.spark : sel ? UI.spark : e.mine ? UI.ink : UI.inkDim);
    });

    // preview
    const cx = PREVIEW.x + PREVIEW.w / 2;
    if (f) {
      this.showPreview(f);
      txt(PREVIEW.x + 8, PREVIEW.y + 8, fit(f.name.toUpperCase(), 14), UI.spark, 16);
      const owner =
        this.pick?.src === 'mine' ? 'YOURS' : this.pick?.src === 'other' ? 'COMMUNITY' : 'BUILT-IN';
      add(
        tinyText(this, PREVIEW.x + 8, PREVIEW.y + 32, `${f.kind.toUpperCase()} · ${owner}`, css(UI.inkDim))
          .setOrigin(0)
          .setScale(2),
      );
      const lines = [
        ...(f.title ? [`"${f.title}"`] : []),
        `HP ${f.hp}  ATK ${f.attack}  DEF ${f.defence}`,
        f.kind === 'hero' ? `GRIT ${f.grit ?? 5}` : `XP ${f.xp ?? 0}  COINS ${f.coins ?? 0}`,
        ...(f.props?.length ? [f.props.join(', ')] : []),
        ...(f.size && f.size !== 'normal'
          ? [`${f.size.toUpperCase()}${f.size === 'huge' ? ' BOSS' : ''}`]
          : []),
        ...(f.kind === 'enemy' && f.phase2 ? [`PHASE 2 at ${Math.round(f.phase2.atHp * 100)}% HP`] : []),
        ...f.moves.slice(0, 5).map((m) => `· ${t(Database.move(m).name)}`),
      ];
      lines.forEach((l, i) =>
        txt(PREVIEW.x + 8, PREVIEW.y + 276 + i * 16, fit(l, 29), i < (f.title ? 3 : 2) ? UI.ink : UI.inkDim),
      );
      const by = PREVIEW.y + PREVIEW.h - 30;
      bar.fillStyle(UI.panelHi).fillRect(PREVIEW.x + 6, by, PREVIEW.w / 2 - 12, 24);
      txt(PREVIEW.x + 18, by + 8, this.pick?.src === 'mine' ? 'DUPLICATE' : 'COPY', UI.ink);
      if (this.pick?.src === 'mine') {
        bar.fillStyle(0x3a1018).fillRect(cx + 6, by, PREVIEW.w / 2 - 12, 24);
        txt(cx + 20, by + 8, 'DELETE', UI.rope);
      }
    } else this.preview.setVisible(false);

    // properties
    this.rows = f ? this.buildRows(f) : [];
    const ed = this.editable();
    if (f && !ed) txt(PROPS.x + 10, PROPS.y + 6, 'COPY it to change it.', UI.inkDim);
    this.rows.slice(this.propScroll, this.propScroll + this.visibleRows()).forEach((r, k) => {
      const y = PROPS.y + 6 + k * ROW + (ed ? 0 : 18);
      if (r.head) return void txt(PROPS.x + 10, y, r.label, UI.spark);
      txt(PROPS.x + 10, y, fit(r.label, 13), UI.inkDim);
      const sw = r.swatch?.();
      if (r.swatch && sw !== undefined)
        add(
          this.add
            .rectangle(PROPS.x + 136, y - 2, 80, 12, sw)
            .setOrigin(0)
            .setStrokeStyle(1, 0x0b0910),
        );
      if (r.step && ed) {
        txt(PROPS.x + 120, y, '<', UI.spark);
        txt(PROPS.x + PROPS.w - 18, y, '>', UI.spark);
      }
      txt(PROPS.x + 136, y, fit(r.value(), 40), r.edit && ed ? 0x9fd8ff : UI.ink);
    });

    // status
    const line = this.problems.length ? `Problem: ${this.problems[0]}` : this.status;
    txt(10, H - 26, fit(line, 110), this.problems.length ? UI.rope : this.statusColor);
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

  /** Texture the preview uses for a fighter's look. */
  private previewKey(f: CustomFighter): string {
    return f.look.base === 'picture' || f.look.base === 'sheet'
      ? PREVIEW_PIC
      : f.look.base === 'wrestler'
        ? PREVIEW_KEY
        : f.look.base;
  }

  /** Shows the fighter on the little ring, in its own colours, playing the chosen animation. */
  private showPreview(f: CustomFighter): void {
    // park the sprite on another texture while its own is (re)drawn
    this.preview.stop().setTexture('spr_test_dummy', 'idle_00');
    if (f.look.base === 'sheet') {
      if (!f.look.sheet) return void this.preview.setVisible(false);
      if (!drawSheetLook(this, PREVIEW_PIC, f.look.sheet)) {
        void decodePicture(f.look.sheet.url).then(() => this.refresh());
        return void this.preview.setVisible(false);
      }
    } else if (f.look.base === 'picture') {
      if (!f.look.pictures?.idle) return void this.preview.setVisible(false);
      const size = f.kind === 'enemy' ? f.size : 'normal';
      if (!drawPictureLook(this, PREVIEW_PIC, f.look, maxWidthFor(size))) {
        // still decoding: draw again when ready
        void Promise.all(Object.values(f.look.pictures).map((u) => decodePicture(u!))).then(() =>
          this.refresh(),
        );
        return void this.preview.setVisible(false);
      }
    } else if (f.look.base === 'wrestler') paintWrestler(this, PREVIEW_KEY, f.look.colors ?? {});
    const key = this.previewKey(f);
    const animated = this.anims.exists(animKey(key, 'idle'));
    this.preview.setVisible(true).setTexture(key, animated ? 'idle_00' : undefined);
    const h = this.preview.frame.height;
    // small ones twice as big; very tall ones shrunk to fit the panel
    this.preview.setScale(h <= 130 ? 2 : h <= 250 ? 1 : 250 / h);
    if (animated) {
      const anim = this.anims.exists(animKey(key, this.previewAnim)) ? this.previewAnim : 'idle';
      this.preview.play({
        key: animKey(key, anim),
        repeat: -1,
        repeatDelay: anim === 'idle' || anim === 'walk' ? 0 : 500,
      });
    }
    this.preview.setFlipX(f.kind === 'enemy' && animated);
  }
}
