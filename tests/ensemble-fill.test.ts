import test from 'node:test';
import assert from 'node:assert/strict';
import { realizeEnsembleFills, type EnsembleFillContext } from '../src/engine/ensemble-fill';
import { planTransitions } from '../src/engine/transitions';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { degreeToPitch, midiToPitch, pitchToDegree, pitchToMidi } from '../src/pitch';
import type { NoteEvent } from '../src/types';

const p = { ...DEFAULT_PARAMETERS, rhythmicDensity: .9, rhythmicComplexity: .95, tension: .9, dynamics: .7 };
const upper = [55, 60, 64, 69].map((midi, voice): NoteEvent => ({ id: `upper:${voice}`, tick: 0, duration: 4800,
  part: 'harmony', voice, velocity: .65, absolutePitch: midiToPitch(midi) }));
const bass: NoteEvent = { id: 'bass-guide', tick: 0, duration: 600, absolutePitch: midiToPitch(38), part: 'bass', voice: 4, velocity: .7 };
const theme: NoteEvent = { id: 'protected-theme', tick: 2520, duration: 960, absolutePitch: midiToPitch(76), part: 'melody', voice: 5, velocity: .75, expression: { role: 'anchor', sourceId: 'whole-tune' } };
const plans = planTransitions('orchestral-arrival', [{ id: 'arrival', tick: 3840, kind: 'section' }], p, .95);
const context = (changes: Partial<EnsembleFillContext> = {}): EnsembleFillContext => ({ seed: 'orchestral-arrival', tick: 0, duration: 4800,
  plans, parameters: p, tuning: '12tet', additive: false, cohesion: 1, templates: upper, bassTemplate: bass, ...changes });
const input = () => [...upper, bass, theme, ...plans.flatMap(plan => plan.notes)];

test('a high-energy fill involves all four sections with shared accents and distinct internal roles', () => {
  const source = input(), before = structuredClone(source), result = realizeEnsembleFills(source, context());
  assert.deepEqual(source, before);
  const fill = result.notes.filter(note => note.id.startsWith('fill:'));
  assert.ok(fill.some(note => note.part === 'harmony') && fill.some(note => note.part === 'bass') && fill.some(note => note.part === 'melody'));
  const arrival = result.notes.filter(note => note.tick === 3840);
  assert.equal(new Set(arrival.map(note => note.part)).size, 4);
  assert.ok(result.fills.some(fill => fill.sharedTicks.includes(3840)));
  const rhythm = (part: NoteEvent['part']) => JSON.stringify(result.notes.filter(note => note.part === part && note.tick >= plans[0].startTick).map(note => note.tick));
  assert.equal(new Set(['harmony', 'bass', 'melody', 'percussion'].map(part => rhythm(part as NoteEvent['part']))).size, 4, 'Gathering does not copy the complete snare roll into every instrument.');
  assert.deepEqual(result.notes.find(note => note.id === theme.id), theme);
  assert.equal(result.notes.filter(note => note.part === 'harmony' && note.tick === 3840).length, 2);
});

test('quiet pickups stay sparse while intense fills build faster, with a real pre-arrival breath', () => {
  const quietP = { ...p, rhythmicDensity: .2, rhythmicComplexity: .2, tension: .15 };
  const quietPlans = planTransitions('orchestral-arrival', [{ id: 'arrival', tick: 3840, kind: 'section' }], quietP, .15);
  const quiet = realizeEnsembleFills([...upper, bass, theme, ...quietPlans.flatMap(plan => plan.notes)], context({ plans: quietPlans, parameters: quietP }));
  const intense = realizeEnsembleFills(input(), context());
  const added = (notes: NoteEvent[]) => notes.filter(note => note.id.startsWith('fill:'));
  assert.ok(added(intense.notes).length > added(quiet.notes).length * 3);
  const breath = plans[0].rests[0];
  assert.ok(added(intense.notes).every(note => note.tick < breath.startTick || note.tick >= breath.endTick));
  assert.ok(added(intense.notes).every(note => note.tick >= breath.endTick || note.tick + note.duration <= breath.startTick));
  assert.deepEqual(intense.rests, [], 'An orchestral fill does not insert a new gap into protected foreground statements.');
});

test('authored counter notes and previous-frame tails own their space before fill responses', () => {
  const counter = { ...theme, id: 'counter-theme', voice: 7, tick: 2700, duration: 1500 };
  const result = realizeEnsembleFills([...input(), counter], context({ previousVoiceEnds: new Map([[7, 2700]]) }));
  assert.deepEqual(result.notes.find(note => note.id === counter.id), counter);
  assert.ok(!result.notes.some(note => note.id.startsWith('fill:') && note.voice === 7 && note.tick < 4200));
  assert.deepEqual(result.notes.find(note => note.id === theme.id), theme);
});

