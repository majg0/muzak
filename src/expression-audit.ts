import { renderOffline } from './audio';
import { DEFAULT_CONDUCTOR, formAt, type ConductorConfig } from './conductor';
import { MusicEngine, eventHash } from './engine';
import { expressiveContourAt } from './engine/expression';
import { explorationPerformance } from './exploration';
import { createPerformance } from './serialization';
import { gainEnvelopeAt } from './note-expression';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent } from './types';

const tidy = (value: number) => Math.round(value * 1e8) / 1e8;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const beats = (frames: Frame[]) => frames.reduce((sum, frame) => sum + frame.duration / PPQ, 0);
const seconds = (frames: Frame[]) => frames.reduce((sum, frame) => sum + frame.duration * 60 / frame.parameters.tempo / PPQ, 0);

export interface ExpressionExcerpt {
  kind: 'calm' | 'rise' | 'crest' | 'retreat';
  start: number;
  end: number;
  meanEnergy: number;
  energyChange: number;
}

/** Select actual contiguous regions of one already-generated performance.
 * The selectors inspect the shared expressive score; they never regenerate
 * notes, change tempo, or force the music into an audition-specific state. */
export function selectExpressionExcerpts(frames: Frame[], seed: string, excerptFrames = 8, conductor: ConductorConfig = DEFAULT_CONDUCTOR): ExpressionExcerpt[] {
  const size = Math.max(8, Math.min(10, Math.round(excerptFrames)));
  if (frames.length < size * 4 + 2) throw new Error('Not enough committed history for four expression excerpts.');
  const lookup = (tick: number) => formAt(seed, tick, conductor);
  const energy = frames.map(frame => frame.diagnostics.compositionExpression?.energy
    ?? expressiveContourAt(seed, frame.tick, lookup, conductor.amount).energy);
  const windows = Array.from({ length: frames.length - size + 1 }, (_, start) => {
    const end = start + size;
    return { start, end, meanEnergy: mean(energy.slice(start, end)), energyChange: energy[end - 1] - energy[start] };
  });
  // Joint interval assignment prevents a greedy crest/calm choice from
  // consuming the only real rise or retreat. Sixteen masks retain bounded
  // work and permit every chronological ordering, including an opening crest.
  const kinds = ['crest', 'calm', 'rise', 'retreat'] as const;
  type Selection = { score: number; excerpts: ExpressionExcerpt[] };
  const best: Array<Array<Selection | undefined>> = Array.from({ length: frames.length + 1 }, () => Array(16));
  best[0][0] = { score: 0, excerpts: [] };
  const keep = (at: number, mask: number, value: Selection) => {
    if (!best[at][mask] || value.score > best[at][mask]!.score) best[at][mask] = value;
  };
  for (let start = 0; start < frames.length; start++) for (let mask = 0; mask < 16; mask++) {
    const previous = best[start][mask];
    if (!previous) continue;
    keep(start + 1, mask, previous);
    const window = windows[start];
    if (!window) continue;
    for (let index = 0; index < kinds.length; index++) {
      if (mask & (1 << index)) continue;
      const kind = kinds[index], direction = kind === 'rise' ? window.energyChange : -window.energyChange;
      const score = kind === 'crest' ? window.meanEnergy : kind === 'calm' ? 1 - window.meanEnergy
        : direction * 2 + (direction > .03 ? 2 : 0);
      keep(window.end, mask | (1 << index), { score: previous.score + score,
        excerpts: [...previous.excerpts, { ...window, kind }] });
    }
  }
  const selected = best[frames.length][15];
  if (!selected) throw new Error('Could not select four non-overlapping expression regions.');
  return selected.excerpts;
}

