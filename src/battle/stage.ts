// The battle arena, drawn in true perspective so it reads as a 3D space:
// a raised ring (canvas, apron, corner posts, turnbuckles, ropes), floor mats
// and a barricade around it, crowd stands behind and on both sides rising away
// from the ring, and a lighting rig with spotlights on the canvas.
//
// Everything is placed with P(X, Y, Z) in arena units:
//   X — left/right of the ring's centre, Z — distance from the camera,
//   Y — height above the arena floor (the canvas is 1 unit up).
// The arena is larger than the screen; the battle camera pans and zooms over it.
// Fighters stand on one depth line across the ring at their pixel size, so the
// pixel art is never resized by the perspective.

import Phaser from 'phaser';
import type { StageDef } from '../types/data';

export const ARENA = {
  width: 960,
  height: 600,
  /** Perspective: screen centre x, horizon y, focal length, camera height (units). */
  cx: 480,
  horizon: 150,
  f: 520,
  camH: 3.2,
  ring: { half: 3.6, near: 6.4, far: 13.6, canvasY: 1 },
  /** Depth line the fighters stand on. */
  fighterZ: 9.6,
  heroX: -2.3,
  enemyX: [0.9, 2.0, 3.1, 3.4],
  flyerLift: 1.6,
};

export function P(X: number, Y: number, Z: number): { x: number; y: number } {
  const s = ARENA.f / Z;
  return { x: ARENA.cx + X * s, y: ARENA.horizon + (ARENA.camH - Y) * s };
}

/** Pixels per arena unit at a depth. */
export const unitPx = (Z: number) => ARENA.f / Z;

const ringTop = ARENA.ring.canvasY;
const FLOOR_Y = P(0, ringTop, ARENA.fighterZ).y;

export const STAGE = {
  /** Feet line for fighters standing on the canvas. */
  floorY: Math.round(FLOOR_Y),
  heroX: Math.round(P(ARENA.heroX, ringTop, ARENA.fighterZ).x),
};

