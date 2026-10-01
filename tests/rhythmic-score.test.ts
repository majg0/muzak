import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { degreeToPitch, midiToPitch, pitchToDegree, TUNINGS, type TuningId } from '../src/pitch';
import { RhythmicScore } from '../src/engine/rhythmic-score';
import { composeThemeCore, themeThird } from '../src/engine/theme-core';
import { textureIntentAt, texturePulseAt, type TextureAt } from '../src/engine/texture';
import { chordalBassPitch, grooveLayersAt, grooveNotes } from '../src/engine/groove';
import { realizeAccompaniment } from '../src/engine/accompaniment';
import { DEFAULT_HARMONY } from '../src/harmonic-language';

const seed = 'riff-as-one-argument';
const p = { ...DEFAULT_PARAMETERS, rhythmicDensity: .9, rhythmicComplexity: .9, rhythmicPredictability: 0, metricStability: .4 };
const base = formAt(seed, 0, DEFAULT_CONDUCTOR);
const form = (tick: number): FormState => ({ ...base, behavior: undefined, sectionIndex: 0,
  sectionStartTick: 0, sectionEndTick: 1920 * 32, barStartTick: Math.floor(tick / 1920) * 1920,
  barTicks: 1920, meter: { numerator: 4, denominator: 4 }, themeId: 'theme-a', role: 'theme', subdivisionTicks: 120 });
const plain = (pace: number, tick = 0) => ({ ...textureIntentAt(p, form(tick), { energy: pace, activity: pace,
  intensity: pace, register: pace, sustain: 1 - pace, accent: pace, direction: 'settled' }), pace });
const score = () => new RhythmicScore(seed, form, { displacement: 0, polymeter: 0 });
function textureAt(pace: number | ((tick: number) => number), parameters = p): TextureAt {
  const instance = score();
  return tick => { const texture = plain(typeof pace === 'number' ? pace : pace(tick), tick);
    return { ...texture, rhythm: instance.at(tick, parameters, texture) }; };
}
const groove = (at: TextureAt, tick = 0, duration = 15360) => grooveNotes(seed, tick, duration, form, p, '12tet', 36, 55, midiToPitch,
  { composition: DEFAULT_COMPOSITION, textureAt: at });

test('the shared subject quotes the authored thematic head rhythm rather than an unrelated drum pattern', () => {
  const result = score().at(0, p, plain(.6));
  const head = composeThemeCore(seed, 'theme-a', themeThird(seed, 'theme-a'));
  const weights = head.clauses[0].notes.map(note => note.rhythmUnits), total = weights.reduce((a, b) => a + b, 0);
  assert.equal(result.sourceId, head.headId);
  assert.equal(result.cell.length, weights.length);
  let elapsed = 0;
  for (const [index, note] of result.cell.entries()) {
    const authored = elapsed / total * result.cycleTicks;
    assert.ok(Math.abs(note.offsetTicks - authored) <= 60,
      'The source onset is projected to the nearest60-tick rhythmic grid, not replaced by another pattern.');
    assert.equal(note.offsetTicks % 60, 0);
    assert.ok(note.durationTicks > 0 && Number.isSafeInteger(note.durationTicks));
    assert.equal(note.offsetTicks + note.durationTicks, result.cell[index + 1]?.offsetTicks ?? result.cycleTicks);
    elapsed += weights[index];
  }
  assert.equal(result.cell.reduce((sum, note) => sum + note.durationTicks, 0), result.cycleTicks);
  assert.equal(result.cell[0].strength, 1);
  assert.ok(Math.max(...result.cell.map(note => note.durationTicks)) > Math.min(...result.cell.map(note => note.durationTicks)),
    'The riff retains the subject’s unequal onset/gap relationships.');
});

