// Move maker (step 6 of the battle builder): attacks and heals for heroes or
// enemies — power, number of hits, Grit cost, how the user gets there, who it
// lands on (the front opponent, any one, or everyone), the action command, what
// it can reach, piercing, and for enemies a wind-up. Made moves show up in the
// fighter maker. TRY opens the sandbox with someone who knows the move.

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
import { t, addStrings } from '../managers/strings';
import {
  Builds,
  globalId,
  moveSummary,
  myOwnerId,
  newMove,
  toMoveDef,
  fromBuiltinMove,
  tidyMove,
  type CustomMove,
} from '../managers/builds';
import { computeDamage } from '../battle/engine';
import { ratingMult } from '../battle/commands';

const TOP = 40;
const LIST = { x: 6, y: TOP + 6, w: 230, h: H - TOP - 40 };
const CARD = { x: LIST.x + LIST.w + 6, y: TOP + 6, w: W - (LIST.x + LIST.w + 6) - 4, h: H - TOP - 40 };
const ROW = 18;

const APPROACH_LABEL: Record<CustomMove['approach'], string> = {
  run: 'Runs in',
  jump: 'Jumps in (aerial)',
  stay: 'Hits from where it stands',
};
const COMMAND_LABEL: Record<CustomMove['command'], string> = {
  timed_press: 'Press on time',
  hold_release: 'Hold & let go',
  stomp: 'Press on every landing',
  none: 'None',
};
const TARGET_LABEL: Record<CustomMove['target'], string> = {
  front: 'Opponent in front',
  single: 'Any one opponent',
  all: 'Every opponent',
  self: 'The user',
  ally: 'Pick hero or partner',
};

type Pick =
  | { src: 'mine'; i: number }
  | { src: 'other'; owner: string; m: CustomMove }
  | { src: 'builtin'; id: string };

interface Row {
  label: string;
  value: () => string;
  step?: (dir: -1 | 1, big: boolean) => void;
  edit?: () => void;
}

/**
 * Opens the sandbox with someone who knows the move: Kid Chispa (and his moves)
 * for a hero move, a Dock Goon that only uses it for an enemy move.
 */
export function tryMoveInSandbox(scene: Phaser.Scene, id: string): void {
  const def = Database.move(id);
  if (def.category === 'enemy') {
    const base = Database.enemy('dock_goon');
    addStrings({ 'c.try.foe.name': `${t(def.name)} Goon` });
    Database.registerCustom(
      'c.try.',
      [],
      [{ ...base, id: 'c.try.foe', name: 'c.try.foe.name', moves: [id], ai: [{ move: id, weight: 1 }] }],
    );
    SceneLoader.goto(scene, 'battle_sandbox', { enemy: 'c.try.foe' });
  } else {
    const base = Database.character('chispa');
    addStrings({ 'c.try.hero.name': t(base.name) });
    Database.registerCustom(
      'c.try.',
      [
        {
          ...base,
          id: 'c.try.hero',
          name: 'c.try.hero.name',
          sprite: 'spr_test_dummy',
          moves: [id, ...base.moves.filter((m) => m !== id)],
        },
      ],
      [],
    );
    SceneLoader.goto(scene, 'battle_sandbox', { hero: 'c.try.hero' });
  }
}

export class MoveMakerScene extends Phaser.Scene {
  /** The screen to go back to (the Battle Maker, or the dev hub). */
  private backTo = 'dev_hub';
  mine: CustomMove[] = [];
  pick: Pick | null = null;
  dirty = false;
  private scroll = 0;
  private rows: Row[] = [];
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private status = '';
  private statusColor: number = UI.inkDim;

  constructor() {
    super('move_maker');
  }

  create(data?: { from?: string }): void {
    this.backTo = data?.from === 'battle_maker' ? 'battle_maker' : 'dev_hub';
    if (!hasGame()) newGame(Database.character('chispa'));
    this.mine = Builds.myMoves();
    this.dirty = false;
    this.scroll = 0;
    this.pick = this.mine.length ? { src: 'mine', i: 0 } : { src: 'builtin', id: 'chop' };
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
          Math.max(0, this.listRows().length - Math.floor((LIST.h - 8) / ROW)),
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
        ? 'Your moves save to the game link. Give them to fighters in the fighter maker.'
        : 'Your moves save in this browser. Give them to fighters in the fighter maker.';
    this.refresh();
  }

