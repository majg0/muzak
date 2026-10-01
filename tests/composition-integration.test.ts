import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { FRAME_TICKS, PPQ, type Frame, type NoteEvent } from '../src/types';

test('inspection cannot mutate the committed harmonic vocabulary through a returned frame', () => {
  const config = { seed: 'diagnostic-isolation', parameters: DEFAULT_PARAMETERS };
  const engine = new MusicEngine(config), control = new MusicEngine(config);
  const first = engine.step();
  assert.deepEqual(first, control.step());
  const plan = first.diagnostics.harmonicPlan!;
  assert.ok(plan.coverage && plan.tools && plan.evaluation);
  (plan.tools as string[]).push('not-a-tool');
  plan.coverage!.used.push('not-a-tool');
  plan.coverage!.eligible.length = 0;
  (plan.evaluation as Record<string, number>).melody = 1e9;
  assert.deepEqual(engine.step(), control.step());
});

function theme(arranged: boolean, repeat = false, ideaDensity = .5): Frame[] {
  const engine = new MusicEngine({ seed: repeat ? 'long-thought' : 'glass-garden', parameters: DEFAULT_PARAMETERS,
    automation: [
      { parameter: 'ideaDensity', points: [{ tick: 0, value: ideaDensity, curve: 'step' }] },
      { parameter: 'ensembleSize', points: [{ tick: 0, value: 1, curve: 'step' }] },
    ],
    conductor: { ...DEFAULT_CONDUCTOR, tuningTravel: false, ...(repeat ? { pace: 0 } : {}) },
    phrasing: { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' }, composition: { ...DEFAULT_COMPOSITION,
      ...(repeat ? { repetition: 1 } : {}), ...(arranged ? {} : { embellishment: 0, cohesion: 0, accent: 0, dynamicRange: 0 }) } },
  });
  const frames: Frame[] = [];
  let end: number | undefined;
  for (let index = 0; index < 384; index++) {
    const frame = engine.step();
    const form = frame.form!;
    if (form.role === 'theme' && end === undefined && (!repeat || form.sectionEndTick - form.sectionStartTick >= 24 * form.barTicks)) end = form.sectionEndTick;
    if (end !== undefined) frames.push(frame);
    if (end !== undefined && engine.tick >= end) return frames;
  }
  throw new Error('No complete theme within the bounded integration window.');
}

const core = (notes: NoteEvent[]) => notes.filter(note => note.id.startsWith('phrase:') && note.part === 'melody' && note.expression?.role === 'anchor');
const identity = (notes: NoteEvent[]) => core(notes).map(note => [note.tick, note.absolutePitch!.millicents, note.expression!.sourceId]);

