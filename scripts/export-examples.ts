import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_CONDUCTOR, MANUAL_CONDUCTOR } from '../src/conductor';
import { MANUAL_PHRASING } from '../src/phrasing';
import { exportMidi } from '../src/midi';
import { PRESETS } from '../src/parameters';
import { createPerformance, serializePerformance } from '../src/serialization';
import { DEFAULT_SOUND, SPECTRA } from '../src/spectrum';
import { PPQ, type Frame } from '../src/types';
import { lyricalPerformance } from '../src/lyrical';

// All output paths are fixed descendants of this repository's examples folder.
const directory = new URL('../examples/', import.meta.url);
await mkdir(directory, { recursive: true });
const fluid = createPerformance('glass-garden', PRESETS.find(preset => preset.id === 'fluid-fusion')!);
fluid.conductor = { ...MANUAL_CONDUCTOR };
fluid.phrasing = { ...MANUAL_PHRASING };
const chromatic = createPerformance('velvet-orbit', PRESETS.find(preset => preset.id === 'chromatic-drift')!);
chromatic.conductor = { ...MANUAL_CONDUCTOR };
chromatic.phrasing = { ...MANUAL_PHRASING };
Object.assign(chromatic.initialParameters, { harmonicMobility: .95, voiceLeading: .99, tonalClarity: .28, chromaticism: .85, bassIndependence: .85 });
const experiment = createPerformance('glass-garden', PRESETS.find(preset => preset.id === 'fluid-fusion')!);
experiment.conductor = { ...MANUAL_CONDUCTOR };
experiment.phrasing = { ...MANUAL_PHRASING };
experiment.sound = { ...structuredClone(DEFAULT_SOUND), tuning: '19edo', instrument: 'additive', spectrum: structuredClone(SPECTRA[0]), roughnessWeight: 2 };
const autonomous = createPerformance('glass-garden', PRESETS.find(preset => preset.id === 'fluid-fusion')!);
autonomous.conductor = { ...DEFAULT_CONDUCTOR };

for (const [filename, performance] of [
  ['fluid-fusion.json', fluid],
  ['chromatic-drift.json', chromatic],
  ['19edo-experiment.json', experiment],
  ['autonomous-form.json', autonomous],
  ['lyrical-score.json', lyricalPerformance(createPerformance('glass-garden')).recipe],
] as const) {
  // Serialization validates every field, including sound compatibility.
  const contents = serializePerformance(performance) + '\n';
  await writeFile(new URL(filename, directory), contents, 'utf8');
}

const composer = new MusicEngine({
  seed: fluid.seed, parameters: fluid.initialParameters, automation: fluid.automation,
  automationRevisions: fluid.automationRevisions, weights: fluid.weights, sound: fluid.sound, conductor: fluid.conductor,
  phrasing: fluid.phrasing,
});
const endTick = 16 * 4 * PPQ;
const frames: Frame[] = [];
while (composer.tick < endTick) frames.push(composer.step());
const midi = exportMidi(frames, 0, endTick);
await writeFile(new URL('fluid-fusion.mid', directory), midi);
console.log(JSON.stringify({
  directory: fileURLToPath(directory),
  files: ['fluid-fusion.json', 'fluid-fusion.mid', 'chromatic-drift.json', '19edo-experiment.json', 'autonomous-form.json', 'lyrical-score.json'],
  engineVersion: fluid.engineVersion, midiBars: 16, midiBytes: midi.byteLength,
  frames: frames.length, notes: frames.flatMap(frame => frame.notes).length,
  eventHash: eventHash(frames.flatMap(frame => frame.notes)),
}, null, 2));
