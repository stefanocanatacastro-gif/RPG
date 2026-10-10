// Draws the action-command prompts in a battle and reads the player's timing.
// Judging is done by the pure functions in commands.ts; this file only turns
// button presses (keyboard, gamepad, on-screen A, or a tap anywhere on the
// stage) into timestamps and shows what's happening.

import Phaser from 'phaser';
import { input } from '../systems/input';
import { debugState } from '../systems/debug_state';
import { pixelText } from '../ui/pixel_text';
import { UI, css } from '../ui/theme';
import { t } from '../managers/strings';
import {
  COMMANDS,
  holdFill,
  judgePress,
  judgeRelease,
  judgeStomp,
  judgeGuard,
  ringRadius,
  type CommandResult,
  type GuardButton,
  type GuardJudgement,
} from './commands';

const DEPTH = 75;

export class CommandRunner {
  /** Pointers held down that started away from the on-screen controls. */
  private pointers = new Set<number>();
  private pointerPressed = false;
  /** What the current command is doing — read by the browser test. */
  state: { kind: string; startAt: number; keyAt: number } | null = null;

  constructor(private scene: Phaser.Scene) {
    const down = (p: Phaser.Input.Pointer) => {
      if (input.onTouchControl(p.x, p.y)) return;
      this.pointers.add(p.id);
      this.pointerPressed = true;
    };
    const up = (p: Phaser.Input.Pointer) => {
      this.pointers.delete(p.id);
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, down);
    scene.input.on(Phaser.Input.Events.POINTER_UP, up);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, up);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.pointerPressed = false;
    });
  }

  private now(): number {
    return this.scene.time.now;
  }

  private pressed(): boolean {
    return input.justPressed('confirm') || this.pointerPressed;
  }

  private held(): boolean {
    return input.isDown('confirm') || this.pointers.size > 0;
  }

  /** Runs `tick` every frame until it returns a result. */
  private loop(tick: (now: number) => CommandResult | null): Promise<CommandResult> {
    return new Promise((resolve) => {
      const fn = () => {
        const r = tick(this.now());
        if (r) {
          this.scene.events.off(Phaser.Scenes.Events.UPDATE, fn);
          this.state = null;
          resolve(r);
        }
      };
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, fn);
    });
  }

  /** A small round button with the confirm key's name ("Z", "A"). */
  private buttonIcon(x: number, y: number): Phaser.GameObjects.Container {
    const g = this.scene.add.graphics();
    g.fillStyle(0x1b0a10).fillCircle(1, 1, 10);
    g.fillStyle(UI.rope).fillCircle(0, 0, 10);
    g.fillStyle(0xffffff, 0.25).fillCircle(-3, -3, 4);
    const label = pixelText(this.scene, 0, -4, input.prompt('confirm'), 8, '#ffffff');
    return this.scene.add.container(x, y, [g, label]).setDepth(DEPTH);
  }

  // ── Double jump ─────────────────────────────────────────────────────

  /**
   * Starts watching for the stomp press. Call as the fall begins; `landAt` is
   * when the attacker touches down. Resolves just after landing (late grace).
   */
  stomp(attacker: Phaser.GameObjects.Sprite, landAt: number): Promise<CommandResult> {
    const cfg = COMMANDS.stomp;
    const presses: number[] = [];
    const icon = this.buttonIcon(attacker.x + 26, attacker.y - attacker.displayHeight - 4).setAlpha(0.8);
    this.state = { kind: 'stomp', startAt: this.now(), keyAt: landAt };
    return this.loop((now) => {
      icon.setPosition(attacker.x + 26, attacker.y - attacker.displayHeight - 4);
      if (this.pressed()) {
        presses.push(now);
        icon.setScale(0.8);
      }
      if (debugState.autoCommands && presses.length === 0 && now >= landAt - 20) presses.push(landAt - 10);
      if (now < landAt + cfg.lateMs && !(presses.length && presses[0] < landAt - cfg.windowMs)) return null;
      icon.destroy();
      return judgeStomp(presses, landAt);
    });
  }

  // ── Precision press ─────────────────────────────────────────────────

  /** A ring closes in on the target; one press, judged against the moment it lines up. */
  press(target: Phaser.GameObjects.Sprite): Promise<CommandResult> {
    const cfg = COMMANDS.timed_press;
    const start = this.now();
    const perfectAt = start + cfg.closeMs;
    const cx = target.x;
    const cy = target.y - target.displayHeight / 2;
    const g = this.scene.add.graphics().setDepth(DEPTH);
    const icon = this.buttonIcon(cx + cfg.startRadius + 14, cy - cfg.startRadius + 4);
    this.state = { kind: 'timed_press', startAt: start, keyAt: perfectAt };
    let pressAt: number | null = null;
    return this.loop((now) => {
      if (pressAt === null && this.pressed()) pressAt = now;
      if (pressAt === null && debugState.autoCommands && now >= perfectAt) pressAt = now;
      const r = Math.max(2, ringRadius(now, start));
      g.clear();
      // the target ring, the closing ring, and crosshair ticks
      g.lineStyle(3, UI.spark, 0.9).strokeCircle(cx, cy, cfg.targetRadius);
      g.lineStyle(2, 0xffffff, now > perfectAt ? 0.4 : 0.95).strokeCircle(cx, cy, r);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        g.lineStyle(2, UI.spark).lineBetween(
          cx + dx * (cfg.targetRadius + 3),
          cy + dy * (cfg.targetRadius + 3),
          cx + dx * (cfg.targetRadius + 8),
          cy + dy * (cfg.targetRadius + 8),
        );
      }
      const timedOut = now > perfectAt + cfg.timeoutMs;
      if (pressAt === null && !timedOut) return null;
      g.destroy();
      icon.destroy();
      return judgePress(pressAt, perfectAt);
    });
  }

  // ── Precision release ───────────────────────────────────────────────

  /** Hold to fill the bar, release inside the lit zone. */
  hold(attacker: Phaser.GameObjects.Sprite): Promise<CommandResult> {
    const cfg = COMMANDS.hold_release;
    const start = this.now();
    const w = 84;
    const h = 10;
    const x = Math.round(attacker.x - w / 2);
    const y = Math.round(attacker.y - attacker.displayHeight - 30);
    const g = this.scene.add.graphics().setDepth(DEPTH);
    const label = pixelText(
      this.scene,
      x + w / 2 - 12,
      y - 20,
      t('battle.cmd.hold'),
      8,
      css(UI.ink),
    ).setDepth(DEPTH);
    const icon = this.buttonIcon(x + w / 2 + 30, y - 16);
    this.state = { kind: 'hold_release', startAt: start, keyAt: 0 };
    let heldFrom: number | null = null;
    const draw = (fill: number, over: boolean) => {
      g.clear();
      g.fillStyle(0x1b0a10).fillRect(x - 2, y - 2, w + 4, h + 4);
      g.fillStyle(0x3a3045).fillRect(x, y, w, h);
      g.fillStyle(0x7a5a1a).fillRect(
        x + Math.round(w * cfg.goodFrom),
        y,
        Math.round(w * (cfg.greatFrom - cfg.goodFrom)),
        h,
      );
      g.fillStyle(0xa3761d).fillRect(
        x + Math.round(w * cfg.greatFrom),
        y,
        w - Math.round(w * cfg.greatFrom),
        h,
      );
      const inZone = fill >= cfg.goodFrom;
      g.fillStyle(over ? UI.rope : inZone ? UI.spark : UI.grit).fillRect(
        x,
        y + 2,
        Math.round(w * fill),
        h - 4,
      );
      g.fillStyle(0xffffff, 0.3).fillRect(x, y + 2, Math.round(w * fill), 1);
      // zone edge ticks
      g.fillStyle(UI.ink).fillRect(x + Math.round(w * cfg.goodFrom) - 1, y - 3, 2, h + 6);
    };
    draw(0, false);
    return this.loop((now) => {
      if (heldFrom === null) {
        label.setVisible(Math.floor((now - start) / 260) % 2 === 0);
        if (this.pressed() || (debugState.autoCommands && now - start > 150)) {
          heldFrom = now;
          label.setVisible(true);
          this.state = { kind: 'hold_release', startAt: now, keyAt: now + cfg.fillMs };
        } else if (now - start > cfg.startTimeoutMs) {
          g.destroy();
          label.destroy();
          icon.destroy();
          return judgeRelease(null);
        }
        return null;
      }
      const heldMs = now - heldFrom;
      const over = heldMs > cfg.fillMs + cfg.overMs;
      draw(holdFill(heldMs), over);
      const autoRelease = debugState.autoCommands && heldMs >= cfg.fillMs * 0.96;
      if (!over && !autoRelease && this.held()) return null;
      g.destroy();
      label.destroy();
      icon.destroy();
      return judgeRelease(heldMs);
    });
  }

  // ── Guarding ────────────────────────────────────────────────────────

  /**
   * Watches for Block (confirm / A / a tap on the stage) or Reversal (cancel / B)
   * during an enemy's strike. Call as the strike starts; resolves just after contact.
   */
  guard(contactAt: number): Promise<GuardJudgement> {
    const cfg = COMMANDS.guard;
    let first: { button: GuardButton; t: number } | null = null;
    this.state = { kind: 'guard', startAt: this.now(), keyAt: contactAt };
    return new Promise((resolve) => {
      const fn = () => {
        const now = this.now();
        if (!first) {
          if (input.justPressed('cancel')) first = { button: 'reversal', t: now };
          else if (this.pressed()) first = { button: 'block', t: now };
          else if (debugState.autoCommands && now >= contactAt - 30) first = { button: 'block', t: now };
        }
        if (now < contactAt + cfg.lateMs) return;
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, fn);
        this.state = null;
        resolve(judgeGuard(first, contactAt));
      };
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, fn);
    });
  }
}
