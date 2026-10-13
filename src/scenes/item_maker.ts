// Item maker (step 3 of the battle builder): items with one effect each —
// heal, Grit, damage (one opponent or all), a stat boost for some turns, or a
// revive. Saved with your fighters and encounters; TRY opens the sandbox with
// the item in the bag. Anyone's item, or a built-in one, can be copied.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { editText, textFieldOpen } from '../ui/text_field';
import { SceneLoader } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { Builds, PALETTE, globalId, itemSummary, myOwnerId, type CustomItem } from '../managers/builds';
import type { ItemDef } from '../types/data';

const TOP = 26;
const LIST = { x: 4, y: TOP + 4, w: 170, h: H - TOP - 26 };
const CARD = { x: LIST.x + LIST.w + 6, y: TOP + 4, w: W - (LIST.x + LIST.w + 6) - 4, h: H - TOP - 26 };
const ROW = 13;
const KINDS: CustomItem['kind'][] = ['heal', 'grit', 'damage', 'boost', 'revive'];
const KIND_LABEL: Record<CustomItem['kind'], string> = {
  heal: 'Heal HP',
  grit: 'Restore Grit',
  damage: 'Damage',
  boost: 'Stat boost',
  revive: 'Revive',
};
const KIND_COLOR: Record<CustomItem['kind'], number> = {
  heal: 0x5fd068,
  grit: 0x3fa7f0,
  damage: 0xd8314b,
  boost: 0xffb238,
  revive: 0xff70a0,
};

type Pick =
  | { src: 'mine'; i: number }
  | { src: 'other'; owner: string; it: CustomItem }
  | { src: 'builtin'; id: string };

interface Row {
  label: string;
  value: () => string;
  step?: (dir: -1 | 1, big: boolean) => void;
  edit?: () => void;
}

/** A built-in item as maker data (for showing and copying). */
function fromBuiltin(def: ItemDef, id: string): CustomItem {
  const fx = def.effect;
  const kind: CustomItem['kind'] = fx.revive
    ? 'revive'
    : fx.damage
      ? 'damage'
      : fx.grit
        ? 'grit'
        : fx.attackUp || fx.defenceUp
          ? 'boost'
          : 'heal';
  return {
    id,
    name: t(def.name),
    desc: t(def.desc),
    kind,
    amount: fx.heal ?? fx.grit ?? fx.damage ?? fx.revive ?? 0,
    target:
      def.target === 'all' ? 'all' : def.target === 'ally' ? 'ally' : kind === 'damage' ? 'single' : 'self',
    attackUp: fx.attackUp,
    defenceUp: fx.defenceUp,
    turns: fx.turns,
  };
}

export class ItemMakerScene extends Phaser.Scene {
  mine: CustomItem[] = [];
  pick: Pick | null = null;
  dirty = false;
  private scroll = 0;
  private rows: Row[] = [];
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private status = '';
  private statusColor: number = UI.inkDim;

  constructor() {
    super('item_maker');
  }

