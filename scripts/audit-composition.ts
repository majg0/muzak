import assert from 'node:assert/strict';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { restAppliesToNote } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import type { Frame, NoteEvent } from '../src/types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const signature = (notes: NoteEvent[], start: number) => notes.map(note => [
  note.tick - start, note.absolutePitch ? note.absolutePitch.millicents % 1200000 : null, note.expression?.sourceId,
]);

for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
  const config = { seed, parameters: DEFAULT_PARAMETERS,
    conductor: { ...DEFAULT_CONDUCTOR, pace: 0, tuningTravel: false },
    phrasing: { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION, repetition: 1, embellishment: .8 } },
  };
  const engine = new MusicEngine(config), frames: Frame[] = [];
  const started = performance.now();
  while (frames.length < 800) {
    const frame = engine.step();
    if (frame.form!.cycle >= 1) break;
    frames.push(frame);
  }
  const msPerFrame = (performance.now() - started) / frames.length;
  const notes = frames.flatMap(frame => frame.notes);
  const phrases = [...new Map(frames.filter(frame => frame.phrase?.composition)
    .map(frame => [frame.phrase!.composition!.phraseId, frame])).values()];
  const complete = phrases.filter(frame => frame.phrase!.endTick <= frames.at(-1)!.tick + frames.at(-1)!.duration);
  const groups = new Map<string, typeof complete>();
  for (const frame of complete) {
    // Compare genuine restatements in one tonal/meter context with the same
    // cadential function. A final closing variant intentionally changes pitch.
    const key = `${frame.form!.sectionIndex}/${frame.phrase!.composition!.sourcePhraseId}/${frame.phrase!.composition!.cadence}/${frame.phrase!.endTick - frame.phrase!.startTick}`;
    groups.set(key, [...(groups.get(key) ?? []), frame]);
  }
  const recurrence = [...groups.values()].filter(group => group.length > 1).map(group => {
    const takes = group.map(frame => {
      const phrase = frame.phrase!;
      const selected = notes.filter(note => note.part === 'melody' && note.tick >= phrase.startTick && note.tick < phrase.endTick);
      const core = selected.filter(note => note.expression?.role === 'anchor');
      return { source: phrase.composition!.sourcePhraseId,
        core: eventHash(signature(core, phrase.startTick)),
        performance: eventHash(selected.map(note => [note.tick - phrase.startTick, note.absolutePitch?.millicents, note.duration, note.velocity])),
        ornaments: selected.filter(note => note.expression?.role === 'ornament').length };
    });
    return { section: group[0].form!.sectionIndex, source: takes[0].source, performances: takes.length,
      corePitchClassAndRhythmVersions: new Set(takes.map(take => take.core)).size,
      realizations: new Set(takes.map(take => take.performance)).size,
      ornaments: takes.reduce((sum, take) => sum + take.ornaments, 0) };
  });
  const cues = [...new Map(complete.flatMap(frame => frame.phrase!.composition!.cues.map(cue => [cue.id, cue] as const))).values()];
  const agreements = cues.filter(cue => ['entry', 'accent', 'arrival'].includes(cue.kind)).map(cue => {
    const attacks = notes.filter(note => note.tick === cue.tick);
    return { id: cue.id, parts: new Set(attacks.map(note => note.part)).size,
      lead: attacks.some(note => note.part === 'melody'),
      explicitSupport: attacks.filter(note => note.expression?.cueId === cue.id && note.expression.role === 'support').length };
  });
  const velocities = (role: string) => notes.filter(note => note.part === 'melody' && note.expression?.role === role).map(note => note.velocity);
  const spans = complete.map(frame => (frame.phrase!.endTick - frame.phrase!.startTick) / frame.form!.barTicks);
  const rests = complete.flatMap(frame => frame.phrase!.rests);
  const violations = rests.flatMap(rest => notes.filter(note =>
    restAppliesToNote(note, rest)
    && note.tick < rest.endTick && note.tick + note.duration > rest.startTick));
  assert.equal(violations.length, 0, `${seed}: composed rests must remain clear`);
  assert.ok(notes.every(note => Number.isFinite(note.velocity) && note.velocity > 0 && note.velocity <= 1));
  assert.ok(complete.length && complete.every(frame => frame.phrase!.startTick % 960 === 0 && frame.phrase!.endTick % 960 === 0));
  console.log(JSON.stringify({ seed, frames: frames.length, millisecondsPerFrame: rounded(msPerFrame),
    phraseBars: [...new Set(spans)], longestPhraseBars: Math.max(...spans),
    sourcePhrases: new Set(complete.map(frame => frame.phrase!.composition!.sourcePhraseId)).size, actualPhrases: complete.length, recurrence,
    openInnerEndings: complete.filter(frame => frame.phrase!.composition!.cadence === 'open').length,
    soloBars: complete.filter(frame => frame.phrase!.leadRole === 'solo').map(frame => (frame.phrase!.endTick - frame.phrase!.startTick) / frame.form!.barTicks),
    cueCount: agreements.length, agreementsAcrossThreeParts: agreements.filter(cue => cue.lead && cue.parts >= 3).length,
    meanAnchorVelocity: rounded(mean(velocities('anchor'))), meanOrnamentVelocity: rounded(mean(velocities('ornament'))),
    ornamentNotes: velocities('ornament').length, pauseViolations: violations.length, hash: eventHash(notes) }));
}
