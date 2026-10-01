import test from 'node:test';
import assert from 'node:assert/strict';
import { CounterpointLayer, composeCounterpoint, COUNTERPOINT_TOOLS, DEFAULT_COUNTERPOINT_INTENT, type CounterpointIntent, type CounterpointSubjectNote } from '../src/engine/counterpoint';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { degreeToPitch, midiToPitch, pitchToDegree, TUNINGS, type TuningId } from '../src/pitch';
import type { NoteEvent } from '../src/types';
import type { FormState } from '../src/conductor';
import { seedIdea } from '../src/engine/phrase';
import { lyricalField } from '../src/engine/lyrical-support';
import { composeThemeCore } from '../src/engine/theme-core';

const form = (tick: number) => ({ themeId: tick < 10000 ? 'theme-a' : 'theme-b', tonalOffsetCents: tick < 10000 ? 0 : 500 } as FormState);
const make = () => new CounterpointLayer('independent-answer', { ...DEFAULT_COMPOSITION, displacement: 1 }, 4, form);

test('counterline clock and source lifetime continue through unrelated section and bar boundaries', () => {
  const layer = make();
  const before = layer.snapshot(9999), after = layer.snapshot(10000);
  assert.equal(after.cycleTicks, before.cycleTicks);
  assert.equal(after.sourceId, before.sourceId);
  assert.equal(after.cycleStartTick, before.cycleStartTick);
  const snapshots = Array.from({ length: 120 }, (_, index) => layer.snapshot(index * 480));
  assert.ok(snapshots.some(snapshot => snapshot.cycleStartTick > 0 && snapshot.cycleStartTick % 1920 !== 0));
  assert.ok(snapshots.some(snapshot => snapshot.sourceId.startsWith('theme-b')));
  assert.ok(snapshots.some(snapshot => snapshot.active) && snapshots.some(snapshot => !snapshot.active));
});

test('independent cell events do not depend on caller frame segmentation or query order', () => {
  const layer = make(), end = 960 * 32;
  const whole = layer.notes(0, end, DEFAULT_PARAMETERS, '12tet');
  const parts = Array.from({ length: 32 }, (_, index) => layer.notes(index * 960, 960, DEFAULT_PARAMETERS, '12tet')).flat();
  assert.deepEqual(parts, whole);
  layer.notes(16000, 960, DEFAULT_PARAMETERS, '12tet');
  assert.deepEqual(layer.notes(0, end, DEFAULT_PARAMETERS, '12tet'), whole);
  assert.ok(whole.some(note => Math.floor(note.tick / 1920) !== Math.floor((note.tick + note.duration - 1) / 1920)), 'Some sustained answers flow across the barline.');
  assert.ok(whole.every(note => note.voice === 8 && note.duration > 0 && note.velocity < .65));
});

test('native independent answers retain their physical grid, bounded range and authored gaps', () => {
  const layer = make();
  const notes = layer.notes(0, 960 * 64, DEFAULT_PARAMETERS, '19edo');
  assert.ok(notes.some(note => note.absolutePitch!.millicents % 100000 !== 0));
  for (const note of notes) {
    assert.deepEqual(note.absolutePitch, degreeToPitch('19edo', pitchToDegree('19edo', note.absolutePitch!)));
    assert.ok(note.absolutePitch!.millicents >= 5370000 && note.absolutePitch!.millicents <= 8030000);
    assert.equal(note.midiNote, undefined);
  }
  assert.ok(notes.slice(1).some((note, index) => note.tick - notes[index].tick - notes[index].duration > 480));
  const off = new CounterpointLayer('independent-answer', { ...DEFAULT_COMPOSITION, displacement: 0 }, 4, form);
  assert.deepEqual(off.notes(0, 960 * 64, DEFAULT_PARAMETERS, '12tet'), []);
});

