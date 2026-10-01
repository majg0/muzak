import { renderOffline } from './audio';
import { MusicEngine, eventHash } from './engine';
import { lyricalPerformance } from './lyrical';
import { createPerformance } from './serialization';
import { degreeToPitch, pitchToDegree, pitchToMidi } from './pitch';
import { seedIdea } from './engine/phrase';
import { planLyricalSentence } from './engine/lyrical';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent, type Performance } from './types';
import type { PhraseSnapshot } from './phrasing';

const tidy = (value: number) => Math.round(value * 1e8) / 1e8;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const lead = (note: NoteEvent) => note.part === 'melody' && (note.voice === 5 || note.voice === 6);

function clockFor(frames: Frame[]) {
  let time = 0;
  const segments = frames.map(frame => {
    const result = { tick: frame.tick, time, seconds: 60 / frame.parameters.tempo / PPQ };
    time += frame.duration * result.seconds;
    return result;
  });
  return (tick: number) => {
    let low = 0, high = segments.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (segments[middle].tick <= tick) low = middle; else high = middle - 1; }
    const segment = segments[low];
    return segment.time + (tick - segment.tick) * segment.seconds;
  };
}

function rms(buffer: AudioBuffer, from: number, to: number) {
  const a = Math.max(0, Math.floor(from * buffer.sampleRate)), b = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate));
  if (b <= a) return 0;
  let squares = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = a; i < b; i++) squares += data[i] * data[i];
  }
  return Math.sqrt(squares / ((b - a) * buffer.numberOfChannels));
}

function signal(buffer: AudioBuffer, from: number, to: number) {
  let finiteSamples = 0, clippedSamples = 0, peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const value of buffer.getChannelData(channel)) {
    if (!Number.isFinite(value)) continue;
    finiteSamples++; peak = Math.max(peak, Math.abs(value));
    if (Math.abs(value) >= .999) clippedSamples++;
  }
  return { rms: tidy(rms(buffer, from, to)), peak: tidy(peak), clippedSamples,
    nonFiniteSamples: buffer.length * buffer.numberOfChannels - finiteSamples, renderedSeconds: tidy(buffer.duration) };
}

/** Physical note/tick measurements; none is a proxy for whether a tune is good. */
export function lyricalScoreSummary(frames: Frame[], startTick: number, endTick: number) {
  const notes = frames.flatMap(frame => frame.notes).filter(note => lead(note) && note.tick >= startTick && note.tick < endTick)
    .sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  const pitches = notes.flatMap(note => note.absolutePitch ? [pitchToMidi(note.absolutePitch)] : []);
  const intervals = notes.slice(1).flatMap((note, index) => note.absolutePitch && notes[index].absolutePitch
    ? [(note.absolutePitch.millicents - notes[index].absolutePitch!.millicents) / 1000] : []);
  const spacings = notes.slice(1).map((note, index) => (note.tick - notes[index].tick) / PPQ);
  const gates = notes.map(note => note.duration / PPQ);
  const gaps = notes.slice(1).map((note, index) => Math.max(0, note.tick - notes[index].tick - notes[index].duration) / PPQ);
  return { notes: notes.length, eventHash: eventHash(notes), pitchRangeMidi: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : [],
    rangeCents: pitches.length ? tidy((Math.max(...pitches) - Math.min(...pitches)) * 100) : 0,
    meanAbsoluteIntervalCents: tidy(mean(intervals.map(Math.abs))), stepwiseFraction: tidy(intervals.filter(interval => Math.abs(interval) <= 200.001).length / Math.max(1, intervals.length)),
    leapsAtLeastFifth: intervals.filter(interval => Math.abs(interval) >= 699.999).length,
    medianOnsetSpacingBeats: tidy(median(spacings)), meanOnsetSpacingBeats: tidy(mean(spacings)),
    medianGateBeats: tidy(median(gates)), notesAtLeastOneBeat: gates.filter(gate => gate >= 1).length,
    longestGateBeats: tidy(Math.max(0, ...gates)), connectedBoundaries: gaps.filter(gap => gap === 0).length,
    writtenBreaths: gaps.filter(gap => gap > 0).length, longestBreathBeats: tidy(Math.max(0, ...gaps)),
    articulationCounts: Object.fromEntries(['sustained', 'connected', 'detached', 'unspecified'].map(kind => [kind, notes.filter(note => (note.articulation ?? 'unspecified') === kind).length])),
    timbres: [...new Set(notes.map(note => note.timbre ?? 'default'))],
    cadenceNote: notes.length ? { tick: notes.at(-1)!.tick, durationBeats: tidy(notes.at(-1)!.duration / PPQ),
      midiPitch: notes.at(-1)!.absolutePitch ? pitchToMidi(notes.at(-1)!.absolutePitch!) : null,
      sourceId: notes.at(-1)!.expression?.sourceId ?? null } : null };
}

