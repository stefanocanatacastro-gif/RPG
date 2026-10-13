// Texture keys made while the game runs (made fighters' colour swaps), so the
// data checks accept them like keys declared in asset packs.

const runtimeKeys = new Set<string>();

export function registerSpriteKey(key: string): void {
  runtimeKeys.add(key);
}

export function runtimeSpriteKeys(): Set<string> {
  return new Set(runtimeKeys);
}
