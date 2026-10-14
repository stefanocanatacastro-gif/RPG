// The name you're credited as on battles you share (kept in this browser).

const KEY = 'kid-chispa.maker_name';

export function makerName(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setMakerName(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim().slice(0, 24));
  } catch {
    /* kept for this visit only */
  }
}
