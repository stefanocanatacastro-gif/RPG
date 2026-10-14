// PLAY: the Battle World. Showcase fights to start with, every battle people
// have uploaded (Featured, Popular, New, and by how hard they've proved), and
// your own. Each card shows the line-up, its maker, likes, plays and clear rate;
// pick one, fight it, and after the bell like it, try again or go to the next.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { UI, css } from '../ui/theme';
import { input } from '../systems/input';
import { animKey } from '../systems/anim_builder';
import { SceneLoader, type BattleEnd } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { Builds, encounterKey, myOwnerId, type Encounter } from '../managers/builds';
import {
  fightSummary,
  finishCustomBattle,
  setupProblems,
  startCustomBattle,
  type BattleSetup,
} from '../managers/custom_battle';
import { Likes, loadLikes } from '../managers/likes';
import { Plays, loadPlays, type Difficulty } from '../managers/plays';
import { profileNames } from '../managers/artifact_db';
import { conditionLines } from '../battle/conditions';
import { SCENARIOS } from '../data/scenarios';
import { fighterTexture } from '../systems/custom_looks';
import { heroSprite } from '../systems/hero_art';
import type { BattleScene } from './battle';
import { exportBattle, importFromPicker, listenForBattleFiles, type ShareResult } from '../ui/share';

type Tab = 'showcase' | 'world' | 'mine';
type Sort = 'featured' | 'popular' | 'new';
type Filter = 'all' | Difficulty;

/** A battle on a card. */
export interface PlayEntry {
  /** Records and plays are kept under this. */
  key: string;
  /** Likes are kept under this. */
  likeKey: string;
  title: string;
  desc: string;
  setup: BattleSetup;
  from: Tab;
  owner?: string;
  /** Showcase fights come with their designer's difficulty. */
  rated?: string;
  published?: string;
  /** Yours, not uploaded yet. */
  draft?: boolean;
  /** From a battle file: its maker, and whether they beat it. */
  imported?: { maker: string; cleared: boolean };
  encounterId?: string;
}

const TOP = 92;
const COLS = 3;
const ROWS = 2;
const CW = 296;
const CH = 178;
const GAP = 12;
const X0 = (W - (CW * COLS + GAP * (COLS - 1))) / 2;

const DIFF_COLOR: Record<string, number> = {
  easy: 0x5fd068,
  normal: 0x3fa7f0,
  medium: 0x3fa7f0,
  hard: 0xffb238,
  expert: 0xffb238,
  'very hard': 0xd8314b,
  'super expert': 0xd8314b,
};

