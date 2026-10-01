import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, barToTick, conductParameters, formAt, type FormState } from '../src/conductor';
import { expressiveContourAt } from '../src/engine/expression';
import { compositionExpressionAt } from '../src/engine/composition-expression';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { FRAME_TICKS, PPQ } from '../src/types';
import type { TuningId } from '../src/pitch';

const config = { ...DEFAULT_CONDUCTOR, amount: 1, tuningTravel: true };
function sections(seed: string, count: number, home: TuningId = '12tet') {
  const output: FormState[] = [];
  for (let tick = 0; output.length < count;) {
    const form = formAt(seed, tick, config, home); output.push(form); tick = form.sectionEndTick;
  }
  return output;
}

test('expressive destinations are prepared across multiple complete sections with purposeful handoffs', () => {
  let prepared = 0, longJourneys = 0, open = 0, closed = 0, cuts = 0, boundaries = 0;
  for (let index = 0; index < 48; index++) {
    const seed = `long-destination-${index}`, forms = sections(seed, 56);
    for (const form of forms) {
      const behavior = form.behavior!;
      assert.ok(behavior.destinationSection! >= form.sectionIndex);
      assert.ok(['open', 'closed'].includes(behavior.ending!));
      if (behavior.ending === 'open') open++; else closed++;
      if (form.role === 'return') assert.equal(behavior.ending, 'closed');
      if (['intro', 'answer', 'development'].includes(form.role)) assert.equal(behavior.ending, 'open');
      if (form.sectionIndex > 0) { boundaries++; if (behavior.entry === 'cut') cuts++; }
      if (behavior.destinationSection! > form.sectionIndex) {
        prepared++;
        assert.ok(behavior.phase === 'prepare' || behavior.phase === 'settle');
        assert.equal(behavior.ending, 'open', 'An intermediate stage hands the argument onward.');
        if (behavior.destinationSection! - form.sectionIndex >= 2) longJourneys++;
        const destination = forms.find(candidate => candidate.sectionIndex === behavior.destinationSection);
        if (destination) {
          assert.equal(destination.cycle, form.cycle);
          assert.equal(destination.behavior!.destinationSection, destination.sectionIndex);
        }
      }
    }
  }
  assert.ok(prepared > 700 && longJourneys > 150);
  assert.ok(open > closed && closed > 250);
  assert.ok(cuts > 0 && cuts / boundaries < .04, `Cuts must be exceptional; observed ${cuts}/${boundaries}.`);
});

test('shared preparation follows one destination without restarting at phrase boundaries or jumping on flow edges', () => {
  const dimensions = ['energy', 'activity', 'intensity', 'ensembleSize', 'ideaDensity', 'register'] as const;
  let checked = 0;
  for (let index = 0; index < 12; index++) {
    const seed = `continuous-horizon-${index}`, at = (tick: number) => formAt(seed, tick, config);
    for (const form of sections(seed, 24)) {
      const duration = form.sectionEndTick - form.sectionStartTick;
      if (form.behavior!.destinationSection! > form.sectionIndex) {
        const trace = Array.from({ length: 17 }, (_, sample) => expressiveContourAt(seed,
          form.sectionStartTick + Math.floor((duration - 1) * sample / 16), at));
        for (const key of ['energy', 'activity', 'ensembleSize', 'ideaDensity', 'register'] as const) {
          const direction = Math.sign(trace.at(-1)![key]! - trace[0][key]!);
          assert.ok(trace.slice(1).every((value, sample) => (value[key]! - trace[sample][key]!) * direction >= -1e-12), `${key} abandoned its planned approach.`);
        }
        checked++;
      }
      const boundary = form.sectionEndTick, next = at(boundary);
      if (next.behavior!.entry !== 'cut') {
        const before = compositionExpressionAt(seed, boundary - 1, DEFAULT_PARAMETERS, at, 1);
        const after = compositionExpressionAt(seed, boundary, DEFAULT_PARAMETERS, at, 1);
        for (const key of dimensions) assert.ok(Math.abs(before.expression[key]! - after.expression[key]!) < .001);
      }
      for (let tick = form.sectionStartTick + form.barTicks * 4; tick < form.sectionEndTick; tick += form.barTicks * 4) {
        const before = expressiveContourAt(seed, tick - 1, at), after = expressiveContourAt(seed, tick, at);
        assert.ok(Math.abs(before.energy - after.energy) < .001);
      }
      for (const tick of [form.sectionStartTick, form.sectionEndTick - 1]) assert.equal(conductParameters(seed, tick, DEFAULT_PARAMETERS, config).tempo, DEFAULT_PARAMETERS.tempo);
    }
  }
  assert.ok(checked > 80);
});

