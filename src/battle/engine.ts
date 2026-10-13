// Battle engine: the rules of a fight, with no drawing. The battle scene asks
// it what the player may do, tells it what was chosen, and plays animations
// while the engine applies each hit. Because it's pure logic, whole fights can
// be simulated in unit tests.

import type { CharacterDef, EnemyDef, FormationDef, FormationSlot, ItemDef, MoveDef } from '../types/data';
import { Rng } from '../systems/rng';
import rules from '../data/battle_rules.json';

export type Side = 'hero' | 'enemy';

export interface Fighter {
  id: string;
  side: Side;
  /** Character or enemy id in the Database. */
  defId: string;
  name: string;
  sprite: string;
  hp: number;
  maxHp: number;
  attack: number;
  defence: number;
  moves: string[];
  slot: FormationSlot;
  /** Order within its side, front (0) to back. */
  order: number;
  airborne: boolean;
  spiky: boolean;
  /** Damage taken is reduced by this until the fighter's next turn. */
  guard: number;
  /** A charged move being wound up, and how many more turns until it's released. */
  charging?: { move: string; turnsLeft: number };
  xp: number;
  coins: number;
}

export type Phase = 'intro' | 'command' | 'acting' | 'enemy' | 'victory' | 'defeat' | 'fled';

export interface Lookup {
  move(id: string): MoveDef;
  enemy(id: string): EnemyDef;
  item(id: string): ItemDef;
}

export interface TargetCheck {
  ok: boolean;
  reason?: string;
}

/** How the defender answered an attack: no guard, a Block (less damage) or a Reversal (no damage, hits back). */
export type GuardResult = 'none' | 'block' | 'reversal';

export interface HitResult {
  target: string;
  damage: number;
  ko: boolean;
  guarded: boolean;
  /** Set when the hit was blocked or reversed. */
  guard?: GuardResult;
  /** Damage the attacker took from a Reversal. */
  counter?: number;
  /** The attacker was knocked out by the Reversal. */
  attackerKo?: boolean;
}

/**
 * What an enemy does on its turn:
 *   attack  — a normal move at the target
 *   charge  — starts winding up a charged move (no hit this turn)
 *   release — unleashes the move it was charging
 *   support — a helping move on an ally (heals)
 */
export interface EnemyPlan {
  actor: string;
  move: string;
  target: string;
  kind: 'attack' | 'charge' | 'release' | 'support';
}

export interface Rewards {
  xp: number;
  coins: number;
}

/** Damage = move power + attacker's attack − defender's defence (unless piercing), × multiplier, minus guard. */
export function computeDamage(
  power: number,
  attack: number,
  defence: number,
  opts: { mult?: number; piercing?: boolean; guard?: number } = {},
): number {
  const base = power + attack - (opts.piercing ? 0 : defence);
  const raw = Math.max(0, Math.floor(base * (opts.mult ?? 1)));
  return Math.max(0, raw - (opts.guard ?? 0));
}

export class BattleEngine {
  readonly fighters: Fighter[] = [];
  phase: Phase = 'intro';
  round = 0;
  /** Which party member is choosing (during the command phase). */
  turn: 'hero' | 'partner' = 'hero';
  readonly rng: Rng;
  /** Enemy turns still to run this round. */
  private enemyQueue: string[] = [];
  /** Log of what happened, for tests and crash reports. */
  readonly log: string[] = [];

