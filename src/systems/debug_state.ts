// Debug switches (dev builds). Changing one announces it on the EventBus.
import { bus } from '../managers/event_bus';

export const debugState = {
  god: false,
  hitboxes: false,
  fps: false,
  /** Action commands always succeed with GREAT (also the future accessibility option). */
  autoCommands: false,
};

export type DebugKey = keyof typeof debugState;

export function setDebug(key: DebugKey, value: boolean): void {
  debugState[key] = value;
  bus.emit('debug.changed', { key, value });
}
