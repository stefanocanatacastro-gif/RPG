// Battle scene: draws the ring, asks the BattleEngine what's allowed, takes the
// player's choice from the command menu and target cursor, and plays each move
// from its steps in moves.json while the engine applies the hits.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { BattleEngine, type Fighter } from '../battle/engine';
import { drawStage, homeOf, STAGE, ARENA, type Arena } from '../battle/stage';
import { CameraDirector, type Shot } from '../battle/camera_director';
import { MenuList, Bar, BAR_STYLES, drawPanel, type MenuItem } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText, tinyTextWidth } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { SceneLoader, type BattleStart } from '../managers/scene_loader';
import { Database } from '../managers/database';
import { gameState } from '../managers/game_state';
import { bus, type BattleResult } from '../managers/event_bus';
import { t, tf } from '../managers/strings';
import { input } from '../systems/input';
import { animKey } from '../systems/anim_builder';
import { debugState } from '../systems/debug_state';
import rules from '../data/battle_rules.json';
import { CommandRunner } from '../battle/command_view';
import { COMMANDS, ratingMult, type CommandResult, type Rating } from '../battle/commands';
import type { GuardResult } from '../battle/engine';
import { xpToNext } from '../battle/progression';
import { isCustomId } from '../managers/builds';
import { ensureLook } from '../systems/custom_looks';
import { CROWD_DENSITY, SPECIALS, conditionLines, goalText, hazard, special } from '../battle/conditions';
import type { RoundEvent } from '../battle/engine';

type Choice =
  | { kind: 'move'; move: string; target: string }
  | { kind: 'item'; item: string; target: string }
  | { kind: 'special'; special: string }
  | { kind: 'appeal' }
  | { kind: 'defend' }
  | { kind: 'run' };

interface FighterView {
  f: Fighter;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  bar?: Bar;
  home: { x: number; y: number };
  /** Texture key, for looking up its animations. */
  texture: string;
  /** Whether the sprite is mirrored at rest (animated enemies face left). */
  baseFlip: boolean;
  /** Pulsing glow behind an enemy that is winding up a charged move. */
  aura?: Phaser.GameObjects.Ellipse;
}

/** The hero uses the test wrestler until Kid Chispa's real sprite exists. */
const HERO_TEXTURE = 'spr_test_dummy';

/** Fixed camera framings. Moves use tracking shots instead (see playMove). */
const SHOTS: Record<string, Shot> = {
  /** Opening: high on the crowd and the lights, before sweeping down to the ring. */
  intro: { x: ARENA.cx, y: 225, zoom: 1.7 },
  /** The whole ring. */
  wide: { x: ARENA.cx, y: STAGE.floorY - 12, zoom: 1 },
  /** Your turn: Chispa just right of the command menu, the opponents across the ring. */
  command: { x: STAGE.heroX + 30, y: STAGE.floorY - 12, zoom: 1 },
};

