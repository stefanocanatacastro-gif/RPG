// SceneLoader: every screen change goes through here so it gets the curtain
// wipe, and so the screen that starts a battle is put to sleep (not destroyed)
// and woken exactly as it was afterwards.

import Phaser from 'phaser';
import type { TransitionScene } from '../scenes/transition';
import { bus, type BattleResult } from './event_bus';
import type { FormationDef } from '../types/data';

export interface BattleStart {
  formation: string;
  firstStrike: 'player' | 'enemy' | null;
  /** Field scene to wake when the battle ends. */
  returnTo: string;
  /** Id of the field enemy that started it, so the field can remove it on a win. */
  fieldEnemyId?: string;
  /** Battle sandbox: a line-up built on the spot instead of one from formations.json. */
  formationDef?: FormationDef;
  /** Fixed seed, to replay a fight exactly. */
  seed?: number;
  /** Losing doesn't end the game (sandbox, story fights you're meant to lose). */
  loseOk?: boolean;
  /** Battle sandbox: the hero's attack and defence for this fight. */
  hero?: { attack: number; defence: number };
}

export interface BattleEnd {
  result: BattleResult;
  formation: string;
  fieldEnemyId?: string;
}

let busy = false;

/**
 * A change asked for while the curtain is still moving waits for it, rather
 * than being lost. False when the asking scene went away meanwhile.
 */
async function settled(from: Phaser.Scene): Promise<boolean> {
  if (!busy) return true;
  while (busy) await new Promise((r) => setTimeout(r, 16));
  return from.scene.isActive() || from.scene.isPaused();
}

function curtain(game: Phaser.Game): TransitionScene {
  return game.scene.getScene('transition') as TransitionScene;
}

async function wipe(game: Phaser.Game, swap: () => void): Promise<void> {
  const tr = curtain(game);
  await tr.close();
  swap();
  // give the new scene one frame to build before opening
  await new Promise((r) => setTimeout(r, 30));
  await tr.open();
}

export const SceneLoader = {
  isBusy: () => busy,

  /** Replaces the current scene with another (title → hub, room → room). */
  async goto(from: Phaser.Scene, to: string, data?: object): Promise<void> {
    if (!(await settled(from))) return;
    busy = true;
    try {
      await wipe(from.game, () => {
        from.scene.start(to, data);
      });
    } finally {
      busy = false;
    }
  },

  /** Field → battle. The field sleeps so its state is exactly as left. */
  async startBattle(field: Phaser.Scene, battleKey: string, start: BattleStart): Promise<void> {
    if (!(await settled(field))) return;
    busy = true;
    try {
      field.scene.pause(); // freeze immediately so nothing moves during the wipe
      await wipe(field.game, () => {
        // Phaser only sleeps a running scene, so un-pause first (both happen this frame).
        field.scene.resume();
        field.scene.sleep();
        field.scene.launch(battleKey, start);
      });
      bus.emit('battle.started', { formation: start.formation, firstStrike: start.firstStrike });
    } finally {
      busy = false;
    }
  },

  /** Battle → field, waking the field where it was. */
  async endBattle(battle: Phaser.Scene, returnTo: string, end: BattleEnd): Promise<void> {
    if (!(await settled(battle))) return;
    busy = true;
    try {
      await wipe(battle.game, () => {
        battle.scene.stop();
        battle.scene.wake(returnTo, end);
      });
      bus.emit('battle.ended', { formation: end.formation, result: end.result });
    } finally {
      busy = false;
    }
  },
};
