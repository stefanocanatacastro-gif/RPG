// Battle sandbox (dev tool, the main balancing bench): build a fight from
// any enemies, rows, stage and hero stats, then either play it or simulate it
// a few hundred times. Fights here never touch the save: the game state is
// put back exactly as it was afterwards.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { benchBackdrop } from '../ui/bench';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { SceneLoader, type BattleEnd } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { gameState, hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { input, type Action } from '../systems/input';
import { Rng } from '../systems/rng';
import { versionLabel } from '../systems/version';
import { simulate, SKILLS, type SimReport } from '../battle/simulate';
import type { BattleScene } from './battle';
import type { BattleConditions, FormationDef, FormationSlot } from '../types/data';
import {
  HAZARDS,
  CROWD_SIZES,
  CROWD_MOODS,
  CROWD_LABEL,
  MOOD_LABEL,
  MOOD_DESC,
  SPECIALS,
  cleanConditions,
  conditionLines,
} from '../battle/conditions';
import {
  startCustomBattle,
  finishCustomBattle,
  fightSummary,
  simSetupOf,
  setupProblems,
  type BattleSetup,
} from '../managers/custom_battle';
import { Builds } from '../managers/builds';
import { editText } from '../ui/text_field';

const SLOTS = 4;
const ROW_H = 12;
const TOP = 50;
const LEFT_W = 344;
const VAL_L = 132; // "<"
const VAL_R = 300; // ">"
const SIM_RUNS = 200;

const ASSISTS = ['off', 'perfect', 'god', 'both'] as const;
const ASSIST_LABEL: Record<(typeof ASSISTS)[number], string> = {
  off: 'Off',
  perfect: 'Perfect commands',
  god: 'God mode',
  both: 'Perfect + god',
};
const STRIKES = [null, 'player', 'enemy'] as const;
const STRIKE_LABEL = { none: 'None', player: 'You hit first', enemy: 'Ambushed' };

interface Row {
  label: string;
  value?: () => string;
  tag?: () => string;
  left?: () => void;
  right?: () => void;
  confirm?: () => void;
  desc: string;
  disabled?: boolean;
  /** Held left/right keeps stepping (numbers). */
  repeat?: boolean;
}

interface Setup {
  preset: number;
  enemies: ({ id: string; slot: FormationSlot } | null)[];
  stage: number;
  maxHp: number;
  attack: number;
  defence: number;
  grit: number;
  /** Character leading the fight (Chispa or anyone made in the fighter maker). */
  hero: string;
  /** Character fighting alongside, or null. */
  partner: string | null;
  /** The bag at the start of the fight (item ids). */
  items: string[];
  /** Which item "Add item" would add (index into all items). */
  itemPick: number;
  strike: number;
  assist: number;
  fixedSeed: boolean;
  skill: number;
  /** Hazards, goal, house rules and crowd (the Ring & crowd page). */
  cond: BattleConditions;
}

const GOALS = ['ko', 'timed', 'survive'] as const;
const GOAL_NAME = { ko: 'Knock them all out', timed: 'Win within N rounds', survive: 'Survive N rounds' };

/** Partner choices: none, then every character who isn't the hero. */
const partners = (hero: string) => [null, ...Database.data.characters.filter((c) => c.id !== hero)];

/** Kept between visits so the bench remembers the last set-up. */
let saved: Setup | null = null;
let lastSeed: number | null = null;

export class BattleSandboxScene extends Phaser.Scene {
  private s!: Setup;
  private rows: Row[] = [];
  private cursor = 0;
  private texts: Phaser.GameObjects.GameObject[] = [];
  private side: Phaser.GameObjects.GameObject[] = [];
  private desc!: Phaser.GameObjects.Text;
  private report: string[] = [];
  private reportTitle = '';
  private busy = false;
  private heldSince = 0;
  private lastRepeat = 0;
  /** The encounter being edited, if this fight was opened from Encounters (yours only). */
  private editing: { id: string; title: string } | null = null;
  /** Which page of rows is showing: the fight itself, or the ring & crowd. */
  page: 'fight' | 'ring' = 'fight';
  /** For the browser test. */
  lastSim: SimReport | null = null;
  lastFight: { result: string; rounds: number; seed: number } | null = null;

