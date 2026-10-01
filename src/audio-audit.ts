import { renderOffline, encodeWav } from './audio';
import { MusicEngine, eventHash } from './engine';
import { PRESETS } from './parameters';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent } from './types';
import { degreeToPitch, midiToPitch, pitchToHz, pitchToMidi, pitchDistanceCents, type TuningId } from './pitch';
import { DEFAULT_SOUND, type SoundConfig, type Spectrum } from './spectrum';
import { roughnessForPitches } from './roughness';
import type { InstrumentColor } from './conductor';

export interface AudioChannelAudit {
  channel: number;
  samples: number;
  finiteSamples: number;
  nonFiniteSamples: number;
  peak: number;
  rms: number;
  musicalRms: number;
  dcOffset: number;
  clippedSamples: number;
  trailingRms: number;
  trailingPeak: number;
  maximumSampleStep: number;
}

export interface AudioPresetAudit {
  presetId: string;
  name: string;
  tempo: number;
  frames: number;
  notes: number;
  notesByPart: Record<NoteEvent['part'], number>;
  pitchRangeHzByPart: Partial<Record<NoteEvent['part'], [number, number]>>;
  percussionMidiKeys: number[];
  eventHash: string;
  generationMs: number;
  renderMs: number;
  durationSeconds: number;
  musicalSeconds: number;
  sampleRate: number;
  channels: AudioChannelAudit[];
  meanUpperVoiceStepCents: number;
  upperStepsAtMost200Cents: number;
  meanSensoryRoughness: number;
  harmonicCollections: number;
  checks: { finite: boolean; audible: boolean; unclipped: boolean; tailDecays: boolean; centered: boolean };
  passed: boolean;
}

export interface AudioAuditReport {
  engineVersion: string;
  seed: string;
  frameCount: number;
  volume: number;
  sound: SoundConfig;
  passed: boolean;
  presets: AudioPresetAudit[];
  method: string;
}

export interface AudioAuditOptions {
  seed?: string;
  presetIds?: string[];
  frameCount?: number;
  volume?: number;
  sound?: SoundConfig;
  /** Receives the actual rendered sample. The caller can create an <audio>
   * player or download via encodeWav without rendering the same sample twice. */
  onRendered?: (presetId: string, buffer: AudioBuffer, frames: Frame[]) => void | Promise<void>;
  onProgress?: (presetId: string, stage: 'generating' | 'rendering' | 'complete', completed: number, total: number) => void;
}

const tidy = (value: number) => Math.round(value * 1e8) / 1e8;
const parts: NoteEvent['part'][] = ['harmony', 'bass', 'melody', 'percussion'];

function analyzeChannel(buffer: AudioBuffer, channel: number, musicalSeconds: number): AudioChannelAudit {
  const samples = buffer.getChannelData(channel);
  const musicalEnd = Math.min(samples.length, Math.ceil(musicalSeconds * buffer.sampleRate));
  const tailStart = Math.max(0, samples.length - Math.ceil(buffer.sampleRate * 0.25));
  let finiteSamples = 0, peak = 0, squares = 0, musicalSquares = 0, total = 0, clippedSamples = 0;
  let trailingSquares = 0, trailingPeak = 0, maximumSampleStep = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!Number.isFinite(sample)) continue;
    finiteSamples++; const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude); squares += sample * sample; total += sample;
    if (i < musicalEnd) musicalSquares += sample * sample;
    if (magnitude >= 0.999) clippedSamples++;
    if (i >= tailStart) { trailingSquares += sample * sample; trailingPeak = Math.max(trailingPeak, magnitude); }
    if (i && Number.isFinite(samples[i - 1])) maximumSampleStep = Math.max(maximumSampleStep, Math.abs(sample - samples[i - 1]));
  }
  return {
    channel, samples: samples.length, finiteSamples, nonFiniteSamples: samples.length - finiteSamples,
    peak: tidy(peak), rms: tidy(Math.sqrt(squares / samples.length)),
    musicalRms: tidy(Math.sqrt(musicalSquares / Math.max(1, musicalEnd))), dcOffset: tidy(total / samples.length),
    clippedSamples, trailingRms: tidy(Math.sqrt(trailingSquares / (samples.length - tailStart))),
    trailingPeak: tidy(trailingPeak), maximumSampleStep: tidy(maximumSampleStep),
  };
}