  constructor(
    private db: Lookup,
    hero: CharacterDef,
    heroState: { hp: number; maxHp: number },
    formation: FormationDef,
    seed?: number,
    /** The partner out with Chispa (Pip and the others), if any. */
    partner?: { def: CharacterDef; hp: number; maxHp: number },
  ) {
    this.rng = new Rng(seed);
    const member = (
      id: string,
      def: CharacterDef,
      st: { hp: number; maxHp: number },
      order: number,
    ): Fighter => ({
      id,
      side: 'hero',
      defId: def.id,
      name: def.name,
      sprite: def.sprite,
      hp: st.hp,
      maxHp: st.maxHp,
      attack: def.attack,
      defence: def.defence,
      moves: def.moves,
      slot: 'front',
      order,
      airborne: false,
      spiky: false,
      guard: 0,
      xp: 0,
      coins: 0,
    });
    this.fighters.push(member('hero', hero, heroState, 0));
    if (partner) this.fighters.push(member('partner', partner.def, partner, 1));
    // enemies are ordered front to back: front slots, then back, with flyers by their x
    const slotRank: Record<FormationSlot, number> = { front: 0, air: 1, back: 2 };
    formation.enemies
      .map((e, i) => ({ ...e, i }))
      .sort((a, b) => slotRank[a.slot] - slotRank[b.slot] || a.i - b.i)
      .forEach((e, order) => {
        const def = db.enemy(e.enemy);
        this.fighters.push({
          id: `e${order}`,
          side: 'enemy',
          defId: def.id,
          name: def.name,
          sprite: def.sprite,
          hp: def.hp,
          maxHp: def.hp,
          attack: def.attack,
          defence: def.defence,
          moves: def.moves,
          slot: e.slot,
          order,
          airborne: def.props.includes('airborne') || e.slot === 'air',
          spiky: def.props.includes('spiky'),
          guard: 0,
          xp: def.xp,
          coins: def.coins,
        });
      });
  }

  get hero(): Fighter {
    return this.fighters[0];
  }

  /** The partner fighting alongside Chispa, or undefined when he's alone. */
  get partner(): Fighter | undefined {
    return this.fighters.find((f) => f.id === 'partner');
  }

  /** Chispa and his partner, standing ones only by default. */
  party(aliveOnly = true): Fighter[] {
    return this.fighters.filter((f) => f.side === 'hero' && (!aliveOnly || f.hp > 0));
  }

  /** Whose command it is: Chispa first, then the partner, each round. */
  get acting(): Fighter {
    return this.get(this.turn);
  }

  get(id: string): Fighter {
    const f = this.fighters.find((x) => x.id === id);
    if (!f) throw new Error(`No fighter "${id}" in this battle`);
    return f;
  }

  enemies(aliveOnly = true): Fighter[] {
    return this.fighters.filter((f) => f.side === 'enemy' && (!aliveOnly || f.hp > 0));
  }

  /** Starts the fight. With enemy First Strike, the enemies act before the first command. */
  begin(firstStrike: 'player' | 'enemy' | null): void {
    this.round = 1;
    this.log.push(`begin ${firstStrike ?? 'normal'}`);
    this.turn = 'hero';
    if (firstStrike === 'enemy') this.startEnemyTurns();
    else this.phase = 'command';
  }

  // ── Player choices ──────────────────────────────────────────────────

  /** Can the hero use this move right now (enough Grit, any valid target)? */
  canUseMove(moveId: string, grit: number): TargetCheck {
    const m = this.db.move(moveId);
    if (m.gritCost > grit) return { ok: false, reason: 'notEnoughGrit' };
    if (!this.enemies().some((e) => this.canTarget(moveId, e.id).ok))
      return { ok: false, reason: 'noTarget' };
    return { ok: true };
  }

  /** Whether a move can be aimed at a particular fighter, and why not if it can't. */
  canTarget(moveId: string, targetId: string): TargetCheck {
    const m = this.db.move(moveId);
    const t = this.get(targetId);
    if (t.hp <= 0) return { ok: false, reason: 'down' };
    if (m.target === 'self') return t.id === this.turn ? { ok: true } : { ok: false, reason: 'selfOnly' };
    if (t.side === 'hero') return { ok: false, reason: 'ally' };
    if (t.airborne && !m.reaches.airborne) return { ok: false, reason: 'airborne' };
    if (t.spiky && !m.reaches.spiky) return { ok: false, reason: 'spiky' };
    if (m.target === 'front') {
      const front = this.frontGround();
      if (front && front.id !== t.id) return { ok: false, reason: 'notFront' };
    }
    return { ok: true };
  }

  /** The nearest standing (not flying) enemy, which "front" moves must target. */
  frontGround(): Fighter | undefined {
    return this.enemies().filter((e) => !e.airborne)[0];
  }

  /** Valid targets for a move, front to back. */
  targetsFor(moveId: string): Fighter[] {
    return this.enemies().filter((e) => this.canTarget(moveId, e.id).ok);
  }

  /** Called when Chispa or the partner commits to an action (Grit is spent by the caller's GameState). */
  beginHeroAction(): void {
    // a Defend lasts until that fighter's next turn
    this.acting.guard = 0;
    this.phase = 'acting';
  }

