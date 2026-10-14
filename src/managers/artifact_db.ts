// The game link's own database (the published artifact's `db` capability) and
// the viewer's id, when the game runs inside the claude.ai viewer. Anywhere
// else (dev server, browser tests, a saved copy) both are null and callers fall
// back to browser storage.

export interface DocSnap {
  exists: boolean;
  id: string;
  data(): Record<string, unknown> | undefined;
}
export interface DbLike {
  collection(path: string): { get(): Promise<{ docs: DocSnap[] }> };
  doc(path: string): {
    get(): Promise<DocSnap>;
    set(d: Record<string, unknown>): Promise<void>;
    delete(): Promise<void>;
  };
}
interface UserLike {
  id(): Promise<string | null>;
  profiles?(ids: string[]): Promise<Record<string, { name?: string } | undefined>>;
}

type Use = (name: string) => Promise<unknown>;
let dbPromise: Promise<DbLike | null> | null = null;
let userPromise: Promise<string | null> | null = null;
let userNs: Promise<UserLike | null> | null = null;

function use(name: string, timeoutMs: number): Promise<unknown> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const claude = (window as unknown as { claude?: { use?: Use } }).claude;
  if (!claude?.use) return Promise.resolve(null);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  return Promise.race([claude.use(name).catch(() => null), timeout]);
}

/** The link's database, or null when not running in the viewer. */
export function artifactDb(timeoutMs = 4000): Promise<DbLike | null> {
  dbPromise ??= use('db', timeoutMs) as Promise<DbLike | null>;
  return dbPromise;
}

/** The viewer's id (for their private saves), or null. */
export function viewerId(timeoutMs = 4000): Promise<string | null> {
  userNs ??= use('user', timeoutMs) as Promise<UserLike | null>;
  userPromise ??= userNs.then((u) => (u ? u.id().catch(() => null) : null));
  return userPromise;
}

/**
 * Display names for viewer ids (makers in the gallery). Names are looked up each
 * time, never stored: an id without a name comes back as ''.
 */
export async function profileNames(ids: string[], timeoutMs = 4000): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  userNs ??= use('user', timeoutMs) as Promise<UserLike | null>;
  const u = await userNs;
  if (!u?.profiles || !ids.length) return out;
  try {
    const ps = await u.profiles(ids);
    for (const id of ids) out[id] = ps?.[id]?.name || '';
  } catch {
    /* names are a nicety */
  }
  return out;
}

interface AssetsLike {
  upload(blob: Blob, options?: { type?: string }): Promise<{ id: string; url: string; sizeBytes: number }>;
}
let assetsNs: Promise<AssetsLike | null> | null = null;

/**
 * Stores an image with the game link (the artifact's asset store) and returns
 * the path it is served at ("/_blob/<id>"), or null when there's no asset
 * store here (outside the viewer, or for people who can't edit the link):
 * then callers keep the image inline.
 */
export async function storeImage(blob: Blob, timeoutMs = 4000): Promise<string | null> {
  assetsNs ??= use('assets', timeoutMs) as Promise<AssetsLike | null>;
  const assets = await assetsNs;
  if (!assets) return null;
  try {
    const r = await assets.upload(blob, { type: 'image/png' });
    return `/_blob/${r.id}`;
  } catch {
    return null;
  }
}

interface DownloadsLike {
  save(r: { filename: string; data: string | Blob }): Promise<unknown>;
}

/**
 * Offers the viewer a file. Inside the game link the viewer confirms it (they
 * may say no: resolves false); anywhere else the browser downloads it.
 */
export async function saveFile(filename: string, text: string, timeoutMs = 4000): Promise<boolean> {
  const dl = (await use('downloads', timeoutMs)) as DownloadsLike | null;
  if (dl) {
    try {
      await dl.save({ filename, data: text });
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
