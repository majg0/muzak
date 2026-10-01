import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformance, recordLiveParameters, serializePerformance } from '../src/serialization';
import { freshSeed, newSeedPerformance, readRecentPerformances, rememberPerformance } from '../src/sessions';

const KEY = 'continuum.recent-performances';
class MemoryStorage {
  values = new Map<string, string>();
  writes = 0;
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error('Storage unavailable');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('Quota exceeded');
    this.values.set(key, value);
    this.writes++;
  }
}
const recipe = (seed: string) => serializePerformance(createPerformance(seed));

test('fresh seeds have readable labels, 64-bit suffixes and distinct cryptographic draws', () => {
  const seeds = Array.from({ length: 2048 }, () => freshSeed());
  assert.ok(seeds.every(seed => /^[a-z]+-[a-z]+-[0-9a-f]{16}$/.test(seed) && seed.length < 128));
  assert.equal(new Set(seeds).size, seeds.length);
  assert.equal(new Set(seeds.map(seed => seed.slice(-16))).size, seeds.length);
  assert.ok(new Set(seeds.map(seed => seed.split('-').slice(0, 2).join('-'))).size > 150);
});

test('changing seed deeply preserves the complete recipe and clears only its old bookmarks', () => {
  let original = createPerformance('remember-me');
  original = recordLiveParameters(original, { rhythmicDensity: 1, rhythmicComplexity: 1 }, 960);
  original = recordLiveParameters(original, { tempo: 101 }, 3840);
  original.bookmarks.push({ id: 'old-location', name: 'A remembered turn', tick: 9600 });
  original.phrasing!.variation = .94;
  const before = structuredClone(original);
  const next = newSeedPerformance(original, '新しい庭 ♫');
  assert.deepEqual(next, { ...before, seed: '新しい庭 ♫', bookmarks: [] });
  assert.deepEqual(original, before);
  next.initialParameters.tension = .99;
  next.automation[0].points[0].value = .12;
  next.automationRevisions![1].lanes[0].points[0].value = .25;
  next.conductor!.amount = .1;
  next.phrasing!.variation = .2;
  next.sound.spectrum.partials[0].amplitude = .8;
  next.weights.commonTones = 3;
  assert.deepEqual(original, before);
  assert.throws(() => newSeedPerformance(original, '   '));
  assert.throws(() => newSeedPerformance(original, 's'.repeat(257)));
});

test('recent history keeps ten exact distinct recipes in most-recent-first order', () => {
  const storage = new MemoryStorage();
  const recipes = Array.from({ length: 12 }, (_, index) => recipe(`seed-${index}`));
  assert.deepEqual(readRecentPerformances(storage), []);
  for (const item of recipes) assert.equal(rememberPerformance(storage, item), true);
  assert.deepEqual(readRecentPerformances(storage), recipes.slice(2).reverse());
  assert.equal(rememberPerformance(storage, recipes[5]), true);
  assert.deepEqual(readRecentPerformances(storage), [recipes[5], ...recipes.slice(2).reverse().filter(item => item !== recipes[5])]);
  const writes = storage.writes;
  assert.equal(rememberPerformance(storage, recipes[5]), true);
  assert.equal(storage.writes, writes, 'Remembering the current head requires no extra storage write.');
  const displayed = readRecentPerformances(storage);
  displayed.pop();
  assert.equal(readRecentPerformances(storage).length, 10);
});

test('history preserves old versions and raw formatting without migrating recipes', () => {
  const storage = new MemoryStorage();
  const old = { ...createPerformance('old-東京'), engineVersion: 'continuum-2.0.0' };
  delete old.phrasing;
  delete old.conductor;
  const pretty = JSON.stringify(old, null, 2), compact = JSON.stringify(old);
  assert.equal(rememberPerformance(storage, pretty), true);
  assert.equal(rememberPerformance(storage, compact), true);
  assert.deepEqual(readRecentPerformances(storage), [compact, pretty]);
});

test('history evicts oldest recipes to stay under its total UTF-16 budget', () => {
  const storage = new MemoryStorage();
  const recipes = Array.from({ length: 10 }, (_, index) => JSON.stringify({ ...createPerformance(`large-${index}`), archivalNotes: '庭'.repeat(180_000) }));
  for (const item of recipes) assert.equal(rememberPerformance(storage, item), true);
  const retained = readRecentPerformances(storage);
  assert.ok(retained.length >= 1 && retained.length < 10);
  assert.equal(retained[0], recipes.at(-1));
  assert.deepEqual(retained, recipes.slice(-retained.length).reverse());
  assert.ok(storage.getItem(KEY)!.length * 2 <= 3_000_000);
  const before = storage.getItem(KEY);
  const oversized = JSON.stringify({ ...createPerformance('too-large'), archivalNotes: 'x'.repeat(1_500_000) });
  assert.equal(rememberPerformance(storage, oversized), false);
  assert.equal(storage.getItem(KEY), before);
});

test('corrupt or unrecognized history is preserved without overwriting it', () => {
  const valid = recipe('safe');
  for (const corrupt of ['{broken', '{}', '[1]', JSON.stringify([valid, 'not a recipe']), JSON.stringify([valid, valid]), JSON.stringify(Array.from({ length: 11 }, (_, index) => recipe(`overflow-${index}`)))]) {
    const storage = new MemoryStorage();
    storage.values.set(KEY, corrupt);
    assert.deepEqual(readRecentPerformances(storage), []);
    assert.equal(rememberPerformance(storage, valid), false);
    assert.equal(storage.getItem(KEY), corrupt);
    assert.equal(storage.writes, 0);
  }
  const storage = new MemoryStorage();
  for (const malformed of ['null', '[]', '{}', JSON.stringify({ format: 'continuum-performance', seed: 'incomplete' }), JSON.stringify({ ...createPerformance('bad-shape'), automation: {} })]) {
    assert.equal(rememberPerformance(storage, malformed), false);
  }
  assert.equal(storage.writes, 0);
});

test('storage access and quota failures return false without losing old history', () => {
  const storage = new MemoryStorage(), first = recipe('first');
  assert.equal(rememberPerformance(storage, first), true);
  const before = storage.getItem(KEY);
  storage.failWrite = true;
  assert.equal(rememberPerformance(storage, recipe('second')), false);
  assert.equal(storage.getItem(KEY), before);
  storage.failRead = true;
  assert.deepEqual(readRecentPerformances(storage), []);
  assert.equal(rememberPerformance(storage, first), false);
  assert.equal(storage.values.get(KEY), before);
});
