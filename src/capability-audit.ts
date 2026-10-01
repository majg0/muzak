import { renderOffline } from './audio';
import { COMPOSITION_STUDIES, compositionStudy } from './composition-studies';
import { MusicEngine, eventHash } from './engine';
import { degreeToPitch, pitchToDegree, pitchToMidi, TUNINGS } from './pitch';
import { restAppliesToNote } from './phrasing';
import { createPerformance, parsePerformance, serializePerformance } from './serialization';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent, type Performance } from './types';

const yieldUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const tidy = (n: number) => Math.round(n * 1e7) / 1e7;
const quantile = (values: number[], amount: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return tidy(sorted[Math.floor((sorted.length - 1) * amount)] ?? 0);
};
const distribution = (values: number[]) => ({ p10: quantile(values, .1), median: quantile(values, .5), p90: quantile(values, .9) });
const ordered = (notes: NoteEvent[]) => [...notes].sort((a, b) => a.tick - b.tick || a.voice - b.voice
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const makeEngine = (recipe: Performance) => new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters,
  conductor: recipe.conductor, phrasing: recipe.phrasing, sound: recipe.sound, weights: recipe.weights,
  automation: recipe.automation, automationRevisions: recipe.automationRevisions });

/** Editable recipes from the instrument, with a common seed and tempo. Unlike
 * the range matrix, this is not a one-variable controlled experiment. */
export function capabilityCases(seed = 'glass-garden', tempo = 88) {
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 180) throw new RangeError('Audit tempo must be 40–180 BPM.');
  const source = createPerformance(seed); source.initialParameters.tempo = tempo;
  return COMPOSITION_STUDIES.map(study => ({ id: study.id, label: study.name, intent: study.intent,
    recipe: parsePerformance(serializePerformance(compositionStudy(source, study.id))) }));
}

/** Select whole arguments from the first theme, aiming for32–64 quarter-note
 * beats. A complete argument takes precedence over the target length. Never
 * select a later peak because it happens to score better on a metric. */
export async function generateCapabilityStudy(recipe: Performance, onProgress?: (message: string) => void) {
  const engine = makeEngine(recipe), prefix: Frame[] = [];
  let startTick = -1, endTick = -1, sectionStart = -1;
  for (let index = 0; index < 256; index++) {
    const frame = engine.step(); prefix.push(frame);
    const phrase = frame.phrase;
    if (startTick < 0 && frame.form?.role === 'theme' && phrase?.themeCore) {
      startTick = phrase.startTick; endTick = phrase.endTick; sectionStart = frame.form.sectionStartTick;
      if (endTick <= startTick || endTick - startTick > PPQ * 96) throw new Error('Complete argument exceeds the bounded96-beat audition limit.');
    } else if (startTick >= 0 && frame.tick >= endTick) {
      if (endTick - startTick >= PPQ * 32 || frame.form?.sectionStartTick !== sectionStart || !phrase?.themeCore
        || phrase.startTick !== endTick || phrase.endTick - startTick > PPQ * 64) break;
      endTick = phrase.endTick;
    }
    if (index % 8 === 7) { onProgress?.(`Composing ${recipe.presetId} · ${index + 1} frames`); await yieldUI(); }
    if (startTick >= 0 && endTick - startTick >= PPQ * 32 && frame.tick + frame.duration >= endTick) break;
  }
  const frames = prefix.filter(frame => frame.tick >= startTick && frame.tick < endTick);
  if (startTick < 0 || !frames.length || frames[0].tick !== startTick
    || frames.at(-1)!.tick + frames.at(-1)!.duration !== endTick) throw new Error('No complete frame-aligned thematic argument within256 frames.');
  const replay = makeEngine(parsePerformance(serializePerformance(recipe)));
  let exactReplay = true;
  for (let index = 0; index < prefix.length; index++) {
    const repeated = replay.step();
    exactReplay &&= JSON.stringify(repeated.notes) === JSON.stringify(prefix[index].notes);
    if (index % 8 === 7) { onProgress?.(`Replaying ${recipe.presetId} · ${index + 1} frames`); await yieldUI(); }
  }
  return { frames, startTick, endTick, generatedFrames: prefix.length, exactReplay,
    prefixEventHash: eventHash(prefix.flatMap(frame => frame.notes)) };
}

