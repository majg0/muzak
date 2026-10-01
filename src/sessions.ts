import type { Performance } from './types';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const RECENT_KEY = 'continuum.recent-performances';
const MAX_RECENT = 10;
// Count UTF-16 bytes, including the outer JSON and escaped recipe strings.
// Browser quotas differ, so setItem remains the final authority on available space.
const MAX_STORAGE_BYTES = 3_000_000;
const MAX_RECIPE_CHARACTERS = 2_000_000;
const ADJECTIVES = ['amber', 'quiet', 'lunar', 'silver', 'hidden', 'velvet', 'distant', 'tidal', 'open', 'soft', 'blue', 'golden', 'misty', 'warm', 'bright', 'wandering'];
const NOUNS = ['garden', 'orbit', 'river', 'field', 'signal', 'tide', 'forest', 'window', 'harbor', 'meadow', 'lantern', 'current', 'echo', 'island', 'thread', 'horizon'];
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** A human-readable label plus 64 independent cryptographic suffix bits.
 * This source is deliberately separate from the composer's addressed randomness. */
export function freshSeed(): string {
  const entropy = globalThis.crypto.getRandomValues(new Uint32Array(3));
  const label = `${ADJECTIVES[entropy[0] & 15]}-${NOUNS[(entropy[0] >>> 4) & 15]}`;
  const suffix = entropy[1].toString(16).padStart(8, '0') + entropy[2].toString(16).padStart(8, '0');
  return `${label}-${suffix}`;
}

/** Fork the recipe's musical settings; old bookmarks belong to its old seed. */
export function newSeedPerformance(performance: Performance, seed: string): Performance {
  if (!isText(seed, 256)) throw new Error('A seed must contain between 1 and 256 characters.');
  const next = structuredClone(performance);
  next.seed = seed;
  next.bookmarks = [];
  return next;
}

/** Archiving is version-agnostic. Importing/restoring still needs the engine's
 * full validator: history must retain old recipes without migrating their data. */
function isRecipe(serialized: unknown): serialized is string {
  if (typeof serialized !== 'string' || serialized.length > MAX_RECIPE_CHARACTERS) return false;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return false;
    return value.format === 'continuum-performance'
      && isText(value.engineVersion, 128) && isText(value.seed, 256) && isText(value.presetId, 128)
      && isRecord(value.initialParameters) && typeof value.initialParameters.tempo === 'number' && Number.isFinite(value.initialParameters.tempo)
      && isRecord(value.weights) && Array.isArray(value.automation) && Array.isArray(value.bookmarks)
      && (value.automationRevisions === undefined || Array.isArray(value.automationRevisions))
      && (value.sound === undefined || isRecord(value.sound))
      && (value.conductor === undefined || isRecord(value.conductor))
      && (value.phrasing === undefined || isRecord(value.phrasing));
  } catch { return false; }
}

function decodeRecent(raw: string | null): string[] {
  if (raw === null) return [];
  if (raw.length * 2 > MAX_STORAGE_BYTES) throw new Error('Recent history exceeds its storage budget.');
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > MAX_RECENT || !value.every(isRecipe) || new Set(value).size !== value.length) {
    throw new Error('Recent history is malformed.');
  }
  return value;
}

/** Unreadable history is hidden, never repaired or overwritten by this read. */
export function readRecentPerformances(storage: SessionStorage): string[] {
  try { return decodeRecent(storage.getItem(RECENT_KEY)); }
  catch { return []; }
}

/** Keep the latest distinct raw recipes. A false result leaves existing history
 * intact, including corrupt data that may still be recoverable by the user. */
export function rememberPerformance(storage: SessionStorage, serialized: string): boolean {
  if (!isRecipe(serialized)) return false;
  try {
    const previous = storage.getItem(RECENT_KEY);
    const history = decodeRecent(previous);
    const next = [serialized, ...history.filter(item => item !== serialized)].slice(0, MAX_RECENT);
    let encoded = JSON.stringify(next);
    while (encoded.length * 2 > MAX_STORAGE_BYTES && next.length > 1) {
      next.pop();
      encoded = JSON.stringify(next);
    }
    if (encoded.length * 2 > MAX_STORAGE_BYTES) return false;
    if (encoded !== previous) storage.setItem(RECENT_KEY, encoded);
    return true;
  } catch { return false; }
}
