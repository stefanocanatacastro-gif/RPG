import { describe, expect, it } from 'vitest';
import { Database } from '../src/managers/database';
import { GameState, freshSave, migrateSave, SAVE_VERSION } from '../src/managers/game_state';
import { EventBus } from '../src/managers/event_bus';
import { SaveManager, loadSaveSlots, playTime } from '../src/managers/save_manager';

const hero = Database.character('chispa');

describe('save format versions', () => {
  it('passes a current save through unchanged', () => {
    const s = freshSave(hero);
    expect(migrateSave(s as unknown as Record<string, unknown>)).toEqual(s);
  });

  it('upgrades an old save one step at a time', () => {
    const v1 = { version: 1, coins: 5 };
    const steps = {
      1: (s: Record<string, unknown>) => ({ ...s, fanTokens: 0 }),
      2: (s: Record<string, unknown>) => ({ ...s, coins: (s.coins as number) * 10 }),
    };
    expect(migrateSave(v1, steps, 3)).toEqual({ version: 3, coins: 50, fanTokens: 0 });
  });

  it('refuses a save from a newer build, or one it has no upgrade for', () => {
    expect(() => migrateSave({ version: SAVE_VERSION + 1 })).toThrow(/newer version/);
    expect(() => migrateSave({ version: 1 }, {}, 2)).toThrow(/No way to upgrade/);
  });

  it('keeps positions in world units', () => {
    const gs = new GameState(freshSave(hero), new EventBus());
    gs.setLocation('test_b', 12.345, 6.7, 'left');
    expect(gs.data.pos).toEqual({ x: 12.35, y: 6.7 });
  });
});

describe('save slots', () => {
  it('saves, lists and loads slots, newest first for Continue', async () => {
    await loadSaveSlots();
    expect(SaveManager.hasAny()).toBe(false);
    const gs = new GameState(freshSave(hero), new EventBus());
    gs.addCoins(42);
    await SaveManager.save('1', gs.snapshot(), 'Room One');
    await new Promise((r) => setTimeout(r, 5));
    gs.addCoins(1);
    await SaveManager.save('auto', gs.snapshot(), 'Room Two');
    expect(SaveManager.meta('1')).toMatchObject({ roomName: 'Room One', coins: 42, level: 1 });
    expect(SaveManager.latest()).toBe('auto');
    expect(SaveManager.load('1')?.coins).toBe(42);
    expect(SaveManager.load('2')).toBeNull();
    await SaveManager.remove('auto');
    expect(SaveManager.latest()).toBe('1');
  });

  it('shows play time as hours and minutes', () => {
    expect(playTime(65 * 60000 + 5000)).toBe('1:05');
  });
});