/** A longer score-only view prevents a quiet opening from concealing whether
 * decorations ever reach production. It is separate from the audio excerpt;
 * a later ornament does not get falsely attributed to the opening player. */
export async function capabilityArgumentCohort(recipe: Performance, onProgress?: (message: string) => void) {
  const engine = makeEngine(recipe), groups = new Map<number, Frame[]>();
  let begun = false, complete = false;
  for (let index = 0; index < 384; index++) {
    const frame = engine.step();
    if (!begun && frame.form?.role === 'theme' && frame.phrase?.themeCore) begun = true;
    if (begun && frame.phrase?.themeCore) {
      const start = frame.phrase.startTick;
      if (!groups.has(start) && groups.size === 4) { complete = true; break; }
      const list = groups.get(start) ?? []; list.push(frame); groups.set(start, list);
      if (groups.size === 4 && frame.tick + frame.duration >= frame.phrase.endTick) { complete = true; break; }
    }
    if (index % 8 === 7) { onProgress?.(`Checking later arguments · ${recipe.presetId} · ${index + 1} frames`); await yieldUI(); }
  }
  if (!complete) throw new Error('Four complete arguments were not found within384 frames.');
  const argumentsReport = [...groups.values()].map(frames => {
    const score = capabilityScoreSummary(frames);
    return { startTick: score.startTick, endTick: score.endTick, beats: score.beats, eventHash: score.eventHash,
      complete: score.arguments.every(argument => argument.completeWithinExcerpt), leadAttacks: score.lead.attacks,
      ornamentEvents: score.lead.ornamentEvents, ornamentKinds: score.lead.ornamentKinds,
      ornamentSourceIds: score.lead.ornamentSourceIds, realization: score.arguments[0]?.realization,
      offNativeGridAttacks: score.tuning.offNativeGridAttacks };
  });
  return { method: 'Score only: first four complete arguments beginning at the first theme; no later audio substituted for the opening.',
    ornamentEvents: argumentsReport.reduce((sum, item) => sum + item.ornamentEvents, 0),
    ornamentKinds: [...new Set(argumentsReport.flatMap(item => Object.keys(item.ornamentKinds)))], arguments: argumentsReport };
}

/** Source gates account for replacement and written rests; these are score
 * measurements, not claims about the duration of reverb or perceived legato. */
function sourceGates(frames: Frame[], notes: NoteEvent[]): number[] {
  const voices = new Map<number, NoteEvent[]>(), ends = new Map<string, number>();
  for (const note of ordered(notes.filter(note => note.absolutePitch))) {
    const group = voices.get(note.voice) ?? []; group.push(note); voices.set(note.voice, group);
  }
  const rests = frames.flatMap(frame => frame.phrase?.rests ?? []);
  for (const group of voices.values()) for (let index = 0; index < group.length; index++) {
    const note = group[index]; let end = Math.min(note.tick + note.duration, group[index + 1]?.tick ?? Infinity);
    for (const rest of rests) if (restAppliesToNote(note, rest) && rest.startTick >= note.tick) end = Math.min(end, rest.startTick);
    ends.set(note.id, Math.max(0, end - note.tick) / PPQ);
  }
  return notes.map(note => ends.get(note.id) ?? note.duration / PPQ);
}

