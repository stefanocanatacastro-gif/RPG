import Phaser from 'phaser';

// Body/title text until the custom bitmap fonts exist (asset outline: fonts/).
// Press Start 2P is drawn on an 8px grid, so multiples of 8 stay crisp.
export const PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';

export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: 8 | 16 | 24 | 32 | 48 = 16,
  color = '#f4ead2',
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontFamily: PIXEL_FONT,
    fontSize: `${size}px`,
    color,
    resolution: 1,
  });
  t.setOrigin(0.5, 0);
  return t;
}

/** Waits for the pixel font (max 2.5 s, then carries on with the fallback). */
export async function waitForPixelFont(): Promise<boolean> {
  if (!document.fonts?.load) return false;
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 2500));
  const load = document.fonts
    .load(`8px "Press Start 2P"`)
    .then((faces) => faces.length > 0)
    .catch(() => false);
  return Promise.race([load, timeout]);
}
