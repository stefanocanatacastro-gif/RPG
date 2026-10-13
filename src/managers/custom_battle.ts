// Fights built outside the story (sandbox, encounters): any hero with any
// numbers, any partner, any opponents. They run on a temporary copy of the
// game state, and the real save and debug switches are put back afterwards.

import type Phaser from 'phaser';
import { SceneLoader } from './scene_loader';
import { gameState, type SaveData } from './game_state';
import { Database } from './database';
import { debugState, setDebug } from '../systems/debug_state';
import { Rng } from '../systems/rng';
import { formationOf, type BattleSetup } from './battle_setup';

export * from './battle_setup';

export type Assist = 'off' | 'perfect' | 'god' | 'both';

let restoreState: { save: SaveData; god: boolean; auto: boolean } | null = null;

/** Starts the fight; `returnTo` wakes when it ends and should call finishCustomBattle(). */
export function startCustomBattle(
  from: Phaser.Scene,
  s: BattleSetup,
  returnTo: string,
  opts: { assist?: Assist; seed?: number } = {},
): number {
  const gs = gameState();
  const save = gs.snapshot();
  restoreState = { save, god: debugState.god, auto: debugState.autoCommands };
  const tmp: SaveData = structuredClone(save);
  tmp.party[0] = { id: s.hero, maxHp: s.maxHp, hp: s.maxHp };
  tmp.maxGrit = s.grit;
  tmp.grit = s.grit;
  // the encounter's own bag, not the save's
  tmp.items = s.conditions?.noItems ? [] : [...(s.items ?? [])];
  const partner = s.partner && s.partner !== s.hero ? Database.character(s.partner) : null;
  tmp.activePartner = partner?.id ?? null;
  if (partner) {
    tmp.party = tmp.party.filter((m, i) => i === 0 || m.id !== partner.id);
    tmp.party.push({ id: partner.id, hp: partner.hp, maxHp: partner.hp });
  }
  gs.restore(tmp);
  const assist = opts.assist ?? 'off';
  setDebug('autoCommands', assist === 'perfect' || assist === 'both');
  setDebug('god', assist === 'god' || assist === 'both');
  const seed = opts.seed ?? Rng.freshSeed();
  void SceneLoader.startBattle(from, 'battle', {
    formation: 'custom',
    formationDef: formationOf(s),
    seed,
    hero: { attack: s.attack, defence: s.defence },
    firstStrike: s.firstStrike,
    returnTo,
    loseOk: true,
  });
  return seed;
}

/** Puts the save and debug switches back after a custom fight. */
export function finishCustomBattle(): void {
  if (!restoreState) return;
  gameState().restore(restoreState.save);
  setDebug('god', restoreState.god);
  setDebug('autoCommands', restoreState.auto);
  restoreState = null;
}