test('a riff repeats its statement before developing the tail and making a bounded fill/breath', () => {
  const instance = score(), texture = plain(.94);
  const first = instance.at(0, p, texture);
  const moments = [0, 1920, 3840, first.endTick - first.cycleTicks].map(tick => instance.at(tick, p, texture));
  const relative = (index: number) => moments[index].accents.map(note => ({ ...note, tick: note.tick - moments[index].cycleStartTick }));
  assert.deepEqual(relative(0), relative(1));
  assert.deepEqual(moments.map(moment => moment.treatment), ['statement', 'statement', 'develop', 'fill']);
  assert.ok([...moments[3].snare, ...moments[3].hat, ...moments[3].kick].some(note => note.role === 'fill'));
  assert.ok(moments[3].accents.filter(note => note.role === 'fill').length <= 12);
  assert.notDeepEqual(relative(2), relative(3));
  assert.deepEqual(moments[0].rests, moments[3].rests, 'Future backing silence is known before long notes are committed.');
  assert.ok(moments[3].accents.every(note => note.tick < moments[3].rests[0].startTick));
  assert.ok(moments.every(moment => moment.rests.every(rest => rest.scope === 'accompaniment')));
});

test('half/full/double interpretations change snare spacing without changing the riff clock or tempo', () => {
  const instance = score(), snapshot = structuredClone(p);
  const moments = [.15, .55, .96].map(pace => instance.at(0, p, plain(pace)));
  assert.deepEqual(moments.map(moment => moment.feel), ['half', 'full', 'double']);
  assert.deepEqual(moments.map(moment => moment.snare.map(note => note.tick)), [[960], [480, 1440], [240, 720, 1200, 1680]]);
  assert.ok(moments[0].accents.length < moments[1].accents.length);
  assert.deepEqual(moments[1].cell, moments[2].cell, 'Faster snare interpretation need not add an unrelated foreground cell.');
  for (const moment of moments) assert.deepEqual(moment.cell, moments[0].cell);
  assert.deepEqual(p, snapshot);
});

test('actual kick/bass/comping opportunities share riff accents while drum limbs remain complementary', () => {
  const at = textureAt(.65), introduced = at(0).rhythm!.layers.find(layer => layer.role === 'riff')!.introducedAt;
  const notes = groove(at, introduced, 1920);
  const bass = notes.filter(note => note.part === 'bass'), kicks = new Set(notes.filter(note => note.midiNote === 36).map(note => note.tick));
  assert.ok(bass.length >= 3);
  assert.ok(bass.every(note => kicks.has(note.tick) && texturePulseAt(seed, note.tick, at(note.tick)) > 0));
  const snare = notes.filter(note => note.midiNote === 38);
  assert.ok(snare.every(note => (note.tick - 480) % 960 === 0), 'The reference snare follows its backbeat clock even when the riff coincides.');
  assert.ok([...kicks].some(tick => !snare.some(note => note.tick === tick)), 'Kick and snare do not copy one complete unison pattern.');
  assert.ok(notes.every(note => note.expression?.sourceId === at(note.tick).rhythm!.sourceId || note.expression?.sourceId === 'reference:quarter'));
  assert.equal(grooveLayersAt(0, at(0).rhythm!).filter(layer => layer.active).length, 1);
  assert.ok(notes.every(note => !note.id.startsWith('beat:')));
});

test('medium composed comping reads shared source attacks and backing rests without rewriting native pitches', () => {
  const at = textureAt(.55), templates = [55, 60, 64, 69].map((midi, voice) => ({ id: `upper:${voice}`, tick: 0,
    duration: 990, voice, part: 'harmony' as const, absolutePitch: midiToPitch(midi), velocity: .65 }));
  const common = { seed, parameters: p, additive: false, textureAt: at, harmony: DEFAULT_HARMONY,
    expressiveAt: () => ({ energy: .5, activity: .5, intensity: .5, register: .5, sustain: .5, accent: .5, direction: 'settled' as const }),
    rests: at(0).rhythm!.rests };
  const make = (tick: number, duration: number) => realizeAccompaniment(templates, { ...common, tick, duration, form: form(tick) });
  const whole = make(0, 7680), parts = Array.from({ length: 8 }, (_, index) => make(index * 960, 960)).flat();
  assert.deepEqual(parts, whole);
  assert.ok(whole.length > 4);
  assert.ok(whole.some(note => note.tick % 120 !== 0), 'The production comping scan must admit real source attacks on its60-tick grid.');
  for (const note of whole) {
    assert.deepEqual(note.absolutePitch, templates[note.voice].absolutePitch);
    assert.equal(note.expression?.sourceId, at(note.tick).rhythm!.sourceId);
    assert.ok(note.tick % 1920 === 0 || texturePulseAt(seed, note.tick, at(note.tick)) > 0);
    assert.ok(note.tick + note.duration <= common.rests[0].startTick || note.tick >= common.rests[0].endTick);
  }
});

