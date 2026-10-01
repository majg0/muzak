import { AudioPlayer, type AudioPlayerDiagnostics } from './audio';
import { MusicEngine, eventHash } from './engine';
import { PRESETS } from './parameters';
import { createPerformance } from './serialization';
import { ENGINE_VERSION, FRAME_TICKS, PPQ, type Frame, type Performance } from './types';
import { explorationPerformance } from './exploration';

export interface LiveAudioSample extends AudioPlayerDiagnostics {
  elapsed: number;
  generatedFrames: number;
  audibleFrames: number;
  lastGeneratedTick: number | null;
  lastAudibleTick: number | null;
  lastGenerationMs: number;
}

export interface LiveCrestSelection {
  startTick: number; endTick: number; barTicks: number; tempo: number;
  meanEnergy: number; meanActivity: number; meanDensity: number; attacksPerBeat: number;
  score: number; examinedFrames: number; examinedThroughTick: number;
  reason: 'first-dense-window' | 'strongest-observed-window';
  explanation: string;
}
const engineFor = (recipe: Performance) => new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters,
  automation: recipe.automation, automationRevisions: recipe.automationRevisions, weights: recipe.weights,
  sound: recipe.sound, conductor: recipe.conductor, phrasing: recipe.phrasing });

/** Observe a bounded real score, including automation knowledge and final
 * emitted attacks. This probe is discarded; playback plans its own fresh
 * continuation after reconstructing the selected position. */