/** Browser-only signal audit of the real Web Audio rack. Defaults to three
 * contrasting sound worlds, 16 frames each. This is a numerical playback
 * check; it deliberately does not claim to evaluate artistic quality.
 */
export async function auditAudio(options: AudioAuditOptions = {}): Promise<AudioAuditReport> {
  const seed = options.seed ?? 'glass-garden';
  const frameCount = Math.max(1, Math.min(256, Math.round(options.frameCount ?? 16)));
  const volume = Math.max(0.05, Math.min(1, options.volume ?? 0.65));
  const sound = structuredClone(options.sound ?? DEFAULT_SOUND);
  const presetIds = options.presetIds ?? ['fluid-fusion', 'chromatic-drift', 'dense-motion'];
  const report: AudioAuditReport = {
    engineVersion: ENGINE_VERSION, seed, frameCount, volume, sound, passed: true, presets: [],
    method: 'OfflineAudioContext, stereo 44.1 kHz; same instrument rack as live playback. Peak, RMS, finite samples, DC offset, and final 250 ms tail are measured. Musical quality requires listening.',
  };
  for (let index = 0; index < presetIds.length; index++) {
    const presetId = presetIds[index];
    const preset = PRESETS.find(item => item.id === presetId);
    if (!preset) throw new Error(`Unknown audio-audit preset: ${presetId}`);
    options.onProgress?.(presetId, 'generating', index, presetIds.length);
    // Yield between presets so a visible audit panel can update its progress.
    await new Promise(resolve => setTimeout(resolve, 0));
    const generationStart = performance.now();
    const engine = new MusicEngine({ seed, parameters: preset.parameters, sound });
    const frames = Array.from({ length: frameCount }, () => engine.step());
    const generationMs = performance.now() - generationStart;
    options.onProgress?.(presetId, 'rendering', index, presetIds.length);
    const renderStart = performance.now();
    const buffer = await renderOffline(frames, volume);
    const renderMs = performance.now() - renderStart;
    const musicalSeconds = frames.reduce((sum, frame) => sum + frame.duration * 60 / frame.parameters.tempo / PPQ, 0);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => analyzeChannel(buffer, channel, musicalSeconds));
    const notesByPart: Record<NoteEvent['part'], number> = { harmony: 0, bass: 0, melody: 0, percussion: 0 };
    const pitchRangeHzByPart: AudioPresetAudit['pitchRangeHzByPart'] = {};
    const allNotes = frames.flatMap(frame => frame.notes);
    for (const part of parts) {
      const partNotes = allNotes.filter(note => note.part === part);
      notesByPart[part] = partNotes.length;
      const pitches = partNotes.filter(note => note.part !== 'percussion').flatMap(note => [
        pitchToHz(note.absolutePitch ?? midiToPitch(note.midiNote!)), ...(note.endPitch ? [pitchToHz(note.endPitch)] : []),
      ]);
      if (pitches.length) pitchRangeHzByPart[part] = [tidy(Math.min(...pitches)), tidy(Math.max(...pitches))];
    }
    const steps = frames.slice(1).flatMap((frame, i) => frame.voicePitches.map((pitch, voice) => pitchDistanceCents(pitch, frames[i].voicePitches[voice])));
    const checks = {
      finite: channels.every(channel => channel.nonFiniteSamples === 0),
      audible: channels.every(channel => channel.musicalRms > 0.003),
      unclipped: channels.every(channel => channel.clippedSamples === 0 && channel.peak < 0.98),
      tailDecays: channels.every(channel => channel.trailingRms < 0.0002),
      centered: channels.every(channel => Math.abs(channel.dcOffset) < 0.001),
    };
    const result: AudioPresetAudit = {
      presetId, name: preset.name, tempo: preset.parameters.tempo, frames: frames.length, notes: allNotes.length,
      notesByPart, pitchRangeHzByPart, percussionMidiKeys: [...new Set(allNotes.filter(note => note.part === 'percussion').map(note => note.midiNote!))],
      eventHash: eventHash(allNotes), generationMs: tidy(generationMs), renderMs: tidy(renderMs),
      durationSeconds: tidy(buffer.duration), musicalSeconds: tidy(musicalSeconds), sampleRate: buffer.sampleRate, channels,
      meanUpperVoiceStepCents: tidy(steps.reduce((sum, step) => sum + step, 0) / Math.max(1, steps.length)),
      upperStepsAtMost200Cents: tidy(steps.filter(step => step <= 200).length / Math.max(1, steps.length)),
      meanSensoryRoughness: tidy(frames.reduce((sum, frame) => sum + roughnessForPitches([...frame.voicePitches, frame.bassPitch], sound.spectrum), 0) / frames.length),
      harmonicCollections: new Set(frames.map(frame => [...new Set([...frame.voicePitches, frame.bassPitch].map(pitch => ((pitch.millicents % 1_200_000) + 1_200_000) % 1_200_000))].sort((a, b) => a - b).join(','))).size,
      checks, passed: Object.values(checks).every(Boolean),
    };
    report.presets.push(result); report.passed &&= result.passed;
    await options.onRendered?.(presetId, buffer, frames);
    options.onProgress?.(presetId, 'complete', index + 1, presetIds.length);
  }
  return report;
}