  constructor() {
    super('battle_sandbox');
  }

  /** `hero` / `enemy`: open with a fighter from the fighter maker already in place. */
  create(data?: {
    hero?: string;
    enemy?: string;
    item?: string;
    encounter?: { id?: string; title?: string; setup: BattleSetup };
  }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    const hero = Database.character('chispa');
    this.s = saved ?? {
      preset: Math.max(
        0,
        Database.data.formations.findIndex((f) => f.id === 'test_crew'),
      ),
      enemies: [],
      stage: 0,
      maxHp: gameState().hero().maxHp,
      attack: hero.attack,
      defence: hero.defence,
      grit: gameState().data.maxGrit,
      hero: 'chispa',
      partner: 'pip',
      items: ['water_bottle'],
      itemPick: 0,
      strike: 0,
      assist: 0,
      fixedSeed: false,
      skill: 1,
      cond: {},
    };
    if (!saved) this.loadPreset();
    saved = this.s;
    // the hero or partner may have been deleted in the fighter maker since
    if (!Database.data.characters.some((c) => c.id === this.s.hero)) this.useHero('chispa');
    if (this.s.partner && !Database.data.characters.some((c) => c.id === this.s.partner))
      this.s.partner = null;
    this.s.items = (this.s.items ?? []).filter((i) => Database.data.items.some((x) => x.id === i));
    this.s.itemPick ??= 0;
    this.s.cond ??= {};
    this.page = 'fight';
    if (data?.hero && Database.data.characters.some((c) => c.id === data.hero)) this.useHero(data.hero);
    // opened from the item maker: the item goes in the bag
    if (data?.item && Database.data.items.some((i) => i.id === data.item) && this.s.items.length < 10)
      this.s.items.push(data.item);
    // opened from Encounters: yours are edited in place, anyone else's become a new one
    this.editing = null;
    if (data?.encounter) {
      this.loadSetup(data.encounter.setup);
      if (data.encounter.id) this.editing = { id: data.encounter.id, title: data.encounter.title ?? '' };
    }
    if (data?.enemy && Database.data.enemies.some((e) => e.id === data.enemy)) {
      const def = Database.enemy(data.enemy);
      this.s.enemies[0] = { id: def.id, slot: def.props.includes('airborne') ? 'air' : 'front' };
    }
    this.cursor = 0;
    this.busy = false;
    this.report = [];
    this.reportTitle = '';

    benchBackdrop(this, 'BATTLE SANDBOX', versionLabel());
    const g = this.add.graphics();
    const panelH = 22 * ROW_H + 10;
    drawPanel(g, 8, TOP - 6, LEFT_W, panelH, { alpha: 0.9 });
    drawPanel(g, LEFT_W + 16, TOP - 6, W - LEFT_W - 24, panelH, { alpha: 0.9 });
    this.desc = pixelText(this, 16, H - 40, '', 8, css(UI.inkDim))
      .setOrigin(0, 0)
      .setWordWrapWidth(W - 32);
    const hint = pixelText(this, W / 2, H - 20, '', 8, css(UI.inkDim));
    const arrows = { keyboard: 'ARROWS', gamepad: 'D-PAD', touch: 'TAP < >' } as const;
    const drawHint = () =>
      hint.setText(
        `${input.prompt('confirm')}: pick   ${arrows[input.device]}: change   ${input.prompt('cancel')}: back`,
      );
    drawHint();
    this.events.on(Phaser.Scenes.Events.UPDATE, drawHint);
    this.buildRows();
    this.render();

    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.tap(p));
    this.events.on(Phaser.Scenes.Events.WAKE, (_sys: unknown, end: BattleEnd) => this.afterFight(end));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.WAKE);
      this.events.off(Phaser.Scenes.Events.UPDATE, drawHint);
      this.input.off(Phaser.Input.Events.POINTER_UP);
    });
  }

  // ── Rows ────────────────────────────────────────────────────────────

  private buildRows(): void {
    if (this.page === 'ring') return this.buildRingRows();
    const s = this.s;
    const enemies = Database.data.enemies;
    const stages = Database.data.stages;
    const formations = Database.data.formations;
    const step = (key: 'maxHp' | 'attack' | 'defence' | 'grit', min: number, max: number) => ({
      left: () => (s[key] = Math.max(min, s[key] - 1)),
      right: () => (s[key] = Math.min(max, s[key] + 1)),
      repeat: true,
    });
    const cycle = (n: number, d: number, len: number) => (n + d + len) % len;

    this.rows = [
      {
        label: 'Line-up',
        value: () => formations[s.preset].id,
        left: () => (s.preset = cycle(s.preset, -1, formations.length)),
        right: () => (s.preset = cycle(s.preset, 1, formations.length)),
        confirm: () => this.loadPreset(),
        desc: 'A line-up from formations.json. Confirm loads its enemies and stage below.',
      },
      ...Array.from({ length: SLOTS }, (_, i): Row => {
        // index -1 = empty slot
        const idx = () => (s.enemies[i] ? enemies.findIndex((e) => e.id === s.enemies[i]!.id) : -1);
        const setIdx = (n: number) => {
          if (n < 0) s.enemies[i] = null;
          else {
            const def = enemies[n];
            const air = def.props.includes('airborne');
            const prev = s.enemies[i]?.slot;
            s.enemies[i] = {
              id: def.id,
              slot: air ? 'air' : prev && prev !== 'air' ? prev : i === 0 ? 'front' : 'back',
            };
          }
        };
        return {
          label: `Enemy ${i + 1}`,
          value: () => (s.enemies[i] ? t(Database.enemy(s.enemies[i]!.id).name) : '—'),
          tag: () => (s.enemies[i] ? s.enemies[i]!.slot.toUpperCase() : ''),
          left: () => setIdx(idx() <= -1 ? enemies.length - 1 : idx() - 1),
          right: () => setIdx(idx() >= enemies.length - 1 ? -1 : idx() + 1),
          confirm: () => {
            const e = s.enemies[i];
            if (e && e.slot !== 'air') e.slot = e.slot === 'front' ? 'back' : 'front';
          },
          desc: 'Left/right: enemy (or empty). Confirm: front or back row. Flyers are always in the air.',
        };
      }),
      {
        label: 'Stage',
        value: () => t(stages[s.stage].name),
        left: () => (s.stage = cycle(s.stage, -1, stages.length)),
        right: () => (s.stage = cycle(s.stage, 1, stages.length)),
        desc: 'Arena look, from stages.json.',
      },
      {
        label: 'Hero',
        value: () => t(Database.character(s.hero).name),
        left: () => this.cycleHero(-1),
        right: () => this.cycleHero(1),
        desc: 'Who leads the fight: Kid Chispa, or a hero from the fighter maker. Sets the numbers below.',
      },
      {
        label: 'Max HP',
        value: () => String(s.maxHp),
        ...step('maxHp', 1, 99),
        desc: "The hero's HP for this fight (starts full).",
      },
      {
        label: 'Attack',
        value: () => String(s.attack),
        ...step('attack', 0, 20),
        desc: 'Added to every move’s power.',
      },
      {
        label: 'Defence',
        value: () => String(s.defence),
        ...step('defence', 0, 20),
        desc: 'Taken off every hit the hero takes.',
      },
      {
        label: 'Grit',
        value: () => String(s.grit),
        ...step('grit', 0, 30),
        desc: 'Grit for this fight (starts full).',
      },
      {
        label: 'Partner',
        value: () => {
          const p = s.partner ? Database.character(s.partner) : null;
          return p ? `${t(p.name)} (${p.hp} HP)` : 'None';
        },
        left: () => this.cyclePartner(-1),
        right: () => this.cyclePartner(1),
        desc: 'Who fights alongside the hero, at full HP.',
      },
      {
        label: 'Add item',
        value: () => {
          const it = Database.data.items[s.itemPick % Database.data.items.length];
          return it ? t(it.name) : '—';
        },
        left: () => (s.itemPick = cycle(s.itemPick, -1, Database.data.items.length)),
        right: () => (s.itemPick = cycle(s.itemPick, 1, Database.data.items.length)),
        confirm: () => {
          const it = Database.data.items[s.itemPick % Database.data.items.length];
          if (it && s.items.length < 10) s.items.push(it.id);
        },
        desc: 'Left/right: pick an item (yours from the item maker too). Confirm: put it in the bag (up to 10).',
      },
      {
        label: 'Bag',
        value: () =>
          s.items.length
            ? `${s.items.length}: ${s.items.map((i) => t(Database.item(i).name)).join(', ')}`
            : 'empty',
        left: () => void s.items.pop(),
        confirm: () => (s.items = []),
        desc: 'What the hero starts with. Left: take out the last item. Confirm: empty the bag.',
      },
      {
        label: 'First strike',
        value: () => STRIKE_LABEL[STRIKES[s.strike] ?? 'none'],
        left: () => (s.strike = cycle(s.strike, -1, STRIKES.length)),
        right: () => (s.strike = cycle(s.strike, 1, STRIKES.length)),
        desc: 'Start as if you hit the enemy in the field, or as if it hit you.',
      },
      {
        label: 'Assist',
        value: () => ASSIST_LABEL[ASSISTS[s.assist]],
        left: () => (s.assist = cycle(s.assist, -1, ASSISTS.length)),
        right: () => (s.assist = cycle(s.assist, 1, ASSISTS.length)),
        desc: 'Perfect commands: every action command is GREAT and every attack is blocked. God: take no damage.',
      },
      {
        label: 'Seed',
        value: () => (s.fixedSeed && lastSeed !== null ? `${lastSeed}` : 'Random'),
        left: () => (s.fixedSeed = !s.fixedSeed && lastSeed !== null),
        right: () => (s.fixedSeed = !s.fixedSeed && lastSeed !== null),
        desc: 'Random, or the last fight’s seed to replay it with the same enemy choices.',
      },
      {
        label: 'Ring & crowd',
        value: () => {
          const n = conditionLines(s.cond).length;
          return n ? `${n} change${n > 1 ? 's' : ''}` : 'Plain match';
        },
        confirm: () => this.openPage('ring'),
        desc: 'Hazards, a survival or timed goal, no items or running, and how big and whose the crowd is.',
      },
      {
        label: 'Save as…',
        value: () => this.editing?.title ?? 'new encounter',
        confirm: () => void this.saveEncounter(),
        desc: 'Save this fight as an encounter anyone in the game link can play (Encounters in the dev hub).',
      },
      {
        label: 'FIGHT!',
        confirm: () => this.fight(),
        desc: 'Play this fight. Your save is put back afterwards.',
      },
      {
        label: `Simulate ×${SIM_RUNS}`,
        value: () => SKILLS[s.skill].id[0].toUpperCase() + SKILLS[s.skill].id.slice(1),
        left: () => (s.skill = cycle(s.skill, -1, SKILLS.length)),
        right: () => (s.skill = cycle(s.skill, 1, SKILLS.length)),
        confirm: () => this.runSim(),
        desc: 'Fight it 200 times without graphics. Left/right: how good the simulated player’s timing is.',
      },
      { label: 'Back', confirm: () => this.leave(), desc: 'Back to the dev hub.' },
    ];
  }

  private buildRingRows(): void {
    const c = this.s.cond;
    const cycle = (n: number, d: number, len: number) => (n + d + len) % len;
    const goalIdx = () => GOALS.indexOf(c.goal ?? 'ko');
    const toggle = (key: 'noItems' | 'noRun') => () => {
      if (c[key]) delete c[key];
      else c[key] = true;
    };
    this.rows = [
      {
        label: 'Goal',
        value: () => GOAL_NAME[c.goal ?? 'ko'],
        left: () => (c.goal = GOALS[cycle(goalIdx(), -1, GOALS.length)]),
        right: () => (c.goal = GOALS[cycle(goalIdx(), 1, GOALS.length)]),
        desc: 'Knock them all out (normal), beat them before the round limit, or just stay standing that long.',
      },
      {
        label: 'Rounds',
        value: () => (c.goal && c.goal !== 'ko' ? String(c.rounds ?? 5) : '—'),
        left: () => (c.rounds = Math.max(1, (c.rounds ?? 5) - 1)),
        right: () => (c.rounds = Math.min(20, (c.rounds ?? 5) + 1)),
        repeat: true,
        desc: 'How many rounds the goal above gives you.',
      },
      ...HAZARDS.map((h): Row => ({
        label: h.short,
        value: () => ((c.hazards ?? []).includes(h.id) ? 'On' : 'Off'),
        left: () => this.toggleHazard(h.id),
        right: () => this.toggleHazard(h.id),
        desc: h.desc,
      })),
      {
        label: 'Items',
        value: () => (c.noItems ? 'Banned' : 'Allowed'),
        left: toggle('noItems'),
        right: toggle('noItems'),
        desc: 'Banned: the bag stays shut (revives too).',
      },
      {
        label: 'Running',
        value: () => (c.noRun ? 'Banned' : 'Allowed'),
        left: toggle('noRun'),
        right: toggle('noRun'),
        desc: 'Banned: a fight to the finish, nobody runs.',
      },
      {
        label: 'Crowd',
        value: () => CROWD_LABEL[c.crowd ?? 'normal'],
        left: () => (c.crowd = CROWD_SIZES[cycle(CROWD_SIZES.indexOf(c.crowd ?? 'normal'), -1, 3)]),
        right: () => (c.crowd = CROWD_SIZES[cycle(CROWD_SIZES.indexOf(c.crowd ?? 'normal'), 1, 3)]),
        desc: 'How full the arena is. A packed house builds Hype half again as fast; a quiet one, half as fast.',
      },
      {
        label: 'Crowd mood',
        value: () => MOOD_LABEL[c.mood ?? 'fair'],
        left: () =>
          (c.mood = CROWD_MOODS[cycle(CROWD_MOODS.indexOf(c.mood ?? 'fair'), -1, CROWD_MOODS.length)]),
        right: () =>
          (c.mood = CROWD_MOODS[cycle(CROWD_MOODS.indexOf(c.mood ?? 'fair'), 1, CROWD_MOODS.length)]),
        desc: '',
      },
      {
        label: 'Clear all',
        confirm: () => {
          this.s.cond = {};
          this.buildRows();
        },
        desc: 'Back to a plain match.',
      },
      { label: 'Done', confirm: () => this.openPage('fight'), desc: 'Back to the fight set-up.' },
    ];
    // the mood's description follows the mood picked
    const mood = this.rows.find((r) => r.label === 'Crowd mood')!;
    Object.defineProperty(mood, 'desc', { get: () => MOOD_DESC[c.mood ?? 'fair'] });
  }

  private toggleHazard(id: string): void {
    const list = (this.s.cond.hazards ??= []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
  }

  /** Switches between the fight rows and the Ring & crowd rows. */
  openPage(page: 'fight' | 'ring'): void {
    const from = this.page;
    this.page = page;
    this.buildRows();
    this.cursor =
      page === 'fight' && from === 'ring' ? this.rows.findIndex((r) => r.label.startsWith('Ring')) : 0;
    this.render();
  }

  /** Picks the hero and takes their numbers. */
  private useHero(id: string): void {
    const def = Database.character(id);
    Object.assign(this.s, {
      hero: id,
      maxHp: def.hp,
      attack: def.attack,
      defence: def.defence,
      grit: def.grit,
    });
    if (this.s.partner === id) this.s.partner = null;
  }

  private cycleHero(dir: number): void {
    const ids = Database.data.characters.map((c) => c.id);
    this.useHero(ids[(ids.indexOf(this.s.hero) + dir + ids.length) % ids.length]);
  }

  private cyclePartner(dir: number): void {
    const list = partners(this.s.hero).map((c) => c?.id ?? null);
    const i = list.indexOf(this.s.partner);
    this.s.partner = list[(i + dir + list.length) % list.length];
  }

  private loadPreset(): void {
    const f = Database.data.formations[this.s.preset];
    this.s.enemies = Array.from({ length: SLOTS }, (_, i) =>
      f.enemies[i] ? { id: f.enemies[i].enemy, slot: f.enemies[i].slot } : null,
    );
    this.s.stage = Math.max(
      0,
      Database.data.stages.findIndex((st) => st.id === f.stage),
    );
  }

  private formation(): FormationDef {
    return {
      id: 'sandbox',
      enemies: this.s.enemies
        .filter((e): e is { id: string; slot: FormationSlot } => !!e)
        .map((e) => ({ enemy: e.id, slot: e.slot })),
      stage: Database.data.stages[this.s.stage].id,
    };
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  private render(): void {
    for (const o of this.texts) o.destroy();
    this.texts = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.texts.push(o);
      return o;
    };
    this.rows.forEach((r, i) => {
      const y = TOP + i * ROW_H;
      const sel = i === this.cursor;
      const ink = r.disabled ? UI.border : sel ? UI.spark : UI.ink;
      if (sel) add(this.add.rectangle(12, y - 3, LEFT_W - 8, ROW_H, UI.panelHi).setOrigin(0));
      add(pixelText(this, 20, y, `${sel ? '>' : ' '}${r.label}`, 8, css(ink)).setOrigin(0, 0));
      if (r.value) {
        const arrows = !!(r.left && !r.disabled);
        if (arrows) {
          add(pixelText(this, VAL_L, y, '<', 8, css(sel ? UI.spark : UI.inkDim)).setOrigin(0, 0));
          add(pixelText(this, VAL_R, y, '>', 8, css(sel ? UI.spark : UI.inkDim)).setOrigin(0, 0));
        }
        add(
          pixelText(
            this,
            (VAL_L + VAL_R + 8) / 2,
            y,
            r.value(),
            8,
            css(r.disabled ? UI.border : UI.ink),
          ).setOrigin(0.5, 0),
        );
      }
      const tag = r.tag?.();
      if (tag)
        add(
          tinyText(this, 90, y + 1, tag, css(UI.grit))
            .setOrigin(0, 0)
            .setScale(2),
        );
    });
    const r = this.rows[this.cursor];
    this.desc.setText(r.desc);
    this.renderSide();
  }

  /** Right panel: the highlighted enemy's card, or the line-up summary, then the last report. */
  private renderSide(): void {
    for (const o of this.side) o.destroy();
    this.side = [];
    const x = LEFT_W + 26;
    let y = TOP;
    const line = (text: string, color: number = UI.ink, size: 8 | 16 = 8) => {
      this.side.push(pixelText(this, x, y, text, size, css(color)).setOrigin(0, 0));
      y += size === 16 ? 20 : 12;
    };
    const slot =
      this.page === 'fight' && this.cursor >= 1 && this.cursor <= SLOTS
        ? this.s.enemies[this.cursor - 1]
        : null;
    if (this.page === 'ring') {
      line('RING & CROWD', UI.spark);
      const lines = conditionLines(this.s.cond);
      if (!lines.length) line('Plain match', UI.inkDim);
      for (const l of lines.slice(0, 7)) line(l);
      y = TOP + 104;
      line('HYPE SPECIALS', UI.hype);
      for (const sp of SPECIALS) line(`${sp.name} · ${sp.cost} Hype`, UI.inkDim);
    } else if (slot) {
      const d = Database.enemy(slot.id);
      line(t(d.name).toUpperCase(), UI.spark);
      line(`HP ${d.hp}  ATK ${d.attack}  DEF ${d.defence}`);
      line(`XP ${d.xp}  Coins ${d.coins}`, UI.inkDim);
      if (d.props.length) line(d.props.join(', '), UI.grit);
      for (const r of d.ai.slice(0, 3)) {
        const m = Database.move(r.move);
        const cond = [
          r.priority ? `p${r.priority}` : '',
          r.whenHpBelow !== undefined ? `hp<${r.whenHpBelow}` : '',
          r.whenAllyHpBelow !== undefined ? `ally<${r.whenAllyHpBelow}` : '',
          r.everyRounds ? `every ${r.everyRounds}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const what = m.heal ? `heal ${m.heal}` : `pow ${m.power}${m.charge ? ' charged' : ''}`;
        line(`${t(m.name)}`.slice(0, 18) + ` ${what}`, UI.ink);
        if (cond) line(`  ${cond}`, UI.inkDim);
      }
    } else {
      const f = this.formation();
      const defs = f.enemies.map((e) => Database.enemy(e.enemy));
      line('LINE-UP', UI.spark);
      line(`${defs.length} enemies · ${defs.reduce((a, d) => a + d.hp, 0)} HP total`);
      line(
        `${defs.reduce((a, d) => a + d.xp, 0)} XP · ${defs.reduce((a, d) => a + d.coins, 0)} coins`,
        UI.inkDim,
      );
    }
    y = TOP + 130;
    if (this.reportTitle && this.page === 'fight') {
      line(this.reportTitle, UI.spark);
      for (const l of this.report) line(l, UI.ink);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────

  update(time: number): void {
    if (this.busy || SceneLoader.isBusy()) return;
    const move = (d: number) => {
      this.cursor = (this.cursor + d + this.rows.length) % this.rows.length;
      this.render();
    };
    if (input.justPressed('up')) move(-1);
    else if (input.justPressed('down')) move(1);
    else if (input.justPressed('confirm')) this.act('confirm');
    else if (input.justPressed('cancel')) this.leave();
    for (const dir of ['left', 'right'] as const) {
      if (input.justPressed(dir)) {
        this.heldSince = time;
        this.lastRepeat = time;
        this.act(dir);
      } else if (
        input.isDown(dir) &&
        this.rows[this.cursor].repeat &&
        time - this.heldSince > 350 &&
        time - this.lastRepeat > 70
      ) {
        this.lastRepeat = time;
        this.act(dir);
      }
    }
  }

  private act(kind: 'left' | 'right' | 'confirm'): void {
    const r = this.rows[this.cursor];
    if (r.disabled) return;
    const fn = r[kind] ?? (kind === 'confirm' ? r.right : undefined);
    if (!fn) return;
    fn();
    if (!this.busy) this.render();
  }

  private tap(p: Phaser.Input.Pointer): void {
    if (this.busy || SceneLoader.isBusy() || input.onTouchControl(p.x, p.y)) return;
    if (p.x > LEFT_W + 8) return;
    const i = Math.floor((p.y - TOP + 3) / ROW_H);
    if (i < 0 || i >= this.rows.length) return;
    const was = this.cursor === i;
    this.cursor = i;
    const r = this.rows[i];
    let kind: 'left' | 'right' | 'confirm' | null = null;
    if (r.left && p.x >= VAL_L - 10 && p.x < VAL_L + 20) kind = 'left';
    else if (r.right && p.x >= VAL_R - 12 && p.x < VAL_R + 18) kind = 'right';
    else if (was) kind = 'confirm';
    if (kind) this.act(kind);
    else this.render();
  }

  /** Lets a browser test press a row's control directly. */
  pressRow(label: string, kind: Action & ('left' | 'right' | 'confirm')): void {
    this.cursor = this.rows.findIndex((r) => r.label.startsWith(label));
    this.act(kind);
  }

  // ── Fight, simulate, leave ──────────────────────────────────────────

  /** The fight as set up on screen. */
  setup(): BattleSetup {
    return {
      hero: this.s.hero,
      maxHp: this.s.maxHp,
      attack: this.s.attack,
      defence: this.s.defence,
      grit: this.s.grit,
      partner: this.s.partner && this.s.partner !== this.s.hero ? this.s.partner : null,
      enemies: this.s.enemies.filter((e): e is { id: string; slot: FormationSlot } => !!e),
      stage: Database.data.stages[this.s.stage].id,
      firstStrike: STRIKES[this.s.strike],
      items: [...this.s.items],
      ...(cleanConditions(this.s.cond) ? { conditions: cleanConditions(this.s.cond) } : {}),
    };
  }

  /** Puts a saved encounter's fight on screen. */
  private loadSetup(b: BattleSetup): void {
    Object.assign(this.s, {
      hero: b.hero,
      maxHp: b.maxHp,
      attack: b.attack,
      defence: b.defence,
      grit: b.grit,
      partner: b.partner,
      strike: STRIKES.indexOf(b.firstStrike),
      stage: Math.max(
        0,
        Database.data.stages.findIndex((st) => st.id === b.stage),
      ),
      enemies: Array.from({ length: SLOTS }, (_, i) => (b.enemies[i] ? { ...b.enemies[i] } : null)),
      items: [...(b.items ?? [])],
      cond: structuredClone(b.conditions ?? {}),
    });
  }

  /** Saves (or updates, when editing one of yours) this fight as an encounter. */
  async saveEncounter(title?: string): Promise<void> {
    const problems = setupProblems(this.setup());
    if (problems.length) {
      this.desc.setText(`Can't save: ${problems[0]}.`).setColor(css(UI.rope));
      return;
    }
    const name =
      title ??
      (await editText(this, {
        x: 16,
        y: H - 48,
        w: W - 32,
        value: this.editing?.title ?? '',
        placeholder: 'Encounter title',
      }));
    if (!name?.trim()) return;
    const mine = Builds.myEncounters();
    let enc = this.editing ? mine.find((e) => e.id === this.editing!.id) : undefined;
    if (!enc) {
      const used = new Set(mine.map((e) => e.id));
      let n = 1;
      while (used.has(`b${n}`)) n++;
      enc = { id: `b${n}`, title: '', setup: this.setup() };
      mine.push(enc);
    }
    enc.title = name.trim().slice(0, 32);
    enc.setup = this.setup();
    enc.savedAt = new Date().toISOString();
    try {
      await Builds.saveMine({ encounters: mine });
      this.editing = { id: enc.id, title: enc.title };
      this.reportTitle = 'ENCOUNTER SAVED';
      this.report = [`"${enc.title}"`, 'Play it from Encounters', '(dev hub), or share the link.'];
    } catch (e) {
      this.reportTitle = 'NOT SAVED';
      this.report = [String((e as { message?: string }).message ?? e).slice(0, 32)];
    }
    this.render();
  }

  private fight(): void {
    const b = this.setup();
    if (b.enemies.length === 0) {
      this.desc.setText('Add at least one enemy first.').setColor(css(UI.rope));
      return;
    }
    this.busy = true;
    lastSeed = startCustomBattle(this, b, 'battle_sandbox', {
      assist: ASSISTS[this.s.assist],
      seed: this.s.fixedSeed && lastSeed !== null ? lastSeed : undefined,
    });
  }

  private afterFight(end: BattleEnd): void {
    const e = (this.scene.get('battle') as BattleScene).engine;
    finishCustomBattle();
    const r = fightSummary(e);
    const word = { win: 'WON', lose: 'LOST', run: 'RAN AWAY' }[end.result] ?? end.result;
    this.lastFight = { result: end.result, rounds: r.rounds, seed: r.seed };
    this.reportTitle = 'LAST FIGHT';
    this.report = [
      `${word} · round ${r.rounds} · HP ${r.hp}/${r.maxHp}`,
      `Dealt ${r.dealt} · taken ${r.taken}`,
      `Commands: ${r.great} great ${r.good} nice ${r.miss} miss`,
      `Guards: ${r.blocks} block ${r.reversals} rev ${r.unguarded} miss`,
      `Seed ${r.seed}`,
    ];
    this.busy = false;
    this.cursor = this.rows.findIndex((row) => row.label === 'FIGHT!');
    this.render();
  }

  private runSim(): void {
    const b = this.setup();
    if (b.enemies.length === 0) {
      this.desc.setText('Add at least one enemy first.').setColor(css(UI.rope));
      return;
    }
    const skill = SKILLS[this.s.skill];
    const r = simulate(simSetupOf(b, skill), SIM_RUNS, Rng.freshSeed());
    this.lastSim = r;
    const pct = (n: number) => `${Math.round((100 * n) / r.runs)}%`;
    const lose = `${100 - Math.round((100 * r.wins) / r.runs) - (r.timeouts ? Math.round((100 * r.timeouts) / r.runs) : 0)}%`;
    this.reportTitle = `SIMULATED ×${r.runs} · ${skill.id.toUpperCase()}`;
    this.report = [
      `Win ${pct(r.wins)} · lose ${lose}${r.timeouts ? ` · stuck ${pct(r.timeouts)}` : ''}`,
      r.wins ? `Wins take ${r.avgRounds.toFixed(1)} rounds` : 'Never won',
      r.wins ? `HP left ${r.avgHpLeft.toFixed(1)} avg, ${r.minHpLeft} worst` : '',
      `Damage taken ${r.avgTaken.toFixed(1)} avg`,
      'AI: best hit, healers first',
    ].filter(Boolean);
    this.render();
  }

  private leave(): void {
    if (this.page === 'ring') return this.openPage('fight');
    this.busy = true;
    SceneLoader.goto(this, 'dev_hub', { cursor: 1 });
  }
}
