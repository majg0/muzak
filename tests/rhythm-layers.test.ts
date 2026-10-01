import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { grooveLayersAt, grooveNotes, type GrooveContext } from '../src/engine/groove';
import { planTransitions } from '../src/engine/transitions';
import { degreeToPitch, midiToPitch, pitchToDegree } from '../src/pitch';
import { eventHash } from '../src/engine/random';
import { RhythmicScore } from '../src/engine/rhythmic-score';
import { expressiveContourAt } from '../src/engine/expression';
import { textureIntentAt, type TextureAt } from '../src/engine/texture';

const seed = 'persistent-pocket';
const initial = formAt(seed, 0, DEFAULT_CONDUCTOR);
const steadyForm = (tick: number): FormState => ({ ...initial, role: 'theme', themeId: 'theme-a', sectionIndex: 0, behavior: undefined,
  sectionStartTick: 0, sectionEndTick: 1920 * 128,
  meter: { numerator: 4, denominator: 4 }, barTicks: 1920, barStartTick: Math.floor(tick / 1920) * 1920,
  bar: Math.floor(tick / 1920), grooveId: 'same-groove', swing: 0, subdivisionTicks: 240 });
const p = { ...DEFAULT_PARAMETERS, rhythmicDensity: .7, rhythmicComplexity: .8, rhythmicPredictability: 1 };
const context: GrooveContext = { composition: { displacement: 1, polymeter: 1, transition: 0 } };
const generate = (tick: number, duration: number, options: GrooveContext | undefined = context, form = steadyForm) => grooveNotes(seed, tick, duration, form, p, '12tet', 36, 55, midiToPitch, options);

test('standalone groove inputs adapt to the same source score used by supplied rhythm', () => {
  const score = new RhythmicScore(seed, steadyForm, context.composition);
  const textureAt: TextureAt = tick => {
    const texture = textureIntentAt(p, steadyForm(tick), expressiveContourAt(seed, tick, steadyForm));
    return { ...texture, rhythm: score.at(tick, p, texture) };
  };
  const direct = generate(0, 1920 * 6, { ...context, textureAt });
  assert.deepEqual(generate(0, 1920 * 6), direct);
  assert.ok(direct.length > 0 && direct.every(note => note.id.startsWith('score:')));
  const moment = textureAt(1920).rhythm!;
  for (const layer of grooveLayersAt(1920, moment)) {
    const source = moment.layers.find(item => item.id === layer.id)!;
    assert.equal(layer.sourceId, source.sourceId);
    assert.equal(layer.active, source.active);
    assert.equal(layer.cycleStartTick, source.originTick + Math.floor((1920 - source.originTick) / source.cycleTicks) * source.cycleTicks);
    assert.equal(layer.cycleEndTick - layer.cycleStartTick, source.cycleTicks);
  }
});

test('frame partitioning and unrelated form queries do not alter persistent cycles', () => {
  const whole = generate(0, 1920 * 8);
  const partitioned = Array.from({ length: 16 }, (_, i) => generate(i * 960, 960)).flat();
  assert.deepEqual(partitioned, whole);
  for (let tick = 0; tick < 5000; tick += 73) formAt('other-seed', tick, DEFAULT_CONDUCTOR);
  assert.deepEqual(generate(0, 1920 * 8), whole);
  assert.equal(new Set(whole.map(note => note.id)).size, whole.length);
  assert.equal(new Set(whole.filter(note => note.part === 'percussion').map(note => `${note.tick}:${note.midiNote}`)).size, whole.filter(note => note.part === 'percussion').length);
});

test('a supplied score owns its silence even when it first appears inside the requested frame', () => {
  const score = new RhythmicScore(seed, steadyForm, context.composition);
  const textureAt: TextureAt = tick => {
    const texture = textureIntentAt(p, steadyForm(tick), expressiveContourAt(seed, tick, steadyForm));
    if (tick < 480) return texture;
    const rhythm = score.at(tick, p, texture);
    return { ...texture, rhythm: { ...rhythm, bass: [], kick: [], snare: [], hat: [] } };
  };
  const notes = generate(0, 1920, { ...context, textureAt });
  assert.ok(notes.length > 0 && notes.every(note => note.tick < 480),
    'The adapter must not layer a fallback generator over an explicitly empty score.');
  assert.deepEqual(generate(480, 1440, { ...context, textureAt }), []);
});

test('lead breaths leave the beat sounding, while explicit accompaniment or ensemble rests win', () => {
  const lead = { startTick: 0, endTick: 960, scope: 'lead' as const, voices: [5, 6, 7], reason: 'Foreground breath.' };
  assert.deepEqual(generate(0, 960, { ...context, rests: [lead] }), generate(0, 960));
  const silent = generate(0, 960, { ...context, rests: [{ ...lead, scope: 'ensemble', voices: undefined }] });
  assert.deepEqual(silent, []);
  const drumOnly = generate(0, 960, { ...context, rests: [{ ...lead, scope: 'accompaniment', voices: [9] }] });
  assert.ok(drumOnly.length > 0 && drumOnly.every(note => note.part === 'bass'));
});