test('recalled heads retain the source theme mode when another family is in the foreground', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const seed = 'glass-garden', layer = new CounterpointLayer(seed, { ...DEFAULT_COMPOSITION, displacement: 1 }, 0, form);
    const notes = layer.notes(0, 960 * 48, DEFAULT_PARAMETERS, tuning);
    const groups = new Map<string, typeof notes>();
    for (const note of notes) {
      const id = note.id.split(':')[1], group = groups.get(id) ?? [];
      group.push(note); groups.set(id, group);
    }
    let checked = 0;
    for (const group of groups.values()) {
      const family = layer.snapshot(group[0].tick).sourceId.split(':')[0];
      const source = seedIdea(seed, family), core = composeThemeCore(seed, family, source.third), field = lyricalField(tuning, source.third);
      if (group.length !== core.clauses[0].notes.length) continue;
      const expected = core.clauses[0].notes.map(note => field[((note.degree % field.length) + field.length) % field.length]
        + Math.floor(note.degree / field.length) * TUNINGS[tuning].divisions);
      const actual = group.map(note => pitchToDegree(tuning, note.absolutePitch!));
      assert.deepEqual(actual.slice(1).map((value, index) => value - actual[index]), expected.slice(1).map((value, index) => value - expected[index]));
      checked++;
    }
    assert.ok(checked > 4);
    assert.equal(seedIdea(seed, 'theme-a').third, 3, 'The regression fixture includes a minor source.');
  }
});

const intent: CounterpointIntent = { fidelity: .8, smoothness: .9, independence: 1, dissonance: 0, development: .6, register: .4 };
const subject = (pitches: number[], spacing = 480): CounterpointSubjectNote[] => pitches.map((pitch, index) => ({
  sourceId: `source-${index}`, tick: index * spacing, duration: spacing - 30, absolutePitch: midiToPitch(pitch), strength: index ? .7 : 1,
}));
const lead = (pitches: number[], spacing = 480): NoteEvent[] => subject(pitches, spacing).map((note, index) => ({
  ...note, id: `lead-${index}`, part: 'melody', voice: 5, velocity: .7,
}));

test('the reusable counterpoint compiler keeps complete identities and exact native ranges', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const source = subject([84, 86, 88, 91, 90, 86]).map(note => ({ ...note,
      absolutePitch: degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch)) }));
    const original = structuredClone(source);
    const result = composeCounterpoint(source, tuning, intent, { rangeCents: [5400, 7900] });
    assert.equal(result.notes.length, source.length);
    assert.deepEqual(result.notes.map(note => note.sourceId), source.map(note => note.sourceId));
    const native = (notes: CounterpointSubjectNote[]) => notes.map(note => pitchToDegree(tuning, note.absolutePitch));
    const intervals = (values: number[]) => values.slice(1).map((value, index) => value - values[index]);
    assert.deepEqual(intervals(native(result.notes)), intervals(native(source)));
    for (const note of result.notes) {
      assert.ok(note.absolutePitch.millicents >= 5400000 && note.absolutePitch.millicents <= 7900000);
      assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch)));
    }
    assert.deepEqual(source, original);
    assert.ok(result.candidatesEvaluated > 0 && Object.values(result.evaluation).every(Number.isFinite));
  }
});

test('evaluated answers respond to held and later-entering actual tones, including a changed lead realization', () => {
  const source = subject([60], 1920), rangeCents = [6000, 6500] as const;
  const alone = composeCounterpoint(source, '12tet', intent, { rangeCents });
  const overlapping = { ...lead([61])[0], tick: -480, duration: 2400 };
  const held = composeCounterpoint(source, '12tet', intent, { rangeCents, notes: [overlapping] });
  const entering = composeCounterpoint(source, '12tet', intent, { rangeCents, notes: [{ ...overlapping, tick: 240, duration: 1680 }] });
  assert.notDeepEqual(held.notes[0].absolutePitch, alone.notes[0].absolutePitch);
  assert.notDeepEqual(entering.notes[0].absolutePitch, alone.notes[0].absolutePitch);
  assert.ok(Math.abs(held.notes[0].absolutePitch.millicents - overlapping.absolutePitch!.millicents) >= 180000);
  const withStalePreview = composeCounterpoint(source, '12tet', intent, { rangeCents,
    notes: [overlapping], foreground: [{ ...overlapping, absolutePitch: midiToPitch(65) }] });
  assert.deepEqual(withStalePreview, held, 'Actual lead realization replaces overlapping preview evidence.');
  const unrelated = composeCounterpoint(source, '12tet', intent, { rangeCents, notes: [{ ...overlapping, tick: 1920 }] });
  assert.deepEqual(unrelated, alone, 'Events beyond the answer cannot influence its score.');
});

