// Room editor (dev tool). A top-down plan of a room, edited with the mouse:
// blocks, lights, spawn points, exits, enemies, people, signs, chests, heal
// blocks and story triggers. PLAY drops you into the real 3D room to try it,
// F2 there comes back. SAVE keeps the room (in the game link's shared
// database, or this browser's storage when running locally); Claude can pull
// saved rooms into the project's room files.
//
// The plan has its own camera: back of the room at the top, the front edge
// (where the game camera stands) at the bottom, 1 grid square = 1 unit.

import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H } from '../systems/integer_scale';
import { drawPanel } from '../ui/components';
import { pixelText } from '../ui/pixel_text';
import { tinyText } from '../ui/tiny_font';
import { UI, css } from '../ui/theme';
import { editText, textFieldOpen } from '../ui/text_field';
import { SceneLoader } from '../managers/scene_loader';
import { Database, validateGameData, type Problem } from '../managers/database';
import { hasGame, newGame } from '../managers/game_state';
import { t } from '../managers/strings';
import { allSpriteKeys } from '../managers/asset_packs';
import { englishKeys } from '../managers/strings';
import { RoomStore } from '../managers/room_store';
import { ROOMS } from '../field/rooms';
import { buildShape } from '../field/room_shape';
import { WORLD, outlineOf, edges } from '../field/world';
import type { ObjectDef, RoomDef, RoomText, FieldEnemyDef, LightDef } from '../field/room_types';
import type { Facing } from '../managers/game_state';

// ── Layout ─────────────────────────────────────────────────────────────
const TOP = 26;
const PLAN = { x: 4, y: TOP + 2, w: 446, h: H - TOP - 22 };
const SIDE = { x: PLAN.x + PLAN.w + 4, y: TOP + 2, w: W - (PLAN.x + PLAN.w + 4) - 4, h: H - TOP - 22 };
const ROW = 13;
/** World pixels per unit inside the plan camera. */
const UNIT = 32;

type Sel =
  | { t: 'block'; i: number }
  | { t: 'light'; i: number }
  | { t: 'spawn'; key: string }
  | { t: 'door'; i: number }
  | { t: 'gate'; i: number }
  | { t: 'enemy'; i: number }
  | { t: 'object'; i: number };

const TOOLS = [
  'select',
  'block',
  'light',
  'spawn',
  'exit',
  'enemy',
  'npc',
  'sign',
  'chest',
  'heal',
  'save',
  'trigger',
] as const;
type Tool = (typeof TOOLS)[number];
const TOOL_HINT: Record<Tool, string> = {
  select:
    'Click to pick, drag to move, drag the corner to resize. Delete removes, Ctrl+D copies, Ctrl+Z undoes.',
  block: 'Click to place a block (crate, step, platform). Change its height in the panel or with [ and ].',
  light: 'Click to place a pool of light.',
  spawn: 'Click to place a spawn point (where the player arrives through an exit).',
  exit: 'Click near a wall (or an octagon edge) to cut an exit to another room.',
  enemy: 'Click to place a field enemy. Pick its line-up in the panel.',
  npc: 'Click to place a person. Type their lines in the panel.',
  sign: 'Click to place a sign.',
  chest: 'Click to place a chest. Pick the item in the panel.',
  heal: 'Click to place a heal block.',
  save: 'Click to place a save block.',
  trigger: 'Click to place a story trigger: an invisible area that fires when walked into.',
};

/** Room looks: backdrop plus a matching floor and wall palette. */
const LOOKS: Record<string, RoomDef['palette']> = {
  harbor: { floor: [3156798, 3485764], wall: [2238255, 2830139], lip: 1250843 },
  warehouse: { floor: [2042424, 2306112], wall: [1316400, 1842232], lip: 921116 },
  arena: { floor: [3355192, 3684158], wall: [2238000, 2830139], lip: 1250843, fence: 10133684 },
};
const LIGHT_COLORS: (number | undefined)[] = [undefined, 0xfff0c8, 0xd8f0ff, 0xffb0a0, 0xb0ffc0];
const FACINGS: Facing[] = ['right', 'left', 'up', 'down'];

/** Rooms with edits not saved yet (kept across Play and back). */
const unsaved = new Set<string>();
let lastRoom = 'test_a';

interface Prop {
  label: string;
  value: () => string;
  step?: (dir: -1 | 1, big: boolean) => void;
  edit?: () => void;
  dim?: boolean;
}

const roomTextEn = (v: RoomText | undefined): string =>
  v === undefined ? '' : typeof v === 'string' ? t(v) : v.en;
const roomTextEs = (v: RoomText | undefined): string =>
  v === undefined ? '' : typeof v === 'string' ? '' : (v.es ?? '');
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmt = (n: number) => String(Math.round(n * 100) / 100);

export class RoomEditorScene extends Phaser.Scene {
  roomId = 'test_a';
  tool: Tool = 'select';
  sel: Sel | null = null;
  private planCam!: Phaser.Cameras.Scene2D.Camera;
  private planLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;
  private planG!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Image[] = [];
  private uiDyn: Phaser.GameObjects.GameObject[] = [];
  private props: Prop[] = [];
  private undoStack: string[] = [];
  private status = '';
  private statusColor: number = UI.inkDim;
  private drag: {
    kind: 'move' | 'resize' | 'pan';
    startX: number;
    startY: number;
    orig: { x: number; z: number; w?: number; d?: number; r?: number };
    camX: number;
    camY: number;
    moved: boolean;
  } | null = null;
  problems: Problem[] = [];
  private keyHandler?: (e: KeyboardEvent) => void;

  constructor() {
    super('room_editor');
  }

  get room(): RoomDef {
    return ROOMS[this.roomId];
  }