  private current(): CustomMove | null {
    const p = this.pick;
    if (!p) return null;
    if (p.src === 'mine') return this.mine[p.i] ?? null;
    if (p.src === 'other') return p.m;
    return fromBuiltinMove(Database.move(p.id), 'view');
  }

  private nextId(): string {
    const used = new Set(this.mine.map((m) => m.id));
    for (let n = 1; ; n++) if (!used.has(`m${n}`)) return `m${n}`;
  }

  private changed(): void {
    this.dirty = true;
    this.refresh();
  }

  addMove(user: 'hero' | 'enemy' = 'hero'): void {
    this.mine.push(newMove(user, this.nextId()));
    this.pick = { src: 'mine', i: this.mine.length - 1 };
    this.changed();
  }

  private copy(): void {
    const c = this.current();
    if (!c) return;
    const m = {
      ...structuredClone(c),
      id: this.nextId(),
      name: this.pick?.src === 'mine' ? `${c.name} 2` : c.name,
    };
    this.mine.push(m);
    this.pick = { src: 'mine', i: this.mine.length - 1 };
    this.status = 'Copied into your moves. Change anything, then SAVE.';
    this.changed();
  }

  private remove(): void {
    if (this.pick?.src !== 'mine') return;
    const gone = this.mine[this.pick.i];
    this.mine.splice(this.pick.i, 1);
    this.pick = this.mine.length ? { src: 'mine', i: Math.max(0, this.pick.i - 1) } : null;
    this.status = 'Removed. SAVE to make it final (your fighters forget it).';
    this.removed.add(gone.id);
    this.changed();
  }

  /** Moves deleted since the last save: your fighters forget them when you save. */
  private removed = new Set<string>();

  async save(): Promise<void> {
    this.status = 'Saving…';
    this.refresh();
    try {
      const gone = new Set([...this.removed].map((id) => globalId(myOwnerId(), id)));
      const fighters = Builds.mine();
      let touched = false;
      for (const f of fighters) {
        const before = f.moves.length;
        f.moves = f.moves.filter((m) => !gone.has(m));
        if (f.lowHpMove && gone.has(f.lowHpMove)) f.lowHpMove = undefined;
        if (f.moves.length !== before) touched = true;
      }
      await Builds.saveMine({ moves: this.mine, ...(touched ? { fighters } : {}) });
      this.removed.clear();
      this.dirty = false;
      this.status = Builds.backend() === 'shared' ? 'Saved to the game link.' : 'Saved in this browser.';
      this.statusColor = UI.good;
    } catch (e) {
      this.status = `Couldn't save: ${(e as { message?: string }).message ?? e}`;
      this.statusColor = UI.rope;
    }
    this.refresh();
  }