  create(): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.mine = Builds.myItems();
    this.dirty = false;
    this.scroll = 0;
    this.pick = this.mine.length ? { src: 'mine', i: 0 } : { src: 'builtin', id: Database.data.items[0].id };
    this.cameras.main.setBackgroundColor(UI.void);
    const frame = this.add.graphics();
    for (const r of [LIST, CARD]) drawPanel(frame, r.x - 2, r.y - 2, r.w + 4, r.h + 4, { alpha: 1 });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.scroll = Phaser.Math.Clamp(
          this.scroll + (dy > 0 ? 3 : -3),
          0,
          Math.max(0, this.listRows().length - 20),
        );
        this.refresh();
      },
    );
    const onKey = (e: KeyboardEvent) => {
      if (textFieldOpen || !this.scene.isActive()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save();
      } else if (e.key === 'Escape') this.leave();
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', onKey));
    this.status =
      Builds.backend() === 'shared'
        ? 'Your items save to the game link, where everyone can see and copy them.'
        : 'Your items save in this browser (not the shared game link).';
    this.refresh();
  }

  private current(): CustomItem | null {
    const p = this.pick;
    if (!p) return null;
    if (p.src === 'mine') return this.mine[p.i] ?? null;
    if (p.src === 'other') return p.it;
    return fromBuiltin(Database.item(p.id), 'view');
  }

  private nextId(): string {
    const used = new Set(this.mine.map((i) => i.id));
    for (let n = 1; ; n++) if (!used.has(`i${n}`)) return `i${n}`;
  }

  private changed(): void {
    this.dirty = true;
    this.refresh();
  }

  addItem(): void {
    this.mine.push({
      id: this.nextId(),
      name: 'New Item',
      desc: '',
      kind: 'heal',
      amount: 5,
      target: 'self',
    });
    this.pick = { src: 'mine', i: this.mine.length - 1 };
    this.changed();
  }

  private copy(): void {
    const c = this.current();
    if (!c) return;
    const item = {
      ...structuredClone(c),
      id: this.nextId(),
      name: this.pick?.src === 'mine' ? `${c.name} 2` : c.name,
    };
    this.mine.push(item);
    this.pick = { src: 'mine', i: this.mine.length - 1 };
    this.status = 'Copied into your items. Change anything, then SAVE.';
    this.changed();
  }

  private remove(): void {
    if (this.pick?.src !== 'mine') return;
    this.mine.splice(this.pick.i, 1);
    this.pick = this.mine.length ? { src: 'mine', i: Math.max(0, this.pick.i - 1) } : null;
    this.status = 'Removed. SAVE to make it final.';
    this.changed();
  }

  async save(): Promise<void> {
    this.status = 'Saving…';
    this.refresh();
    try {
      await Builds.saveMine({ items: this.mine });
      this.dirty = false;
      this.status = Builds.backend() === 'shared' ? 'Saved to the game link.' : 'Saved in this browser.';
      this.statusColor = UI.good;
    } catch (e) {
      this.status = `Couldn't save: ${(e as { message?: string }).message ?? e}`;
      this.statusColor = UI.rope;
    }
    this.refresh();
  }

  /** Opens the sandbox with this item in the bag (saving first). */
  async tryIt(): Promise<void> {
    const c = this.current();
    if (!c || !this.pick) return;
    let id: string;
    if (this.pick.src === 'mine') {
      if (this.dirty) await this.save();
      if (this.dirty) return;
      id = globalId(myOwnerId(), c.id);
    } else if (this.pick.src === 'other') id = globalId(this.pick.owner, c.id);
    else id = this.pick.id;
    SceneLoader.goto(this, 'battle_sandbox', { item: id });
  }

  leave(): void {
    SceneLoader.goto(this, 'dev_hub', { cursor: 4 });
  }

  // ── Input ───────────────────────────────────────────────────────────

  private topButtons(): { label: string; x: number; act: () => void }[] {
    const defs: [string, () => void][] = [
      ['+ITEM', () => this.addItem()],
      ['SAVE', () => void this.save()],
      ['TRY', () => void this.tryIt()],
      ['BACK', () => this.leave()],
    ];
    let x = W - 4;
    const out: { label: string; x: number; act: () => void }[] = [];
    for (const [label, act] of defs.reverse()) {
      x -= label.length * 8 + 14;
      out.unshift({ label, x, act });
    }
    return out;
  }

  private listRows(): { label: string; pick?: Pick; head?: boolean }[] {
    const out: { label: string; pick?: Pick; head?: boolean }[] = [{ label: 'YOURS', head: true }];
    this.mine.forEach((it, i) => out.push({ label: it.name, pick: { src: 'mine', i } }));
    if (!this.mine.length) out.push({ label: '(none yet)' });
    const others = Builds.otherItems();
    if (others.length) {
      out.push({ label: 'COMMUNITY', head: true });
      for (const o of others)
        out.push({ label: o.item.name, pick: { src: 'other', owner: o.owner, it: o.item } });
    }
    out.push({ label: 'BUILT-IN', head: true });
    for (const def of Database.data.items.filter((d) => !d.id.startsWith('c.')))
      out.push({ label: t(def.name), pick: { src: 'builtin', id: def.id } });
    return out;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (textFieldOpen) return;
    const big = (p.event as MouseEvent).shiftKey;
    if (p.y < TOP) {
      for (const b of this.topButtons())
        if (p.x >= b.x && p.x < b.x + b.label.length * 8 + 12) return b.act();
      return;
    }
    if (p.x < LIST.x + LIST.w) {
      const r = this.listRows()[Math.floor((p.y - LIST.y - 2) / ROW) + this.scroll];
      if (r?.pick) {
        this.pick = r.pick;
        this.refresh();
      }
      return;
    }
    // COPY / DELETE
    const by = CARD.y + CARD.h - 22;
    if (p.y >= by && p.y < by + 18) {
      if (p.x < CARD.x + 100) this.copy();
      else if (p.x < CARD.x + 200) this.remove();
      return;
    }
    if (this.pick?.src !== 'mine') return;
    const i = Math.floor((p.y - this.propsTop()) / ROW);
    const row = this.rows[i];
    if (!row) return;
    if (row.step && p.x < CARD.x + 120) row.step(-1, big);
    else if (row.step && p.x > CARD.x + CARD.w - 16) row.step(1, big);
    else if (row.edit) row.edit();
    else row.step?.(1, big);
  }

  private propsTop(): number {
    return CARD.y + 110;
  }

  // ── Properties ──────────────────────────────────────────────────────

  private buildRows(it: CustomItem): Row[] {
    const rows: Row[] = [];
    const y = () => this.propsTop() + rows.length * ROW - 2;
    const num = (
      label: string,
      key: 'amount' | 'attackUp' | 'defenceUp' | 'turns',
      min: number,
      max: number,
    ): Row => ({
      label,
      value: () => String(it[key] ?? 0),
      step: (dir, big) => {
        it[key] = Phaser.Math.Clamp((it[key] ?? 0) + dir * (big ? 5 : 1), min, max);
        this.changed();
      },
    });
    rows.push({
      label: 'Name',
      value: () => it.name,
      edit: async () => {
        const v = await editText(this, { x: CARD.x + 120, y: y(), w: CARD.w - 126, value: it.name });
        if (v?.trim()) {
          it.name = v.trim().slice(0, 20);
          this.changed();
        }
      },
    });
    rows.push({
      label: 'Says',
      value: () => it.desc || '(automatic)',
      edit: async () => {
        const v = await editText(this, {
          x: CARD.x + 120,
          y: y(),
          w: CARD.w - 126,
          value: it.desc,
          placeholder: 'empty = describe it automatically',
        });
        if (v !== null) {
          it.desc = v.trim().slice(0, 90);
          this.changed();
        }
      },
    });
    rows.push({
      label: 'Effect',
      value: () => KIND_LABEL[it.kind],
      step: (dir) => {
        it.kind = KINDS[(KINDS.indexOf(it.kind) + dir + KINDS.length) % KINDS.length];
        // keep the target sensible for the new kind
        if (it.kind === 'damage' && it.target !== 'all') it.target = 'single';
        if (it.kind !== 'damage' && (it.target === 'single' || it.target === 'all')) it.target = 'self';
        if (it.kind === 'boost') Object.assign(it, { attackUp: it.attackUp ?? 1, turns: it.turns ?? 3 });
        this.changed();
      },
    });
    if (it.kind !== 'boost') rows.push(num(it.kind === 'revive' ? 'HP after' : 'Amount', 'amount', 1, 99));
    if (it.kind === 'damage' || it.kind === 'heal' || it.kind === 'boost') {
      const options: CustomItem['target'][] = it.kind === 'damage' ? ['single', 'all'] : ['self', 'ally'];
      const label: Record<CustomItem['target'], string> = {
        single: 'one opponent',
        all: 'all opponents',
        self: 'the user',
        ally: 'pick hero or partner',
      };
      rows.push({
        label: 'Target',
        value: () => label[it.target],
        step: (dir) => {
          it.target = options[(options.indexOf(it.target) + dir + options.length) % options.length];
          this.changed();
        },
      });
    }
    if (it.kind === 'boost')
      rows.push(
        num('Attack +', 'attackUp', 0, 9),
        num('Defence +', 'defenceUp', 0, 9),
        num('Turns', 'turns', 1, 9),
      );
    rows.push({
      label: 'Colour',
      value: () => (it.color === undefined ? 'by effect' : ''),
      step: (dir) => {
        const i = it.color === undefined ? -1 : PALETTE.indexOf(it.color);
        const n = i + dir;
        it.color = n < 0 || n >= PALETTE.length ? undefined : PALETTE[n];
        this.changed();
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

    const g = add(this.add.graphics());
    g.fillStyle(UI.panel).fillRect(0, 0, W, TOP);
    g.fillStyle(UI.rope).fillRect(0, TOP - 2, W, 2);
    txt(6, 9, 'ITEM MAKER', UI.spark);
    for (const b of this.topButtons()) {
      const hot = b.label === 'SAVE' && this.dirty;
      g.fillStyle(hot ? 0x5a3a10 : UI.panelHi).fillRect(b.x, 4, b.label.length * 8 + 12, 17);
      txt(b.x + 6, 9, b.label, hot ? UI.spark : UI.ink);
    }

    this.listRows()
      .slice(this.scroll, this.scroll + 20)
      .forEach((r, k) => {
        const y = LIST.y + 2 + k * ROW;
        const sel = r.pick && JSON.stringify(r.pick) === JSON.stringify(this.pick);
        if (sel) add(this.add.rectangle(LIST.x, y - 2, LIST.w, ROW, UI.panelHi).setOrigin(0));
        txt(LIST.x + 4, y, fit(r.label, 20), r.head || sel ? UI.spark : r.pick ? UI.ink : UI.inkDim);
      });

    const it = this.current();
    if (!it) return;
    // the icon: a coloured box with a mark for its effect
    const col = it.color ?? KIND_COLOR[it.kind];
    const ix = CARD.x + 10;
    const iy = CARD.y + 10;
    g.fillStyle(0x0b0910).fillRect(ix - 2, iy - 2, 52, 52);
    g.fillStyle(col).fillRect(ix, iy, 48, 48);
    g.fillStyle(0xffffff, 0.25).fillRect(ix, iy, 48, 8);
    const mark = { heal: '+', grit: 'G', damage: '!', boost: '^', revive: '*' }[it.kind];
    add(pixelText(this, ix + 24, iy + 26, mark, 24, '#0b0910'));
    txt(ix + 62, iy + 2, fit(it.name.toUpperCase(), 24), UI.spark, 16);
    const owner = this.pick?.src === 'mine' ? 'YOURS' : this.pick?.src === 'other' ? 'COMMUNITY' : 'BUILT-IN';
    add(
      tinyText(this, ix + 62, iy + 24, `${KIND_LABEL[it.kind].toUpperCase()} · ${owner}`, css(UI.inkDim))
        .setOrigin(0)
        .setScale(2),
    );
    add(
      pixelText(this, ix + 62, iy + 38, it.desc || itemSummary(it), 8, css(UI.ink))
        .setOrigin(0, 0)
        .setWordWrapWidth(CARD.w - 84)
        .setLineSpacing(4),
    );

    this.rows = this.buildRows(it);
    const mine = this.pick?.src === 'mine';
    if (!mine) txt(CARD.x + 10, this.propsTop() - 16, 'COPY it to change it.', UI.inkDim);
    this.rows.forEach((r, k) => {
      const y = this.propsTop() + k * ROW;
      txt(CARD.x + 10, y, r.label, UI.inkDim);
      if (r.label === 'Colour' && it.color !== undefined)
        g.fillStyle(col).fillRect(CARD.x + 132, y - 1, 60, 9);
      if (r.step && mine) {
        txt(CARD.x + 118, y, '<', UI.spark);
        txt(CARD.x + CARD.w - 14, y, '>', UI.spark);
      }
      txt(CARD.x + 132, y, fit(r.value(), 30), r.edit && mine ? 0x9fd8ff : UI.ink);
    });

    const by = CARD.y + CARD.h - 22;
    g.fillStyle(UI.panelHi).fillRect(CARD.x + 6, by, 88, 18);
    txt(CARD.x + 14, by + 5, mine ? 'DUPLICATE' : 'COPY');
    if (mine) {
      g.fillStyle(0x3a1018).fillRect(CARD.x + 104, by, 88, 18);
      txt(CARD.x + 120, by + 5, 'DELETE', UI.rope);
    }
    txt(6, H - 18, fit(this.status, 78), this.statusColor);
    add(
      tinyText(
        this,
        W - 6,
        H - 6,
        `SAVES: ${Builds.backend() === 'shared' ? 'LINK' : 'BROWSER'}${this.dirty ? ' · UNSAVED' : ''}`,
        css(this.dirty ? UI.spark : UI.border),
      ).setOrigin(1, 1),
    );
  }
}
