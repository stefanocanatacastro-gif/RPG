// Encounters (step 2 of the battle builder): saved fights to play. Yours and the
// community's come from the fighter store (made in the sandbox with "Save as…");
// the built-in test line-ups are always here. PLAY fights it for real (your
// save is never touched), ODDS asks the simulator, EDIT opens it in the sandbox,
// and your wins and best round count are kept per encounter.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { editText, textFieldOpen } from '../ui/text_field';
import { SceneLoader, type BattleEnd } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { input } from '../systems/input';
import { Builds, encounterKey, myOwnerId, type Encounter } from '../managers/builds';
import {
  startCustomBattle,
  finishCustomBattle,
  fightSummary,
  setupProblems,
  simSetupOf,
  type BattleSetup,
} from '../managers/custom_battle';
import { simulate, SKILLS } from '../battle/simulate';
import { Rng } from '../systems/rng';
import type { BattleScene } from './battle';

const TOP = 26;
const LIST = { x: 4, y: TOP + 4, w: 220, h: H - TOP - 26 };
const CARD = { x: LIST.x + LIST.w + 6, y: TOP + 4, w: W - (LIST.x + LIST.w + 6) - 4, h: H - TOP - 26 };
const ROW = 13;
const RECORDS_KEY = 'kid-chispa.records';

interface Entry {
  key: string;
  title: string;
  setup: BattleSetup;
  from: 'mine' | 'community' | 'builtin';
  /** Yours: the encounter's id in your set. */
  id?: string;
}

interface PlayRecord {
  plays: number;
  wins: number;
  best?: number;
}

function readRecords(): { [key: string]: PlayRecord } {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeRecords(r: { [key: string]: PlayRecord }): void {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
  } catch {
    /* records last for this visit */
  }
}

/** A built-in test line-up as an encounter, fought by Kid Chispa at his starting numbers. */
function builtinSetup(formation: string): BattleSetup {
  const f = Database.formation(formation);
  const c = Database.character('chispa');
  return {
    hero: c.id,
    maxHp: c.hp,
    attack: c.attack,
    defence: c.defence,
    grit: c.grit,
    partner: null,
    enemies: f.enemies.map((e) => ({ id: e.enemy, slot: e.slot })),
    stage: f.stage,
    firstStrike: null,
  };
}

export class EncountersScene extends Phaser.Scene {
  selected = 0;
  private scroll = 0;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private message = '';
  private messageColor: number = UI.inkDim;
  /** Simulator odds for the selected encounter, once asked for. */
  private odds: { key: string; text: string } | null = null;
  private playing: Entry | null = null;
  private busy = false;
  /** For the browser test. */
  lastResult: { key: string; result: string; rounds: number } | null = null;

  constructor() {
    super('encounters');
  }

