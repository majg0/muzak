import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateEnsemble, type EnsembleContext } from '../src/engine/ensemble';
import { DEFAULT_COMPOSITION, type StructuralCue } from '../src/composition';
import { degreeToPitch, midiToPitch } from '../src/pitch';
import type { NoteEvent } from '../src/types';

const cue: StructuralCue = { id: 'theme:question:crest', tick: 360, kind: 'arrival', strength: 1, leadVoice: 5 };
const pitched = (id: string, part: NoteEvent['part'], voice: number, tick: number, duration: number, midi: number): NoteEvent => ({
  id, part, voice, tick, duration, absolutePitch: midiToPitch(midi), velocity: .5,
});
const drum = (id: string, tick: number, midiNote: number): NoteEvent => ({ id, tick, duration: 90, midiNote, part: 'percussion', voice: 9, velocity: .4 });
const source = (): NoteEvent[] => [
  ...[55, 60, 64, 69].map((midi, voice) => pitched(`h${voice}`, 'harmony', voice, 0, 700, midi)),
  pitched('bass', 'bass', 4, 0, 680, 36), drum('kick', 0, 36), drum('snare', 480, 38), drum('hat1', 120, 42), drum('hat2', 720, 42),
  { ...pitched('theme-head', 'melody', 5, 360, 240, 76), expression: { role: 'anchor' } },
  { ...pitched('neighbor', 'melody', 5, 680, 90, 75), expression: { role: 'ornament' } },
];
const context = (overrides: Partial<EnsembleContext> = {}): EnsembleContext => ({ tick: 0, duration: 960, beatTicks: 480,
  cues: [cue], rests: [], additive: false, config: { ...DEFAULT_COMPOSITION, cohesion: 1 }, ...overrides });

test('an actual offbeat melodic arrival receives sparse simultaneous upper, bass and drum support', () => {
  const notes = source(), original = structuredClone(notes);
  const output = coordinateEnsemble(notes, context());
  const shared = output.filter(note => note.tick === cue.tick);
  assert.ok(shared.some(note => note.id === 'theme-head'));
  assert.equal(shared.filter(note => note.part === 'harmony').length, 2, 'support does not retrigger a four-note block');
  assert.ok(shared.some(note => note.part === 'bass'));
  assert.equal(shared.filter(note => note.part === 'percussion').length, 1);
  for (const note of shared.filter(note => note.part !== 'melody')) assert.deepEqual(note.expression, { role: 'support', sourceId: note.expression!.sourceId, cueId: cue.id });
  assert.deepEqual(notes, original, 'source arrays and events are immutable');
  const lead = output.filter(note => note.part === 'melody');
  assert.deepEqual(lead.map(({ id, tick, duration, absolutePitch }) => ({ id, tick, duration, absolutePitch })), notes.filter(note => note.part === 'melody').map(({ id, tick, duration, absolutePitch }) => ({ id, tick, duration, absolutePitch })));
});

test('togetherness, accent contrast, and larger dynamics are independent controls', () => {
  const notes = source();
  const none = { ...DEFAULT_COMPOSITION, cohesion: 0, accent: 0, dynamicRange: 0 };
  assert.strictEqual(coordinateEnsemble(notes, context({ config: none })), notes);
  const accented = coordinateEnsemble(notes, context({ config: { ...none, accent: 1 } }));
  assert.deepEqual(accented.map(note => note.id).sort(), notes.map(note => note.id).sort(), 'cohesion0 never inserts support');
  assert.ok(accented.find(note => note.id === 'theme-head')!.velocity > accented.find(note => note.id === 'neighbor')!.velocity * 1.7);
  const quiet = coordinateEnsemble(notes, context({ cues: [], intensity: .1, config: { ...none, dynamicRange: 1 } }));
  const loud = coordinateEnsemble(notes, context({ cues: [], intensity: .9, config: { ...none, dynamicRange: 1 } }));
  const average = (events: NoteEvent[]) => events.reduce((sum, note) => sum + note.velocity, 0) / events.length;
  assert.ok(average(loud) > average(quiet) * 1.8);
  assert.ok(average(quiet) > average(notes) * .5, 'A retreat remains audible rather than erasing the ensemble.');
  const coordinated = coordinateEnsemble(notes, context({ config: { ...none, cohesion: 1 } }));
  assert.ok(coordinated.some(note => note.expression?.cueId === cue.id));
  assert.equal(coordinated.find(note => note.id === 'neighbor')!.velocity, .5, 'coordination does not silently impose accent contrast');
});

