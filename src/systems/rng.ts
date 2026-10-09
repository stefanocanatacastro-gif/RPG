// Seeded random numbers. Every random roll in battles comes from here, so a
// battle can be replayed exactly by reusing its seed when reproducing a bug.

export class Rng {
  private state: number;
  readonly seed: number;

  constructor(seed = Rng.freshSeed()) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  static freshSeed(): number {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  /** 0 ≤ n < 1 (mulberry32). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Whole number from min to max, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    if (list.length === 0) throw new Error('Rng.pick on an empty list');
    return list[Math.floor(this.next() * list.length)];
  }

  /** Picks by weight: weighted([{value:'a',weight:2},{value:'b',weight:1}]). */
  weighted<T>(options: readonly { value: T; weight: number }[]): T {
    const total = options.reduce((s, o) => s + Math.max(0, o.weight), 0);
    if (total <= 0) throw new Error('Rng.weighted needs at least one positive weight');
    let roll = this.next() * total;
    for (const o of options) {
      roll -= Math.max(0, o.weight);
      if (roll < 0) return o.value;
    }
    return options[options.length - 1].value;
  }

  /** Current position, so a save or bug report can resume the exact sequence. */
  getState(): number {
    return this.state;
  }

  setState(s: number): void {
    this.state = s >>> 0;
  }
}

/** Shared generator; battles create their own with a logged seed. */
export const rng = new Rng();