test('score realization is frame-partition independent, bounded, native and honors explicit rests', () => {
  const at = textureAt(tick => Math.min(.94, .15 + tick / 8000)), whole = groove(at);
  const split = Array.from({ length: 16 }, (_, index) => groove(at, index * 960, 960)).flat();
  assert.deepEqual(split, whole);
  assert.equal(new Set(whole.map(note => note.id)).size, whole.length);
  const bass = whole.filter(note => note.part === 'bass');
  assert.ok(bass.slice(1).every((note, index) => bass[index].tick + bass[index].duration <= note.tick));
  const native = grooveNotes(seed, 0, 15360, form, p, '19edo', -50, -22, degree => degreeToPitch('19edo', degree),
    { composition: DEFAULT_COMPOSITION, textureAt: at, rests: [{ startTick: 3000, endTick: 4500, scope: 'ensemble', reason: 'Authored rest wins.' }] });
  for (const note of native) {
    assert.ok(note.tick < 3000 || note.tick >= 4500);
    assert.ok(note.tick >= 4500 || note.tick + note.duration <= 3000);
    assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0);
    if (note.part === 'bass') {
      const degree = pitchToDegree('19edo', note.absolutePitch!);
      assert.ok(degree >= -65 && degree <= -33);
      assert.deepEqual(note.absolutePitch, degreeToPitch('19edo', degree)); assert.equal(note.midiNote, undefined);
    }
  }
});

test('high predictability retains the subject and release while complexity adds only a directed phrase ending', () => {
  const instance = score();
  const first = instance.at(0, p, plain(.94)), ending = first.endTick - first.cycleTicks;
  const predictable = instance.at(ending, { ...p, rhythmicPredictability: 1 }, plain(.94));
  const developed = instance.at(ending, p, plain(.94));
  assert.deepEqual(predictable.cell, developed.cell);
  assert.equal(predictable.treatment, 'release');
  assert.equal(predictable.accents.filter(note => note.role === 'fill').length, 0);
  assert.ok(developed.accents.some(note => note.role === 'fill'));
  const noDrums = instance.at(0, { ...p, rhythmicDensity: 0 }, plain(.9));
  assert.equal(noDrums.kick.length + noDrums.snare.length + noDrums.hat.length, 0);
  assert.deepEqual(noDrums.cell, developed.cell);
});

test('predictability changes ordinary-density tail answers while preserving the literal subject and reference pulse', () => {
  const fingerprints: string[] = [], references: string[] = [];
  for (const predictability of [.2, .5, .8]) {
    const instance = score(), params = { ...p, rhythmicDensity: .15, rhythmicPredictability: predictability };
    const heard: string[] = [], reference: string[] = [];
    for (let tick = 0; tick < 1920 * 32; tick += 60) {
      const moment = instance.at(tick, params, plain(.58));
      assert.deepEqual(moment.cell, instance.at(0, params, plain(.58)).cell);
      for (const [limb, hits] of [moment.kick, moment.snare, moment.hat].entries()) for (const hit of hits) if (hit.tick === tick) {
        heard.push(`${limb}:${tick}`);
        if (hit.layer === 'reference') reference.push(`${limb}:${tick}`);
      }
    }
    fingerprints.push(heard.join(',')); references.push(reference.join(','));
  }
  assert.equal(new Set(fingerprints).size, 3, 'Moderate edits produce actual timing differences without requiring a dense fill.');
  assert.equal(new Set(references).size, 1, 'The timekeeping pulse/backbeat must not jitter with surprise.');
});

test('polymeter is one thematic riff against pulse, never a pile of independent random layers', () => {
  const observed = new Set<number>();
  for (let index = 0; index < 32; index++) {
    const result = new RhythmicScore(`poly-${index}`, form, { displacement: 1, polymeter: 1 }).at(0, p, plain(.65));
    observed.add(result.cycleTicks);
    assert.ok(result.cell.every(note => note.durationTicks >= 120));
    assert.ok(result.snare.every(note => (note.tick - 480) % 960 === 0));
    const layers = grooveLayersAt(0, result);
    assert.equal(layers.length, 3);
    assert.equal(layers.filter(layer => layer.active).length, 1, 'Only the reference layer starts immediately.');
    assert.equal(layers.filter(layer => layer.sourceId !== 'reference:quarter').every(layer => layer.sourceId === result.sourceId), true);
  }
  assert.ok(observed.has(1200) && observed.has(1680) && observed.has(1920));
});