/** Convenience for an audit UI: assign the URL to an audio element and revoke
 * it when removing that element. No upload or external network is involved. */
export function audioSampleUrl(buffer: AudioBuffer): string {
  return URL.createObjectURL(new Blob([new Uint8Array(encodeWav(buffer)).buffer], { type: 'audio/wav' }));
}

function fft(real: Float64Array, imaginary: Float64Array): void {
  const length = real.length;
  for (let i = 1, j = 0; i < length; i++) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size, baseReal = Math.cos(angle), baseImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let phaseReal = 1, phaseImaginary = 0;
      for (let offset = 0; offset < size / 2; offset++) {
        const a = start + offset, b = a + size / 2;
        const nextReal = real[b] * phaseReal - imaginary[b] * phaseImaginary;
        const nextImaginary = real[b] * phaseImaginary + imaginary[b] * phaseReal;
        real[b] = real[a] - nextReal; imaginary[b] = imaginary[a] - nextImaginary;
        real[a] += nextReal; imaginary[a] += nextImaginary;
        const rotated = phaseReal * baseReal - phaseImaginary * baseImaginary;
        phaseImaginary = phaseReal * baseImaginary + phaseImaginary * baseReal; phaseReal = rotated;
      }
    }
  }
}

export interface MicrotonalPitchAudit {
  passed: boolean;
  seed: string;
  tuning: Exclude<TuningId, '12tet'>;
  spectrumId: string;
  generatedPitchMillicents: number;
  fractionalMidiCoordinate: number;
  expectedHz: number;
  measuredFftHz: number;
  errorCents: number;
  nearestSemitoneHz: number;
  expectedFrequencyMagnitude: number;
  roundedFrequencyMagnitude: number;
  roundedToExpectedMagnitudeRatio: number;
  partials: Array<{ ratio: number; expectedHz: number; expectedRelativeAmplitude: number; measuredRelativeAmplitude: number }>;
  method: string;
}

/** Prove a genuinely generated native note survives playback without MIDI
 * rounding. Analyze rendered PCM with a 65,536-point Hann-windowed FFT, then
 * measure the complex spectrum at the requested and rounded frequencies.
 */