function signal(buffer: AudioBuffer, from: number, until: number) {
  const start = Math.max(0, Math.floor(from * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.ceil(until * buffer.sampleRate));
  const width = Math.round(buffer.sampleRate * .2), windows: number[] = [];
  let finiteSamples = 0, nonFiniteSamples = 0, clippedSamples = 0, peak = 0, sum = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let windowSum = 0, windowCount = 0;
    for (let index = 0; index < data.length; index++) {
      const sample = data[index];
      if (!Number.isFinite(sample)) { nonFiniteSamples++; continue; }
      finiteSamples++; peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) >= .999) clippedSamples++;
      if (index < start || index >= end) continue;
      sum += sample * sample; windowSum += sample * sample; windowCount++;
      if (windowCount === width) { windows.push(Math.sqrt(windowSum / width)); windowSum = 0; windowCount = 0; }
    }
  }
  const sorted = [...windows].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * .1)] ?? 0, high = sorted[Math.floor(sorted.length * .9)] ?? 0;
  return { peak: tidy(peak), rms: tidy(Math.sqrt(sum / Math.max(1, (end - start) * buffer.numberOfChannels))), finiteSamples, nonFiniteSamples, clippedSamples,
    windowP10Rms: tidy(low), windowP90Rms: tidy(high), dynamicRangeDb: tidy(20 * Math.log10(Math.max(1e-9, high) / Math.max(1e-9, low))) };
}

export function expressionScoreSummary(frames: Frame[], focusStartTick: number) {
  const allNotes = frames.flatMap(frame => frame.notes);
  const notes = allNotes.filter(note => note.tick >= focusStartTick);
  const changingHeldGainNotes = allNotes.filter(note => note.absolutePitch && note.tick + note.duration > focusStartTick
    && note.duration >= 360 && note.gainEnvelope?.length && Math.max(...note.gainEnvelope.map(point => point.gain))
      - Math.min(...note.gainEnvelope.map(point => point.gain)) > .02).length;
  const upper = notes.filter(note => note.part === 'harmony').sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  const effective = upper.map((note, index) => {
    const successor = upper.slice(index + 1).find(next => next.voice === note.voice);
    return Math.min(note.duration, successor ? Math.max(0, successor.tick - note.tick) : Infinity);
  });
  const held = upper.filter(note => note.duration > 960 && note.gainEnvelope?.length);
  const gainRanges = held.map(note => Math.max(...note.gainEnvelope!.map(point => point.gain)) - Math.min(...note.gainEnvelope!.map(point => point.gain)));
  const focus = frames.filter(frame => frame.tick >= focusStartTick);
  const focusBeats = Math.max(1, beats(focus));
  const pitched = notes.filter(note => note.part !== 'percussion');
  const lead = notes.filter(note => note.part === 'melody' && [5, 6].includes(note.voice)).sort((a, b) => a.tick - b.tick);
  const previousLead = new Map<number, NoteEvent>(), leadGaps: number[] = [];
  for (const note of lead) {
    const previous = previousLead.get(note.voice);
    if (previous && note.tick > previous.tick) leadGaps.push(note.tick - previous.tick);
    previousLead.set(note.voice, note);
  }
  const ensembleTicks = new Map<number, Set<string>>();
  for (const note of notes) if (note.part !== 'melody') {
    const parts = ensembleTicks.get(note.tick) ?? new Set<string>(); parts.add(note.part); ensembleTicks.set(note.tick, parts);
  }
  const shared = [...ensembleTicks].filter(([, parts]) => ['harmony', 'bass', 'percussion'].every(part => parts.has(part))).map(([tick]) => tick).sort((a, b) => a - b);
  const group = (predicate: (note: NoteEvent) => boolean) => {
    const members = notes.filter(predicate);
    return { notes: members.length, meanVelocity: tidy(mean(members.map(note => note.velocity))) };
  };
  return { eventHash: eventHash(notes), notes: notes.length, upperAttacks: upper.length, changingHeldGainNotes,
    melodyAttacksPerBeat: tidy(lead.length / focusBeats), medianMelodyGapBeats: tidy(median(leadGaps) / PPQ),
    sustainedPitchedFraction: tidy(pitched.filter(note => note.articulation === 'sustained').length / Math.max(1, pitched.length)),
    offQuarterPitchedFraction: tidy(pitched.filter(note => note.tick % PPQ !== 0).length / Math.max(1, pitched.length)),
    partAttacksPerBeat: Object.fromEntries(['harmony', 'bass', 'melody', 'percussion'].map(part => [part, tidy(notes.filter(note => note.part === part).length / focusBeats)])),
    sharedEnsembleAttacks: shared.length,
    sharedFastConnections: shared.filter((tick, index) => index > 0 && tick - shared[index - 1] <= PPQ / 2).length,
    upperAttacksPerBeat: tidy(upper.length / Math.max(1, beats(frames.filter(frame => frame.tick >= focusStartTick)))),
    heldUpperNotes: held.length, heldNotesWithChangingGain: gainRanges.filter(range => range > .02).length,
    medianWrittenUpperGateBeats: tidy(median(upper.map(note => note.duration)) / PPQ),
    medianAttackLimitedUpperGateBeats: tidy(median(effective) / PPQ),
    attackLimitedUpperHoldsOverTwoBeats: effective.filter(duration => duration > 960).length,
    accompanimentAttacks: upper.filter(note => note.id.startsWith('accompaniment:')).length,
    structuralUpperSupports: upper.filter(note => note.id.startsWith('ensemble:')).length,
    glides: notes.filter(note => note.endPitch && note.glideTicks).length,
    meanVelocity: tidy(mean(notes.map(note => note.velocity))),
    requestedEnergy: tidy(mean(focus.map(frame => frame.diagnostics.orchestration?.requestedEnergy ?? frame.parameters.tension))),
    observedAttacksPerBeat: tidy(mean(focus.map(frame => frame.diagnostics.orchestration?.attacksPerBeat ?? 0))),
    heldGainProxy: tidy(mean(focus.map(frame => frame.diagnostics.orchestration?.heldGainProxy ?? 0))),
    ornamentKinds: [...new Set(notes.flatMap(note => note.expression?.sourceId?.match(/:ornament:([^:]+):/)?.[1] ?? []))].sort(),
    ornaments: group(note => note.expression?.role === 'ornament'),
    structuralMelody: group(note => note.part === 'melody' && note.expression?.role === 'anchor'),
    orchestralFills: group(note => note.id.startsWith('fill:')),
    independentCounter: group(note => note.voice === 8),
    fillShapes: [...new Set(focus.flatMap(frame => frame.phrase?.composition?.fills?.map(fill => fill.shape) ?? []))].sort() };
}

