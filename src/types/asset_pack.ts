// Asset pack: the list of files one part of the game needs. "core" is loaded at
// start-up; each chapter has its own pack, loaded when that chapter begins and
// unloaded when it ends, so the game never holds every chapter in memory at once.

export interface PackImage {
  key: string;
  /** Path under public/assets. Omit while the art doesn't exist yet. */
  url?: string;
  /** Size used for the placeholder when the art is missing or fails to load. */
  w: number;
  h: number;
}

export interface PackAudio {
  key: string;
  /** One or more files (e.g. .ogg plus an .m4a copy for Apple devices). */
  urls: string[];
}

export interface AssetPack {
  id: string;
  /** Short note on what the pack is for. */
  note: string;
  images: PackImage[];
  audio?: PackAudio[];
}