test('native travel strongly favors inhabited 19-EDO regions and includes bounded 24/31-EDO destinations', () => {
  let totalTicks = 0, native19Ticks = 0, tours = 0;
  const destinations = new Set<TuningId>();
  for (let index = 0; index < 48; index++) {
    const seed = `inhabited-tunings-${index}`, forms = sections(seed, 64);
    for (const form of forms) {
      const duration = form.sectionEndTick - form.sectionStartTick;
      totalTicks += duration;
      if (form.tuning === '19edo') native19Ticks += duration;
      assert.equal(form.sectionStartTick % FRAME_TICKS, 0);
      assert.equal(barToTick(seed, form.bar, config), form.sectionStartTick);
    }
    for (let cycle = 0; cycle < forms.at(-1)!.cycle; cycle++) {
      const chapter = forms.filter(form => form.cycle === cycle), away = chapter.filter(form => form.tuning !== '12tet');
      assert.ok(away.length >= 3 && away.length <= 4);
      assert.equal(new Set(away.map(form => form.tuning)).size, 1);
      assert.equal(away.at(-1)!.sectionIndex - away[0].sectionIndex + 1, away.length);
      assert.equal(chapter[0].tuning, '12tet'); assert.equal(chapter.at(-1)!.tuning, '12tet');
      assert.equal(away[0].gliding, true); assert.equal(away[0].behavior!.entry, 'flow');
      assert.ok(away.slice(1).every(form => !form.gliding));
      const returning = chapter.find(form => form.sectionIndex === away.at(-1)!.sectionIndex + 1)!;
      assert.equal(returning.gliding, true); assert.equal(returning.behavior!.entry, 'flow');
      destinations.add(away[0].tuning); tours++;
    }
  }
  assert.ok(tours > 250);
  assert.deepEqual([...destinations].sort(), ['19edo', '24edo', '31edo']);
  assert.ok(native19Ticks / totalTicks > .22 && native19Ticks / totalTicks < .5,
    `19-EDO is a substantial residence, not a rare event: ${native19Ticks / totalTicks}.`);
});

test('declared native homes are exact when travel is off, and distant prepared routes replay without simulation', () => {
  for (const home of ['12tet', '19edo', '24edo', '31edo'] as const) {
    const seed = `home-${home}`, ticks = [0, PPQ, 100000, 5_000_000, 999_999_999];
    const snapshots = ticks.map(tick => formAt(seed, tick, config, home));
    for (const tick of [...ticks].reverse()) {
      assert.deepEqual(formAt(seed, tick, config, home), snapshots[ticks.indexOf(tick)]);
      const fixed = formAt(seed, tick, { ...config, tuningTravel: false }, home);
      assert.equal(fixed.tuning, home); assert.equal(fixed.gliding, false);
      assert.equal(fixed.sectionStartTick, snapshots[ticks.indexOf(tick)].sectionStartTick);
      assert.ok(fixed.behavior!.destinationSection! >= fixed.sectionIndex);
    }
  }
});

test('short episodes retain broad inner ramps instead of squeezing a surge into one beat', () => {
  let largest = 0, compared = 0;
  const keys = ['energy', 'intensity', 'activity', 'register', 'ideaDensity', 'ensembleSize'] as const;
  for (let index = 0; index < 48; index++) {
    const seed = `long-destination-${index}`, at = (tick: number) => formAt(seed, tick, config);
    for (const form of sections(seed, 56)) {
      for (let tick = form.sectionStartTick; tick < form.sectionEndTick; tick += PPQ / 4) {
        const next = at(tick + PPQ);
        if (next.sectionIndex !== form.sectionIndex && next.behavior!.entry === 'cut') continue;
        const before = expressiveContourAt(seed, tick, at), after = expressiveContourAt(seed, tick + PPQ, at);
        for (const key of keys) {
          const change = Math.abs(after[key]! - before[key]!);
          largest = Math.max(largest, change);
          assert.ok(change < .21, `${seed} ${form.role} ${key} moved ${change} in one quarter note.`);
        }
        compared++;
      }
    }
  }
  assert.ok(compared > 100_000);
  assert.ok(largest > .1, 'The bound preserves substantial contrast rather than flattening every trajectory.');
});
