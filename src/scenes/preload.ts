import Phaser from 'phaser';
import { queuePack } from '../managers/asset_packs';
import { GAME_WIDTH, GAME_HEIGHT } from '../systems/integer_scale';
import { tinyText, tinyTextWidth } from '../ui/tiny_font';
import { t } from '../managers/strings';
import { makeTestWrestler } from '../systems/test_sprites';
import { buildAnimations } from '../systems/anim_builder';
import { prepareHeroArt } from '../systems/hero_art';
import { prepareOpponentArt } from '../systems/opponent_art';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('preload');
  }

  preload(): void {
    const barW = 240;
    const x = Math.round((GAME_WIDTH - barW) / 2);
    const y = Math.round(GAME_HEIGHT / 2);
    const label = t('loading');
    tinyText(this, Math.round((GAME_WIDTH - tinyTextWidth(label) * 2) / 2), y - 20, label, '#8a7f99')
      .setOrigin(0)
      .setScale(2);

    this.add.rectangle(x - 4, y - 4, barW + 8, 16, 0x3a3045).setOrigin(0);
    const fill = this.add.rectangle(x, y, 0, 8, 0xffb238).setOrigin(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      fill.width = Math.round(barW * p);
    });

    queuePack(this, 'core');
    // The Prologue pack is small; the grey-box tests use its enemies.
    queuePack(this, 'c0_prologue');
  }

  create(): void {
    makeTestWrestler(this);
    buildAnimations(this, 'spr_test_dummy', {
      fps: { idle: 3, walk: 8, chop: 12, hurt: 6 },
      once: ['chop', 'hurt'],
    });
    void Promise.all([prepareHeroArt(this), prepareOpponentArt(this)]).then(() => this.scene.start('title'));
  }
}
