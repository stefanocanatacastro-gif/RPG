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