function flattenEnvelope(note: NoteEvent): NoteEvent {
  const points = note.gainEnvelope;
  if (!points?.length) return note;
  const offsets = [...new Set([0, ...points.map(point => point.tick).filter(tick => tick > 0 && tick < note.duration), note.duration])];
  let integral = 0;
  for (let index = 1; index < offsets.length; index++) integral += (offsets[index] - offsets[index - 1]) * (gainEnvelopeAt(points, offsets[index]) + gainEnvelopeAt(points, offsets[index - 1])) / 2;
  const gain = integral / note.duration;
  return { ...note, gainEnvelope: [{ tick: 0, gain }, { tick: note.duration, gain }] };
}

function pcmDifference(a: AudioBuffer, b: AudioBuffer, from: number, until: number) {
  if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels || a.sampleRate !== b.sampleRate) throw new Error('Controlled render buffers have different dimensions.');
  const start = Math.floor(from * a.sampleRate), end = Math.min(a.length, Math.ceil(until * a.sampleRate));
  let sum = 0, peak = 0;
  for (let channel = 0; channel < a.numberOfChannels; channel++) {
    const left = a.getChannelData(channel), right = b.getChannelData(channel);
    for (let index = start; index < end; index++) { const difference = left[index] - right[index]; sum += difference * difference; peak = Math.max(peak, Math.abs(difference)); }
  }
  return { rmsDifference: tidy(Math.sqrt(sum / Math.max(1, (end - start) * a.numberOfChannels))), peakDifference: tidy(peak) };
}

/** Four short excerpts use production Web Audio, followed by one controlled
 * reference with identical events and fixed time-average gain envelopes.
 * The generated history is bounded and CPU work yields every eight frames. */