export async function auditMicrotonalPitch(options: {
  seed?: string;
  tuning?: Exclude<TuningId, '12tet'>;
  spectrum?: Spectrum;
  onRendered?: (buffer: AudioBuffer) => void | Promise<void>;
} = {}): Promise<MicrotonalPitchAudit> {
  const seed = options.seed ?? 'glass-garden';
  const tuning = options.tuning ?? '19edo';
  const sound: SoundConfig = { ...DEFAULT_SOUND, tuning, instrument: 'additive', spectrum: options.spectrum ?? DEFAULT_SOUND.spectrum };
  const engine = new MusicEngine({ seed, parameters: PRESETS[0].parameters, sound });
  const generated = Array.from({ length: 4 }, () => engine.step());
  const candidates = generated.flatMap(frame => frame.notes).filter(note => note.absolutePitch && !Number.isInteger(pitchToMidi(note.absolutePitch)));
  const separation = (note: NoteEvent) => Math.abs(pitchToHz(note.absolutePitch!) - pitchToHz(midiToPitch(Math.round(pitchToMidi(note.absolutePitch!)))));
  candidates.sort((a, b) => separation(b) - separation(a));
  const note = candidates[0];
  if (!note?.absolutePitch) throw new Error(`The generated ${tuning} sample did not contain a fractional pitch.`);
  const frame: Frame = { ...generated[0], phrase: undefined, tick: 0, duration: 2400, sound, parameters: { ...generated[0].parameters, tempo: 120 },
    notes: [{ ...note, tick: 0, duration: 2400 }] };
  const buffer = await renderOffline([frame], 0.65);
  const sampleRate = buffer.sampleRate, length = 65536, start = Math.round(sampleRate * 0.2);
  const samples = buffer.getChannelData(0);
  const windowed = new Float64Array(length);
  let windowSum = 0;
  for (let i = 0; i < length; i++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
    windowed[i] = samples[start + i] * window; windowSum += window;
  }
  const expectedHz = pitchToHz(note.absolutePitch);
  const nearestSemitoneHz = pitchToHz(midiToPitch(Math.round(pitchToMidi(note.absolutePitch))));
  const real = windowed.slice(), imaginary = new Float64Array(length);
  fft(real, imaginary);
  const power = (bin: number) => real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
  const low = Math.floor(expectedHz * 0.85 * length / sampleRate), high = Math.ceil(expectedHz * 1.15 * length / sampleRate);
  let peak = low;
  for (let bin = low + 1; bin <= high; bin++) if (power(bin) > power(peak)) peak = bin;
  const left = Math.log(Math.max(1e-30, power(peak - 1))), middle = Math.log(Math.max(1e-30, power(peak))), right = Math.log(Math.max(1e-30, power(peak + 1)));
  const fractionalBin = 0.5 * (left - right) / (left - 2 * middle + right);
  const measuredFftHz = (peak + fractionalBin) * sampleRate / length;
  const magnitudeAt = (hz: number) => {
    const angle = -2 * Math.PI * hz / sampleRate, rotationReal = Math.cos(angle), rotationImaginary = Math.sin(angle);
    let phaseReal = 1, phaseImaginary = 0, sumReal = 0, sumImaginary = 0;
    for (const sample of windowed) {
      sumReal += sample * phaseReal; sumImaginary += sample * phaseImaginary;
      const next = phaseReal * rotationReal - phaseImaginary * rotationImaginary;
      phaseImaginary = phaseReal * rotationImaginary + phaseImaginary * rotationReal; phaseReal = next;
    }
    return 2 * Math.hypot(sumReal, sumImaginary) / windowSum;
  };
  const expectedFrequencyMagnitude = magnitudeAt(expectedHz), roundedFrequencyMagnitude = magnitudeAt(nearestSemitoneHz);
  const partials = sound.spectrum.partials.map(partial => ({ ratio: partial.ratio, expectedHz: tidy(expectedHz * partial.ratio),
    expectedRelativeAmplitude: partial.amplitude / sound.spectrum.partials[0].amplitude,
    measuredRelativeAmplitude: tidy(magnitudeAt(expectedHz * partial.ratio) / expectedFrequencyMagnitude),
  }));
  const errorCents = 1200 * Math.log2(measuredFftHz / expectedHz);
  const ratio = roundedFrequencyMagnitude / expectedFrequencyMagnitude;
  const passed = Math.abs(errorCents) < 1 && expectedFrequencyMagnitude > 0.003 && ratio < 0.1
    && Math.abs(expectedHz - nearestSemitoneHz) > 1
    && partials.every(partial => Math.abs(partial.expectedRelativeAmplitude - partial.measuredRelativeAmplitude) < 0.02);
  await options.onRendered?.(buffer);
  return { passed, seed, tuning, spectrumId: sound.spectrum.id, generatedPitchMillicents: note.absolutePitch.millicents,
    fractionalMidiCoordinate: pitchToMidi(note.absolutePitch), expectedHz: tidy(expectedHz), measuredFftHz: tidy(measuredFftHz),
    errorCents: tidy(errorCents), nearestSemitoneHz: tidy(nearestSemitoneHz), expectedFrequencyMagnitude: tidy(expectedFrequencyMagnitude),
    roundedFrequencyMagnitude: tidy(roundedFrequencyMagnitude), roundedToExpectedMagnitudeRatio: tidy(ratio), partials,
    method: `A non-integer pitch from four native ${tuning} engine frames is isolated and rendered through the real additive rack. A 65,536-point Hann FFT estimates its fundamental; complex spectral projection measures every shared partial and the nearest MIDI-semitone frequency.`,
  };
}