test('upper pitches retain ordering and exact templates; 19-EDO approaches stay on their own native grid', () => {
  const nativeUpper = upper.map((note, voice) => ({ ...note, absolutePitch: degreeToPitch('19edo', -22 + voice * 7) }));
  const nativeBass = { ...bass, absolutePitch: degreeToPitch('19edo', -46) };
  const nativeTheme = { ...theme, absolutePitch: degreeToPitch('19edo', 8) };
  const result = realizeEnsembleFills([...nativeUpper, nativeBass, nativeTheme, ...plans[0].notes], context({ tuning: '19edo', templates: nativeUpper, bassTemplate: nativeBass }));
  const added = result.notes.filter(note => note.id.startsWith('fill:'));
  for (const note of added) {
    assert.ok(note.absolutePitch); assert.equal(note.midiNote, undefined);
    assert.deepEqual(degreeToPitch('19edo', pitchToDegree('19edo', note.absolutePitch)), note.absolutePitch);
    if (note.part === 'harmony') assert.deepEqual(note.absolutePitch, nativeUpper[note.voice].absolutePitch);
    if (note.part === 'bass') {
      assert.ok(pitchToMidi(note.absolutePitch) >= 28 && pitchToMidi(note.absolutePitch) <= 52);
      assert.ok(nativeUpper[0].absolutePitch.millicents - note.absolutePitch.millicents >= 700000);
    }
    if (note.part === 'melody') assert.ok(pitchToMidi(note.absolutePitch) >= 62 && pitchToMidi(note.absolutePitch) <= 91);
  }
});

test('fill melodies do not reserve an unknown next-frame entrance, and high bass targets keep the upper gap', () => {
  const near = planTransitions('short-frame', [{ id: 'nearby', tick: 960, kind: 'section' }], p, .95);
  const highBass = { ...bass, absolutePitch: midiToPitch(53) };
  const result = realizeEnsembleFills([...upper, theme, ...near[0].notes], context({ duration: 1000, plans: near, bassTemplate: highBass }));
  const melody = result.notes.filter(note => note.id.startsWith('fill:') && note.part === 'melody');
  assert.ok(melody.some(note => note.tick === 960));
  assert.ok(melody.every(note => note.tick + note.duration <= 1000));
  assert.ok(result.notes.filter(note => note.id.startsWith('fill:') && note.part === 'bass').every(note => note.absolutePitch!.millicents <= 4800000));
});

test('fills respect explicit rests and preserve additive spectra and tuning glides', () => {
  const source = input();
  assert.equal(realizeEnsembleFills(source, context({ additive: true })).notes, source);
  assert.equal(realizeEnsembleFills(source, context({ cohesion: 0 })).notes, source);
  const gliding = [...source, { ...upper[0], id: 'native-glide', endPitch: degreeToPitch('19edo', -20), glideTicks: 720 }];
  assert.equal(realizeEnsembleFills(gliding, context()).notes, gliding);
  const blocked = realizeEnsembleFills(source, context({ rests: [{ startTick: 0, endTick: 4800, scope: 'ensemble', reason: 'Written silence' }] }));
  assert.ok(!blocked.notes.some(note => note.id.startsWith('fill:')));
  const foreground = realizeEnsembleFills(source, context({ rests: [{ startTick: 0, endTick: 4800, scope: 'lead', voices: [5, 6, 7], reason: 'Lead breath' }] }));
  assert.ok(!foreground.notes.some(note => note.id.startsWith('fill:') && note.part === 'melody'));
  assert.ok(foreground.notes.some(note => note.id.startsWith('fill:') && note.part === 'harmony'));
});

test('replay and independently requested frames retain fill addresses and bounded event counts', () => {
  const source = input(), result = realizeEnsembleFills(source, context());
  assert.deepEqual(realizeEnsembleFills(source, context()), result);
  const parts = Array.from({ length: 5 }, (_, index) => {
    const tick = index * 960;
    return realizeEnsembleFills(source.filter(note => note.tick >= tick && note.tick < tick + 960), context({ tick, duration: 960, templates: source })).notes.filter(note => note.id.startsWith('fill:'));
  }).flat();
  assert.deepEqual(parts, result.notes.filter(note => note.id.startsWith('fill:')));
  assert.equal(new Set(result.notes.map(note => note.id)).size, result.notes.length);
  assert.ok(parts.length < 80);
  for (const note of parts) assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0 && note.velocity >= 0 && note.velocity <= 1);
});
