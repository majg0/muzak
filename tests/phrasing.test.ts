import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, formAt, themeIds, type FormState } from '../src/conductor';
import { MusicEngine, eventHash } from '../src/engine';
import { PhraseLayer, clipPhraseRests, seedIdea } from '../src/engine/phrase';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING, MANUAL_PHRASING, restAppliesToNote, type PhraseRest } from '../src/phrasing';
import { degreeToPitch, midiToPitch, pitchToDegree } from '../src/pitch';
import { FRAME_TICKS, type NoteEvent } from '../src/types';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_HARMONY } from '../src/harmonic-language';

const seed = 'glass-garden';
const config = { seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING };
function form(start = 0, sectionEnd = 30720): FormState {
  return { ...formAt(seed, start, DEFAULT_CONDUCTOR), role: 'theme', themeId: 'theme-a', sectionIndex: 0,
    sectionStartTick: 0, sectionEndTick: sectionEnd, phraseIndex: Math.floor(start / 7680), phraseStartTick: start,
    phraseEndTick: start + 7680, barStartTick: start, beat: 1, bar: Math.floor(start / 1920), barTicks: 1920,
    meter: { numerator: 4, denominator: 4 }, tuning: '12tet',
    behavior: { ...formAt(seed, start, DEFAULT_CONDUCTOR).behavior!, ending: 'closed' } };
}
const phraseNotes = (layer: PhraseLayer, start: number, duration: number) => layer.notes(start, duration, '12tet',
  [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);

test('all recipe flags enter the same deterministic thematic composition pipeline', () => {
  const a = new MusicEngine(config), b = new MusicEngine(config);
  for (let i = 0; i < 100; i++) {
    const frame = a.step(); assert.deepEqual(frame, b.step());
    assert.ok(frame.form && frame.phrase?.themeCore && frame.phrase.composition);
  }
  for (const conductor of [undefined, DEFAULT_CONDUCTOR]) {
    const old = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor, phrasing: MANUAL_PHRASING });
    const explicit = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor,
      phrasing: { ...MANUAL_PHRASING, enabled: true, character: 'lyrical' } });
    for (let i = 0; i < 20; i++) assert.deepEqual(old.step(), explicit.step());
  }
});

test('memory sources are the same composed families that own the performed argument', () => {
  const fingerprints = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const idea = seedIdea(`source-${i}`, 'theme-a');
    assert.ok(idea.cents.length >= 9 && idea.cents.length <= 26);
    assert.equal(idea.cents.length, idea.positions.length);
    assert.equal(idea.cents.at(-1), 0);
    assert.ok(idea.positions.every((value, index) => index === 0 || value > idea.positions[index - 1]));
    fingerprints.add(eventHash([idea.cents, idea.positions]));
  }
  assert.ok(fingerprints.size >= 25);
  const families = themeIds(seed).map(id => seedIdea(seed, id));
  assert.equal(new Set(families.map(idea => idea.lineage)).size, themeIds(seed).length);
  assert.ok(families.every(idea => idea.uses === 0 && idea.answerCents.at(-1) === 0));
});

test('whole thoughts remain frozen across atomic windows and distinguish inner questions from final closure', () => {
  const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' } }, 0);
  const episode = form();
  layer.begin(episode, DEFAULT_PARAMETERS);
  const first = layer.snapshot()!;
  assert.ok(first.endTick - first.startTick >= 4 * FRAME_TICKS && first.endTick < episode.sectionEndTick);
  assert.equal(first.composition!.cadence, 'open');
  assert.ok([2, 4].includes(((first.themeCore!.notes.at(-1)!.degree % 7) + 7) % 7));
  layer.begin(form(first.startTick + FRAME_TICKS), { ...DEFAULT_PARAMETERS, melodicActivity: 0, dynamics: 0 });
  assert.deepEqual(layer.snapshot(), first, 'An atomic window does not rewrite the argument being played.');
  assert.ok(layer.musicalCadenceAt(first.endTick - 120)!.strength < .35);
  let final = first;
  while (final.endTick < episode.sectionEndTick) {
    assert.equal(final.composition!.cadence, 'open', 'Interior thoughts preserve an unfinished question.');
    layer.begin(form(final.endTick), DEFAULT_PARAMETERS);
    const next = layer.snapshot()!;
    assert.equal(next.startTick, final.endTick);
    final = next;
  }
  assert.equal(final.composition!.sourcePhraseId, first.composition!.sourcePhraseId);
  assert.equal(final.composition!.cadence, 'closed');
  assert.equal(final.themeCore!.notes.at(-1)!.degree, 0);
  assert.ok(layer.musicalCadenceAt(final.endTick - 120)!.strength > .9);
  assert.equal(layer.plannedUntilTick, final.endTick);
  assert.equal(layer.lyricalContextAt(final.endTick), undefined);
});

