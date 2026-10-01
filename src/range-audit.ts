import { renderOffline } from './audio';
import { DEFAULT_CONDUCTOR } from './conductor';
import { MusicEngine, eventHash } from './engine';
import { createPerformance } from './serialization';
import { normalizeParameters } from './parameters';
import { ENGINE_VERSION, FRAME_TICKS, PPQ, type Frame, type NoteEvent, type Performance } from './types';
import { DEFAULT_SOUND } from './spectrum';
import { DEFAULT_COMPOSITION } from './composition';

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const tidy = (value: number) => Math.round(value * 1e7) / 1e7;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
export interface RangeCase { id: string; label: string; ideaDensity: number; ensembleSize: number; recipe: Performance; }

/** A controlled two-axis experiment. Everything except idea density and player
 * count is identical, including seed, tempo, tuning, expression and automation.
 * This is an audition fixture, not a new compositional mode or a preset claim. */
export function rangeCases(seed = 'range-integration'): RangeCase[] {
  const base = createPerformance(seed);
  base.sound = structuredClone(DEFAULT_SOUND);
  base.conductor = { ...DEFAULT_CONDUCTOR, enabled: true, amount: 0, tuningTravel: false };
  base.phrasing = { ...base.phrasing!, composition: { ...DEFAULT_COMPOSITION, ...base.phrasing!.composition, dynamicRange: 0 } };
  base.initialParameters = normalizeParameters({ ...base.initialParameters, tempo: 88, melodicActivity: .85,
    rhythmicDensity: .8, rhythmicComplexity: .65, rhythmicPredictability: .65, metricStability: .55,
    voiceLeading: .92, tension: .5, dynamics: .65, texturalDensity: .7 });
  base.automation = []; base.automationRevisions = [];
  return [
    { id: 'spacious-solo', label: 'A · Spacious solo', ideaDensity: 0, ensembleSize: 0 },
    { id: 'dense-solo', label: 'B · Dense solo', ideaDensity: 1, ensembleSize: 0 },
    { id: 'spacious-ensemble', label: 'C · Spacious full ensemble', ideaDensity: 0, ensembleSize: 1 },
    { id: 'dense-ensemble', label: 'D · Dense full ensemble', ideaDensity: 1, ensembleSize: 1 },
  ].map(item => ({ ...item, recipe: { ...structuredClone(base), initialParameters: { ...base.initialParameters,
    ideaDensity: item.ideaDensity, ensembleSize: item.ensembleSize } } }));
}

const make = (recipe: Performance) => new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters,
  conductor: recipe.conductor, phrasing: recipe.phrasing, sound: recipe.sound, weights: recipe.weights,
  automation: recipe.automation, automationRevisions: recipe.automationRevisions });

/** Compose through the complete first spacious thematic argument, then use its
 * exact tick interval for every cell of the matrix. Dense versions may state
 * several shorter arguments in this interval; counts are normalized by beats.
 * This keeps comparison durations honest and avoids selecting flattering peaks. */
export async function generateRangeMatrix(options: { seed?: string; onProgress?: (message: string) => void } = {}) {
  const cases = rangeCases(options.seed), output: Array<RangeCase & { frames: Frame[] }> = [];
  let startTick = -1, endTick = -1;
  for (const item of cases) {
    const engine = make(item.recipe), frames: Frame[] = [];
    for (let index = 0; index < 160; index++) {
      const frame = engine.step();
      if (startTick < 0 && frame.form?.role === 'theme' && frame.phrase?.themeCore) {
        startTick = frame.phrase.startTick; endTick = frame.phrase.endTick;
        if (endTick <= startTick || endTick - startTick > PPQ * 128) throw new Error('The first argument exceeds the bounded audition window.');
      }
      if (startTick >= 0 && frame.tick >= startTick && frame.tick < endTick) frames.push(frame);
      if (index % 8 === 7) { options.onProgress?.(`Composing ${item.label} · ${index + 1} frames`); await pause(); }
      if (endTick >= 0 && frame.tick + frame.duration >= endTick) break;
    }
    if (!frames.length || frames.at(-1)!.tick + frames.at(-1)!.duration < endTick) throw new Error('No complete thematic argument within160 frames.');
    output.push({ ...item, frames });
    await pause();
  }
  return { seed: cases[0].recipe.seed, startTick, endTick, cases: output };
}

