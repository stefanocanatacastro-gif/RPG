// MAKE: the Battle Maker. You build the battle on the ring itself: opponents
// stand where they'll fight, click one to move, swap or remove it, and set the
// hero, the ring and crowd, the rules and the bag from the dock below. PLAY-TEST
// fights it on the spot; beating it is the clear check that UPLOAD needs (any
// change after that needs a new clear). Uploaded battles join the Battle World.
// Fighters, items, moves and sprites open their own makers and come back here.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { UI, css } from '../ui/theme';
import { editText, textFieldOpen } from '../ui/text_field';
import { input } from '../systems/input';
import { animKey } from '../systems/anim_builder';
import { SceneLoader, type BattleEnd } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { Builds, isCustomId, type Encounter } from '../managers/builds';
import {
  finishCustomBattle,
  fightSummary,
  setupHash,
  setupProblems,
  startCustomBattle,
  type BattleSetup,
} from '../managers/custom_battle';
import {
  CROWD_DENSITY,
  CROWD_LABEL,
  CROWD_MOODS,
  CROWD_SIZES,
  HAZARDS,
  MOOD_DESC,
  MOOD_LABEL,
  cleanConditions,
} from '../battle/conditions';
import { ARENA, STAGE, drawStage, enemyXs, homeOf } from '../battle/stage';
import { fighterTexture } from '../systems/custom_looks';
import { heroSprite } from '../systems/hero_art';
import type { BattleConditions, FormationSlot } from '../types/data';
import type { BattleScene } from './battle';

const TOP = 44;
/** The ring view, above the dock. */
const VIEW = { y: TOP, h: 352 };
const DOCK = { y: VIEW.y + VIEW.h, h: H - (VIEW.y + VIEW.h) };
const MAX_FOES = 5;
const BAG_MAX = 10;
const DRAFT_KEY = 'kid-chispa.maker_draft';

type Tab = 'opponents' | 'hero' | 'ring' | 'rules' | 'bag';
type Selection = { kind: 'hero' } | { kind: 'partner' } | { kind: 'enemy'; i: number } | null;

/** The battle on the bench. */
export interface Draft {
  title: string;
  desc: string;
  setup: BattleSetup;
  /** The encounter it was saved as, if it has been. */
  encounterId?: string;
  clearedHash?: string;
  published?: string;
}

/** Kid Chispa's numbers at three points of the story (as in the showcase fights). */
const LEVELS = [
  { maxHp: 10, attack: 1, defence: 0, grit: 5 },
  { maxHp: 15, attack: 2, defence: 0, grit: 8 },
  { maxHp: 20, attack: 2, defence: 1, grit: 10 },
];

function starter(): Draft {
  return {
    title: 'My Battle',
    desc: '',
    setup: {
      hero: 'chispa',
      ...LEVELS[0],
      partner: null,
      enemies: [
        { id: 'dock_goon', slot: 'front' },
        { id: 'dock_goon', slot: 'front' },
      ],
      stage: 'arena',
      firstStrike: null,
      items: ['water_bottle'],
    },
  };
}

/** The draft survives trips to the other makers and to play-tests. */
let bench: Draft | null = null;

function saveBench(): void {
  try {
    if (bench) localStorage.setItem(DRAFT_KEY, JSON.stringify(bench));
  } catch {
    /* kept for this visit */
  }
}

function loadBench(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    return d?.setup ? d : null;
  } catch {
    return null;
  }
}

/**
 * The clear check's fingerprint: the setup and every made fighter, item and
 * move in it, so changing any of them after a clear needs a new one.
 */
export function clearKey(s: BattleSetup): string {
  const made = [
    ...[s.hero, s.partner]
      .filter((id): id is string => !!id && isCustomId(id))
      .map((id) => Database.character(id)),
    ...s.enemies.filter((e) => isCustomId(e.id)).map((e) => Database.enemy(e.id)),
    ...(s.items ?? []).filter(isCustomId).map((i) => Database.item(i)),
  ];
  const moves = made
    .flatMap((d) => ('moves' in d ? d.moves : []))
    .filter(isCustomId)
    .map((m) => Database.move(m));
  return setupHash({ ...s, made: JSON.stringify([made, moves]) } as unknown as BattleSetup);
}

export class BattleMakerScene extends Phaser.Scene {
  tab: Tab = 'opponents';
  sel: Selection = null;
  /** Clicking an opponent tile replaces the selected one instead of adding. */
  swapping = false;
  status = '';
  statusColor: number = UI.inkDim;
  /** The last play-test (the browser test reads it). */
  lastTest: { result: string; rounds: number } | null = null;
  private dockScroll = 0;
  private uiLayer!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private world: Phaser.GameObjects.GameObject[] = [];
  private hits: { x: number; y: number; w: number; h: number; act: (right: boolean) => void }[] = [];
  /** Fighters in the ring, for clicks (world coordinates). */
  private bodies: { sel: Exclude<Selection, null>; x: number; y: number; w: number; h: number }[] = [];
  private testing = false;
  private shownStage = '';

  constructor() {
    super('battle_maker');
  }

  get draft(): Draft {
    bench ??= loadBench() ?? starter();
    return bench;
  }