test('previewing does not claim an unheard theme, and remembered derivatives come from actual emitted anchors', () => {
  const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, renewal: 1,
    composition: { ...DEFAULT_COMPOSITION, embellishment: 0 } }, 0);
  layer.begin(form(), DEFAULT_PARAMETERS);
  const before = layer.snapshot()!;
  assert.deepEqual(before.ideas, []);
  const notes = phraseNotes(layer, 0, before.endTick);
  layer.previewBacking(notes, 0, before.endTick, false);
  assert.deepEqual(layer.snapshot(), before);
  layer.shape(notes, 0, before.endTick, false);
  assert.equal(layer.snapshot()!.ideas.find(idea => idea.id === 'theme-a')!.uses, 1);
  layer.begin(form(before.endTick), DEFAULT_PARAMETERS);
  const learned = layer.motifs('12tet').find(idea => idea.id.startsWith('heard-'))!;
  assert.ok(learned);
  const anchors = notes.filter(note => note.expression?.role === 'anchor');
  assert.deepEqual(learned.intervals, anchors.map((note, i) => i ?
    Math.round((note.absolutePitch!.millicents - anchors[i - 1].absolutePitch!.millicents) / 100000) : 0));
  assert.equal(learned.born, 0);
  assert.equal(learned.lastRecalled, Math.floor(anchors.at(-1)!.tick / 960));
});

test('scoped breaths clip actual event tails, gain curves and partial glides without silencing independent parts', () => {
  const note = (voice: number, part: NoteEvent['part']): NoteEvent => ({ id: `held-${voice}`, tick: 0, duration: 960,
    absolutePitch: midiToPitch(60), endPitch: midiToPitch(64), glideTicks: 960, part, voice, velocity: .6,
    gainEnvelope: [{ tick: 0, gain: .5 }, { tick: 960, gain: 1 }] });
  const source = [note(0, 'harmony'), note(4, 'bass'), note(5, 'melody'), note(8, 'melody')];
  const lead: PhraseRest = { startTick: 480, endTick: 720, scope: 'lead', voices: [5, 6, 7], reason: 'The subject breathes.' };
  const clipped = clipPhraseRests(source, [lead], 1200);
  assert.equal(clipped.find(note => note.voice === 5)!.duration, 480);
  assert.equal(clipped.find(note => note.voice === 8)!.duration, 960);
  const solo = clipped.find(note => note.voice === 5)!;
  assert.equal(solo.endPitch!.millicents, 6200000);
  assert.equal(solo.glideTicks, 480);
  assert.equal(solo.gainEnvelope!.at(-1)!.tick, 480);
  assert.equal(clipPhraseRests([{ ...source[2], tick: 500 }], [lead], 1200).length, 0);
  const all = clipPhraseRests(source, [{ ...lead, scope: 'ensemble', voices: undefined }], 1200);
  assert.ok(all.every(note => note.duration === 480));
  assert.ok(source.every(note => note.duration === 960), 'Clipping never mutates a committed source.');
});

test('native played anchors, structural targets and hierarchy remain truthful through longer forms and tuning travel', () => {
  const engine = new MusicEngine({ ...config, phrasing: { ...DEFAULT_PHRASING, renewal: 1 } });
  const frames = Array.from({ length: 400 }, () => engine.step());
  const notes = frames.flatMap(frame => frame.notes), plans = [...new Map(frames.map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
  assert.ok(frames.some(frame => frame.sound.tuning === '19edo' && frame.notes.some(note => note.voice === 5)));
  assert.ok(new Set(plans.map(plan => plan.themeCore!.id)).size >= 3);
  for (const frame of frames) {
    assert.ok(frame.phrase!.ideas.length <= 18);
    for (const note of frame.notes.filter(note => note.id.startsWith('phrase:'))) {
      assert.ok(note.tick >= frame.tick && note.tick < frame.tick + frame.duration);
      assert.ok(note.tick + note.duration <= frame.phrase!.endTick);
      assert.deepEqual(note.absolutePitch, degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, note.absolutePitch!)));
      if (note.expression!.role === 'anchor') {
        const declared = frame.phrase!.themeCore!.notes.find(source => source.startTick === note.tick && source.sourceId === note.expression!.sourceId)!;
        assert.ok(declared);
        assert.equal(note.absolutePitch!.millicents, Math.round(declared.absolutePitchCents * 1000));
      }
    }
  }
  for (const plan of plans.filter(plan => plan.endTick <= engine.tick)) {
    const actual = notes.filter(note => note.id.startsWith('phrase:') && note.expression?.role === 'anchor' && note.tick >= plan.startTick && note.tick < plan.endTick);
    assert.equal(actual.length, plan.themeCore!.notes.length);
    for (const cell of plan.composition!.shortPhrases!) assert.equal(actual.filter(note => note.tick >= cell.startTick && note.tick < cell.endTick).length, cell.coreNotes);
    for (const rest of plan.rests) { const overlap = notes.find(note => restAppliesToNote(note, rest) && note.tick < rest.endTick && note.tick + note.duration > rest.startTick); assert.ok(!overlap, JSON.stringify({ rest, overlap })); }
  }
  assert.ok(plans.some(plan => plan.ideas.some(idea => idea.id.startsWith('heard-'))));
});

// Discrete melody, rhythm and harmonic-planning libraries have their own unit
// suites. The live PhraseLayer intentionally has one protected source contract;
// none of these integration checks select a random solo or a disabled path.
