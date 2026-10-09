// Crash screen: catches any uncaught error or rejected promise, stops the game,
// and shows the error with a "Copy report" button the player can paste to Claude.

import { versionLabel } from './version';

type ContextProvider = () => Record<string, unknown>;

let installed = false;
let shown = false;
const contextProviders: ContextProvider[] = [];

/** Systems register extra context (current scene, room, battle seed…) for crash reports. */
export function addCrashContext(provider: ContextProvider): void {
  contextProviders.push(provider);
}

export function installErrorOverlay(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => showCrash(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => showCrash(e.reason, 'unhandled promise'));
}

export function buildReport(err: unknown, kind: string): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const ctx: Record<string, unknown> = {};
  for (const p of contextProviders) {
    try {
      Object.assign(ctx, p());
    } catch {
      /* a broken provider must not hide the real error */
    }
  }
  return [
    `KID CHISPA CRASH REPORT`,
    `Build: ${versionLabel()}`,
    `When: ${new Date().toISOString()}`,
    `Kind: ${kind}`,
    `Error: ${e.message.startsWith(e.name) ? e.message : `${e.name}: ${e.message}`}`,
    `Screen: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    `Device: ${navigator.userAgent}`,
    `Context: ${JSON.stringify(ctx)}`,
    ``,
    `Stack:`,
    e.stack ?? '(no stack)',
  ].join('\n');
}

export function showCrash(err: unknown, kind = 'error'): void {
  if (shown) return;
  shown = true;
  const report = buildReport(err, kind);
  console.error(report);

  // Stop the game loop so the error isn't buried under repeated failures.
  try {
    (window as unknown as { __game?: { loop?: { sleep(): void } } }).__game?.loop?.sleep();
  } catch {
    /* ignore */
  }

  const style = document.createElement('style');
  style.textContent = `
    #crash{position:fixed;inset:0;z-index:100;background:#0b0910;color:#f4ead2;display:flex;
      flex-direction:column;gap:14px;padding:max(16px,env(safe-area-inset-top)) 16px 16px;
      font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;overflow:auto}
    #crash h1{font:14px/1.6 'Press Start 2P','Courier New',monospace;color:#d8314b;margin:0}
    #crash p{margin:0;max-width:60ch}
    #crash pre{margin:0;padding:12px;background:#1b1622;border:2px solid #3a3045;white-space:pre-wrap;
      word-break:break-word;max-height:50vh;overflow:auto;user-select:text;-webkit-user-select:text}
    #crash .row{display:flex;gap:10px;flex-wrap:wrap}
    #crash button{font:10px/1 'Press Start 2P','Courier New',monospace;padding:12px 14px;border:0;
      background:#ffb238;color:#0b0910;cursor:pointer}
    #crash button.alt{background:#3a3045;color:#f4ead2}
    #crash button:focus-visible{outline:3px solid #f4ead2;outline-offset:2px}`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'crash';
  box.setAttribute('role', 'alertdialog');
  box.innerHTML = `
    <h1>THE MATCH WAS STOPPED</h1>
    <p>The game hit an error. Copy the report below and paste it to Claude so it can be fixed.</p>
    <pre id="crash-report"></pre>
    <div class="row">
      <button id="crash-copy" type="button">Copy report</button>
      <button id="crash-reload" class="alt" type="button">Reload</button>
    </div>
    <p id="crash-status" aria-live="polite"></p>`;
  document.body.appendChild(box);
  const pre = box.querySelector('#crash-report') as HTMLPreElement;
  pre.textContent = report;
  const status = box.querySelector('#crash-status') as HTMLParagraphElement;

  (box.querySelector('#crash-copy') as HTMLButtonElement).addEventListener('click', () => {
    const selectFallback = () => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      status.textContent = 'Report selected. Use your device’s Copy to copy it.';
    };
    try {
      navigator.clipboard
        .writeText(report)
        .then(() => (status.textContent = 'Copied. Paste it into the chat with Claude.'), selectFallback);
    } catch {
      selectFallback();
    }
  });
  (box.querySelector('#crash-reload') as HTMLButtonElement).addEventListener('click', () =>
    location.reload(),
  );
  (box.querySelector('#crash-copy') as HTMLButtonElement).focus();
}
