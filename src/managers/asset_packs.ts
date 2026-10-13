import Phaser from 'phaser';
import type { AssetPack } from '../types/asset_pack';
import { makePlaceholder } from '../systems/placeholder';
import { runtimeSpriteKeys } from './sprite_keys';

// Every JSON in src/data/packs is bundled at build time and keyed by its id.
const modules = import.meta.glob<AssetPack>('../data/packs/*.json', { eager: true, import: 'default' });
const PACKS: Record<string, AssetPack> = {};
for (const pack of Object.values(modules)) PACKS[pack.id] = pack;

const loaded = new Set<string>();

export function packIds(): string[] {
  return Object.keys(PACKS);
}

export function getPack(id: string): AssetPack {
  const pack = PACKS[id];
  if (!pack) throw new Error(`Unknown asset pack "${id}". Known packs: ${packIds().join(', ')}`);
  return pack;
}

export function isPackLoaded(id: string): boolean {
  return loaded.has(id);
}

/**
 * Queues a pack on the scene's loader. Images without a url, or whose file fails
 * to load, get a placeholder of the declared size. Call scene.load.start() after
 * queuing if you're outside a preload() method.
 */
export function queuePack(scene: Phaser.Scene, id: string): void {
  const pack = getPack(id);
  const sizes = new Map(pack.images.map((i) => [i.key, i]));

  for (const img of pack.images) {
    if (img.url) scene.load.image(img.key, `assets/${img.url}`);
  }
  for (const a of pack.audio ?? []) {
    scene.load.audio(
      a.key,
      a.urls.map((u) => `assets/${u}`),
    );
  }

  const onError = (file: Phaser.Loader.File) => {
    const spec = sizes.get(file.key);
    if (spec) {
      console.warn(`[assets] ${file.key} failed to load (${file.src}); using placeholder`);
      makePlaceholder(scene, spec);
    }
  };
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    for (const img of pack.images) {
      if (!scene.textures.exists(img.key)) makePlaceholder(scene, img);
    }
    loaded.add(id);
  });
}

/** Frees a chapter pack's textures and sounds. The core pack is never unloaded. */
export function unloadPack(scene: Phaser.Scene, id: string): void {
  if (id === 'core' || !loaded.has(id)) return;
  const pack = getPack(id);
  for (const img of pack.images) if (scene.textures.exists(img.key)) scene.textures.remove(img.key);
  for (const a of pack.audio ?? []) scene.cache.audio.remove(a.key);
  loaded.delete(id);
}

/** Every image key declared in any pack (the Database checks sprites against this). */
export function allSpriteKeys(): Set<string> {
  return new Set([
    ...Object.values(PACKS).flatMap((p) => p.images.map((i) => i.key)),
    ...runtimeSpriteKeys(),
  ]);
}
