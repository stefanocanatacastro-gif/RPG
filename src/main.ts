import { installErrorOverlay, showCrash } from './systems/error_overlay';

// The crash screen is installed before the game starts, so start-up failures are reported too.
installErrorOverlay();

import Phaser from 'phaser';
import './fonts.css';
import { BootScene } from './scenes/boot';
import { PreloadScene } from './scenes/preload';
import { TitleScene } from './scenes/title';
import { DevHubScene } from './scenes/dev_hub';
import { BattleScene } from './scenes/battle';
import { BattleSandboxScene } from './scenes/battle_sandbox';
import { FighterMakerScene } from './scenes/fighter_maker';
import { EncountersScene } from './scenes/encounters';
import { ItemMakerScene } from './scenes/item_maker';
import { MoveMakerScene } from './scenes/move_maker';
import { SpriteStudioScene } from './scenes/sprite_studio';
import { GalleryScene } from './scenes/gallery';
import { PlayScene } from './scenes/play';
import { BattleMakerScene } from './scenes/battle_maker';
import { InputTestScene, UiKitScene, AnimTestScene, DataReportScene } from './scenes/bench_scenes';
import { TouchControlsScene } from './scenes/touch_controls';
import { DebugMenuScene } from './scenes/debug_menu';
import { TransitionScene } from './scenes/transition';
import { GAME_WIDTH, GAME_HEIGHT, installIntegerScaling } from './systems/integer_scale';
import { versionLabel } from './systems/version';

function startGame(): void {
  const parent = document.getElementById('game');
  if (!parent) throw new Error('Missing #game element in index.html');

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0b0910',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    input: { keyboard: true, mouse: true, touch: true, gamepad: false, activePointers: 4 },
    physics: { default: 'arcade', arcade: { debug: false } },
    banner: false,
    // Order sets drawing order: overlays last so they sit on top.
    scene: [
      BootScene,
      PreloadScene,
      TitleScene,
      DevHubScene,
      BattleScene,
      BattleSandboxScene,
      FighterMakerScene,
      EncountersScene,
      ItemMakerScene,
      MoveMakerScene,
      GalleryScene,
      PlayScene,
      BattleMakerScene,
      SpriteStudioScene,
      InputTestScene,
      UiKitScene,
      AnimTestScene,
      DataReportScene,
      TouchControlsScene,
      DebugMenuScene,
      TransitionScene,
    ],
  });

  installIntegerScaling(game, parent);
  (window as unknown as { __game: Phaser.Game }).__game = game;
  console.info(`Kid Chispa ${versionLabel()}`);
}

try {
  startGame();
} catch (err) {
  showCrash(err, 'startup');
}