export class PlayScene extends Phaser.Scene {
  tab: Tab = 'showcase';
  sort: Sort = 'featured';
  filter: Filter = 'all';
  page = 0;
  /** The card with the keyboard focus. */
  focus = 0;
  /** The battle whose details are open, or being fought. */
  open: PlayEntry | null = null;
  /** After a fight: how it went (the browser test reads it). */
  result: { key: string; result: string; rounds: number } | null = null;
  private names: Record<string, string> = {};
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private hits: { x: number; y: number; w: number; h: number; act: () => void }[] = [];
  private fighting = false;
  /** How the last share or import went. */
  notice: { text: string; ok: boolean } | null = null;
  /** Where buttons are drawn while a panel is open. */
  private btnG: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    super('play');
  }

  create(): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.open = null;
    this.result = null;
    this.fighting = false;
    this.page = 0;
    this.focus = 0;
    this.cameras.main.setBackgroundColor(UI.void);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.click(p.x, p.y));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.turnPage(dy > 0 ? 1 : -1),
    );
    this.events.on(Phaser.Scenes.Events.WAKE, (_s: unknown, end: BattleEnd) => this.afterFight(end));
    this.notice = null;
    // a battle file dropped on the game, or pasted, is imported
    listenForBattleFiles(this, (r) => this.afterImport(r));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.WAKE));
    this.refresh();
    // likes, plays and makers' names arrive from the game link
    void Promise.all([loadLikes(), loadPlays()]).then(async () => {
      const owners = [...new Set(Builds.worldEncounters().map((w) => w.owner))].filter((o) =>
        o.startsWith('u_'),
      );
      this.names = await profileNames(owners);
      if (this.scene.isActive()) this.refresh();
    });
  }

  // ── What's on the shelves ───────────────────────────────────────────

  private makerName(owner?: string, e?: PlayEntry): string {
    if (e?.imported) return e.imported.maker;
    if (!owner) return 'Showcase';
    if (owner === myOwnerId()) return 'You';
    return this.names[owner] || 'A maker';
  }

  /** Every battle on the current tab, sorted and filtered. */
  entries(): PlayEntry[] {
    if (this.tab === 'showcase')
      return SCENARIOS.map((s) => ({
        key: `show:${s.id}`,
        likeKey: `encounter:show:${s.id}`,
        title: s.title,
        desc: s.desc,
        setup: s.setup,
        from: 'showcase',
        rated: s.difficulty,
      }));
    const toEntry = (owner: string, e: Encounter, from: Tab): PlayEntry => ({
      key: encounterKey(owner, e.id),
      likeKey: `encounter:${encounterKey(owner, e.id)}`,
      title: e.title,
      desc: e.desc ?? '',
      setup: e.setup,
      from,
      owner,
      published: e.published,
      draft: !e.published && !e.imported,
      encounterId: e.id,
      ...(e.imported ? { imported: { maker: e.imported.maker, cleared: e.imported.cleared } } : {}),
    });
    if (this.tab === 'mine')
      return Builds.myEncounters()
        .map((e) => toEntry(myOwnerId(), e, 'mine'))
        .sort((a, b) => Number(!!a.draft) - Number(!!b.draft) || a.title.localeCompare(b.title));
    let list = Builds.worldEncounters().map((w) => toEntry(w.owner, w.encounter, 'world'));
    if (this.filter !== 'all') list = list.filter((e) => Plays.difficulty(e.key) === this.filter);
    const age = (e: PlayEntry) => (Date.now() - Date.parse(e.published ?? '2020-01-01')) / 86_400_000;
    const likes = (e: PlayEntry) => Likes.count(e.likeKey);
    const plays = (e: PlayEntry) => Plays.totals(e.key).plays;
    if (this.sort === 'new') list.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
    else if (this.sort === 'popular') list.sort((a, b) => likes(b) - likes(a) || plays(b) - plays(a));
    // featured: liked and played a lot, lately
    else
      list.sort(
        (a, b) => (likes(b) * 3 + plays(b) + 1) / (age(b) + 2) - (likes(a) * 3 + plays(a) + 1) / (age(a) + 2),
      );
    return list;
  }

  private pages(): number {
    return Math.max(1, Math.ceil(this.entries().length / (COLS * ROWS)));
  }

  private turnPage(d: number): void {
    if (this.open) return;
    this.page = Phaser.Math.Clamp(this.page + d, 0, this.pages() - 1);
    this.focus = 0;
    this.refresh();
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.focus = 0;
    this.refresh();
  }

  // ── Input ───────────────────────────────────────────────────────────

  private click(x: number, y: number): void {
    // later hits sit on top (overlays are drawn last)
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h.act();
    }
    // a click outside an open panel closes it
    if (this.open && !this.result) this.close();
  }

  update(): void {
    if (this.fighting || SceneLoader.isBusy()) return;
    if (input.justPressed('cancel') || input.justPressed('menu')) {
      if (this.open || this.result) return this.close();
      return void SceneLoader.goto(this, 'title');
    }
    if (this.open || this.result) {
      if (input.justPressed('confirm')) {
        if (this.result) this.retry();
        else if (this.open) this.playOpen();
      }
      return;
    }
    const shown = this.shown().length;
    const move = (d: number) => {
      this.focus = Phaser.Math.Clamp(this.focus + d, 0, Math.max(0, shown - 1));
      this.refresh();
    };
    if (input.justPressed('right')) {
      if (this.focus % COLS === COLS - 1 || this.focus === shown - 1) this.turnPage(1);
      else move(1);
    } else if (input.justPressed('left')) {
      if (this.focus % COLS === 0) this.turnPage(-1);
      else move(-1);
    } else if (input.justPressed('down')) move(COLS);
    else if (input.justPressed('up')) move(-COLS);
    else if (input.justPressed('confirm') && shown) this.details(this.shown()[this.focus]);
  }

  private shown(): PlayEntry[] {
    const n = COLS * ROWS;
    return this.entries().slice(this.page * n, this.page * n + n);
  }

  // ── Actions ─────────────────────────────────────────────────────────

  details(e: PlayEntry): void {
    this.open = e;
    this.result = null;
    this.refresh();
  }

  private close(): void {
    this.open = null;
    this.result = null;
    this.refresh();
  }

  /** Fights the open battle (drafts open in the Battle Maker instead). */
  playOpen(): void {
    const e = this.open;
    if (!e || this.fighting) return;
    if (e.draft) return this.toMaker(e);
    if (setupProblems(e.setup).length) return;
    this.fighting = true;
    this.result = null;
    startCustomBattle(this, e.setup, 'play');
  }

  private retry(): void {
    this.result = null;
    this.playOpen();
  }

  /** The next battle on the shelf after the open one. */
  private next(): void {
    const list = this.entries();
    const i = list.findIndex((e) => e.key === this.open?.key);
    const n = list[(i + 1) % list.length];
    if (!n) return this.close();
    this.page = Math.floor(list.indexOf(n) / (COLS * ROWS));
    this.focus = list.indexOf(n) % (COLS * ROWS);
    this.result = null;
    this.open = n;
    this.playOpen();
  }

  /** Opens a battle in the Battle Maker: yours to edit, or someone else's as a copy to remix. */
  private toMaker(e: PlayEntry): void {
    const mine = e.owner === myOwnerId() && e.encounterId;
    SceneLoader.goto(
      this,
      'battle_maker',
      mine ? { edit: e.encounterId } : { remix: { title: e.title, setup: e.setup } },
    );
  }

  /** Saves a battle as a file to send to anyone. */
  async share(e: PlayEntry): Promise<void> {
    const credit = e.imported
      ? e.imported.maker
      : e.from === 'showcase'
        ? 'Showcase'
        : e.owner && e.owner !== myOwnerId()
          ? this.makerName(e.owner)
          : undefined;
    const cleared =
      e.from === 'showcase' || !!e.published || !!e.imported?.cleared || !!Plays.mine(e.key)?.wins;
    const r = await exportBattle(this, { title: e.title, desc: e.desc, setup: e.setup }, cleared, credit);
    this.notice = { text: r.message, ok: r.ok };
    this.refresh();
  }

  async importFile(): Promise<void> {
    const r = await importFromPicker();
    if (r) this.afterImport(r);
  }

  /** An imported battle shows up in YOURS, opened and ready to fight. */
  afterImport(r: ShareResult): void {
    this.notice = { text: r.message, ok: r.ok };
    if (r.ok && r.id) {
      this.tab = 'mine';
      this.page = 0;
      const e = this.entries().find((x) => x.encounterId === r.id);
      this.result = null;
      this.open = e ?? null;
    }
    this.refresh();
  }

  private async like(e: PlayEntry): Promise<void> {
    await Likes.toggle(e.likeKey);
    this.refresh();
  }

  private afterFight(end: BattleEnd): void {
    this.fighting = false;
    const e = this.open;
    const battle = (this.scene.get('battle') as BattleScene).engine;
    finishCustomBattle();
    if (!e) return this.refresh();
    const r = fightSummary(battle);
    this.result = { key: e.key, result: end.result, rounds: r.rounds };
    this.refresh();
    void Plays.record(e.key, end.result === 'win', r.rounds).then(() => this.refresh());
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  refresh(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    this.hits = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.dyn.push(o);
      return o;
    };
    const txt = (x: number, y: number, s: string, color: number = UI.ink, size: 8 | 16 | 24 | 32 = 8) =>
      add(pixelText(this, x, y, s, size, css(color)).setOrigin(0, 0));
    const g = add(this.add.graphics());
    const base = g;
    this.btnG = null;
    const button = (
      x: number,
      y: number,
      label: string,
      act: () => void,
      opts: { hot?: boolean; color?: number; w?: number; big?: boolean } = {},
    ) => {
      const size = opts.big ? 16 : 8;
      const w = opts.w ?? label.length * size + (opts.big ? 32 : 20);
      const h = opts.big ? 34 : 24;
      // buttons on an open panel draw on the panel's own layer, above the dimming
      const g = this.btnG ?? base;
      g.fillStyle(opts.hot ? 0x5a3a10 : (opts.color ?? UI.panelHi)).fillRect(x, y, w, h);
      if (opts.hot) g.lineStyle(2, UI.spark).strokeRect(x, y, w, h);
      const tx = txt(x + w / 2, y + (opts.big ? 9 : 8), label, opts.hot ? UI.spark : UI.ink, size);
      tx.setOrigin(0.5, 0);
      this.hits.push({ x, y, w, h, act });
      return w;
    };

    // header
    g.fillStyle(UI.panel).fillRect(0, 0, W, 44);
    g.fillStyle(UI.rope).fillRect(0, 42, W, 2);
    txt(16, 12, 'BATTLE WORLD', UI.spark, 24);
    button(W - 84, 10, 'BACK', () => void SceneLoader.goto(this, 'title'));
    button(W - 186, 10, 'MAKE', () => void SceneLoader.goto(this, 'battle_maker'), { color: 0x2a4a20 });
    button(W - 296, 10, 'IMPORT', () => void this.importFile());
    if (this.notice)
      add(
        pixelText(this, 16, H - 26, this.notice.text, 8, css(this.notice.ok ? UI.good : UI.rope))
          .setOrigin(0, 0)
          .setWordWrapWidth(W / 2 - 150),
      );

    // tabs
    let x = 16;
    const tabs: [Tab, string][] = [
      ['showcase', 'SHOWCASE'],
      ['world', 'BATTLE WORLD'],
      ['mine', 'YOURS'],
    ];
    for (const [tab, label] of tabs)
      x += button(x, 54, label, () => this.setTab(tab), { hot: this.tab === tab }) + 8;
    if (this.tab === 'world') {
      x += 16;
      const sorts: [Sort, string][] = [
        ['featured', 'FEATURED'],
        ['popular', 'POPULAR'],
        ['new', 'NEW'],
      ];
      for (const [s, label] of sorts)
        x +=
          button(x, 54, label, () => ((this.sort = s), (this.page = 0), this.refresh()), {
            hot: this.sort === s,
          }) + 6;
      const filters: Filter[] = ['all', 'easy', 'normal', 'expert', 'super expert'];
      const f = this.filter;
      button(
        W - 16 - 150,
        54,
        f === 'all' ? 'ANY DIFFICULTY' : f.toUpperCase(),
        () => {
          this.filter = filters[(filters.indexOf(f) + 1) % filters.length];
          this.page = 0;
          this.refresh();
        },
        { w: 150, hot: f !== 'all' },
      );
    }

    // cards
    const shown = this.shown();
    if (!shown.length) this.emptyShelf(txt, button);
    shown.forEach((e, i) =>
      this.card(e, X0 + (i % COLS) * (CW + GAP), TOP + Math.floor(i / COLS) * (CH + GAP), i, add, txt, g),
    );

    // pages
    const pages = this.pages();
    if (pages > 1) {
      const py = H - 34;
      button(W / 2 - 110, py, '<', () => this.turnPage(-1), { w: 40 });
      txt(W / 2, py + 8, `PAGE ${this.page + 1} / ${pages}`, UI.inkDim).setOrigin(0.5, 0);
      button(W / 2 + 70, py, '>', () => this.turnPage(1), { w: 40 });
    }

    if (this.result && this.open) this.resultPanel(add, txt, button);
    else if (this.open) this.detailPanel(this.open, add, txt, button);
  }

  private emptyShelf(
    txt: (
      x: number,
      y: number,
      s: string,
      color?: number,
      size?: 8 | 16 | 24 | 32,
    ) => Phaser.GameObjects.Text,
    button: (
      x: number,
      y: number,
      label: string,
      act: () => void,
      opts?: { hot?: boolean; big?: boolean; w?: number },
    ) => number,
  ): void {
    const lines =
      this.tab === 'mine'
        ? ['You haven’t made a battle yet.', 'Build one in the Battle Maker: it shows up here.']
        : this.filter !== 'all'
          ? [
              'No battles at this difficulty yet.',
              'Difficulty comes from everyone’s clear rate after 5 plays.',
            ]
          : ['No battles uploaded yet.', 'Be the first: make one, beat it, and upload it.'];
    txt(W / 2, 200, lines[0], UI.ink, 16).setOrigin(0.5, 0);
    txt(W / 2, 232, lines[1], UI.inkDim).setOrigin(0.5, 0);
    if (this.tab !== 'world' || this.filter === 'all')
      button(W / 2 - 110, 270, 'OPEN THE MAKER', () => void SceneLoader.goto(this, 'battle_maker'), {
        big: true,
        w: 220,
      });
  }

  /** A pixel heart, play arrow or tick, for the stats row. */
  private icon(
    g: Phaser.GameObjects.Graphics,
    kind: 'heart' | 'play' | 'clear',
    x: number,
    y: number,
    color: number,
  ): void {
    const shapes = {
      heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
      play: ['##....', '####..', '######', '####..', '##....', '......'],
      clear: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
    };
    g.fillStyle(color);
    shapes[kind].forEach((row, j) => [...row].forEach((c, i) => c === '#' && g.fillRect(x + i, y + j, 1, 1)));
  }

  private card(
    e: PlayEntry,
    x: number,
    y: number,
    i: number,
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    txt: (
      x: number,
      y: number,
      s: string,
      color?: number,
      size?: 8 | 16 | 24 | 32,
    ) => Phaser.GameObjects.Text,
    g: Phaser.GameObjects.Graphics,
  ): void {
    const focus = i === this.focus && !this.open;
    drawPanel(g, x, y, CW, CH, { alpha: 1 });
    if (focus) g.lineStyle(2, UI.spark).strokeRect(x - 1, y - 1, CW + 2, CH + 2);
    const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    txt(x + 10, y + 10, fit(e.title.toUpperCase(), 17), UI.spark, 16);
    txt(x + 10, y + 32, fit(`by ${this.makerName(e.owner, e)}${e.imported ? ' (file)' : ''}`, 34), UI.inkDim);
    // badge: designer's rating, the earned difficulty, or DRAFT
    const diff = e.draft ? 'DRAFT' : (e.rated ?? Plays.difficulty(e.key) ?? 'new').toUpperCase();
    const bc = e.draft ? UI.border : (DIFF_COLOR[diff.toLowerCase()] ?? UI.borderHi);
    const bw = diff.length * 8 + 12;
    g.fillStyle(bc, 0.9).fillRect(x + CW - bw - 8, y + 30, bw, 14);
    txt(x + CW - bw - 2, y + 33, diff, 0x0b0910);

    // the line-up: the hero (and partner), then the opponents
    const floor = y + 132;
    g.fillStyle(0x2a2236).fillRect(x + 6, floor - 66, CW - 12, 70);
    g.fillStyle(0xc9b994, 0.35).fillRect(x + 6, floor, CW - 12, 4);
    const s = e.setup;
    const people: { id: string; enemy: boolean }[] = [
      { id: s.hero, enemy: false },
      ...(s.partner ? [{ id: s.partner, enemy: false }] : []),
      ...s.enemies.map((en) => ({ id: en.id, enemy: true })),
    ];
    const heroes = people.filter((p) => !p.enemy).length;
    const foes = people.length - heroes;
    people.forEach((p, k) => {
      const enemy = p.enemy;
      const idx = enemy ? k - heroes : k;
      // heroes on the left, VS, the opponents spread over the right part
      const left = x + 150;
      const right = x + CW - 32;
      const px = enemy
        ? foes === 1
          ? right
          : right - (foes - 1 - idx) * Math.min(52, (right - left) / (foes - 1))
        : x + 34 + idx * 40;
      this.mini(p.id, px, floor, enemy, add);
    });
    txt(x + 108, floor - 40, 'VS', UI.inkDim, 16);

    // stats
    const t0 = Plays.totals(e.key);
    const sy = y + CH - 22;
    this.icon(g, 'heart', x + 10, sy + 1, Likes.mine(e.likeKey) ? UI.rope : UI.inkDim);
    txt(x + 20, sy, String(Likes.count(e.likeKey)), UI.ink);
    this.icon(g, 'play', x + 62, sy + 1, UI.inkDim);
    txt(x + 72, sy, String(t0.plays), UI.ink);
    this.icon(g, 'clear', x + 116, sy + 1, UI.good);
    txt(x + 126, sy, t0.rate === null ? '—' : `${Math.round(t0.rate * 100)}%`, UI.ink);
    const mine = Plays.mine(e.key);
    if (mine?.wins) txt(x + CW - 74, sy, 'CLEARED', UI.good);
    this.hits.push({ x, y, w: CW, h: CH, act: () => this.details(e) });
  }

  /** A fighter drawn small on a card, standing on `floor`. */
  private mini(
    id: string,
    x: number,
    floor: number,
    enemy: boolean,
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
  ): void {
    const known = enemy
      ? Database.data.enemies.some((d) => d.id === id)
      : Database.data.characters.some((d) => d.id === id);
    if (!known) return;
    const base = enemy
      ? Database.enemy(id).sprite
      : id === 'chispa'
        ? heroSprite(this)
        : Database.character(id).sprite;
    const tex = fighterTexture(this, id, base).key;
    if (!this.textures.exists(tex)) return;
    const animated = this.anims.exists(animKey(tex, 'idle'));
    const sp = add(this.add.sprite(x, floor, tex, animated ? 'idle_00' : undefined).setOrigin(0.5, 1));
    const fit = Math.min(1, 62 / sp.height);
    sp.setScale(fit * (animated ? 1 : 0.75));
    if (enemy && animated) sp.setFlipX(true);
  }

  private overlay(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): {
    x: number;
    y: number;
    w: number;
    h: number;
    g: Phaser.GameObjects.Graphics;
  } {
    add(this.add.rectangle(0, 0, W, H, 0x05040a, 0.7).setOrigin(0));
    const w = 640;
    const h = 380;
    const x = (W - w) / 2;
    const y = (H - h) / 2 + 10;
    const g = add(this.add.graphics());
    drawPanel(g, x, y, w, h, { alpha: 1 });
    this.btnG = add(this.add.graphics());
    // clicks inside the panel don't close it
    this.hits.push({ x, y, w, h, act: () => undefined });
    return { x, y, w, h, g };
  }

  private detailPanel(
    e: PlayEntry,
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    txt: (
      x: number,
      y: number,
      s: string,
      color?: number,
      size?: 8 | 16 | 24 | 32,
    ) => Phaser.GameObjects.Text,
    button: (
      x: number,
      y: number,
      label: string,
      act: () => void,
      opts?: { hot?: boolean; big?: boolean; w?: number; color?: number },
    ) => number,
  ): void {
    const { x, y, w, h } = this.overlay(add);
    txt(x + 20, y + 18, e.title.toUpperCase(), UI.spark, 24);
    const rated = e.draft
      ? 'DRAFT (not uploaded)'
      : e.rated
        ? `designer says ${e.rated}`
        : (Plays.difficulty(e.key) ?? 'new: not enough plays to rate');
    txt(
      x + 20,
      y + 52,
      `by ${this.makerName(e.owner, e)} · ${e.imported ? (e.imported.cleared ? 'imported · its maker beat it' : 'imported · not cleared by its maker') : rated}`,
      UI.inkDim,
    );
    let ly = y + 76;
    if (e.desc) {
      const d = add(
        pixelText(this, x + 20, ly, e.desc, 8, css(UI.ink))
          .setOrigin(0)
          .setWordWrapWidth(w - 40)
          .setLineSpacing(4),
      );
      ly += d.height + 14;
    }
    const s = e.setup;
    const name = (id: string, enemy: boolean) =>
      enemy
        ? Database.data.enemies.some((d) => d.id === id)
          ? t(Database.enemy(id).name)
          : '(missing)'
        : Database.data.characters.some((d) => d.id === id)
          ? t(Database.character(id).name)
          : '(missing)';
    const lines: [string, string][] = [
      [
        'YOU',
        `${name(s.hero, false)} · HP ${s.maxHp} · ATK ${s.attack} · DEF ${s.defence}${s.partner ? ` · with ${name(s.partner, false)}` : ''}`,
      ],
      ['VS', s.enemies.map((en) => name(en.id, true)).join(', ')],
      [
        'RING',
        [
          t(Database.data.stages.find((st) => st.id === s.stage)?.name ?? s.stage),
          ...conditionLines(s.conditions),
        ].join(' · '),
      ],
      [
        'BAG',
        s.conditions?.noItems
          ? 'no items allowed'
          : (s.items ?? [])
              .map((i) => (Database.data.items.some((d) => d.id === i) ? t(Database.item(i).name) : '?'))
              .join(', ') || 'empty',
      ],
    ];
    for (const [k, v] of lines) {
      txt(x + 20, ly, k, UI.spark);
      const tv = add(
        pixelText(this, x + 76, ly, v, 8, css(UI.ink))
          .setOrigin(0)
          .setWordWrapWidth(w - 100)
          .setLineSpacing(4),
      );
      ly += Math.max(18, tv.height + 8);
    }
    const tot = Plays.totals(e.key);
    const mine = Plays.mine(e.key);
    ly += 6;
    txt(
      x + 20,
      ly,
      `${Likes.count(e.likeKey)} likes · ${tot.plays} plays by ${tot.players} · clear rate ${tot.rate === null ? '—' : `${Math.round(tot.rate * 100)}%`}`,
      UI.inkDim,
    );
    if (mine)
      txt(
        x + 20,
        ly + 18,
        `You: ${mine.wins} win${mine.wins === 1 ? '' : 's'} in ${mine.plays}${mine.best ? ` · best ${mine.best} rounds` : ''}`,
        mine.wins ? UI.good : UI.inkDim,
      );
    const problems = setupProblems(s);
    if (problems.length) txt(x + 20, y + h - 82, `Can't be played: ${problems[0]}`, UI.rope);
    // buttons
    const by = y + h - 50;
    let bx = x + 20;
    if (e.draft) bx += button(bx, by, 'OPEN IN MAKER', () => this.toMaker(e), { big: true, hot: true }) + 10;
    else if (!problems.length)
      bx += button(bx, by, 'FIGHT!', () => this.playOpen(), { big: true, hot: true, w: 150 }) + 10;
    if (!e.draft)
      bx +=
        button(bx, by + 5, Likes.mine(e.likeKey) ? 'LIKED' : 'LIKE', () => void this.like(e), {
          color: Likes.mine(e.likeKey) ? 0x5a1a24 : undefined,
        }) + 8;
    if (!e.draft)
      bx +=
        button(bx, by + 5, e.owner === myOwnerId() && !e.imported ? 'EDIT' : 'REMIX', () => this.toMaker(e)) +
        8;
    button(bx, by + 5, 'SHARE', () => void this.share(e));
    button(x + w - 90, by + 5, 'CLOSE', () => this.close());
  }

  private resultPanel(
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    txt: (
      x: number,
      y: number,
      s: string,
      color?: number,
      size?: 8 | 16 | 24 | 32,
    ) => Phaser.GameObjects.Text,
    button: (
      x: number,
      y: number,
      label: string,
      act: () => void,
      opts?: { hot?: boolean; big?: boolean; w?: number; color?: number },
    ) => number,
  ): void {
    const e = this.open!;
    const r = this.result!;
    const { x, y, w, h } = this.overlay(add);
    const won = r.result === 'win';
    const word = won ? 'CLEAR!' : r.result === 'run' ? 'RAN AWAY' : 'KNOCKED OUT';
    txt(x + w / 2, y + 40, word, won ? UI.spark : UI.rope, 32).setOrigin(0.5, 0);
    txt(x + w / 2, y + 90, e.title.toUpperCase(), UI.ink, 16).setOrigin(0.5, 0);
    txt(
      x + w / 2,
      y + 120,
      won ? `Won in round ${r.rounds}` : `Lasted ${r.rounds} round${r.rounds === 1 ? '' : 's'}`,
      UI.inkDim,
    ).setOrigin(0.5, 0);
    const mine = Plays.mine(e.key);
    if (mine)
      txt(
        x + w / 2,
        y + 140,
        `Your record: ${mine.wins} / ${mine.plays}${mine.best ? ` · best ${mine.best} rounds` : ''}`,
        UI.inkDim,
      ).setOrigin(0.5, 0);
    const tot = Plays.totals(e.key);
    if (tot.rate !== null)
      txt(
        x + w / 2,
        y + 160,
        `Everyone: ${Math.round(tot.rate * 100)}% clear rate over ${tot.plays} plays`,
        UI.inkDim,
      ).setOrigin(0.5, 0);
    // like it: the big ask after a fight
    const liked = Likes.mine(e.likeKey);
    button(x + w / 2 - 90, y + 200, liked ? 'LIKED!' : 'LIKE IT', () => void this.like(e), {
      big: true,
      w: 180,
      color: liked ? 0x5a1a24 : undefined,
    });
    const by = y + h - 56;
    button(x + 40, by, 'TRY AGAIN', () => this.retry(), { big: true, w: 170, hot: !won });
    button(x + w / 2 - 85, by, 'NEXT', () => this.next(), { big: true, w: 170, hot: won });
    button(x + w - 210, by, 'BACK', () => this.close(), { big: true, w: 170 });
  }
}
