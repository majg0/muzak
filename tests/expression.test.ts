import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, conductParameters, formAt, type FormState } from '../src/conductor';
import { expressiveContourAt, type ExpressiveContour } from '../src/engine/expression';
import { DEFAULT_PARAMETERS, evaluateAutomation } from '../src/parameters';

const dimensions = ['energy', 'activity', 'intensity', 'register', 'sustain', 'accent', 'ideaDensity', 'ensembleSize'] as const;
const config = { ...DEFAULT_CONDUCTOR, amount: 1 };
const lookup = (seed: string) => (tick: number) => formAt(seed, tick, config);
function sections(seed: string): FormState[] {
  const forms: FormState[] = [];
  for (let tick = 0; forms.length < 128;) {
    const form = lookup(seed)(tick); forms.push(form); tick = form.sectionEndTick;
  }
  return forms;
}
const sample = (seed: string, form: FormState, fraction: number) => expressiveContourAt(seed,
  Math.floor(form.sectionStartTick + (form.sectionEndTick - form.sectionStartTick) * fraction), lookup(seed));

test('absolute expressive contours remain continuous except at declared section cuts', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'long-sweep']) for (const form of sections(seed)) {
    const boundaries = [form.sectionEndTick,
      ...[.25, .375, .5, .75].map(position => Math.floor(form.sectionStartTick + (form.sectionEndTick - form.sectionStartTick) * position))];
    for (const boundary of boundaries) {
      const before = expressiveContourAt(seed, boundary - 1, lookup(seed));
      const after = expressiveContourAt(seed, boundary, lookup(seed));
      const next = lookup(seed)(boundary);
      if (boundary === next.sectionStartTick && next.behavior?.entry === 'cut') continue;
      for (const dimension of dimensions) assert.ok(Math.abs(after[dimension]! - before[dimension]!) < .001, `${dimension} jumped at ${boundary}`);
    }
  }
});

test('calm sections sustain a lower, longer contour while peaks have activity and emphasis', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'long-sweep']) {
    const forms = sections(seed), calm = forms.find(form => form.role === 'breakdown')!, peak = forms.find(form => form.role === 'climax')!;
    const average = (form: FormState, key: keyof Omit<ExpressiveContour, 'direction'>) => [.25, .375, .5, .625].reduce((sum, at) => sum + sample(seed, form, at)[key]!, 0) / 4;
    assert.ok(average(peak, 'intensity') - average(calm, 'intensity') > .55);
    assert.ok(average(peak, 'activity') > average(calm, 'activity') * 2.5);
    assert.ok(average(calm, 'sustain') - average(peak, 'sustain') > .38);
    assert.ok(average(peak, 'register') - average(calm, 'register') > .4);
    assert.ok(average(peak, 'accent') - average(calm, 'accent') > .35);
    const trace = Array.from({ length: 33 }, (_, index) => sample(seed, peak, index / 33));
    if (peak.behavior?.contour === 'plateau') {
      assert.equal(new Set([.32, .38, .44, .49].map(at => sample(seed, peak, at).intensity.toFixed(6))).size, 1, 'A declared plateau holds its destination before spending the second half preparing its successor.');
    } else {
      assert.ok(trace.some(point => point.direction === 'gathering') && trace.some(point => point.direction === 'receding'));
      assert.ok(Math.max(...trace.map(point => point.energy)) - Math.min(...trace.map(point => point.energy)) > .04, 'A sweeping section has a measurable approach and release, even when its peak saturates intensity.');
    }
    assert.ok(trace.slice(1).every((point, index) => Math.abs(point.intensity - trace[index].intensity) < .1));
  }
});

test('a thought boundary cannot restart or reroll an absolute expressive sweep', () => {
  const seed = 'one-long-breath', at = lookup(seed), form = sections(seed).find(form => form.sectionEndTick - form.sectionStartTick >= form.barTicks * 12)!;
  const whole = Array.from({ length: 64 }, (_, index) => Math.floor(form.sectionStartTick + (form.sectionEndTick - form.sectionStartTick) * index / 64));
  const direct = whole.map(tick => expressiveContourAt(seed, tick, at));
  const partitioned = [whole.slice(0, 16), whole.slice(16, 40), whole.slice(40)].flatMap(ticks => ticks.map(tick => expressiveContourAt(seed, tick, at)));
  assert.deepEqual(partitioned, direct);
  for (const tick of [...whole].reverse()) expressiveContourAt('unrelated', tick, lookup('unrelated'));
  assert.deepEqual(whole.map(tick => expressiveContourAt(seed, tick, at)), direct);
});

test('zero freedom is exactly neutral and partial freedom interpolates every expressive dimension', () => {
  const seed = 'neutral-control', at = lookup(seed), tick = 45678;
  const zero = expressiveContourAt(seed, tick, () => { throw new Error('Neutral expression needs no form lookup.'); }, 0);
  assert.deepEqual(zero, { energy: .5, activity: .5, intensity: .5, register: .5, sustain: .5, accent: .5, ideaDensity: .5, ensembleSize: .5, direction: 'settled' });
  const full = expressiveContourAt(seed, tick, at), half = expressiveContourAt(seed, tick, at, .5);
  for (const key of dimensions) {
    assert.equal(half[key], .5 + (full[key]! - .5) * .5);
    assert.ok(full[key]! >= 0 && full[key]! <= 1);
  }
  assert.throws(() => expressiveContourAt(seed, -1, at));
  assert.throws(() => expressiveContourAt(seed, .5, at));
});

test('explicit macro and tempo trajectories retain precedence over autonomous expression', () => {
  for (const tick of [0, 960, 45678, 120000]) {
    const conducted = conductParameters('manual-emphasis', tick, DEFAULT_PARAMETERS, config);
    const overridden = evaluateAutomation(conducted, [
      { parameter: 'dynamics', points: [{ tick: 0, value: .27, curve: 'step' }] },
      { parameter: 'rhythmicDensity', points: [{ tick: 0, value: .19, curve: 'step' }] },
      { parameter: 'tempo', points: [{ tick: 0, value: 91.125, curve: 'step' }] },
    ], tick);
    assert.equal(overridden.dynamics, .27);
    assert.equal(overridden.rhythmicDensity, .19);
    assert.equal(overridden.tempo, 91.125);
    assert.equal(conducted.tempo, DEFAULT_PARAMETERS.tempo);
  }
});

test('full-freedom expression reaches a genuinely soft interior and a broad high crest without tempo drift', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
    const forms = sections(seed), calm = forms.find(form => form.role === 'breakdown')!, peak = forms.find(form => form.role === 'climax')!;
    const values = (form: FormState) => [.25, .35, .45, .55, .65].map(position => sample(seed, form, position).intensity);
    assert.ok(Math.min(...values(calm)) < .025, `${seed} never withdraws below the old expression floor`);
    assert.ok(Math.max(...values(peak)) > .94, `${seed} never reaches a substantial crest`);
    for (const form of [calm, peak]) assert.equal(conductParameters(seed, form.sectionStartTick, DEFAULT_PARAMETERS, config).tempo, DEFAULT_PARAMETERS.tempo);
  }
});