  /** Applies one hit of a move. Moves with several "hit" steps call this once per step. */
  hit(
    attackerId: string,
    targetId: string,
    moveId: string,
    mult = 1,
    guard: GuardResult = 'none',
  ): HitResult {
    const a = this.get(attackerId);
    const t = this.get(targetId);
    const m = this.db.move(moveId);
    if (guard === 'reversal') {
      // no damage taken, and the attacker gets hit back
      const counter = rules.reversalDamage;
      a.hp = Math.max(0, a.hp - counter);
      this.log.push(`guard ${t.id} reversal`);
      this.log.push(`${t.id} reversal ${a.id} -${counter}${a.hp === 0 ? ' KO' : ''}`);
      return { target: t.id, damage: 0, ko: false, guarded: true, guard, counter, attackerKo: a.hp === 0 };
    }
    const block = guard === 'block' ? rules.blockReduce : 0;
    const damage = computeDamage(m.power, a.attack, t.defence, {
      mult,
      piercing: m.piercing,
      guard: t.guard + block,
    });
    t.hp = Math.max(0, t.hp - damage);
    if (guard === 'block') this.log.push(`guard ${t.id} block`);
    this.log.push(`${a.id} ${m.id} ${t.id} -${damage}${t.hp === 0 ? ' KO' : ''}`);
    return { target: t.id, damage, ko: t.hp === 0, guarded: t.guard + block > 0, guard };
  }

  /** Direct damage that isn't a move (items, First Strike bonus). */
  damage(targetId: string, amount: number): HitResult {
    const t = this.get(targetId);
    const damage = Math.max(0, amount - t.guard);
    t.hp = Math.max(0, t.hp - damage);
    this.log.push(`dmg ${t.id} -${damage}`);
    return { target: t.id, damage, ko: t.hp === 0, guarded: t.guard > 0 };
  }

  /** Heals Chispa (or the partner, if given). A knocked-down partner can't be healed this way. */
  healHero(amount: number, id: 'hero' | 'partner' = 'hero'): number {
    const f = this.get(id);
    if (f.hp <= 0 && id === 'partner') return 0;
    const before = f.hp;
    f.hp = Math.min(f.maxHp, f.hp + amount);
    return f.hp - before;
  }

  defend(): void {
    this.acting.guard = rules.defendGuard;
    this.phase = 'acting';
    this.log.push(`${this.turn} defends`);
  }

  /** Running away: a roll against the run chance. Fleeing ends the fight. */
  tryRun(): boolean {
    this.phase = 'acting';
    const ok = this.rng.chance(rules.runChance);
    this.log.push(ok ? 'hero ran' : 'run failed');
    if (ok) this.phase = 'fled';
    return ok;
  }

  /** After a party member's action: victory, the partner's turn, or the enemies'. */
  endHeroAction(): void {
    if (this.phase === 'fled') return;
    if (this.enemies().length === 0) {
      this.phase = 'victory';
      return;
    }
    if (this.turn === 'hero' && (this.partner?.hp ?? 0) > 0) {
      this.turn = 'partner';
      this.phase = 'command';
      return;
    }
    this.startEnemyTurns();
  }

  /** Who an enemy attack goes for: Chispa, or now and then the partner while he's standing. */
  private pickVictim(): string {
    const p = this.partner;
    if (p && p.hp > 0 && this.rng.chance(rules.partnerTargetChance)) return 'partner';
    return 'hero';
  }

  // ── Enemy turns ─────────────────────────────────────────────────────

  private startEnemyTurns(): void {
    this.phase = 'enemy';
    this.enemyQueue = this.enemies().map((e) => e.id);
  }

