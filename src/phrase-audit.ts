import { renderOffline } from './audio';
import { MusicEngine, eventHash } from './engine';
import { DEFAULT_CONDUCTOR } from './conductor';
import { DEFAULT_SOUND } from './spectrum';
import { PRESETS } from './parameters';
import { DEFAULT_PHRASING, MANUAL_PHRASING, normalizePhrasing, restAppliesToNote, type PhraseConfig, type PhraseRest } from './phrasing';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent } from './types';

interface SignalSummary {
  musicalSeconds: number;
  peak: number;
  rms: number;
  finiteSamples: number;
  nonFiniteSamples: number;
  clippedSamples: number;
  windowP10Rms: number;
  windowP95Rms: number;
  dynamicRangeDb: number;
  quietWindowFraction: number;
}
interface RestMeasurement {
  startTick: number;
  endTick: number;
  scope: PhraseRest['scope'];
  reason: string;
  durationSeconds: number;
  measuredRms: number;
  withoutPhrasingRms: number;
  changeDb: number | null;
  overlappingNoteEvents: number;
}
export interface PhraseAuditionReport {
  engineVersion: string;
  seed: string;
  frameCount: number;
  phrasing: PhraseConfig;
  passed: boolean;
  on: SignalSummary & { eventHash: string; notes: number; themeNotes: number; soloNotes: number; counterNotes: number };
  off: SignalSummary & { eventHash: string; notes: number; themeNotes: number; soloNotes: number; counterNotes: number };
  rests: RestMeasurement[];
  checks: { finite: boolean; unclipped: boolean; audible: boolean; validDurations: boolean; declaredRests: boolean; eventRestsClear: boolean; measurableRestReduction: boolean };
  dynamicRangeChangeDb: number;
  method: string;
}

const tidy = (value: number) => Math.round(value * 1e8) / 1e8;
const affects = (part: NoteEvent['part'], scope: PhraseRest['scope']) => scope === 'ensemble' || (scope === 'lead' ? part === 'melody' : part !== 'melody');
const dbRatio = (a: number, b: number) => 20 * Math.log10(Math.max(a, 1e-9) / Math.max(b, 1e-9));

function musicalClock(frames: Frame[]) {
  const segments: Array<{ tick: number; time: number; seconds: number }> = [];
  let time = 0;
  for (const frame of frames) {
    const previous = segments.at(-1);
    if (previous) time = previous.time + (frame.tick - previous.tick) * previous.seconds;
    segments.push({ tick: frame.tick, time, seconds: 60 / frame.parameters.tempo / PPQ });
  }
  return (tick: number) => {
    let low = 0, high = segments.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (segments[middle].tick <= tick) low = middle; else high = middle - 1; }
    const segment = segments[low]; return segment.time + (tick - segment.tick) * segment.seconds;
  };
}

function windowRms(buffer: AudioBuffer, from: number, to: number): number {
  const start = Math.max(0, Math.floor(from * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate));
  if (end <= start) return 0;
  let sum = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / ((end - start) * buffer.numberOfChannels));
}

function signalSummary(buffer: AudioBuffer, musicalSeconds: number): SignalSummary {
  let peak = 0, finiteSamples = 0, clippedSamples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const sample of buffer.getChannelData(channel)) {
    if (!Number.isFinite(sample)) continue;
    finiteSamples++; peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) >= 0.999) clippedSamples++;
  }
  const windows: number[] = [];
  for (let time = 0; time + 0.1 <= musicalSeconds; time += 0.1) windows.push(windowRms(buffer, time, time + 0.1));
  const sorted = [...windows].sort((a, b) => a - b);
  const percentile = (amount: number) => sorted[Math.floor((sorted.length - 1) * amount)] ?? 0;
  const p10 = percentile(0.1), p95 = percentile(0.95);
  return { musicalSeconds: tidy(musicalSeconds), peak: tidy(peak), rms: tidy(windowRms(buffer, 0, musicalSeconds)),
    finiteSamples, nonFiniteSamples: buffer.length * buffer.numberOfChannels - finiteSamples, clippedSamples,
    windowP10Rms: tidy(p10), windowP95Rms: tidy(p95), dynamicRangeDb: tidy(dbRatio(p95, Math.max(p10, 1e-7))),
    quietWindowFraction: tidy(windows.filter(value => value < 0.004).length / Math.max(1, windows.length)) };
}