  create(data: { room?: string }): void {
    if (!hasGame()) newGame(Database.character('chispa'));
    this.roomId =
      data?.room && ROOMS[data.room] ? data.room : ROOMS[lastRoom] ? lastRoom : Object.keys(ROOMS)[0];
    lastRoom = this.roomId;
    this.sel = null;
    this.tool = 'select';
    this.undoStack = [];
    this.drag = null;
    this.input.mouse?.disableContextMenu();

    this.cameras.main.setBackgroundColor(UI.void);
    this.uiLayer = this.add.layer().setDepth(10);
    this.planLayer = this.add.layer().setDepth(0);
    this.planCam = this.cameras
      .add(PLAN.x, PLAN.y, PLAN.w, PLAN.h)
      .setName('plan')
      .setBackgroundColor(0x0e0b14);
    this.cameras.main.ignore(this.planLayer);
    this.planCam.ignore(this.uiLayer);
    this.planG = this.add.graphics();
    this.planLayer.add(this.planG);

    const frame = this.add.graphics();
    this.uiLayer.add(frame);
    drawPanel(frame, SIDE.x - 2, SIDE.y - 2, SIDE.w + 4, SIDE.h + 4, { alpha: 1 });
    frame.lineStyle(1, UI.border).strokeRect(PLAN.x - 1, PLAN.y - 1, PLAN.w + 2, PLAN.h + 2);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.onWheel(p, dy),
    );
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
      this.input.removeAllListeners();
    });

    const where = RoomStore.backend();
    this.setStatus(
      where === 'shared'
        ? 'Saves go to the game link, for everyone who opens it.'
        : 'Saves stay in this browser (not the shared game link).',
    );
    this.fitView();
    this.refresh(true);
  }

  // ── View ────────────────────────────────────────────────────────────

  private roomWidth(): number {
    return this.room.screens * WORLD.screenUnits;
  }

  private fitView(): void {
    const w = this.roomWidth();
    const d = this.room.depth;
    const zoom = Math.min(PLAN.w / ((w + 3) * UNIT), PLAN.h / ((d + 3) * UNIT));
    this.planCam.setZoom(zoom);
    this.planCam.centerOn((w / 2) * UNIT, (-d / 2) * UNIT);
  }

  /** Plan-world pixel position of a room point. */
  private P(x: number, z: number): { x: number; y: number } {
    return { x: x * UNIT, y: -z * UNIT };
  }

  /** Room point under the pointer, or null outside the plan. */
  private toRoom(p: Phaser.Input.Pointer): { x: number; z: number } | null {
    if (p.x < PLAN.x || p.x > PLAN.x + PLAN.w || p.y < PLAN.y || p.y > PLAN.y + PLAN.h) return null;
    const w = this.planCam.getWorldPoint(p.x, p.y);
    return { x: w.x / UNIT, z: -w.y / UNIT };
  }

  // ── Editing helpers ─────────────────────────────────────────────────

  /** Records the room for undo, applies a change, and redraws. */
  private change(fn: () => void, rebuildLabels = true): void {
    this.pushUndo();
    fn();
    this.touched();
    this.refresh(rebuildLabels);
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.room));
    if (this.undoStack.length > 80) this.undoStack.shift();
  }

  private touched(): void {
    unsaved.add(this.roomId);
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    ROOMS[this.roomId] = JSON.parse(prev);
    this.sel = null;
    this.touched();
    this.refresh(true);
  }

  private snap(v: number, fine: boolean): number {
    const s = fine ? 0.1 : 0.5;
    return Math.round(v / s) * s;
  }

  private newId(prefix: string): string {
    const used = new Set([
      ...(this.room.objects ?? []).map((o) => o.id),
      ...this.room.enemies.map((e) => e.id),
    ]);
    for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
  }

  private setStatus(text: string, color: number = UI.inkDim): void {
    this.status = text;
    this.statusColor = color;
  }

  // ── Items: where they are and how big ───────────────────────────────

  /** Footprint of a selection in room units (x0, z0) – (x1, z1). */
  private rectOf(s: Sel): { x0: number; z0: number; x1: number; z1: number } | null {
    const r = this.room;
    const w = this.roomWidth();
    switch (s.t) {
      case 'block': {
        const b = r.blocks[s.i];
        return { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d };
      }
      case 'light': {
        const l = r.lights![s.i];
        return { x0: l.x - 0.4, z0: l.z - 0.4, x1: l.x + 0.4, z1: l.z + 0.4 };
      }
      case 'spawn': {
        const sp = r.spawns[s.key];
        return sp ? { x0: sp[0] - 0.4, z0: sp[1] - 0.4, x1: sp[0] + 0.4, z1: sp[1] + 0.4 } : null;
      }
      case 'door': {
        const d = r.doors![s.i];
        const x = d.side === 'west' ? 0 : w;
        return { x0: x - 0.5, z0: d.z0, x1: x + 0.5, z1: d.z1 };
      }
      case 'gate': {
        const g = r.gates![s.i];
        const e = edges(this.outline())[g.edge];
        if (!e) return null;
        const pa = [e.a[0] + (e.b[0] - e.a[0]) * g.t0, e.a[1] + (e.b[1] - e.a[1]) * g.t0];
        const pb = [e.a[0] + (e.b[0] - e.a[0]) * g.t1, e.a[1] + (e.b[1] - e.a[1]) * g.t1];
        return {
          x0: Math.min(pa[0], pb[0]) - 0.4,
          z0: Math.min(pa[1], pb[1]) - 0.4,
          x1: Math.max(pa[0], pb[0]) + 0.4,
          z1: Math.max(pa[1], pb[1]) + 0.4,
        };
      }
      case 'enemy': {
        const e = r.enemies[s.i];
        return { x0: e.x - 0.4, z0: e.z - 0.4, x1: e.x + 0.4, z1: e.z + 0.4 };
      }
      case 'object': {
        const o = r.objects![s.i];
        if (o.kind === 'trigger') return { x0: o.x, z0: o.z, x1: o.x + o.w, z1: o.z + o.d };
        return { x0: o.x - 0.45, z0: o.z - 0.45, x1: o.x + 0.45, z1: o.z + 0.45 };
      }
    }
  }

  private resizable(s: Sel): boolean {
    return (
      s.t === 'block' || s.t === 'light' || (s.t === 'object' && this.room.objects![s.i].kind === 'trigger')
    );
  }

  /** Position handle: what dragging moves (block/trigger corner, otherwise the centre). */
  private posOf(s: Sel): { x: number; z: number; w?: number; d?: number; r?: number } {
    const r = this.room;
    switch (s.t) {
      case 'block': {
        const b = r.blocks[s.i];
        return { x: b.x, z: b.z, w: b.w, d: b.d };
      }
      case 'light': {
        const l = r.lights![s.i];
        return { x: l.x, z: l.z, r: l.r };
      }
      case 'spawn':
        return { x: r.spawns[s.key][0], z: r.spawns[s.key][1] };
      case 'door':
        return { x: 0, z: r.doors![s.i].z0, d: r.doors![s.i].z1 - r.doors![s.i].z0 };
      case 'gate':
        return { x: 0, z: 0 };
      case 'enemy':
        return { x: r.enemies[s.i].x, z: r.enemies[s.i].z };
      case 'object': {
        const o = r.objects![s.i];
        return o.kind === 'trigger' ? { x: o.x, z: o.z, w: o.w, d: o.d } : { x: o.x, z: o.z };
      }
    }
  }

  private setPos(s: Sel, x: number, z: number): void {
    const r = this.room;
    switch (s.t) {
      case 'block':
        Object.assign(r.blocks[s.i], { x, z });
        break;
      case 'light':
        Object.assign(r.lights![s.i], { x, z });
        break;
      case 'spawn':
        r.spawns[s.key] = [x, z, r.spawns[s.key][2]];
        break;
      case 'door': {
        const d = r.doors![s.i];
        const len = d.z1 - d.z0;
        d.z0 = Phaser.Math.Clamp(z, 0, r.depth - len);
        d.z1 = d.z0 + len;
        break;
      }
      case 'enemy':
        Object.assign(r.enemies[s.i], { x, z });
        break;
      case 'object':
        Object.assign(r.objects![s.i], { x, z });
        break;
    }
  }

  private setSize(s: Sel, w: number, d: number): void {
    const r = this.room;
    if (s.t === 'block') Object.assign(r.blocks[s.i], { w: Math.max(0.25, w), d: Math.max(0.25, d) });
    else if (s.t === 'light') r.lights![s.i].r = Math.max(0.5, Math.max(w, d));
    else if (s.t === 'object') {
      const o = r.objects![s.i];
      if (o.kind === 'trigger') Object.assign(o, { w: Math.max(0.5, w), d: Math.max(0.5, d) });
    }
  }

  private outline() {
    return outlineOf(buildShape(this.room).shape);
  }

  /** Topmost thing under a room point (small markers win over big areas). */
  private hit(x: number, z: number): Sel | null {
    const r = this.room;
    const inside = (s: Sel) => {
      const q = this.rectOf(s);
      return !!q && x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1;
    };
    const order: Sel[] = [
      ...Object.keys(r.spawns).map((key) => ({ t: 'spawn' as const, key })),
      ...r.enemies.map((_, i) => ({ t: 'enemy' as const, i })),
      ...(r.objects ?? [])
        .map((_, i) => ({ t: 'object' as const, i }))
        .filter((s) => r.objects![s.i].kind !== 'trigger'),
      ...(r.lights ?? []).map((_, i) => ({ t: 'light' as const, i })),
      ...(r.doors ?? []).map((_, i) => ({ t: 'door' as const, i })),
      ...(r.gates ?? []).map((_, i) => ({ t: 'gate' as const, i })),
      ...(r.objects ?? [])
        .map((_, i) => ({ t: 'object' as const, i }))
        .filter((s) => r.objects![s.i].kind === 'trigger'),
      ...r.blocks.map((_, i) => ({ t: 'block' as const, i })).reverse(),
    ];
    return order.find(inside) ?? null;
  }

  /** The resize corner of the selection (top-right in the plan = back-right of the footprint). */
  private handleAt(x: number, z: number): boolean {
    if (!this.sel || !this.resizable(this.sel)) return false;
    const q = this.rectOf(this.sel)!;
    const hx =
      this.sel.t === 'light' ? this.room.lights![this.sel.i].x + this.room.lights![this.sel.i].r : q.x1;
    const hz = this.sel.t === 'light' ? this.room.lights![this.sel.i].z : q.z1;
    const tol = 8 / (UNIT * this.planCam.zoom);
    return Math.abs(x - hx) < tol && Math.abs(z - hz) < tol;
  }

  // ── Placing new things ──────────────────────────────────────────────

  private place(tool: Tool, x: number, z: number): void {
    const r = this.room;
    const others = Object.keys(ROOMS).filter((id) => id !== this.roomId);
    this.change(() => {
      switch (tool) {
        case 'block':
          r.blocks.push({ x: x - 1, z: z - 1, w: 2, d: 2, h: 1 });
          this.sel = { t: 'block', i: r.blocks.length - 1 };
          break;
        case 'light':
          (r.lights ??= []).push({ x, z, r: 2.5, beam: true });
          this.sel = { t: 'light', i: r.lights.length - 1 };
          break;
        case 'spawn': {
          let n = 1;
          while (r.spawns[`spawn${n}`]) n++;
          r.spawns[`spawn${n}`] = [x, z, 'right'];
          this.sel = { t: 'spawn', key: `spawn${n}` };
          break;
        }
        case 'exit': {
          const target = others[0] ?? this.roomId;
          if (r.outline) {
            // nearest outline edge
            const es = edges(this.outline());
            let best = 0;
            let bestD = Infinity;
            es.forEach((e, i) => {
              const mx = (e.a[0] + e.b[0]) / 2;
              const mz = (e.a[1] + e.b[1]) / 2;
              const d = Math.hypot(mx - x, mz - z);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
            (r.gates ??= []).push({ edge: best, t0: 0.35, t1: 0.65, room: target, spawn: 'start' });
            this.sel = { t: 'gate', i: r.gates.length - 1 };
          } else {
            const side = x < this.roomWidth() / 2 ? 'west' : 'east';
            const z0 = Phaser.Math.Clamp(Math.round(z) - 1, 0, r.depth - 2);
            (r.doors ??= []).push({ side, z0, z1: z0 + 2, room: target, spawn: 'start' });
            this.sel = { t: 'door', i: r.doors.length - 1 };
          }
          break;
        }
        case 'enemy': {
          const def = Database.data.enemies[0];
          const formation = Database.data.formations.find((f) => f.enemies.some((e) => e.enemy === def.id));
          const e: FieldEnemyDef = {
            id: this.newId('e'),
            enemy: def.id,
            formation: formation?.id ?? Database.data.formations[0].id,
            x,
            z,
            patrol: 2,
          };
          r.enemies.push(e);
          this.sel = { t: 'enemy', i: r.enemies.length - 1 };
          break;
        }
        case 'npc':
        case 'sign':
        case 'chest':
        case 'heal':
        case 'save':
        case 'trigger': {
          const id = this.newId(tool === 'npc' ? 'person' : tool);
          let o: ObjectDef;
          if (tool === 'npc')
            o = {
              id,
              kind: 'npc',
              x,
              z,
              sprite: 'spr_npc_dock_kid',
              name: { en: 'Someone' },
              lines: [{ en: 'Hello!' }],
            };
          else if (tool === 'sign') o = { id, kind: 'sign', x, z, lines: [{ en: 'A sign.' }] };
          else if (tool === 'chest')
            o = { id, kind: 'chest', x, z, item: Database.data.items[0].id, flag: `${this.roomId}:${id}` };
          else if (tool === 'heal') o = { id, kind: 'heal', x, z };
          else if (tool === 'save') o = { id, kind: 'save', x, z };
          else
            o = {
              id,
              kind: 'trigger',
              x: x - 1,
              z: z - 1,
              w: 2,
              d: 2,
              setFlag: `${this.roomId}:${id}`,
              lines: [{ en: 'Something happens.' }],
            };
          (r.objects ??= []).push(o);
          this.sel = { t: 'object', i: r.objects.length - 1 };
          break;
        }
      }
    });
    this.tool = 'select';
    this.refresh(true);
  }

  private remove(): void {
    const s = this.sel;
    if (!s) return;
    const r = this.room;
    this.change(() => {
      if (s.t === 'block') r.blocks.splice(s.i, 1);
      else if (s.t === 'light') r.lights!.splice(s.i, 1);
      else if (s.t === 'spawn') {
        if (s.key === 'start') return this.setStatus('Every room needs its "start" spawn.', UI.rope);
        delete r.spawns[s.key];
      } else if (s.t === 'door') r.doors!.splice(s.i, 1);
      else if (s.t === 'gate') r.gates!.splice(s.i, 1);
      else if (s.t === 'enemy') r.enemies.splice(s.i, 1);
      else if (s.t === 'object') r.objects!.splice(s.i, 1);
      this.sel = null;
    });
  }

  private duplicate(): void {
    const s = this.sel;
    if (!s || s.t === 'spawn' || s.t === 'door' || s.t === 'gate') return;
    const r = this.room;
    this.change(() => {
      if (s.t === 'block') {
        r.blocks.push({ ...r.blocks[s.i], x: r.blocks[s.i].x + 1, z: r.blocks[s.i].z });
        this.sel = { t: 'block', i: r.blocks.length - 1 };
      } else if (s.t === 'light') {
        r.lights!.push({ ...r.lights![s.i], x: r.lights![s.i].x + 1 });
        this.sel = { t: 'light', i: r.lights!.length - 1 };
      } else if (s.t === 'enemy') {
        r.enemies.push({ ...structuredClone(r.enemies[s.i]), id: this.newId('e'), x: r.enemies[s.i].x + 1 });
        this.sel = { t: 'enemy', i: r.enemies.length - 1 };
      } else if (s.t === 'object') {
        const o = structuredClone(r.objects![s.i]);
        o.id = this.newId(o.kind === 'npc' ? 'person' : o.kind);
        o.x += 1;
        if (o.kind === 'chest') o.flag = `${this.roomId}:${o.id}`;
        r.objects!.push(o);
        this.sel = { t: 'object', i: r.objects!.length - 1 };
      }
    });
  }

  // ── Input ───────────────────────────────────────────────────────────

  private onDown(p: Phaser.Input.Pointer): void {
    if (textFieldOpen) return;
    // top bar, tools and the property panel
    if (p.y < TOP) return this.clickTopBar(p.x, p.y);
    if (p.x >= SIDE.x) return this.clickSide(p.x, p.y, (p.event as MouseEvent).shiftKey);
    const at = this.toRoom(p);
    if (!at) return;
    const fine = (p.event as MouseEvent).shiftKey;
    const cam = { camX: this.planCam.scrollX, camY: this.planCam.scrollY };
    if (p.rightButtonDown() || p.middleButtonDown()) {
      this.drag = { kind: 'pan', startX: p.x, startY: p.y, orig: { x: 0, z: 0 }, ...cam, moved: false };
      return;
    }
    if (this.tool !== 'select') return this.place(this.tool, this.snap(at.x, fine), this.snap(at.z, fine));
    if (this.sel && this.handleAt(at.x, at.z)) {
      this.pushUndo();
      this.drag = {
        kind: 'resize',
        startX: at.x,
        startY: at.z,
        orig: this.posOf(this.sel),
        ...cam,
        moved: false,
      };
      return;
    }
    const hit = this.hit(at.x, at.z);
    this.sel = hit;
    if (hit && hit.t !== 'gate') {
      this.pushUndo();
      this.drag = { kind: 'move', startX: at.x, startY: at.z, orig: this.posOf(hit), ...cam, moved: false };
    } else this.drag = { kind: 'pan', startX: p.x, startY: p.y, orig: { x: 0, z: 0 }, ...cam, moved: false };
    this.refresh(false);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d || !p.isDown) return;
    if (d.kind === 'pan') {
      const z = this.planCam.zoom;
      this.planCam.setScroll(d.camX - (p.x - d.startX) / z, d.camY - (p.y - d.startY) / z);
      d.moved = true;
      return;
    }
    const at = this.toRoom(p);
    if (!at || !this.sel) return;
    const fine = (p.event as MouseEvent).shiftKey;
    const dx = at.x - d.startX;
    const dz = at.z - d.startY;
    if (!d.moved && Math.hypot(dx, dz) < 0.15) return;
    d.moved = true;
    if (d.kind === 'move')
      this.setPos(this.sel, this.snap(d.orig.x + dx, fine), this.snap(d.orig.z + dz, fine));
    else if (this.sel.t === 'light') this.setSize(this.sel, this.snap((d.orig.r ?? 1) + dx, fine), 0);
    else this.setSize(this.sel, this.snap((d.orig.w ?? 1) + dx, fine), this.snap((d.orig.d ?? 1) + dz, fine));
    this.touched();
    this.refresh(false);
  }

  private onUp(_p: Phaser.Input.Pointer): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    // a click without a drag shouldn't leave an empty undo step
    if ((d.kind === 'move' || d.kind === 'resize') && !d.moved) this.undoStack.pop();
    if (d.kind !== 'pan') this.refresh(true);
  }

  private onWheel(p: Phaser.Input.Pointer, dy: number): void {
    if (!this.toRoom(p)) return;
    const before = this.planCam.getWorldPoint(p.x, p.y);
    const zoom = Phaser.Math.Clamp(this.planCam.zoom * (dy > 0 ? 0.85 : 1.18), 0.05, 4);
    this.planCam.setZoom(zoom);
    const after = this.planCam.getWorldPoint(p.x, p.y);
    this.planCam.scrollX += before.x - after.x;
    this.planCam.scrollY += before.y - after.y;
    this.refresh(false);
  }

  private onKey(e: KeyboardEvent): void {
    if (textFieldOpen || !this.scene.isActive()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    } else if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicate();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.remove();
    } else if (e.key === 'Escape') {
      this.sel = null;
      this.tool = 'select';
      this.refresh(false);
    } else if ((e.key === '[' || e.key === ']') && this.sel?.t === 'block') {
      const b = this.room.blocks[this.sel.i];
      this.change(() => (b.h = Math.max(0, b.h + (e.key === ']' ? 0.25 : -0.25))), false);
    } else if (e.key.startsWith('Arrow') && this.sel) {
      e.preventDefault();
      const s = e.shiftKey ? 0.1 : 0.5;
      const q = this.posOf(this.sel);
      const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0;
      const dz = e.key === 'ArrowUp' ? s : e.key === 'ArrowDown' ? -s : 0;
      this.change(() => this.setPos(this.sel!, fmtNum(q.x + dx), fmtNum(q.z + dz)), false);
    } else if (e.key === 'F2' || e.key.toLowerCase() === 'p') {
      e.preventDefault();
      this.play();
    }
  }

  // ── Top bar ─────────────────────────────────────────────────────────

  private topButtons(): { label: string; x: number; act: () => void }[] {
    const labels: [string, () => void][] = [
      ['NEW', () => void this.newRoom()],
      ['SAVE', () => void this.save()],
      ['REVERT', () => void this.revert()],
      ['PLAY', () => this.play()],
      ['BACK', () => this.leave()],
    ];
    let x = W - 6;
    const out: { label: string; x: number; act: () => void }[] = [];
    for (const [label, act] of labels.reverse()) {
      x -= label.length * 8 + 14;
      out.unshift({ label, x, act });
    }
    return out;
  }

  private clickTopBar(x: number, _y: number): void {
    const ids = Object.keys(ROOMS).sort();
    const i = ids.indexOf(this.roomId);
    if (x < 18) return this.switchRoom(ids[(i - 1 + ids.length) % ids.length]);
    if (x >= 150 && x < 166) return this.switchRoom(ids[(i + 1) % ids.length]);
    for (const b of this.topButtons()) if (x >= b.x && x < b.x + b.label.length * 8 + 12) return b.act();
  }

  private switchRoom(id: string): void {
    this.roomId = id;
    lastRoom = id;
    this.sel = null;
    this.undoStack = [];
    this.fitView();
    this.refresh(true);
  }

  private async newRoom(): Promise<void> {
    let n = 1;
    while (ROOMS[`room_${n}`]) n++;
    const id = await editText(this, { x: 8, y: 6, w: 200, value: `room_${n}`, placeholder: 'room id' });
    if (!id) return;
    const clean = id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    if (!clean || ROOMS[clean]) return this.setStatus(`A room called "${clean}" already exists.`, UI.rope);
    ROOMS[clean] = {
      name: clean.replace(/_/g, ' '),
      screens: 1,
      depth: 8,
      wallHeight: 3,
      backdrop: 'warehouse',
      palette: structuredClone(LOOKS.warehouse),
      blocks: [],
      doors: [],
      spawns: { start: [3, 3, 'right'] },
      enemies: [],
      lights: [{ x: 10, z: 4, r: 3, beam: true }],
      objects: [],
    };
    unsaved.add(clean);
    this.switchRoom(clean);
    this.setStatus(`New room "${clean}". It isn't saved yet.`);
  }

  async save(): Promise<void> {
    this.setStatus('Saving…');
    this.refresh(false);
    try {
      await RoomStore.save(this.roomId);
      unsaved.delete(this.roomId);
      const where = RoomStore.backend() === 'shared' ? 'to the game link' : 'in this browser';
      const n = this.problems.length;
      this.setStatus(
        `Saved ${where}.${n ? ` ${n} problem${n > 1 ? 's' : ''} to fix (see the room panel).` : ''}`,
        n ? UI.rope : UI.good,
      );
    } catch (e) {
      this.setStatus(`Couldn't save: ${(e as { message?: string }).message ?? e}`, UI.rope);
    }
    this.refresh(false);
  }

  private async revert(): Promise<void> {
    const builtin = RoomStore.isBuiltin(this.roomId);
    if (!RoomStore.isEdited(this.roomId) && !unsaved.has(this.roomId))
      return this.setStatus('Nothing to revert: this room is as it ships.');
    try {
      await RoomStore.revert(this.roomId);
      unsaved.delete(this.roomId);
      if (!builtin) {
        this.setStatus('Removed the new room.');
        return this.switchRoom(Object.keys(ROOMS).sort()[0]);
      }
      this.setStatus('Back to the room as it ships in the game.');
      this.sel = null;
      this.undoStack = [];
      this.refresh(true);
    } catch (e) {
      this.setStatus(`Couldn't revert: ${(e as { message?: string }).message ?? e}`, UI.rope);
    }
  }

  /** Walk around the room as it is now (F2 in the room comes back here). */
  play(): void {
    const spawn = this.sel?.t === 'spawn' ? this.sel.key : 'start';
    lastRoom = this.roomId;
    SceneLoader.enterRoom(this, 'field', { room: this.roomId, spawn });
  }

  private leave(): void {
    SceneLoader.goto(this, 'dev_hub', { cursor: 2 });
  }

  // ── Side panel: tools and properties ────────────────────────────────

  private clickSide(x: number, y: number, big: boolean): void {
    // tool buttons: two columns
    const ty = y - (SIDE.y + 4);
    if (ty >= 0 && ty < Math.ceil(TOOLS.length / 2) * ROW) {
      const col = x < SIDE.x + SIDE.w / 2 ? 0 : 1;
      const i = Math.floor(ty / ROW) * 2 + col;
      if (TOOLS[i]) {
        this.tool = TOOLS[i];
        if (this.tool !== 'select') this.sel = null;
        this.refresh(false);
      }
      return;
    }
    const py = y - this.propsTop();
    const i = Math.floor(py / ROW);
    const prop = this.props[i];
    if (py < 0 || !prop) return;
    const vx = SIDE.x + 78;
    if (prop.step && x < vx + 12) prop.step(-1, big);
    else if (prop.step && x > SIDE.x + SIDE.w - 16) prop.step(1, big);
    else if (prop.edit) prop.edit();
    else if (prop.step) prop.step(1, big);
  }

  private propsTop(): number {
    return SIDE.y + 6 + Math.ceil(TOOLS.length / 2) * ROW + 18;
  }

  /** Number stepper on a field. */
  private num<T extends object>(
    label: string,
    obj: () => T,
    key: keyof T & string,
    step: number,
    min = -Infinity,
    max = Infinity,
  ): Prop {
    return {
      label,
      value: () => fmt(obj()[key] as number),
      step: (dir, big) =>
        this.change(() => {
          const o = obj() as Record<string, number>;
          o[key] = fmtNum(Phaser.Math.Clamp(o[key] + dir * step * (big ? 4 : 1), min, max));
        }, false),
    };
  }

  /** Cycles a field through a list of choices. */
  private pick<T extends object, V>(
    label: string,
    obj: () => T,
    key: keyof T & string,
    options: V[],
    show: (v: V) => string = (v) => String(v),
  ): Prop {
    return {
      label,
      value: () => show(obj()[key] as V),
      step: (dir) =>
        this.change(() => {
          const o = obj() as Record<string, V>;
          const i = options.indexOf(o[key]);
          o[key] = options[(i + dir + options.length) % options.length];
        }),
    };
  }

  /** A flag name (empty = no flag). */
  private flag<T extends object>(label: string, obj: () => T, key: keyof T & string, y: () => number): Prop {
    return {
      label,
      value: () => (obj()[key] as string | undefined) ?? '—',
      edit: async () => {
        const v = await editText(this, {
          x: SIDE.x,
          y: y(),
          w: SIDE.w,
          value: (obj()[key] as string) ?? '',
          placeholder: 'flag name, empty = none',
        });
        if (v === null) return;
        this.change(() => {
          const o = obj() as Record<string, unknown>;
          if (v.trim()) o[key] = v.trim();
          else delete o[key];
        });
      },
    };
  }

  /** One room text (name, locked message). */
  private text<T extends object>(
    label: string,
    obj: () => T,
    key: keyof T & string,
    y: () => number,
    optional = false,
  ): Prop {
    return {
      label,
      value: () => {
        const v = obj()[key] as RoomText | undefined;
        return v === undefined ? '—' : roomTextEn(v);
      },
      edit: async () => {
        const cur = obj()[key] as RoomText | undefined;
        const en = await editText(this, { x: SIDE.x, y: y(), w: SIDE.w, value: roomTextEn(cur) });
        if (en === null) return;
        this.change(() => {
          const o = obj() as Record<string, unknown>;
          if (!en.trim() && optional) delete o[key];
          else o[key] = { en: en.trim(), ...(roomTextEs(cur) ? { es: roomTextEs(cur) } : {}) };
        });
      },
    };
  }

  /** A list of lines, one per line of a text box, in English or Spanish. */
  private lines(label: string, obj: () => { lines?: RoomText[] }, lang: 'en' | 'es'): Prop {
    const get = () => obj().lines ?? [];
    return {
      label,
      value: () => {
        const ls = get()
          .map(lang === 'en' ? roomTextEn : roomTextEs)
          .filter(Boolean);
        return ls.length ? `${ls[0]}${ls.length > 1 ? ` (+${ls.length - 1})` : ''}` : '—';
      },
      edit: async () => {
        const cur = get();
        const v = await editText(this, {
          x: PLAN.x + 20,
          y: PLAN.y + 60,
          w: PLAN.w - 40,
          h: 120,
          multiline: true,
          value: cur.map(lang === 'en' ? roomTextEn : roomTextEs).join('\n'),
          placeholder: `${lang === 'en' ? 'English' : 'Spanish'}: one line per box of text. Ctrl+Enter to finish.`,
        });
        if (v === null) return;
        const typed = v
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        this.change(() => {
          if (lang === 'en')
            obj().lines = typed.map((en, i) =>
              roomTextEs(cur[i]) ? { en, es: roomTextEs(cur[i]) } : { en },
            );
          else
            obj().lines = cur.map((l, i) =>
              typed[i] ? { en: roomTextEn(l), es: typed[i] } : { en: roomTextEn(l) },
            );
        });
      },
    };
  }

  private idProp(obj: () => { id: string }, y: () => number): Prop {
    return {
      label: 'Id',
      value: () => obj().id,
      edit: async () => {
        const v = await editText(this, { x: SIDE.x, y: y(), w: SIDE.w, value: obj().id });
        const clean = v?.trim().replace(/[^A-Za-z0-9_:-]/g, '_');
        if (clean) this.change(() => (obj().id = clean));
      },
    };
  }

  private buildProps(): Prop[] {
    const r = this.room;
    const s = this.sel;
    const rowY = (i: number) => this.propsTop() + i * ROW - 2;
    const props: Prop[] = [];
    const add = (p: Prop) => {
      const i = props.length;
      // text editors open over their own row
      props.push(p);
      return i;
    };
    const yOf = () => rowY(props.length);
    const roomIds = Object.keys(ROOMS).sort();
    const yes = (b: boolean | undefined) => (b ? 'yes' : 'no');

    if (!s) {
      add({ label: 'Room', value: () => this.roomId, dim: true });
      add(this.text('Name', () => r as unknown as { name: RoomText }, 'name', yOf));
      add({
        label: 'Look',
        value: () => r.backdrop,
        step: (dir) =>
          this.change(() => {
            const looks = Object.keys(LOOKS);
            r.backdrop = looks[(looks.indexOf(r.backdrop) + dir + looks.length) % looks.length];
            r.palette = structuredClone(LOOKS[r.backdrop]);
          }),
      });
      add(this.num('Screens', () => r, 'screens', 1, 1, 8));
      add(this.num('Depth', () => r, 'depth', 1, 3, 60));
      add(this.num('Wall', () => r, 'wallHeight', 0.5, 1, 10));
      add({
        label: 'Shape',
        value: () => (r.outline ? 'octagon' : 'rectangle'),
        step: () =>
          this.change(() => {
            if (r.outline) delete r.outline;
            else r.outline = { octagon: Math.min(6, r.depth / 3) };
          }),
      });
      if (r.outline && !Array.isArray(r.outline)) {
        const oct = r.outline;
        add(this.num('Corner', () => oct, 'octagon', 0.5, 0.5, 30));
      }
      add({ label: 'Fence', value: () => yes(r.fence), step: () => this.change(() => (r.fence = !r.fence)) });
      add({
        label: 'Saved',
        value: () =>
          unsaved.has(this.roomId) ? 'NOT YET' : RoomStore.isEdited(this.roomId) ? 'edited' : 'as shipped',
        dim: true,
      });
      add({ label: 'Problems', value: () => String(this.problems.length), dim: true });
      for (const p of this.problems.slice(0, 5))
        add({
          label: '',
          value: () => short(`${p.id.replace(`${this.roomId} · `, '')}: ${p.message}`, 26),
          dim: true,
        });
      return props;
    }

    switch (s.t) {
      case 'block': {
        const b = () => r.blocks[s.i];
        add({ label: 'BLOCK', value: () => `#${s.i + 1}`, dim: true });
        add(this.num('X', b, 'x', 0.5));
        add(this.num('Z', b, 'z', 0.5));
        add(this.num('Width', b, 'w', 0.5, 0.25));
        add(this.num('Depth', b, 'd', 0.5, 0.25));
        add(this.num('Height', b, 'h', 0.25, 0));
        add({ label: '', value: () => 'up to 0.3 walks on, 1.6 jumps on', dim: true });
        break;
      }
      case 'light': {
        const l = () => r.lights![s.i] as LightDef;
        add({ label: 'LIGHT', value: () => `#${s.i + 1}`, dim: true });
        add(this.num('X', l, 'x', 0.5));
        add(this.num('Z', l, 'z', 0.5));
        add(this.num('Radius', l, 'r', 0.5, 0.5));
        add({
          label: 'Beam',
          value: () => yes(l().beam),
          step: () => this.change(() => (l().beam = !l().beam)),
        });
        add(
          this.pick('Colour', l, 'color', LIGHT_COLORS, (c) =>
            c === undefined ? 'default' : `#${c.toString(16)}`,
          ),
        );
        break;
      }
      case 'spawn': {
        const key = s.key;
        add({
          label: 'SPAWN',
          value: () => key,
          edit: async () => {
            const v = await editText(this, { x: SIDE.x, y: rowY(0), w: SIDE.w, value: key });
            const clean = v?.trim().replace(/[^A-Za-z0-9_]/g, '_');
            if (!clean || clean === key || r.spawns[clean]) return;
            if (key === 'start') return this.setStatus('The "start" spawn keeps its name.', UI.rope);
            this.change(() => {
              r.spawns[clean] = r.spawns[key];
              delete r.spawns[key];
              this.sel = { t: 'spawn', key: clean };
            });
          },
        });
        const sp = () => ({ x: r.spawns[key][0], z: r.spawns[key][1], f: r.spawns[key][2] });
        add({
          label: 'X',
          value: () => fmt(sp().x),
          step: (d) => this.change(() => this.setPos(s, sp().x + d * 0.5, sp().z), false),
        });
        add({
          label: 'Z',
          value: () => fmt(sp().z),
          step: (d) => this.change(() => this.setPos(s, sp().x, sp().z + d * 0.5), false),
        });
        add({
          label: 'Facing',
          value: () => sp().f,
          step: (d) =>
            this.change(() => {
              const i = FACINGS.indexOf(sp().f);
              r.spawns[key][2] = FACINGS[(i + d + FACINGS.length) % FACINGS.length];
            }, false),
        });
        add({ label: '', value: () => 'select one, then PLAY starts there', dim: true });
        break;
      }
      case 'door':
      case 'gate': {
        const ex = () =>
          (s.t === 'door' ? r.doors![s.i] : r.gates![s.i]) as unknown as Record<string, unknown> & {
            room: string;
            spawn: string;
          };
        add({ label: s.t === 'door' ? 'DOOR' : 'GATE', value: () => `#${s.i + 1}`, dim: true });
        if (s.t === 'door') {
          const d = () => r.doors![s.i];
          add(this.pick('Side', d, 'side', ['west', 'east'] as const as ('west' | 'east')[]));
          add(this.num('From z', d, 'z0', 0.5, 0, r.depth));
          add(this.num('To z', d, 'z1', 0.5, 0, r.depth));
        } else {
          const g = () => r.gates![s.i];
          add(this.num('Edge', g, 'edge', 1, 0, this.outline().length - 1));
          add(this.num('From', g, 't0', 0.05, 0, 1));
          add(this.num('To', g, 't1', 0.05, 0, 1));
        }
        add({
          label: 'To room',
          value: () => ex().room,
          step: (d) =>
            this.change(() => {
              const i = roomIds.indexOf(ex().room);
              ex().room = roomIds[(i + d + roomIds.length) % roomIds.length];
              const sp = Object.keys(ROOMS[ex().room]?.spawns ?? {});
              if (!sp.includes(ex().spawn)) ex().spawn = sp[0] ?? 'start';
            }),
        });
        add({
          label: 'Arrive at',
          value: () => ex().spawn,
          step: (d) =>
            this.change(() => {
              const sp = Object.keys(ROOMS[ex().room]?.spawns ?? { start: 0 });
              ex().spawn = sp[(sp.indexOf(ex().spawn) + d + sp.length) % sp.length];
            }),
        });
        add(this.flag('Needs flag', ex, 'requires', yOf));
        add(this.text('Locked msg', ex as () => { lockedText?: RoomText }, 'lockedText', yOf, true));
        break;
      }
      case 'enemy': {
        const e = () => r.enemies[s.i];
        add({ label: 'ENEMY', value: () => e().id, dim: true });
        add(this.idProp(e, yOf));
        add(
          this.pick(
            'Enemy',
            e,
            'enemy',
            Database.data.enemies.map((d) => d.id),
            (v) => t(Database.enemy(v).name),
          ),
        );
        add(
          this.pick(
            'Line-up',
            e,
            'formation',
            Database.data.formations.map((f) => f.id),
          ),
        );
        add(this.num('X', e, 'x', 0.5));
        add(this.num('Z', e, 'z', 0.5));
        add(this.num('Patrol', e, 'patrol', 0.5, 0));
        add({
          label: 'Comes back',
          value: () => (e().respawn === false ? 'no (story)' : 'yes'),
          step: () =>
            this.change(() => {
              if (e().respawn === false) delete e().respawn;
              else e().respawn = false;
            }),
        });
        add(this.flag('Only if', e, 'if', yOf));
        add(this.flag('Unless', e, 'unless', yOf));
        break;
      }
      case 'object': {
        const o = () => r.objects![s.i];
        const kind = o().kind;
        add({ label: kind.toUpperCase(), value: () => o().id, dim: true });
        add(this.idProp(o, yOf));
        add(this.num('X', o, 'x', 0.5));
        add(this.num('Z', o, 'z', 0.5));
        if (kind === 'npc') {
          const n = () => o() as Extract<ObjectDef, { kind: 'npc' }>;
          const sprites = [...allSpriteKeys()].filter((k) => k.startsWith('spr_')).sort();
          add(this.pick('Sprite', n, 'sprite', sprites, (v) => v.replace(/^spr_/, '')));
          add(this.text('Name', n, 'name', yOf));
          add(this.lines('Lines', n, 'en'));
          add(this.lines('Lines ES', n, 'es'));
          add(this.flag('Sets flag', n, 'setFlag', yOf));
        } else if (kind === 'sign') {
          const n = () => o() as Extract<ObjectDef, { kind: 'sign' }>;
          add(this.lines('Lines', n, 'en'));
          add(this.lines('Lines ES', n, 'es'));
        } else if (kind === 'chest') {
          const c = () => o() as Extract<ObjectDef, { kind: 'chest' }>;
          add(
            this.pick(
              'Item',
              c,
              'item',
              Database.data.items.map((i) => i.id),
              (v) => t(Database.item(v).name),
            ),
          );
          add(this.flag('Opened flag', c, 'flag', yOf));
        } else if (kind === 'trigger') {
          const tr = () => o() as Extract<ObjectDef, { kind: 'trigger' }>;
          add(this.num('Width', tr, 'w', 0.5, 0.5));
          add(this.num('Depth', tr, 'd', 0.5, 0.5));
          add(this.lines('Lines', tr, 'en'));
          add(this.lines('Lines ES', tr, 'es'));
          add(this.flag('Sets flag', tr, 'setFlag', yOf));
          add({
            label: 'Once',
            value: () => yes(tr().once !== false),
            step: () =>
              this.change(() => {
                if (tr().once === false) delete tr().once;
                else tr().once = false;
              }),
          });
        }
        add(this.flag('Only if', o, 'if', yOf));
        add(this.flag('Unless', o, 'unless', yOf));
        break;
      }
    }
    return props;
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  /** Redraws everything. `labels` rebuilds the text in the plan (skip while dragging). */
  refresh(labels: boolean): void {
    this.validate();
    this.drawPlan(labels);
    this.drawUi();
  }

  private validate(): void {
    const all = validateGameData(
      { ...Database.data, rooms: ROOMS },
      { spriteKeys: allSpriteKeys(), stringKeys: englishKeys() },
    );
    this.problems = all.filter(
      (p) => p.file === 'rooms' && (p.id === this.roomId || p.id.startsWith(`${this.roomId} · `)),
    );
  }

  private drawPlan(rebuildLabels: boolean): void {
    const g = this.planG.clear();
    const r = this.room;
    const z = this.planCam.zoom;
    const px = 1 / z; // one screen pixel in plan-world pixels
    const width = this.roomWidth();
    const lbl: [number, number, string, string][] = [];
    const P = (x: number, zz: number) => this.P(x, zz);

    // grid: units, every 5 units, screens
    const span = { x0: -2, x1: width + 2, z0: -2, z1: r.depth + 2 };
    for (let x = Math.ceil(span.x0); x <= span.x1; x++) {
      const c = x % WORLD.screenUnits === 0 ? 0x6a4a20 : x % 5 === 0 ? 0x2c2538 : 0x1a1622;
      g.lineStyle(px * (x % WORLD.screenUnits === 0 ? 2 : 1), c).lineBetween(
        x * UNIT,
        -span.z0 * UNIT,
        x * UNIT,
        -span.z1 * UNIT,
      );
    }
    for (let zz = Math.ceil(span.z0); zz <= span.z1; zz++) {
      const c = zz % 5 === 0 ? 0x2c2538 : 0x1a1622;
      g.lineStyle(px, c).lineBetween(span.x0 * UNIT, -zz * UNIT, span.x1 * UNIT, -zz * UNIT);
    }

    // floor
    let outline: [number, number][];
    try {
      outline = this.outline();
    } catch {
      outline = [];
    }
    if (outline.length) {
      g.fillStyle(r.palette.floor[0], 0.55).fillPoints(
        outline.map(([x, zz]) => new Phaser.Math.Vector2(P(x, zz).x, P(x, zz).y)),
        true,
      );
      g.lineStyle(px * 2, 0x8a7f99).strokePoints(
        outline.map(([x, zz]) => new Phaser.Math.Vector2(P(x, zz).x, P(x, zz).y)),
        true,
      );
    }
    lbl.push(
      [width / 2, -0.9, 'FRONT (CAMERA SIDE)', '#8a7f99'],
      [width / 2, r.depth + 0.6, 'BACK WALL', '#8a7f99'],
    );

    // lights
    (r.lights ?? []).forEach((l, i) => {
      g.fillStyle(l.color ?? 0xfff0c8, 0.12).fillCircle(P(l.x, l.z).x, P(l.x, l.z).y, l.r * UNIT);
      g.lineStyle(px, 0xffd070, 0.6).strokeCircle(P(l.x, l.z).x, P(l.x, l.z).y, l.r * UNIT);
      g.fillStyle(0xffd070).fillCircle(P(l.x, l.z).x, P(l.x, l.z).y, 3 * px);
      if (this.isSel({ t: 'light', i })) this.selBox(g, px, { t: 'light', i });
    });

    // blocks, lighter = taller
    r.blocks.forEach((b) => {
      const a = P(b.x, b.z + b.d);
      const shade = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x3a3248),
        Phaser.Display.Color.ValueToColor(0xb8a8d0),
        100,
        Math.min(100, b.h * 30),
      );
      const col = Phaser.Display.Color.GetColor(shade.r, shade.g, shade.b);
      g.fillStyle(col, 0.9).fillRect(a.x, a.y, b.w * UNIT, b.d * UNIT);
      g.lineStyle(px, 0x0b0910).strokeRect(a.x, a.y, b.w * UNIT, b.d * UNIT);
      if (b.w * UNIT * z > 24) lbl.push([b.x + b.w / 2, b.z + b.d / 2, `H${fmt(b.h)}`, '#0b0910']);
    });

    // exits
    (r.doors ?? []).forEach((d, i) => {
      const x = d.side === 'west' ? 0 : width;
      g.lineStyle(px * 5, d.requires ? 0xd8314b : 0x3fa7f0).lineBetween(
        P(x, d.z0).x,
        P(x, d.z0).y,
        P(x, d.z1).x,
        P(x, d.z1).y,
      );
      lbl.push([x + (d.side === 'west' ? 1.6 : -1.6), (d.z0 + d.z1) / 2, `TO ${d.room}`, '#3fa7f0']);
      if (this.isSel({ t: 'door', i })) this.selBox(g, px, { t: 'door', i });
    });
    const es = outline.length ? edges(outline) : [];
    (r.gates ?? []).forEach((gt, i) => {
      const e = es[gt.edge];
      if (!e) return;
      const at = (tt: number) => P(e.a[0] + (e.b[0] - e.a[0]) * tt, e.a[1] + (e.b[1] - e.a[1]) * tt);
      g.lineStyle(px * 5, gt.requires ? 0xd8314b : 0x3fa7f0).lineBetween(
        at(gt.t0).x,
        at(gt.t0).y,
        at(gt.t1).x,
        at(gt.t1).y,
      );
      const m = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
      lbl.push([m[0] + e.nx * 1.4, m[1] + e.nz * 1.4, `TO ${gt.room}`, '#3fa7f0']);
      if (this.isSel({ t: 'gate', i })) this.selBox(g, px, { t: 'gate', i });
    });

    // objects and triggers
    const OBJ_COL: Record<string, number> = {
      npc: 0x5fd0c0,
      sign: 0xb08050,
      chest: 0xffb238,
      heal: 0xff70a0,
      save: 0x9fd8ff,
      trigger: 0xd070ff,
    };
    (r.objects ?? []).forEach((o, i) => {
      if (o.kind === 'trigger') {
        const a = P(o.x, o.z + o.d);
        g.fillStyle(OBJ_COL.trigger, 0.15).fillRect(a.x, a.y, o.w * UNIT, o.d * UNIT);
        g.lineStyle(px, OBJ_COL.trigger).strokeRect(a.x, a.y, o.w * UNIT, o.d * UNIT);
        lbl.push([o.x + o.w / 2, o.z + o.d / 2, o.id, '#d070ff']);
      } else {
        const c = P(o.x, o.z);
        g.fillStyle(OBJ_COL[o.kind]).fillRect(c.x - 0.35 * UNIT, c.y - 0.35 * UNIT, 0.7 * UNIT, 0.7 * UNIT);
        g.lineStyle(px, 0x0b0910).strokeRect(c.x - 0.35 * UNIT, c.y - 0.35 * UNIT, 0.7 * UNIT, 0.7 * UNIT);
        lbl.push([o.x, o.z - 0.7, o.id, '#f4ead2']);
      }
      if (this.isSel({ t: 'object', i })) this.selBox(g, px, { t: 'object', i });
    });

    // enemies with their patrol range
    r.enemies.forEach((e, i) => {
      const c = P(e.x, e.z);
      g.lineStyle(px, 0xd8314b, 0.6).lineBetween(
        P(e.x - e.patrol, e.z).x,
        c.y,
        P(e.x + e.patrol, e.z).x,
        c.y,
      );
      g.fillStyle(e.respawn === false ? 0xffb238 : 0xd8314b).fillCircle(c.x, c.y, 0.38 * UNIT);
      g.lineStyle(px, 0x0b0910).strokeCircle(c.x, c.y, 0.38 * UNIT);
      lbl.push([e.x, e.z - 0.65, `${e.id} ${e.enemy}`, '#ff8090']);
      if (this.isSel({ t: 'enemy', i })) this.selBox(g, px, { t: 'enemy', i });
    });

    // spawn points: arrows facing their way
    for (const [key, [x, zz, f]] of Object.entries(r.spawns)) {
      const c = P(x, zz);
      const s = 0.4 * UNIT;
      const dir = f === 'left' ? [-1, 0] : f === 'right' ? [1, 0] : f === 'up' ? [0, -1] : [0, 1];
      g.fillStyle(0x5fd068).fillTriangle(
        c.x + dir[0] * s,
        c.y + dir[1] * s,
        c.x - dir[0] * s * 0.6 - dir[1] * s * 0.7,
        c.y - dir[1] * s * 0.6 - dir[0] * s * 0.7,
        c.x - dir[0] * s * 0.6 + dir[1] * s * 0.7,
        c.y - dir[1] * s * 0.6 + dir[0] * s * 0.7,
      );
      lbl.push([x, zz - 0.75, key, '#5fd068']);
      if (this.isSel({ t: 'spawn', key })) this.selBox(g, px, { t: 'spawn', key });
    }
    if (this.sel && (this.sel.t === 'block' || this.sel.t === 'object')) {
      if (this.sel.t === 'block') this.selBox(g, px, this.sel);
      else if (this.room.objects![this.sel.i]?.kind === 'trigger') this.selBox(g, px, this.sel);
    }

    if (rebuildLabels) {
      for (const l of this.labels) l.destroy();
      this.labels = lbl.map(([x, zz, text, color]) => {
        const p = P(x, zz);
        const img = tinyText(this, p.x, p.y, short(text, 22), color).setOrigin(0.5);
        this.planLayer.add(img);
        return img;
      });
    }
    // labels keep the same size on screen at any zoom
    for (const l of this.labels) l.setScale(1 / z);
  }

  private isSel(s: Sel): boolean {
    const a = this.sel;
    if (!a || a.t !== s.t) return false;
    return a.t === 'spawn'
      ? a.key === (s as { key: string }).key
      : (a as { i: number }).i === (s as { i: number }).i;
  }

  private selBox(g: Phaser.GameObjects.Graphics, px: number, s: Sel): void {
    const q = this.rectOf(s);
    if (!q) return;
    const a = this.P(q.x0, q.z1);
    g.lineStyle(px * 2, 0xffffff).strokeRect(
      a.x - px * 2,
      a.y - px * 2,
      (q.x1 - q.x0) * UNIT + px * 4,
      (q.z1 - q.z0) * UNIT + px * 4,
    );
    if (this.resizable(s)) {
      const hx = s.t === 'light' ? this.room.lights![s.i].x + this.room.lights![s.i].r : q.x1;
      const hz = s.t === 'light' ? this.room.lights![s.i].z : q.z1;
      const h = this.P(hx, hz);
      g.fillStyle(0xffffff).fillRect(h.x - 4 * px, h.y - 4 * px, 8 * px, 8 * px);
    }
  }

  private drawUi(): void {
    for (const o of this.uiDyn) o.destroy();
    this.uiDyn = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.uiLayer.add(o);
      this.uiDyn.push(o);
      return o;
    };
    const txt = (x: number, y: number, s: string, color: number = UI.ink) =>
      add(pixelText(this, x, y, s, 8, css(color)).setOrigin(0, 0));

    // top bar: room picker and buttons
    const bar = add(this.add.graphics());
    bar.fillStyle(UI.panel).fillRect(0, 0, W, TOP);
    bar.fillStyle(UI.rope).fillRect(0, TOP - 2, W, 2);
    txt(6, 9, '<', UI.spark);
    const dirty = unsaved.has(this.roomId);
    txt(20, 9, short(`${this.roomId}${dirty ? '*' : ''}`, 16), dirty ? UI.spark : UI.ink);
    txt(152, 9, '>', UI.spark);
    for (const b of this.topButtons()) {
      bar
        .fillStyle(b.label === 'SAVE' && dirty ? 0x5a3a10 : UI.panelHi)
        .fillRect(b.x, 4, b.label.length * 8 + 12, 17);
      txt(b.x + 6, 9, b.label, b.label === 'SAVE' && dirty ? UI.spark : UI.ink);
    }

    // tools
    TOOLS.forEach((tool, i) => {
      const x = SIDE.x + 4 + (i % 2) * (SIDE.w / 2);
      const y = SIDE.y + 4 + Math.floor(i / 2) * ROW;
      if (tool === this.tool)
        add(this.add.rectangle(x - 2, y - 2, SIDE.w / 2 - 4, ROW, UI.panelHi).setOrigin(0));
      txt(x, y + 1, tool === 'npc' ? 'person' : tool, tool === this.tool ? UI.spark : UI.ink);
    });

    // properties
    this.props = this.buildProps();
    const top = this.propsTop();
    add(this.add.rectangle(SIDE.x + 2, top - 8, SIDE.w - 4, 1, UI.border).setOrigin(0));
    this.props.forEach((p, i) => {
      const y = top + i * ROW;
      if (p.label) txt(SIDE.x + 4, y, short(p.label, 10), p.dim ? UI.spark : UI.inkDim);
      if (p.step) {
        txt(SIDE.x + 74, y, '<', UI.spark);
        txt(SIDE.x + SIDE.w - 12, y, '>', UI.spark);
        txt(SIDE.x + 84, y, short(p.value(), 11), UI.ink);
      } else
        txt(
          SIDE.x + (p.label ? 84 : 4),
          y,
          short(p.value(), p.label ? 12 : 22),
          p.edit ? 0x9fd8ff : p.dim ? UI.inkDim : UI.ink,
        );
    });

    // status line
    const where = RoomStore.backend() === 'shared' ? 'LINK' : 'BROWSER';
    const prob = this.problems.length
      ? `  ·  ${this.problems.length} PROBLEM${this.problems.length > 1 ? 'S' : ''}`
      : '';
    // placing something: say how; otherwise the last message (or how to use select)
    const line = this.tool !== 'select' ? TOOL_HINT[this.tool] : this.status || TOOL_HINT.select;
    txt(6, H - 18, short(line, 78), this.tool !== 'select' ? UI.ink : this.statusColor);
    add(
      tinyText(
        this,
        W - 6,
        H - 6,
        `SAVES: ${where}${prob}`,
        css(this.problems.length ? UI.rope : UI.border),
      ).setOrigin(1, 1),
    );
  }
}

/** Rounds away float noise from repeated stepping. */
function fmtNum(n: number): number {
  return Math.round(n * 1000) / 1000;
}
