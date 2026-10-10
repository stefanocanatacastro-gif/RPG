import Phaser from 'phaser';
import { waitForPixelFont } from '../ui/pixel_text';
import { addCrashContext } from '../systems/error_overlay';
import { input } from '../systems/input';
import { IS_DEV } from '../systems/version';
import { Database } from '../managers/database';
import { allSpriteKeys } from '../managers/asset_packs';
import { englishKeys } from '../managers/strings';
import { gameState, hasGame } from '../managers/game_state';
import { rng } from '../systems/rng';
import { debugState, setDebug } from '../systems/debug_state';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    input.install(this.game);
    // dev builds: let the browser test flip debug switches directly
    if (IS_DEV) (window as unknown as { __debug: object }).__debug = { state: debugState, set: setDebug };
    Database.validate({ spriteKeys: allSpriteKeys(), stringKeys: englishKeys() });

    addCrashContext(() => ({
      scenes: this.game.scene.getScenes(true).map((s) => s.scene.key),
      zoom: this.registry.get('zoom'),
      fontReady: this.registry.get('fontReady'),
      input: input.device,
      room: hasGame() ? gameState().data.room : null,
      rngSeed: rng.seed,
      battleSeed: this.registry.get('battleSeed') ?? null,
    }));

    waitForPixelFont().then((ok) => {
      this.registry.set('fontReady', ok);
      document.getElementById('boot-note')?.remove();
      // Overlay scenes run for the whole session, above everything else.
      // They start after the font so their labels use it.
      this.scene.launch('touch_controls');
      if (IS_DEV) this.scene.launch('debug');
      this.scene.launch('transition');
      this.scene.start('preload');
    });
  }
}