  create(data?: {
    edit?: string;
    remix?: { title: string; setup: BattleSetup };
    fresh?: boolean;
    keep?: boolean;
  }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    if (data?.edit) {
      const e = Builds.myEncounters().find((x) => x.id === data.edit);
      if (e)
        bench = {
          title: e.title,
          desc: e.desc ?? '',
          setup: structuredClone(e.setup),
          encounterId: e.id,
          clearedHash: e.clearedHash,
          published: e.published,
        };
    } else if (data?.remix)
      bench = { title: `${data.remix.title} (remix)`, desc: '', setup: structuredClone(data.remix.setup) };
    else if (data?.fresh) bench = starter();
    if (!data?.keep) {
      this.sel = null;
      this.swapping = false;
      this.status = this.draft.published
        ? 'Uploaded. Change anything and you’ll need to beat it again to update it.'
        : 'Click an opponent to change it, or + to add one. PLAY-TEST it, beat it, then UPLOAD.';
      this.statusColor = UI.inkDim;
    }
    this.testing = false;
    this.cameras.main.setBackgroundColor(UI.void);
    this.buildStage();
    this.uiLayer = this.add.layer().setDepth(1000);
    this.cameras.main.ignore(this.uiLayer);
    this.uiCam = this.cameras.add(0, 0, W, H).setName('ui');
    // anything not on the UI layer is the ring: the UI camera doesn't draw it
    const sortCameras = () => {
      for (const obj of this.children.list)
        if ((obj as unknown) !== this.uiLayer && !(obj.cameraFilter & this.uiCam.id)) this.uiCam.ignore(obj);
    };
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, sortCameras);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.click(p));
    this.input.mouse?.disableContextMenu();
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        if (p.y >= DOCK.y) {
          this.dockScroll = Math.max(0, this.dockScroll + (dy > 0 ? 3 : -3));
          this.refresh();
        }
      },
    );
    this.events.on(Phaser.Scenes.Events.WAKE, (_s: unknown, end: BattleEnd) => this.afterTest(end));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, sortCameras);
      this.events.off(Phaser.Scenes.Events.WAKE);
    });
    this.refresh();
  }

  /** The ring, crowd and lights of the chosen stage, framed above the dock. */
  private buildStage(): void {
    const s = this.draft.setup;
    const stage = Database.data.stages.find((st) => st.id === s.stage) ?? Database.data.stages[0];
    const size = s.conditions?.crowd;
    drawStage(
      this,
      size === 'quiet'
        ? { ...stage, crowd: Math.min(stage.crowd, CROWD_DENSITY.quiet) }
        : size === 'packed'
          ? { ...stage, crowd: CROWD_DENSITY.packed }
          : stage,
    );
    this.shownStage = `${stage.id}:${size ?? ''}`;
    const cam = this.cameras.main;
    cam.setViewport(0, VIEW.y, W, VIEW.h);
    cam.setZoom(0.86);
    cam.centerOn(ARENA.cx, STAGE.floorY - 92);
  }

  // ── Editing ─────────────────────────────────────────────────────────

  /** After every change: the clear no longer counts, and the draft is kept. */
  private changed(msg?: string): void {
    const d = this.draft;
    if (d.clearedHash && d.clearedHash !== clearKey(d.setup))
      this.say('Changed since your clear: beat it again before uploading.', UI.spark);
    else if (msg) this.say(msg);
    saveBench();
    // a new ring or crowd needs the stage drawn again
    const s = d.setup;
    if (`${s.stage}:${s.conditions?.crowd ?? ''}` !== this.shownStage)
      return void this.scene.restart({ keep: true });
    this.refresh();
  }

  private say(msg: string, color: number = UI.inkDim): void {
    this.status = msg;
    this.statusColor = color;
  }

  private cleared(): boolean {
    const d = this.draft;
    return !!d.clearedHash && d.clearedHash === clearKey(d.setup);
  }

  /** Puts an opponent in the ring (or in place of the selected one). */
  addFoe(id: string): void {
    const s = this.draft.setup;
    const slot: FormationSlot = Database.enemy(id).props.includes('airborne') ? 'air' : 'front';
    const sel = this.sel;
    if (this.swapping && sel?.kind === 'enemy') {
      s.enemies[sel.i] = { id, slot };
      this.swapping = false;
      return this.changed(`Swapped in ${t(Database.enemy(id).name)}.`);
    }
    if (s.enemies.length >= MAX_FOES)
      return void (this.say(`The ring holds ${MAX_FOES} opponents at most.`, UI.rope), this.refresh());
    s.enemies.push({ id, slot });
    this.sel = { kind: 'enemy', i: s.enemies.length - 1 };
    this.changed(`${t(Database.enemy(id).name)} steps into the ring.`);
  }

  private removeFoe(i: number): void {
    this.draft.setup.enemies.splice(i, 1);
    this.sel = null;
    this.changed();
  }

  private moveFoe(i: number, d: number): void {
    const list = this.draft.setup.enemies;
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.sel = { kind: 'enemy', i: j };
    this.changed();
  }

  private setConditions(c: BattleConditions): void {
    this.draft.setup.conditions = cleanConditions(c);
    this.changed();
  }

  async rename(): Promise<void> {
    const v = await editText(this, {
      x: 214,
      y: 12,
      w: 300,
      value: this.draft.title,
      placeholder: 'Battle name',
    });
    if (v === null) return;
    this.draft.title = v.trim().slice(0, 32) || this.draft.title;
    saveBench();
    this.refresh();
  }

  /** Fights it now. Winning is the clear check. */
  playTest(): void {
    const s = this.draft.setup;
    const problems = setupProblems(s);
    if (!s.enemies.length) problems.unshift('it needs at least one opponent');
    if (problems.length)
      return void (this.say(`Can't play it yet: ${problems[0]}.`, UI.rope), this.refresh());
    this.testing = true;
    saveBench();
    startCustomBattle(this, s, 'battle_maker');
  }

  private afterTest(end: BattleEnd): void {
    if (!this.testing) return;
    this.testing = false;
    const battle = (this.scene.get('battle') as BattleScene).engine;
    finishCustomBattle();
    const r = fightSummary(battle);
    this.lastTest = { result: end.result, rounds: r.rounds };
    const d = this.draft;
    if (end.result === 'win') {
      d.clearedHash = clearKey(d.setup);
      saveBench();
      this.say(
        d.published
          ? `Cleared in ${r.rounds} rounds. UPLOAD to update it in the Battle World.`
          : `Cleared in ${r.rounds} rounds! Now you can UPLOAD it.`,
        UI.good,
      );
    } else
      this.say(
        end.result === 'run'
          ? 'You ran away. Beat it to clear it.'
          : `Knocked out in round ${r.rounds}. Beat it to clear it (or make it fairer).`,
        UI.rope,
      );
    this.refresh();
  }

  /** Saves the battle to your set (uploaded ones stay uploaded only while still cleared). */
  async save(publish = false): Promise<boolean> {
    const d = this.draft;
    const list = Builds.myEncounters();
    if (!d.encounterId) {
      const ids = new Set(list.map((e) => e.id));
      let n = 1;
      while (ids.has(`b${n}`)) n++;
      d.encounterId = `b${n}`;
    }
    const cleared = this.cleared();
    const enc: Encounter = {
      id: d.encounterId,
      title: d.title,
      setup: structuredClone(d.setup),
      savedAt: new Date().toISOString(),
      ...(d.desc ? { desc: d.desc } : {}),
      ...(cleared ? { clearedHash: d.clearedHash } : {}),
      ...(publish
        ? { published: new Date().toISOString() }
        : d.published && cleared
          ? { published: d.published }
          : {}),
    };
    if (!enc.published) delete d.published;
    else d.published = enc.published;
    const i = list.findIndex((e) => e.id === enc.id);
    if (i >= 0) list[i] = enc;
    else list.push(enc);
    try {
      await Builds.saveMine({ encounters: list });
      saveBench();
      return true;
    } catch (e) {
      this.say(`Not saved: ${String((e as { message?: string }).message ?? e)}`, UI.rope);
      this.refresh();
      return false;
    }
  }

  async saveDraft(): Promise<void> {
    if (await this.save(false)) {
      this.say(
        this.draft.published
          ? 'Saved (still uploaded).'
          : 'Saved to your battles (a draft until you upload it).',
        UI.good,
      );
      this.refresh();
    }
  }

  /** The clear check, a name and a line for players, then into the Battle World. */
  async upload(): Promise<void> {
    if (!this.cleared()) {
      this.say(
        'Clear check: beat your battle in a PLAY-TEST first, so everyone knows it can be won.',
        UI.rope,
      );
      return this.refresh();
    }
    const title = await editText(this, {
      x: 214,
      y: 12,
      w: 300,
      value: this.draft.title,
      placeholder: 'Battle name',
    });
    if (title === null) return;
    this.draft.title = title.trim().slice(0, 32) || this.draft.title;
    const desc = await editText(this, {
      x: 214,
      y: 12,
      w: 520,
      value: this.draft.desc,
      placeholder: 'One line for players: what makes it special? (optional)',
    });
    if (desc !== null) this.draft.desc = desc.trim().slice(0, 140);
    if (await this.save(true)) {
      this.say(`"${this.draft.title}" is in the Battle World!`, UI.good);
      this.refresh();
    }
  }

  newBattle(): void {
    bench = starter();
    saveBench();
    this.sel = null;
    this.scene.restart({ keep: true });
  }

  private toTool(scene: string, data: object = {}): void {
    saveBench();
    SceneLoader.goto(this, scene, { from: 'battle_maker', ...data });
  }

  // ── Input ───────────────────────────────────────────────────────────

  private click(p: Phaser.Input.Pointer): void {
    if (textFieldOpen || this.testing) return;
    const right = p.rightButtonDown();
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h) return h.act(right);
    }
    if (p.y >= VIEW.y && p.y < VIEW.y + VIEW.h) {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      // front-most first
      for (let i = this.bodies.length - 1; i >= 0; i--) {
        const b = this.bodies[i];
        if (wp.x >= b.x && wp.x < b.x + b.w && wp.y >= b.y && wp.y < b.y + b.h) {
          this.sel = b.sel;
          this.swapping = false;
          this.tab = b.sel.kind === 'enemy' ? 'opponents' : 'hero';
          return this.refresh();
        }
      }
      this.sel = null;
      this.swapping = false;
      this.refresh();
    }
  }

  update(): void {
    if (this.testing || textFieldOpen || SceneLoader.isBusy()) return;
    if (input.justPressed('cancel') || input.justPressed('menu')) {
      if (this.sel) {
        this.sel = null;
        this.swapping = false;
        return this.refresh();
      }
      return void SceneLoader.goto(this, 'title');
    }
    const sel = this.sel;
    if (sel?.kind === 'enemy') {
      if (input.justPressed('left')) this.moveFoe(sel.i, -1);
      else if (input.justPressed('right')) this.moveFoe(sel.i, 1);
    }
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  refresh(): void {
    for (const o of this.dyn) o.destroy();
    for (const o of this.world) o.destroy();
    this.dyn = [];
    this.world = [];
    this.hits = [];
    this.drawRing();
    this.drawTop();
    this.drawDock();
  }

  private ui<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.uiLayer.add(o);
    this.dyn.push(o);
    return o;
  }

  private txt(
    x: number,
    y: number,
    s: string,
    color: number = UI.ink,
    size: 8 | 16 | 24 = 8,
  ): Phaser.GameObjects.Text {
    return this.ui(pixelText(this, x, y, s, size, css(color)).setOrigin(0, 0));
  }

  private button(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    label: string,
    act: (right: boolean) => void,
    o: { hot?: boolean; color?: number; w?: number; dim?: boolean } = {},
  ): number {
    const w = o.w ?? label.length * 8 + 18;
    g.fillStyle(o.hot ? 0x5a3a10 : (o.color ?? UI.panelHi)).fillRect(x, y, w, 24);
    if (o.hot) g.lineStyle(2, UI.spark).strokeRect(x, y, w, 24);
    this.txt(x + w / 2, y + 8, label, o.dim ? UI.border : o.hot ? UI.spark : UI.ink).setOrigin(0.5, 0);
    this.hits.push({ x, y, w, h: 24, act });
    return w;
  }

  /** The fighters where they'll stand, the selected one marked, and a + for the next opponent. */
  private drawRing(): void {
    this.bodies = [];
    const s = this.draft.setup;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.world.push(o);
      return o;
    };
    const place = (sel: Exclude<Selection, null>, id: string, enemy: boolean, x: number, y: number) => {
      const known = enemy
        ? Database.data.enemies.some((d) => d.id === id)
        : Database.data.characters.some((d) => d.id === id);
      if (!known) return;
      const def = enemy ? Database.enemy(id) : Database.character(id);
      const look = fighterTexture(this, id, id === 'chispa' ? heroSprite(this) : def.sprite);
      if (!this.textures.exists(look.key)) return;
      const animated = this.anims.exists(animKey(look.key, 'idle'));
      const sp = add(
        this.add
          .sprite(x, y, look.key, animated ? 'idle_00' : undefined)
          .setOrigin(0.5, 1)
          .setDepth(10),
      );
      if (animated) sp.play(animKey(look.key, 'idle'));
      const size = enemy ? (Database.enemy(id).size ?? 'normal') : 'normal';
      if (!look.ownSize && size !== 'normal') sp.setScale(size === 'huge' ? 2 : 1.5);
      if (enemy && animated) sp.setFlipX(true);
      add(
        this.add.ellipse(x, STAGE.floorY, Math.max(60, sp.displayWidth * 0.8), 12, 0x000000, 0.3).setDepth(5),
      );
      const b = sp.getBounds();
      this.bodies.push({ sel, x: b.x, y: b.y, w: b.width, h: b.height });
      const isSel = JSON.stringify(sel) === JSON.stringify(this.sel);
      if (isSel) {
        const g = add(this.add.graphics().setDepth(20));
        g.lineStyle(3, UI.spark, 1).strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
        // a little arrow over the selected one
        g.fillStyle(UI.spark).fillTriangle(x - 9, b.y - 22, x + 9, b.y - 22, x, b.y - 10);
      }
    };
    place({ kind: 'hero' }, s.hero, false, homeOf('hero', 0, false).x, homeOf('hero', 0, false).y);
    if (s.partner)
      place({ kind: 'partner' }, s.partner, false, homeOf('hero', 1, false).x, homeOf('hero', 1, false).y);
    const sizes = s.enemies.map((e) =>
      Database.data.enemies.some((d) => d.id === e.id) ? (Database.enemy(e.id).size ?? 'normal') : 'normal',
    );
    const xs = enemyXs(sizes);
    s.enemies.forEach((e, i) => {
      const air =
        Database.data.enemies.some((d) => d.id === e.id) &&
        (Database.enemy(e.id).props.includes('airborne') || e.slot === 'air');
      const h = homeOf('enemy', i, air, xs[i]);
      place({ kind: 'enemy', i }, e.id, true, h.x, h.y);
    });
    // a ghost spot for the next opponent
    if (s.enemies.length < MAX_FOES) {
      const nx = enemyXs([...sizes, 'normal'])[s.enemies.length];
      const h = homeOf('enemy', s.enemies.length, false, nx);
      const g = add(this.add.graphics().setDepth(30));
      g.lineStyle(2, UI.spark, 0.8);
      const bx = h.x - 30;
      const by = h.y - 96;
      for (let k = 0; k < 96; k += 8) {
        g.lineBetween(bx, by + k, bx, by + k + 4);
        g.lineBetween(bx + 60, by + k, bx + 60, by + k + 4);
      }
      for (let k = 0; k < 60; k += 8) {
        g.lineBetween(bx + k, by, bx + k + 4, by);
        g.lineBetween(bx + k, by + 96, bx + k + 4, by + 96);
      }
      add(
        pixelText(this, h.x, by + 34, '+', 32, css(UI.spark))
          .setOrigin(0.5, 0)
          .setDepth(30),
      );
      this.bodies.push({ sel: { kind: 'enemy', i: s.enemies.length }, x: bx, y: by, w: 60, h: 96 });
    }
  }

  private drawTop(): void {
    const d = this.draft;
    const g = this.ui(this.add.graphics());
    g.fillStyle(UI.panel).fillRect(0, 0, W, TOP);
    g.fillStyle(UI.rope).fillRect(0, TOP - 2, W, 2);
    this.txt(12, 10, 'MAKE', UI.spark, 24);
    // the battle's name: click to rename
    const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    g.fillStyle(UI.panelHi).fillRect(108, 9, 250, 26);
    this.txt(116, 18, fit(d.title, 28), 0x9fd8ff);
    this.hits.push({ x: 108, y: 9, w: 250, h: 26, act: () => void this.rename() });
    // where it stands: draft / cleared / uploaded
    const cleared = this.cleared();
    const badge = d.published && cleared ? 'UPLOADED' : cleared ? 'CLEARED' : 'NOT CLEARED';
    const bc = d.published && cleared ? UI.grit : cleared ? UI.good : UI.border;
    g.fillStyle(bc, 0.9).fillRect(368, 14, badge.length * 8 + 12, 16);
    this.txt(374, 18, badge, 0x0b0910);
    let x = W - 8;
    const defs: [string, () => void, { hot?: boolean; color?: number }][] = [
      ['NEW', () => this.newBattle(), {}],
      ['SAVE', () => void this.saveDraft(), {}],
      ['PLAY-TEST', () => this.playTest(), { color: 0x2a4a20 }],
      ['UPLOAD', () => void this.upload(), { hot: cleared && !d.published }],
      ['BACK', () => void SceneLoader.goto(this, 'title'), {}],
    ];
    const widths = defs.map(([l]) => l.length * 8 + 18);
    x -= widths.reduce((a, b) => a + b + 6, 0);
    defs.forEach(([l, act, o], i) => {
      this.button(g, x, 10, l, act, o);
      x += widths[i] + 6;
    });

    // the selected fighter's own little toolbar, over the ring
    const sel = this.sel;
    const s = d.setup;
    if (sel?.kind === 'enemy' && sel.i < s.enemies.length) {
      const e = s.enemies[sel.i];
      const def = Database.data.enemies.find((x) => x.id === e.id);
      const pg = this.ui(this.add.graphics());
      drawPanel(pg, 8, TOP + 8, 300, 76, { alpha: 0.95 });
      this.txt(18, TOP + 16, fit((def ? t(def.name) : e.id).toUpperCase(), 28), UI.spark);
      if (def)
        this.txt(
          18,
          TOP + 32,
          `HP ${def.hp} ATK ${def.attack} DEF ${def.defence}${def.size && def.size !== 'normal' ? ` · ${def.size.toUpperCase()}` : ''}${def.props.length ? ` · ${def.props.join(' ')}` : ''}`,
          UI.inkDim,
        );
      let bx = 16;
      const by = TOP + 52;
      bx += this.button(pg, bx, by, '<', () => this.moveFoe(sel.i, -1), { w: 26 }) + 4;
      bx += this.button(pg, bx, by, '>', () => this.moveFoe(sel.i, 1), { w: 26 }) + 6;
      bx +=
        this.button(
          pg,
          bx,
          by,
          'SWAP',
          () => (
            (this.swapping = true),
            (this.tab = 'opponents'),
            this.say('Pick who takes this spot.'),
            this.refresh()
          ),
          { hot: this.swapping },
        ) + 4;
      bx += this.button(pg, bx, by, 'EDIT', () => this.editFighter(e.id)) + 4;
      this.button(pg, bx, by, 'REMOVE', () => this.removeFoe(sel.i), { color: 0x3a1018 });
    } else if (sel?.kind === 'enemy') {
      // the + spot
      this.tab = 'opponents';
    }
  }

  /** Your own fighters open in the fighter maker; built-in ones are copied there first. */
  private editFighter(id: string): void {
    if (isCustomId(id) && Builds.mine().some((f) => `c.${id.split('.')[1]}.${f.id}` === id))
      return this.toTool('fighter_maker', { select: id });
    this.say('Built-in and community fighters: COPY them in the fighter maker, then swap your copy in.');
    this.toTool('fighter_maker');
  }

  private drawDock(): void {
    const g = this.ui(this.add.graphics());
    drawPanel(g, 0, DOCK.y, W, DOCK.h, { alpha: 1 });
    const tabs: [Tab, string][] = [
      ['opponents', 'OPPONENTS'],
      ['hero', 'HERO'],
      ['ring', 'RING & CROWD'],
      ['rules', 'RULES'],
      ['bag', 'BAG'],
    ];
    let x = 10;
    for (const [tab, label] of tabs)
      x +=
        this.button(
          g,
          x,
          DOCK.y + 8,
          label,
          () => (
            (this.tab = tab),
            (this.dockScroll = 0),
            (this.swapping = tab === 'opponents' && this.swapping),
            this.refresh()
          ),
          {
            hot: this.tab === tab,
          },
        ) + 6;
    // status line on the dock's top right
    this.ui(
      pixelText(this, x + 10, DOCK.y + 9, this.status, 8, css(this.statusColor))
        .setOrigin(0, 0)
        .setWordWrapWidth(W - x - 24)
        .setLineSpacing(3),
    );
    const area = { x: 10, y: DOCK.y + 40, w: W - 20, h: DOCK.h - 48 };
    if (this.tab === 'opponents') this.dockOpponents(g, area);
    else if (this.tab === 'hero') this.dockHero(g, area);
    else if (this.tab === 'ring') this.dockRing(g, area);
    else if (this.tab === 'rules') this.dockRules(g, area);
    else this.dockBag(g, area);
  }

  /** A row of tiles that scrolls sideways (wheel or arrows). */
  private tiles<T>(
    g: Phaser.GameObjects.Graphics,
    area: { x: number; y: number; w: number; h: number },
    list: T[],
    tw: number,
    draw: (item: T, x: number, y: number) => void,
    act: (item: T, right: boolean) => void,
  ): void {
    const per = Math.floor((area.w - 60) / (tw + 6));
    const max = Math.max(0, list.length - per);
    this.dockScroll = Math.min(this.dockScroll, max);
    const shown = list.slice(this.dockScroll, this.dockScroll + per);
    shown.forEach((item, i) => {
      const x = area.x + 26 + i * (tw + 6);
      g.fillStyle(UI.panelHi).fillRect(x, area.y, tw, area.h);
      draw(item, x, area.y);
      this.hits.push({ x, y: area.y, w: tw, h: area.h, act: (r) => act(item, r) });
    });
    if (this.dockScroll > 0)
      this.button(
        g,
        area.x,
        area.y + area.h / 2 - 12,
        '<',
        () => ((this.dockScroll = Math.max(0, this.dockScroll - per)), this.refresh()),
        { w: 20 },
      );
    if (this.dockScroll < max)
      this.button(
        g,
        area.x + area.w - 20,
        area.y + area.h / 2 - 12,
        '>',
        () => ((this.dockScroll = Math.min(max, this.dockScroll + per)), this.refresh()),
        { w: 20 },
      );
  }

  /** A fighter's picture on a tile, standing on its bottom. */
  private tileSprite(id: string, enemy: boolean, x: number, y: number, w: number, h: number): void {
    const def = enemy ? Database.enemy(id) : Database.character(id);
    const tex = fighterTexture(this, id, id === 'chispa' ? heroSprite(this) : def.sprite).key;
    if (!this.textures.exists(tex)) return;
    const animated = this.anims.exists(animKey(tex, 'idle'));
    const sp = this.ui(
      this.add.sprite(x + w / 2, y + h, tex, animated ? 'idle_00' : undefined).setOrigin(0.5, 1),
    );
    sp.setScale(Math.min(1, (h - 4) / sp.height, (w - 6) / sp.width));
    if (enemy && animated) sp.setFlipX(true);
  }

  private dockOpponents(
    g: Phaser.GameObjects.Graphics,
    area: { x: number; y: number; w: number; h: number },
  ): void {
    type Tile = { id: string; head?: string } | { tool: 'fighter' | 'sprites' };
    const foes = Database.data.enemies;
    const list: Tile[] = [
      { tool: 'fighter' },
      ...foes.filter((e) => !isCustomId(e.id)).map((e) => ({ id: e.id })),
      ...foes.filter((e) => isCustomId(e.id)).map((e) => ({ id: e.id })),
      { tool: 'sprites' },
    ];
    this.tiles(
      g,
      area,
      list,
      78,
      (tile, x, y) => {
        if ('tool' in tile) {
          this.txt(x + 39, y + 22, tile.tool === 'fighter' ? '+' : '*', UI.spark, 24).setOrigin(0.5, 0);
          this.txt(x + 39, y + 58, tile.tool === 'fighter' ? 'NEW' : 'SPRITES', UI.ink).setOrigin(0.5, 0);
          this.txt(x + 39, y + 70, tile.tool === 'fighter' ? 'FIGHTER' : '', UI.ink).setOrigin(0.5, 0);
          return;
        }
        this.tileSprite(tile.id, true, x, y + 2, 78, area.h - 22);
        const name = t(Database.enemy(tile.id).name);
        this.txt(
          x + 39,
          y + area.h - 14,
          name.length > 9 ? `${name.slice(0, 8)}…` : name,
          isCustomId(tile.id) ? 0x9fd8ff : UI.ink,
        ).setOrigin(0.5, 0);
      },
      (tile) => {
        if ('tool' in tile) return this.toTool(tile.tool === 'fighter' ? 'fighter_maker' : 'sprite_studio');
        this.addFoe(tile.id);
      },
    );
  }

  private dockHero(
    g: Phaser.GameObjects.Graphics,
    area: { x: number; y: number; w: number; h: number },
  ): void {
    const s = this.draft.setup;
    const heroes = Database.data.characters;
    // who you play, and who has your back
    this.txt(area.x, area.y, 'YOU PLAY', UI.spark);
    heroes.slice(0, 6).forEach((c, i) => {
      const x = area.x + i * 70;
      const y = area.y + 14;
      g.fillStyle(s.hero === c.id ? 0x5a3a10 : UI.panelHi).fillRect(x, y, 64, 70);
      if (s.hero === c.id) g.lineStyle(2, UI.spark).strokeRect(x, y, 64, 70);
      this.tileSprite(c.id, false, x, y, 64, 58);
      this.txt(x + 32, y + 58, t(c.name).slice(0, 7), UI.ink).setOrigin(0.5, 0);
      this.hits.push({
        x,
        y,
        w: 64,
        h: 70,
        act: () => {
          s.hero = c.id;
          if (s.partner === c.id) s.partner = null;
          if (c.id !== 'chispa')
            Object.assign(s, { maxHp: c.hp, attack: c.attack, defence: c.defence, grit: c.grit });
          this.changed();
        },
      });
    });
    const col = area.x + Math.min(6, heroes.length) * 70 + 16;
    this.txt(col, area.y, 'STRENGTH', UI.spark);
    let bx = col;
    LEVELS.forEach((l, i) => {
      const on = s.maxHp === l.maxHp && s.attack === l.attack && s.defence === l.defence && s.grit === l.grit;
      bx +=
        this.button(g, bx, area.y + 14, `LV ${i + 1}`, () => (Object.assign(s, l), this.changed()), {
          hot: on,
        }) + 4;
    });
    const stat = (
      label: string,
      key: 'maxHp' | 'attack' | 'defence' | 'grit',
      min: number,
      max: number,
      x: number,
      y: number,
    ) => {
      this.txt(x, y + 8, label, UI.inkDim);
      this.button(g, x + 40, y, '-', () => ((s[key] = Math.max(min, s[key] - 1)), this.changed()), { w: 22 });
      this.txt(x + 74, y + 8, String(s[key]), UI.ink).setOrigin(0.5, 0);
      this.button(g, x + 88, y, '+', () => ((s[key] = Math.min(max, s[key] + 1)), this.changed()), { w: 22 });
    };
    stat('HP', 'maxHp', 1, 99, col, area.y + 44);
    stat('ATK', 'attack', 0, 20, col + 120, area.y + 44);
    stat('DEF', 'defence', 0, 20, col, area.y + 72);
    stat('GRIT', 'grit', 0, 30, col + 120, area.y + 72);
    const pc = col + 260;
    this.txt(pc, area.y, 'PARTNER', UI.spark);
    const partners = [null, ...heroes.filter((c) => c.id !== s.hero).map((c) => c.id)];
    const label = (id: string | null) => (id ? t(Database.character(id).name) : 'nobody');
    this.button(
      g,
      pc,
      area.y + 14,
      label(s.partner),
      () => {
        s.partner = partners[(partners.indexOf(s.partner) + 1) % partners.length];
        this.changed();
      },
      { w: 150 },
    );
    this.txt(pc, area.y + 48, 'WHO HITS FIRST', UI.spark);
    const fs: BattleSetup['firstStrike'][] = [null, 'player', 'enemy'];
    const fl = { null: 'nobody', player: 'you', enemy: 'they ambush' } as Record<string, string>;
    this.button(
      g,
      pc,
      area.y + 62,
      fl[String(s.firstStrike)],
      () => {
        s.firstStrike = fs[(fs.indexOf(s.firstStrike) + 1) % fs.length];
        this.changed();
      },
      { w: 150 },
    );
  }

  private dockRing(
    g: Phaser.GameObjects.Graphics,
    area: { x: number; y: number; w: number; h: number },
  ): void {
    const s = this.draft.setup;
    this.txt(area.x, area.y, 'RING', UI.spark);
    Database.data.stages.forEach((st, i) => {
      const x = area.x + i * 150;
      const y = area.y + 14;
      const on = s.stage === st.id;
      g.fillStyle(on ? 0x5a3a10 : UI.panelHi).fillRect(x, y, 142, 70);
      if (on) g.lineStyle(2, UI.spark).strokeRect(x, y, 142, 70);
      // the stage's colours: sky, crowd, apron, canvas
      const cols = [st.sky[3], st.rows[3], st.apron[0], st.canvas[1]].map((c) => parseInt(c.slice(1), 16));
      cols.forEach((c, k) => g.fillStyle(c).fillRect(x + 8, y + 8 + k * 9, 126, 9));
      this.txt(x + 71, y + 52, t(st.name).slice(0, 16), UI.ink).setOrigin(0.5, 0);
      this.hits.push({ x, y, w: 142, h: 70, act: () => ((s.stage = st.id), this.changed()) });
    });
    const cx = area.x + Database.data.stages.length * 150 + 12;
    const c = s.conditions ?? {};
    this.txt(cx, area.y, 'CROWD', UI.spark);
    let bx = cx;
    for (const size of CROWD_SIZES)
      bx +=
        this.button(
          g,
          bx,
          area.y + 14,
          CROWD_LABEL[size].toUpperCase(),
          () => this.setConditions({ ...c, crowd: size }),
          { hot: (c.crowd ?? 'normal') === size },
        ) + 4;
    this.txt(cx, area.y + 46, 'ON WHOSE SIDE', UI.spark);
    bx = cx;
    for (const mood of CROWD_MOODS)
      bx +=
        this.button(
          g,
          bx,
          area.y + 60,
          MOOD_LABEL[mood].toUpperCase(),
          () => this.setConditions({ ...c, mood }),
          { hot: (c.mood ?? 'fair') === mood },
        ) + 4;
    this.txt(cx, area.y + 90, MOOD_DESC[c.mood ?? 'fair'], UI.inkDim);
  }

  private dockRules(
    g: Phaser.GameObjects.Graphics,
    area: { x: number; y: number; w: number; h: number },
  ): void {
    const c = this.draft.setup.conditions ?? {};
    this.txt(area.x, area.y, 'HAZARDS', UI.spark);
    HAZARDS.forEach((h, i) => {
      const on = (c.hazards ?? []).includes(h.id);
      const x = area.x + (i % 2) * 180;
      const y = area.y + 14 + Math.floor(i / 2) * 30;
      this.button(
        g,
        x,
        y,
        h.short.toUpperCase(),
        () => {
          const list = new Set(c.hazards ?? []);
          if (on) list.delete(h.id);
          else list.add(h.id);
          this.setConditions({ ...c, hazards: [...list] });
        },
        { hot: on, w: 172 },
      );
    });
    const gx = area.x + 380;
    this.txt(gx, area.y, 'GOAL', UI.spark);
    const goals: [NonNullable<BattleConditions['goal']>, string][] = [
      ['ko', 'KNOCK OUT ALL'],
      ['timed', 'WIN WITHIN'],
      ['survive', 'SURVIVE'],
    ];
    let bx = gx;
    for (const [goal, label] of goals)
      bx +=
        this.button(
          g,
          bx,
          area.y + 14,
          label,
          () => this.setConditions({ ...c, goal, rounds: goal === 'ko' ? undefined : (c.rounds ?? 4) }),
          { hot: (c.goal ?? 'ko') === goal },
        ) + 4;
    if (c.goal && c.goal !== 'ko') {
      this.txt(gx, area.y + 52, 'ROUNDS', UI.inkDim);
      this.button(
        g,
        gx + 60,
        area.y + 44,
        '-',
        () => this.setConditions({ ...c, rounds: Math.max(1, (c.rounds ?? 4) - 1) }),
        { w: 22 },
      );
      this.txt(gx + 98, area.y + 52, String(c.rounds ?? 4), UI.ink).setOrigin(0.5, 0);
      this.button(
        g,
        gx + 112,
        area.y + 44,
        '+',
        () => this.setConditions({ ...c, rounds: Math.min(20, (c.rounds ?? 4) + 1) }),
        { w: 22 },
      );
    }
    this.txt(gx, area.y + 78, 'HOUSE RULES', UI.spark);
    bx = gx + 110;
    bx +=
      this.button(g, bx, area.y + 70, 'NO ITEMS', () => this.setConditions({ ...c, noItems: !c.noItems }), {
        hot: !!c.noItems,
      }) + 4;
    this.button(g, bx, area.y + 70, 'NO RUNNING', () => this.setConditions({ ...c, noRun: !c.noRun }), {
      hot: !!c.noRun,
    });
  }

  private dockBag(
    g: Phaser.GameObjects.Graphics,
    area: { x: number; y: number; w: number; h: number },
  ): void {
    const s = this.draft.setup;
    const bag = s.items ?? [];
    this.txt(
      area.x,
      area.y - 0,
      `BAG ${bag.length}/${BAG_MAX} · click to add, right-click to take one out`,
      UI.inkDim,
    );
    type Tile = { id: string } | { tool: 'item' | 'move' };
    const list: Tile[] = [
      { tool: 'item' },
      { tool: 'move' },
      ...Database.data.items.map((it) => ({ id: it.id })),
    ];
    this.tiles(
      g,
      { ...area, y: area.y + 14, h: area.h - 14 },
      list,
      96,
      (tile, x, y) => {
        if ('tool' in tile) {
          this.txt(x + 48, y + 14, '+', UI.spark, 24).setOrigin(0.5, 0);
          this.txt(x + 48, y + 46, tile.tool === 'item' ? 'NEW ITEM' : 'NEW MOVE', UI.ink).setOrigin(0.5, 0);
          return;
        }
        const def = Database.item(tile.id);
        const n = bag.filter((b) => b === tile.id).length;
        const color = (def as { color?: number }).color ?? 0x9fd8ff;
        g.fillStyle(color).fillRect(x + 36, y + 10, 24, 24);
        g.lineStyle(2, 0x0b0910).strokeRect(x + 36, y + 10, 24, 24);
        const name = t(def.name);
        this.txt(
          x + 48,
          y + 42,
          name.length > 11 ? `${name.slice(0, 10)}…` : name,
          isCustomId(tile.id) ? 0x9fd8ff : UI.ink,
        ).setOrigin(0.5, 0);
        if (n) this.txt(x + 48, y + 56, `x${n}`, UI.spark, 16).setOrigin(0.5, 0);
      },
      (tile, right) => {
        if ('tool' in tile) return this.toTool(tile.tool === 'item' ? 'item_maker' : 'move_maker');
        const list = [...(s.items ?? [])];
        if (right) {
          const i = list.lastIndexOf(tile.id);
          if (i >= 0) list.splice(i, 1);
        } else if (list.length < BAG_MAX) list.push(tile.id);
        else this.say(`The bag holds ${BAG_MAX} items.`, UI.rope);
        s.items = list;
        this.changed();
      },
    );
  }
}