test('paired voice motion avoids parallel perfect intervals while retaining source relationships', () => {
  const source = subject([60, 62, 64, 65, 67]), foreground = lead([72, 74, 76, 77, 79]);
  const result = composeCounterpoint(source, '12tet', intent, { notes: foreground, rangeCents: [5400, 7100], pitchClasses: [0, 2, 4, 5, 7, 9, 11].map(pc => (pc - 9 + 12) % 12) });
  assert.equal(result.notes.length, source.length);
  assert.ok(result.candidatesEvaluated > source.length * 2);
  let parallelPerfect = 0;
  for (let i = 1; i < source.length; i++) {
    const low = result.notes[i].absolutePitch.millicents / 100000;
    const before = result.notes[i - 1].absolutePitch.millicents / 100000;
    const high = foreground[i].absolutePitch!.millicents / 100000;
    const previousHigh = foreground[i - 1].absolutePitch!.millicents / 100000;
    const perfect = (interval: number) => [0, 7].includes(Math.abs(interval) % 12);
    if (Math.sign(low - before) === Math.sign(high - previousHigh) && perfect(high - low) && perfect(previousHigh - before)) parallelPerfect++;
  }
  assert.equal(parallelPerfect, 0);
  assert.ok(result.evaluation.identity < .5, 'The evaluated answer stays recognizably related to its subject.');
});

test('contrary development remains eligible until the complete motion is evaluated', () => {
  const source = subject([60, 62, 64, 65, 67]);
  const result = composeCounterpoint(source, '12tet', { ...intent, fidelity: .5, development: 1 },
    { notes: lead([60, 62, 64, 65, 67]), rangeCents: [6000, 6700] });
  assert.equal(result.relationship, 'contrary development');
  assert.ok(result.notes.at(-1)!.absolutePitch.millicents < result.notes[0].absolutePitch.millicents);
  assert.deepEqual(result.notes.map(note => note.sourceId), source.map(note => note.sourceId));
});

test('committed vocabulary opportunities select heard relationships within the musical regret bound', () => {
  const source = subject([60, 62, 64, 65, 67]), requested = { ...intent, fidelity: .5, development: 1 };
  const context = { notes: lead([60, 62, 64, 65, 67]), rangeCents: [6000, 7100] as const };
  const baseline = composeCounterpoint(source, '12tet', requested, context);
  const at = (ordinal: number) => composeCounterpoint(source, '12tet', requested, { ...context,
    selection: { seed: 'counterpoint-coverage', address: `entry-${ordinal}`,
      plan: { scope: 'answer', ordinal, vocabulary: COUNTERPOINT_TOOLS, maxRegret: .85 } } });
  const decisions = Array.from({ length: 8 }, (_, ordinal) => at(ordinal));
  assert.deepEqual(new Set(decisions.flatMap(decision => decision.coverage!.used)), new Set(COUNTERPOINT_TOOLS));
  for (const [ordinal, decision] of decisions.entries()) {
    assert.ok(decision.evaluation.total <= baseline.evaluation.total + .85 + 1e-10);
    assert.equal(decision.coverage!.used.length, 1, 'One complete answer realizes one orientation.');
    assert.equal(decision.coverage!.fulfilled, decision.coverage!.used.includes(decision.coverage!.focus));
    const sourceMotion = source.slice(1).map((note, index) => note.absolutePitch.millicents - source[index].absolutePitch.millicents);
    const correlation = decision.notes.slice(1).reduce((sum, note, index) => sum
      + (note.absolutePitch.millicents - decision.notes[index].absolutePitch.millicents) * sourceMotion[index], 0);
    assert.ok(decision.relationship === 'contrary development' ? correlation < 0 : correlation > 0);
    assert.deepEqual(at(ordinal), decision, 'Reading other occurrences cannot consume a vocabulary opportunity.');
  }
});