/** Where a fighter stands: hero on the left, enemies across the ring, flyers above it. */
export function homeOf(side: 'hero' | 'enemy', order: number, airborne: boolean): { x: number; y: number } {
  if (side === 'hero') return { x: STAGE.heroX, y: STAGE.floorY };
  const X = ARENA.enemyX[Math.min(order, ARENA.enemyX.length - 1)];
  const p = P(X, ringTop + (airborne ? ARENA.flyerLift : 0), ARENA.fighterZ);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

// ── Drawing ────────────────────────────────────────────────────────────

type V = Phaser.Math.Vector2;
const vec = (p: { x: number; y: number }): V => new Phaser.Math.Vector2(Math.round(p.x), Math.round(p.y));
const quad = (g: Phaser.GameObjects.Graphics, color: number, pts: { x: number; y: number }[], alpha = 1) =>
  g.fillStyle(color, alpha).fillPoints(pts.map(vec), true);

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns a finished Graphics drawing into a single image. The arena is thousands
 * of shapes; redrawing them every frame halved the frame rate, an image costs
 * almost nothing.
 */
function bake(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, key: string): Phaser.GameObjects.Image {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  g.generateTexture(key, ARENA.width, ARENA.height);
  const img = scene.add.image(0, 0, key).setOrigin(0).setDepth(g.depth);
  g.destroy();
  return img;
}

export interface Arena {
  /** Makes the crowd jump (big hits, knockouts, victory). */
  cheer(strength?: number): void;
}

const CROWD_SKIN = [0x8a6a5a, 0x6e5040, 0xa07a62, 0x5a4034];

const hex = (c: string): number => parseInt(c.replace('#', ''), 16);

/** A stage skin's colours as numbers. */
function palette(st: StageDef) {
  const n = (list: string[]) => list.map(hex);
  return {
    sky: n(st.sky),
    rows: n(st.rows),
    shirts: n(st.shirts),
    barricade: n(st.barricade),
    mats: n(st.mats),
    apron: n(st.apron),
    emblem: hex(st.emblem),
    canvas: n(st.canvas),
    post: n(st.post),
    buckle: n(st.buckle),
    rope: n(st.rope),
    truss: hex(st.truss),
    light: hex(st.light),
  };
}

export function drawStage(scene: Phaser.Scene, stage: StageDef): Arena {
  const { width: AW, height: AH } = ARENA;
  const C = palette(stage);
  const rand = rng(1931);
  const heads: { x: number; y: number; s: number }[] = [];

  // dithered backdrop: dark at the rafters, a little warmer behind the crowd
  const key = `__arena_bg_${stage.id}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, AW, AH)!;
    const ctx = tex.getContext();
    const img = ctx.createImageData(AW, AH);
    const ramp = C.sky;
    for (let y = 0; y < AH; y++) {
      const pos = Math.min(1, y / 260) * (ramp.length - 1);
      const lo = Math.min(Math.floor(pos), ramp.length - 2);
      const frac = pos - lo;
      for (let x = 0; x < AW; x++) {
        const c = frac * 16 > BAYER4[(y & 3) * 4 + (x & 3)] ? ramp[lo + 1] : ramp[lo];
        const i = (y * AW + x) * 4;
        img.data[i] = (c >> 16) & 255;
        img.data[i + 1] = (c >> 8) & 255;
        img.data[i + 2] = c & 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // arena floor, far beyond the ring in every direction
    ctx.fillStyle = stage.floor;
    ctx.beginPath();
    [P(-30, 0, 3.6), P(30, 0, 3.6), P(30, 0, 24), P(-30, 0, 24)].forEach((pt, i) =>
      i ? ctx.lineTo(Math.round(pt.x), Math.round(pt.y)) : ctx.moveTo(Math.round(pt.x), Math.round(pt.y)),
    );
    ctx.fill();
    tex.refresh();
  }
  scene.add.image(0, 0, key).setOrigin(0).setDepth(-100);

  // ── crowd stands ──
  const rowColors = C.rows;
  // fewer people in smaller venues: empty seats are skipped
  const seated = () => rand() < stage.crowd;
  const drawHead = (g: Phaser.GameObjects.Graphics, X: number, Y: number, Z: number) => {
    const s = unitPx(Z);
    const p = P(X, Y, Z);
    const hw = Math.max(2, Math.round(0.34 * s));
    const bodyW = Math.max(3, Math.round(0.55 * s));
    const bob = Math.round(rand() * 0.08 * s);
    g.fillStyle(shade(C.shirts[Math.floor(rand() * C.shirts.length)], 0.42 + Z / 90));
    g.fillRect(Math.round(p.x - bodyW / 2), Math.round(p.y - 0.35 * s) - bob, bodyW, Math.round(0.4 * s));
    g.fillStyle(shade(CROWD_SKIN[Math.floor(rand() * CROWD_SKIN.length)], 0.4 + Z / 100));
    g.fillRect(Math.round(p.x - hw / 2), Math.round(p.y - 0.35 * s - hw) - bob, hw, hw);
    heads.push({ x: p.x, y: p.y - 0.35 * s - hw, s });
    // the odd raised arm or sign
    if (rand() < 0.06) {
      g.fillRect(
        Math.round(p.x + hw / 2),
        Math.round(p.y - 0.75 * s) - bob,
        Math.max(1, Math.round(0.1 * s)),
        Math.round(0.4 * s),
      );
    } else if (rand() < 0.018) {
      const sw = Math.round(0.8 * s);
      const sh = Math.round(0.4 * s);
      g.fillStyle(0xb8ae98).fillRect(Math.round(p.x - sw / 2), Math.round(p.y - 1.1 * s) - bob, sw, sh);
      g.fillStyle([0xa82a40, 0x2a5aa8, 0xc88a2a][Math.floor(rand() * 3)]);
      g.fillRect(
        Math.round(p.x - sw / 2 + 2),
        Math.round(p.y - 1.1 * s + 2) - bob,
        Math.max(2, sw - 4),
        Math.max(1, Math.round(sh / 3)),
      );
    }
  };

  // back stands: rows rising away from the ring
  const back = scene.add.graphics().setDepth(-90);
  for (let r = 6; r >= 0; r--) {
    const Z = 16.2 + r * 1.15;
    const Y = 0.55 + r * 0.6;
    quad(back, rowColors[r], [P(-26, Y - 0.6, Z), P(26, Y - 0.6, Z), P(26, Y, Z), P(-26, Y, Z)]);
    quad(back, shade(rowColors[r], 0.7), [
      P(-26, Y, Z),
      P(26, Y, Z),
      P(26, Y, Z + 1.15),
      P(-26, Y, Z + 1.15),
    ]);
    for (let X = -25; X < 25; X += 0.5 + rand() * 0.15) if (seated()) drawHead(back, X, Y, Z + 0.4);
  }
  // side stands: rows rising away from the ring to the left and right
  for (const dir of [-1, 1]) {
    const g = back;
    for (let r = 5; r >= 0; r--) {
      const X = dir * (6.6 + r * 1.05);
      const Y = 0.55 + r * 0.6;
      quad(g, rowColors[r], [P(X, Y - 0.6, 4), P(X, Y - 0.6, 16.2), P(X, Y, 16.2), P(X, Y, 4)]);
      quad(g, shade(rowColors[r], 0.7), [
        P(X, Y, 4),
        P(X, Y, 16.2),
        P(X + dir * 1.05, Y, 16.2),
        P(X + dir * 1.05, Y, 4),
      ]);
      for (let Z = 15.8; Z > 4.4; Z -= 0.55 + rand() * 0.15) if (seated()) drawHead(g, X + dir * 0.45, Y, Z);
    }
  }

  // barricade around the ringside area
  // everything static between the crowd and the fighters is one drawing
  const top = scene.add.graphics().setDepth(-80);
  const rail = top;
  const bx = 5.6;
  const bz0 = 4.2;
  const bz1 = 15.6;
  quad(rail, C.barricade[0], [P(-bx, 0, bz1), P(bx, 0, bz1), P(bx, 0.55, bz1), P(-bx, 0.55, bz1)]);
  for (const dir of [-1, 1]) {
    quad(rail, C.barricade[1], [
      P(dir * bx, 0, bz0),
      P(dir * bx, 0, bz1),
      P(dir * bx, 0.55, bz1),
      P(dir * bx, 0.55, bz0),
    ]);
    const a = P(dir * bx, 0.55, bz0);
    const b = P(dir * bx, 0.55, bz1);
    rail.lineStyle(2, C.barricade[2]).lineBetween(a.x, a.y, b.x, b.y);
  }
  const ra = P(-bx, 0.55, bz1);
  const rb = P(bx, 0.55, bz1);
  rail.lineStyle(2, C.barricade[2]).lineBetween(ra.x, ra.y, rb.x, rb.y);

  // ringside mats
  quad(rail, C.mats[0], [P(-5.2, 0, 4.6), P(5.2, 0, 4.6), P(5.2, 0, 15.2), P(-5.2, 0, 15.2)]);
  quad(rail, C.mats[1], [P(-4.6, 0, 5.2), P(4.6, 0, 5.2), P(4.6, 0, 14.6), P(-4.6, 0, 14.6)]);

  // ── the ring ──
  const { half: rh, near: rn, far: rf } = ARENA.ring;
  const ring = top;
  // contact shadow on the mats
  quad(
    ring,
    0x000000,
    [
      P(-rh - 0.3, 0, rn - 0.2),
      P(rh + 0.3, 0, rn - 0.2),
      P(rh + 0.3, 0, rf + 0.3),
      P(-rh - 0.3, 0, rf + 0.3),
    ],
    0.35,
  );
  // apron (the skirt on the near face) with panels
  quad(ring, C.apron[0], [P(-rh, 0, rn), P(rh, 0, rn), P(rh, ringTop, rn), P(-rh, ringTop, rn)]);
  quad(ring, C.apron[1], [P(-rh, 0, rn), P(rh, 0, rn), P(rh, 0.12, rn), P(-rh, 0.12, rn)]);
  for (let X = -rh + 1.2; X < rh; X += 1.2) {
    const a = P(X, 0.12, rn);
    const b = P(X, ringTop, rn);
    ring.lineStyle(1, C.apron[1]).lineBetween(a.x, a.y, b.x, b.y);
  }
  const apronTop0 = P(-rh, ringTop, rn);
  const apronTop1 = P(rh, ringTop, rn);
  ring.lineStyle(2, C.apron[2]).lineBetween(apronTop0.x, apronTop0.y + 1, apronTop1.x, apronTop1.y + 1);
  // gold spark emblem on the apron
  const em = (dx: number, dy: number) => P(dx * 0.42, 0.5 + dy * 0.42, rn - 0.01);
  quad(ring, C.emblem, [
    em(0.1, 1),
    em(-0.6, -0.05),
    em(-0.05, -0.05),
    em(-0.35, -1),
    em(0.6, 0.15),
    em(0.05, 0.15),
    em(0.45, 1),
  ]);
  // canvas
  quad(ring, C.canvas[0], [P(-rh, ringTop, rn), P(rh, ringTop, rn), P(rh, ringTop, rf), P(-rh, ringTop, rf)]);
  quad(ring, C.canvas[1], [
    P(-rh + 0.25, ringTop, rn + 0.25),
    P(rh - 0.25, ringTop, rn + 0.25),
    P(rh - 0.25, ringTop, rf - 0.25),
    P(-rh + 0.25, ringTop, rf - 0.25),
  ]);
  // spotlight pool on the canvas
  const pool: { x: number; y: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pool.push(P(Math.cos(a) * 2.6, ringTop, ARENA.fighterZ + 0.2 + Math.sin(a) * 2.2));
  }
  quad(ring, C.canvas[2], pool, 0.55);
  // canvas logo, flat on the mat
  const logo = (dx: number, dz: number) => P(dx * 0.9, ringTop, ARENA.fighterZ + 1.6 + dz * 0.9);
  quad(
    ring,
    C.canvas[3],
    [
      logo(0.15, 1),
      logo(-0.7, -0.1),
      logo(-0.1, -0.1),
      logo(-0.4, -1),
      logo(0.7, 0.15),
      logo(0.1, 0.15),
      logo(0.5, 1),
    ],
    0.8,
  );

  // posts, turnbuckles and ropes
  const ropeHeights = [0.45, 0.85, 1.25];
  const postH = 1.55;
  const posts = { nl: [-rh, rn], nr: [rh, rn], fl: [-rh, rf], fr: [rh, rf] } as const;
  const drawPost = (g: Phaser.GameObjects.Graphics, X: number, Z: number) => {
    const s = unitPx(Z);
    const w = Math.max(4, Math.round(0.18 * s));
    const b = P(X, ringTop, Z);
    const t = P(X, ringTop + postH, Z);
    g.fillStyle(C.post[0]).fillRect(Math.round(b.x - w / 2), Math.round(t.y), w, Math.round(b.y - t.y));
    g.fillStyle(C.post[1]).fillRect(
      Math.round(b.x - w / 2),
      Math.round(t.y),
      Math.max(1, Math.round(w / 3)),
      Math.round(b.y - t.y),
    );
    for (const h of ropeHeights) {
      const p = P(X, ringTop + h, Z);
      const pw = Math.round(w * 1.9);
      const ph = Math.max(4, Math.round(0.22 * s));
      g.fillStyle(C.buckle[0]).fillRect(Math.round(p.x - pw / 2), Math.round(p.y - ph / 2), pw, ph);
      g.fillStyle(C.buckle[1]).fillRect(
        Math.round(p.x - pw / 2),
        Math.round(p.y - ph / 2),
        pw,
        Math.max(1, Math.round(ph / 3)),
      );
    }
    g.fillStyle(C.post[2]).fillRect(Math.round(b.x - w / 2 - 1), Math.round(t.y) - 2, w + 2, 3);
  };
  const rope = (g: Phaser.GameObjects.Graphics, a: readonly number[], b: readonly number[]) => {
    for (const h of ropeHeights) {
      const p = P(a[0], ringTop + h, a[1]);
      const q = P(b[0], ringTop + h, b[1]);
      const w = Math.max(2, Math.round(0.06 * unitPx(Math.min(a[1], b[1]))));
      g.lineStyle(w, C.rope[0]).lineBetween(p.x, p.y, q.x, q.y);
      g.lineStyle(1, C.rope[1]).lineBetween(p.x, p.y - Math.floor(w / 2), q.x, q.y - Math.floor(w / 2));
    }
  };
  const backRig = top;
  drawPost(backRig, posts.fl[0], posts.fl[1]);
  drawPost(backRig, posts.fr[0], posts.fr[1]);
  rope(backRig, posts.fl, posts.fr);
  rope(backRig, posts.nl, posts.fl);
  rope(backRig, posts.nr, posts.fr);
  // the near posts stand in front of the fighters (no near ropes, like an open stage)
  for (const [i, [X, Z]] of [posts.nl, posts.nr].entries()) {
    const b = P(X, ringTop, Z);
    const tp = P(X, ringTop + postH, Z);
    const pad = Math.ceil(0.4 * unitPx(Z));
    const x0 = Math.floor(b.x - pad);
    const y0 = Math.floor(tp.y - 4);
    const g = scene.make.graphics({}, false);
    g.translateCanvas(-x0, -y0);
    drawPost(g, X, Z);
    const k = `__arena_post${i}`;
    if (scene.textures.exists(k)) scene.textures.remove(k);
    g.generateTexture(k, pad * 2, Math.ceil(b.y - y0) + 2);
    g.destroy();
    scene.add.image(x0, y0, k).setOrigin(0).setDepth(50);
  }

  // ── lighting rig and spotlights ──
  const rig = top;
  const trussZ = 12.5;
  const trussY = 5.6;
  const ta = P(-9, trussY, trussZ);
  const tb = P(9, trussY, trussZ);
  rig.fillStyle(C.truss).fillRect(Math.round(ta.x), Math.round(ta.y), Math.round(tb.x - ta.x), 4);
  rig.fillRect(Math.round(ta.x), Math.round(ta.y) + 12, Math.round(tb.x - ta.x), 4);
  for (let x = ta.x; x < tb.x; x += 12) rig.fillRect(Math.round(x), Math.round(ta.y) + 4, 2, 8);
  const lamps = [-6, -3.4, 3.4, 6].map((X) => P(X, trussY - 0.35, trussZ));
  for (const l of lamps) {
    rig.fillStyle(0x14101b).fillRect(Math.round(l.x) - 6, Math.round(l.y) + 2, 12, 10);
    rig.fillStyle(C.light).fillRect(Math.round(l.x) - 4, Math.round(l.y) + 11, 8, 2);
  }
  // spotlight cones, baked into one image that sways gently (live shapes cost a lot every frame)
  const beamsG = scene.add.graphics().setDepth(-70);
  lamps.forEach((l, i) => {
    const c = P(i < 2 ? -1.2 : 1.2, ringTop, ARENA.fighterZ);
    const spread = 1.5 * unitPx(ARENA.fighterZ);
    beamsG.fillStyle(C.light, 0.045);
    beamsG.fillTriangle(l.x - 3, l.y + 12, l.x + 3, l.y + 12, c.x + spread, c.y);
    beamsG.fillTriangle(l.x - 3, l.y + 12, c.x - spread, c.y, c.x + spread, c.y);
  });
  const beams = bake(scene, beamsG, '__arena_beams').setBlendMode(Phaser.BlendModes.ADD);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!reduced) {
    scene.tweens.add({
      targets: beams,
      x: { from: -6, to: 6 },
      duration: 3800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => (beams.x = Math.round(beams.x)),
    });
    // camera flashes in the crowd
    const flash = scene.add.rectangle(0, 0, 2, 2, 0xffffff).setOrigin(0).setDepth(-85).setVisible(false);
    scene.time.addEvent({
      delay: 140,
      loop: true,
      callback: () => {
        const h = heads[Math.floor(Math.random() * heads.length)];
        if (!h) return;
        const s = Math.max(2, Math.round(h.s * 0.12));
        flash.setPosition(Math.round(h.x), Math.round(h.y)).setSize(s, s).setVisible(true);
        scene.time.delayedCall(60, () => flash.setVisible(false));
      },
    });
  }

  // freeze every static drawing into an image (only the spotlights stay live)
  bake(scene, top, '__arena_ring');
  const crowd = [bake(scene, back, '__arena_crowd')];
  return {
    cheer(strength = 1) {
      if (reduced) return;
      for (const g of crowd) {
        scene.tweens.killTweensOf(g);
        g.y = 0;
        scene.tweens.add({
          targets: g,
          y: -Math.round(3 * strength),
          duration: 90,
          yoyo: true,
          repeat: strength > 1 ? 2 : 1,
          ease: 'Stepped',
          easeParams: [2],
        });
      }
    },
  };
}