test('bass stays native and in range; independent layers use only supported drum keys', () => {
  const notes = grooveNotes(seed, 0, 1920 * 5, steadyForm, { ...p, bassMobility: 1 }, '19edo', -50, -22, degree => degreeToPitch('19edo', degree), context);
  for (const note of notes) {
    assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0);
    assert.ok(note.velocity >= 0 && note.velocity <= 1);
    if (note.part === 'bass') {
      const degree = pitchToDegree('19edo', note.absolutePitch!);
      assert.ok(degree >= -65 && degree <= -33);
      assert.deepEqual(note.absolutePitch, degreeToPitch('19edo', degree));
      assert.equal(note.midiNote, undefined);
    } else assert.ok([36, 38, 42].includes(note.midiNote!));
  }
});

test('an omitted groove context uses the common deterministic score with default configuration', () => {
  const baseline = grooveNotes(seed, 0, 960, steadyForm, p, '12tet', 36, 55, midiToPitch);
  const disabled = generate(0, 960, { composition: { displacement: 0, polymeter: 0, transition: 0 } });
  assert.deepEqual([...disabled].sort((a, b) => a.id < b.id ? -1 : 1), [...baseline].sort((a, b) => a.id < b.id ? -1 : 1));
  assert.equal(eventHash(baseline), eventHash(grooveNotes(seed, 0, 960, steadyForm, p, '12tet', 36, 55, midiToPitch)));
  assert.ok(baseline.length > 0 && baseline.every(note => note.id.startsWith('score:')));
});

test('transition energy ranges from a sparse pickup through a directed sixteen/thirty-second roll', () => {
  const boundary = { id: 'next-scene', tick: 7680, kind: 'section' as const };
  const sparse = planTransitions(seed, [boundary], p, .05)[0], full = planTransitions(seed, [boundary], p, 1)[0];
  const pickups = sparse.notes.filter(note => note.tick < boundary.tick), roll = full.notes.filter(note => note.tick < boundary.tick);
  assert.equal(sparse.gesture, 'pickup'); assert.equal(full.gesture, 'roll');
  assert.equal(planTransitions(seed, [boundary], { ...p, rhythmicComplexity: .1 }, 1)[0].gesture, 'fill');
  assert.ok(pickups.length >= 1 && pickups.length <= 3);
  assert.ok(roll.length > pickups.length * 8);
  const half = (full.startTick + boundary.tick) / 2;
  assert.ok(roll.filter(note => note.tick >= half).length > roll.filter(note => note.tick < half).length * 2);
  assert.ok(roll.some((note, i) => i > 0 && note.tick - roll[i - 1].tick === 60));
  assert.ok(roll.some((note, i) => i > 0 && note.tick - roll[i - 1].tick === 120));
  assert.ok(roll.at(-1)!.velocity > roll[0].velocity * 1.6);
  assert.ok(full.notes.some(note => note.tick === boundary.tick && note.midiNote === 36));
  assert.equal(full.rests[0].endTick, boundary.tick);
  assert.ok(roll.every(note => note.tick + note.duration <= full.rests[0].startTick));
  assert.deepEqual(planTransitions(seed, [boundary], p, 0), []);
  assert.deepEqual(planTransitions(seed, [boundary], { ...p, rhythmicDensity: 0 }, 1), []);
});

test('known transition boundaries deduplicate, arbitrary ticks stay integer, and rests override the exact arrival', () => {
  const boundaries = [{ id: 'section', tick: 7681, kind: 'section' as const }, { id: 'tempo', tick: 7681, kind: 'tempo' as const }];
  const plans = planTransitions(seed, boundaries, p, 1);
  assert.equal(plans.length, 1); assert.equal(plans[0].kind, 'tempo');
  assert.deepEqual(plans, planTransitions(seed, [...boundaries].reverse(), p, 1));
  assert.ok(plans[0].notes.every(note => Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration)));
  const breath = plans[0].rests[0];
  const output = generate(6720, 1920, { ...context, transitionPlans: plans, rests: [{ startTick: 7681, endTick: 7801, scope: 'ensemble', reason: 'Explicit stop overrides arrival.' }] });
  assert.ok(output.every(note => note.tick < breath.startTick || note.tick >= 7801));
  assert.ok(output.filter(note => note.tick < breath.startTick).every(note => note.tick + note.duration <= breath.startTick));
  assert.ok(output.filter(note => note.id.startsWith('transition:')).every(note => note.tick >= 6720 && note.tick < 8640));
});
