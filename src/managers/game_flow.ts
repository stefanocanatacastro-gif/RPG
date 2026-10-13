// Starting play: a new game, or picking up a save where it was made.

import type Phaser from 'phaser';
import { SceneLoader } from './scene_loader';
import { gameState, newGame, type SaveData } from './game_state';
import { Database } from './database';
import { ROOMS } from '../field/rooms';
import rules from '../data/rules.json';

export function startNewGame(from: Phaser.Scene): void {
  newGame(Database.character('chispa'));
  void SceneLoader.enterRoom(from, 'field', { room: rules.newGame.room, spawn: rules.newGame.spawn });
}

/** Loads a save and walks back in where it was made (or the first room, if that room is gone). */
export function startFromSave(from: Phaser.Scene, data: SaveData): void {
  newGame(Database.character('chispa'));
  gameState().restore(data);
  if (!ROOMS[data.room])
    return void SceneLoader.enterRoom(from, 'field', {
      room: rules.newGame.room,
      spawn: rules.newGame.spawn,
    });
  void SceneLoader.enterRoom(from, 'field', {
    room: data.room,
    x: data.pos.x,
    y: data.pos.y,
    facing: data.facing,
  });
}