/** Event metrics describe the score, not perceived quality or native node use. */
export function rangeScoreSummary(frames: Frame[]) {
  const notes = frames.flatMap(frame => frame.notes), lead = notes.filter(note => note.voice === 5 && note.absolutePitch).sort((a, b) => a.tick - b.tick);
  const beats = frames.reduce((sum, frame) => sum + frame.duration / PPQ, 0);
  const pitched = notes.filter(note => note.absolutePitch), attacks = lead.map(note => note.tick);
  const intervals = attacks.slice(1).map((tick, index) => (tick - attacks[index]) / PPQ);
  const cents = lead.map(note => note.absolutePitch!.millicents / 1000);
  const sources = new Set(pitched.map(note => note.expression?.sourceId ?? note.id));
  const shared = new Map<number, Set<string>>();
  for (const note of notes) { const set = shared.get(note.tick) ?? new Set(); set.add(note.part); shared.set(note.tick, set); }
  const voiceGroups = new Map<number, NoteEvent[]>();
  for (const note of pitched) { const list = voiceGroups.get(note.voice) ?? []; list.push(note); voiceGroups.set(note.voice, list); }
  const boundaries: Array<{ tick: number; change: number }> = [];
  for (const list of voiceGroups.values()) {
    list.sort((a, b) => a.tick - b.tick);
    for (let index = 0; index < list.length; index++) {
      const note = list[index]; let end = Math.min(note.tick + note.duration, list[index + 1]?.tick ?? Infinity);
      for (const frame of frames) for (const rest of frame.phrase?.rests ?? []) {
        const applies = (!rest.voices || rest.voices.includes(note.voice)) && (rest.scope === 'ensemble'
          || (rest.scope === 'lead' ? note.part === 'melody' : note.part !== 'melody'));
        if (applies && rest.startTick >= note.tick) end = Math.min(end, rest.startTick);
      }
      if (end > note.tick) boundaries.push({ tick: note.tick, change: 1 }, { tick: end, change: -1 });
    }
  }
  boundaries.sort((a, b) => a.tick - b.tick || a.change - b.change);
  let playing = 0, maximum = 0;
  for (const point of boundaries) { playing += point.change; maximum = Math.max(maximum, playing); }
  return { eventHash: eventHash(notes), noteEvents: notes.length, beats,
    leadNoteEvents: lead.length, leadAttacksPerBeat: tidy(lead.length / Math.max(1, beats)),
    medianLeadOnsetGapBeats: tidy(median(intervals)), medianLeadGateBeats: tidy(median(lead.map(note => note.duration / PPQ))),
    leadRangeMidiEquivalent: cents.length ? [tidy(Math.min(...cents) / 100), tidy(Math.max(...cents) / 100)] : [],
    leadFingerprint: eventHash(lead.map(({ id: _id, expression: _expression, ...note }) => ({ ...note, id: `${note.tick}:${note.voice}` }))),
    pitchedVoices: [...voiceGroups.keys()].sort((a, b) => a - b), maximumSimultaneousPitchedVoices: maximum,
    instrumentColors: [...new Set(pitched.map(note => note.timbre).filter(Boolean))].sort(),
    sourceIdentities: sources.size, percussionEvents: notes.filter(note => note.part === 'percussion').length,
    sharedBackingOnsets: [...shared.values()].filter(parts => ['bass', 'harmony', 'percussion'].every(part => parts.has(part))).length,
    partCounts: Object.fromEntries(['melody', 'harmony', 'bass', 'percussion'].map(part => [part, notes.filter(note => note.part === part).length])),
    authoredArguments: new Set(frames.map(frame => frame.phrase?.themeCore && `${frame.phrase.startTick}:${frame.phrase.themeCore.id}`)).size,
    riffTreatments: [...new Set(frames.flatMap(frame => frame.diagnostics.compositionExpression?.rhythm?.treatment ?? []))],
  };
}

