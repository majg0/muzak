import test from 'node:test';
import assert from 'node:assert/strict';
import { planThoughtSpans } from '../src/engine/thought-spans';
import { composeThemeCore } from '../src/engine/theme-core';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { FRAME_TICKS, PPQ } from '../src/types';

test('short complete thoughts tile arbitrary meters without tiny leftover arguments', () => {
  const lengths = new Set<number>(); let unbarred = 0, uneven = 0;
  for (let seedId = 0; seedId < 24; seedId++) for (const density of [0, .5, 1]) for (const barTicks of [1200, 1680, 1920, 2880]) {
    const seed = `thought-budget-${seedId}`, bars = [7, 12, 18, 29][seedId % 4];
    const form = { sectionIndex: seedId, barTicks, sectionStartTick: 960, sectionEndTick: 960 + barTicks * bars };
    const core = composeThemeCore(seed, 'theme-a', 4), parameters = { ...DEFAULT_PARAMETERS, ideaDensity: density };
    const spans = planThoughtSpans(seed, form, core, parameters, .7, 'develop');
    assert.deepEqual(spans, planThoughtSpans(seed, form, core, parameters, .7, 'develop'));
    assert.equal(spans[0].startTick, form.sectionStartTick);
    assert.equal(spans.at(-1)!.endTick, form.sectionEndTick);
    const widths = spans.map(span => span.endTick - span.startTick);
    assert.equal(widths.reduce((sum, width) => sum + width, 0), form.sectionEndTick - form.sectionStartTick);
    if (new Set(widths).size > 1) uneven++;
    spans.forEach((span, index) => {
      assert.equal(span.startTick % FRAME_TICKS, 0);
      if (index < spans.length - 1) assert.equal(span.endTick % FRAME_TICKS, 0);
      assert.ok(span.endTick - span.startTick >= 3840, 'Every thought meets the compiler minimum, including the exact ending.');
      if (index) assert.equal(span.startTick, spans[index - 1].endTick);
      lengths.add(span.endTick - span.startTick);
      if (index && (span.startTick - form.sectionStartTick) % form.barTicks !== 0) unbarred++;
    });
  }
  assert.ok(lengths.size >= 8, `Only ${lengths.size} durations`);
  assert.ok(unbarred > 20 && uneven > 40, 'Source grouping can shape unequal thoughts that cross bars.');
});

test('literal melodies preserve full-repeat durations and absorb only the final episode remainder', () => {
  for (let index = 0; index < 24; index++) {
    const seed = `thought-identity-${index}`;
    const form = { sectionIndex: index, barTicks: 1680, sectionStartTick: 960, sectionEndTick: 960 + 48 * 1680 + 120 };
    const core = composeThemeCore(seed, 'theme-a', 4);
    const variants = [
      { treatment: 'sequence' as const, parameters: DEFAULT_PARAMETERS },
      { treatment: 'reharmonize' as const, parameters: DEFAULT_PARAMETERS },
      { treatment: 'develop' as const, parameters: { ...DEFAULT_PARAMETERS, motifTransformation: 0 } },
      { treatment: 'develop' as const, parameters: { ...DEFAULT_PARAMETERS, motifRecurrence: 1 } },
    ];
    for (const { treatment, parameters } of variants) {
      const spans = planThoughtSpans(seed, form, core, parameters, .7, treatment);
      const lengths = spans.slice(0, -1).map(span => span.endTick - span.startTick);
      assert.ok(lengths.length > 2);
      assert.equal(new Set(lengths).size, 1);
      assert.ok(lengths[0] >= 3840);
      assert.ok(spans.at(-1)!.endTick - spans.at(-1)!.startTick >= lengths[0]);
      assert.ok(spans.at(-1)!.endTick - spans.at(-1)!.startTick < lengths[0] * 2 + FRAME_TICKS,
        'Quantization leftovers cannot accumulate into an unmotivated long final thought.');
      assert.equal(spans.at(-1)!.endTick, form.sectionEndTick);
    }
  }
});

test('ordinary thoughts remain short and sparse delivery does not stretch them into long themes', () => {
  const form = { sectionIndex: 0, barTicks: 1920, sectionStartTick: 0, sectionEndTick: 48 * 1920 };
  for (let index = 0; index < 64; index++) {
    const seed = `concise-thought-${index}`, core = composeThemeCore(seed, 'theme-a', 4);
    const ordinary = planThoughtSpans(seed, form, core, DEFAULT_PARAMETERS, .68, 'develop');
    assert.ok(ordinary.length >= 12, 'A long episode contains many concise thoughts rather than eight forced long ones.');
    const mean = form.sectionEndTick / ordinary.length;
    assert.ok(mean >= 8 * PPQ && mean <= 16 * PPQ);
    const compact = planThoughtSpans(seed, form, core, { ...DEFAULT_PARAMETERS, ideaDensity: 1 }, 0, 'develop');
    const spacious = planThoughtSpans(seed, form, core, { ...DEFAULT_PARAMETERS, ideaDensity: 0 }, 1, 'develop');
    const spare = planThoughtSpans(seed, form, core, { ...DEFAULT_PARAMETERS, ideaDensity: 0 }, 0, 'develop');
    assert.equal(spacious.length, spare.length, 'Development alone cannot add bars to an ordinary argument.');
    assert.ok(spacious.length <= compact.length);
    assert.ok(form.sectionEndTick / spacious.length <= form.sectionEndTick / compact.length + PPQ + FRAME_TICKS,
      'Sparse delivery adds at most a pulse of room plus frame quantization.');
  }
});

