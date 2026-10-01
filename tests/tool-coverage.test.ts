import test from 'node:test';
import assert from 'node:assert/strict';
import { auditToolCoverage, developmentalCoverageRecipe, ornamentalCoverageRecipe, toolCoverageFromFrames } from '../src/tool-coverage-audit';
import { GESTURE_OPERATIONS } from '../src/engine/idea-tools';
import { COUNTERPOINT_TOOLS } from '../src/engine/counterpoint';
import { harmonicVocabulary } from '../src/engine/harmonic-tools';
import { ORNAMENT_KINDS } from '../src/engine/ornaments';
import { TUNINGS, type TuningId } from '../src/pitch';
import { MusicEngine } from '../src/engine';
import { PRESETS } from '../src/parameters';
import { createPerformance } from '../src/serialization';

test('a deliberate production journey hears the gesture vocabulary and both counterpoint relationships on every native grid', () => {
  const ornaments = new Set<string>();
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const recipe = developmentalCoverageRecipe('tool-journey', tuning), saved = structuredClone(recipe);
    const report = auditToolCoverage(recipe, tuning === '12tet' ? 1280 : 96);
    assert.deepEqual(recipe, saved);
    assert.deepEqual(report.violations, []);
    assert.equal(report.invalidEvents, 0); assert.equal(report.offNativeGrid, 0);
    assert.ok(report.completeThoughts >= 10 && report.gestures.current.decisions >= 30);
    const heard = new Set([...Object.keys(report.gestures.current.used), ...Object.keys(report.gestures.inherited.used)]);
    assert.deepEqual(heard, new Set(Object.keys(GESTURE_OPERATIONS)), `${tuning}: complete heard lineage supplies the vocabulary over time`);
    assert.equal(report.gestures.current.used['time-scale'], undefined, 'Fixed-span timing must not claim canceled uniform scaling.');
    assert.ok(report.gestures.inherited.used['time-scale'] > 0, 'Source duration scaling has actual allocated time.');
    assert.ok(report.gestures.maximumToolsPerGesture < Object.keys(GESTURE_OPERATIONS).length,
      'The horizon explores the vocabulary without forcing every operation into each gesture.');
    assert.deepEqual(new Set(Object.keys(report.counterpoint.used)), new Set(COUNTERPOINT_TOOLS));
    assert.ok(report.counterpoint.decisions > 10 && report.counterpoint.fulfilled > 0);
    assert.ok(report.rhythm.referenceAttacks > 100 && report.rhythm.offQuarterSourceAttacks > 100);
    assert.equal(report.rhythm.referenceOffQuarter, 0);
    assert.deepEqual(new Set(Object.keys(report.rhythm.layers)), new Set(['reference', 'riff', 'response']));
    assert.ok(report.harmony.decisions > 8);
    assert.ok(report.ornaments.observedAudibleFigures > 0);
    assert.ok(report.ornaments.attacks >= report.ornaments.observedAudibleFigures);
    Object.keys(report.ornaments.figuresByKind).forEach(kind => ornaments.add(kind));
    assert.equal(report.ornaments.invalidSlideEvents, 0);
    assert.equal(report.ornaments.figuresByKind['connected-slide'], undefined, 'A recipe without glide support must not claim slides.');
    assert.ok(Object.keys(report.harmony.used).length >= 4, 'Complete sounding routes must use real harmonic relationships.');
    if (tuning === '12tet') assert.deepEqual(new Set(Object.keys(report.harmony.used)), new Set(harmonicVocabulary(recipe.phrasing!.harmony!)),
      'A long deliberate composition hears the complete harmonic vocabulary when the required geometry and melody fit occur.');
    assert.ok(Object.keys(report.harmony.deferred).length > 0, 'The audit must expose tools that do not fit current route geometry or cost.');
  }
  const expressive = auditToolCoverage(ornamentalCoverageRecipe('tool-journey'), 640);
  assert.deepEqual(expressive.violations, []);
  assert.equal(expressive.ornaments.invalidSlideEvents, 0);
  assert.ok(expressive.ornaments.connectedSlides > 0, 'Explicit glide support must reach an actual ornament pitch ramp.');
  Object.keys(expressive.ornaments.figuresByKind).forEach(kind => ornaments.add(kind));
  assert.deepEqual(ornaments, new Set(ORNAMENT_KINDS),
    'Complete emitted figures cover the vocabulary across steady and expressive contexts without demanding forbidden figures.');
});