function signal(buffer: AudioBuffer, musicalSeconds: number) {
  const limit = Math.min(buffer.length, Math.ceil(musicalSeconds * buffer.sampleRate));
  let nonFiniteSamples = 0, clippedSamples = 0, peak = 0, square = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      const value = data[index];
      if (!Number.isFinite(value)) { nonFiniteSamples++; continue; }
      peak = Math.max(peak, Math.abs(value));
      if (Math.abs(value) >= .999) clippedSamples++;
      if (index < limit) { square += value * value; count++; }
    }
  }
  return { sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, renderedSeconds: tidy(buffer.duration),
    nonFiniteSamples, clippedSamples, peak: tidy(peak), musicalRms: tidy(Math.sqrt(square / Math.max(1, count))) };
}

/** Actual production Web Audio renders. PCM levels establish signal and
 * headroom; they cannot establish taste, expressiveness or resemblance to a
 * reference performer. Each returned player is available for human listening. */
export async function auditRange(options: {
  seed?: string;
  onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
} = {}) {
  const matrix = await generateRangeMatrix(options);
  const reports: Array<ReturnType<typeof rangeScoreSummary> & { id: string; label: string; ideaDensity: number;
    ensembleSize: number; frameCount: number; musicalSeconds: number; signal: ReturnType<typeof signal> }> = [];
  for (const item of matrix.cases) {
    options.onProgress?.(`Rendering ${item.label} with the production instrument rack`); await pause();
    const buffer = await renderOffline(item.frames, .65);
    const musicalSeconds = item.frames.reduce((sum, frame) => sum + frame.duration * 60 / frame.parameters.tempo / PPQ, 0);
    reports.push({ id: item.id, label: item.label, ideaDensity: item.ideaDensity, ensembleSize: item.ensembleSize,
      frameCount: item.frames.length, musicalSeconds: tidy(musicalSeconds), ...rangeScoreSummary(item.frames), signal: signal(buffer, musicalSeconds) });
    await options.onRendered?.(item.label, buffer, item.frames); await pause();
  }
  const [sparseSolo, denseSolo, sparseFull, denseFull] = reports;
  const checks = {
    fixedSeedTempoTuning: matrix.cases.every(item => item.recipe.seed === matrix.seed && item.frames.every(frame => frame.parameters.tempo === 88 && frame.sound.tuning === '12tet')),
    sameMusicalWindow: reports.every(item => item.frameCount === reports[0].frameCount && item.musicalSeconds === reports[0].musicalSeconds),
    sparseReallySpacious: sparseSolo.leadAttacksPerBeat < .75 && sparseSolo.medianLeadOnsetGapBeats >= 1,
    denseReallyFaster: denseSolo.leadAttacksPerBeat > 1.5 && denseSolo.leadAttacksPerBeat > sparseSolo.leadAttacksPerBeat * 3,
    soloReallyOneVoice: [sparseSolo, denseSolo].every(item => item.pitchedVoices.length === 1 && item.pitchedVoices[0] === 5 && item.percussionEvents === 0),
    fullReallyMorePlayers: [sparseFull, denseFull].every(item => item.maximumSimultaneousPitchedVoices >= 8 && item.instrumentColors.length >= 4 && item.percussionEvents > 0),
    sameForegroundAcrossPlayerCounts: sparseSolo.leadFingerprint === sparseFull.leadFingerprint && denseSolo.leadFingerprint === denseFull.leadFingerprint,
    finiteUnclipped: reports.every(item => item.signal.nonFiniteSamples === 0 && item.signal.clippedSamples === 0 && item.signal.peak < .98),
    measurableSignal: reports.every(item => item.signal.musicalRms > .001),
  };
  return { engineVersion: ENGINE_VERSION, seed: matrix.seed, startTick: matrix.startTick, endTick: matrix.endTick,
    method: 'Controlled idea-density × ensemble-size matrix. Same seed,88BPM,12-TET,Freedom0,shared expression breadth0,activity/density fixed. All four use the complete first spacious theme argument’s tick window. Actual production OfflineAudioContext PCM; simultaneous player counts respect replacement and written rests. Event/source counts are not oscillator counts. No subjective listening claim.',
    note: 'The spacious and dense cases develop the same seed with different authored note density. Changing only ensemble size preserves the foreground exactly. Players expose the actual renders for listening.',
    checks, passed: Object.values(checks).every(Boolean), cases: reports };
}
