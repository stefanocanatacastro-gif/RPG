// Integer scaling: the 640×360 game is drawn at the largest whole-number zoom that
// fits the window (2×, 3×, 4×…), so every game pixel is the same size on screen.
// The leftover space is letterboxed in the page background. On screens smaller
// than 640×360 it falls back to a fractional fit so the game is never cut off.

import Phaser from 'phaser';

export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;

export function computeZoom(viewW: number, viewH: number): number {
  const fit = Math.min(viewW / GAME_WIDTH, viewH / GAME_HEIGHT);
  return fit >= 1 ? Math.floor(fit) : fit;
}

export function installIntegerScaling(game: Phaser.Game, parent: HTMLElement): void {
  const apply = () => {
    const vv = window.visualViewport;
    const w = vv?.width ?? window.innerWidth;
    const h = vv?.height ?? window.innerHeight;
    const zoom = computeZoom(w, h);
    parent.style.width = `${Math.round(GAME_WIDTH * zoom)}px`;
    parent.style.height = `${Math.round(GAME_HEIGHT * zoom)}px`;
    game.registry.set('zoom', zoom);
    game.scale.refresh();
  };
  apply();
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 150));
}