/** Includes both declared score relationships and independently counted events. */
export function capabilityScoreSummary(frames: Frame[]) {
  if (!frames.length) throw new Error('Cannot summarize an empty audition.');
  const notes = ordered(frames.flatMap(frame => frame.notes));
  const lead = notes.filter(note => note.voice === 5 && note.absolutePitch), pitched = notes.filter(note => note.absolutePitch);
  const attacks = [...new Set(lead.map(note => note.tick))], intervals = attacks.slice(1).map((tick, i) => (tick - attacks[i]) / PPQ);
  const pitches = lead.map(note => pitchToMidi(note.absolutePitch!));
  const steps = pitches.slice(1).map((pitch, i) => tidy((pitch - pitches[i]) * 100));
  const directions = steps.map(Math.sign).filter(Boolean), startTick = frames[0].tick, endTick = frames.at(-1)!.tick + frames.at(-1)!.duration;
  const beats = (endTick - startTick) / PPQ, gates = sourceGates(frames, notes);
  const ornaments: Record<string, number> = {};
  for (const note of lead) {
    const kind = note.expression?.sourceId?.match(/:ornament:([^:]+)/)?.[1];
    if (kind) ornaments[kind] = (ornaments[kind] ?? 0) + 1;
  }
  const moments = frames.flatMap(frame => frame.diagnostics.compositionExpression?.rhythm ?? []);
  const layerMap = new Map<string, { id: string; role: string; sourceId: string; cycleBeats: number; introducedAt: number; retiresAt: number; observedActive: boolean }>();
  for (const moment of moments) for (const layer of moment.layers) {
    const key = `${layer.id}:${layer.introducedAt}`;
    const prior = layerMap.get(key);
    layerMap.set(key, { id: layer.id, role: layer.role, sourceId: layer.sourceId, cycleBeats: layer.cycleTicks / PPQ,
      introducedAt: layer.introducedAt, retiresAt: layer.retiresAt, observedActive: layer.active || !!prior?.observedActive });
  }
  const reference = notes.filter(note => note.part === 'percussion' && note.expression?.sourceId === 'reference:quarter');
  // The reference layer also includes half/full/double backbeats. A double
  // backbeat is deliberately on the eighth offbeat, not the quarter grid.
  const referenceOnsets = [...new Set(reference.filter(note => note.midiNote === 42).map(note => note.tick))];
  let backbeatOffDeclaredGrid = 0;
  for (const frame of frames) {
    const moment = frame.diagnostics.compositionExpression?.rhythm;
    if (!moment) continue;
    const grid = moment.reference.backbeatTicks, offset = moment.feel === 'half' ? PPQ * 2 : moment.feel === 'double' ? PPQ / 2 : PPQ;
    backbeatOffDeclaredGrid += frame.notes.filter(note => note.midiNote === 38 && note.expression?.sourceId === 'reference:quarter'
      && (note.tick - offset) % grid !== 0).length;
  }
  const argumentMap = new Map<number, NonNullable<Frame['phrase']>>();
  for (const frame of frames) if (frame.phrase?.themeCore) argumentMap.set(frame.phrase.startTick, frame.phrase);
  let offGrid = 0, fractional = 0, maximumGridErrorMillicents = 0;
  for (const frame of frames) for (const note of frame.notes) if (note.absolutePitch) {
    const error = Math.abs(note.absolutePitch.millicents - degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, note.absolutePitch)).millicents);
    maximumGridErrorMillicents = Math.max(error, maximumGridErrorMillicents); if (error > 1) offGrid++;
    if (note.absolutePitch.millicents % 100000 !== 0) fractional++;
  }
  const partSummary = (part: NoteEvent['part']) => {
    const selected = notes.flatMap((note, index) => note.part === part ? [{ note, gate: gates[index] }] : []);
    return { attacks: selected.length, attacksPerBeat: tidy(selected.length / beats), sourceGateBeats: distribution(selected.map(item => item.gate)),
      gatesAtLeastTwoBeats: selected.filter(item => item.gate >= 2).length,
      gatesAtMostHalfBeat: selected.filter(item => item.gate <= .5).length,
      articulations: Object.fromEntries(['sustained', 'connected', 'detached', 'unspecified'].map(kind => [kind,
        selected.filter(item => (item.note.articulation ?? 'unspecified') === kind).length])) };
  };
  const ranges = [...new Set(pitched.map(note => note.voice))].sort((a, b) => a - b).map(voice => {
    const values = pitched.filter(note => note.voice === voice).map(note => pitchToMidi(note.absolutePitch!));
    return { voice, minMidiEquivalent: tidy(Math.min(...values)), maxMidiEquivalent: tidy(Math.max(...values)) };
  });
  return { startTick, endTick, beats, noteEvents: notes.length, eventHash: eventHash(notes), uniqueEventIds: new Set(notes.map(note => note.id)).size,
    parts: Object.fromEntries((['melody', 'harmony', 'bass', 'percussion'] as const).map(part => [part, partSummary(part)])),
    lead: { attacks: lead.length, attacksPerBeat: tidy(lead.length / beats), onsetGapBeats: distribution(intervals),
      onsetGapHistogram: Object.fromEntries([[0, .25], [.25, .5], [.5, 1], [1, 2], [2, Infinity]].map(([low, high]) => [`${low}<beats<=${high}`, intervals.filter(n => n > low && n <= high).length])),
      rangeMidiEquivalent: pitches.length ? [tidy(Math.min(...pitches)), tidy(Math.max(...pitches))] : [],
      netTravelCents: tidy((pitches.at(-1)! - pitches[0]) * 100 || 0), stepCents: steps,
      ascendingSteps: steps.filter(n => n > 0).length, descendingSteps: steps.filter(n => n < 0).length, repeatedPitches: steps.filter(n => n === 0).length,
      directionChanges: directions.slice(1).filter((n, i) => n !== directions[i]).length,
      ornamentEvents: Object.values(ornaments).reduce((a, b) => a + b, 0), ornamentKinds: ornaments,
      ornamentSourceIds: [...new Set(lead.flatMap(note => note.expression?.sourceId?.includes(':ornament:') ? [note.expression.sourceId] : []))] },
    instrumentColors: [...new Set(pitched.flatMap(note => note.timbre ?? []))].sort(), ranges,
    tuning: { ids: [...new Set(frames.map(frame => frame.sound.tuning))], pitchedAttacks: pitched.length, fractionalMidiAttacks: fractional,
      fractionalMidiFraction: tidy(fractional / Math.max(1, pitched.length)), offNativeGridAttacks: offGrid, maximumGridErrorMillicents,
      glideEvents: pitched.filter(note => note.endPitch).length },
    rhythm: { declaredLayers: [...layerMap.values()], referencePercussionEvents: reference.length, referenceQuarterHatOnsetTicks: referenceOnsets,
      backbeatOffDeclaredGrid,
      referenceOffQuarterGrid: referenceOnsets.filter(tick => tick % PPQ !== 0).length,
      referenceGapBeats: distribution(referenceOnsets.slice(1).map((tick, i) => (tick - referenceOnsets[i]) / PPQ)),
      heardPercussion: notes.filter(note => note.part === 'percussion').length,
      feels: [...new Set(moments.map(moment => moment.feel))], riffs: [...new Set(moments.map(moment => moment.riffShape))],
      fillRecipes: [...new Set(moments.map(moment => moment.fillShape))], treatments: [...new Set(moments.map(moment => moment.treatment))] },
    arguments: [...argumentMap.values()].map(phrase => ({ startTick: phrase.startTick, endTick: phrase.endTick,
      completeWithinExcerpt: phrase.startTick >= startTick && phrase.endTick <= endTick,
      coreId: phrase.themeCore!.id, grammar: phrase.themeCore!.grammar, treatment: phrase.themeCore!.treatment,
      realization: phrase.themeCore!.realization })),
  };
}

