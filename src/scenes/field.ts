// Grey-box field in 3D style. Rooms are boxes measured in world units: a whole
// number of screens wide, with depth you walk into and blocks you can climb or
// jump onto. Characters are flat paper sprites with shadows; the camera follows
// sideways. Touching an enemy starts its battle; landing on one gives you the
// First Strike (unless it's spiky).

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { input } from '../systems/input';
import { animKey } from '../systems/anim_builder';
import { debugState } from '../systems/debug_state';
import { Bar, BAR_STYLES, drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { hintLine } from '../ui/bench';
import { UI, css } from '../ui/theme';
import { SceneLoader, type BattleEnd, type RoomEntry } from '../managers/scene_loader';
import { bus } from '../managers/event_bus';
import { gameState, type Facing } from '../managers/game_state';
import { Database } from '../managers/database';
import {
  WORLD,
  U,
  project,
  spriteScale,
  depthScale,
  cameraCentre,
  fogAmount,
  mixColor,
  moveBody,
  groundAt,
  sortDepth,
  flatDistance,
  cameraX,
  cameraY,
  exitGate,
  outlineOf,
  insideOutline,
  depthOnBlock,
  type Body,
  type RoomShape,
} from '../field/world';
import { drawRoom, type RoomView } from '../field/room_view';
import { buildShape } from '../field/room_shape';
import type { Condition, ObjectDef, RoomDef, RoomExit } from '../field/room_types';
import { MessageBox, type Line } from '../ui/message_box';
import { t, tf } from '../managers/strings';
import { blockDepth, type Block } from '../field/world';
import { ROOMS } from '../field/rooms';
import rules from '../data/rules.json';

interface Actor {
  body: Body;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  /** Horizontal squash for the paper-flip turn (1 = flat to the camera). */
  squash: number;
}

interface FieldEnemy extends Actor {
  id: string;
  /** false = a story fight: once beaten, gone for good. */
  respawn: boolean;
  formation: string;
  spiky: boolean;
  flying: boolean;
  homeX: number;
  patrol: number;
  dir: number;
  chasing: boolean;
}

/** A person, sign, chest, heal block or trigger placed in the room. */
interface FieldObject {
  def: ObjectDef;
  sprite?: Phaser.GameObjects.Sprite;
  shadow?: Phaser.GameObjects.Ellipse;
  /** Solid footprint (not drawn: the sprite is the look). */
  block?: Block;
  visible: boolean;
  /** Triggers: the player is standing in it (fires on the way in only). */
  inside?: boolean;
}

/** Look and solid size (units) of each placeable thing. */
const OBJECT_LOOK: Record<string, { sprite?: string; w: number; d: number; h: number }> = {
  npc: { w: 0.8, d: 0.6, h: 2 },
  sign: { sprite: 'spr_obj_sign', w: 0.7, d: 0.3, h: 1.2 },
  chest: { sprite: 'spr_obj_chest', w: 1, d: 0.7, h: 0.7 },
  heal: { sprite: 'spr_obj_heal', w: 1, d: 1, h: 1 },
  trigger: { w: 0, d: 0, h: 0 },
};

export class FieldScene extends Phaser.Scene {
  roomId = 'test_a';
  private room!: RoomDef;
  private shape!: RoomShape;
  player!: Actor;
  enemies: FieldEnemy[] = [];
  private facing: Facing = 'right';
  private striking = false;
  private leaving = false;
  /** Time left (ms) during which enemies can't start a battle or notice you, after running away. */
  graceMs = 0;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private camX = 0;
  private camY = 0;
  private bounds = { top: 0, bottom: H };
  private view!: RoomView;
  /** World x at the middle of the screen, for the perspective projection. */
  private cx = 0;
  private exits: RoomExit[] = [];
  objects: FieldObject[] = [];
  msg!: MessageBox;
  /** A message is up: the player can't move. */
  talking = false;
  private interactReadyAt = 0;
  private marker!: Phaser.GameObjects.Text;
  private lockedShown = false;

  constructor() {
    super('field');
  }

  create(entry: RoomEntry): void {
    this.roomId = entry?.room && ROOMS[entry.room] ? entry.room : 'test_a';
    this.room = ROOMS[this.roomId];
    this.leaving = false;
    this.striking = false;
    this.graceMs = 0;
    this.enemies = [];

    const built = buildShape(this.room);
    // a copy: solid objects add their footprints to it
    this.shape = { ...built.shape, blocks: [...built.shape.blocks] };
    this.exits = built.exits;
    this.talking = false;
    this.lockedShown = false;
    this.msg = new MessageBox(this);
    const width = this.shape.width;
    const view = drawRoom(this, this.room, this.shape);
    this.view = view;
    this.bounds = view.bounds;
    this.cameras.main.setBounds(0, view.bounds.top, width * U, view.bounds.bottom - view.bounds.top);

    this.spawnObjects();
    this.spawnPlayer(entry);
    this.spawnEnemies();
    this.buildHud();

    this.camX = cameraX(this.player.body.x, width, W);
    this.camY = cameraY(project(this.player.body, 0).y, this.bounds, H);
    this.cameras.main.setScroll(Math.round(this.camX), Math.round(this.camY));
    this.cx = cameraCentre(Math.round(this.camX), W);
    this.place(this.player);
    for (const e of this.enemies) this.place(e);
    this.placeObjects();
    this.view.update(this.cx, this.time.now);
    this.marker = pixelText(this, 0, 0, '!', 16, css(UI.spark)).setVisible(false).setDepth(950000);
    const offFlag = bus.on('flag.set', () => this.refreshObjects());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offFlag);

    this.debugGfx = this.add.graphics().setDepth(900000);
    this.events.on(Phaser.Scenes.Events.WAKE, (_sys: unknown, end: BattleEnd) => this.onBattleEnd(end));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.WAKE));
  }

  // ── Actors ──────────────────────────────────────────────────────────
  private makeActor(x: number, z: number, y: number, texture: string, frame?: string): Actor {
    const body: Body = { x, y, z, vy: 0, r: WORLD.actorRadius, grounded: true };
    const shadow = this.add.ellipse(0, 0, 30, 8, 0x000000, 0.35);
    const sprite = this.add.sprite(0, 0, texture, frame).setOrigin(0.5, 1);
    return { body, sprite, shadow, squash: 1 };
  }

  /**
   * Puts an actor's sprite and shadow where its 3D position projects to:
   * smaller farther back, faded into the room's haze unless standing in light.
   */
  private place(a: Actor): void {
    const p = project(a.body, this.cx);
    const size = spriteScale(a.body.z);
    a.sprite.setPosition(p.x, p.y).setScale(size * a.squash, size);
    // tinting multiplies, so bright sprites take a lighter dose than the floor to match it
    const haze =
      0.6 * fogAmount(a.body.z, this.room.depth) * (1 - this.view.lightAt(a.body.x, a.body.z) * 0.8);
    a.sprite.setTint(mixColor(0xffffff, this.view.fog, haze));
    const ground = groundAt(this.shape, a.body.x, a.body.z, a.body.r);
    const gp = project({ x: a.body.x, y: ground.y, z: a.body.z }, this.cx);
    const lift = Math.max(0, a.body.y - ground.y);
    const s = Math.max(0.45, 1 - lift * 0.25);
    a.shadow
      .setPosition(gp.x, gp.y)
      .setScale(s * depthScale(a.body.z))
      .setAlpha(0.45 * s + 0.1);
    // standing on (or above) a block: draw after that block
    const d = ground.block ? depthOnBlock(ground.block, a.body.z) : sortDepth(a.body.z);
    a.sprite.setDepth(d + 2);
    a.shadow.setDepth(d + 1);
  }

  private spawnPlayer(entry: RoomEntry): void {
    const sp = this.room.spawns[entry?.spawn ?? 'start'] ?? this.room.spawns.start;
    const x = entry?.x ?? sp[0];
    const z = entry?.y ?? sp[1];
    this.facing = entry?.facing ?? sp[2];
    this.player = this.makeActor(x, z, 0, 'spr_test_dummy', 'idle_00');
    this.player.body.y = groundAt(this.shape, x, z, this.player.body.r).y;
    this.player.sprite.play(animKey('spr_test_dummy', 'idle')).setFlipX(this.facing === 'left');
  }

  private spawnEnemies(): void {
    const gs = gameState();
    for (const e of this.room.enemies) {
      if (!this.holds(e)) continue;
      if (e.respawn === false && gs.isSet(this.beatenFlag(e.id))) continue;
      const def = Database.enemy(e.enemy);
      const flying = def.props.includes('airborne');
      const a = this.makeActor(e.x, e.z, flying ? 0.8 : 0, def.sprite);
      if (!flying) a.body.y = groundAt(this.shape, e.x, e.z, a.body.r).y;
      this.enemies.push({
        ...a,
        id: e.id,
        respawn: e.respawn !== false,
        formation: e.formation,
        spiky: def.props.includes('spiky'),
        flying,
        homeX: e.x,
        patrol: e.patrol,
        dir: 1,
        chasing: false,
      });
    }
  }

  // ── Battles ─────────────────────────────────────────────────────────
  private startBattle(fe: FieldEnemy, firstStrike: 'player' | 'enemy' | null): void {
    if (this.leaving) return;
    this.leaving = true;
    const b = this.player.body;
    SceneLoader.rememberPosition(this.roomId, b.x, b.z, this.facing);
    SceneLoader.startBattle(this, 'battle', {
      formation: fe.formation,
      firstStrike,
      returnTo: 'field',
      fieldEnemyId: fe.id,
    });
  }

  private onBattleEnd(end: BattleEnd): void {
    this.leaving = false;
    if (!end) return;
    const fe = this.enemies.find((e) => e.id === end.fieldEnemyId);
    if (end.result === 'win' && fe) {
      // story fights stay won
      if (!fe.respawn) gameState().setFlag(this.beatenFlag(fe.id));
      // defeated enemies stay gone until you leave the room (respawn rules come with M2)
      fe.sprite.destroy();
      fe.shadow.destroy();
      this.enemies = this.enemies.filter((e) => e !== fe);
    } else {
      // Ran away: a few seconds where no enemy can engage or notice you.
      // Counted down in update(), so time spent asleep during the battle doesn't eat into it.
      this.graceMs = rules.fleeGraceMs;
      for (const e of this.enemies) e.chasing = false;
      if (fe) this.emote(fe.sprite, '?');
    }
  }

  private checkTouches(): void {
    if (this.leaving || this.graceMs > 0) return;
    const p = this.player.body;
    for (const e of this.enemies) {
      if (flatDistance(p, e.body) > 0.8) continue;
      const dy = p.y - e.body.y;
      if (Math.abs(dy) > 1.0) continue;
      const stomp = p.vy < -1 && dy > 0.4;
      // landing on a spiky enemy hurts you: they get the First Strike
      this.startBattle(e, stomp ? (e.spiky ? 'enemy' : 'player') : null);
      return;
    }
  }

  private useDoor(room: string, spawn: string): void {
    if (this.leaving) return;
    this.leaving = true;
    SceneLoader.enterRoom(this, 'field', { room, spawn });
  }

  // ── HUD ─────────────────────────────────────────────────────────────
  private buildHud(): void {
    const gs = gameState();
    const top = 1000000;
    const hud = this.add.container(8, 8).setDepth(top).setScrollFactor(0);
    const g = this.add.graphics();
    drawPanel(g, 0, 0, 230, 64, { alpha: 0.92 });
    const hero = gs.hero();
    const hp = new Bar(this, 12, 12, 206, BAR_STYLES.hp, hero.hp, hero.maxHp);
    const grit = new Bar(this, 12, 30, 206, BAR_STYLES.grit, gs.data.grit, gs.data.maxGrit);
    const coins = pixelText(this, 12, 46, '', 8, css(UI.spark)).setOrigin(0, 0);
    const setCoins = () => coins.setText(`COINS ${gs.data.coins}   ITEMS ${gs.data.items.length}/10`);
    setCoins();
    hud.add([g, hp, grit, coins]);
    pixelText(this, W - 12, 12, this.room.name.toUpperCase(), 8, css(UI.ink))
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(top);
    const pos = pixelText(this, W - 12, 26, '', 8, css(UI.inkDim))
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(top);
    const showPos = () => {
      const b = this.player.body;
      pos.setText(`X ${b.x.toFixed(1)}  Z ${b.z.toFixed(1)}  Y ${b.y.toFixed(1)}`);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, showPos);
    const offs = [
      bus.on('hp.changed', (e) => e.who === hero.id && hp.setValue(e.hp, e.maxHp)),
      bus.on('grit.changed', (e) => grit.setValue(e.grit, e.maxGrit)),
      bus.on('coins.changed', setCoins),
      bus.on('item.added', setCoins),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offs.forEach((off) => off());
      this.events.off(Phaser.Scenes.Events.UPDATE, showPos);
    });
    this.events.on(Phaser.Scenes.Events.WAKE, () => {
      hp.setValue(gs.hero().hp, gs.hero().maxHp, false);
      grit.setValue(gs.data.grit, gs.data.maxGrit, false);
      setCoins();
    });
    hintLine(this, [
      ['jump', 'jump / talk'],
      ['strike', 'strike'],
      ['menu', 'hub'],
    ])
      .setDepth(top)
      .setScrollFactor(0);
  }

  // ── Frame update ────────────────────────────────────────────────────
  update(_t: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    gameState().addPlayTime(dtMs);
    if (this.graceMs > 0) this.graceMs = Math.max(0, this.graceMs - dtMs);
    if (this.leaving) return;
    if (this.talking) {
      this.marker.setVisible(false);
      return;
    }

    if (input.justPressed('menu')) {
      this.leaving = true;
      SceneLoader.goto(this, 'dev_hub', { cursor: 0 });
      return;
    }

    const b = this.player.body;
    const { x, y } = input.axis();
    const len = Math.hypot(x, y) || 1;
    const busy = this.striking;
    const dx = busy ? 0 : (x / len) * WORLD.walkSpeed * dt;
    const dz = busy ? 0 : (-y / len) * WORLD.depthSpeed * dt; // up = farther back
    // next to someone or something: the jump button talks / opens instead
    const near = !busy && b.grounded ? this.interactable() : null;
    this.showMarker(near);
    if (near && input.justPressed('confirm') && this.time.now >= this.interactReadyAt) {
      void this.interact(near);
      return;
    }
    if (input.justPressed('jump') && b.grounded && !busy) {
      b.vy = WORLD.jumpSpeed;
      b.grounded = false;
    }
    const prev = { x: b.x, z: b.z };
    moveBody(this.shape, b, dx, dz, dt);

    // camera follows sideways and into the depth, eased, on whole pixels;
    // done before placing anything, since the perspective depends on it
    this.camX += (cameraX(b.x, this.shape.width, W) - this.camX) * 0.15;
    this.camY += (cameraY(project(b, 0).y, this.bounds, H) - this.camY) * 0.12;
    this.cameras.main.setScroll(Math.round(this.camX), Math.round(this.camY));
    this.cx = cameraCentre(Math.round(this.camX), W);

    if (x !== 0 && !busy) {
      const f: Facing = x < 0 ? 'left' : 'right';
      if (f !== this.facing) this.paperFlip(f);
    }
    if (!busy) {
      const moving = x !== 0 || y !== 0;
      const want = animKey('spr_test_dummy', moving && b.grounded ? 'walk' : 'idle');
      if (this.player.sprite.anims.currentAnim?.key !== want) this.player.sprite.play(want);
    }
    if (input.justPressed('strike') && !busy && b.grounded) this.strike();

    // exits: walking out through a gap in the outline
    const gate = exitGate(this.shape, b.x, b.z);
    if (gate >= 0) {
      const exit = this.exits[gate];
      if (!exit.requires || gameState().isSet(exit.requires)) return this.useDoor(exit.room, exit.spawn);
      // locked: stay inside, and say so once per try
      b.x = prev.x;
      b.z = prev.z;
      if (!this.lockedShown) {
        this.lockedShown = true;
        void this.say([{ text: t(exit.lockedText ?? 'field.locked') }]);
      }
    } else if (!this.nearExit(b.x, b.z)) this.lockedShown = false;
    this.checkTriggers();

    this.place(this.player);
    const rate = this.graceMs > 1000 ? 120 : 60;
    this.player.sprite.setAlpha(this.graceMs > 0 && Math.floor(this.graceMs / rate) % 2 ? 0.35 : 1);

    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.checkTouches();

    this.placeObjects();
    this.view.update(this.cx, this.time.now, this.player.sprite.x);
    this.drawDebug();
  }

  // ── Objects ─────────────────────────────────────────────────────────

  /** Whether a door, enemy or object's flag condition holds right now. */
  private holds(c: Condition): boolean {
    const gs = gameState();
    return (!c.if || gs.isSet(c.if)) && (!c.unless || !gs.isSet(c.unless));
  }

  private beatenFlag(id: string): string {
    return `beaten:${this.roomId}:${id}`;
  }

  private spawnObjects(): void {
    this.objects = [];
    for (const def of this.room.objects ?? []) {
      const look = OBJECT_LOOK[def.kind];
      const o: FieldObject = { def, visible: false };
      if (def.kind !== 'trigger') {
        const key = def.kind === 'npc' ? def.sprite : look.sprite!;
        o.shadow = this.add.ellipse(0, 0, 30, 8, 0x000000, 0.3);
        o.sprite = this.add.sprite(0, 0, key).setOrigin(0.5, 1);
        o.block = {
          x: def.x - look.w / 2,
          z: def.z - look.d / 2,
          w: look.w,
          d: look.d,
          h: look.h,
          kind: 'object',
        };
      }
      this.objects.push(o);
    }
    this.refreshObjects();
  }

  /** Shows or hides objects by their flag conditions, and keeps the solid footprints in step. */
  private refreshObjects(): void {
    const solids = new Set(this.objects.map((o) => o.block));
    this.shape.blocks = this.shape.blocks.filter((b) => !solids.has(b));
    for (const o of this.objects) {
      o.visible = this.holds(o.def);
      o.sprite?.setVisible(o.visible);
      o.shadow?.setVisible(o.visible);
      if (o.visible && o.block) this.shape.blocks.push(o.block);
      // an opened chest looks spent
      if (o.def.kind === 'chest' && o.sprite) o.sprite.setAlpha(gameState().isSet(o.def.flag) ? 0.45 : 1);
    }
  }

  /** Objects stand on the floor at their spot, scaled and hazed like everyone else. */
  private placeObjects(): void {
    for (const o of this.objects) {
      if (!o.sprite || !o.block) continue;
      const body = { x: o.def.x, y: 0, z: o.def.z };
      const p = project(body, this.cx);
      o.sprite.setPosition(p.x, p.y).setScale(spriteScale(body.z));
      const haze = 0.6 * fogAmount(body.z, this.room.depth) * (1 - this.view.lightAt(body.x, body.z) * 0.8);
      o.sprite.setTint(mixColor(0xffffff, this.view.fog, haze));
      // in front of the footprint's own block depth, so anyone behind it is covered
      o.sprite.setDepth(blockDepth(o.block) + 1);
      o.shadow!.setPosition(p.x, p.y).setScale(depthScale(body.z)).setDepth(blockDepth(o.block));
    }
  }

  /** The person or thing the player is next to and facing, if any. */
  private interactable(): FieldObject | null {
    const p = this.player.body;
    const dir = this.facing === 'left' ? -1 : 1;
    let best: { o: FieldObject; d: number } | null = null;
    for (const o of this.objects) {
      if (!o.visible || !o.block || o.def.kind === 'trigger') continue;
      const look = OBJECT_LOOK[o.def.kind];
      const dx = o.def.x - p.x;
      const dz = o.def.z - p.z;
      if (Math.abs(dx) > look.w / 2 + 0.9 || Math.abs(dz) > look.d / 2 + 0.6) continue;
      if (dx * dir < -0.2) continue; // behind you
      if (Math.abs(p.y - groundAt(this.shape, p.x, p.z, p.r).y) > 0.05) continue;
      const d = Math.hypot(dx, dz);
      if (!best || d < best.d) best = { o, d };
    }
    return best?.o ?? null;
  }

  private showMarker(o: FieldObject | null): void {
    if (!o?.sprite) {
      this.marker.setVisible(false);
      return;
    }
    const bob = Math.floor(this.time.now / 250) % 2 ? 2 : 0;
    this.marker.setVisible(true).setPosition(o.sprite.x, o.sprite.y - o.sprite.displayHeight - 14 - bob);
  }

  /** Shows lines in the message box; the player stands still meanwhile. */
  private async say(lines: Line[]): Promise<void> {
    this.talking = true;
    this.player.sprite.play(animKey('spr_test_dummy', 'idle'));
    await this.msg.show(lines);
    this.talking = false;
    this.interactReadyAt = this.time.now + 250;
  }

  private async interact(o: FieldObject): Promise<void> {
    const gs = gameState();
    const def = o.def;
    switch (def.kind) {
      case 'npc': {
        // turn to face the player
        o.sprite?.setFlipX(this.player.body.x < def.x);
        await this.say(def.lines.map((k) => ({ name: t(def.name), text: t(k) })));
        if (def.setFlag) gs.setFlag(def.setFlag);
        break;
      }
      case 'sign':
        await this.say(def.lines.map((k) => ({ text: t(k) })));
        break;
      case 'chest': {
        if (gs.isSet(def.flag)) return this.say([{ text: t('field.empty') }]);
        const name = t(Database.item(def.item).name);
        if (!gs.addItem(def.item)) return this.say([{ text: tf('field.bag_full', { item: name }) }]);
        gs.setFlag(def.flag);
        this.tweens.add({ targets: o.sprite, scaleY: o.sprite!.scaleY * 1.15, duration: 90, yoyo: true });
        await this.say([{ text: tf('field.got_item', { item: name }) }]);
        break;
      }
      case 'heal': {
        for (const m of gs.data.party) gs.setHp(m.id, m.maxHp);
        gs.setGrit(gs.data.maxGrit);
        this.cameras.main.flash(180, 255, 240, 200);
        await this.say([{ text: t('field.healed') }]);
        break;
      }
    }
  }

  /** Story triggers fire as the player walks into them. */
  private checkTriggers(): void {
    const p = this.player.body;
    for (const o of this.objects) {
      const def = o.def;
      if (def.kind !== 'trigger') continue;
      const inside =
        o.visible && p.x >= def.x && p.x <= def.x + def.w && p.z >= def.z && p.z <= def.z + def.d;
      const entered = inside && !o.inside;
      o.inside = inside;
      if (!entered) continue;
      if (def.once !== false && def.setFlag && gameState().isSet(def.setFlag)) continue;
      if (def.setFlag) gameState().setFlag(def.setFlag);
      if (def.lines?.length) void this.say(def.lines.map((k) => ({ text: t(k) })));
    }
  }

  /** Close to a way out (so a locked message isn't repeated while you lean on it). */
  private nearExit(x: number, z: number): boolean {
    return [
      [0.5, 0],
      [-0.5, 0],
      [0, 0.5],
      [0, -0.5],
    ].some(([ox, oz]) => exitGate(this.shape, x + ox, z + oz) >= 0);
  }

  /** TTYD-style turn: squash to a sliver, flip, unsquash. */
  private paperFlip(f: Facing): void {
    this.facing = f;
    const a = this.player;
    this.tweens.killTweensOf(a);
    this.tweens.add({
      targets: a,
      squash: 0.1,
      duration: 60,
      yoyo: true,
      onYoyo: () => a.sprite.setFlipX(f === 'left'),
      onComplete: () => (a.squash = 1),
    });
  }

  private strike(): void {
    this.striking = true;
    const s = this.player.sprite;
    s.play(animKey('spr_test_dummy', 'chop'));
    const dir = this.facing === 'left' ? -1 : 1;
    this.time.delayedCall(140, () => {
      const p = this.player.body;
      const target = this.enemies.find((e) => {
        const ahead = (e.body.x - p.x) * dir;
        return ahead > 0 && ahead < 1.6 && Math.abs(e.body.z - p.z) < 0.9 && Math.abs(e.body.y - p.y) < 1;
      });
      if (target && this.graceMs <= 0) {
        this.cameras.main.shake(90, 0.006);
        this.startBattle(target, 'player');
      }
    });
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => (this.striking = false));
  }

  private emote(s: Phaser.GameObjects.Sprite, mark: '!' | '?'): void {
    const bang = pixelText(this, s.x, s.y - s.displayHeight - 20, mark, 16, css(UI.spark)).setDepth(950000);
    this.tweens.add({
      targets: bang,
      y: bang.y - 6,
      alpha: 0,
      delay: mark === '?' ? 900 : 450,
      duration: 250,
      onComplete: () => bang.destroy(),
    });
  }

  private updateEnemy(e: FieldEnemy, dt: number): void {
    const p = this.player.body;
    const dist = flatDistance(e.body, p);
    const canSee = this.graceMs <= 0;
    if (!e.chasing && dist < rules.fieldNoticeRange && canSee) {
      e.chasing = true;
      this.emote(e.sprite, '!');
    } else if (e.chasing && (dist > rules.fieldGiveUpRange || !canSee)) e.chasing = false;

    let dx = 0;
    let dz = 0;
    const speed = 2.4 * dt;
    if (e.chasing) {
      const len = dist || 1;
      dx = ((p.x - e.body.x) / len) * speed;
      dz = ((p.z - e.body.z) / len) * speed;
    } else if (!(this.graceMs > 0 && dist < 3)) {
      if (e.body.x > e.homeX + e.patrol) e.dir = -1;
      if (e.body.x < e.homeX - e.patrol) e.dir = 1;
      dx = e.dir * 1.2 * dt;
    }
    if (e.flying) {
      // flyers ignore the ground and bob at a fixed height
      // flyers ignore blocks but stay inside the outline
      if (insideOutline(outlineOf(this.shape), e.body.x + dx, e.body.z + dz, 0.6)) {
        e.body.x += dx;
        e.body.z += dz;
      } else e.dir *= -1;
      e.body.y = 0.8 + (Math.floor(this.time.now / 260) % 2) * 0.1;
    } else moveBody(this.shape, e.body, dx, dz, dt);
    if (dx !== 0) e.sprite.setFlipX(dx < 0);
    this.place(e);
  }

  private drawDebug(): void {
    const g = this.debugGfx;
    g.clear();
    if (!debugState.hitboxes) return;
    const foot = (b: Body, color: number) => {
      quad(color, b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r, b.y);
    };
    const P = (x: number, y: number, z: number) => project({ x, y, z }, this.cx);
    const quad = (color: number, x0: number, x1: number, z0: number, z1: number, y: number) => {
      const pts = [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)];
      g.lineStyle(1, color);
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % 4];
        g.lineBetween(p.x, p.y, q.x, q.y);
      });
    };
    // the unit grid on the floor
    g.lineStyle(1, 0xffffff, 0.15);
    for (let x = 0; x <= this.shape.width; x++) {
      const a = P(x, 0, 0);
      const c = P(x, 0, this.shape.depth);
      g.lineBetween(a.x, a.y, c.x, c.y);
    }
    for (let z = 0; z <= this.shape.depth; z++) {
      const a = P(0, 0, z);
      const c = P(this.shape.width, 0, z);
      g.lineBetween(a.x, a.y, c.x, c.y);
    }
    for (const k of this.room.blocks) quad(0xffb238, k.x, k.x + k.w, k.z, k.z + k.d, k.h);
    for (const o of this.objects) {
      if (!o.visible) continue;
      if (o.block)
        quad(0x5fd068, o.block.x, o.block.x + o.block.w, o.block.z, o.block.z + o.block.d, o.block.h);
      if (o.def.kind === 'trigger') quad(0xd070ff, o.def.x, o.def.x + o.def.w, o.def.z, o.def.z + o.def.d, 0);
    }
    // the room outline (walls, fences and gates follow it)
    const pts = outlineOf(this.shape).map(([x, z]) => P(x, 0, z));
    g.lineStyle(2, 0x5fd0ff, 0.9);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      g.lineBetween(p.x, p.y, q.x, q.y);
    });
    foot(this.player.body, 0x5fd068);
    for (const e of this.enemies) foot(e.body, 0xd8314b);
  }
}
