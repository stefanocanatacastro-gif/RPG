// Community gallery (step 7 of the battle builder): everything everyone in the
// game link has made — fighters, moves, items and encounters — by maker, with
// likes. Any of it can be tried or played right away, or copied into your own
// set to remix in the makers.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { SceneLoader } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { input } from '../systems/input';
import {
  Builds,
  encounterKey,
  globalId,
  itemSummary,
  moveSummary,
  myOwnerId,
  creations,
  type Creation,
  type CreationKind,
  type CustomFighter,
  type CustomItem,
  type CustomMove,
  type Encounter,
} from '../managers/builds';
import { Likes, loadLikes } from '../managers/likes';
import { profileNames } from '../managers/artifact_db';
import { conditionLines } from '../battle/conditions';
import { ensureLook } from '../systems/custom_looks';
import { tryMoveInSandbox } from './move_maker';
import { setupProblems } from '../managers/battle_setup';

const TOP = 26;
const MAKERS = { x: 4, y: TOP + 4, w: 132, h: H - TOP - 26 };
const LIST = { x: MAKERS.x + MAKERS.w + 6, y: TOP + 4, w: 196, h: H - TOP - 26 };
const CARD = { x: LIST.x + LIST.w + 6, y: TOP + 4, w: W - (LIST.x + LIST.w + 6) - 4, h: H - TOP - 26 };
const ROW = 13;
const KINDS: CreationKind[] = ['encounter', 'fighter', 'move', 'item'];
const KIND_TAB: Record<CreationKind, string> = {
  encounter: 'FIGHTS',
  fighter: 'ROSTER',
  move: 'MOVES',
  item: 'ITEMS',
};

export class GalleryScene extends Phaser.Scene {
  kind: CreationKind = 'encounter';
  /** Maker filter: null = everyone. */
  maker: string | null = null;
  selected = 0;
  sort: 'liked' | 'az' = 'liked';
  private names: Record<string, string> = {};
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private status = '';
  private statusColor: number = UI.inkDim;
  private scroll = 0;
  private busy = false;
  ready = false;

  constructor() {
    super('gallery');
  }