test('calm punctuation leaves upper sweeps intact while bass and drums carry the shared accents', () => {
  const notes = source().map(note => note.part === 'harmony' ? { ...note, duration: 1920,
    gainEnvelope: [{ tick: 0, gain: .3 }, { tick: 960, gain: .8 }, { tick: 1920, gain: .35 }] } : note);
  const cues: StructuralCue[] = [120, 360, 600, 840].map((tick, i) => ({ ...cue, id: `sweep-cue-${i}`, tick,
    kind: i === 0 ? 'entry' : i === 3 ? 'arrival' : 'accent', strength: 1, ensemble: 'cell', sourceId: 'shared-thought' }));
  const result = coordinateEnsemble(notes, context({ cues, intensity: .2 }));
  const upperSupports = result.filter(note => note.part === 'harmony' && note.expression?.role === 'support');
  assert.deepEqual(upperSupports.map(note => note.tick), [120, 840]);
  assert.ok(upperSupports.every(note => note.voice === 0 && !note.gainEnvelope));
  for (const voice of [1, 2, 3]) assert.equal(result.find(note => note.id === `h${voice}`)!.duration, 1920);
  for (const cue of cues) assert.ok(result.some(note => note.part === 'bass' && note.expression?.cueId === cue.id));
});

test('an ensemble-carried short phrase retains its players across changing subdivision accents', () => {
  const cues: StructuralCue[] = [120, 360, 600, 840].map((tick, index) => ({ ...cue, id: `phrase-five:${index}`,
    tick, kind: index === 0 ? 'entry' : 'accent', ensemble: 'cell', sourceId: 'five-eighth-opening', strength: index % 2 ? .55 : .9 }));
  for (const seed of ['ensemble-one', 'ensemble-two', 'ensemble-three']) {
    const output = coordinateEnsemble(source(), context({ seed, cues, config: { ...DEFAULT_COMPOSITION, cohesion: .72 } }));
    const players = cues.map(cue => output.filter(note => note.expression?.cueId === cue.id && note.expression?.role === 'support').map(note => `${note.part}/${note.voice}`).sort());
    for (const player of players.slice(1)) assert.deepEqual(player, players[0]);
  }
});

test('independent pulse patterns and their pitches survive away from a cue', () => {
  const input = source(), config = { ...DEFAULT_COMPOSITION, cohesion: 1, accent: 0, dynamicRange: 0 };
  const result = coordinateEnsemble(input, context({ config }));
  for (const id of ['kick', 'snare', 'hat1', 'hat2']) assert.deepEqual(result.find(note => note.id === id), input.find(note => note.id === id));
  const collision = drum('competing-kick', cue.tick + 30, 36);
  const replaced = coordinateEnsemble([...input, collision], context({ config }));
  assert.ok(!replaced.some(note => note.id === collision.id));
  assert.equal(replaced.filter(note => note.part === 'percussion' && note.midiNote === 36 && Math.abs(note.tick - cue.tick) <= 60).length, 1);
});

test('reference templates retain the actual native bass and upper pitches even after accompaniment thinning', () => {
  const full = source().map(note => note.absolutePitch ? { ...note, absolutePitch: degreeToPitch('19edo', note.voice - 8), midiNote: undefined } : note);
  const bassTemplate = { ...pitched('independent-bass', 'bass', 4, 0, 700, 34), absolutePitch: degreeToPitch('19edo', -43), midiNote: undefined };
  const result = coordinateEnsemble(full.filter(note => note.part !== 'harmony' && note.part !== 'bass'), context({ templates: full.filter(note => note.part !== 'bass'), bassTemplate }));
  const support = result.filter(note => note.expression?.role === 'support');
  assert.deepEqual(support.find(note => note.part === 'bass')!.absolutePitch, bassTemplate.absolutePitch);
  for (const note of support.filter(note => note.part === 'harmony')) assert.deepEqual(note.absolutePitch, full.find(original => original.part === 'harmony' && original.voice === note.voice)!.absolutePitch);
  assert.ok(support.filter(note => note.absolutePitch).every(note => note.midiNote === undefined));
});