export async function selectLiveCrest(recipe: Performance, options: {
  maxFrames?: number; signal?: AbortSignal; onPreparing?: (message: string) => void;
} = {}): Promise<LiveCrestSelection> {
  const requested = options.maxFrames ?? 384;
  const limit = Math.max(8, Math.min(384, Math.floor(Number.isFinite(requested) ? requested : 384)));
  const engine = engineFor(structuredClone(recipe)), recent: Frame[] = [];
  let best: LiveCrestSelection | undefined;
  for (let index = 0; index < limit; index++) {
    if (options.signal?.aborted) throw new DOMException('Live audit preparation was stopped.', 'AbortError');
    recent.push(engine.step());
    if (recent.length > 8) recent.shift();
    if (recent.length === 8) {
      const average = (reading: (frame: Frame) => number) => recent.reduce((sum, frame) => sum + reading(frame), 0) / recent.length;
      const meanEnergy = average(frame => frame.diagnostics.compositionExpression!.energy);
      const meanActivity = average(frame => frame.diagnostics.compositionExpression!.activity);
      const meanDensity = average(frame => frame.parameters.rhythmicDensity * .7 + frame.parameters.ideaDensity * .3);
      const attacksPerBeat = recent.reduce((sum, frame) => sum + frame.notes.length, 0) / recent.reduce((sum, frame) => sum + frame.duration / PPQ, 0);
      const dense = meanEnergy >= .65 && meanActivity >= .62 && meanDensity >= .55 && attacksPerBeat >= 2;
      const score = meanEnergy * .3 + meanActivity * .3 + meanDensity * .2 + Math.min(1, attacksPerBeat / 8) * .2;
      const choice: LiveCrestSelection = { startTick: recent[0].tick, endTick: recent.at(-1)!.tick + recent.at(-1)!.duration,
        barTicks: recent[0].form!.barTicks, tempo: recent[0].parameters.tempo,
        meanEnergy, meanActivity, meanDensity, attacksPerBeat, score, examinedFrames: index + 1, examinedThroughTick: engine.tick,
        reason: dense ? 'first-dense-window' : 'strongest-observed-window',
        explanation: dense ? 'First eight-frame window with mean energy ≥0.65, activity ≥0.62, density ≥0.55 and at least two emitted attacks per quarter note.'
          : `No window met every dense threshold in the first ${limit} frames; selected the strongest observed combination of energy, activity, density and emitted attacks.` };
      if (dense) return choice;
      if (!best || choice.score > best.score) best = choice;
    }
    if ((index + 1) % 8 === 0) {
      options.onPreparing?.(`Finding an actual dense passage · ${index + 1} / ${limit} probe frames`);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  return { ...best!, examinedFrames: limit, examinedThroughTick: engine.tick };
}

/** A real-time transport probe: unlike offline rendering this exercises timers,
 * browser context state, source.onended cleanup, and the live audio graph.
 * Invoke from a button gesture. A supplied performance is cloned and never
 * written to local storage. Intentional musical rests remain part of the run. */
export async function auditLiveAudio(options: {
  performance?: Performance;
  durationSeconds?: number;
  /** Seek to an observed dense window, then resume fresh live planning. */
  startAt?: 'opening' | 'first-crest';
  onPreparing?: (message: string) => void;
  /** Audit-page-only simulation of a missing AudioParam method. */
  forceHoldFallback?: boolean;
  signal?: AbortSignal;
  onProgress?: (sample: LiveAudioSample) => void;
} = {}) {
  const baseline = createPerformance('velvet-orbit', PRESETS[0]);
  const recipe = structuredClone(options.performance ?? (options.startAt === 'first-crest' ? explorationPerformance(baseline, baseline.seed).recipe : baseline));
  let durationSeconds = Math.max(10, Math.min(120, options.durationSeconds ?? 30));
  const engine = engineFor(recipe);
  const seekStarted = performance.now();
  let preparationFrames = 0, selectedCrestTick: number | null = null, crestSelection: LiveCrestSelection | null = null;
  if (options.startAt === 'first-crest') {
    crestSelection = await selectLiveCrest(recipe, options);
    options.onPreparing?.(crestSelection.explanation);
    selectedCrestTick = crestSelection.startTick;
    const start = Math.floor(Math.max(0, selectedCrestTick - crestSelection.barTicks) / FRAME_TICKS) * FRAME_TICKS;
    while (engine.tick < start) {
      if (options.signal?.aborted) throw new DOMException('Live audit preparation was stopped.', 'AbortError');
      engine.step(); preparationFrames++;
      if (preparationFrames > 384) throw new Error('The selected passage exceeds the bounded live-audit preparation window.');
      if (preparationFrames % 8 === 0) {
        options.onPreparing?.(`Preparing the selected passage · ${preparationFrames} prior frames reconstructed · tick ${engine.tick} / ${start}`);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    // A full eight-bar window follows the same engine cursor. No stress-frame
    // cache hides planning work from the actual AudioPlayer timer.
    durationSeconds = Math.min(120, Math.max(durationSeconds, 8 * crestSelection.barTicks * 60 / crestSelection.tempo / PPQ + 2));
  }
  const preparationMs = performance.now() - seekStarted, startTick = engine.tick;
  const generated: Frame[] = [], audible: Array<{ elapsed: number; tick: number }> = [];
  const statuses: Array<{ elapsed: number; playing: boolean }> = [];
  const errors: Array<{ elapsed: number; message: string; stack?: string }> = [];
  const samples: LiveAudioSample[] = [];
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;
  let lastGenerationMs = 0, finish: (() => void) | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const recordError = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    errors.push({ elapsed: elapsed(), message: error.message, stack: error.stack });
  };
  const holdDescriptor = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
  const nativeHoldSupported = typeof AudioParam.prototype.cancelAndHoldAtTime === 'function';
  if (options.forceHoldFallback) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', { configurable: true, writable: true, value: undefined });
  const player = new AudioPlayer({
    nextFrame: () => {
      const begin = performance.now(); const frame = engine.step(); lastGenerationMs = performance.now() - begin;
      generated.push(frame); return frame;
    },
    onFrame: frame => { audible.push({ elapsed: elapsed(), tick: frame.tick }); },
    onStatus: playing => { statuses.push({ elapsed: elapsed(), playing }); },
    onError: error => { recordError(error); },
  });
  player.setVolume(0.65);
  const sample = () => {
    const next = { ...player.diagnostics, elapsed: elapsed(), generatedFrames: generated.length, audibleFrames: audible.length,
      lastGeneratedTick: generated.at(-1)?.tick ?? null, lastAudibleTick: audible.at(-1)?.tick ?? null, lastGenerationMs };
    samples.push(next);
    options.onProgress?.(next);
  };
  const globalError = (event: ErrorEvent) => recordError(event.error ?? event.message);
  const rejected = (event: PromiseRejectionEvent) => recordError(event.reason);
  const visibility: Array<{ elapsed: number; state: DocumentVisibilityState }> = [{ elapsed: 0, state: document.visibilityState }];
  const visibilityChange = () => visibility.push({ elapsed: elapsed(), state: document.visibilityState });
  window.addEventListener('error', globalError); window.addEventListener('unhandledrejection', rejected);
  document.addEventListener('visibilitychange', visibilityChange);
  const abort = () => finish?.();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await player.play(); sample();
    if (!options.signal?.aborted) await new Promise<void>(resolve => {
      finish = resolve;
      timer = setInterval(() => {
        try { sample(); }
        catch (error) { recordError(error); resolve(); }
        if (elapsed() >= durationSeconds || errors.length) resolve();
      }, 100);
    });
  } catch (error) { recordError(error); }
  finally {
    if (timer !== undefined) clearInterval(timer);
    options.signal?.removeEventListener('abort', abort);
    window.removeEventListener('error', globalError); window.removeEventListener('unhandledrejection', rejected);
    document.removeEventListener('visibilitychange', visibilityChange);
    player.dispose();
    if (options.forceHoldFallback) {
      if (holdDescriptor) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', holdDescriptor);
      else Reflect.deleteProperty(AudioParam.prototype, 'cancelAndHoldAtTime');
    }
  }
  const chunks = Array.from({ length: Math.ceil(durationSeconds / 5) }, (_, index) => {
    const from = index * 5, to = Math.min(durationSeconds, from + 5);
    const selected = samples.filter(sample => sample.elapsed >= from && sample.elapsed < to);
    return { from, to, samples: selected.length, audibleSamples: selected.filter(sample => sample.rms > 0.0005).length,
      rms: selected.length ? Math.sqrt(selected.reduce((sum, sample) => sum + sample.rms * sample.rms, 0) / selected.length) : 0,
      peak: Math.max(0, ...selected.map(sample => sample.peak)),
      firstTick: selected[0]?.currentTick ?? null, lastTick: selected.at(-1)?.currentTick ?? null,
      contextStates: [...new Set(selected.map(sample => sample.contextState))] };
  });
  const completed = (samples.at(-1)?.elapsed ?? 0) >= durationSeconds - 0.2 && !options.signal?.aborted;
  const lateSamples = samples.filter(sample => sample.elapsed >= 5);
  const checks = {
    completed,
    noErrors: errors.length === 0,
    clockAdvances: (lateSamples.at(-1)?.renderTime ?? 0) > 5 && (lateSamples.at(-1)?.currentTick ?? 0) > 960,
    repeatedFrames: generated.length >= 6 && audible.length >= 5,
    audibleAfterFirstBeat: lateSamples.some(sample => sample.rms > 0.001),
    finiteUnclipped: samples.every(sample => Number.isFinite(sample.rms) && Number.isFinite(sample.peak) && sample.peak < 0.98),
    noSchedulingDeadlineMisses: samples.every(sample => sample.underruns === 0 && sample.lateNoteTasks === 0),
    crestReached: selectedCrestTick === null || audible.some(frame => frame.tick >= selectedCrestTick!),
  };
  const timing = {
    maxPlanningMs: Math.max(0, ...samples.map(sample => sample.maxPlanningMs)),
    maxSchedulingMs: Math.max(0, ...samples.map(sample => sample.maxSchedulingMs)),
    maxPumpGapMs: Math.max(0, ...samples.map(sample => sample.maxPumpGapMs)),
    peakSourceCount: Math.max(0, ...samples.map(sample => sample.peakSourceCount)),
    maxNotesPerPump: Math.max(0, ...samples.map(sample => sample.maxNotesPerPump)),
    underruns: Math.max(0, ...samples.map(sample => sample.underruns)),
    lateNoteTasks: Math.max(0, ...samples.map(sample => sample.lateNoteTasks)),
    maxLatenessMs: Math.max(0, ...samples.map(sample => sample.maxLatenessMs)),
    lookAheadSeconds: samples[0]?.lookAheadSeconds ?? null,
  };
  return { engineVersion: ENGINE_VERSION, seed: recipe.seed, durationSeconds, completed, aborted: Boolean(options.signal?.aborted),
    passed: Object.values(checks).every(Boolean), checks, nativeHoldSupported, forcedHoldFallback: Boolean(options.forceHoldFallback), automationLanes: recipe.automation.length,
    initialTempo: recipe.initialParameters.tempo, sound: recipe.sound, conductor: recipe.conductor, phrasing: recipe.phrasing,
    generatedFrames: generated.length, audibleFrames: audible.length, eventHash: eventHash(generated.flatMap(frame => frame.notes)),
    startAt: options.startAt ?? 'opening', startTick, selectedCrestTick, crestSelection, preparationFrames, preparationMs, timing,
    notesPerFrame: { maximum: Math.max(0, ...generated.map(frame => frame.notes.length)), mean: generated.reduce((sum, frame) => sum + frame.notes.length, 0) / Math.max(1, generated.length) },
    audibleBars: audible.length ? (generated.find(frame => frame.tick === audible.at(-1)!.tick)?.form?.bar ?? 0) - (generated[0]?.form?.bar ?? 0) : 0,
    chunks, statuses, errors, visibility, audible, samples,
    method: 'Real AudioPlayer and real AudioContext for 30 seconds by default. First-crest mode observes up to 384 real probe frames, selects the first qualifying dense eight-frame window or the strongest observed fallback, then discards the probe. A separate engine reconstructs to roughly one bar before that passage in yielding batches and performs fresh synchronous planning during playback for at least an eight-bar nominal window. Selection reasons and measured values are reported explicitly; no climax role is required. Every 100 ms the analyser, context state, render/output clocks, queues, source count, planner/scheduler costs, and deadline counters are sampled. Deadline misses measure JavaScript scheduling, not device-level dropouts. The saved performance is read-only; the default recipe is Wide exploration. This tests transport and signal, not subjective musical quality.',
  };
}
