import { MusicEngine, eventHash } from '../src/engine/index';
import { DEFAULT_PARAMETERS, PRESETS } from '../src/parameters';
import { pitchClassMask, validVoices } from '../src/engine/analysis';
import type { Frame, Parameters } from '../src/types';
import { pitchToMidi, pitchToDegree } from '../src/pitch';
import { DEFAULT_SOUND, SPECTRA, type SoundConfig } from '../src/spectrum';
import { edo19Collection, validEdo19Voices } from '../src/engine/edo19';

function audit(label: string, parameters: Parameters, count = 128) {
  const engine = new MusicEngine({ seed: 'glass-garden', parameters });
  const frames: Frame[] = [];
  const start = performance.now();
  for (let i = 0; i < count; i++) frames.push(engine.step());
  const elapsed = performance.now() - start;
  const movements = frames.slice(1).flatMap((f, i) => f.voicePitches.map((p, v) => Math.abs(p.millicents - frames[i].voicePitches[v].millicents) / 100000));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const result = {
    preset: label,
    frames: count,
    msPerFrame: +(elapsed / count).toFixed(2),
    meanUpperStep: +mean(movements).toFixed(3),
    upperStepsAtMostTwo: +(movements.filter(n => n <= 2).length / movements.length).toFixed(3),
    meanHarmonicDistance: +mean(frames.map(f => f.diagnostics.harmonicDistance)).toFixed(3),
    meanDissonance: +mean(frames.map(f => f.diagnostics.dissonance)).toFixed(3),
    uniqueCollections: new Set(frames.map(f => pitchClassMask(f.voicePitches.map(pitchToMidi), pitchToMidi(f.bassPitch)))).size,
    estimatedCenters: new Set(frames.map(f => f.diagnostics.tonalCenter)).size,
    tensionMin: +Math.min(...frames.map(f => f.diagnostics.actualTension)).toFixed(3),
    tensionMax: +Math.max(...frames.map(f => f.diagnostics.actualTension)).toFixed(3),
    recalls: frames.filter(f => f.index % 8 === 0 && f.diagnostics.recall).length,
    valid: frames.every(f => validVoices(f.voicePitches.map(pitchToMidi)) && f.voicePitches[0].millicents - f.bassPitch.millicents >= 700000),
    eventHash: eventHash(frames.flatMap(f => f.notes)),
  };
  console.log(JSON.stringify(result));
  return result;
}

function auditTuning(sound: SoundConfig, count = 64) {
  const engine = new MusicEngine({ seed: 'xeno-garden', parameters: { ...DEFAULT_PARAMETERS, harmonicMobility: 0.9, voiceLeading: 0.99, tonalClarity: 0.3 }, sound });
  const started = performance.now();
  const frames = Array.from({ length: count }, () => engine.step());
  const motion = frames.slice(1).flatMap((f, i) => f.voicePitches.map((p, voice) => Math.abs(p.millicents - frames[i].voicePitches[voice].millicents) / 1000));
  const result = {
    tuning: sound.tuning, spectrum: sound.spectrum.id, weight: sound.roughnessWeight,
    msPerFrame: +((performance.now() - started) / count).toFixed(2),
    maximumUpperStepCents: +Math.max(...motion).toFixed(3),
    meanSensoryRoughness: +(frames.reduce((sum, frame) => sum + frame.diagnostics.sensoryRoughness!, 0) / count).toFixed(3),
    meanTargetError: +(frames.reduce((sum, frame) => sum + Math.abs(frame.diagnostics.sensoryRoughness! - frame.diagnostics.roughnessTarget!), 0) / count).toFixed(3),
    uniqueCollections: new Set(frames.map(frame => sound.tuning === '19edo' ? edo19Collection([...frame.voicePitches, frame.bassPitch].map(pitch => pitchToDegree('19edo', pitch))) : pitchClassMask(frame.voicePitches.map(pitchToMidi), pitchToMidi(frame.bassPitch)))).size,
    valid: frames.every(frame => sound.tuning === '19edo' ? validEdo19Voices(frame.voicePitches.map(pitch => pitchToDegree('19edo', pitch))) : validVoices(frame.voicePitches.map(pitchToMidi))),
    eventHash: eventHash(frames.flatMap(frame => frame.notes)),
  };
  console.log(JSON.stringify(result));
  if (!result.valid || result.maximumUpperStepCents > 200.001) throw new Error('Tuning-aware range/continuity audit failed.');
}

const high = { ...DEFAULT_PARAMETERS, harmonicMobility: 0.95, voiceLeading: 0.99, tonalClarity: 0.28, chromaticism: 0.85, bassIndependence: 0.85 };
const low = { ...high, harmonicMobility: 0.1 };
const highResult = audit('acceptance / high mobility + smoothness', high);
const lowResult = audit('control / low mobility + smoothness', low);
for (const preset of PRESETS) audit(preset.name, preset.parameters, 64);
if (!highResult.valid || highResult.upperStepsAtMostTwo < 0.98 || highResult.meanHarmonicDistance < 0.35 || highResult.meanHarmonicDistance <= lowResult.meanHarmonicDistance + 0.15 || highResult.uniqueCollections < 48) {
  throw new Error('Core voice-leading / harmonic-travel acceptance criteria failed.');
}
for (const tuning of ['12tet', '19edo'] as const) for (const spectrum of SPECTRA) for (const roughnessWeight of [0, 3]) {
  auditTuning({ ...DEFAULT_SOUND, tuning, instrument: 'additive', spectrum, roughnessWeight });
}
