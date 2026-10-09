// Game-wide events. Systems announce what happened ("damage dealt", "item used")
// and anyone interested listens, so the crowd, HUD, sound and Journal never need
// to know about each other directly.

export interface GameEvents {
  'damage.dealt': { source: string; target: string; amount: number; rating?: string };
  'hp.changed': { who: string; hp: number; maxHp: number };
  'grit.changed': { grit: number; maxGrit: number };
  'item.added': { id: string; count: number };
  'item.used': { id: string; by: string; target?: string };
  'item.full': { id: string };
  'coins.changed': { coins: number; delta: number };
  'flag.set': { key: string; value: FlagValue };
  'crowd.changed': { size: number; mood: number };
  'room.entered': { room: string; spawn: string };
  'battle.started': { formation: string; firstStrike: 'player' | 'enemy' | null };
  'battle.ended': { formation: string; result: BattleResult };
  'input.device': { device: InputDevice };
  'debug.changed': { key: string; value: boolean };
}

export type FlagValue = boolean | number | string;
export type BattleResult = 'win' | 'lose' | 'run';
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(event, fn);
  }

  once<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(event: K, fn: Handler<E[K]>): void {
    this.handlers.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // copy so handlers can unsubscribe while being called
    for (const fn of [...set]) (fn as Handler<E[K]>)(payload);
  }

  count<K extends keyof E>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** The single bus the game uses. Scenes should unsubscribe on shutdown. */
export const bus = new EventBus<GameEvents>();
