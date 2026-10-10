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

type Choice =
  | { kind: 'move'; move: string; target: string }
  | { kind: 'item'; item: string; target: string }
  | { kind: 'defend' }
  | { kind: 'run' };

interface FighterView {
  f: Fighter;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  bar?: Bar;
  home: { x: number; y: number };
}

/** The hero uses the test wrestler until Kid Chispa's real sprite exists. */
const HERO_TEXTURE = 'spr_test_dummy';

/** Fixed camera framings. Moves use tracking shots instead (see playMove). */
const SHOTS: Record<string, Shot> = {
  /** Opening: high on the crowd and the lights, before sweeping down to the ring. */
  intro: { x: ARENA.cx, y: 150, zoom: 1.7 },
  /** The whole ring. */
  wide: { x: ARENA.cx, y: STAGE.floorY - 8, zoom: 1 },
  /** Your turn: Chispa just right of the command menu, the opponents across the ring. */
  command: { x: STAGE.heroX + 20, y: STAGE.floorY - 8, zoom: 1 },
};

export class BattleScene extends Phaser.Scene {
  engine!: BattleEngine;
  /** What the battle is waiting for — read by the browser test. */
  inputState: 'busy' | 'menu' | 'target' = 'busy';
  private start!: BattleStart;
  private views = new Map<string, FighterView>();
  private desc!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private menu: MenuList | null = null;
  private cursor!: Phaser.GameObjects.Graphics;
  commands!: CommandRunner;
  director!: CameraDirector;
  private arena!: Arena;
  /** HUD, menus and banners live here, drawn by a fixed camera so they never pan or zoom. */
  private uiLayer!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private menuCursor = 0;

  constructor() {
    super('battle');
  }