test('literal and motionless sources never manufacture contrary-relationship coverage', () => {
  const selection = { seed: 'counterpoint-coverage', address: 'literal',
    plan: { scope: 'answer', ordinal: 0, vocabulary: COUNTERPOINT_TOOLS, maxRegret: .85 } };
  const source = subject([60, 62, 64, 65, 67]);
  const literal = composeCounterpoint(source, '12tet', { ...intent, development: 0 }, { selection });
  assert.equal(literal.coverage, undefined, 'An unopposed literal quotation bypasses vocabulary pressure.');
  assert.deepEqual(literal.notes.slice(1).map((note, index) => note.absolutePitch.millicents - literal.notes[index].absolutePitch.millicents),
    source.slice(1).map((note, index) => note.absolutePitch.millicents - source[index].absolutePitch.millicents));
  const held = composeCounterpoint(subject([60, 60, 60]), '12tet', { ...intent, development: 1 },
    { selection, notes: lead([72, 74, 76]) });
  assert.deepEqual(held.coverage!.used, []);
  assert.deepEqual(held.coverage!.deferred, [...COUNTERPOINT_TOOLS].sort());
});

test('counterpoint integrates the physical glide passage and normalizes nonfinite intent values', () => {
  const source = subject([60], 1920), duration = source[0].duration;
  const moving = { ...lead([60], 1920)[0], endPitch: midiToPitch(72), glideTicks: duration };
  const rangeCents = [6000, 6500] as const;
  const glide = composeCounterpoint(source, '12tet', intent, { rangeCents, notes: [moving] });
  const samples = [60, 66, 72].map((pitch, index) => ({ ...moving, id: `sample-${index}`, endPitch: undefined,
    absolutePitch: midiToPitch(pitch), tick: index === 0 ? 0 : index === 1 ? duration / 6 : duration * 5 / 6,
    duration: duration * (index === 1 ? 4 / 6 : 1 / 6) }));
  const integrated = composeCounterpoint(source, '12tet', intent, { rangeCents, notes: samples });
  assert.deepEqual(glide.notes, integrated.notes);
  assert.ok(Math.abs(glide.evaluation.consonance - integrated.evaluation.consonance) < 1e-10);
  const invalid = { ...intent, fidelity: NaN, dissonance: Infinity, register: -Infinity };
  const normalized = { ...intent, fidelity: DEFAULT_COUNTERPOINT_INTENT.fidelity,
    dissonance: DEFAULT_COUNTERPOINT_INTENT.dissonance, register: DEFAULT_COUNTERPOINT_INTENT.register };
  assert.deepEqual(composeCounterpoint(source, '12tet', invalid, { notes: [moving] }),
    composeCounterpoint(source, '12tet', normalized, { notes: [moving] }));
});

test('range constraints handle oversized subjects and silence impossible fields without octave-loop leakage', () => {
  const wide = composeCounterpoint(subject([24, 108, 36, 96]), '31edo', intent, { rangeCents: [6010, 6420] });
  assert.equal(wide.notes.length, 4);
  assert.ok(wide.notes.every(note => note.absolutePitch.millicents >= 6010000 && note.absolutePitch.millicents <= 6420000));
  assert.deepEqual(composeCounterpoint(subject([60]), '12tet', intent, { rangeCents: [6010, 6090] }).notes, []);
  assert.throws(() => composeCounterpoint(subject([60]), '12tet', intent, { rangeCents: [7000, 6000] }), /range/);
});

