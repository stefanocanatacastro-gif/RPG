// Typing text in dev tools: a real HTML text box laid over the game canvas at
// a spot given in game pixels. Enter saves (Ctrl+Enter in a multi-line box),
// Escape cancels. Resolves with the new text, or null when cancelled.

import Phaser from 'phaser';
import { GAME_WIDTH as W } from '../systems/integer_scale';

export interface TextFieldOptions {
  x: number;
  y: number;
  w: number;
  h?: number;
  value: string;
  multiline?: boolean;
  placeholder?: string;
}

/** True while a text box is open, so tools can ignore their own shortcuts. */
export let textFieldOpen = false;

export function editText(scene: Phaser.Scene, o: TextFieldOptions): Promise<string | null> {
  const rect = scene.game.canvas.getBoundingClientRect();
  const k = rect.width / W;
  const el = document.createElement(o.multiline ? 'textarea' : 'input');
  el.value = o.value;
  if (o.placeholder) el.placeholder = o.placeholder;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${rect.left + o.x * k}px`,
    top: `${rect.top + o.y * k}px`,
    width: `${o.w * k}px`,
    height: `${(o.h ?? 14) * k}px`,
    zIndex: '1000',
    font: `${Math.max(12, Math.round(8 * k))}px "Press Start 2P", monospace`,
    lineHeight: '1.6',
    background: '#1b1622',
    color: '#f4ead2',
    border: '2px solid #ffb238',
    padding: '4px',
    boxSizing: 'border-box',
    resize: 'none',
    outline: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  el.focus();
  el.select();
  textFieldOpen = true;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (v: string | null) => {
      if (finished) return;
      finished = true;
      textFieldOpen = false;
      el.remove();
      resolve(v);
    };
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') finish(null);
      else if (ke.key === 'Enter' && (!o.multiline || ke.ctrlKey || ke.metaKey)) {
        ke.preventDefault();
        finish(el.value);
      }
    });
    el.addEventListener('blur', () => finish(el.value));
  });
}