/** Exercise native Web Audio rescheduling across tempo changes, including
 * extending an oscillator beyond its originally scheduled stop. The additive
 * route has no ambience, so silence after release is directly measurable. */
export async function auditTempoBoundaries(): Promise<{
  passed: boolean;
  cases: Array<{ fromBpm: number; toBpm: number; durationSeconds: number; beforeNoteOffRms: number; afterReleaseRms: number; passed: boolean }>;
}> {
  const sound: SoundConfig = { ...DEFAULT_SOUND, instrument: 'additive' };
  const base = new MusicEngine({ seed: 'tempo-boundary-proof', parameters: PRESETS[0].parameters, sound }).step();
  const cases = [];
  for (const [fromBpm, toBpm] of [[40, 180], [180, 40]]) {
    const note: NoteEvent = { id: 'tempo-proof', tick: 1680, duration: 590, absolutePitch: midiToPitch(69), part: 'harmony', voice: 0, velocity: 0.7 };
    const frames: Frame[] = [
      { ...base, phrase: undefined, tick: 960, duration: 960, parameters: { ...base.parameters, tempo: fromBpm }, notes: [note] },
      { ...base, phrase: undefined, tick: 1920, duration: 960, parameters: { ...base.parameters, tempo: toBpm }, notes: [] },
    ];
    const buffer = await renderOffline(frames, 0.65);
    const secondsBeforeBoundary = 960 * 60 / fromBpm / PPQ;
    const start = 720 * 60 / fromBpm / PPQ;
    const end = secondsBeforeBoundary + 350 * 60 / toBpm / PPQ;
    const samples = buffer.getChannelData(0);
    const rmsBetween = (begin: number, finish: number) => {
      const a = Math.floor(begin * buffer.sampleRate), b = Math.floor(finish * buffer.sampleRate);
      let sum = 0; for (let i = a; i < b; i++) sum += samples[i] * samples[i];
      return Math.sqrt(sum / (b - a));
    };
    const beforeNoteOffRms = rmsBetween(end - 0.10, end - 0.03);
    const afterReleaseRms = rmsBetween(end + 0.13, end + 0.23);
    cases.push({ fromBpm, toBpm, durationSeconds: tidy(end - start), beforeNoteOffRms: tidy(beforeNoteOffRms), afterReleaseRms: tidy(afterReleaseRms),
      passed: beforeNoteOffRms > 0.003 && afterReleaseRms < 0.000001 });
  }
  return { passed: cases.every(item => item.passed), cases };
}