export async function auditExpression(options: {
  seed?: string;
  frameCount?: number;
  onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
} = {}) {
  const seed = options.seed ?? 'glass-garden';
  const limit = Math.max(64, Math.min(450, Math.round(options.frameCount ?? 450)));
  const { recipe, description } = explorationPerformance(createPerformance(seed), seed);
  const conductor = recipe.conductor!;
  const engine = new MusicEngine({ seed, parameters: recipe.initialParameters, conductor, phrasing: recipe.phrasing, sound: recipe.sound, weights: recipe.weights });
  let narrativeEndTick = 0;
  for (let section = 0; section < 24; section++) {
    const form = formAt(seed, narrativeEndTick, conductor, recipe.sound.tuning);
    if (form.cycle > 0) break;
    narrativeEndTick = form.sectionEndTick;
  }
  const frameCount = Math.ceil(narrativeEndTick / 960);
  if (frameCount > limit) throw new Error(`The first Wide exploration narrative needs ${frameCount} frames; this bounded audition allows ${limit}. Choose another seed or increase its limit (maximum450).`);
  const frames: Frame[] = [];
  for (let index = 0; index < frameCount; index++) {
    frames.push(engine.step());
    if (index % 8 === 7) { options.onProgress?.(`Composing the complete first Wide exploration narrative · ${index + 1} / ${frameCount} frames`); await pause(); }
  }
  const selections = selectExpressionExcerpts(frames, seed, 8, conductor);
  const reports: Array<ReturnType<typeof expressionScoreSummary> & {
    kind: ExpressionExcerpt['kind']; label: string; absoluteStartTick: number; focusStartTick: number;
    endTick: number; frameCount: number; focusStartsAtSeconds: number; musicalSeconds: number;
    focusEnergy: number; energyChange: number; sections: Array<string | undefined>; signal: ReturnType<typeof signal>;
  }> = [];
  const labels = { calm: 'Lowest-energy region', rise: 'Strongest upward change', crest: 'Highest-energy region', retreat: 'Strongest downward change' };
  let referenceSource: { kind: ExpressionExcerpt['kind']; buffer: AudioBuffer; frames: Frame[]; from: number; until: number; gains: number } | undefined;
  for (const [selectionIndex, selection] of selections.entries()) {
    // Include still-sounding written sources, even when the chosen region is
    // an exposed long note whose original attack predates two frames.
    const latest = new Map<string, NoteEvent>();
    for (const frame of frames.slice(0, selection.start)) for (const note of frame.notes) latest.set(`${note.part}:${note.voice}`, note);
    const focusTick = frames[selection.start].tick;
    const heldStarts = [...latest.values()].filter(note => note.tick + note.duration > focusTick).map(note => note.tick);
    const earliest = Math.min(focusTick, ...heldStarts);
    const contextStart = Math.max(0, Math.min(selection.start - 2, Math.floor(earliest / 960)));
    const contextFrames = selection.start - contextStart;
    const excerpt = frames.slice(contextStart, selection.end);
    const label = `${String.fromCharCode(65 + selectionIndex)} · ${labels[selection.kind]} · piece ${(seconds(frames.slice(0, selection.start)) / 60).toFixed(2)} min`;
    options.onProgress?.(`Rendering ${label} (${contextFrames}-frame lead-in, then eight-frame focus)`); await pause();
    const buffer = await renderOffline(excerpt, .65);
    const from = seconds(excerpt.slice(0, contextFrames)), until = seconds(excerpt);
    const summary = expressionScoreSummary(excerpt, focusTick);
    reports.push({ kind: selection.kind, label, absoluteStartTick: excerpt[0].tick, focusStartTick: focusTick,
      endTick: excerpt.at(-1)!.tick + excerpt.at(-1)!.duration, frameCount: excerpt.length,
      focusStartsAtSeconds: tidy(from), musicalSeconds: tidy(until), focusEnergy: tidy(selection.meanEnergy), energyChange: tidy(selection.energyChange),
      sections: [...new Set(excerpt.map(frame => frame.form?.sectionName))], ...summary, signal: signal(buffer, from, until) });
    await options.onRendered?.(label, buffer, excerpt);
    if (!referenceSource || summary.changingHeldGainNotes > referenceSource.gains)
      referenceSource = { kind: selection.kind, buffer, frames: excerpt, from, until, gains: summary.changingHeldGainNotes };
    await pause();
  }
  if (!referenceSource) throw new Error('No expression excerpt was rendered.');
  const fixedFrames = referenceSource.frames.map(frame => ({ ...frame, notes: frame.notes.map(flattenEnvelope) }));
  options.onProgress?.(`Rendering fixed-envelope reference of the same ${labels[referenceSource.kind].toLowerCase()} events`); await pause();
  const fixedBuffer = await renderOffline(fixedFrames, .65);
  await options.onRendered?.(`E · Controlled reference: ${labels[referenceSource.kind]}, fixed time-average note gains`, fixedBuffer, fixedFrames);
  const withoutGain = (frames: Frame[]) => frames.flatMap(frame => frame.notes).map(({ gainEnvelope: _gain, ...note }) => note);
  const reference = { sourceKind: referenceSource.kind, changingHeldGainNotes: referenceSource.gains,
    sameEventsExceptGainEnvelope: eventHash(withoutGain(referenceSource.frames)) === eventHash(withoutGain(fixedFrames)),
    signal: signal(fixedBuffer, referenceSource.from, referenceSource.until),
    ...pcmDifference(referenceSource.buffer, fixedBuffer, referenceSource.from, referenceSource.until) };
  const allSignals = [...reports.map(report => report.signal), reference.signal];
  const byKind = (kind: ExpressionExcerpt['kind']) => reports.find(report => report.kind === kind)!;
  const calmReport = byKind('calm'), crestReport = byKind('crest');
  const calmToPeak = { meanVelocityRatio: tidy(crestReport.meanVelocity / Math.max(1e-9, calmReport.meanVelocity)),
    heldGainProxyRatio: tidy(crestReport.heldGainProxy / Math.max(1e-9, calmReport.heldGainProxy)),
    actualPcmRmsRatio: tidy(crestReport.signal.rms / Math.max(1e-9, calmReport.signal.rms)),
    actualPcmRmsChangeDb: tidy(20 * Math.log10(Math.max(1e-9, crestReport.signal.rms) / Math.max(1e-9, calmReport.signal.rms))) };
  const excerptRmsContrast = Math.max(...reports.map(report => report.signal.rms)) / Math.max(1e-9, Math.min(...reports.map(report => report.signal.rms)));
  const checks = {
    completeFirstNarrative: frames.every(frame => frame.form?.cycle === 0) && frames.at(-1)!.tick + frames.at(-1)!.duration >= narrativeEndTick,
    distinctChronologicalExcerpts: selections.every((selection, index) => index === 0 || selection.start >= selections[index - 1].end),
    calmToCrestContrast: crestReport.focusEnergy - calmReport.focusEnergy > .25,
    genuineRiseAndRetreat: byKind('rise').energyChange > .03 && byKind('retreat').energyChange < -.03,
    performedHeldDynamics: reference.changingHeldGainNotes > 0,
    finiteUnclipped: allSignals.every(signal => signal.nonFiniteSamples === 0 && signal.clippedSamples === 0 && signal.peak < .98),
    signalPresent: allSignals.every(signal => signal.rms > .00000001),
    measuredExcerptContrast: excerptRmsContrast > 2,
    controlledReferencePreservesEvents: reference.sameEventsExceptGainEnvelope,
    envelopesChangeActualPcm: reference.rmsDifference > .00000001
      && reference.rmsDifference / Math.max(1e-9, byKind(reference.sourceKind).signal.rms) > .005,
  };
  options.onProgress?.('Expression excerpts ready for listening');
  return { engineVersion: ENGINE_VERSION, seed, preset: 'Wide exploration', description, conductor, phrasing: recipe.phrasing,
    generatedFrames: frameCount, generatedMinutes: tidy(seconds(frames) / 60), firstNarrativeEndTick: narrativeEndTick,
    completeNarrativeScore: expressionScoreSummary(frames, 0), calmToPeak, excerptRmsContrast: tidy(excerptRmsContrast),
    passed: Object.values(checks).every(Boolean), checks, reports, controlledReference: reference,
    method: 'The complete first narrative of one seeded Wide exploration recipe is generated once, bounded to450 frames. Four non-overlapping eight-frame focus windows represent its highest and lowest energy and strongest upward and downward change; they are displayed in actual chronological order, which need not be calm→rise→crest→retreat. Earlier frames include still-held written sources and at least a two-frame lead-in when available. These excerpts are rendered through production stereo Web Audio at the same volume. Peak and finite/clipped samples cover each complete buffer; RMS and dynamic-range windows cover the focus, excluding lead-in and effect tails. Attack-limited upper gates end at the next same-voice attack; common-tone audio ties may last longer. Energy, melodic idea count and ensemble size are independent: a quiet region may be an exposed solo and a crest need not accelerate every part. Requested energy, counts, velocities and held-gain proxy are score observations, not loudness. PCM contrasts are measured separately. E takes the selected region with the most changing held gain envelopes and replaces only each envelope shape with its original time average. Pitches, onsets, durations, velocity and form remain identical. The reported PCM difference verifies expression in the signal, not subjective musical quality.' };
}