/** An inner sentence may intentionally stay open. The audition's complete
 * argument continues through the first explicitly closed sentence. */
export function selectLyricalArgument(frames: Frame[]) {
  let first: PhraseSnapshot | undefined, contextBar = PPQ * 4;
  const sentences: PhraseSnapshot[] = [];
  for (const frame of frames) {
    const snapshot = frame.phrase;
    if (!snapshot?.cells.some(cell => cell.role === 'theme' && cell.label.startsWith('Question'))) continue;
    if (!first) {
      if (frame.form?.role !== 'theme') continue;
      first = snapshot; contextBar = frame.form.barTicks;
    }
    if (snapshot.startTick < first.startTick || sentences.some(sentence => sentence.startTick === snapshot.startTick)) continue;
    sentences.push(snapshot);
    if (snapshot.composition?.cadence === 'closed') return { first, last: snapshot, sentences, contextBar };
  }
  return undefined;
}

/** Compare the heard endpoint with the authored native interval from the
 * heard opening. This handles a head beginning on degree2, transposition and
 * octave placement without assuming its first note is the tonic. */
export function lyricalCadenceMeasurements(frames: Frame[], recipe: Performance, sentences: PhraseSnapshot[]) {
  return sentences.map(sentence => {
    const openingFrame = frames.find(frame => frame.phrase?.startTick === sentence.startTick)!;
    const form = openingFrame.form!, cadence = sentence.composition!.cadence;
    if (sentence.themeCore) {
      const authored = sentence.themeCore.notes, start = authored[0], finish = authored.at(-1)!;
      const notes = frames.flatMap(frame => frame.notes).filter(note => lead(note) && note.tick >= sentence.startTick && note.tick < sentence.endTick)
        .sort((a, b) => a.tick - b.tick || a.voice - b.voice);
      const last = notes.at(-1), expected = { millicents: Math.round(finish.absolutePitchCents * 1000) };
      const error = last?.absolutePitch ? Math.abs(last.absolutePitch.millicents - expected.millicents) / 1000 : null;
      return { startTick: sentence.startTick, endTick: sentence.endTick, cadence,
        label: cadence === 'open' ? 'Open inner sentence · continuation expected' : 'Closed sentence · thematic arrival',
        plannedOpeningDegree: start.degree, plannedEndingDegree: finish.degree,
        actualFinalMidi: last?.absolutePitch ? pitchToMidi(last.absolutePitch) : null,
        expectedFinalMidi: pitchToMidi(expected), errorCents: error,
        heldFinalBeats: last ? tidy(last.duration / PPQ) : null, plannedFinalBeats: tidy((finish.endTick - finish.startTick) / PPQ),
        matchesAuthoredEnding: error !== null && error <= .002 };
    }
    const planned = planLyricalSentence({ seed: recipe.seed, themeId: form.themeId,
      occurrence: form.role === 'return' ? 0 : sentence.composition!.iteration,
      startTick: sentence.startTick, endTick: sentence.endTick, barTicks: form.barTicks, beatTicks: PPQ * 4 / form.meter.denominator,
      tuning: form.tuning, third: seedIdea(recipe.seed, form.themeId).third, parameters: openingFrame.parameters, cadence });
    const notes = frames.flatMap(frame => frame.notes).filter(note => lead(note) && note.tick >= sentence.startTick && note.tick < sentence.endTick)
      .sort((a, b) => a.tick - b.tick || a.voice - b.voice);
    const first = notes[0], last = notes.at(-1), start = planned.notes[0], finish = planned.notes.at(-1)!;
    const expected = first?.absolutePitch ? degreeToPitch(form.tuning, pitchToDegree(form.tuning,
      { millicents: Math.round(first.absolutePitch.millicents + (finish.cents - start.cents) * 1000) })) : undefined;
    const error = expected && last?.absolutePitch ? Math.abs(last.absolutePitch.millicents - expected.millicents) / 1000 : null;
    return { startTick: sentence.startTick, endTick: sentence.endTick, cadence,
      label: cadence === 'open' ? 'Open inner sentence · continuation expected' : 'Closed sentence · home arrival',
      plannedOpeningDegree: start.degree, plannedEndingDegree: finish.degree,
      actualFinalMidi: last?.absolutePitch ? pitchToMidi(last.absolutePitch) : null,
      expectedFinalMidi: expected ? pitchToMidi(expected) : null, errorCents: error,
      heldFinalBeats: last ? tidy(last.duration / PPQ) : null, plannedFinalBeats: tidy(finish.duration / PPQ), matchesAuthoredEnding: error !== null && error <= .002 };
  });
}

