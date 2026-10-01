import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_CONDUCTOR, formAt, type FormState } from '../src/conductor';
import { MusicEngine } from '../src/engine';
import { PhraseLayer } from '../src/engine/phrase';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING, restAppliesToNote } from '../src/phrasing';
import { degreeToPitch, midiToPitch, pitchToDegree, type TuningId } from '../src/pitch';
import { DEFAULT_SOUND } from '../src/spectrum';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import type { Frame, NoteEvent } from '../src/types';

const seed = 'heard-theme-connection';
const parameters = { ...DEFAULT_PARAMETERS, melodicActivity: .85, motifRecurrence: .85, tension: .35 };
const config = { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' as const },
  composition: { ...DEFAULT_COMPOSITION, embellishment: .8, dynamicRange: .8 } };

function occurrence(tuning: TuningId, harmonyShift = 0, quantum = 960) {
  const layer = new PhraseLayer(seed, config, 0);
  const form: FormState = { ...formAt(seed, 0, DEFAULT_CONDUCTOR), role: 'theme', sectionIndex: 0,
    themeId: 'theme-a', sectionStartTick: 0, sectionEndTick: 30720, phraseIndex: 0, phraseStartTick: 0, phraseEndTick: 7680,
    barStartTick: 0, beat: 1, bar: 0, barTicks: 1920, meter: { numerator: 4, denominator: 4 }, tuning, tonalOffsetCents: 0 };
  layer.begin(form, parameters);
  const snapshot = layer.snapshot()!, notes: NoteEvent[] = [];
  const project = (midi: number) => degreeToPitch(tuning, pitchToDegree(tuning, midiToPitch(midi)));
  for (let tick = snapshot.startTick; tick < snapshot.endTick; tick += quantum) {
    const upper = [55, 60, 64, 67].map(pitch => project(pitch + harmonyShift));
    notes.push(...layer.shape(layer.notes(tick, quantum, tuning, upper, project(36 + harmonyShift), false), tick, quantum, false));
  }
  return { layer, form, snapshot, notes };
}

test('the performed native thematic argument is independent of query batches and retains every declared structural pitch', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const coarse = occurrence(tuning), fine = occurrence(tuning, 0, 120);
    const performed = (notes: NoteEvent[]) => notes.filter(note => note.voice === 5).map(note => [note.tick, note.duration, note.absolutePitch, note.expression]);
    assert.deepEqual(performed(coarse.notes), performed(fine.notes));
    const declaredRoles = new Set(coarse.snapshot.themeCore!.notes.map(note => note.role));
    assert.ok(declaredRoles.has('head') && declaredRoles.has('continuation') && declaredRoles.has('cadence'),
      'The concise argument still contains a complete head, continuation and destination.');
    for (const declared of coarse.snapshot.themeCore!.notes) {
      const sounded = coarse.notes.find(note => note.tick === declared.startTick && note.expression?.sourceId === declared.sourceId);
      assert.ok(sounded, `The declared ${declared.role} must actually sound.`);
      assert.equal(sounded.absolutePitch!.millicents, Math.round(declared.absolutePitchCents * 1000));
      assert.equal(sounded.expression!.role, 'anchor');
    }
    for (const note of coarse.notes) assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)));
    if (tuning === '19edo') assert.ok(coarse.notes.some(note => note.absolutePitch!.millicents % 100000 !== 0));
  }
});

test('reharmonizing supports the same written melody instead of snapping individual notes to new chord guides', () => {
  for (const tuning of ['12tet', '19edo'] as const) {
    const first = occurrence(tuning), other = occurrence(tuning, 1);
    assert.deepEqual(first.snapshot.themeCore, other.snapshot.themeCore);
    const melody = (notes: NoteEvent[]) => notes.filter(note => note.voice === 5).map(note => [note.tick, note.absolutePitch, note.expression?.sourceId]);
    assert.deepEqual(melody(first.notes), melody(other.notes));
    const core = first.snapshot.themeCore!, final = core.notes.at(-1)!;
    assert.equal(final.role, 'cadence');
    assert.ok(core.notes.some(note => note.role === 'approach'));
    assert.ok(core.realization?.contour, 'A declared source contour need not invent an upper apex.');
  }
});

test('heard themes precede their remembered returns and development preserves the source head', () => {
  const first = occurrence('12tet'), start = first.snapshot.endTick;
  const remembered = first.layer.snapshot()!.ideas;
  assert.ok(remembered.some(idea => idea.id === 'theme-a' && idea.uses === 1));
  first.layer.begin({ ...first.form, role: 'return', sectionIndex: 1, sectionStartTick: start,
    sectionEndTick: start + 15360, phraseStartTick: start, phraseEndTick: start + 7680,
    barStartTick: start, phraseIndex: 2, bar: 8 }, parameters);
  const next = first.layer.snapshot()!;
  assert.equal(next.themeCore!.id, first.snapshot.themeCore!.id);
  assert.equal(next.themeCore!.occurrence, 1);
  const head = (snapshot: typeof next) => snapshot.themeCore!.notes.filter(note => note.role === 'head').map(note => [note.sourceId, note.degree]);
  assert.deepEqual(head(next), head(first.snapshot));
  assert.ok(next.relationship.includes('fixed thematic core'));
  assert.ok(next.ideas.every(idea => idea.uses > 0), 'Unheard catalogue entries are not presented as remembered performances.');
});

function performance(dressed: boolean): Frame[] {
  const engine = new MusicEngine({ seed: 'glass-garden', parameters: DEFAULT_PARAMETERS,
    // Idea density authors a different argument; pin it when comparing only
    // expressive delivery and orchestration around the same thematic source.
    automation: [{ parameter: 'ideaDensity', points: [{ tick: 0, value: .5, curve: 'step' }] }],
    sound: DEFAULT_SOUND, conductor: { ...DEFAULT_CONDUCTOR, tuningTravel: false }, phrasing: {
      ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' },
      composition: { ...DEFAULT_COMPOSITION, ...(dressed ? { embellishment: 1, dynamicRange: 1 }
        : { embellishment: 0, cohesion: 0, accent: 0, dynamicRange: 0 }) },
    } });
  return Array.from({ length: 130 }, () => engine.step());
}

test('integrated expressive delivery changes orchestration while every performed core remains literal', () => {
  const plain = performance(false), dressed = performance(true);
  const writtenHeads = (frames: Frame[]) => [...new Map(frames.map(frame => [frame.phrase!.startTick, frame.phrase!.themeCore!])).values()]
    .flatMap(core => core.notes.filter(note => note.role === 'head').map(note => [note.startTick, note.sourceId, note.absolutePitchCents]));
  assert.deepEqual(writtenHeads(dressed), writtenHeads(plain));
  assert.ok(writtenHeads(plain).length >= 30);
  let heard = 0;
  for (const frame of dressed) for (const note of frame.notes.filter(note => note.voice === 5 && note.expression?.role === 'anchor')) {
    const source = frame.phrase!.themeCore!.notes.find(source => source.startTick === note.tick && source.sourceId === note.expression!.sourceId);
    assert.ok(source); assert.equal(note.absolutePitch!.millicents, Math.round(source.absolutePitchCents * 1000)); heard++;
    assert.ok(frame.phrase!.rests.every(rest => !restAppliesToNote(note, rest) || note.tick < rest.startTick || note.tick >= rest.endTick));
  }
  assert.ok(heard > 100);
  assert.notDeepEqual(dressed.flatMap(frame => frame.notes).map(note => [note.tick, note.voice, note.velocity]),
    plain.flatMap(frame => frame.notes).map(note => [note.tick, note.voice, note.velocity]));
});
