export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function decodeCacheEntry(serialized, now = Date.now()) {
  if (serialized === null) return null;
  try {
    const entry = JSON.parse(serialized);
    if (
      !entry
      || !Number.isFinite(entry.savedAt)
      || !("value" in entry)
      || now - entry.savedAt > CACHE_MAX_AGE_MS
    ) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function encodeCacheEntry(value, now = Date.now()) {
  return JSON.stringify({ savedAt: now, value });
}