export class BattleScene extends Phaser.Scene {
  engine!: BattleEngine;
  /** What the battle is waiting for — read by the browser test. */
  inputState: 'busy' | 'menu' | 'target' | 'results' | 'scout' = 'busy';
  private start!: BattleStart;
  private views = new Map<string, FighterView>();
  private desc!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private menu: MenuList | null = null;
  private cursor!: Phaser.GameObjects.Graphics;
  commands!: CommandRunner;
  director!: CameraDirector;
  private arena!: Arena;
  /** HUD, menus and banners live here, drawn by a fixed camera so they never pan or zoom. */
  private uiLayer!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /** Last menu row picked, per party member. */
  private menuCursor: Record<string, number> = {};
  /** Losing this fight doesn't end the game. */
  private loseOk = false;
  private hypeBar!: Bar;
  /** Light cone over whoever stands in the spotlight this round. */
  private spot: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    super('battle');
  }

  create(start: BattleStart): void {
    this.start = start;
    this.views.clear();
    this.menu = null;
    this.menuCursor = {};
    this.inputState = 'busy';
    const gs = gameState();
    const hero = Database.character(gs.hero().id);
    const formation = start.formationDef ?? Database.formation(start.formation);
    this.loseOk = !!(start.loseOk || formation.loseOk);
    const pm = gs.partner();
    this.engine = new BattleEngine(
      Database,
      hero,
      { hp: gs.hero().hp, maxHp: gs.hero().maxHp },
      formation,
      start.seed,
      pm ? { def: Database.character(pm.id), hp: pm.hp, maxHp: pm.maxHp } : undefined,
    );
    if (start.hero) {
      this.engine.hero.attack = start.hero.attack;
      this.engine.hero.defence = start.hero.defence;
    }
    this.registry.set('battleSeed', this.engine.rng.seed);

    // the crowd size condition fills or empties the stands
    const stage = Database.stage(formation.stage);
    const size = formation.conditions?.crowd;
    this.arena = drawStage(
      this,
      size === 'quiet'
        ? { ...stage, crowd: Math.min(stage.crowd, CROWD_DENSITY.quiet) }
        : size === 'packed'
          ? { ...stage, crowd: CROWD_DENSITY.packed }
          : stage,
    );
    this.spot = null;
    this.uiLayer = this.add.layer().setDepth(1000);
    this.cameras.main.ignore(this.uiLayer);
    this.uiCam = this.cameras.add(0, 0, W, H).setName('ui');
    this.director = new CameraDirector(
      this.cameras.main,
      { width: ARENA.width, height: ARENA.height },
      SHOTS.intro,
    );
    // anything not on the UI layer belongs to the arena: keep it off the fixed camera
    const sortCameras = () => {
      for (const obj of this.children.list) {
        if ((obj as unknown) !== this.uiLayer && !(obj.cameraFilter & this.uiCam.id)) this.uiCam.ignore(obj);
      }
    };
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, sortCameras);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, sortCameras),
    );

    for (const f of this.engine.fighters) this.addFighter(f);
    this.buildHud();
    sortCameras();
    this.cursor = this.add.graphics().setDepth(60).setVisible(false);
    this.commands = new CommandRunner(this);

    this.run().catch((err) => {
      // surface engine/scene errors through the crash screen
      setTimeout(() => {
        throw err;
      });
    });
  }

  // ── Building the scene ──────────────────────────────────────────────

  private addFighter(f: Fighter): void {
    const home = homeOf(f.side, f.order, f.airborne);
    const shadow = this.add.ellipse(home.x, STAGE.floorY, 60, 12, 0x000000, 0.3).setDepth(5);
    // Kid Chispa uses the test wrestler until his real art exists; made fighters bring their own look
    const texture = f.defId === 'chispa' ? HERO_TEXTURE : f.sprite;
    if (isCustomId(f.defId)) ensureLook(this, f.defId);
    const animated = this.anims.exists(animKey(texture, 'idle'));
    const sprite = this.add
      .sprite(home.x, home.y, texture, animated ? 'idle_00' : undefined)
      .setOrigin(0.5, 1)
      .setDepth(10 + f.order);
    if (animated) sprite.play(animKey(texture, 'idle'));
    // animated bodies are drawn facing right: enemies turn to face the hero
    const baseFlip = f.side === 'enemy' && animated;
    sprite.setFlipX(baseFlip);
    const view: FighterView = { f, sprite, shadow, home, texture, baseFlip };
    if (f.side === 'enemy') {
      view.bar = new Bar(
        this,
        home.x - 33,
        STAGE.floorY + 9,
        66,
        BAR_STYLES.hp,
        f.hp,
        f.maxHp,
        true,
      ).setDepth(55);
      if (f.airborne) this.hover(view);
    }
    this.views.set(f.id, view);
  }

  /** Moves a game object onto the fixed UI layer. */
  private ui<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.uiLayer.add(obj);
    return obj;
  }

  /** Darkened screen edges, like a broadcast camera; on the UI layer so it never moves. */
  private vignette(): void {
    const key = '__battle_vignette';
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, W, H)!;
      const ctx = tex.getContext();
      const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
      grad.addColorStop(0, 'rgba(5,4,10,0)');
      grad.addColorStop(1, 'rgba(5,4,10,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      tex.refresh();
    }
    this.ui(this.add.image(0, 0, key).setOrigin(0));
  }

  private buildHud(): void {
    const gs = gameState();
    this.vignette();
    const g = this.ui(this.add.graphics());
    drawPanel(g, 12, 12, 354, 99, { alpha: 0.94 });
    this.ui(
      pixelText(
        this,
        30,
        25,
        t(Database.character(gs.hero().id).name).toUpperCase().slice(0, 20),
        16,
        css(UI.spark),
      ).setOrigin(0, 0),
    );
    const hp = this.ui(new Bar(this, 30, 52, 318, BAR_STYLES.hp, gs.hero().hp, gs.hero().maxHp));
    const grit = this.ui(new Bar(this, 30, 78, 318, BAR_STYLES.grit, gs.data.grit, gs.data.maxGrit));
    const offs = [
      bus.on('hp.changed', (e) => e.who === gs.hero().id && hp.setValue(e.hp, e.maxHp)),
      bus.on('grit.changed', (e) => grit.setValue(e.grit, e.maxGrit)),
    ];
    const pm = gs.partner();
    if (pm) {
      drawPanel(g, 378, 12, 264, 72, { alpha: 0.94 });
      this.ui(
        pixelText(
          this,
          396,
          25,
          t(Database.character(pm.id).name).toUpperCase().slice(0, 13),
          16,
          css(UI.spark),
        ).setOrigin(0, 0),
      );
      const php = this.ui(new Bar(this, 396, 52, 228, BAR_STYLES.hp, pm.hp, pm.maxHp));
      offs.push(bus.on('hp.changed', (e) => e.who === pm.id && php.setValue(e.hp, e.maxHp)));
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));

    // round and Hype, top right; the match's conditions listed under them
    const hx = 654;
    const hw = W - hx - 12;
    drawPanel(g, hx, 12, hw, 72, { alpha: 0.94 });
    this.roundText = this.ui(pixelText(this, hx + 18, 25, '', 16, css(UI.ink)).setOrigin(0, 0));
    this.hypeBar = this.ui(new Bar(this, hx + 18, 52, hw - 36, BAR_STYLES.hype, 0, this.engine.maxHype));
    const lines = conditionLines(this.engine.cond);
    if (lines.length) {
      const lw = Math.max(...lines.map((l) => tinyTextWidth(l.toUpperCase()))) * 3 + 24;
      drawPanel(g, W - 12 - lw, 90, lw, lines.length * 18 + 12, { alpha: 0.8 });
    }
    lines.forEach((l, i) =>
      this.ui(
        tinyText(this, W - 24, 96 + i * 18, l.toUpperCase(), css(UI.inkDim), css(UI.void))
          .setOrigin(1, 0)
          .setScale(3),
      ),
    );
    this.turnText = this.ui(pixelText(this, 30, 120, '', 16, css(UI.spark)).setOrigin(0, 0));
    this.desc = this.ui(
      pixelText(this, 24, H - 42, '', 16)
        .setOrigin(0, 0)
        .setWordWrapWidth(W - 48),
    );
    const seed = `SEED ${this.engine.rng.seed}`;
    this.ui(
      tinyText(this, W - 12 - tinyTextWidth(seed) * 2, H - 14, seed, css(UI.border))
        .setOrigin(0)
        .setScale(2),
    );
  }

  /** Shadows stay on the canvas and follow their fighter sideways; the camera eases toward its shot. */
  update(_t: number, dt: number): void {
    this.director.update(dt);
    if (this.hypeBar) {
      const hype = Math.floor(this.engine.hype + 1e-9);
      if (hype !== this.hypeBar.value) this.hypeBar.setValue(hype, this.engine.maxHype);
    }
    if (this.spot) {
      const v = this.views.get(this.engine.spotlight ?? '');
      if (!v || v.f.hp <= 0) this.spot.setVisible(false);
      else this.spot.setVisible(true).setPosition(v.sprite.x, v.sprite.y);
    }
    for (const v of this.views.values()) {
      v.shadow.x = v.sprite.x;
      if (v.bar) v.bar.x = Math.round(v.sprite.x - 33);
      if (v.aura) v.aura.setPosition(v.sprite.x, v.sprite.y - v.sprite.displayHeight / 2);
      const lift = Math.max(0, STAGE.floorY - v.sprite.y);
      v.shadow.setScale(Math.max(0.5, 1 - lift / 240));
    }
  }

  // ── Main loop ───────────────────────────────────────────────────────

  private async run(): Promise<void> {
    const e = this.engine;
    // establishing shot: from the crowd and the lights down onto the ring
    this.director.to(SHOTS.wide, 2.2);
    await this.wait(900);
    if (this.start.firstStrike === 'player') {
      await this.banner(t('battle.first_strike'), UI.spark);
      const target = e.frontGround() ?? e.enemies()[0];
      if (target) {
        await this.playMove('hero', 'chop', target.id, { firstStrike: true });
      }
    } else if (this.start.firstStrike === 'enemy') {
      await this.banner(t('battle.ambushed'), UI.rope);
    } else {
      await this.banner(t('battle.start'), UI.ink);
    }
    if (e.roundGoal !== null) await this.caption(goalText(e.cond), UI.spark);
    e.begin(this.start.firstStrike === 'enemy' ? 'enemy' : null);
    if (e.enemies().length === 0) e.phase = 'victory';

    for (let guard = 0; guard < 500; guard++) {
      const goal = e.roundGoal;
      this.roundText.setText(
        goal !== null
          ? `${tf('battle.round', { n: e.round })} / ${goal}`
          : tf('battle.round', { n: e.round }),
      );
      // the ring and the crowd at the start of a round
      const events = e.takeEvents();
      if (events.length) {
        for (const ev of events) await this.showRoundEvent(ev);
        if (e.hero.hp <= 0) await this.tryRevive();
        e.settle();
        continue;
      }
      if (e.phase === 'command') {
        this.director.to(SHOTS.command, 5);
        // with a partner out, say whose turn it is, just above the menu
        this.turnText.setText(e.partner ? tf('battle.turn', { name: t(e.acting.name).toUpperCase() }) : '');
        const choice = await this.chooseAction();
        this.turnText.setText('');
        await this.perform(choice);
      } else if (e.phase === 'enemy') {
        const plan = e.nextEnemyPlan();
        if (plan) {
          if (debugState.god) for (const f of e.party()) f.guard = 99;
          const v = this.views.get(plan.actor)!;
          if (plan.kind === 'charge') await this.showCharge(v);
          else {
            if (plan.kind === 'release') this.clearAura(v);
            await this.caption(t(Database.move(plan.move).name), plan.kind === 'release' ? UI.rope : UI.ink);
            await this.playMove(plan.actor, plan.move, plan.target, { big: plan.kind === 'release' });
          }
          // knocked out: Smelling Salts (or anything that revives) get Chispa back up by themselves
          if (e.hero.hp <= 0) await this.tryRevive();
        }
        e.endEnemyAction();
      } else break;
    }

    this.spot?.destroy();
    this.spot = null;
    if (e.endReason === 'survived') await this.banner(t('battle.survived'), UI.good, 600);
    if (e.endReason === 'timeup') await this.banner(t('battle.timeup'), UI.rope, 600);
    if (e.phase === 'victory') return this.victory();
    if (e.phase === 'defeat') return this.defeat();
    if (e.phase === 'fled') return this.finish('run');
  }

  private async perform(c: Choice): Promise<void> {
    const e = this.engine;
    const gs = gameState();
    const me = this.views.get(e.turn)!;
    if (c.kind === 'move') {
      const m = Database.move(c.move);
      gs.spendGrit(m.gritCost);
      e.beginHeroAction();
      await this.playMove(e.turn, c.move, c.target);
    } else if (c.kind === 'item') {
      e.beginHeroAction();
      const aim = this.views.get(c.target);
      this.director.track(aim ? [aim.sprite, me.sprite] : [me.sprite], aim ? 1.2 : 1.05);
      await this.useItem(c.item, c.target);
    } else if (c.kind === 'special') {
      e.beginHeroAction();
      await this.playSpecial(c.special);
    } else if (c.kind === 'appeal') {
      e.beginHeroAction();
      const got = e.appeal();
      this.director.track([me.sprite], 1.3, 15);
      await this.tween({ targets: me.sprite, y: me.sprite.y - 18, duration: 110, yoyo: true, repeat: 1 });
      this.arena.cheer(2);
      await this.popText(me, `${t('battle.hype')} +${Math.round(got * 10) / 10}`, UI.hype);
    } else if (c.kind === 'defend') {
      e.defend();
      this.director.track([me.sprite], 1.35, 15);
      await this.popText(me, t('battle.guard'), UI.grit);
    } else {
      const ok = e.tryRun();
      if (!ok) await this.banner(t('battle.run_failed'), UI.rope);
      else {
        // the whole party makes a break for it
        const runners = e.party(false).map((f) => this.views.get(f.id)!.sprite);
        this.director.track([runners[0]], 1.15);
        for (const r of runners) r.setFlipX(true);
        this.playAnim(this.views.get('hero')!, 'walk');
        await this.tween({ targets: runners, x: -60, duration: 500 });
        await this.banner(t('battle.fled'), UI.ink);
      }
    }
    // Chispa can go down on his own turn (burning ropes): a revive still gets him up
    if (e.hero.hp <= 0) await this.tryRevive();
    e.endHeroAction();
  }

  // ── Choosing an action ──────────────────────────────────────────────

  private reasonText(reason?: string): string {
    return reason ? t(`battle.reason.${reason}`) : '';
  }

  private chooseAction(): Promise<Choice> {
    return new Promise((resolve) => {
      const e = this.engine;
      const gs = gameState();
      const items: MenuItem[] = e.acting.moves.map((id) => {
        const m = Database.move(id);
        const check = e.canUseMove(id, gs.data.grit);
        return {
          label: t(m.name),
          value: `move:${id}`,
          right: m.gritCost ? String(m.gritCost) : undefined,
          desc: t(`${m.name}.desc`),
          disabled: !check.ok,
          reason: this.reasonText(check.reason),
        };
      });
      const bag = gs.data.items;
      const noItems = !!e.cond.noItems;
      const cheapest = Math.min(...SPECIALS.map((x) => x.cost));
      items.push(
        {
          label: t('battle.items'),
          value: 'items',
          right: String(bag.length),
          desc: t('battle.items.desc'),
          disabled: noItems || bag.length === 0,
          reason: t(noItems ? 'battle.items.banned' : 'battle.items.empty'),
        },
        {
          label: t('battle.specials'),
          value: 'specials',
          right: String(Math.floor(e.hype + 1e-9)),
          desc: t('battle.specials.desc'),
          disabled: e.hype + 1e-9 < cheapest,
          reason: t('battle.specials.low'),
        },
        { label: t('battle.appeal'), value: 'appeal', desc: t('battle.appeal.desc') },
        { label: t('battle.defend'), value: 'defend', desc: t('battle.defend.desc') },
      );
      // only Chispa calls the retreat
      if (e.turn === 'hero')
        items.push({
          label: t('battle.run'),
          value: 'run',
          desc: t('battle.run.desc'),
          disabled: !!e.cond.noRun,
          reason: t('battle.run.banned'),
        });
      const cursorKey = e.turn;

      const open = () => {
        this.inputState = 'menu';
        this.menu?.destroy();
        this.menu = new MenuList(this, 24, 141, {
          width: 375,
          rows: items.length,
          rowHeight: 36,
          items,
          descText: this.desc,
          cancellable: false,
          onSelect: (item, i) => {
            this.menuCursor[cursorKey] = i;
            this.menu!.active = false;
            if (item.value.startsWith('move:')) {
              const move = item.value.slice(5);
              const aim = e.targetsFor(move);
              // a move on everyone, or on yourself, needs no aiming
              const rule = Database.move(move).target;
              if (rule === 'all' || rule === 'self') return done({ kind: 'move', move, target: aim[0].id });
              this.pickTarget(
                e.targetsFor(move).map((f) => f.id),
                (target) => done({ kind: 'move', move, target }),
                () => open(),
              );
            } else if (item.value === 'items') this.pickItem(done, open);
            else if (item.value === 'specials') this.pickSpecial(done, open);
            else if (item.value === 'appeal') done({ kind: 'appeal' });
            else if (item.value === 'defend') done({ kind: 'defend' });
            else done({ kind: 'run' });
          },
        });
        // keep the last choice highlighted, unless it's greyed out now
        const last = this.menuCursor[cursorKey] ?? 0;
        if (!items[last]?.disabled) this.menu.setCursor(last);
        this.ui(this.menu.setDepth(65));
      };
      const done = (c: Choice) => {
        this.menu?.destroy();
        this.menu = null;
        this.desc.setText('');
        this.inputState = 'busy';
        resolve(c);
      };
      open();
    });
  }

  private pickItem(done: (c: Choice) => void, back: () => void): void {
    const gs = gameState();
    const e = this.engine;
    this.menu?.destroy();
    const items: MenuItem[] = gs.data.items.map((id, slot) => {
      const it = Database.item(id);
      // revive items only work by themselves, when Chispa is knocked out
      const auto = !!it.effect.revive && !it.effect.heal;
      return {
        label: t(it.name),
        value: `${slot}`,
        desc: t(it.desc),
        disabled: auto,
        reason: t('battle.reason.auto_item'),
      };
    });
    this.inputState = 'menu';
    this.menu = new MenuList(this, 24, 141, {
      width: 375,
      rows: Math.min(8, items.length),
      rowHeight: 36,
      items,
      descText: this.desc,
      onCancel: back,
      onSelect: (item) => {
        const id = gs.data.items[Number(item.value)];
        const def = Database.item(id);
        this.menu!.active = false;
        const choose = (ids: string[]) =>
          this.pickTarget(
            ids,
            (target) => done({ kind: 'item', item: item.value, target }),
            () => this.pickItem(done, back),
          );
        if (def.target === 'self') done({ kind: 'item', item: item.value, target: e.turn });
        else if (def.target === 'all') done({ kind: 'item', item: item.value, target: 'all' });
        else if (def.target === 'ally') choose(e.party().map((f) => f.id));
        else choose(e.enemies().map((f) => f.id));
      },
    });
    this.ui(this.menu.setDepth(65));
  }

  private pickSpecial(done: (c: Choice) => void, back: () => void): void {
    const e = this.engine;
    this.menu?.destroy();
    const items: MenuItem[] = SPECIALS.map((sp) => ({
      label: sp.name,
      value: sp.id,
      right: String(sp.cost),
      desc: sp.desc,
      disabled: !e.canUseSpecial(sp.id),
      reason: t('battle.specials.low'),
    }));
    this.inputState = 'menu';
    this.menu = new MenuList(this, 24, 141, {
      width: 375,
      rows: items.length,
      rowHeight: 36,
      items,
      descText: this.desc,
      onCancel: back,
      onSelect: (item) => done({ kind: 'special', special: item.value }),
    });
    this.ui(this.menu.setDepth(65));
  }

  /** Arrow over a target; left/right (or up/down) to switch, confirm to pick, cancel to go back. */
  private pickTarget(ids: string[], onPick: (id: string) => void, onBack: () => void): void {
    this.inputState = 'target';
    this.menu?.setVisible(false);
    let i = 0;
    const hero = this.views.get(this.engine.turn)!.sprite;
    const draw = () => {
      const v = this.views.get(ids[i])!;
      this.director.track([hero, v.sprite], 1.08, 0, 5);
      const top = v.sprite.y - v.sprite.displayHeight - 21;
      this.cursor.clear().setVisible(true);
      const bob = Math.floor(this.time.now / 250) % 2;
      this.cursor
        .fillStyle(UI.spark)
        .fillTriangle(
          v.sprite.x - 12,
          top - 15 + bob * 2,
          v.sprite.x + 12,
          top - 15 + bob * 2,
          v.sprite.x,
          top + bob * 2,
        );
      this.desc
        .setText(
          `${t('battle.pick_target')}: ${t(v.f.name)}  ${v.f.hp}/${v.f.maxHp}` +
            (v.f.charging ? `  · ${t('battle.charging_tag')}` : ''),
        )
        .setColor(css(UI.ink));
    };
    const readyAt = this.time.now + 120;
    const finish = (picked: boolean) => {
      this.events.off(Phaser.Scenes.Events.UPDATE, tick);
      this.input.off(Phaser.Input.Events.POINTER_UP, tap);
      this.cursor.setVisible(false);
      this.menu?.setVisible(true);
      if (picked) onPick(ids[i]);
      else {
        this.menu?.focus();
        this.director.to(SHOTS.command, 5);
        onBack();
      }
    };
    const tick = () => {
      draw();
      if (this.time.now < readyAt) return;
      if (input.justPressed('right') || input.justPressed('down')) i = (i + 1) % ids.length;
      else if (input.justPressed('left') || input.justPressed('up')) i = (i - 1 + ids.length) % ids.length;
      else if (input.justPressed('confirm')) finish(true);
      else if (input.justPressed('cancel')) finish(false);
    };
    const tap = (p: Phaser.Input.Pointer) => {
      if (this.time.now < readyAt || input.onTouchControl(p.x, p.y)) return;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const hit = ids.findIndex((id) => this.views.get(id)!.sprite.getBounds().contains(w.x, w.y));
      if (hit < 0) return;
      if (hit === i) finish(true);
      else i = hit;
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, tick);
    this.input.on(Phaser.Input.Events.POINTER_UP, tap);
  }

  // ── Playing moves ───────────────────────────────────────────────────

  /**
   * Plays a move from its steps in moves.json. Each "hit" step applies one hit
   * through the engine; a "command" step runs the move's action command (hero
   * only) and its rating scales the next hit, or for a double jump decides
   * whether the combo goes on.
   */
  private async playMove(
    actorId: string,
    moveId: string,
    targetId: string,
    opts: { firstStrike?: boolean; big?: boolean } = {},
  ): Promise<void> {
    const actor = this.views.get(actorId)!;
    const target = this.views.get(targetId)!;
    const move = Database.move(moveId);
    const dir = actor.f.side === 'hero' ? 1 : -1;
    const s = actor.sprite;
    // the camera follows the attacker across the ring to the target
    this.director.track([s, target.sprite], actor.f.side === 'hero' ? 1.22 : 1.18, 9);
    const runsCommands = actor.f.side === 'hero' && !opts.firstStrike && move.command !== 'none';
    const stomp = COMMANDS.stomp;
    s.setDepth(40);
    this.tweens.killTweensOf(s); // stop a flyer's hover while it acts

    let hovering = false;
    let ended = false;
    // the ring fights back: aerials burn on the ropes, run-ins may slip
    const hz = opts.firstStrike ? null : this.engine.moveHazard(actorId, moveId);
    if (hz && hz.damage > 0 && !hz.slip) {
      await this.popText(actor, t('battle.burn'), UI.rope);
      await this.showHit(actor, hz.damage, hz.ko);
      if (hz.ko) {
        await this.knockOut(actor);
        ended = true;
      }
    }
    let rating: Rating | undefined;
    let pendingStomp: Promise<CommandResult> | null = null;
    const hitsLeft = (from: number) => move.steps.slice(from).some((x) => x.do === 'hit');
    const topOf = (v: FighterView) => v.sprite.y - v.sprite.displayHeight + 9;
    const drop = (ms: number) =>
      this.tween({ targets: s, y: topOf(target), duration: ms, ease: 'Quad.easeIn' });

    for (let i = 0; i < move.steps.length; i++) {
      const step = move.steps[i];
      if (ended && step.do !== 'return') continue;
      switch (step.do) {
        case 'walk_to_target':
          this.playAnim(actor, 'walk');
          await this.tween({
            targets: s,
            x: target.sprite.x - dir * 69,
            y: target.home.y === STAGE.floorY ? STAGE.floorY : s.y,
            duration: 360,
          });
          this.playAnim(actor, 'idle');
          if (hz?.slip) {
            // feet out from under them: flat on the canvas, and the move is gone
            void this.popText(actor, t('battle.slip'), UI.grit);
            await this.tween({ targets: s, angle: dir * -80, duration: 140, ease: 'Quad.easeIn' });
            await this.showHit(actor, hz.damage, hz.ko);
            if (hz.ko) await this.knockOut(actor);
            await this.wait(200);
            if (actor.f.hp > 0 || actor.f.id === 'hero') s.setAngle(0);
            ended = true;
          }
          break;
        case 'jump_to_target': {
          // arc up to a point above the target; the fall comes with the next command or hit
          const sx = s.x;
          const sy = s.y;
          const tx = target.sprite.x - dir * 6;
          const ty = topOf(target) - 96;
          const o = { p: 0 };
          await this.tween({
            targets: o,
            p: 1,
            duration: 320,
            ease: 'Sine.easeOut',
            onUpdate: () => {
              s.x = sx + (tx - sx) * o.p;
              s.y = sy + (ty - sy) * o.p - Math.sin(o.p * Math.PI) * 60;
            },
          });
          hovering = true;
          break;
        }
        case 'anim':
          // placeholder enemies have no animations yet; their strike comes with the hit
          if (actor.f.id === 'hero' || this.hasAnim(actor, step.anim))
            await this.playAnimOnce(actor, step.anim);
          break;
        case 'command': {
          if (!runsCommands) break;
          if (move.command === 'stomp') {
            const landAt = this.time.now + stomp.fallMs;
            pendingStomp = this.commands.stomp(s, landAt);
            await drop(stomp.fallMs);
            hovering = false;
          } else if (move.command === 'timed_press') {
            const r = await this.commands.press(target.sprite);
            rating = r.rating;
            this.noteCommand(moveId, r, actor);
          } else if (move.command === 'hold_release') {
            const r = await this.commands.hold(s);
            rating = r.rating;
            this.noteCommand(moveId, r, actor);
          }
          break;
        }
        case 'hit': {
          // an enemy attacking the hero: wind up and strike, while the player can Block or Reverse
          let guard: GuardResult = 'none';
          if (actor.f.side === 'enemy' && target.f.side === 'hero' && !opts.firstStrike) {
            const g = COMMANDS.guard;
            const motionMs = hovering ? stomp.fallMs : g.windUpMs + g.strikeMs;
            const watch = this.commands.guard(this.time.now + motionMs);
            if (hovering) await drop(stomp.fallMs);
            else {
              await this.tween({ targets: s, x: s.x - dir * 15, duration: g.windUpMs, ease: 'Sine.easeOut' });
              await this.tween({ targets: s, x: s.x + dir * 27, duration: g.strikeMs, ease: 'Quad.easeIn' });
            }
            hovering = false;
            const j = await watch;
            guard = j.result;
            this.engine.log.push(`guardcmd ${j.result}${j.note ? ` ${j.note}` : ''}`);
          } else if (hovering) {
            await drop(stomp.fallMs);
            hovering = false;
          }
          const mult = (step.mult ?? 1) * (rating ? ratingMult(move.command, rating) : 1);
          let great = rating === 'great';
          rating = undefined;
          // an "all" move lands on everyone it can reach; anything else on its target
          const victims = opts.firstStrike
            ? [targetId]
            : this.engine.victimsOf(actorId, moveId, targetId).filter((id) => this.engine.get(id).hp > 0);
          let standing = 0;
          for (const vid of victims) {
            const tv = this.views.get(vid)!;
            const r = opts.firstStrike
              ? this.engine.damage(vid, rules.firstStrikeDamage + this.engine.hero.attack)
              : this.engine.hit(actorId, vid, moveId, mult, guard);
            if (r.guard === 'reversal') {
              await this.showReversal(tv, actor, r.counter ?? 0, !!r.attackerKo);
              if (r.attackerKo) ended = true;
              standing++;
              if (ended) break;
              continue;
            }
            if (r.guard === 'block') this.showBlock(tv);
            await this.showHit(tv, r.damage, r.ko);
            if (opts.big && r.damage > 0) {
              this.director.punchIn(0.26);
              this.arena.cheer(1);
            }
            if (pendingStomp) {
              const res = await pendingStomp;
              pendingStomp = null;
              this.noteCommand(moveId, res, actor);
              if (res.rating === 'miss') ended = true;
              if (res.rating === 'great') great = true;
            }
            // a GREAT hit knocks a charging enemy out of its wind-up
            if (great && !r.ko && this.engine.breakCharge(vid)) await this.showStagger(tv);
            if (r.ko) await this.knockOut(tv);
            else standing++;
          }
          if (standing === 0) ended = true;
          if (!ended && hitsLeft(i + 1)) {
            if (move.command === 'stomp' || move.steps.some((x) => x.do === 'jump_to_target')) {
              // bounce back up for the next hit
              await this.tween({
                targets: s,
                y: topOf(target) - 96,
                duration: stomp.bounceMs,
                ease: 'Quad.easeOut',
              });
              hovering = true;
            } else await this.playAnimOnce(actor, 'chop');
          }
          break;
        }
        case 'return':
          hovering = false;
          await this.returnHome(actor);
          break;
        case 'wait':
          await this.wait(step.ms);
          break;
        case 'scout':
          await this.showScout(actor, target);
          break;
        case 'heal': {
          await this.tween({ targets: s, y: s.y - 21, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
          const healed = this.engine.healFighter(targetId, move.heal ?? 0);
          target.sprite.setTintFill(0x9ff0a8);
          this.time.delayedCall(120, () => target.sprite.clearTint());
          target.bar?.setValue(target.f.hp, target.f.maxHp);
          if (target.f.side === 'hero') gameState().setHp(target.f.defId, target.f.hp);
          await this.popText(target, `+${healed}`, UI.good);
          break;
        }
      }
    }
    if (s.x !== actor.home.x || s.y !== actor.home.y) await this.returnHome(actor);
    s.setDepth(10 + actor.f.order);
    if (actor.f.airborne && actor.f.hp > 0) this.hover(actor);
  }

  /** Pip sizes up an opponent: its numbers and his Scout notes, until the player presses on. */
  private async showScout(scout: FighterView, target: FighterView): Promise<void> {
    this.director.track([scout.sprite, target.sprite], 1.25, 12);
    await this.tween({ targets: scout.sprite, y: scout.sprite.y - 15, duration: 110, yoyo: true });
    this.engine.log.push(`scout ${scout.f.id} ${target.f.id}`);
    const def = Database.enemy(target.f.defId);
    const pw = 660;
    const ph = 168;
    const px = (W - pw) / 2;
    const py = H - ph - 30;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      parts.push(this.ui(o));
      return o;
    };
    drawPanel(add(this.add.graphics()), px, py, pw, ph, { alpha: 0.96 });
    add(pixelText(this, px + 21, py + 18, t(def.name).toUpperCase(), 24, css(UI.spark)).setOrigin(0, 0));
    add(
      pixelText(
        this,
        px + 21,
        py + 54,
        tf('battle.scout.stats', {
          hp: target.f.hp,
          max: target.f.maxHp,
          atk: target.f.attack,
          def: target.f.defence,
        }),
        16,
        css(UI.ink),
      ).setOrigin(0, 0),
    );
    add(
      pixelText(this, px + 21, py + 80, t(def.scout), 16, css(UI.inkDim))
        .setLineSpacing(6)
        .setOrigin(0, 0)
        .setWordWrapWidth(pw - 42),
    );
    add(
      pixelText(
        this,
        px + pw / 2,
        py + ph - 24,
        tf('battle.results.continue', { button: input.prompt('confirm') }),
        16,
        css(UI.inkDim),
      ),
    );
    this.inputState = 'scout';
    await this.waitForConfirm();
    this.inputState = 'busy';
    for (const o of parts) o.destroy();
  }

  /** Resolves on Confirm or a tap (after a short delay so the press that opened it doesn't count). */
  private waitForConfirm(): Promise<void> {
    return new Promise<void>((resolve) => {
      const readyAt = this.time.now + 200;
      const done = () => {
        this.events.off(Phaser.Scenes.Events.UPDATE, tick);
        this.input.off(Phaser.Input.Events.POINTER_UP, tap);
        resolve();
      };
      const tick = () => {
        if (this.time.now >= readyAt && input.justPressed('confirm')) done();
      };
      const tap = (p: Phaser.Input.Pointer) => {
        if (this.time.now >= readyAt && !input.onTouchControl(p.x, p.y)) done();
      };
      this.events.on(Phaser.Scenes.Events.UPDATE, tick);
      this.input.on(Phaser.Input.Events.POINTER_UP, tap);
    });
  }

  /** An enemy winds up: camera on it, a warning, and a glow that stays until it lets go. */
  private async showCharge(v: FighterView): Promise<void> {
    this.director.track([v.sprite], 1.35, 15);
    if (!v.aura) {
      v.aura = this.add
        .ellipse(
          v.sprite.x,
          v.sprite.y - v.sprite.displayHeight / 2,
          v.sprite.displayWidth + 39,
          v.sprite.displayHeight + 27,
          UI.spark,
          0.35,
        )
        .setDepth(v.sprite.depth - 1)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: v.aura,
        alpha: 0.12,
        scaleX: 1.12,
        scaleY: 1.06,
        duration: 260,
        yoyo: true,
        repeat: -1,
      });
    }
    await this.tween({ targets: v.sprite, scaleY: 0.9, scaleX: 1.08, duration: 160, yoyo: true, repeat: 1 });
    await this.popText(v, t('battle.charging'), UI.spark);
  }

  private clearAura(v: FighterView): void {
    if (!v.aura) return;
    this.tweens.killTweensOf(v.aura);
    v.aura.destroy();
    v.aura = undefined;
  }

  private async showStagger(v: FighterView): Promise<void> {
    this.clearAura(v);
    this.director.punchIn(0.18);
    this.arena.cheer(1);
    void this.tween({ targets: v.sprite, angle: 8, duration: 70, yoyo: true, repeat: 2 });
    await this.popText(v, t('battle.staggered'), UI.good);
  }

  /** Names an enemy's move in a small panel at the top of the screen. */
  private async caption(text: string, color: number): Promise<void> {
    const w = Math.max(240, text.length * 16 + 48);
    const g = this.ui(this.add.graphics());
    drawPanel(g, W / 2 - w / 2, 126, w, 39, { alpha: 0.94 });
    const label = this.ui(pixelText(this, W / 2, 138, text.toUpperCase(), 16, css(color)));
    await this.wait(420);
    this.tween({ targets: [g, label], alpha: 0, delay: 600, duration: 200 }).then(() => {
      g.destroy();
      label.destroy();
    });
  }

  private showBlock(v: FighterView): void {
    void this.popText(v, t('battle.cmd.block'), UI.grit);
    v.sprite.setTintFill(0x9fd8ff);
    this.time.delayedCall(90, () => v.sprite.clearTint());
  }

  /** The hero takes nothing and shoves the attacker back with a counter-hit. */
  private async showReversal(
    hero: FighterView,
    attacker: FighterView,
    counter: number,
    ko: boolean,
  ): Promise<void> {
    void this.popText(hero, t('battle.cmd.reversal'), UI.spark);
    this.cameras.main.shake(120, 0.012);
    this.director.punchIn(0.22);
    this.arena.cheer(1);
    await this.tween({ targets: hero.sprite, x: hero.sprite.x + 21, duration: 70, yoyo: true });
    await this.tween({
      targets: attacker.sprite,
      x: attacker.sprite.x + 45,
      duration: 160,
      ease: 'Quad.easeOut',
    });
    await this.showHit(attacker, counter, ko);
    if (ko) await this.knockOut(attacker);
  }

  /** Logs a command result and shows its rating over the attacker. */
  private noteCommand(moveId: string, r: CommandResult, at: FighterView): void {
    this.engine.log.push(`cmd ${moveId} ${r.rating}${r.note ? ` ${r.note}` : ''}`);
    if (r.rating !== 'miss') this.engine.gainHype(r.rating);
    const key = r.rating === 'miss' ? `battle.cmd.${r.note ?? 'none'}` : `battle.cmd.${r.rating}`;
    const color = r.rating === 'great' ? UI.spark : r.rating === 'good' ? UI.ink : UI.inkDim;
    void this.popText(at, t(key), color);
  }

  private hover(v: FighterView): void {
    v.sprite.setY(v.home.y);
    this.tweens.add({
      targets: v.sprite,
      y: v.home.y - 9,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
      easeParams: [2],
    });
  }

  private async returnHome(v: FighterView): Promise<void> {
    // walking home faces away from the opponents, then turns back
    v.sprite.setFlipX(!v.baseFlip);
    this.playAnim(v, 'walk');
    await this.tween({ targets: v.sprite, x: v.home.x, y: v.home.y, duration: 320 });
    v.sprite.setFlipX(v.baseFlip);
    this.playAnim(v, 'idle');
  }

  private hasAnim(v: FighterView, anim: string): boolean {
    return this.anims.exists(animKey(v.texture, anim));
  }

  private playAnim(v: FighterView, anim: string): void {
    if (this.hasAnim(v, anim)) v.sprite.play(animKey(v.texture, anim));
  }

  /** Plays a one-shot animation; placeholder sprites get a quick lunge instead. */
  private async playAnimOnce(v: FighterView, anim: string): Promise<void> {
    if (this.hasAnim(v, anim)) {
      v.sprite.play(animKey(v.texture, anim));
      await new Promise<void>((r) => v.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => r()));
      this.playAnim(v, 'idle');
    } else {
      const dir = v.f.side === 'hero' ? 1 : -1;
      await this.tween({
        targets: v.sprite,
        x: v.sprite.x + dir * 15,
        scaleY: 0.9,
        duration: 90,
        yoyo: true,
      });
    }
  }

  private async showHit(target: FighterView, damage: number, ko: boolean): Promise<void> {
    const s = target.sprite;
    this.cameras.main.shake(damage > 0 ? 110 : 60, damage > 2 ? 0.01 : 0.006);
    // punch in on impact; big hits get the crowd off their seats
    this.director.punchIn(damage >= 3 ? 0.2 : damage > 0 ? 0.11 : 0.05);
    if (damage >= 3 || ko) this.arena.cheer(ko ? 2 : 1);
    s.setTintFill(0xffffff);
    this.time.delayedCall(70, () => s.clearTint());
    void this.popText(target, String(damage), damage > 0 ? UI.spark : UI.inkDim);
    // hit-stop: everything freezes for a moment on impact
    await this.wait(damage > 0 ? 90 : 40);
    if (target.f.side === 'hero') {
      gameState().setHp(target.f.defId, target.f.hp);
      if (this.hasAnim(target, 'hurt') && !ko) {
        target.sprite.play(animKey(target.texture, 'hurt'));
        target.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.playAnim(target, 'idle'));
      }
    } else {
      target.bar?.setValue(target.f.hp, target.f.maxHp);
      if (!ko) await this.tween({ targets: s, scaleX: 1.12, scaleY: 0.86, duration: 70, yoyo: true });
    }
  }

  private async knockOut(v: FighterView): Promise<void> {
    if (v.f.id === 'hero') return;
    if (v.f.side === 'hero') {
      // a partner stays down, flattened on the canvas, until the fight is over
      void this.popText(v, t('battle.down'), UI.rope);
      await this.tween({
        targets: v.sprite,
        scaleY: 0.3,
        scaleX: 1.2,
        alpha: 0.7,
        duration: 200,
        ease: 'Quad.easeIn',
      });
      return;
    }
    this.clearAura(v);
    // paper flip: spin flat, fade away
    this.tweens.killTweensOf(v.sprite);
    await this.tween({ targets: v.sprite, scaleX: 0, duration: 90, yoyo: true, repeat: 2 });
    await this.tween({ targets: [v.sprite, v.shadow], alpha: 0, y: '-=18', duration: 220 });
    v.bar?.setVisible(false);
  }

  private async useItem(slot: string, targetId: string): Promise<void> {
    const gs = gameState();
    const id = gs.takeItem(Number(slot));
    if (!id) return;
    const def = Database.item(id);
    const e = this.engine;
    const user = this.views.get(e.turn)!;
    bus.emit('item.used', { id, by: e.turn, target: targetId });
    e.log.push(`item ${e.turn} ${id} ${targetId}`);
    await this.popText(user, t(def.name).toUpperCase(), UI.good);
    // healing and boosts go to the chosen ally (or the user); damage to one or all opponents
    const ally = targetId === 'hero' || targetId === 'partner' ? this.views.get(targetId)! : user;
    const fx = def.effect;
    if (fx.heal) {
      const healed = e.healHero(fx.heal, ally.f.id as 'hero' | 'partner');
      gameState().setHp(ally.f.defId, ally.f.hp);
      await this.popText(ally, `+${healed}`, UI.good);
    }
    if (fx.grit) {
      gs.setGrit(gs.data.grit + fx.grit);
      await this.popText(user, `+${fx.grit}`, UI.grit);
    }
    if (fx.attackUp || fx.defenceUp) {
      e.applyBoost(ally.f.id, fx.attackUp ?? 0, fx.defenceUp ?? 0, fx.turns ?? 3);
      ally.sprite.setTintFill(0xffd070);
      this.time.delayedCall(140, () => ally.sprite.clearTint());
      const parts = [fx.attackUp ? `ATK +${fx.attackUp}` : '', fx.defenceUp ? `DEF +${fx.defenceUp}` : ''];
      await this.popText(ally, parts.filter(Boolean).join(' '), UI.spark);
    }
    if (fx.damage) {
      const targets = targetId === 'all' ? e.enemies().map((f) => f.id) : [targetId];
      for (const tid of targets) {
        const view = this.views.get(tid)!;
        const r = e.damage(tid, fx.damage);
        await this.showHit(view, r.damage, r.ko);
        if (r.ko) await this.knockOut(view);
      }
    }
  }

  // ── Hype specials and the ring ──────────────────────────────────────

  private async playSpecial(id: string): Promise<void> {
    const e = this.engine;
    const sp = special(id);
    const me = this.views.get(e.turn)!;
    await this.caption(sp.name, UI.hype);
    const r = e.useSpecial(id);
    this.arena.cheer(2);
    this.director.punchIn(0.2);
    if (sp.target === 'party') {
      const party = e.party().map((f) => this.views.get(f.id)!);
      this.director.track(
        party.map((v) => v.sprite),
        1.2,
        8,
      );
      await this.tween({ targets: party.map((v) => v.sprite), y: '-=21', duration: 140, yoyo: true });
      for (const h of r.heals) {
        const v = this.views.get(h.id)!;
        gameState().setHp(v.f.defId, v.f.hp);
        void this.popText(v, `+${h.amount}`, UI.good);
      }
      for (const id of r.boosted) {
        const v = this.views.get(id)!;
        v.sprite.setTintFill(0xffd070);
        this.time.delayedCall(140, () => v.sprite.clearTint());
        const fx = sp.effect;
        const parts = [fx.attackUp ? `ATK +${fx.attackUp}` : '', fx.defenceUp ? `DEF +${fx.defenceUp}` : ''];
        void this.popText(v, parts.filter(Boolean).join(' '), UI.spark);
      }
      await this.wait(500);
    } else {
      this.director.to(SHOTS.wide, 4);
      await this.tween({
        targets: me.sprite,
        y: me.sprite.y - 45,
        duration: 200,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
      this.cameras.main.flash(120, 255, 220, 140);
      for (const h of r.hits) {
        const v = this.views.get(h.target)!;
        await this.showHit(v, h.damage, h.ko);
        if (h.ko) await this.knockOut(v);
      }
    }
  }

  /** Shows a round-start happening the engine already applied. */
  private async showRoundEvent(ev: RoundEvent): Promise<void> {
    const v = this.views.get(ev.target)!;
    if (ev.kind === 'spotlight') {
      this.drawSpot();
      this.director.track([v.sprite], 1.25, 12);
      await this.popText(v, t('battle.spotlight'), UI.spark);
      return;
    }
    if (ev.kind === 'falling') {
      this.director.track([v.sprite], 1.15, 12);
      await this.caption(hazard('falling_light').name, UI.rope);
      // a light rig drops from the rafters
      const rig = this.add.graphics().setDepth(70);
      rig.fillStyle(0x2a2a33).fillRect(-21, -9, 42, 12);
      rig.fillStyle(0xfff2b0).fillRect(-15, 3, 30, 6);
      rig.setPosition(v.sprite.x, v.sprite.y - 330);
      await this.tween({
        targets: rig,
        y: v.sprite.y - v.sprite.displayHeight + 6,
        duration: 320,
        ease: 'Quad.easeIn',
      });
      rig.destroy();
      this.cameras.main.shake(160, 0.014);
      await this.showHit(v, ev.damage, ev.ko);
      if (ev.ko) await this.knockOut(v);
      return;
    }
    // the crowd throws something
    this.director.track([v.sprite], 1.15, 12);
    const thing = this.add.graphics().setDepth(70);
    thing.fillStyle(ev.heal !== undefined ? 0x7fd6ff : 0x8a7a5a).fillRect(-5, -5, 9, 9);
    const sx = v.sprite.x + (v.f.side === 'hero' ? -180 : 180);
    const sy = STAGE.floorY - 240;
    thing.setPosition(sx, sy);
    const o = { p: 0 };
    const tx = v.sprite.x;
    const ty = v.sprite.y - v.sprite.displayHeight / 2;
    await this.tween({
      targets: o,
      p: 1,
      duration: 420,
      onUpdate: () =>
        thing.setPosition(sx + (tx - sx) * o.p, sy + (ty - sy) * o.p - Math.sin(o.p * Math.PI) * 75),
    });
    thing.destroy();
    if (ev.heal !== undefined) {
      if (v.f.side === 'hero') gameState().setHp(v.f.defId, v.f.hp);
      else v.bar?.setValue(v.f.hp, v.f.maxHp);
      await this.popText(v, `${t('battle.snack')} +${ev.heal}`, UI.good);
    } else {
      void this.popText(v, t('battle.junk'), UI.inkDim);
      await this.showHit(v, ev.damage ?? 1, ev.ko);
      if (ev.ko) await this.knockOut(v);
    }
  }

  /** A soft cone of light, drawn once and moved onto whoever is lit (see update). */
  private drawSpot(): void {
    if (this.spot) return;
    const g = this.add.graphics().setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
    g.fillStyle(0xfff2c0, 0.16)
      .fillTriangle(-15, -390, 15, -390, 51, 6)
      .fillTriangle(-15, -390, -51, 6, 51, 6);
    g.fillStyle(0xfff2c0, 0.22).fillEllipse(0, 3, 108, 18);
    this.spot = g;
  }

  // ── Endings ─────────────────────────────────────────────────────────

  private async victory(): Promise<void> {
    const r = this.engine.rewards();
    const gs = gameState();
    const before = { level: gs.data.level, xp: gs.data.xp };
    gs.addCoins(r.coins);
    const levels = gs.addXp(r.xp);
    const hero = this.views.get('hero')!;
    // close-up on the winner while the crowd goes wild
    this.director.to({ x: hero.sprite.x + 45, y: STAGE.floorY - 72, zoom: 1.6 }, 3);
    this.arena.cheer(2);
    this.playAnim(hero, 'chop');
    await this.banner(t('battle.victory'), UI.spark, 700);
    await this.showResults(r, before, levels);
    this.finish('win');
  }

  /** Who was beaten, coins and XP earned, and the XP bar filling toward the next level. */
  private async showResults(
    r: { xp: number; coins: number },
    before: { level: number; xp: number },
    levels: number,
  ): Promise<void> {
    const gs = gameState();
    const groups = new Map<string, { name: string; count: number; xp: number }>();
    for (const f of this.engine.enemies(false)) {
      const g = groups.get(f.defId) ?? { name: t(f.name), count: 0, xp: 0 };
      g.count++;
      g.xp += f.xp;
      groups.set(f.defId, g);
    }
    const pw = 450;
    const rows = groups.size;
    const ph = 246 + rows * 21;
    const px = W - pw - 30;
    const py = Math.round((H - ph) / 2);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      parts.push(this.ui(o));
      return o;
    };
    const g = add(this.add.graphics());
    drawPanel(g, px, py, pw, ph, { alpha: 0.96 });
    add(pixelText(this, px + pw / 2, py + 21, t('battle.results.title'), 24, css(UI.spark)));
    let y = py + 54;
    const row = (left: string, right: string, color: number = UI.ink) => {
      add(pixelText(this, px + 21, y, left, 16, css(color)).setOrigin(0, 0));
      add(pixelText(this, px + pw - 21, y, right, 16, css(color)).setOrigin(1, 0));
      y += 21;
    };
    for (const e of groups.values())
      row(e.count > 1 ? `${e.name} ×${e.count}` : e.name, `${e.xp} XP`, UI.inkDim);
    y += 6;
    row(t('battle.results.coins'), `+${r.coins}`);
    row(t('battle.results.total'), `+${r.xp}`, UI.spark);
    y += 9;
    const lv = add(
      pixelText(this, px + 21, y, tf('battle.results.level', { n: before.level }), 16, css(UI.ink)).setOrigin(
        0,
        0,
      ),
    );
    y += 21;
    // XP bar animates from where it was to where it ends, rolling over on each level up
    const barX = px + 21;
    const barW = pw - 42;
    const bar = add(this.add.graphics());
    const drawBar = (frac: number) => {
      bar.clear().fillStyle(UI.hypeBack).fillRect(barX, y, barW, 12);
      bar.fillStyle(UI.hype).fillRect(barX, y, Math.round(barW * Math.min(1, frac)), 12);
    };
    let level = before.level;
    let xp = before.xp;
    drawBar(xp / xpToNext(level));
    const next = add(pixelText(this, px + 21, y + 21, '', 16, css(UI.inkDim)).setOrigin(0, 0));
    const showNext = () => next.setText(tf('battle.results.next', { xp, need: xpToNext(level) }));
    showNext();
    const note = add(pixelText(this, px + pw / 2, y + 51, '', 16, css(UI.good)));
    const note2 = add(pixelText(this, px + pw / 2, y + 72, '', 16, css(UI.good)));
    this.inputState = 'results';
    await this.wait(250);
    let left = r.xp;
    while (left > 0) {
      const need = xpToNext(level);
      const step = Math.min(left, need - xp);
      const o = { v: xp };
      await this.tween({
        targets: o,
        v: xp + step,
        duration: 200 + step * 30,
        onUpdate: () => {
          drawBar(o.v / need);
          next.setText(tf('battle.results.next', { xp: Math.floor(o.v), need }));
        },
      });
      xp += step;
      left -= step;
      if (xp >= need && level < gs.data.level) {
        level++;
        xp = 0;
        lv.setText(tf('battle.results.level', { n: level }));
        note.setText(t('battle.results.levelup'));
        note2.setText(t('battle.results.levelup_note'));
        this.arena.cheer(2);
        this.director.punchIn(0.12);
        await this.tween({ targets: lv, scale: 1.3, duration: 120, yoyo: true });
        drawBar(0);
      } else if (xp >= need) break; // level cap
    }
    level = gs.data.level;
    xp = gs.data.xp;
    showNext();
    if (levels > 0 && !note.text) note.setText(t('battle.results.levelup'));
    const prompt = add(
      pixelText(
        this,
        px + pw / 2,
        py + ph - 24,
        tf('battle.results.continue', { button: input.prompt('confirm') }),
        16,
        css(UI.inkDim),
      ),
    );
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 500, yoyo: true, repeat: -1 });
    await this.waitForConfirm();
    this.inputState = 'busy';
    this.tweens.killTweensOf(prompt);
    for (const o of parts) o.destroy();
  }

  private async defeat(): Promise<void> {
    const hero = this.views.get('hero')!;
    this.director.to({ x: hero.sprite.x, y: STAGE.floorY - 45, zoom: 1.45 }, 2.5);
    await this.tween({ targets: hero.sprite, angle: -90, y: STAGE.floorY - 12, duration: 300 });
    await this.banner(t('battle.defeat'), UI.rope, 900);
    await this.wait(700);
    if (this.loseOk) {
      // a fight the story lets you lose: back to the room on your feet
      const gs = gameState();
      gs.setHp(gs.hero().id, gs.hero().maxHp);
      return this.finish('lose');
    }
    this.inputState = 'busy';
    SceneLoader.gameOver(this, this.start.returnTo);
  }

  /** Uses the first item that revives, if there is one. Returns whether Chispa got back up. */
  private async tryRevive(): Promise<boolean> {
    const gs = gameState();
    const id = gs.data.items.find((i) => Database.item(i).effect.revive);
    if (!id) return false;
    gs.takeItem(id);
    const amount = Database.item(id).effect.revive!;
    const e = this.engine;
    e.hero.hp = Math.min(e.hero.maxHp, amount);
    e.log.push(`revive hero ${id} +${e.hero.hp}`);
    gs.setHp(gs.hero().id, e.hero.hp);
    const hero = this.views.get('hero')!;
    this.director.track([hero.sprite], 1.35, 15);
    void this.popText(hero, t(Database.item(id).name).toUpperCase(), UI.good);
    await this.tween({ targets: hero.sprite, angle: -90, duration: 160 });
    await this.wait(300);
    await this.tween({ targets: hero.sprite, angle: 0, duration: 220, ease: 'Back.easeOut' });
    hero.sprite.setTintFill(0x9ff0a8);
    this.time.delayedCall(140, () => hero.sprite.clearTint());
    this.arena.cheer(2);
    await this.popText(hero, `${t('battle.revived')} +${e.hero.hp}`, UI.good);
    return true;
  }

  private finish(result: BattleResult): void {
    this.inputState = 'busy';
    // a knocked-down partner gets back up once the fight is over
    const p = this.engine.partner;
    if (p && p.hp <= 0) gameState().setHp(p.defId, rules.partnerReviveHp);
    SceneLoader.endBattle(this, this.start.returnTo, {
      result,
      formation: this.start.formation,
      fieldEnemyId: this.start.fieldEnemyId,
    });
  }

  // ── Small helpers ───────────────────────────────────────────────────

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({ ...config, onComplete: () => resolve() });
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, () => resolve()));
  }

  private async banner(text: string, color: number, hold = 550): Promise<void> {
    const shadow = this.ui(pixelText(this, W / 2 + 4, 202, text, 48, '#1b0a10'));
    const b = this.ui(pixelText(this, W / 2, 198, text, 48, css(color)));
    b.setScale(1, 0);
    shadow.setScale(1, 0);
    await this.tween({ targets: [b, shadow], scaleY: 1, duration: 120, ease: 'Back.easeOut' });
    await this.wait(hold);
    await this.tween({ targets: [b, shadow], alpha: 0, duration: 180 });
    b.destroy();
    shadow.destroy();
  }

  private popText(v: FighterView, text: string, color: number): Promise<void> {
    const y = v.sprite.y - v.sprite.displayHeight - 12;
    const p = pixelText(this, v.sprite.x, y, text, 24, css(color)).setDepth(85);
    const outline = pixelText(this, v.sprite.x + 3, y + 3, text, 24, '#1b0a10').setDepth(84);
    return this.tween({ targets: [p, outline], y: '-=33', alpha: 0, delay: 380, duration: 320 }).then(() => {
      p.destroy();
      outline.destroy();
    });
  }
}
