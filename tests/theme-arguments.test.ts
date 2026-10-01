import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore, type ThemeArgumentPolicy } from '../src/engine/theme-core';
import { PhraseLayer } from '../src/engine/phrase';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { midiToPitch, pitchToDegree, degreeToPitch, TUNINGS, type TuningId } from '../src/pitch';

const policy = (seed: string, density: number, register = .5): ThemeArgumentPolicy => ({ seed, ideaDensity: density, activity: .5, register });
function argument(seed: string, density: number, tuning: TuningId = '12tet', bars = 8, barTicks = 1920) {
  const core = composeThemeCore(seed, 'theme-a', 4);
  return { core, line: realizeThemeCore(core, { startTick: 0, endTick: barTicks * bars, tuning, occurrence: 0,
    cadence: 'closed', treatment: 'reharmonize', argument: policy(seed, density) }) };
}

test('idea density authors sparse statements and substantial fast arguments, not only extra ornaments', () => {
  const denseRates: number[] = [];
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
    const sparse = argument(seed, 0, tuning, 16).line, singing = argument(seed, .5, tuning, 4).line,
      dense = argument(seed, 1, tuning, 4).line;
    const rate = (notes: typeof sparse.notes, ticks: number) => notes.length / (ticks / 480);
    assert.ok(rate(sparse.notes, 30720) < .32, 'Sparse complete arguments average more than three beats per structural attack.');
    denseRates.push(rate(dense.notes, 7680));
    assert.ok(rate(dense.notes, 7680) > 1, `${seed}: ${rate(dense.notes, 7680)} attacks/quarter with deliberate held landings`);
    assert.ok(dense.notes.length > singing.notes.length * 2);
    assert.ok(dense.notes.every(note => note.coreRole && note.corePurpose!.length > 15));
    assert.ok(dense.realization!.motifs!.length >= 4);
    assert.equal(dense.realization!.phrases!.length, dense.realization!.motifs!.length,
      'Density adds directed refinements, rather than automatically looping a short source.');
    assert.ok(dense.realization!.phrases!.slice(1).every(phrase => phrase.anchors && phrase.anchors.length <= 5));
    assert.equal(dense.notes.at(-1)!.degree, 0);
    assert.ok(dense.notes.at(-1)!.duration >= 720, 'Fast activity still earns a held final arrival.');
    assert.ok(dense.realization!.registerSpanCents >= 1200, 'The argument itself visits distinct registers.');
    assert.equal(sparse.realization!.kind, 'spacious');
    assert.equal(dense.realization!.kind, 'virtuosic');
  }
  assert.ok(denseRates.reduce((sum, value) => sum + value, 0) / denseRates.length > 1.5,
    'The cohort has fast lead motion without forcing flat individual sources to manufacture repeated attacks.');
});

test('related moving groups stay native, directed and connected around their protected opening identity', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (let index = 0; index < 48; index++) for (const barTicks of [1920, 1440, 1680]) {
    const { core, line } = argument(`argument-${index}`, .62 + index % 4 * .12, tuning, index % 2 ? 4 : 8, barTicks);
    const heads = line.segments.filter(segment => segment.sourceId === core.headId);
    const fingerprint = (segment: typeof heads[number]) => segment.notes.map(note => [note.tick - segment.startTick, note.degree, note.sourceId]);
    assert.ok(heads.length >= 1);
    for (const recall of heads.slice(1)) assert.deepEqual(fingerprint(heads[0]), fingerprint(recall));
    let previous = line.notes[0];
    for (const note of line.notes) {
      assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0);
      assert.ok(note.tick + note.duration <= barTicks * (index % 2 ? 4 : 8));
      const native = note.cents * TUNINGS[tuning].divisions / 1200;
      assert.ok(Math.abs(native - Math.round(native)) < .00003);
      assert.ok(Math.abs(note.degree - previous.degree) <= 7,
        `${tuning} seed${index} meter${barTicks}: ${previous.degree}→${note.degree} @${note.tick}`);
      assert.ok(!line.rests.some(rest => note.tick < rest.endTick && note.tick + note.duration > rest.startTick));
      previous = note;
    }
    assert.ok(line.notes.some(note => note.tick === line.highPointTick), 'The observed highest point refers to an actually written note.');
  }
});

function testForm(seed: string, tuning: TuningId): FormState {
  return { ...formAt(seed, 0, DEFAULT_CONDUCTOR), role: 'theme', themeId: 'theme-a', sectionIndex: 0,
    sectionStartTick: 0, sectionEndTick: 30720, phraseIndex: 0, phraseStartTick: 0, phraseEndTick: 7680,
    barStartTick: 0, beat: 1, bar: 0, barTicks: 1920, meter: { numerator: 4, denominator: 4 }, tuning };
}
test('performed sparse and dense arguments retain fixed melody, complete native register bounds and coherent patches', () => {
  const colors = new Set<string>();
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (let index = 0; index < 16; index++) for (const density of [0, .5, 1]) {
    const seed = `performed-argument-${index}`, form = testForm(seed, tuning);
    const run = (strategy: 'functional' | 'tonnetz') => {
      const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION, embellishment: 0 },
        harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize', strategy } }, index % 12);
      layer.begin(form, { ...DEFAULT_PARAMETERS, ideaDensity: density });
      const snapshot = layer.snapshot()!, notes = layer.notes(0, snapshot.endTick, tuning,
        [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
      assert.equal(snapshot.themeCore!.notes.length, notes.length);
      const smallBatches = Array.from({ length: snapshot.endTick / 120 }, (_, i) => layer.notes(i * 120, 120,
        tuning, [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false)).flat();
      assert.deepEqual(notes, smallBatches);
      for (const [i, note] of notes.entries()) {
        assert.equal(note.absolutePitch!.millicents / 1000, snapshot.themeCore!.notes[i].absolutePitchCents);
        assert.ok(note.absolutePitch!.millicents >= 5200000 && note.absolutePitch!.millicents <= 9600000);
        assert.deepEqual(degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)), note.absolutePitch);
      }
      assert.equal(new Set(notes.map(note => note.timbre)).size, 1, 'The patch belongs to the complete thought.');
      colors.add(notes[0].timbre!);
      return notes;
    };
    assert.deepEqual(run('functional'), run('tonnetz'));
  }
  assert.ok(colors.size >= 7, `Actually emitted colors: ${[...colors]}`);
});