  create(data?: { kind?: CreationKind }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.kind = data?.kind ?? this.kind;
    this.selected = 0;
    this.scroll = 0;
    this.busy = false;
    this.ready = false;
    this.cameras.main.setBackgroundColor(UI.void);
    const frame = this.add.graphics();
    for (const r of [MAKERS, LIST, CARD]) drawPanel(frame, r.x - 2, r.y - 2, r.w + 4, r.h + 4, { alpha: 1 });
    this.status =
      Builds.backend() === 'shared'
        ? 'Everything made by everyone in this game link. Try it, like it, copy it to remix.'
        : 'Outside the game link only your own creations show. Publish to share.';
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.scroll = Phaser.Math.Clamp(
          this.scroll + (dy > 0 ? 3 : -3),
          0,
          Math.max(0, this.list().length - 19),
        );
        this.refresh();
      },
    );
    this.refresh();
    // likes and makers' names arrive a moment later
    void (async () => {
      await loadLikes();
      const owners = Builds.allSets()
        .map((s) => s.owner)
        .filter((o) => o !== 'me');
      this.names = await profileNames(owners);
      this.ready = true;
      if (this.scene.isActive()) this.refresh();
    })();
  }

  // ── Data ────────────────────────────────────────────────────────────

  makerName(owner: string): string {
    if (owner === 'me' || owner === myOwnerId()) return 'You';
    return this.names[owner] || `Maker ${owner.replace(/^u_/, '').slice(0, 6)}`;
  }

  private makers(): { owner: string | null; label: string; n: number }[] {
    const all = KINDS.flatMap((k) => creations(k));
    const by = new Map<string, number>();
    for (const c of all) by.set(c.owner, (by.get(c.owner) ?? 0) + 1);
    const out: { owner: string | null; label: string; n: number }[] = [
      { owner: null, label: 'Everyone', n: all.length },
    ];
    const owners = [...by.keys()].sort((a, b) =>
      a === myOwnerId() ? -1 : b === myOwnerId() ? 1 : this.makerName(a).localeCompare(this.makerName(b)),
    );
    for (const o of owners) out.push({ owner: o, label: this.makerName(o), n: by.get(o)! });
    return out;
  }

  list(): Creation[] {
    const out = creations(this.kind).filter((c) => this.maker === null || c.owner === this.maker);
    if (this.sort === 'liked')
      out.sort((a, b) => Likes.count(b.key) - Likes.count(a.key) || a.name.localeCompare(b.name));
    else out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  current(): Creation | null {
    return this.list()[this.selected] ?? null;
  }

  private isMine(c: Creation): boolean {
    return c.owner === myOwnerId();
  }

  // ── Actions ─────────────────────────────────────────────────────────

  setKind(k: CreationKind): void {
    this.kind = k;
    this.selected = 0;
    this.scroll = 0;
    this.refresh();
  }

  async like(): Promise<void> {
    const c = this.current();
    if (!c || this.busy) return;
    if (this.isMine(c)) return this.say("That's yours — likes are for other people's work.", UI.inkDim);
    this.busy = true;
    try {
      const on = await Likes.toggle(c.key);
      this.say(on ? `You like "${c.name}".` : 'Like taken back.', on ? UI.good : UI.inkDim);
    } catch (e) {
      this.say(`Couldn't save the like: ${(e as { message?: string }).message ?? e}`, UI.rope);
    }
    this.busy = false;
  }

  /** Try a fighter, move or item in the sandbox, or play an encounter. */
  play(): void {
    const c = this.current();
    if (!c || this.busy) return;
    const gid = globalId(c.owner, c.id);
    if (c.kind === 'encounter') {
      const problems = setupProblems((c.thing as Encounter).setup);
      if (problems.length) return this.say(`Can't be played: ${problems[0]}.`, UI.rope);
      SceneLoader.goto(this, 'encounters', { select: encounterKey(c.owner, c.id) });
    } else if (c.kind === 'fighter') {
      const f = c.thing as CustomFighter;
      SceneLoader.goto(this, 'battle_sandbox', f.kind === 'hero' ? { hero: gid } : { enemy: gid });
    } else if (c.kind === 'item') SceneLoader.goto(this, 'battle_sandbox', { item: gid });
    else if (Database.data.moves.some((m) => m.id === gid)) tryMoveInSandbox(this, gid);
  }

  async copy(): Promise<void> {
    const c = this.current();
    if (!c || this.busy) return;
    this.busy = true;
    try {
      const id = await Builds.copyIn(c.kind, c.thing);
      const where = {
        fighter: 'fighter maker',
        move: 'move maker',
        item: 'item maker',
        encounter: 'sandbox (open it from Encounters)',
      }[c.kind];
      this.say(`Copied as yours (${id}). Change it in the ${where}.`, UI.good);
    } catch (e) {
      this.say(`Couldn't copy: ${(e as { message?: string }).message ?? e}`, UI.rope);
    }
    this.busy = false;
  }

  leave(): void {
    SceneLoader.goto(this, 'dev_hub', { cursor: 7 });
  }

  private say(text: string, color: number): void {
    this.status = text;
    this.statusColor = color;
    this.refresh();
  }

  // ── Input ───────────────────────────────────────────────────────────

  update(): void {
    if (this.busy || SceneLoader.isBusy()) return;
    const n = this.list().length;
    const pick = (i: number) => {
      this.selected = i;
      if (i < this.scroll) this.scroll = i;
      if (i >= this.scroll + 19) this.scroll = i - 18;
      this.refresh();
    };
    if (n && input.justPressed('down')) pick((this.selected + 1) % n);
    else if (n && input.justPressed('up')) pick((this.selected - 1 + n) % n);
    else if (input.justPressed('right')) this.setKind(KINDS[(KINDS.indexOf(this.kind) + 1) % KINDS.length]);
    else if (input.justPressed('left'))
      this.setKind(KINDS[(KINDS.indexOf(this.kind) + KINDS.length - 1) % KINDS.length]);
    else if (input.justPressed('confirm')) this.play();
    else if (input.justPressed('cancel') || input.justPressed('menu')) this.leave();
  }

  private topButtons(): { label: string; x: number; act: () => void }[] {
    const defs: [string, () => void][] = [
      [
        this.sort === 'liked' ? 'SORT: LIKES' : 'SORT: A-Z',
        () => {
          this.sort = this.sort === 'liked' ? 'az' : 'liked';
          this.refresh();
        },
      ],
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

  private tabX(i: number): number {
    return LIST.x + 2 + i * 49;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.busy) return;
    if (p.y < TOP) {
      for (const b of this.topButtons())
        if (p.x >= b.x && p.x < b.x + b.label.length * 8 + 12) return b.act();
      return;
    }
    if (p.x < MAKERS.x + MAKERS.w) {
      const m = this.makers()[Math.floor((p.y - MAKERS.y - 18) / ROW)];
      if (m) {
        this.maker = m.owner;
        this.selected = 0;
        this.scroll = 0;
        this.refresh();
      }
      return;
    }
    if (p.x < LIST.x + LIST.w) {
      if (p.y < LIST.y + 16) {
        const i = Math.floor((p.x - LIST.x - 2) / 49);
        if (KINDS[i]) this.setKind(KINDS[i]);
        return;
      }
      const i = Math.floor((p.y - LIST.y - 20) / ROW) + this.scroll;
      if (i >= 0 && i < this.list().length) {
        if (i === this.selected) this.play();
        else {
          this.selected = i;
          this.refresh();
        }
      }
      return;
    }
    const by = CARD.y + CARD.h - 22;
    if (p.y >= by && p.y < by + 18) {
      const i = Math.floor((p.x - CARD.x - 6) / 84);
      if (i === 0) void this.like();
      else if (i === 1) this.play();
      else if (i === 2) void this.copy();
    }
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
    const tiny = (x: number, y: number, s: string, color: number = UI.inkDim) =>
      add(tinyText(this, x, y, s, css(color)).setOrigin(0).setScale(2));
    const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

    const g = add(this.add.graphics());
    g.fillStyle(UI.panel).fillRect(0, 0, W, TOP);
    g.fillStyle(UI.rope).fillRect(0, TOP - 2, W, 2);
    txt(6, 9, 'COMMUNITY GALLERY', UI.spark);
    for (const b of this.topButtons()) {
      g.fillStyle(UI.panelHi).fillRect(b.x, 4, b.label.length * 8 + 12, 17);
      txt(b.x + 6, 9, b.label);
    }

    // makers
    txt(MAKERS.x + 4, MAKERS.y + 2, 'MAKERS', UI.spark);
    this.makers().forEach((m, k) => {
      const y = MAKERS.y + 20 + k * ROW;
      const sel = m.owner === this.maker;
      if (sel) add(this.add.rectangle(MAKERS.x, y - 2, MAKERS.w, ROW, UI.panelHi).setOrigin(0));
      txt(MAKERS.x + 4, y, fit(m.label, 12), sel ? UI.spark : UI.ink);
      add(
        tinyText(this, MAKERS.x + MAKERS.w - 4, y + 1, String(m.n), css(UI.inkDim))
          .setOrigin(1, 0)
          .setScale(2),
      );
    });
    if (!this.ready) tiny(MAKERS.x + 4, MAKERS.y + MAKERS.h - 12, 'LOADING LIKES…');

    // tabs and list
    KINDS.forEach((k, i) => {
      const on = k === this.kind;
      const x = this.tabX(i);
      g.fillStyle(on ? UI.panelHi : UI.panel).fillRect(x, LIST.y, 47, 14);
      tiny(
        x + Math.round((47 - KIND_TAB[k].length * 8) / 2),
        LIST.y + 4,
        KIND_TAB[k],
        on ? UI.spark : UI.inkDim,
      );
    });
    const list = this.list();
    if (!list.length)
      txt(LIST.x + 6, LIST.y + 24, this.maker === null ? 'Nothing made yet.' : 'None of these.', UI.inkDim);
    list.slice(this.scroll, this.scroll + 19).forEach((c, k) => {
      const i = k + this.scroll;
      const y = LIST.y + 20 + k * ROW;
      const sel = i === this.selected;
      if (sel) add(this.add.rectangle(LIST.x, y - 2, LIST.w, ROW, UI.panelHi).setOrigin(0));
      txt(LIST.x + 4, y, fit(c.name, 16), sel ? UI.spark : UI.ink);
      const n = Likes.count(c.key);
      add(
        tinyText(
          this,
          LIST.x + LIST.w - 4,
          y + 1,
          n ? `${n} LIKE${n > 1 ? 'S' : ''}` : '',
          css(Likes.mine(c.key) ? UI.good : UI.inkDim),
        )
          .setOrigin(1, 0)
          .setScale(2),
      );
    });

    // card
    const c = this.current();
    if (c) this.drawCard(c, g, txt, tiny, fit);
    txt(6, H - 18, fit(this.status, 78), this.statusColor);
  }

  private drawCard(
    c: Creation,
    g: Phaser.GameObjects.Graphics,
    txt: (x: number, y: number, s: string, color?: number, size?: 8 | 16) => Phaser.GameObjects.Text,
    tiny: (x: number, y: number, s: string, color?: number) => unknown,
    fit: (s: string, n: number) => string,
  ): void {
    const x = CARD.x + 8;
    let y = CARD.y + 6;
    txt(x, y, fit(c.name.toUpperCase(), 17), UI.spark, 16);
    y += 22;
    const likes = Likes.count(c.key);
    tiny(x, y, `BY ${this.makerName(c.owner).toUpperCase()} · ${likes} LIKE${likes === 1 ? '' : 'S'}`);
    y += 14;
    const line = (s: string, color: number = UI.ink) => {
      txt(x, y, fit(s, 34), color);
      y += 12;
    };
    const gid = globalId(c.owner, c.id);
    const moveName = (id: string) =>
      Database.data.moves.some((m) => m.id === id) ? t(Database.move(id).name) : '(gone)';
    if (c.kind === 'fighter') {
      const f = c.thing as CustomFighter;
      // their look, standing on the card
      ensureLook(this, gid);
      const key = Builds.lookOf(gid)?.key;
      if (key && this.textures.exists(key)) {
        const frame = this.textures.get(key).has('idle_00') ? 'idle_00' : undefined;
        const img = this.add
          .image(CARD.x + CARD.w - 44, CARD.y + 150, key, frame)
          .setOrigin(0.5, 1)
          .setScale(2);
        if (f.kind === 'enemy') img.setFlipX(true);
        this.dyn.push(img);
      }
      line(f.kind === 'hero' ? 'HERO' : 'ENEMY', UI.grit);
      line(`HP ${f.hp}  ATK ${f.attack}  DEF ${f.defence}`);
      if (f.kind === 'hero') line(`Grit ${f.grit ?? 5}`, UI.inkDim);
      else
        line(
          `XP ${f.xp ?? 1}  Coins ${f.coins ?? 0}${f.props?.length ? `  · ${f.props.join(', ')}` : ''}`,
          UI.inkDim,
        );
      y += 4;
      line('MOVES', UI.spark);
      for (const m of f.moves.slice(0, 6)) line(`· ${moveName(m)}`);
    } else if (c.kind === 'move') {
      const m = c.thing as CustomMove;
      line(`${m.user === 'hero' ? 'HERO' : 'ENEMY'} ${m.kind.toUpperCase()}`, UI.grit);
      this.wrap(x, y, m.desc || moveSummary(m));
    } else if (c.kind === 'item') {
      const it = c.thing as CustomItem;
      line(it.kind.toUpperCase(), UI.grit);
      this.wrap(x, y, it.desc || itemSummary(it));
    } else {
      const e = c.thing as Encounter;
      const s = e.setup;
      const char = (id: string) =>
        Database.data.characters.some((ch) => ch.id === id) ? t(Database.character(id).name) : '(missing)';
      const foe = (id: string) =>
        Database.data.enemies.some((f) => f.id === id) ? t(Database.enemy(id).name) : '(missing)';
      line(`${char(s.hero)}${s.partner ? ` & ${char(s.partner)}` : ''}`, UI.grit);
      line(`vs ${s.enemies.map((o) => foe(o.id)).join(', ')}`);
      const stage = Database.data.stages.find((st) => st.id === s.stage);
      line(`Arena: ${stage ? t(stage.name) : s.stage}`, UI.inkDim);
      for (const r of conditionLines(s.conditions).slice(0, 5)) line(r, UI.grit);
      const problems = setupProblems(s);
      if (problems.length) line(`Can't be played: ${problems[0]}`, UI.rope);
    }

    const by = CARD.y + CARD.h - 22;
    const mine = this.isMine(c);
    const buttons: [string, number][] = [
      [Likes.mine(c.key) ? 'LIKED' : 'LIKE', mine ? UI.border : Likes.mine(c.key) ? UI.good : UI.ink],
      [c.kind === 'encounter' ? 'PLAY' : 'TRY', UI.ink],
      [mine ? 'DUPLICATE' : 'COPY', UI.ink],
    ];
    buttons.forEach(([label, color], i) => {
      const bx = CARD.x + 6 + i * 84;
      g.fillStyle(UI.panelHi).fillRect(bx, by, 78, 18);
      txt(bx + 6, by + 5, label, color);
    });
  }

  private wrap(x: number, y: number, s: string): void {
    this.dyn.push(
      pixelText(this, x, y, s, 8, css(UI.ink))
        .setOrigin(0, 0)
        .setWordWrapWidth(CARD.w - 18)
        .setLineSpacing(4),
    );
  }
}
