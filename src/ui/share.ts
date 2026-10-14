// Sharing battles as files, for the Battle World and the Battle Maker: export
// (asks your maker name the first time), import from the file picker, and
// battle files dropped on the game or pasted into it.

import type Phaser from 'phaser';
import { GAME_WIDTH as W } from '../systems/integer_scale';
import { editText, textFieldOpen } from './text_field';
import { pickFile } from './pick_file';
import { saveFile } from '../managers/artifact_db';
import { makerName, setMakerName } from '../managers/maker_name';
import {
  FILE_FORMAT,
  describeFile,
  fileNameFor,
  importBattle,
  packBattle,
  readBattleFile,
} from '../managers/battle_file';
import type { BattleSetup } from '../managers/battle_setup';

export interface ShareResult {
  ok: boolean;
  message: string;
  /** Imports: the battle's id in YOURS. */
  id?: string;
}

/** Packs a battle into a file and offers it to save. */
export async function exportBattle(
  scene: Phaser.Scene,
  battle: { title: string; desc?: string; setup: BattleSetup },
  cleared: boolean,
  credit?: string,
): Promise<ShareResult> {
  let maker = credit ?? makerName();
  if (!maker) {
    const v = await editText(scene, {
      x: W / 2 - 200,
      y: 60,
      w: 400,
      value: '',
      placeholder: 'Your maker name (shown on battles you share)',
    });
    if (v === null || !v.trim())
      return { ok: false, message: 'Not shared: a battle file needs a maker name.' };
    setMakerName(v);
    maker = makerName();
  }
  try {
    const file = await packBattle(battle, maker, cleared);
    const text = JSON.stringify(file);
    const saved = await saveFile(fileNameFor(battle.title), text);
    if (!saved) return { ok: false, message: 'Not saved.' };
    const kb = Math.max(1, Math.round(text.length / 1024));
    // small battles also go to the clipboard: paste them into a chat, and the friend pastes them into the game
    let copied = false;
    if (text.length < 200_000)
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        /* no clipboard here: the file is enough */
      }
    return {
      ok: true,
      message: `Saved ${fileNameFor(battle.title)} (${kb} KB)${copied ? ' and copied it' : ''}: send it to anyone, they IMPORT it${copied ? ' or paste it into the game' : ''}.`,
    };
  } catch (e) {
    return { ok: false, message: `Couldn't share it: ${String((e as { message?: string }).message ?? e)}` };
  }
}

/** Reads a battle file (picked, dropped or pasted) and adds it to YOURS. */
export async function importBattleText(text: string): Promise<ShareResult> {
  try {
    const f = readBattleFile(text);
    const r = await importBattle(f);
    return {
      ok: true,
      id: r.id,
      message: r.again ? `You already have ${describeFile(f)}.` : `Imported ${describeFile(f)}.`,
    };
  } catch (e) {
    return { ok: false, message: String((e as { message?: string }).message ?? e) };
  }
}

/** Opens the file picker for a battle file. */
export async function importFromPicker(): Promise<ShareResult | null> {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  return importBattleText(await file.text());
}

/**
 * Battle files dropped on the page, or pasted as text, while the scene is up.
 * `onResult` hears how each import went.
 */
export function listenForBattleFiles(scene: Phaser.Scene, onResult: (r: ShareResult) => void): void {
  const onDrag = (e: DragEvent) => e.preventDefault();
  const onDrop = (e: DragEvent) => {
    if (!scene.scene.isActive()) return;
    const file = [...(e.dataTransfer?.files ?? [])].find(
      (f) => f.name.endsWith('.json') || f.type === 'application/json',
    );
    if (!file) return;
    e.preventDefault();
    void file.text().then(importBattleText).then(onResult);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (textFieldOpen || !scene.scene.isActive()) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes(FILE_FORMAT)) return;
    e.preventDefault();
    void importBattleText(text).then(onResult);
  };
  window.addEventListener('dragover', onDrag);
  window.addEventListener('drop', onDrop);
  window.addEventListener('paste', onPaste);
  scene.events.once('shutdown', () => {
    window.removeEventListener('dragover', onDrag);
    window.removeEventListener('drop', onDrop);
    window.removeEventListener('paste', onPaste);
  });
}