  create(start: BattleStart): void {
    this.start = start;
    this.views.clear();
    this.menu = null;
    this.menuCursor = 0;
    this.inputState = 'busy';
    const gs = gameState();
    const hero = Database.character(gs.hero().id);
    this.engine = new BattleEngine(
      Database,
      hero,
      { hp: gs.hero().hp, maxHp: gs.hero().maxHp },
      Database.formation(start.formation),
    );
    this.registry.set('battleSeed', this.engine.rng.seed);

    this.arena = drawStage(this);
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
    const shadow = this.add.ellipse(home.x, STAGE.floorY, 40, 8, 0x000000, 0.3).setDepth(5);
    const isHero = f.side === 'hero';
    const sprite = this.add
      .sprite(home.x, home.y, isHero ? HERO_TEXTURE : f.sprite, isHero ? 'idle_00' : undefined)
      .setOrigin(0.5, 1)
      .setDepth(10 + f.order);
    if (isHero) sprite.play(animKey(HERO_TEXTURE, 'idle'));
    const view: FighterView = { f, sprite, shadow, home };
    if (!isHero) {
      view.bar = new Bar(
        this,
        home.x - 22,
        STAGE.floorY + 6,
        44,
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
    drawPanel(g, 8, 8, 236, 66, { alpha: 0.94 });
    this.ui(pixelText(this, 20, 18, t('char.chispa').toUpperCase(), 8, css(UI.spark)).setOrigin(0, 0));
    const hp = this.ui(new Bar(this, 20, 34, 212, BAR_STYLES.hp, gs.hero().hp, gs.hero().maxHp));
    const grit = this.ui(new Bar(this, 20, 52, 212, BAR_STYLES.grit, gs.data.grit, gs.data.maxGrit));
    const offs = [
      bus.on('hp.changed', (e) => e.who === gs.hero().id && hp.setValue(e.hp, e.maxHp)),
      bus.on('grit.changed', (e) => grit.setValue(e.grit, e.maxGrit)),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));

    this.roundText = this.ui(pixelText(this, W - 14, 14, '', 8, css(UI.inkDim)).setOrigin(1, 0));
    this.desc = this.ui(
      pixelText(this, 16, H - 26, '', 8)
        .setOrigin(0, 0)
        .setWordWrapWidth(W - 32),
    );
    const seed = `SEED ${this.engine.rng.seed}`;
    this.ui(
      tinyText(this, W - 8 - tinyTextWidth(seed) * 2, H - 12, seed, css(UI.border))
        .setOrigin(0)
        .setScale(2),
    );
  }

  /** Shadows stay on the canvas and follow their fighter sideways; the camera eases toward its shot. */
  update(_t: number, dt: number): void {
    this.director.update(dt);
    for (const v of this.views.values()) {
      v.shadow.x = v.sprite.x;
      if (v.bar) v.bar.x = Math.round(v.sprite.x - 22);
      const lift = Math.max(0, STAGE.floorY - v.sprite.y);
      v.shadow.setScale(Math.max(0.5, 1 - lift / 160));
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
    e.begin(this.start.firstStrike === 'enemy' ? 'enemy' : null);
    if (e.enemies().length === 0) e.phase = 'victory';

    for (let guard = 0; guard < 500; guard++) {
      this.roundText.setText(tf('battle.round', { n: e.round }));
      if (e.phase === 'command') {
        this.director.to(SHOTS.command, 5);
        const choice = await this.chooseAction();
        await this.perform(choice);
      } else if (e.phase === 'enemy') {
        const plan = e.nextEnemyPlan();
        if (plan) {
          if (debugState.god) e.hero.guard = 99;
          await this.playMove(plan.actor, plan.move, plan.target);
        }
        e.endEnemyAction();
      } else break;
    }

    if (e.phase === 'victory') return this.victory();
    if (e.phase === 'defeat') return this.defeat();
    if (e.phase === 'fled') return this.finish('run');
  }

  private async perform(c: Choice): Promise<void> {
    const e = this.engine;
    const gs = gameState();
    if (c.kind === 'move') {
      const m = Database.move(c.move);
      gs.spendGrit(m.gritCost);
      e.beginHeroAction();
      await this.playMove('hero', c.move, c.target);
    } else if (c.kind === 'item') {
      e.beginHeroAction();
      this.director.track([this.views.get(c.target)!.sprite, this.views.get('hero')!.sprite], 1.2);
      await this.useItem(c.item, c.target);
    } else if (c.kind === 'defend') {
      e.defend();
      this.director.track([this.views.get('hero')!.sprite], 1.35, 10);
      await this.popText(this.views.get('hero')!, t('battle.guard'), UI.grit);
    } else {
      const ok = e.tryRun();
      if (!ok) await this.banner(t('battle.run_failed'), UI.rope);
      else {
        const hero = this.views.get('hero')!;
        this.director.track([hero.sprite], 1.15);
        hero.sprite.setFlipX(true).play(animKey(HERO_TEXTURE, 'walk'));
        await this.tween({ targets: hero.sprite, x: -40, duration: 500 });
        await this.banner(t('battle.fled'), UI.ink);
      }
    }
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
      const items: MenuItem[] = e.hero.moves.map((id) => {
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
      items.push(
        {
          label: t('battle.items'),
          value: 'items',
          right: String(bag.length),
          desc: t('battle.items.desc'),
          disabled: bag.length === 0,
          reason: t('battle.items.empty'),
        },
        { label: t('battle.defend'), value: 'defend', desc: t('battle.defend.desc') },
        { label: t('battle.run'), value: 'run', desc: t('battle.run.desc') },
      );

      const open = () => {
        this.inputState = 'menu';
        this.menu?.destroy();
        this.menu = new MenuList(this, 16, 94, {
          width: 250,
          rows: items.length,
          rowHeight: 24,
          items,
          descText: this.desc,
          cancellable: false,
          onSelect: (item, i) => {
            this.menuCursor = i;
            this.menu!.active = false;
            if (item.value.startsWith('move:')) {
              const move = item.value.slice(5);
              this.pickTarget(
                e.targetsFor(move).map((f) => f.id),
                (target) => done({ kind: 'move', move, target }),
                () => open(),
              );
            } else if (item.value === 'items') this.pickItem(done, open);
            else if (item.value === 'defend') done({ kind: 'defend' });
            else done({ kind: 'run' });
          },
        });
        // keep the last choice highlighted, unless it's greyed out now
        if (!items[this.menuCursor]?.disabled) this.menu.setCursor(this.menuCursor);
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
      return { label: t(it.name), value: `${slot}`, desc: t(it.desc) };
    });
    this.inputState = 'menu';
    this.menu = new MenuList(this, 16, 94, {
      width: 250,
      rows: Math.min(8, items.length),
      rowHeight: 24,
      items,
      descText: this.desc,
      onCancel: back,
      onSelect: (item) => {
        const id = gs.data.items[Number(item.value)];
        const def = Database.item(id);
        this.menu!.active = false;
        if (def.target === 'self') done({ kind: 'item', item: item.value, target: 'hero' });
        else
          this.pickTarget(
            e.enemies().map((f) => f.id),
            (target) => done({ kind: 'item', item: item.value, target }),
            () => this.pickItem(done, back),
          );
      },
    });
    this.ui(this.menu.setDepth(65));
  }

  /** Arrow over a target; left/right (or up/down) to switch, confirm to pick, cancel to go back. */
  private pickTarget(ids: string[], onPick: (id: string) => void, onBack: () => void): void {
    this.inputState = 'target';
    this.menu?.setVisible(false);
    let i = 0;
    const hero = this.views.get('hero')!.sprite;
    const draw = () => {
      const v = this.views.get(ids[i])!;
      this.director.track([hero, v.sprite], 1.08, 0, 5);
      const top = v.sprite.y - v.sprite.displayHeight - 14;
      this.cursor.clear().setVisible(true);
      const bob = Math.floor(this.time.now / 250) % 2;
      this.cursor
        .fillStyle(UI.spark)
        .fillTriangle(v.sprite.x - 8, top - 10 + bob, v.sprite.x + 8, top - 10 + bob, v.sprite.x, top + bob);
      this.desc
        .setText(`${t('battle.pick_target')}: ${t(v.f.name)}  ${v.f.hp}/${v.f.maxHp}`)
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
    opts: { firstStrike?: boolean } = {},
  ): Promise<void> {
    const actor = this.views.get(actorId)!;
    const target = this.views.get(targetId)!;
    const move = Database.move(moveId);
    const dir = actor.f.side === 'hero' ? 1 : -1;
    const s = actor.sprite;
    // the camera follows the attacker across the ring to the target
    this.director.track([s, target.sprite], actor.f.side === 'hero' ? 1.22 : 1.18, 6);
    const runsCommands = actor.f.side === 'hero' && !opts.firstStrike && move.command !== 'none';
    const stomp = COMMANDS.stomp;
    s.setDepth(40);
    this.tweens.killTweensOf(s); // stop a flyer's hover while it acts

    let hovering = false;
    let ended = false;
    let rating: Rating | undefined;
    let pendingStomp: Promise<CommandResult> | null = null;
    const hitsLeft = (from: number) => move.steps.slice(from).some((x) => x.do === 'hit');
    const topOf = (v: FighterView) => v.sprite.y - v.sprite.displayHeight + 6;
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
            x: target.sprite.x - dir * 46,
            y: target.home.y === STAGE.floorY ? STAGE.floorY : s.y,
            duration: 360,
          });
          this.playAnim(actor, 'idle');
          break;
        case 'jump_to_target': {
          // arc up to a point above the target; the fall comes with the next command or hit
          const sx = s.x;
          const sy = s.y;
          const tx = target.sprite.x - dir * 4;
          const ty = topOf(target) - 64;
          const o = { p: 0 };
          await this.tween({
            targets: o,
            p: 1,
            duration: 320,
            ease: 'Sine.easeOut',
            onUpdate: () => {
              s.x = sx + (tx - sx) * o.p;
              s.y = sy + (ty - sy) * o.p - Math.sin(o.p * Math.PI) * 40;
            },
          });
          hovering = true;
          break;
        }
        case 'anim':
          // placeholder enemies have no animations yet; their strike comes with the hit
          if (actor.f.side === 'hero' || this.hasAnim(actor, step.anim))
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
              await this.tween({ targets: s, x: s.x - dir * 10, duration: g.windUpMs, ease: 'Sine.easeOut' });
              await this.tween({ targets: s, x: s.x + dir * 18, duration: g.strikeMs, ease: 'Quad.easeIn' });
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
          rating = undefined;
          const r = opts.firstStrike
            ? this.engine.damage(targetId, rules.firstStrikeDamage + this.engine.hero.attack)
            : this.engine.hit(actorId, targetId, moveId, mult, guard);
          if (r.guard === 'reversal') {
            await this.showReversal(target, actor, r.counter ?? 0, !!r.attackerKo);
            if (r.attackerKo) ended = true;
            break;
          }
          if (r.guard === 'block') this.showBlock(target);
          await this.showHit(target, r.damage, r.ko);
          if (pendingStomp) {
            const res = await pendingStomp;
            pendingStomp = null;
            this.noteCommand(moveId, res, actor);
            if (res.rating === 'miss') ended = true;
          }
          if (r.ko) {
            await this.knockOut(target);
            ended = true;
          }
          if (!ended && hitsLeft(i + 1)) {
            // bounce back up for the next hit
            await this.tween({
              targets: s,
              y: topOf(target) - 64,
              duration: stomp.bounceMs,
              ease: 'Quad.easeOut',
            });
            hovering = true;
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
      }
    }
    if (s.x !== actor.home.x || s.y !== actor.home.y) await this.returnHome(actor);
    s.setDepth(10 + actor.f.order);
    if (actor.f.airborne && actor.f.hp > 0) this.hover(actor);
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
    await this.tween({ targets: hero.sprite, x: hero.sprite.x + 14, duration: 70, yoyo: true });
    await this.tween({
      targets: attacker.sprite,
      x: attacker.sprite.x + 30,
      duration: 160,
      ease: 'Quad.easeOut',
    });
    await this.showHit(attacker, counter, ko);
    if (ko) await this.knockOut(attacker);
  }

  /** Logs a command result and shows its rating over the attacker. */
  private noteCommand(moveId: string, r: CommandResult, at: FighterView): void {
    this.engine.log.push(`cmd ${moveId} ${r.rating}${r.note ? ` ${r.note}` : ''}`);
    const key = r.rating === 'miss' ? `battle.cmd.${r.note ?? 'none'}` : `battle.cmd.${r.rating}`;
    const color = r.rating === 'great' ? UI.spark : r.rating === 'good' ? UI.ink : UI.inkDim;
    void this.popText(at, t(key), color);
  }

  private hover(v: FighterView): void {
    v.sprite.setY(v.home.y);
    this.tweens.add({
      targets: v.sprite,
      y: v.home.y - 6,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
      easeParams: [2],
    });
  }

  private async returnHome(v: FighterView): Promise<void> {
    v.sprite.setFlipX(v.f.side === 'hero');
    this.playAnim(v, 'walk');
    await this.tween({ targets: v.sprite, x: v.home.x, y: v.home.y, duration: 320 });
    v.sprite.setFlipX(false);
    this.playAnim(v, 'idle');
  }

  private hasAnim(v: FighterView, anim: string): boolean {
    return v.f.side === 'hero' && this.anims.exists(animKey(HERO_TEXTURE, anim));
  }

  private playAnim(v: FighterView, anim: string): void {
    if (this.hasAnim(v, anim)) v.sprite.play(animKey(HERO_TEXTURE, anim));
  }

  /** Plays a one-shot animation; placeholder sprites get a quick lunge instead. */
  private async playAnimOnce(v: FighterView, anim: string): Promise<void> {
    if (this.hasAnim(v, anim)) {
      v.sprite.play(animKey(HERO_TEXTURE, anim));
      await new Promise<void>((r) => v.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => r()));
      this.playAnim(v, 'idle');
    } else {
      const dir = v.f.side === 'hero' ? 1 : -1;
      await this.tween({
        targets: v.sprite,
        x: v.sprite.x + dir * 10,
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
      const gs = gameState();
      gs.setHp(gs.hero().id, this.engine.hero.hp);
      if (this.hasAnim(target, 'hurt') && !ko) {
        target.sprite.play(animKey(HERO_TEXTURE, 'hurt'));
        target.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.playAnim(target, 'idle'));
      }
    } else {
      target.bar?.setValue(target.f.hp, target.f.maxHp);
      if (!ko) await this.tween({ targets: s, scaleX: 1.12, scaleY: 0.86, duration: 70, yoyo: true });
    }
  }

  private async knockOut(v: FighterView): Promise<void> {
    if (v.f.side === 'hero') return;
    // paper flip: spin flat, fade away
    this.tweens.killTweensOf(v.sprite);
    await this.tween({ targets: v.sprite, scaleX: 0, duration: 90, yoyo: true, repeat: 2 });
    await this.tween({ targets: [v.sprite, v.shadow], alpha: 0, y: '-=12', duration: 220 });
    v.bar?.setVisible(false);
  }

  private async useItem(slot: string, targetId: string): Promise<void> {
    const gs = gameState();
    const id = gs.takeItem(Number(slot));
    if (!id) return;
    const def = Database.item(id);
    const hero = this.views.get('hero')!;
    bus.emit('item.used', { id, by: 'hero', target: targetId });
    await this.popText(hero, t(def.name).toUpperCase(), UI.good);
    if (def.effect.heal) {
      const healed = this.engine.healHero(def.effect.heal);
      gs.setHp(gs.hero().id, this.engine.hero.hp);
      await this.popText(hero, `+${healed}`, UI.good);
    }
    if (def.effect.grit) {
      gs.setGrit(gs.data.grit + def.effect.grit);
      await this.popText(hero, `+${def.effect.grit}`, UI.grit);
    }
    if (def.effect.damage) {
      const target = this.views.get(targetId)!;
      const r = this.engine.damage(targetId, def.effect.damage);
      await this.showHit(target, r.damage, r.ko);
      if (r.ko) await this.knockOut(target);
    }
  }

  // ── Endings ─────────────────────────────────────────────────────────

  private async victory(): Promise<void> {
    const r = this.engine.rewards();
    const gs = gameState();
    gs.addCoins(r.coins);
    gs.addXp(r.xp);
    const hero = this.views.get('hero')!;
    // close-up on the winner while the crowd goes wild
    this.director.to({ x: hero.sprite.x + 30, y: STAGE.floorY - 48, zoom: 1.6 }, 3);
    this.arena.cheer(2);
    hero.sprite.play(animKey(HERO_TEXTURE, 'chop'));
    await this.banner(t('battle.victory'), UI.spark, 900);
    const line = this.ui(
      pixelText(this, W / 2, 168, tf('battle.rewards', { coins: r.coins, xp: r.xp }), 16, css(UI.ink)),
    );
    await this.wait(900);
    line.destroy();
    this.finish('win');
  }

  private async defeat(): Promise<void> {
    const hero = this.views.get('hero')!;
    this.director.to({ x: hero.sprite.x, y: STAGE.floorY - 30, zoom: 1.45 }, 2.5);
    await this.tween({ targets: hero.sprite, angle: -90, y: STAGE.floorY - 8, duration: 300 });
    await this.banner(t('battle.defeat'), UI.rope, 900);
    this.desc.setText(t('battle.defeat_note')).setColor(css(UI.inkDim));
    await this.wait(1200);
    const gs = gameState();
    gs.setHp(gs.hero().id, gs.hero().maxHp);
    this.finish('lose');
  }

  private finish(result: BattleResult): void {
    this.inputState = 'busy';
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
    const shadow = this.ui(pixelText(this, W / 2 + 3, 135, text, 32, '#1b0a10'));
    const b = this.ui(pixelText(this, W / 2, 132, text, 32, css(color)));
    b.setScale(1, 0);
    shadow.setScale(1, 0);
    await this.tween({ targets: [b, shadow], scaleY: 1, duration: 120, ease: 'Back.easeOut' });
    await this.wait(hold);
    await this.tween({ targets: [b, shadow], alpha: 0, duration: 180 });
    b.destroy();
    shadow.destroy();
  }

  private popText(v: FighterView, text: string, color: number): Promise<void> {
    const y = v.sprite.y - v.sprite.displayHeight - 8;
    const p = pixelText(this, v.sprite.x, y, text, 16, css(color)).setDepth(85);
    const outline = pixelText(this, v.sprite.x + 2, y + 2, text, 16, '#1b0a10').setDepth(84);
    return this.tween({ targets: [p, outline], y: '-=22', alpha: 0, delay: 380, duration: 320 }).then(() => {
      p.destroy();
      outline.destroy();
    });
  }
}
