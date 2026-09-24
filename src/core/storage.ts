/**
 * localStorage wrapper that never throws. Private browsing modes and blocked storage fall back to
 * an in-memory map so the game keeps working for the session.
 */
const memory = new Map<string, string>();
let backend: Storage | null = null;
try {
  const probe = '__splash_probe__';
  window.localStorage.setItem(probe, '1');
  window.localStorage.removeItem(probe);
  backend = window.localStorage;
} catch {
  backend = null;
}

export const storageAvailable = (): boolean => backend !== null;

export function readRaw(key: string): string | null {
  try {
    return backend ? backend.getItem(key) : (memory.get(key) ?? null);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  try {
    backend?.setItem(key, value);
  } catch {
    // Quota or access error: the in-memory copy keeps this session consistent.
  }
}

export function readJson(key: string): unknown {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined; // corrupt
  }
}

export function writeJson(key: string, value: unknown): void {
  writeRaw(key, JSON.stringify(value));
}

/** Deep-merges `source` onto `defaults`, keeping only keys and primitive types present in defaults. */
export function sanitize<T>(defaults: T, source: unknown): T {
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    if (Array.isArray(defaults)) return (Array.isArray(source) ? source : defaults) as T;
    return (
      typeof source === typeof defaults && (typeof source !== 'number' || Number.isFinite(source))
        ? source
        : defaults
    ) as T;
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return structuredClone(defaults);
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const key of Object.keys(defaults as Record<string, unknown>)) {
    const def = (defaults as Record<string, unknown>)[key];
    out[key] = key in src ? sanitize(def, src[key]) : structuredClone(def);
  }
  return out as T;
}