  create(data?: { select?: string }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.busy = false;
    this.odds = null;
    this.message = '';
    this.cameras.main.setBackgroundColor(UI.void);
    const frame = this.add.graphics();
    for (const r of [LIST, CARD]) drawPanel(frame, r.x - 2, r.y - 2, r.w + 4, r.h + 4, { alpha: 1 });
    const entries = this.entries();
    this.selected = Math.max(
      0,
      entries.findIndex((e) => e.key === data?.select),
    );
    if (!data?.select)
      this.selected = Math.max(
        0,
        entries.findIndex((e) => e.from === 'mine'),
      );

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.scroll = Phaser.Math.Clamp(
          this.scroll + (dy > 0 ? 3 : -3),
          0,
          Math.max(0, this.rows().length - this.visible()),
        );
        this.refresh();
      },
    );
    this.events.on(Phaser.Scenes.Events.WAKE, (_s: unknown, end: BattleEnd) => this.afterFight(end));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.WAKE));
    this.refresh();
  }

  update(): void {
    if (this.busy || textFieldOpen || SceneLoader.isBusy()) return;
    const n = this.entries().length;
    if (input.justPressed('down')) this.select((this.selected + 1) % n);
    else if (input.justPressed('up')) this.select((this.selected - 1 + n) % n);
    else if (input.justPressed('confirm')) this.play();
    else if (input.justPressed('cancel') || input.justPressed('menu')) this.leave();
  }

  // ── Data ────────────────────────────────────────────────────────────

  entries(): Entry[] {
    const out: Entry[] = [];
    for (const e of Builds.myEncounters())
      out.push({
        key: encounterKey(myOwnerId(), e.id),
        title: e.title,
        setup: e.setup,
        from: 'mine',
        id: e.id,
      });
    for (const o of Builds.otherEncounters())
      out.push({
        key: encounterKey(o.owner, o.encounter.id),
        title: o.encounter.title,
        setup: o.encounter.setup,
        from: 'community',
      });
    for (const f of Database.data.formations)
      out.push({
        key: `test:${f.id}`,
        title: f.id.replace(/_/g, ' '),
        setup: builtinSetup(f.id),
        from: 'builtin',
      });
    return out;
  }

  /** List rows with section headings. */
  private rows(): { label: string; entry?: number; head?: boolean }[] {
    const es = this.entries();
    const out: { label: string; entry?: number; head?: boolean }[] = [];
    const section = (from: Entry['from'], label: string, empty?: string) => {
      out.push({ label, head: true });
      let any = false;
      es.forEach((e, i) => {
        if (e.from === from) {
          out.push({ label: e.title, entry: i });
          any = true;
        }
      });
      if (!any && empty) out.push({ label: empty });
    };
    section('mine', 'YOURS', '(save one from the sandbox)');
    if (es.some((e) => e.from === 'community')) section('community', 'COMMUNITY');
    section('builtin', 'TEST LINE-UPS');
    return out;
  }

  private visible(): number {
    return Math.floor((LIST.h - 4) / ROW);
  }

  private current(): Entry | undefined {
    return this.entries()[this.selected];
  }

  private select(i: number): void {
    this.selected = i;
    this.odds = null;
    this.message = '';
    this.refresh();
  }

  private say(text: string, color: number = UI.inkDim): void {
    this.message = text;
    this.messageColor = color;
  }

  // ── Actions ─────────────────────────────────────────────────────────

  private buttons(): { label: string; act: () => void }[] {
    const e = this.current();
    if (!e) return [];
    const out: { label: string; act: () => void }[] = [
      { label: 'PLAY', act: () => this.play() },
      { label: 'ODDS', act: () => this.calcOdds() },
      { label: e.from === 'mine' ? 'EDIT' : 'COPY', act: () => this.edit() },
    ];
    if (e.from === 'mine') {
      out.push({ label: 'RENAME', act: () => void this.rename() });
      out.push({ label: 'DELETE', act: () => void this.remove() });
    }
    return out;
  }

  play(): void {
    const e = this.current();
    if (!e || this.busy) return;
    const problems = setupProblems(e.setup);
    if (problems.length) return void (this.say(`Can't play: ${problems[0]}.`, UI.rope), this.refresh());
    this.busy = true;
    this.playing = e;
    startCustomBattle(this, e.setup, 'encounters');
  }

  private afterFight(end: BattleEnd): void {
    const e = this.playing;
    this.playing = null;
    this.busy = false;
    const battle = (this.scene.get('battle') as BattleScene).engine;
    finishCustomBattle();
    if (!e) return this.refresh();
    const r = fightSummary(battle);
    const records = readRecords();
    const rec = records[e.key] ?? { plays: 0, wins: 0 };
    rec.plays++;
    if (end.result === 'win') {
      rec.wins++;
      rec.best = rec.best === undefined ? r.rounds : Math.min(rec.best, r.rounds);
    }
    records[e.key] = rec;
    writeRecords(records);
    this.lastResult = { key: e.key, result: end.result, rounds: r.rounds };
    const word = { win: 'WON', lose: 'LOST', run: 'RAN AWAY' }[end.result] ?? end.result;
    this.say(
      `${word} in round ${r.rounds} · HP ${r.hp}/${r.maxHp} · great commands ${r.great} · guards ${r.blocks + r.reversals}`,
      end.result === 'win' ? UI.good : UI.rope,
    );
    this.refresh();
  }

  private calcOdds(): void {
    const e = this.current();
    if (!e || setupProblems(e.setup).length) return;
    const parts = [SKILLS[1], SKILLS[2]].map((skill) => {
      const r = simulate(simSetupOf(e.setup, skill), 200, Rng.freshSeed());
      return `${skill.id} ${Math.round((100 * r.wins) / r.runs)}%`;
    });
    this.odds = { key: e.key, text: `Simulated wins: ${parts.join(' · ')}` };
    this.refresh();
  }

  private edit(): void {
    const e = this.current();
    if (!e) return;
    if (setupProblems(e.setup).length)
      return void (this.say("Can't open: a fighter in it no longer exists.", UI.rope), this.refresh());
    SceneLoader.goto(this, 'battle_sandbox', {
      encounter: { id: e.from === 'mine' ? e.id : undefined, title: e.title, setup: e.setup },
    });
  }

  private async rename(): Promise<void> {
    const e = this.current();
    if (e?.from !== 'mine') return;
    const v = await editText(this, { x: CARD.x + 6, y: CARD.y + 4, w: CARD.w - 12, value: e.title });
    if (!v?.trim()) return;
    const mine = Builds.myEncounters();
    const enc = mine.find((x) => x.id === e.id);
    if (!enc) return;
    enc.title = v.trim().slice(0, 32);
    await this.saveMine(mine);
  }

  private async remove(): Promise<void> {
    const e = this.current();
    if (e?.from !== 'mine') return;
    await this.saveMine(Builds.myEncounters().filter((x) => x.id !== e.id));
    this.selected = Math.max(0, this.selected - 1);
    this.say('Deleted.');
    this.refresh();
  }

  private async saveMine(list: Encounter[]): Promise<void> {
    try {
      await Builds.saveMine({ encounters: list });
    } catch (err) {
      this.say(`Couldn't save: ${(err as { message?: string }).message ?? err}`, UI.rope);
    }
    this.refresh();
  }

  private leave(): void {
    this.busy = true;
    SceneLoader.goto(this, 'dev_hub', { cursor: 4 });
  }

  // ── Input and drawing ───────────────────────────────────────────────

  private onDown(p: Phaser.Input.Pointer): void {
    if (textFieldOpen || this.busy) return;
    if (p.y < TOP) {
      if (p.x > W - 60) this.leave();
      return;
    }
    if (p.x < LIST.x + LIST.w) {
      const row = this.rows()[Math.floor((p.y - LIST.y - 2) / ROW) + this.scroll];
      if (row?.entry !== undefined) this.select(row.entry);
      return;
    }
    let x = CARD.x + 6;
    const by = CARD.y + CARD.h - 22;
    for (const b of this.buttons()) {
      const w = b.label.length * 8 + 14;
      if (p.x >= x && p.x < x + w && p.y >= by && p.y < by + 18) return b.act();
      x += w + 6;
    }
  }

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
    txt(6, 9, 'ENCOUNTERS', UI.spark);
    g.fillStyle(UI.panelHi).fillRect(W - 56, 4, 50, 17);
    txt(W - 50, 9, 'BACK');

    // list
    this.rows()
      .slice(this.scroll, this.scroll + this.visible())
      .forEach((r, k) => {
        const y = LIST.y + 2 + k * ROW;
        const sel = r.entry === this.selected;
        if (sel) add(this.add.rectangle(LIST.x, y - 2, LIST.w, ROW, UI.panelHi).setOrigin(0));
        txt(
          LIST.x + 4,
          y,
          fit(r.label, 27),
          r.head ? UI.spark : sel ? UI.spark : r.entry === undefined ? UI.inkDim : UI.ink,
        );
      });

    // card
    const e = this.current();
    if (!e) return;
    let y = CARD.y + 6;
    const line = (s: string, color: number = UI.ink, size: 8 | 16 = 8) => {
      txt(CARD.x + 8, y, s, color, size);
      y += size === 16 ? 22 : 13;
    };
    line(fit(e.title.toUpperCase(), 22), UI.spark, 16);
    add(
      tinyText(
        this,
        CARD.x + 8,
        y - 4,
        e.from === 'mine' ? 'YOURS' : e.from === 'community' ? 'FROM THE COMMUNITY' : 'BUILT-IN TEST LINE-UP',
        css(UI.inkDim),
      )
        .setOrigin(0)
        .setScale(2),
    );
    y += 16;
    const s = e.setup;
    const problems = setupProblems(s);
    const charName = (id: string) =>
      Database.data.characters.some((c) => c.id === id) ? t(Database.character(id).name) : '(missing)';
    const foeName = (id: string) =>
      Database.data.enemies.some((x) => x.id === id) ? t(Database.enemy(id).name) : '(missing)';
    line('HERO', UI.spark);
    line(fit(`${charName(s.hero)}  ·  HP ${s.maxHp}  ATK ${s.attack}  DEF ${s.defence}  GRIT ${s.grit}`, 46));
    if (s.partner) line(fit(`with ${charName(s.partner)}`, 46), UI.inkDim);
    y += 4;
    line('OPPONENTS', UI.spark);
    for (const o of s.enemies) line(fit(`${foeName(o.id)}  (${o.slot})`, 46));
    y += 4;
    const stage = Database.data.stages.find((st) => st.id === s.stage);
    line(
      fit(
        `Arena: ${stage ? t(stage.name) : s.stage}${s.firstStrike ? `  ·  ${s.firstStrike === 'player' ? 'you hit first' : 'ambushed'}` : ''}`,
        46,
      ),
      UI.inkDim,
    );
    const rec = readRecords()[e.key];
    line(
      rec
        ? `Your record: ${rec.wins} win${rec.wins === 1 ? '' : 's'} in ${rec.plays}${rec.best ? ` · best ${rec.best} rounds` : ''}`
        : 'Not played yet',
      UI.inkDim,
    );
    if (this.odds?.key === e.key) line(this.odds.text, UI.grit);
    if (problems.length) line(`Can't be played: ${problems[0]}`, UI.rope);
    if (this.message) {
      y += 4;
      add(
        pixelText(this, CARD.x + 8, y, this.message, 8, css(this.messageColor))
          .setOrigin(0, 0)
          .setWordWrapWidth(CARD.w - 16)
          .setLineSpacing(4),
      );
    }

    // buttons
    let x = CARD.x + 6;
    const by = CARD.y + CARD.h - 22;
    for (const b of this.buttons()) {
      const w = b.label.length * 8 + 14;
      g.fillStyle(b.label === 'PLAY' ? 0x2a4a20 : b.label === 'DELETE' ? 0x3a1018 : UI.panelHi).fillRect(
        x,
        by,
        w,
        18,
      );
      txt(x + 7, by + 5, b.label, b.label === 'PLAY' ? UI.good : b.label === 'DELETE' ? UI.rope : UI.ink);
      x += w + 6;
    }
    add(
      tinyText(
        this,
        W - 6,
        H - 6,
        `SHARED: ${Builds.backend() === 'shared' ? 'LINK' : 'THIS BROWSER'}`,
        css(UI.border),
      ).setOrigin(1, 1),
    );
    txt(6, H - 18, 'Z: play   UP/DOWN: choose   X: back', UI.inkDim);
  }
}
