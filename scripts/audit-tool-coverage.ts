import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditToolCoverage, developmentalCoverageRecipe, ornamentalCoverageRecipe } from '../src/tool-coverage-audit';
import { PRESETS } from '../src/parameters';
import { COMPOSITION_STUDIES, compositionStudy } from '../src/composition-studies';
import { createPerformance } from '../src/serialization';
import { TUNINGS, type TuningId } from '../src/pitch';

const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const seed = option('seed', 'tool-journey'), frames = Number(option('frames', '320'));
const longFrames = Number(option('long-frames', String(frames * 4)));
const cases = [
  ...Object.keys(TUNINGS).map(tuning => ({ id: `development:${tuning}`, recipe: developmentalCoverageRecipe(seed, tuning as TuningId),
    frames: tuning === '12tet' ? longFrames : frames })),
  { id: 'ornament:glide-enabled', recipe: ornamentalCoverageRecipe(seed), frames: Math.max(640, frames * 2) },
  ...PRESETS.map(preset => ({ id: `preset:${preset.id}`, recipe: createPerformance(seed, preset), frames: Math.max(64, Math.floor(frames / 2)) })),
  ...COMPOSITION_STUDIES.map(study => ({ id: `study:${study.id}`, recipe: compositionStudy(createPerformance(seed), study.id), frames: Math.max(64, Math.floor(frames / 2)) })),
];
const report = cases.map(item => ({ id: item.id, ...auditToolCoverage(item.recipe, item.frames) }));
const output = option('out', '');
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.some(item => item.invalidEvents || item.offNativeGrid || item.violations.length || item.ornaments.invalidSlideEvents))
  process.exitCode = 1;