/** Generate the real recipe through one complete lyrical question/answer and
 * render only its bounded context as mix, lead and backing. No note is changed
 * to make the audition look or sound more favorable. */
export async function auditLyricalTheme(options: {
  seed?: string;
  performance?: Performance;
  onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
} = {}) {
  const seed = options.seed ?? options.performance?.seed ?? 'glass-garden';
  const recipe = structuredClone(options.performance ?? lyricalPerformance(createPerformance(seed), seed).recipe);
  if (recipe.phrasing?.character !== 'lyrical') throw new Error('This audition requires the explicit lyrical performance recipe.');
  const engine = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters, automation: recipe.automation,
    automationRevisions: recipe.automationRevisions, weights: recipe.weights, sound: recipe.sound, conductor: recipe.conductor, phrasing: recipe.phrasing });
  const generated: Frame[] = [];
  let argument: ReturnType<typeof selectLyricalArgument>;
  options.onProgress?.('Generating the production lyrical score through its first complete theme');
  for (let index = 0; index < 320; index++) {
    const frame = engine.step(); generated.push(frame);
    argument ??= selectLyricalArgument(generated);
    if (argument && frame.tick + frame.duration >= argument.last.endTick + argument.contextBar) break;
    if (index % 8 === 7) {
      options.onProgress?.(`Composing complete lyrical theme · ${index + 1} frames`);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  if (!argument || generated.at(-1)!.tick + generated.at(-1)!.duration < argument.last.endTick) throw new Error('No complete lyrical argument through a closed cadence was found within the 320-frame audit limit.');
  const { first: chosen, last: closing, sentences, contextBar } = argument;
  const endTick = closing.endTick;
  const frames = generated.filter(frame => frame.tick + frame.duration > Math.max(0, chosen.startTick - contextBar) && frame.tick < endTick + contextBar);
  const clock = clockFor(frames), pieceClock = clockFor(generated);
  const from = clock(chosen.startTick), to = clock(endTick);
  const passage = frames.flatMap(frame => frame.notes).filter(note => lead(note) && note.tick >= chosen.startTick && note.tick < endTick)
    .sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  const score = lyricalScoreSummary(frames, chosen.startTick, endTick);
  const cadences = lyricalCadenceMeasurements(frames, recipe, sentences);
  const buffers = {} as Record<'mix' | 'melody' | 'backing', AudioBuffer>;
  const signals = {} as Record<keyof typeof buffers, ReturnType<typeof signal>>;
  for (const kind of ['mix', 'melody', 'backing'] as const) {
    options.onProgress?.(`Rendering the complete lyrical theme · ${kind}`);
    const selected = frames.map(frame => ({ ...frame, notes: frame.notes.filter(note => kind === 'mix' || (kind === 'melody' ? lead(note) : !lead(note))) }));
    const buffer = await renderOffline(selected, .65); buffers[kind] = buffer; signals[kind] = signal(buffer, from, to);
    await options.onRendered?.(kind === 'mix' ? 'Lyrical argument · complete score through home arrival' : kind === 'melody' ? 'Lyrical argument · singing melody through home arrival' : 'Lyrical argument · accompaniment through home arrival', buffer, selected);
  }
  const boundaries = passage.slice(1).flatMap((note, index) => {
    const previous = passage[index];
    if (previous.voice !== note.voice || previous.timbre !== note.timbre || previous.tick + previous.duration < note.tick) return [];
    const time = clock(note.tick), before = rms(buffers.melody, time - .06, time - .025), after = rms(buffers.melody, time + .025, time + .06);
    const at = rms(buffers.melody, time - .015, time + .015), ratio = at / Math.max(1e-9, Math.min(before, after));
    return [{ tick: note.tick, beforeRms: tidy(before), boundaryRms: tidy(at), afterRms: tidy(after), relativeLevel: tidy(ratio), continuous: at > .0002 && ratio > .25 }];
  });
  const cells = sentences.flatMap(sentence => sentence.cells.filter(cell => cell.role === 'theme'));
  const cellMetrics = cells.map(cell => ({ ...cell, ...lyricalScoreSummary(frames, cell.startTick, cell.endTick) }));
  const cues = [...new Map(frames.flatMap(frame => frame.phrase?.composition?.cues ?? []).filter(cue => cue.tick >= chosen.startTick && cue.tick < endTick).map(cue => [cue.id, cue])).values()];
  const checks = { completeQuestionAndAnswer: cells.some(cell => cell.label.startsWith('Question')) && cells.some(cell => cell.label.startsWith('Answer')),
    substantialHeldMelody: score.notes >= 8 && score.notesAtLeastOneBeat >= Math.ceil(score.notes * .5) && score.longestGateBeats >= 2,
    finiteUnclipped: Object.values(signals).every(value => value.nonFiniteSamples === 0 && value.clippedSamples === 0 && value.peak < .98),
    audibleMelodyAndBacking: signals.melody.rms > .001 && signals.backing.rms > .0005,
    actualConnectedLine: boundaries.length > 0 && boundaries.every(boundary => boundary.continuous),
    writtenBreath: score.writtenBreaths > 0,
    completeArgumentEndsClosed: cadences.at(-1)?.cadence === 'closed' && cadences.at(-1)?.plannedEndingDegree === 0,
    authoredCadencesPreserved: cadences.every(cadence => cadence.matchesAuthoredEnding) };
  return { engineVersion: ENGINE_VERSION, seed: recipe.seed, recipe, passed: Object.values(checks).every(Boolean), checks,
    generatedFrames: generated.length, renderedFrames: frames.length, eventHash: eventHash(generated.flatMap(frame => frame.notes)),
    theme: { name: chosen.themeName, gesture: 'Open lyrical sentences → closed home arrival', startTick: chosen.startTick, endTick,
      startsAtSeconds: tidy(pieceClock(chosen.startTick)), durationSeconds: tidy(to - from), excerptStartsAtTick: frames[0].tick },
    score, cadences, cells: cellMetrics, structuralArrivals: cues.filter(cue => cue.kind === 'arrival'), signals, boundaries,
    melodyToBackingDb: tidy(20 * Math.log10(Math.max(1e-9, signals.melody.rms) / Math.max(1e-9, signals.backing.rms))),
    method: 'Use the production Lyrical score recipe, or an explicitly supplied lyrical performance, and generate from the first theme through its first explicitly closed sentence, including all open inner sentences and a bar of context. Render that unchanged complete argument with the real Web Audio rack as full score, foreground melody and accompaniment. Each sentence ending is labeled open or closed and compared with its authored native endpoint relative to its actual opening; an opening on degree2 is not mistaken for the tonic. Note metrics describe physical pitch intervals, integer-tick durations, spacing and declared breaths/cadences; 30 ms PCM windows inspect continuity at connected melody boundaries. Independent stem effects/compression mean stems are not an exact additive decomposition of the mix. Signal checks establish presence and continuity, not beauty, emotional impact, or a claim of subjective listening.' };
}