test('the reference quarter pulse and backbeat retain absolute phase beneath changed themes and cross-rhythms', () => {
  const switching = (tick: number): FormState => tick < 4800 ? form(tick) : { ...form(tick),
    sectionStartTick: 4800, themeId: 'theme-b', meter: { numerator: 7, denominator: 8 }, barTicks: 1680 };
  const instance = new RhythmicScore('persistent-reference', switching, { displacement: 1, polymeter: 1 });
  const heard: number[] = [];
  for (let tick = 0; tick < 30000; tick += 120) {
    const moment = instance.at(tick, p, plain(.6));
    const ref = moment.hat.find(note => note.tick === tick && note.layer === 'reference');
    if (ref) heard.push(tick);
    const resting = moment.rests.some(rest => tick >= rest.startTick && tick < rest.endTick);
    if (tick % 480 === 0 && !resting) assert.ok(ref, `Missing reference quarter at ${tick}`);
    for (const hit of moment.snare.filter(hit => hit.layer === 'reference')) assert.equal((hit.tick - 480) % 960, 0);
    assert.equal(moment.reference.originTick, 0);
  }
  assert.ok(heard.length > 40);
  const before = instance.at(4799, p, plain(.6)), after = instance.at(4800, p, plain(.6));
  assert.deepEqual(before.reference, after.reference);
  assert.equal(before.layers[1].introducedAt, after.layers[1].introducedAt);
});

test('riff and response layers enter and retire separately over varied multi-bar horizons', () => {
  const schedules = new Set<string>();
  for (let index = 0; index < 20; index++) {
    const instance = new RhythmicScore(`layer-entry-${index}`, form, { displacement: 1, polymeter: 1 });
    const first = instance.at(0, p, plain(.94)), riff = first.layers[1], response = first.layers[2];
    assert.equal(first.layers.filter(layer => layer.active).length, 1);
    assert.ok(riff.introducedAt >= 1920 && response.introducedAt >= riff.introducedAt + 3840);
    assert.ok(response.retiresAt < riff.retiresAt && riff.retiresAt < first.reference.epochEndTick);
    const middle = instance.at(riff.introducedAt, p, plain(.94));
    assert.equal(middle.layers[1].active, true); assert.equal(middle.layers[2].active, false);
    if (response.introducedAt < response.retiresAt) assert.equal(instance.at(response.introducedAt, p, plain(.94)).layers[2].active, true);
    schedules.add(`${riff.introducedAt}:${response.introducedAt}:${first.reference.epochEndTick}`);
  }
  assert.ok(schedules.size >= 6, 'The same2/4/6-bar entry schedule is not imposed on every seed.');
});

test('generated source-group endings vary actual drum distributions without a pattern catalogue', () => {
  const shapes = new Map<string, string>(), fingerprints = new Set<string>();
  for (let index = 0; index < 60; index++) {
    const instance = new RhythmicScore(`ending-${index}`, form), first = instance.at(0, p, plain(.96));
    const ending = instance.at(first.endTick - first.cycleTicks, p, plain(.96));
    const fingerprint = [ending.kick, ending.snare, ending.hat].map(notes => notes.filter(n => n.role === 'fill').map(n => n.tick - ending.cycleStartTick).join(',')).join('|');
    shapes.set(ending.fillShape, fingerprint); fingerprints.add(fingerprint);
    assert.ok(ending.accents.filter(note => note.role === 'fill').length <= 14);
    assert.ok(!/relay|rising-answer|contracting|snare-roll|tom/.test(ending.fillShape));
    assert.ok(ending.accents.every(note => note.group !== undefined && note.level !== undefined));
  }
  assert.ok(shapes.size >= 2); assert.ok(fingerprints.size >= 12, 'Actual timing/instrument distributions, rather than five descriptive labels, vary across generated source cells.');
});