test('support is bounded to its frame, sparse under dense cues, duplicate-free and exactly reproducible', () => {
  const cues = Array.from({ length: 17 }, (_, index) => ({ ...cue, id: `detailed:${index % 4}`, tick: index * 60 }));
  const opts = context({ cues: [...cues, cues[6], { ...cue, id: 'past', tick: 1080 }] });
  const result = coordinateEnsemble(source(), opts);
  assert.deepEqual(result, coordinateEnsemble(source(), opts));
  assert.equal(new Set(result.map(note => note.id)).size, result.length);
  const added = result.filter(note => note.expression?.role === 'support');
  assert.ok(added.every(note => note.tick >= opts.tick && note.tick < opts.tick + opts.duration));
  assert.ok(new Set(added.map(note => note.tick)).size <= 4, 'at most one support pulse per half beat');
  assert.ok(added.length <= 16);
  for (const note of result) assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0 && note.velocity >= 0 && note.velocity <= 1);
});

test('written source rests suppress cue attacks and terminate glides at their physical intermediate pitch', () => {
  const from = midiToPitch(60), to = degreeToPitch('19edo', 4);
  const glide: NoteEvent = { ...pitched('glide', 'harmony', 0, 0, 800, 60), absolutePitch: from, endPitch: to, glideTicks: 800 };
  const result = coordinateEnsemble([glide, ...source().filter(note => note.part !== 'harmony')], context({
    rests: [{ startTick: 300, endTick: 500, scope: 'ensemble', reason: 'A shared breath.' }],
  }));
  assert.ok(!result.some(note => note.tick >= 300 && note.tick < 500));
  assert.ok(result.every(note => note.tick >= 500 || note.tick + note.duration <= 300));
  const clipped = result.find(note => note.id === 'glide')!;
  assert.equal(clipped.duration, 300);
  assert.equal(clipped.glideTicks, 300);
  assert.equal(clipped.endPitch!.millicents, Math.round(from.millicents + (to.millicents - from.millicents) * 300 / 800));
});

test('additive matching and active tuning excursions are not changed into a new pitched texture', () => {
  const input = source(), additive = coordinateEnsemble(input, context({ additive: true, intensity: .9 }));
  assert.deepEqual(additive.filter(note => note.part !== 'percussion').sort((a, b) => a.id < b.id ? -1 : 1), input.filter(note => note.part !== 'percussion').sort((a, b) => a.id < b.id ? -1 : 1));
  const gliding = input.map(note => note.part === 'harmony' ? { ...note, endPitch: degreeToPitch('19edo', note.voice), glideTicks: 700 } : note);
  const moved = coordinateEnsemble(gliding, context({ config: { ...DEFAULT_COMPOSITION, cohesion: 1, accent: 0, dynamicRange: 0 } }));
  assert.ok(!moved.some(note => note.expression?.role === 'support' && note.part !== 'percussion'));
  assert.deepEqual(moved.filter(note => note.part === 'harmony'), gliding.filter(note => note.part === 'harmony'));
});

test('release intervals respect scope and allow the next independent gesture to enter', () => {
  const input = source();
  const result = coordinateEnsemble(input, context({ cues: [{ id: 'shared-cut', tick: 600, endTick: 660, kind: 'release', strength: .8 }],
    config: { ...DEFAULT_COMPOSITION, cohesion: 1, accent: 0, dynamicRange: 0 } }));
  assert.ok(result.filter(note => note.tick < 600).every(note => note.tick + note.duration <= 600));
  assert.deepEqual(result.find(note => note.id === 'neighbor'), input.find(note => note.id === 'neighbor'));
  assert.deepEqual(result.find(note => note.id === 'hat2'), input.find(note => note.id === 'hat2'));
});