test('orchestral delivery supports a complete protected tune instead of replacing its source material', () => {
  const plain = theme(false).flatMap(frame => frame.notes), arrangedFrames = theme(true), arranged = arrangedFrames.flatMap(frame => frame.notes);
  assert.ok(core(plain).length >= 12, 'The whole exposition contains a subject, continuation, apex and cadence.');
  assert.deepEqual(identity(arranged), identity(plain), 'Every authored onset, physical pitch and source survives different delivery.');
  assert.equal(plain.filter(note => note.expression?.role === 'ornament').length, 0);
  const snapshots = [...new Map(arrangedFrames.map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
  for (const phrase of snapshots) {
    const roles = new Set(phrase.themeCore!.notes.map(note => note.role));
    assert.ok(roles.has('head') && roles.has('continuation') && roles.has('cadence'));
    assert.ok(phrase.themeCore!.realization?.contour, 'The complete source has a declared contour, which need not include an upper crest.');
    for (const cue of phrase.composition!.cues) assert.ok(core(arranged).some(note => note.tick === cue.tick), 'Orchestral cues belong to actual thematic attacks.');
  }
  assert.notEqual(eventHash(arranged), eventHash(plain), 'Written performance changes without inventing another tune.');
  assert.ok(arranged.every(note => note.velocity > 0 && note.velocity <= 1));
});

test('a long theme repeats complete singing arguments while reserving its declared ending for the final answer', () => {
  const frames = theme(true, true), notes = frames.flatMap(frame => frame.notes);
  const phrases = [...new Map(frames.map(frame => [frame.phrase!.composition!.phraseId, frame.phrase!])).values()];
  assert.ok(phrases.length >= 3, 'Slow form provides room for complete thematic sentences.');
  const [first, second] = phrases;
  assert.equal(first.endTick - first.startTick, second.endTick - second.startTick);
  assert.ok(first.endTick - first.startTick >= 4 * FRAME_TICKS);
  assert.ok(first.endTick - first.startTick <= 16 * PPQ, 'A long episode repeats concise arguments rather than stretching each one across many bars.');
  assert.equal(first.composition!.sourcePhraseId, second.composition!.sourcePhraseId);
  assert.equal(first.composition!.cadence, 'open');
  assert.equal(second.composition!.cadence, 'open');
  assert.equal(phrases.at(-1)!.composition!.cadence, frames[0].form!.behavior!.ending);
  const take = (phrase: typeof first) => core(notes.filter(note => note.tick >= phrase.startTick && note.tick < phrase.endTick));
  const fingerprint = (phrase: typeof first) => take(phrase).map(note => [note.tick - phrase.startTick, note.absolutePitch!.millicents, note.expression!.sourceId]);
  assert.deepEqual(fingerprint(first), fingerprint(second), 'Reharmonization protects the complete source, not merely its first four notes.');
  assert.equal(take(first).length, first.themeCore!.notes.length);
  assert.ok(take(first).at(-1)!.duration >= 360, 'The complete thought gives its destination time to be heard.');
  assert.deepEqual(first.composition!.motifs.map(motif => motif.sourceId), second.composition!.motifs.map(motif => motif.sourceId));
  const ending = phrases.at(-1)!.themeCore!.notes.at(-1)!;
  assert.equal(ending.role, 'cadence');
  assert.ok(phrases.at(-1)!.composition!.cadence === 'closed' ? ending.degree === 0 : [2, 4].includes(((ending.degree % 7) + 7) % 7));
  const performance = (phrase: typeof first) => notes.filter(note => note.part === 'melody' && note.tick >= phrase.startTick && note.tick < phrase.endTick)
    .map(note => [note.tick - phrase.startTick, note.duration, note.velocity]);
  assert.notEqual(eventHash(performance(first)), eventHash(performance(second)), 'Repeated source material still receives the shared developing expression.');
});

test('sparse long themes tile their episode with concise complete arguments without truncating the source', () => {
  const frames = theme(true, true, 0), notes = frames.flatMap(frame => frame.notes);
  const phrases = [...new Map(frames.map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
  const form = frames[0].form!, first = phrases[0], last = phrases.at(-1)!;
  assert.ok(phrases.length >= 2);
  assert.equal(first.startTick, form.sectionStartTick);
  const denser = theme(true, true), denserFirst = denser[0].phrase!;
  assert.ok(first.endTick - first.startTick >= denserFirst.endTick - denserFirst.startTick);
  assert.ok(first.endTick - first.startTick <= denserFirst.endTick - denserFirst.startTick + PPQ + FRAME_TICKS,
    'Sparse delivery adds limited breathing room instead of arbitrarily stretching the thought.');
  assert.equal(last.endTick, form.sectionEndTick);
  assert.equal(first.composition!.cadence, 'open');
  assert.equal(last.composition!.cadence, form.behavior!.ending);
  for (let index = 0; index < phrases.length; index++) {
    const phrase = phrases[index], previous = phrases[index - 1];
    if (previous) assert.equal(previous.endTick, phrase.startTick, 'Complete arguments tile the section without truncating or overlapping a neighbor.');
    assert.ok(phrase.endTick - phrase.startTick >= 4 * FRAME_TICKS);
    assert.equal(phrase.themeCore!.realization!.kind, 'spacious');
    const played = core(notes.filter(note => note.tick >= phrase.startTick && note.tick < phrase.endTick));
    assert.equal(played.length, phrase.themeCore!.notes.length);
    for (const anchor of phrase.themeCore!.notes) assert.ok(played.some(note => note.tick === anchor.startTick
      && note.absolutePitch!.millicents === anchor.absolutePitchCents * 1000 && note.expression!.sourceId === anchor.sourceId), 'Every stretched or compressed source anchor is actually emitted.');
    assert.ok(played.every(note => note.tick + note.duration <= phrase.endTick));
  }
  const source = (phrase: typeof first) => phrase.themeCore!.notes.filter(note => !['cadence', 'approach'].includes(note.role))
    .map(note => [note.sourceId, note.absolutePitchCents]);
  assert.deepEqual(source(last), source(first), 'A shorter final span keeps the whole non-cadential argument; it does not invent a replacement tune.');
  assert.ok([2, 4].includes(((first.themeCore!.notes.at(-1)!.degree % 7) + 7) % 7));
  assert.ok(last.composition!.cadence === 'closed' ? last.themeCore!.notes.at(-1)!.degree === 0
    : [2, 4].includes(((last.themeCore!.notes.at(-1)!.degree % 7) + 7) % 7));
  assert.ok(core(notes.filter(note => note.tick < first.endTick)).at(-1)!.duration >= 360,
    'The spacious interpretation still holds its authored destination.');
});