/** Scan all samples for invalid/clipped values, but calculate RMS only over
 * the musical interval, so longer effect tails cannot dilute the comparison. */
async function signalSummary(buffer: AudioBuffer, musicalSeconds: number) {
  let nonFiniteSamples = 0, clippedSamples = 0, peak = 0, square = 0, samples = 0;
  const musicalSamples = Math.ceil(musicalSeconds * buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let start = 0; start < data.length; start += 262144) {
      for (let i = start; i < Math.min(start + 262144, data.length); i++) {
        const value = data[i]; if (!Number.isFinite(value)) { nonFiniteSamples++; continue; }
        peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= .999) clippedSamples++;
        if (i < musicalSamples) { square += value * value; samples++; }
      }
      await yieldUI();
    }
  }
  return { sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, seconds: tidy(buffer.duration),
    nonFiniteSamples, clippedSamples, peak: tidy(peak), musicalRms: tidy(Math.sqrt(square / Math.max(1, samples))) };
}

export async function auditCapabilities(options: {
  seed?: string; tempo?: number; onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
} = {}) {
  const cases = capabilityCases(options.seed, options.tempo), reports = [];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index], passage = await generateCapabilityStudy(item.recipe, options.onProgress);
    const score = capabilityScoreSummary(passage.frames);
    const laterArgumentCohort = await capabilityArgumentCohort(item.recipe, options.onProgress);
    const musicalSeconds = passage.frames.reduce((sum, frame) => sum + frame.duration * 60 / frame.parameters.tempo / PPQ, 0);
    options.onProgress?.(`Rendering ${index + 1}/${cases.length} · ${item.label} · full ensemble`); await yieldUI();
    const started = performance.now(), buffer = await renderOffline(passage.frames, .65);
    const fullSignal = await signalSummary(buffer, musicalSeconds), renderMilliseconds = tidy(performance.now() - started);
    await options.onRendered?.(`${item.label} · ${TUNINGS[item.recipe.sound.tuning].name} · full ensemble`, buffer, passage.frames);
    let leadSignal: Awaited<ReturnType<typeof signalSummary>> | undefined;
    if (index < 4) {
      const stem = passage.frames.map(frame => ({ ...frame, notes: frame.notes.filter(note => note.voice === 5) }));
      options.onProgress?.(`Rendering ${item.label} · isolated written lead`); await yieldUI();
      const leadBuffer = await renderOffline(stem, .65); leadSignal = await signalSummary(leadBuffer, musicalSeconds);
      await options.onRendered?.(`${item.label} · isolated written lead`, leadBuffer, stem);
    }
    reports.push({ id: item.id, label: item.label, intent: item.intent, recipe: item.recipe, ...score,
      laterArgumentCohort,
      generatedFrames: passage.generatedFrames, exactReplay: passage.exactReplay, prefixEventHash: passage.prefixEventHash,
      musicalSeconds: tidy(musicalSeconds), fullSignal, leadSignal, renderAndScanMilliseconds: renderMilliseconds,
      window: score.beats >= 32 && score.beats <= 64 ? '32–64 beats, complete arguments' : 'Complete argument takes precedence over32–64-beat target' });
    await yieldUI();
  }
  const checks = {
    sameSeedAndTempo: reports.every(report => report.recipe.seed === cases[0].recipe.seed && report.recipe.initialParameters.tempo === cases[0].recipe.initialParameters.tempo),
    exactSerializedRecipeReplay: reports.every(report => report.exactReplay),
    completeArguments: reports.every(report => report.arguments.length > 0 && report.arguments.every(argument => argument.completeWithinExcerpt)),
    laterArgumentsCompleteAndNative: reports.every(report => report.laterArgumentCohort.arguments.length === 4
      && report.laterArgumentCohort.arguments.every(argument => argument.complete && argument.offNativeGridAttacks === 0)),
    uniqueEventIds: reports.every(report => report.noteEvents === report.uniqueEventIds),
    nativePitchLocations: reports.every(report => report.tuning.offNativeGridAttacks === 0),
    nativeTuningsActuallyFractional: reports.filter(report => report.recipe.sound.tuning !== '12tet').every(report => report.tuning.fractionalMidiAttacks > 0),
    actualReferenceOnFixedPulse: reports.every(report => report.rhythm.referenceOffQuarterGrid === 0 && report.rhythm.backbeatOffDeclaredGrid === 0),
    finiteUnclippedAudio: reports.every(report => [report.fullSignal, report.leadSignal].filter(Boolean).every(signal => signal!.nonFiniteSamples === 0 && signal!.clippedSamples === 0 && signal!.peak < .98)),
    audibleSignal: reports.every(report => report.fullSignal.musicalRms > .001 && (!report.leadSignal || report.leadSignal.musicalRms > .001)),
  };
  return { engineVersion: ENGINE_VERSION, seed: cases[0].recipe.seed, tempo: cases[0].recipe.initialParameters.tempo,
    method: 'Six editable common-engine recipes; identical seed and tempo, multiple intentional parameter differences. First complete thematic arguments, aiming for32–64 beats. Event replay is checked after JSON serialization. Production OfflineAudioContext renders are unnormalized at one common gain. First four studies also provide isolated voice5. Sequential renders and sample scans yield to the browser.',
    interpretation: 'Score and PCM measurements establish capabilities, native pitches, signal and reproducibility—not beauty, performer resemblance or stylistic success. Declared layers/recipes are distinguished from emitted reference strikes and ornament source IDs. A zero ornament count or an absent layer is reported, not disguised as a pass/fail style judgment. Source gates exclude effect tails; event counts are not oscillator counts.',
    checks, passed: Object.values(checks).every(Boolean), cases: reports };
}
