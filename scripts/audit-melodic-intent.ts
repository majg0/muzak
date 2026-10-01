import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MusicEngine } from '../src/engine';
import { compositionStudy } from '../src/composition-studies';
import { createPerformance } from '../src/serialization';
import { melodicIntentSummary } from '../src/melodic-intent-audit';
import { ENGINE_VERSION } from '../src/types';

const files = ['src/engine/theme-core.ts', 'src/engine/lyrical.ts', 'src/engine/theme-realization.ts', 'src/engine/phrase.ts',
  'src/engine/thought-spans.ts', 'src/engine/arrangement.ts', 'src/engine/index.ts', 'src/conductor.ts', 'src/form-score.ts', 'src/audio.ts'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
const before = hashes(), cases = [];
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) for (const study of ['developing-solo', 'interlocking-drive', 'floating-lines']) {
  const recipe = compositionStudy(createPerformance(seed), study);
  const engine = new MusicEngine({ seed, parameters: recipe.initialParameters, sound: recipe.sound, conductor: recipe.conductor,
    phrasing: recipe.phrasing, weights: recipe.weights, automation: recipe.automation });
  const frames = Array.from({ length: 128 }, () => engine.step());
  cases.push({ seed, study, ...melodicIntentSummary(frames) });
}
const after = hashes();
const report = { engineVersion: ENGINE_VERSION, capturedAt: new Date().toISOString(), sourceHashes: before,
  sourcesStableDuringCapture: JSON.stringify(before) === JSON.stringify(after),
  method: 'First128 committed frames per recipe. Same three seeds and three study recipes. Voice5 foreground is measured separately from voice3 top harmony. Native physical cents, written durations/velocities/articulation and eligible connections. No subjective listening or PCM claim.', cases };
const output = process.argv[2] ?? 'melodic-intent-audit.json';
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, sourcesStableDuringCapture: report.sourcesStableDuringCapture,
  cases: cases.map(({ seed, study, foreground, topHarmony }) => ({ seed, study,
    foregroundAttacks: foreground.attacks, foregroundIntervals: foreground.intervalHistogramCents, foregroundGate: foreground.durationBeats,
    velocity: foreground.velocity, legatoConnections: foreground.pitchChangingLegatoCandidates,
    explicitGlides: foreground.explicitPitchGlides, topHarmonyIntervals: topHarmony.intervalHistogramCents })) }, null, 2));