function symbolicSummary(frames: Frame[]) {
  const notes = frames.flatMap(frame => frame.notes);
  return { eventHash: eventHash(notes), notes: notes.length,
    themeNotes: notes.filter(note => note.part === 'melody' && note.voice === 5).length,
    soloNotes: notes.filter(note => note.part === 'melody' && note.voice === 6).length,
    counterNotes: notes.filter(note => note.part === 'melody' && note.voice === 7).length };
}

/** Measured same-seed audition. Full mixes are returned for listening; separate
 * scope stems measure rests without unrelated accompaniment masking lead gaps.
 * Metrics describe signal behavior and declared-event correctness, not taste. */
export async function auditPhrasing(options: {
  seed?: string;
  frameCount?: number;
  phrasing?: Partial<PhraseConfig>;
  onProgress?: (stage: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
} = {}): Promise<PhraseAuditionReport> {
  const seed = options.seed ?? 'glass-garden';
  const frameCount = Math.max(16, Math.min(128, Math.round(options.frameCount ?? 48)));
  const phrasing = normalizePhrasing({ ...DEFAULT_PHRASING, ...options.phrasing, enabled: true });
  const generate = async (config: PhraseConfig) => {
    const engine = new MusicEngine({ seed, parameters: PRESETS[0].parameters, sound: DEFAULT_SOUND, conductor: DEFAULT_CONDUCTOR, phrasing: config });
    const frames: Frame[] = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(engine.step());
      if (i % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return frames;
  };
  options.onProgress?.('Generating phrased passage');
  const onFrames = await generate(phrasing);
  options.onProgress?.('Generating same-seed comparison');
  const offFrames = await generate(MANUAL_PHRASING);
  const onClock = musicalClock(onFrames), offClock = musicalClock(offFrames);
  const endTick = Math.min(onFrames.at(-1)!.tick + onFrames.at(-1)!.duration, offFrames.at(-1)!.tick + offFrames.at(-1)!.duration);
  options.onProgress?.('Rendering phrasing on');
  const onAudio = await renderOffline(onFrames, 0.65);
  const on = { ...signalSummary(onAudio, onClock(endTick)), ...symbolicSummary(onFrames) };
  await options.onRendered?.('Phrasing on · breathing, interplay, and solos', onAudio, onFrames);
  options.onProgress?.('Rendering phrasing off');
  const offAudio = await renderOffline(offFrames, 0.65);
  const off = { ...signalSummary(offAudio, offClock(endTick)), ...symbolicSummary(offFrames) };
  await options.onRendered?.('Phrasing off · same seed and form', offAudio, offFrames);
  const restMap = new Map<string, PhraseRest>();
  for (const frame of onFrames) for (const rest of frame.phrase?.rests ?? []) {
    if (rest.startTick >= endTick || rest.endTick <= onFrames[0].tick) continue;
    restMap.set(`${rest.startTick}/${rest.endTick}/${rest.scope}/${rest.voices?.join(',') ?? 'all'}`, rest);
  }
  const rests = [...restMap.values()].sort((a, b) => a.startTick - b.startTick);
  const notes = onFrames.flatMap(frame => frame.notes);
  const measurements: RestMeasurement[] = [];
  const scopes = [...new Map(rests.map(rest => [`${rest.scope}/${rest.voices?.join(',') ?? 'all'}`, rest])).values()];
  for (const representative of scopes) {
    const scope = representative.scope;
    const scopedRests = rests.filter(rest => rest.scope === scope && JSON.stringify(rest.voices) === JSON.stringify(representative.voices));
    if (!scopedRests.length) continue;
    options.onProgress?.(`Measuring ${scope} rests`);
    const scopedFrames = (frames: Frame[]) => frames.map(frame => ({ ...frame, notes: frame.notes.filter(note => restAppliesToNote(note, representative)) }));
    const scopeOn = scope === 'ensemble' ? onAudio : await renderOffline(scopedFrames(onFrames), 0.65);
    const scopeOff = scope === 'ensemble' ? offAudio : await renderOffline(scopedFrames(offFrames), 0.65);
    for (const rest of scopedRests) {
      const startTick = Math.max(onFrames[0].tick, rest.startTick), finishTick = Math.min(endTick, rest.endTick);
      if (finishTick <= startTick) continue;
      // Measure the late half of each rest, allowing the brief source release
      // and preserving the actual residual ambience in the measured signal.
      const probeTick = startTick + (finishTick - startTick) * 0.55;
      const measuredRms = windowRms(scopeOn, onClock(probeTick), onClock(finishTick));
      const withoutPhrasingRms = windowRms(scopeOff, offClock(probeTick), offClock(finishTick));
      const overlap = notes.filter(note => restAppliesToNote(note, rest) && note.tick < finishTick && note.tick + note.duration > startTick).length;
      measurements.push({ startTick, endTick: finishTick, scope, reason: rest.reason,
        durationSeconds: tidy(onClock(finishTick) - onClock(startTick)), measuredRms: tidy(measuredRms), withoutPhrasingRms: tidy(withoutPhrasingRms),
        changeDb: withoutPhrasingRms < 0.00005 ? null : tidy(dbRatio(measuredRms, withoutPhrasingRms)), overlappingNoteEvents: overlap });
    }
  }
  const checks = {
    finite: on.nonFiniteSamples === 0 && off.nonFiniteSamples === 0,
    unclipped: on.clippedSamples === 0 && off.clippedSamples === 0 && on.peak < 0.98 && off.peak < 0.98,
    audible: on.rms > 0.001 && off.rms > 0.001,
    validDurations: [...onFrames, ...offFrames].every(frame => frame.notes.every(note => Number.isFinite(note.tick) && Number.isFinite(note.duration) && note.duration > 0)),
    declaredRests: measurements.length > 0,
    eventRestsClear: measurements.every(rest => rest.overlappingNoteEvents === 0),
    measurableRestReduction: measurements.some(rest => rest.withoutPhrasingRms > 0.001 && rest.measuredRms < rest.withoutPhrasingRms * 0.65),
  };
  options.onProgress?.('Phrasing audition complete');
  return { engineVersion: ENGINE_VERSION, seed, frameCount, phrasing, passed: Object.values(checks).every(Boolean), on, off,
    rests: measurements.sort((a, b) => a.startTick - b.startTick), checks, dynamicRangeChangeDb: tidy(on.dynamicRangeDb - off.dynamicRangeDb),
    method: 'Same seed, preset, sound, and autonomous form, with phrase orchestration on/off. Full stereo OfflineAudioContext mixes are analyzed; scoped rests are measured from separately rendered lead/accompaniment stems in their late half, retaining natural effect tails. Dynamic range is the 95th/10th-percentile ratio of 100 ms RMS windows. Metrics verify signal behavior, not artistic quality.',
  };
}

/** Find a complete chosen solo passage, then render only its local context.
 * The earlier theme is a separate listening cue. PCM windows
 * around connected note boundaries test signal continuity; level comparisons
 * quantify foreground presence but do not predict a listener's preferences. */
export async function auditSoloPresence(options: {
  seed?: string;
  frameCount?: number;
  onProgress?: (stage: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
} = {}) {
  const seed = options.seed ?? 'glass-garden';
  const maximumFrames = Math.max(32, Math.min(1536, Math.round(options.frameCount ?? 768)));
  const engine = new MusicEngine({ seed, parameters: PRESETS[0].parameters, sound: DEFAULT_SOUND, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
  const generated: Frame[] = [];
  let chosen: NonNullable<Frame['phrase']>['cells'][number] | undefined;
  let soloSnapshot: NonNullable<Frame['phrase']> | undefined;
  let soloFamily: string | undefined;
  let contextBar = 1920;
  options.onProgress?.('Finding the first complete solo after its theme is established');
  for (let i = 0; i < maximumFrames; i++) {
    const frame = engine.step(); generated.push(frame);
    if (!chosen && frame.notes.some(note => note.part === 'melody' && note.voice === 6)) {
      chosen = frame.phrase?.cells.find(cell => cell.role === 'solo');
      soloSnapshot = frame.phrase; contextBar = frame.form?.barTicks ?? 1920;
      soloFamily = frame.form?.themeId ?? chosen?.ideaId;
    }
    if (chosen && frame.tick + frame.duration >= chosen.endTick + contextBar) break;
    if (i % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!chosen || !soloSnapshot) throw new Error(`No established-theme solo was generated within the ${maximumFrames}-frame audit limit for seed ${seed}.`);
  if (generated.at(-1)!.tick + generated.at(-1)!.duration < chosen.endTick + contextBar) throw new Error('The audit frame limit ended before the chosen solo and its context were complete.');
  const history = symbolicSummary(generated), pieceClock = musicalClock(generated);
  const generatedNotes = generated.flatMap(frame => frame.notes);
  const frames = generated.filter(frame => frame.tick + frame.duration > Math.max(0, chosen!.startTick - contextBar) && frame.tick < chosen!.endTick + contextBar);
  const frameCount = generated.length;
  const clock = musicalClock(frames);
  const passage = frames.flatMap(frame => frame.notes).filter(note => note.part === 'melody' && note.voice === 6 && note.tick >= chosen!.startTick && note.tick < chosen!.endTick).sort((a, b) => a.tick - b.tick);
  if (!passage.length) throw new Error('The chosen solo window had no actual sounding solo events.');
  const startTick = passage[0].tick, endTick = Math.max(...passage.map(note => note.tick + note.duration));
  const startTime = clock(startTick), endTime = clock(endTick);
  const musicalEnd = clock(frames.at(-1)!.tick + frames.at(-1)!.duration);
  const completedThemeChain = (frame: Frame) => {
    if (!frame.phrase?.composition) return false;
    const shortPhrases = frame.phrase.composition.shortPhrases;
    if (shortPhrases?.length) {
      return new Set(shortPhrases.map(phrase => phrase.motifId)).size >= 2 && shortPhrases.every(phrase => {
        const actual = generatedNotes.filter(note => [5, 7].includes(note.voice) && note.expression?.role === 'anchor'
          && note.tick >= phrase.startTick && note.tick < phrase.endTick);
        return actual.length >= phrase.coreNotes;
      });
    }
    const leadCells = frame.phrase.cells.filter(cell => cell.role === 'theme' || cell.role === 'counter');
    const motifs = frame.phrase.composition.motifs.filter(motif => leadCells.some(cell => cell.startTick === motif.startTick && cell.endTick === motif.endTick));
    // The composed recipe has four structural notes per motif. Ornaments and
    // bass/drum exchanges cannot stand in for a missing part of the tune.
    return motifs.length >= 3 && motifs.every(motif => new Set(generatedNotes.filter(note => note.part === 'melody'
      && note.expression?.role === 'anchor' && note.tick >= motif.startTick && note.tick < motif.endTick).map(note => note.expression!.sourceId).filter(Boolean)).size >= 4);
  };
  const themeFrame = generated.find(frame => frame.tick < chosen!.startTick && frame.form?.role === 'theme' && frame.form.themeId === soloFamily
    && frame.phrase?.leadRole !== 'solo' && completedThemeChain(frame));
  const themeFrames = themeFrame?.phrase ? generated.filter(frame => frame.tick + frame.duration > themeFrame.phrase!.startTick && frame.tick < themeFrame.phrase!.endTick) : [];
  if (themeFrames.length) {
    options.onProgress?.('Rendering the earlier complete theme for comparison');
    await options.onRendered?.(`Earlier theme · ${themeFrame!.phrase!.themeName}`, await renderOffline(themeFrames, 0.65), themeFrames);
  }
  const stems = {} as Record<'mix' | 'solo' | 'backing' | 'rhythm', AudioBuffer>;
  const summaries = {} as Record<keyof typeof stems, SignalSummary>;
  for (const kind of ['mix', 'solo', 'backing', 'rhythm'] as const) {
    options.onProgress?.(`Rendering ${kind} for the first solo passage`);
    const selected = frames.map(frame => ({ ...frame, notes: frame.notes.filter(note => {
      const solo = note.part === 'melody' && note.voice === 6;
      return kind === 'mix' || (kind === 'solo' ? solo : kind === 'backing' ? !solo : note.part === 'percussion');
    }) }));
    stems[kind] = await renderOffline(selected, 0.65);
    summaries[kind] = signalSummary(stems[kind], musicalEnd);
    const label = kind === 'mix' ? 'First solo · complete mix' : kind === 'solo' ? 'First solo · isolated lead' : kind === 'backing' ? 'First solo · accompaniment without lead' : 'First solo · rhythm alone';
    await options.onRendered?.(label, stems[kind], frames);
  }
  const soloRms = windowRms(stems.solo, startTime, endTime), backingRms = windowRms(stems.backing, startTime, endTime);
  const percussion = frames.flatMap(frame => frame.notes).filter(note => note.part === 'percussion');
  const rhythmAttacks = [36, 38, 42].map(midiNote => {
    const hits = percussion.filter(note => note.midiNote === midiNote);
    const levels = hits.map(note => { const time = clock(note.tick); return windowRms(stems.rhythm, time + 0.003, time + 0.065); }).sort((a, b) => a - b);
    const count = levels.length;
    return { midiNote, hits: count, medianAttackRms: tidy(levels[Math.floor(count / 2)] ?? 0),
      meanAttackRms: tidy(levels.reduce((sum, value) => sum + value, 0) / Math.max(1, count)),
      maxAttackRms: tidy(levels.at(-1) ?? 0), meanVelocity: tidy(hits.reduce((sum, note) => sum + note.velocity, 0) / Math.max(1, count)) };
  });
  const boundaries = passage.slice(1).flatMap((next, index) => {
    const previous = passage[index];
    if (previous.tick + previous.duration < next.tick || previous.timbre !== next.timbre || previous.endPitch || next.endPitch) return [];
    const time = clock(next.tick);
    const beforeRms = windowRms(stems.solo, time - 0.06, time - 0.025);
    const boundaryRms = windowRms(stems.solo, time - 0.015, time + 0.015);
    const afterRms = windowRms(stems.solo, time + 0.025, time + 0.06);
    const relativeLevel = boundaryRms / Math.max(1e-9, Math.min(beforeRms, afterRms));
    return [{ tick: next.tick, beforeRms: tidy(beforeRms), boundaryRms: tidy(boundaryRms), afterRms: tidy(afterRms),
      boundaryToNeighbourRatio: tidy(relativeLevel), continuous: boundaryRms > 0.001 && relativeLevel > 0.25 }];
  });
  const pauses = passage.slice(1).flatMap((next, index) => {
    const previousEnd = passage[index].tick + passage[index].duration;
    if (next.tick - previousEnd < PPQ / 8) return [];
    const from = clock(previousEnd), to = clock(next.tick);
    return [{ startTick: previousEnd, endTick: next.tick, seconds: tidy(to - from),
      sourceNoteOverlap: passage.some(note => note.tick < next.tick && note.tick + note.duration > previousEnd),
      soloTailRms: tidy(windowRms(stems.solo, from + (to - from) * .5, to)),
      beforePauseRms: tidy(windowRms(stems.solo, from - .06, from - .01)) }];
  });
  const gestures = soloSnapshot.cells.filter(cell => cell.role === 'solo' && !(cell.startTick === chosen!.startTick && cell.endTick === chosen!.endTick && cell.label === chosen!.label));
  const flight = gestures.find(gesture => gesture.label === 'A brief connected run');
  const flightNotes = flight ? passage.filter(note => note.tick >= flight.startTick && note.tick < flight.endTick) : [];
  const flightBoundaries = flight ? boundaries.filter(boundary => boundary.tick > flight.startTick && boundary.tick < flight.endTick) : [];
  const excerptNotes = frames.flatMap(frame => frame.notes);
  const structuralCues = [...new Map(frames.flatMap(frame => frame.phrase?.composition?.cues ?? []).map(cue => [`${cue.id}:${cue.tick}`, cue])).values()]
    .filter(cue => cue.tick >= startTick && cue.tick < endTick);
  const supportNotes = excerptNotes.filter(note => note.id.startsWith('ensemble:') && note.expression?.role === 'support' && note.tick >= startTick && note.tick < endTick);
  const velocitySummary = (role: 'anchor' | 'ornament') => {
    const selected = passage.filter(note => note.expression?.role === role);
    return { notes: selected.length, meanVelocity: selected.length ? tidy(selected.reduce((sum, note) => sum + note.velocity, 0) / selected.length) : null,
      minimumVelocity: selected.length ? Math.min(...selected.map(note => note.velocity)) : null,
      maximumVelocity: selected.length ? Math.max(...selected.map(note => note.velocity)) : null };
  };
  const coordination = {
    anchors: velocitySummary('anchor'), ornaments: velocitySummary('ornament'), supportNotes: supportNotes.length,
    cues: structuralCues.map(cue => {
      const atCue = excerptNotes.filter(note => note.tick === cue.tick);
      const supported = atCue.filter(note => note.expression?.cueId === cue.id && note.expression.role === 'support');
      return { id: cue.id, tick: cue.tick, kind: cue.kind, strength: cue.strength,
        soundingParts: [...new Set(atCue.map(note => note.part))], coordinatedParts: [...new Set(supported.map(note => note.part))],
        supportNotes: supported.length,
        actualAttackRms: tidy(windowRms(stems.mix, clock(cue.tick) + .01, clock(cue.tick) + .09)) };
    }),
  };
  const checks = {
    finite: Object.values(summaries).every(summary => summary.nonFiniteSamples === 0),
    unclipped: Object.values(summaries).every(summary => summary.clippedSamples === 0 && summary.peak < 0.98),
    substantialSolo: passage.length >= 12 && endTime - startTime >= 3,
    audibleSoloStem: soloRms > 0.003,
    measurableForegroundLevel: soloRms > backingRms * 0.25,
    priorCompleteTheme: themeFrames.length > 0,
    connectedBoundaries: boundaries.length >= 1 && boundaries.every(boundary => boundary.continuous),
    connectedFlight: !flight || flightNotes.length >= 3 && flightBoundaries.length >= flightNotes.length - 1,
    deliberateBreaths: pauses.length > 0 && pauses.every(pause => !pause.sourceNoteOverlap),
    supportUsesDeclaredCues: supportNotes.every(note => structuralCues.some(cue => cue.id === note.expression!.cueId && cue.tick === note.tick)),
  };
  return { engineVersion: ENGINE_VERSION, seed, frameCount, passed: Object.values(checks).every(Boolean), checks,
    eventHash: history.eventHash, history,
    renderedFrames: frames.length, renderedStartTick: frames[0].tick, renderedMusicalSeconds: tidy(musicalEnd),
    earlierTheme: themeFrame?.phrase ? { name: themeFrame.phrase.themeName, familyId: soloFamily, startTick: themeFrame.phrase.startTick, endTick: themeFrame.phrase.endTick, frames: themeFrames.length } : null,
    firstSolo: { startTick, endTick, startSeconds: tidy(pieceClock(startTick)), localStartSeconds: tidy(startTime), durationSeconds: tidy(endTime - startTime), notes: passage.length,
      themeName: soloSnapshot.themeName, argument: chosen.label, gestures,
      soloRms: tidy(soloRms), backingRms: tidy(backingRms), soloToBackingDb: tidy(dbRatio(soloRms, backingRms)),
      connectedNoteBoundaries: boundaries.length, flightNotes: flightNotes.length, flightConnectedBoundaries: flightBoundaries.length,
      excerptStartSeconds: tidy(pieceClock(frames[0].tick)), excerptEndSeconds: tidy(pieceClock(frames.at(-1)!.tick + frames.at(-1)!.duration)) },
    signals: summaries, boundaries, pauses, rhythmAttacks, coordination,
    method: 'Generate only until the first chosen solo and one following bar are complete (bounded search), keeping a symbolic history. Render the actual solo cell with one bar of context on either side, rounded to frame boundaries, as mix, solo, accompaniment, and rhythm; separately render an earlier complete theme phrase from the same family. Whole-piece and excerpt-local times are reported separately. Independent stem RMS compares levels over the solo span; 30 ms PCM windows around overlapping same-color boundaries check continuity, and every note of a declared brief flight must connect. Deliberate source-event gaps are checked and their remaining natural ambience is measured, without demanding silent reverb. Coordination reports actual simultaneous parts and support-event links at declared structural cues, their 10–90 ms mixed PCM level, and written anchor/ornament velocity ranges. Attack windows may include coincident hits or sustaining notes; they are not isolated-instrument loudness measurements. Stem effects and nonlinear compression prevent an exact additive decomposition. These measurements establish signal presence and continuity, not artistic quality.',
  };
}