test('dense statements freeze the orchestra subject rhythm rather than independently rerolling it', () => {
  const seed = 'shared-diminution', core = composeThemeCore(seed, 'theme-a', 4), count = core.clauses[0].notes.length;
  const offsets = count === 3 ? [0, 240, 720] : [0, 240, 720, 960];
  const make = () => realizeThemeCore(core, { startTick: 0, endTick: 15360, tuning: '12tet', occurrence: 0,
    cadence: 'closed', treatment: 'reharmonize', argument: { ...policy(seed, 1), rhythm: {
      sourceId: 'common-head', cycleTicks: count === 3 ? 960 : 1920,
      cell: offsets.map(offsetTicks => ({ offsetTicks, strength: .8, role: 'anchor' })) } } });
  const line = make(), heads = line.segments.filter(segment => segment.sourceId === core.headId);
  assert.deepEqual(line, make());
  assert.equal(line.realization!.rhythmSourceId, 'common-head');
  const relative = heads[0].notes.map(note => note.tick - heads[0].startTick);
  const headSpan = heads[0].endTick - heads[0].startTick;
  relative.forEach((tick, i) => assert.ok(Math.abs(tick - offsets[i] / (count === 3 ? 960 : 1920) * headSpan) <= 60));
  assert.ok(relative.every(tick => tick % 120 === 0), 'Projection preserves the common subdivision.');
  assert.deepEqual(heads[0].notes.map(note => note.degree), core.clauses[0].notes.map(note => note.degree));
});

test('quantizing a clustered shared subject never loses or overlaps its identifying onsets', () => {
  const core = composeThemeCore('review-0', 'theme-a', 4), count = core.clauses[0].notes.length;
  const input = { startTick: 0, endTick: 3840, tuning: '12tet' as const, occurrence: 0,
    cadence: 'closed' as const, treatment: 'reharmonize' as const };
  const rhythm = { sourceId: 'clustered', cycleTicks: 1200,
    cell: Array.from({ length: count }, (_, n) => ({ offsetTicks: n ? 800 + n : 0, strength: .8, role: 'anchor' })) };
  const line = realizeThemeCore(core, { ...input, argument: { ...policy('review-0', 1), rhythm } });
  const head = line.segments[0];
  assert.equal(new Set(head.notes.map(note => note.tick)).size, count);
  assert.ok(head.notes.every(note => note.duration > 0 && note.tick + note.duration <= head.endTick + 18));
  assert.ok(head.notes.every((note, n) => !n || note.tick > head.notes[n - 1].tick));
  assert.equal(line.realization!.rhythmSourceId, 'clustered');
  assert.throws(() => realizeThemeCore(core, { ...input, argument: { ...policy('review-0', 1),
    rhythm: { ...rhythm, cycleTicks: 0 } } }), /shared subject rhythm/);
  const ordinary = realizeThemeCore(core, { ...input, argument: policy('review-0', 1) });
  const incompatible = realizeThemeCore(core, { ...input, argument: { ...policy('review-0', 1),
    rhythm: { ...rhythm, sourceId: 'unused', cell: rhythm.cell.slice(0, 1) } } });
  assert.deepEqual(incompatible, ordinary, 'An ignored rhythm must not be credited as the heard source.');
});

test('custom identifying gestures reserve time for every note before body allocation', () => {
  const core = composeThemeCore('review-0', 'theme-a', 4);
  core.cell = undefined; core.ideaGraph = undefined; core.ideaScope = undefined;
  const head = { ...core.clauses[0], notes: Array.from({ length: 32 }, (_, n) => ({
    id: `custom-head-${n}`, degree: n % 3, rhythmUnits: .01, role: 'head' as const, purpose: 'A supplied long subject.' })) };
  core.clauses = [head, core.clauses.at(-1)!];
  const line = realizeThemeCore(core, { startTick: 0, endTick: 3840, tuning: '12tet', occurrence: 0,
    cadence: 'closed', treatment: 'reharmonize', argument: policy('review-0', 1) });
  const segment = line.segments[0];
  assert.equal(segment.notes.length, 32);
  assert.ok(segment.notes.every(note => note.duration > 0 && note.tick + note.duration <= segment.endTick));
  assert.equal(new Set(segment.notes.map(note => note.tick)).size, 32);
});