test('entering a contextual answer commits its full gesture across subsequent caller windows', () => {
  const layer = make(), end = 30720, background = lead([61], end).map(note => ({ ...note, duration: end }));
  assert.equal(layer.snapshot(0).evaluation, undefined, 'An unevaluated clock does not invent a score.');
  const whole = layer.notes(0, end, DEFAULT_PARAMETERS, '12tet', undefined, undefined, { notes: background });
  const diagnostic = layer.snapshot(whole[0].tick);
  assert.ok(diagnostic.candidatesEvaluated! > 0 && Number.isFinite(diagnostic.evaluation!.total));
  diagnostic.evaluation!.total = -1;
  assert.ok(layer.snapshot(whole[0].tick).evaluation!.total >= 0, 'Diagnostic clients cannot mutate the committed evaluation.');
  const fresh = make();
  const pieces = Array.from({ length: 32 }, (_, index) => fresh.notes(index * 960, 960, DEFAULT_PARAMETERS, '12tet', undefined, undefined, { notes: background })).flat();
  assert.deepEqual(pieces, whole);
  const changed = layer.notes(0, end, DEFAULT_PARAMETERS, '12tet', undefined, undefined,
    { notes: background.map(note => ({ ...note, absolutePitch: midiToPitch(66) })) });
  assert.deepEqual(changed, whole, 'Later evidence cannot rewrite a gesture whose entrance was already committed.');
});

test('vocabulary advances on committed entrances rather than silent cycles or diagnostic reads', () => {
  const seed = 'entry-opportunities', end = 61440;
  const fresh = () => new CounterpointLayer(seed, { ...DEFAULT_COMPOSITION, development: 1, displacement: .72 }, 4, form);
  const parameters = { ...DEFAULT_PARAMETERS, motifTransformation: 1, melodicFamiliarity: .3 };
  const background = lead([61], end * 2).map(note => ({ ...note, duration: end * 2 }));
  const layer = fresh();
  for (let tick = end; tick >= 0; tick -= 960) layer.snapshot(tick);
  const whole = layer.notes(0, end, parameters, '12tet', undefined, undefined, { notes: background });
  const entrances = [...new Map(whole.map(note => [note.id.split(':')[1], note.tick])).values()];
  const focuses = entrances.map(tick => layer.snapshot(tick).coverage!.focus);
  assert.ok(focuses.length > 6);
  for (let index = 0; index + COUNTERPOINT_TOOLS.length <= focuses.length; index += COUNTERPOINT_TOOLS.length)
    assert.deepEqual(new Set(focuses.slice(index, index + COUNTERPOINT_TOOLS.length)), new Set(COUNTERPOINT_TOOLS),
      'Each complete opportunity cycle covers the vocabulary despite skipped clock cycles.');
  const control = fresh();
  const pieces = Array.from({ length: end / 960 }, (_, index) => {
    control.snapshot(end + index * 960);
    return control.notes(index * 960, 960, parameters, '12tet', undefined, undefined, { notes: background });
  }).flat();
  assert.deepEqual(pieces, whole);
  layer.notes(0, end, parameters, '12tet', undefined, undefined, { notes: background });
  assert.deepEqual(layer.notes(end, 3840, parameters, '12tet', undefined, undefined, { notes: background }),
    control.notes(end, 3840, parameters, '12tet', undefined, undefined, { notes: background }),
  'Reading cached entries cannot spend the next entrance opportunity.');
});

test('a shared layer can realize distinct instrumental voices without event or diagnostic identity collisions', () => {
  const layer = make(), duration = 15360;
  const lower = layer.notes(0, duration, DEFAULT_PARAMETERS, '12tet', undefined, undefined, { voice: 8, rangeCents: [5400, 6900] });
  const upper = layer.notes(0, duration, DEFAULT_PARAMETERS, '12tet', undefined, undefined, { voice: 11, rangeCents: [6600, 7900], notes: lower });
  const notes = [...lower, ...upper];
  assert.ok(lower.length > 0 && upper.length > 0);
  assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
  assert.ok(lower.every(note => note.voice === 8) && upper.every(note => note.voice === 11));
  assert.notEqual(layer.snapshot(upper[0].tick, '12tet', 11).id, layer.snapshot(lower[0].tick, '12tet', 8).id);
});