  /** The next enemy's planned action, or null when every enemy has acted this round. */
  nextEnemyPlan(): EnemyPlan | null {
    while (this.enemyQueue.length) {
      const id = this.enemyQueue.shift()!;
      const e = this.get(id);
      if (e.hp <= 0) continue;
      e.guard = 0;
      // already winding up: keep charging, or let it go
      if (e.charging) {
        if (e.charging.turnsLeft > 1) {
          e.charging.turnsLeft--;
          this.log.push(`charge ${id} ${e.charging.move} hold`);
          return { actor: id, move: e.charging.move, target: 'hero', kind: 'charge' };
        }
        const move = e.charging.move;
        e.charging = undefined;
        this.log.push(`release ${id} ${move}`);
        return { actor: id, move, target: this.pickVictim(), kind: 'release' };
      }
      const move = this.chooseEnemyMove(e);
      const m = this.db.move(move);
      if (m.heal) {
        const ally = this.lowestAlly(e);
        if (ally) {
          this.log.push(`support ${id} ${move} ${ally.id}`);
          return { actor: id, move, target: ally.id, kind: 'support' };
        }
      }
      if (m.charge && m.charge > 0) {
        e.charging = { move, turnsLeft: m.charge };
        this.log.push(`charge ${id} ${move}`);
        return { actor: id, move, target: 'hero', kind: 'charge' };
      }
      return { actor: id, move, target: this.pickVictim(), kind: 'attack' };
    }
    return null;
  }

  /** The most hurt standing enemy other than `self` (by HP fraction), if any is hurt at all. */
  lowestAlly(self: Fighter): Fighter | undefined {
    const hurt = this.enemies()
      .filter((f) => f.id !== self.id && f.hp < f.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    return hurt[0];
  }

  /** Whether an AI rule's conditions hold for this enemy right now. */
  ruleApplies(
    e: Fighter,
    r: {
      whenHpBelow?: number;
      whenAllyHpBelow?: number;
      everyRounds?: number;
      fromRound?: number;
      move: string;
    },
  ): boolean {
    if (r.whenHpBelow !== undefined && e.hp / e.maxHp > r.whenHpBelow) return false;
    if (r.whenAllyHpBelow !== undefined) {
      const ally = this.lowestAlly(e);
      if (!ally || ally.hp / ally.maxHp > r.whenAllyHpBelow) return false;
    }
    if (r.fromRound !== undefined || r.everyRounds !== undefined) {
      const from = r.fromRound ?? 1;
      if (this.round < from) return false;
      if (r.everyRounds !== undefined && (this.round - from) % r.everyRounds !== 0) return false;
    }
    // a support move needs someone to help
    if (this.db.move(r.move).heal && !this.lowestAlly(e)) return false;
    return true;
  }

  /** Among the rules that apply, the highest priority wins; weights pick between equals. */
  chooseEnemyMove(e: Fighter): string {
    const def = this.db.enemy(e.defId);
    const ok = def.ai.filter((r) => this.ruleApplies(e, r));
    if (ok.length === 0) {
      // fall back to the first plain attack
      const plain = def.ai.find((r) => !this.db.move(r.move).heal && !this.db.move(r.move).charge);
      return (plain ?? def.ai[0]).move;
    }
    const top = Math.max(...ok.map((r) => r.priority ?? 0));
    return this.rng.weighted(
      ok.filter((r) => (r.priority ?? 0) === top).map((r) => ({ value: r.move, weight: r.weight })),
    );
  }

  /** A charging enemy hit hard enough loses its wind-up. Returns whether a charge was broken. */
  breakCharge(id: string): boolean {
    const f = this.get(id);
    if (!f.charging || f.hp <= 0) return false;
    f.charging = undefined;
    this.log.push(`break ${id}`);
    return true;
  }

  /** Heals an enemy (support moves). Returns the HP actually restored. */
  healFighter(id: string, amount: number): number {
    const f = this.get(id);
    const before = f.hp;
    f.hp = Math.min(f.maxHp, f.hp + amount);
    this.log.push(`heal ${id} +${f.hp - before}`);
    return f.hp - before;
  }

  /** After an enemy finishes acting: defeat, or keep going, or a new round. */
  endEnemyAction(): void {
    if (this.hero.hp <= 0) {
      this.phase = 'defeat';
      return;
    }
    if (this.enemies().length === 0) {
      // the last enemy fell to a Reversal
      this.phase = 'victory';
      return;
    }
    if (this.enemyQueue.length === 0) {
      this.round++;
      this.turn = 'hero';
      this.phase = 'command';
    }
  }

  rewards(): Rewards {
    const all = this.enemies(false);
    return { xp: all.reduce((s, e) => s + e.xp, 0), coins: all.reduce((s, e) => s + e.coins, 0) };
  }
}