  /**
   * Opens the sandbox with someone who knows the move: Kid Chispa (and his moves)
   * for a hero move, a Dock Goon that only uses it for an enemy move.
   */
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
    tryMoveInSandbox(this, id);
  }

  leave(): void {
    SceneLoader.goto(this, this.backTo, this.backTo === 'dev_hub' ? { cursor: 6 } : {});
  }

  // ── Input ───────────────────────────────────────────────────────────

  private topButtons(): { label: string; x: number; act: () => void }[] {
    const defs: [string, () => void][] = [
      ['+HERO MOVE', () => this.addMove('hero')],
      ['+ENEMY MOVE', () => this.addMove('enemy')],
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

  private listRows(): { label: string; pick?: Pick; head?: boolean }[] {
    const out: { label: string; pick?: Pick; head?: boolean }[] = [{ label: 'YOURS', head: true }];
    this.mine.forEach((m, i) => out.push({ label: m.name, pick: { src: 'mine', i } }));
    if (!this.mine.length) out.push({ label: '(none yet)' });
    const others = Builds.otherMoves();
    if (others.length) {
      out.push({ label: 'COMMUNITY', head: true });
      for (const o of others)
        out.push({ label: o.move.name, pick: { src: 'other', owner: o.owner, m: o.move } });
    }
    out.push({ label: 'BUILT-IN', head: true });
    for (const def of Database.data.moves.filter((d) => !d.id.startsWith('c.')))
      out.push({ label: t(def.name), pick: { src: 'builtin', id: def.id } });
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
      const r = this.listRows()[Math.floor((p.y - LIST.y - 1) / ROW) + this.scroll];
      if (r?.pick) {
        this.pick = r.pick;
        this.refresh();
      }
      return;
    }
    const by = CARD.y + CARD.h - 32;
    if (p.y >= by && p.y < by + 24) {
      if (p.x < CARD.x + 120) this.copy();
      else if (p.x < CARD.x + 240) this.remove();
      return;
    }
    if (this.pick?.src !== 'mine') return;
    const i = Math.floor((p.y - this.propsTop()) / ROW);
    const row = this.rows[i];
    if (!row) return;
    if (row.step && p.x < CARD.x + 160) row.step(-1, big);
    else if (row.step && p.x > CARD.x + CARD.w - 24) row.step(1, big);
    else if (row.edit) row.edit();
    else row.step?.(1, big);
  }

  private propsTop(): number {
    return CARD.y + 136;
  }

  /** Lets a browser test change a property row directly. */
  pressRow(label: string, dir: -1 | 1 = 1): void {
    const r = this.rows.find((x) => x.label.startsWith(label));
    r?.step?.(dir, false);
  }

  // ── Properties ──────────────────────────────────────────────────────

  private buildRows(m: CustomMove): Row[] {
    const rows: Row[] = [];
    const y = () => this.propsTop() + rows.length * ROW - 2;
    const set = (fn: () => void) => {
      fn();
      tidyMove(m);
      this.changed();
    };
    const num = (
      label: string,
      key: 'power' | 'hits' | 'gritCost' | 'charge',
      min: number,
      max: number,
    ): Row => ({
      label,
      value: () => String(m[key]),
      step: (dir, big) => set(() => (m[key] = Phaser.Math.Clamp(m[key] + dir * (big ? 5 : 1), min, max))),
    });
    const cycle = <T>(
      label: string,
      list: T[],
      get: () => T,
      put: (v: T) => void,
      show: (v: T) => string,
    ): Row => ({
      label,
      value: () => show(get()),
      step: (dir) => set(() => put(list[(list.indexOf(get()) + dir + list.length) % list.length])),
    });
    const flag = (label: string, key: 'reachesAir' | 'reachesSpiky' | 'piercing'): Row => ({
      label,
      value: () => (m[key] ? 'Yes' : 'No'),
      step: () => set(() => (m[key] = !m[key])),
    });
    rows.push({
      label: 'Name',
      value: () => m.name,
      edit: async () => {
        const v = await editText(this, { x: CARD.x + 164, y: y(), w: CARD.w - 176, value: m.name });
        if (v?.trim()) {
          m.name = v.trim().slice(0, 18);
          this.changed();
        }
      },
    });
    rows.push({
      label: 'Says',
      value: () => m.desc || '(automatic)',
      edit: async () => {
        const v = await editText(this, {
          x: CARD.x + 164,
          y: y(),
          w: CARD.w - 176,
          value: m.desc,
          placeholder: 'empty = describe it automatically',
        });
        if (v !== null) {
          m.desc = v.trim().slice(0, 90);
          this.changed();
        }
      },
    });
    rows.push(
      cycle<CustomMove['user']>(
        'For',
        ['hero', 'enemy'],
        () => m.user,
        (v) => (m.user = v),
        (v) => (v === 'hero' ? 'Heroes' : 'Enemies'),
      ),
    );
    rows.push(
      cycle<CustomMove['kind']>(
        'Type',
        ['attack', 'heal'],
        () => m.kind,
        (v) => (m.kind = v),
        (v) => (v === 'attack' ? 'Attack' : 'Heal'),
      ),
    );
    if (m.kind === 'heal') {
      rows.push(num('Heals', 'power', 1, 20));
      if (m.user === 'hero')
        rows.push(
          cycle<CustomMove['target']>(
            'Target',
            ['self', 'ally'],
            () => m.target,
            (v) => (m.target = v),
            (v) => TARGET_LABEL[v],
          ),
        );
      else rows.push({ label: 'Target', value: () => 'Most hurt teammate' });
    } else {
      rows.push(num('Power', 'power', 0, 9));
      rows.push(num('Hits', 'hits', 1, 5));
      rows.push(
        cycle<CustomMove['target']>(
          'Target',
          ['front', 'single', 'all'],
          () => m.target,
          (v) => (m.target = v),
          (v) => TARGET_LABEL[v],
        ),
      );
      if (m.target !== 'all')
        rows.push(
          cycle<CustomMove['approach']>(
            'Gets there',
            ['run', 'jump', 'stay'],
            () => m.approach,
            (v) => (m.approach = v),
            (v) => APPROACH_LABEL[v],
          ),
        );
      if (m.user === 'hero')
        rows.push(
          cycle<CustomMove['command']>(
            'Command',
            ['timed_press', 'hold_release', 'stomp'],
            () => m.command,
            (v) => (m.command = v),
            (v) => COMMAND_LABEL[v],
          ),
        );
      rows.push(flag('Hits flyers', 'reachesAir'), flag('Hits spiky', 'reachesSpiky'));
      rows.push(flag('Ignores DEF', 'piercing'));
      if (m.user === 'enemy') rows.push(num('Wind-up', 'charge', 0, 3));
    }
    if (m.user === 'hero') rows.push(num('Grit cost', 'gritCost', 0, 10));
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
    txt(12, 12, 'MOVE MAKER', UI.spark, 16);
    for (const b of this.topButtons()) {
      const hot = b.label === 'SAVE' && this.dirty;
      g.fillStyle(hot ? 0x5a3a10 : UI.panelHi).fillRect(b.x, 8, b.label.length * 8 + 16, 24);
      txt(b.x + 8, 16, b.label, hot ? UI.spark : UI.ink);
    }

    this.listRows()
      .slice(this.scroll, this.scroll + Math.floor((LIST.h - 8) / ROW))
      .forEach((r, k) => {
        const y = LIST.y + 6 + k * ROW;
        const sel = r.pick && JSON.stringify(r.pick) === JSON.stringify(this.pick);
        if (sel) add(this.add.rectangle(LIST.x, y - 5, LIST.w, ROW, UI.panelHi).setOrigin(0));
        txt(LIST.x + 4, y, fit(r.label, 27), r.head || sel ? UI.spark : r.pick ? UI.ink : UI.inkDim);
      });

    const m = this.current();
    if (!m) return;
    const ix = CARD.x + 10;
    const iy = CARD.y + 8;
    txt(ix, iy, fit(m.name.toUpperCase(), 30), UI.spark, 16);
    const owner = this.pick?.src === 'mine' ? 'YOURS' : this.pick?.src === 'other' ? 'COMMUNITY' : 'BUILT-IN';
    add(
      tinyText(
        this,
        ix,
        iy + 30,
        `${m.user === 'hero' ? 'HERO' : 'ENEMY'} ${m.kind.toUpperCase()} · ${owner}`,
        css(UI.inkDim),
      )
        .setOrigin(0)
        .setScale(2),
    );
    add(
      pixelText(this, ix, iy + 52, m.desc || moveSummary(m), 8, css(UI.ink))
        .setOrigin(0, 0)
        .setWordWrapWidth(CARD.w - 24)
        .setLineSpacing(6),
    );
    // what it does in numbers, against a fighter with 0 defence, from a user with 1 attack
    if (m.kind === 'attack') {
      const def = toMoveDef('preview', m);
      const per = (r: 'great' | 'good' | 'miss') =>
        computeDamage(def.power, 1, 0, { mult: def.command === 'none' ? 1 : ratingMult(def.command, r) });
      const hits = def.steps.filter((s) => s.do === 'hit').length;
      const each = hits > 1 ? `${hits} hits of ` : '';
      const line =
        def.command === 'none'
          ? `${each}${per('good')} damage`
          : `${each}${per('good')} damage, ${per('great')} on GREAT`;
      txt(ix, iy + 84, `ATK 1 vs DEF 0: ${line}`, UI.grit);
    }

    this.rows = this.buildRows(m);
    const mine = this.pick?.src === 'mine';
    if (!mine) txt(CARD.x + 14, this.propsTop() - 20, 'COPY it to change it.', UI.inkDim);
    this.rows.forEach((r, k) => {
      const y = this.propsTop() + k * ROW;
      txt(CARD.x + 14, y, r.label, UI.inkDim);
      if (r.step && mine) {
        txt(CARD.x + 148, y, '<', UI.spark);
        txt(CARD.x + CARD.w - 20, y, '>', UI.spark);
      }
      txt(CARD.x + 166, y, fit(r.value(), 46), r.edit && mine ? 0x9fd8ff : UI.ink);
    });

    const by = CARD.y + CARD.h - 32;
    g.fillStyle(UI.panelHi).fillRect(CARD.x + 8, by, 104, 24);
    txt(CARD.x + 16, by + 8, mine ? 'DUPLICATE' : 'COPY');
    if (mine) {
      g.fillStyle(0x3a1018).fillRect(CARD.x + 128, by, 104, 24);
      txt(CARD.x + 148, by + 8, 'DELETE', UI.rope);
    }
    txt(10, H - 26, fit(this.status, 110), this.statusColor);
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
}
