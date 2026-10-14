// The browser's file picker, for uploads in the makers.

/** Asks the browser for a picture file (must be called from a click). */
export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/png,image/jpeg,image/gif,image/webp';
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('change', () => {
      resolve(el.files?.[0] ?? null);
      el.remove();
    });
    // closing the dialog without a choice: the page gets focus back
    window.addEventListener(
      'focus',
      () =>
        setTimeout(() => {
          if (!el.files?.length) {
            resolve(null);
            el.remove();
          }
        }, 600),
      { once: true },
    );
    el.click();
  });
}