test('actual harmonic bass figures include native chord members between clear root anchors', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const divisions = TUNINGS[tuning].divisions;
    const rootDegree = Math.round((36 - 69) * divisions / 12);
    const root = degreeToPitch(tuning, rootDegree);
    const voices = [55, 60, 64, 67].map(midi => degreeToPitch(tuning, Math.round((midi - 69) * divisions / 12)));
    const harmony = { bass: root, voices }, mod = (value: number) => (value % divisions + divisions) % divisions;
    const pitchClasses = new Set([root, ...voices].map(pitch => mod(pitchToDegree(tuning, pitch))));
    const at = textureAt(.8), notes = grooveNotes(seed, 0, 15360, form, { ...p, bassMobility: .8 }, tuning,
      tuning === '12tet' ? 36 : rootDegree, tuning === '12tet' ? 55 : pitchToDegree(tuning, voices[0]),
      degree => tuning === '12tet' ? midiToPitch(degree) : degreeToPitch(tuning, degree),
      { composition: DEFAULT_COMPOSITION, textureAt: at, harmonyAt: () => harmony });
    const bass = notes.filter(note => note.part === 'bass');
    assert.ok(new Set(bass.map(note => mod(pitchToDegree(tuning, note.absolutePitch!)))).size >= 3,
      `${tuning}: bass should articulate the actual chord, not only octave copies of its root.`);
    for (const note of bass) {
      const degree = pitchToDegree(tuning, note.absolutePitch!);
      assert.ok(pitchClasses.has(mod(degree)));
      assert.ok(note.absolutePitch!.millicents >= 2800000 && note.absolutePitch!.millicents <= 5200000);
      assert.ok(voices[0].millicents - note.absolutePitch!.millicents >= 700000);
      assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, degree));
      if (note.expression?.role === 'anchor') assert.equal(mod(degree), mod(rootDegree));
    }
    assert.deepEqual(chordalBassPitch(harmony, tuning, { index: 2, count: 4, group: 2,
      iteration: 1, anchor: false, mobility: 0 }), root);
  }
});

test('source group boundaries are audible beneath the absolute quarter reference', () => {
  const oddForm = (tick: number): FormState => ({ ...form(tick), meter: { numerator: 7, denominator: 8 },
    barTicks: 1680, barStartTick: Math.floor(tick / 1680) * 1680, meterGroups: [3, 2, 2] });
  const instance = new RhythmicScore('grouped-pulse', oddForm);
  const moment = instance.at(0, p, plain(.65));
  for (const tick of [0, 720, 1200]) assert.ok(moment.kick.some(hit => hit.tick === tick && hit.strength >= .85));
  assert.deepEqual(moment.hat.filter(hit => hit.layer === 'reference').map(hit => hit.tick), [0, 480, 960, 1440]);
  assert.ok(moment.hat.filter(hit => hit.layer !== 'reference').every(hit => hit.strength < .5));
});

test('all native tunings use physical bass bounds and exact integer degree locations', () => {
  const at = textureAt(.8);
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    if (tuning === '12tet') continue;
    const divisions = TUNINGS[tuning].divisions, bass = Math.round((36 - 69) * divisions / 12), upper = Math.round((55 - 69) * divisions / 12);
    const notes = grooveNotes(seed, 0, 15360, form, p, tuning, bass, upper, degree => degreeToPitch(tuning, degree),
      { composition: DEFAULT_COMPOSITION, textureAt: at }).filter(note => note.part === 'bass');
    assert.ok(notes.length > 0);
    for (const note of notes) {
      assert.ok(note.absolutePitch!.millicents >= 2800000 && note.absolutePitch!.millicents <= 5200000);
      assert.ok(degreeToPitch(tuning, upper).millicents - note.absolutePitch!.millicents >= 700000);
      assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)));
      assert.equal(note.midiNote, undefined);
    }
  }
});

test('random domains are addressed: distant reads and a different realization order cannot alter a committed riff', () => {
  const a = score(), b = score(), texture = plain(.86);
  const expected = a.at(1920, p, texture);
  b.at(60000, p, texture); b.at(0, p, texture); b.at(5760, p, plain(.1));
  assert.deepEqual(b.at(1920, p, texture), expected);
  assert.throws(() => a.at(-1, p, texture), RangeError);
});
