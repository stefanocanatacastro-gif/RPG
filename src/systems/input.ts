// Input mapping: keyboard, gamepad and touch all drive the same named actions,
// so game code only ever asks "is Confirm pressed?". The device last used decides
// which button names the prompts show (Z / A / tap).

import Phaser from 'phaser';
import { bus, type InputDevice } from '../managers/event_bus';

export const ACTIONS = [
  'up',
  'down',
  'left',
  'right',
  'confirm',
  'cancel',
  'jump',
  'strike',
  'partner',
  'menu',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Keyboard codes per action (KeyboardEvent.code). */
const KEYS: Record<Action, string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['KeyZ', 'Enter', 'Space'],
  cancel: ['KeyX', 'Backspace'],
  jump: ['KeyZ', 'Space'],
  strike: ['KeyX'],
  partner: ['KeyC'],
  menu: ['Escape', 'Tab'],
};

/** Standard-mapping gamepad buttons per action. */
const PAD: Record<Action, number[]> = {
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  confirm: [0],
  cancel: [1],
  jump: [0],
  strike: [1],
  partner: [2, 3],
  menu: [9],
};

const PROMPTS: Record<InputDevice, Partial<Record<Action, string>>> = {
  keyboard: { confirm: 'Z', cancel: 'X', jump: 'Z', strike: 'X', partner: 'C', menu: 'ESC' },
  gamepad: { confirm: 'A', cancel: 'B', jump: 'A', strike: 'B', partner: 'Y', menu: 'START' },
  touch: { confirm: 'A', cancel: 'B', jump: 'A', strike: 'B', partner: 'C', menu: 'MENU' },
};

const STICK_DEADZONE = 0.45;

class InputManager {
  private keysDown = new Set<string>();
  /** Keys pressed since the last poll, so a tap shorter than one frame still counts. */
  private keysTapped = new Set<string>();
  /** Screen areas covered by on-screen controls (game coordinates). */
  private zones: { x: number; y: number; r: number }[] = [];
  private touchDown = new Set<Action>();
  private scripted: { action: Action; from: number; to: number; seen: boolean }[] = [];
  private now = new Set<Action>();
  private prev = new Set<Action>();
  private _device: InputDevice = 'keyboard';
  private installed = false;
  /** Recently pressed actions, newest first (for the input tester). */
  readonly history: { action: Action; device: InputDevice; t: number }[] = [];

  get device(): InputDevice {
    return this._device;
  }

  install(game: Phaser.Game): void {
    if (this.installed) return;
    this.installed = true;
    const gameCodes = new Set(Object.values(KEYS).flat());

    window.addEventListener('keydown', (e) => {
      if (gameCodes.has(e.code)) e.preventDefault(); // stop Space/arrows scrolling the page
      this.keysDown.add(e.code);
      this.keysTapped.add(e.code);
      this.setDevice('keyboard');
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.touchDown.clear();
    });
    window.addEventListener('touchstart', () => this.setDevice('touch'), { passive: true });

    // Sample all devices once per frame, before scenes update.
    game.events.on(Phaser.Core.Events.PRE_STEP, (time: number) => this.poll(time));
  }

  private setDevice(d: InputDevice): void {
    if (d === this._device) return;
    this._device = d;
    bus.emit('input.device', { device: d });
  }

  private poll(time = 0): void {
    this.prev = this.now;
    const next = new Set<Action>();
    // scripted presses (browser tests): held from `from` until `to`, at least one frame
    this.scripted = this.scripted.filter((h) => {
      if (time >= h.from && (time < h.to || !h.seen)) {
        next.add(h.action);
        h.seen = true;
      }
      return !(h.seen && time >= h.to);
    });
    for (const a of ACTIONS) {
      if (KEYS[a].some((k) => this.keysDown.has(k) || this.keysTapped.has(k))) next.add(a);
      if (this.touchDown.has(a)) next.add(a);
    }
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      let any = false;
      for (const a of ACTIONS) {
        if (PAD[a].some((b) => pad.buttons[b]?.pressed)) {
          next.add(a);
          any = true;
        }
      }
      const [lx = 0, ly = 0] = pad.axes;
      if (lx < -STICK_DEADZONE) next.add('left');
      if (lx > STICK_DEADZONE) next.add('right');
      if (ly < -STICK_DEADZONE) next.add('up');
      if (ly > STICK_DEADZONE) next.add('down');
      if (any || Math.abs(lx) > STICK_DEADZONE || Math.abs(ly) > STICK_DEADZONE) this.setDevice('gamepad');
    }
    this.keysTapped.clear();
    this.now = next;
    for (const a of next) {
      if (!this.prev.has(a)) {
        this.history.unshift({ action: a, device: this._device, t: performance.now() });
        if (this.history.length > 12) this.history.pop();
      }
    }
  }

  /** Held this frame. */
  isDown(a: Action): boolean {
    return this.now.has(a);
  }

  /** Pressed this frame (wasn't held last frame). */
  justPressed(a: Action): boolean {
    return this.now.has(a) && !this.prev.has(a);
  }

  justReleased(a: Action): boolean {
    return !this.now.has(a) && this.prev.has(a);
  }

  /** -1, 0 or 1 on each axis from the d-pad, arrows or stick. */
  axis(): { x: number; y: number } {
    return {
      x: (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0),
      y: (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0),
    };
  }

  /**
   * Dev builds / browser tests: holds an action from game time `from` until `to`.
   * The press lands on the first frame at or after `from`, independent of how
   * accurate the browser's timers are.
   */
  script(action: Action, from: number, to: number): void {
    this.scripted.push({ action, from, to, seen: false });
  }

  /** Used by the on-screen touch controls. */
  setTouch(a: Action, down: boolean): void {
    if (down) {
      this.touchDown.add(a);
      this.setDevice('touch');
    } else this.touchDown.delete(a);
  }

  setTouchZones(zones: { x: number; y: number; r: number }[]): void {
    this.zones = zones;
  }

  /** True when a point is on an on-screen control, so menus can ignore that tap. */
  onTouchControl(x: number, y: number): boolean {
    return this.zones.some((z) => (x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r);
  }

  clearTouch(): void {
    this.touchDown.clear();
  }

  /** Button name for prompts on the current device ("Z", "A", "MENU"). */
  prompt(a: Action): string {
    return PROMPTS[this._device][a] ?? a.toUpperCase();
  }
}

export const input = new InputManager();