function measuredPcmFrequency(buffer: AudioBuffer, startSeconds: number, expectedHz: number, length = 16384): number {
  const real = new Float64Array(length), imaginary = new Float64Array(length);
  const samples = buffer.getChannelData(0), start = Math.floor(startSeconds * buffer.sampleRate);
  for (let i = 0; i < length; i++) real[i] = samples[start + i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
  fft(real, imaginary);
  const power = (bin: number) => real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
  const low = Math.max(1, Math.floor(expectedHz * 0.85 * length / buffer.sampleRate));
  const high = Math.ceil(expectedHz * 1.15 * length / buffer.sampleRate);
  let peak = low;
  for (let bin = low + 1; bin <= high; bin++) if (power(bin) > power(peak)) peak = bin;
  const a = Math.log(Math.max(1e-30, power(peak - 1))), b = Math.log(Math.max(1e-30, power(peak))), c = Math.log(Math.max(1e-30, power(peak + 1)));
  return (peak + 0.5 * (a - c) / (a - 2 * b + c)) * buffer.sampleRate / length;
}

/** Actual PCM audit and listening samples for traveling pitches and ensemble
 * orchestration. The clean additive journey verifies pitch endpoints; the
 * five separate ensemble samples demonstrate distinct audible colors without
 * claiming those timbres match the additive sensory-roughness model. */
export async function auditGlidesAndTimbres(options: {
  onRendered?: (label: string, buffer: AudioBuffer) => void | Promise<void>;
} = {}): Promise<{
  passed: boolean;
  initialHz: number;
  measuredInitialHz: number;
  glides: Array<{ direction: string; expectedHz: number; measuredHz: number; errorCents: number; arrivalSeconds: number }>;
  colors: Array<{ color: InstrumentColor; peak: number; rms: number; pcmSignature: string }>;
  method: string;
}> {
  const additive: SoundConfig = { ...DEFAULT_SOUND, instrument: 'additive' };
  const base = new MusicEngine({ seed: 'orchestration-proof', parameters: PRESETS[0].parameters, sound: additive }).step();
  const origin = midiToPitch(69), destination = degreeToPitch('19edo', 8);
  const event = (id: string, tick: number, duration: number, pitch: typeof origin): NoteEvent => ({
    id, tick, duration, absolutePitch: pitch, part: 'harmony', voice: 0, velocity: 0.7,
  });
  const tempos = [80, 80, 120, 120, 120, 60, 60];
  const journey: Frame[] = tempos.map((tempo, index) => ({ ...base, phrase: undefined, index, tick: index * 960, duration: 960,
    sound: additive, parameters: { ...base.parameters, tempo }, notes: [] }));
  journey[0].notes = [event('steady-12tet', 0, 1200, origin)];
  journey[1].notes = [{ ...event('enter-19edo', 1440, 1920, origin), endPitch: destination, glideTicks: 960 }];
  journey[4].notes = [{ ...event('return-12tet', 4320, 1920, destination), endPitch: origin, glideTicks: 960 }];
  const rendered = await renderOffline(journey, 0.65);
  const measuredInitialHz = measuredPcmFrequency(rendered, 0.2, pitchToHz(origin), 32768);
  const glides = [
    { direction: '12-TET into 19-EDO', expectedHz: pitchToHz(destination), arrivalSeconds: 3.5 },
    { direction: '19-EDO back to 12-TET', expectedHz: pitchToHz(origin), arrivalSeconds: 7 },
  ].map(item => {
    const measuredHz = measuredPcmFrequency(rendered, item.arrivalSeconds + 0.04, item.expectedHz);
    return { ...item, expectedHz: tidy(item.expectedHz), measuredHz: tidy(measuredHz), errorCents: tidy(1200 * Math.log2(measuredHz / item.expectedHz)) };
  });
  await options.onRendered?.('Glide into 19-EDO and return · two tempo changes', rendered);
  const colors: Array<{ color: InstrumentColor; peak: number; rms: number; pcmSignature: string }> = [];
  for (const color of ['keys', 'glass', 'reed', 'pluck', 'round', 'strings', 'flute', 'brass', 'lead'] as InstrumentColor[]) {
    const colored: Frame = { ...base, phrase: undefined, tick: 0, duration: 960, sound: DEFAULT_SOUND, parameters: { ...base.parameters, tempo: 80 },
      notes: [{ ...event(`color-${color}`, 0, 960, midiToPitch(60)), timbre: color }] };
    const buffer = await renderOffline([colored], 0.65);
    const signal = analyzeChannel(buffer, 0, 1.5);
    const samples = buffer.getChannelData(0);
    const fingerprint = Array.from({ length: 2048 }, (_, i) => Math.round(samples[i * 17] * 1e7));
    colors.push({ color, peak: signal.peak, rms: signal.musicalRms, pcmSignature: eventHash(fingerprint) });
    await options.onRendered?.(`Ensemble color · ${color}`, buffer);
  }
  const passed = Math.abs(1200 * Math.log2(measuredInitialHz / pitchToHz(origin))) < 1
    && glides.every(item => Math.abs(item.errorCents) < 1)
    && colors.every(item => item.rms > 0.001 && item.peak < 0.98)
    && new Set(colors.map(item => item.pcmSignature)).size === colors.length;
  return { passed, initialHz: pitchToHz(origin), measuredInitialHz: tidy(measuredInitialHz), glides, colors,
    method: 'Native OfflineAudioContext renders log-frequency glides across tempo boundaries. Hann-windowed FFT measurements check 12-TET/19-EDO destinations after arrival; separate actual PCM samples verify nine distinct ensemble colors. Listening samples are returned through onRendered.',
  };
}

/** Equal-velocity isolated percussion attacks. Unlike passage RMS, these
 * windows do not dilute the level measurement with the groove's rests. */
export async function auditPercussionAttacks(options: {
  onRendered?: (label: string, buffer: AudioBuffer) => void | Promise<void>;
} = {}) {
  const base = new MusicEngine({ seed: 'percussion-presence-proof', parameters: PRESETS[0].parameters, sound: DEFAULT_SOUND }).step();
  const results: Array<{ name: string; midiNote: number; peak: number; attackRms: number; bodyRms: number; relativeToKickDb: number; passed: boolean }> = [];
  for (const [name, midiNote] of [['Kick', 36], ['Snare', 38], ['Hat', 42]] as const) {
    const probe: Frame = { ...base, phrase: undefined, tick: 0, duration: 960, sound: DEFAULT_SOUND,
      parameters: { ...base.parameters, tempo: 120 }, notes: [{ id: `percussion-proof-${name}`, tick: 0, duration: 180, part: 'percussion', voice: 9, midiNote, velocity: 0.5 }] };
    const buffer = await renderOffline([probe], 0.65);
    const signal = analyzeChannel(buffer, 0, 1);
    const rms = (from: number, to: number) => {
      const start = Math.floor(from * buffer.sampleRate), end = Math.ceil(to * buffer.sampleRate); let sum = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = start; i < end; i++) sum += samples[i] * samples[i];
      }
      return Math.sqrt(sum / ((end - start) * buffer.numberOfChannels));
    };
    const attackRms = rms(0.003, 0.065), bodyRms = rms(0.065, 0.15);
    const kickRms = results[0]?.attackRms ?? attackRms;
    results.push({ name, midiNote, peak: signal.peak, attackRms: tidy(attackRms), bodyRms: tidy(bodyRms),
      relativeToKickDb: tidy(20 * Math.log10(attackRms / kickRms)),
      passed: signal.nonFiniteSamples === 0 && signal.clippedSamples === 0 && signal.peak < 0.98 && attackRms > 0.0005 });
    await options.onRendered?.(`${name} · isolated attack at velocity 0.5`, buffer);
  }
  return { passed: results.every(result => result.passed), velocity: 0.5, volume: 0.65, hits: results,
    method: 'Each percussion instrument is rendered separately through the actual ensemble path at equal velocity and master gain. Stereo RMS covers 3–65 ms for the attack and 65–150 ms for body/decay. No other hit overlaps the measurement. The original kick synthesis is unchanged; relative levels are measurements, not a target to make all drums equally loud.',
  };
}

