// The battle camera. Instead of tweening the camera directly (which fights
// itself when shots change quickly), every frame it eases toward the current
// shot: a fixed framing, or one that follows a set of fighters. Impacts add a
// short punch-in that settles back. The view always stays inside the arena.

import Phaser from 'phaser';

export interface Shot {
  x: number;
  y: number;
  zoom: number;
}

type Followed = { x: number; y: number; displayHeight: number };

export class CameraDirector {
  private cur: Shot;
  private want: Shot;
  private follow: { targets: Followed[]; zoom: number; lift: number } | null = null;
  private punch = 0;
  /** How quickly the camera catches up (higher = snappier). */
  private speed = 6;

  constructor(
    private cam: Phaser.Cameras.Scene2D.Camera,
    private bounds: { width: number; height: number },
    start: Shot,
  ) {
    cam.setBounds(0, 0, bounds.width, bounds.height);
    this.cur = { ...start };
    this.want = { ...start };
    this.apply();
  }

  /** Current framing (for tests and debugging). */
  get shot(): Shot {
    return { x: this.cur.x, y: this.cur.y, zoom: this.cur.zoom + this.punch };
  }

  /** Frames a fixed point. `speed` sets how fast the camera gets there. */
  to(shot: Shot, speed = 6): void {
    this.follow = null;
    this.want = { ...shot };
    this.speed = speed;
  }

  /** Cuts straight to a shot with no easing. */
  cut(shot: Shot): void {
    this.follow = null;
    this.cur = { ...shot };
    this.want = { ...shot };
    this.apply();
  }

  /** Keeps a group of fighters framed, centred between them, as they move. */
  track(targets: Followed[], zoom: number, lift = 0, speed = 7): void {
    this.follow = { targets, zoom, lift };
    this.speed = speed;
  }

  /** A quick zoom-in on impact that settles back on its own. */
  punchIn(amount = 0.12): void {
    this.punch = Math.max(this.punch, amount);
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    if (this.follow) {
      const t = this.follow.targets;
      const minX = Math.min(...t.map((s) => s.x));
      const maxX = Math.max(...t.map((s) => s.x));
      const midY = t.reduce((sum, s) => sum + s.y - s.displayHeight / 2, 0) / t.length;
      this.want = { x: (minX + maxX) / 2, y: midY - this.follow.lift, zoom: this.follow.zoom };
    }
    const k = 1 - Math.exp(-dt * this.speed);
    this.cur.x += (this.want.x - this.cur.x) * k;
    this.cur.y += (this.want.y - this.cur.y) * k;
    this.cur.zoom += (this.want.zoom - this.cur.zoom) * k;
    this.punch *= Math.exp(-dt * 9);
    if (this.punch < 0.002) this.punch = 0;
    this.apply();
  }

  private apply(): void {
    const zoom = Math.max(1, this.cur.zoom + this.punch);
    const viewW = this.cam.width / zoom;
    const viewH = this.cam.height / zoom;
    const x = Phaser.Math.Clamp(this.cur.x, viewW / 2, this.bounds.width - viewW / 2);
    const y = Phaser.Math.Clamp(this.cur.y, viewH / 2, this.bounds.height - viewH / 2);
    this.cam.setZoom(zoom);
    this.cam.centerOn(x, y);
  }
}