test('source pulses and active group complexity own duration independently of bar labels and unrelated random draws', () => {
  const seed = 'source-shaped-time', core = composeThemeCore(seed, 'theme-a', 4);
  const form = { sectionIndex: 4, barTicks: 1920, sectionStartTick: 0, sectionEndTick: 48 * 1920 };
  const plain = { ...core, cell: { ...core.cell!, units: 16, pulseUnits: 4, groups: [8, 8] } };
  const grouped = { ...core, cell: { ...plain.cell, groups: [4, 4, 4, 4] } };
  const widePulseSpan = { ...core, cell: { ...plain.cell, pulseUnits: 2 } };
  const simple = planThoughtSpans(seed, form, plain, DEFAULT_PARAMETERS, .5, 'develop');
  assert.ok(planThoughtSpans(seed, form, grouped, DEFAULT_PARAMETERS, .5, 'develop').length < simple.length);
  assert.ok(planThoughtSpans(seed, form, widePulseSpan, DEFAULT_PARAMETERS, .5, 'develop').length < simple.length);
  assert.deepEqual(planThoughtSpans('unrelated-seed', { ...form, barTicks: 1680 }, plain, DEFAULT_PARAMETERS, .5, 'develop'), simple);
});

test('longer arguments require a rare sparse development episode, with bounded extension', () => {
  const core = composeThemeCore('extension-source', 'theme-a', 4);
  core.cell = { ...core.cell!, units: 16, pulseUnits: 4, groups: [4, 4, 4, 4] };
  const parameters = { ...DEFAULT_PARAMETERS, ideaDensity: .1 };
  const form = { sectionIndex: 9, barTicks: 1920, sectionStartTick: 0, sectionEndTick: 96 * 1920 };
  let extensions = 0;
  for (let index = 0; index < 160; index++) {
    const seed = `deliberate-extension-${index}`;
    const ordinary = planThoughtSpans(seed, { ...form, role: 'theme' }, core, parameters, 1, 'develop');
    const exploring = planThoughtSpans(seed, { ...form, role: 'development' }, core, parameters, 1, 'develop');
    const restrained = planThoughtSpans(seed, { ...form, role: 'development' }, core, parameters, .7, 'develop');
    assert.equal(restrained.length, ordinary.length);
    if (exploring.length < ordinary.length) extensions++;
    assert.ok(ordinary.length / exploring.length <= 1.6);
  }
  assert.ok(extensions > 0 && extensions < 24, `${extensions} extensions should be available but rare.`);
});

test('invalid or undersized episodes fail before reaching the theme compiler', () => {
  const seed = 'thought-validation', core = composeThemeCore(seed, 'theme-a', 4);
  const form = { sectionIndex: 0, barTicks: 1920, sectionStartTick: 0, sectionEndTick: 3840 };
  assert.deepEqual(planThoughtSpans(seed, form, core, DEFAULT_PARAMETERS, .5, 'develop'), [{ startTick: 0, endTick: 3840 }]);
  for (const patch of [{ sectionEndTick: 3839 }, { sectionStartTick: -1 }, { barTicks: 0 }, { sectionEndTick: Infinity }])
    assert.throws(() => planThoughtSpans(seed, { ...form, ...patch }, core, DEFAULT_PARAMETERS, .5, 'develop'), RangeError);
  assert.throws(() => planThoughtSpans(seed, form, core, { ...DEFAULT_PARAMETERS, ideaDensity: NaN }, .5, 'develop'), RangeError);
  assert.throws(() => planThoughtSpans(seed, form, { ...core, clauses: [] }, DEFAULT_PARAMETERS, .5, 'develop'), RangeError);
});

test('very long episodes retain a bounded plan without accumulating a giant final literal occurrence', () => {
  const seed = 'bounded-thought-storage', core = composeThemeCore(seed, 'theme-a', 4);
  const form = { sectionIndex: 0, barTicks: 1920, sectionStartTick: 0, sectionEndTick: 800 * FRAME_TICKS + 120 };
  for (const treatment of ['develop', 'sequence'] as const) {
    const spans = planThoughtSpans(seed, form, core, DEFAULT_PARAMETERS, .5, treatment);
    assert.ok(spans.length <= 128);
    assert.equal(spans.at(-1)!.endTick, form.sectionEndTick);
    assert.ok(spans.every(span => span.endTick - span.startTick >= 3840));
    const first = spans[0].endTick - spans[0].startTick, last = spans.at(-1)!;
    assert.ok(last.endTick - last.startTick < first * 2 + FRAME_TICKS);
  }
});