/** Controlled native PCM comparison: the only score change is articulation.
 * This demonstrates slower attacks and a held body without using a quieter
 * velocity as a surrogate for a sustained instrument. */
export async function auditArticulation(options: {
  onRendered?: (label: string, buffer: AudioBuffer) => void | Promise<void>;
} = {}) {
  const base = new MusicEngine({ seed: 'articulation-proof', parameters: PRESETS[0].parameters, sound: DEFAULT_SOUND }).step();
  const results = [];
  for (const timbre of ['keys', 'glass', 'pluck'] as const) {
    const variants = [];
    for (const articulation of ['sustained', 'detached'] as const) {
      const first: Frame = { ...base, phrase: undefined, tick: 0, duration: 960, sound: DEFAULT_SOUND,
        parameters: { ...base.parameters, tempo: 120 }, notes: [{ id: 'articulation-proof', tick: 0, duration: 2880,
          part: 'harmony', voice: 0, absolutePitch: midiToPitch(60), velocity: .7, timbre, articulation, expression: { role: 'support' } }] };
      const frames = [first, ...[960, 1920].map(tick => ({ ...first, tick, notes: [] }))];
      const buffer = await renderOffline(frames, .65), signal = analyzeChannel(buffer, 0, 3);
      const rms = (from: number, to: number) => {
        const a = Math.floor(from * buffer.sampleRate), b = Math.floor(to * buffer.sampleRate); let sum = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = a; i < b; i++) sum += data[i] * data[i];
        }
        return Math.sqrt(sum / ((b - a) * buffer.numberOfChannels));
      };
      variants.push({ articulation, attackRms: tidy(rms(.005, .05)), earlyBodyRms: tidy(rms(.25, .45)),
        heldBodyRms: tidy(rms(1.8, 2.5)), peak: signal.peak, finite: signal.nonFiniteSamples === 0, unclipped: signal.clippedSamples === 0 && signal.peak < .98 });
      await options.onRendered?.(`${timbre} · ${articulation} · same pitch and velocity`, buffer);
    }
    const [sustained, detached] = variants;
    const checks = { finiteUnclipped: variants.every(item => item.finite && item.unclipped),
      slowerAttack: sustained.attackRms < detached.attackRms * .35,
      heldBodyAudible: sustained.heldBodyRms > .001,
      bodyOutlastsDetached: sustained.heldBodyRms > Math.max(1e-8, detached.heldBodyRms) * 8 };
    results.push({ timbre, variants, checks, passed: Object.values(checks).every(Boolean) });
  }
  return { passed: results.every(result => result.passed), velocity: .7, tempo: 120, durationTicks: 2880, volume: .65, results,
    method: 'The real ensemble rack renders identical three-second C4 notes at identical velocity/master level for keys, glass and pluck, changing only sustained versus detached articulation. Stereo PCM RMS measures attack at 5–50 ms, early body at 250–450 ms and held body at 1.8–2.5 s. Effect tails remain in both. These measurements establish audible envelope differences; players are provided for human judgment of musical character.' };
}