test('quiet and searching shipped presets expose their heard and deferred opportunities without an all-tools quota', () => {
  const reports = ['sparse-suspended', 'unstable-searching'].map(id => auditToolCoverage(
    createPerformance('tool-presets', PRESETS.find(preset => preset.id === id)!), 128));
  for (const report of reports) {
    assert.deepEqual(report.violations, []);
    assert.equal(report.invalidEvents, 0); assert.equal(report.offNativeGrid, 0);
    assert.ok(report.completeThoughts > 0 && report.gestures.current.decisions > 0);
    assert.ok(report.gestures.maximumToolsPerGesture < Object.keys(GESTURE_OPERATIONS).length);
  }
  assert.notDeepEqual(reports[0].gestures.current, reports[1].gestures.current);
  assert.ok(reports.some(report => Object.keys(report.counterpoint.deferred).length > 0));
});

test('metadata from an interrupted or unheard gesture cannot manufacture production coverage', () => {
  const recipe = developmentalCoverageRecipe('tool-journey', '12tet');
  const engine = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters, sound: recipe.sound,
    conductor: recipe.conductor, phrasing: recipe.phrasing });
  const frames = Array.from({ length: 32 }, () => engine.step());
  const heard = toolCoverageFromFrames(recipe.seed, frames);
  assert.ok(heard.gestures.current.decisions > 0 && heard.counterpoint.decisions > 0);
  const silent = toolCoverageFromFrames(recipe.seed, frames.map(frame => ({ ...frame, notes: [] })));
  assert.equal(silent.gestures.current.decisions, 0);
  assert.equal(silent.gestures.inherited.decisions, 0);
  assert.equal(silent.counterpoint.decisions, 0);
  assert.equal(silent.harmony.decisions, 0);
  assert.equal(silent.ornaments.observedAudibleFigures, 0);
  assert.equal(silent.ornaments.attacks, 0);
  assert.equal(silent.rhythm.referenceAttacks, 0);
  assert.ok(silent.gestures.unheardGroups > 0 && silent.counterpoint.unheardEntries > 0);
});

test('an ornament slide label without a real emitted pitch ramp earns no coverage', () => {
  const recipe = developmentalCoverageRecipe('tool-journey', '12tet');
  const engine = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters, sound: recipe.sound,
    conductor: recipe.conductor, phrasing: recipe.phrasing });
  const frames = Array.from({ length: 16 }, () => engine.step());
  const [left, right] = frames[0].phrase!.themeCore!.notes;
  const tick = left.startTick + 1;
  const frame = frames.find(item => tick >= item.tick && tick < item.tick + item.duration)!;
  frame.notes.push({ id: 'phrase:audit-fake-slide', tick, duration: right.startTick - tick,
    absolutePitch: { millicents: Math.round(left.absolutePitchCents * 1000) }, velocity: .5, part: 'melody', voice: 5,
    expression: { role: 'ornament', sourceId: `${left.sourceId}:ornament:connected-slide:0:0` } });
  const report = toolCoverageFromFrames(recipe.seed, frames);
  assert.equal(report.ornaments.invalidSlideEvents, 1);
  assert.equal(report.ornaments.connectedSlides, 0);
  assert.equal(report.ornaments.figuresByKind['connected-slide'], undefined);
  assert.ok(report.violations.some(message => message.includes('no complete audible pitch ramp')));
});
