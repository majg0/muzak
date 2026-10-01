import test from 'node:test';
import assert from 'node:assert/strict';
import { barToTick, conductParameters, DEFAULT_CONDUCTOR, formAt, MANUAL_CONDUCTOR, rhythmicHomeFor, themeIds, type ConductorConfig, type FormState } from '../src/conductor';
import { thematicCell } from '../src/engine/idea-kernel';
import { DEFAULT_PARAMETERS, PARAMETER_DEFINITIONS } from '../src/parameters';
import { FRAME_TICKS, PPQ } from '../src/types';
import type { TuningId } from '../src/pitch';

function sections(seed: string, count: number, config: ConductorConfig = DEFAULT_CONDUCTOR, home: TuningId = '12tet'): FormState[] {
  const result: FormState[] = [];
  let tick = 0;
  for (let i = 0; i < count; i++) {
    const form = formAt(seed, tick, config, home);
    result.push(form);
    tick = form.sectionEndTick;
  }
  return result;
}

test('manual mode preserves parameter values and fixed 4/4 musical coordinates', () => {
  const base = { ...DEFAULT_PARAMETERS, tempo: 117.125, tension: .123456789 };
  for (const tick of [0, 960, 2400, 100_000, 5_000_000]) {
    assert.deepEqual(conductParameters('manual', tick, base, MANUAL_CONDUCTOR), base);
    const form = formAt('manual', tick, MANUAL_CONDUCTOR, '19edo');
    assert.deepEqual(form.meter, { numerator: 4, denominator: 4 });
    assert.equal(form.tuning, '19edo');
    assert.equal(form.gliding, false);
    assert.equal(form.bar, Math.floor(tick / (PPQ * 4)));
  }
  assert.equal(barToTick('manual', 17, MANUAL_CONDUCTOR), 17 * PPQ * 4);
  assert.deepEqual(conductParameters('zero', 12345, base, { ...DEFAULT_CONDUCTOR, amount: 0 }), base);
});

test('addressed form is repeatable and independent of query order and returned snapshots', () => {
  const ticks = [0, 960, 5700, 24_000, 100_000, 987_654_321];
  const expected = ticks.map(tick => formAt('夜の波', tick, DEFAULT_CONDUCTOR));
  for (const tick of [...ticks].reverse()) {
    formAt('unrelated', tick + 17, DEFAULT_CONDUCTOR);
    assert.deepEqual(formAt('夜の波', tick, DEFAULT_CONDUCTOR), expected[ticks.indexOf(tick)]);
    assert.deepEqual(conductParameters('夜の波', tick, DEFAULT_PARAMETERS, DEFAULT_CONDUCTOR), conductParameters('夜の波', tick, DEFAULT_PARAMETERS, { ...DEFAULT_CONDUCTOR }));
  }
  const mutated = formAt('夜の波', 0, DEFAULT_CONDUCTOR);
  mutated.meter.numerator = 100;
  assert.deepEqual(formAt('夜の波', 0, DEFAULT_CONDUCTOR), expected[0]);
});

test('mixed-meter sections and phrases align with commit boundaries and true bars', () => {
  const seenMeters = new Set<string>();
  for (const seed of ['glass-garden', 'velvet-orbit', '静かな庭']) {
    const forms = sections(seed, 64);
    for (const form of forms) {
      assert.equal(form.sectionStartTick % FRAME_TICKS, 0);
      assert.equal(form.sectionEndTick % FRAME_TICKS, 0);
      assert.equal(form.phraseStartTick % FRAME_TICKS, 0);
      assert.equal(form.phraseEndTick % FRAME_TICKS, 0);
      assert.equal(form.barTicks, form.meter.numerator * PPQ * 4 / form.meter.denominator);
      const bars = (form.sectionEndTick - form.sectionStartTick) / form.barTicks;
      assert.ok(Number.isInteger(bars) && bars >= 4 && bars <= 16);
      assert.equal(form.progress, 0);
      assert.equal(form.phrasePosition, 0);
      assert.equal(form.beat, 1);
      assert.equal(formAt(seed, form.sectionEndTick - 1, DEFAULT_CONDUCTOR).sectionIndex, form.sectionIndex);
      assert.equal(formAt(seed, form.sectionEndTick, DEFAULT_CONDUCTOR).sectionIndex, form.sectionIndex + 1);
      seenMeters.add(`${form.meter.numerator}/${form.meter.denominator}`);
    }
  }
  assert.ok(seenMeters.size >= 3 && seenMeters.has('4/4'), 'Different source spans can establish different pulses without requiring a catalogue in every piece.');
});

test('bar-to-tick is the inverse of meter-aware navigation, including distant bars', () => {
  for (const pace of [0, .6, 1]) {
    const config = { ...DEFAULT_CONDUCTOR, pace };
    for (const bar of [...Array.from({ length: 500 }, (_, i) => i), 12_345, 1_000_000]) {
      const tick = barToTick('metrical-map', bar, config), form = formAt('metrical-map', tick, config);
      assert.equal(form.bar, bar);
      assert.equal(form.barStartTick, tick);
      assert.equal(form.beat, 1);
      assert.equal(barToTick('metrical-map', bar + 1, config) - tick, form.barTicks);
      assert.equal(formAt('metrical-map', tick + form.barTicks - 1, config).bar, bar);
    }
  }
  assert.throws(() => formAt('bad', -.1, DEFAULT_CONDUCTOR));
  assert.throws(() => barToTick('bad', 1.5, DEFAULT_CONDUCTOR));
});

test('meter residences follow an actual thematic source and persist through intervening arguments', () => {
  const meters = new Set<string>();
  let changes = 0, boundaries = 0, inherited = 0;
  for (let seedIndex = 0; seedIndex < 32; seedIndex++) {
    const seed = `source-pulse-${seedIndex}`, forms = sections(seed, 260);
    let residenceIndex = 0;
    for (const [index, form] of forms.entries()) {
      const source = themeIds(seed).find(theme => thematicCell(seed, theme).id === form.meterSourceId)!;
      assert.ok(source, 'The meter names a real melodic source, not a post-hoc explanatory label.');
      const home = rhythmicHomeFor(seed, source);
      assert.deepEqual(form.meter, home.meter);
      assert.deepEqual(form.meterGroups, home.groups);
      assert.equal(form.meterGroups!.reduce((sum, group) => sum + group, 0), form.meter.numerator);
      assert.equal(form.barTicks, home.cell.units * PPQ / 4);
      assert.ok(form.meterResidenceStartTick! <= form.sectionStartTick);
      if (form.themeId !== source) inherited++;
      if (index && form.meterResidenceStartTick !== forms[index - 1].meterResidenceStartTick) {
        // A cache boundary may continue the same source; it never invents an
        // extra meter change or breaks integer-bar navigation.
        assert.ok(index - residenceIndex >= 4);
        assert.equal(form.themeId, source, 'The new residence is introduced by an actual argument of its source.');
        assert.equal(form.meterResidenceStartTick, form.sectionStartTick);
        residenceIndex = index;
      }
      if (index) {
        boundaries++;
        if (form.meter.numerator !== forms[index - 1].meter.numerator || form.meter.denominator !== forms[index - 1].meter.denominator) changes++;
      }
      meters.add(`${form.meter.numerator}/${form.meter.denominator}`);
    }
    const modified = rhythmicHomeFor(seed, 'theme-a');
    modified.groups[0] = 999; modified.cell.attacks[0].unit = 999;
    assert.deepEqual(rhythmicHomeFor(seed, 'theme-a').cell, thematicCell(seed, 'theme-a'), 'Callers cannot corrupt the cached source.');
  }
  assert.ok(meters.size >= 6, 'Generated source spans produce several reachable meters.');
  assert.ok(changes / boundaries < .2 && changes / boundaries > .025, `Meter changes ${changes}/${boundaries} should be inhabited rather than mandatory at every role.`);
  assert.ok(inherited > 1000, 'Contrasting ideas often converse over an established pulse.');
});

test('pace changes section lengths while themes and groove identities recur independently', () => {
  const slow = sections('form-story', 128, { ...DEFAULT_CONDUCTOR, pace: 0 });
  const fast = sections('form-story', 128, { ...DEFAULT_CONDUCTOR, pace: 1 });
  const duration = (forms: FormState[]) => forms.at(-1)!.sectionEndTick - forms[0].sectionStartTick;
  assert.ok(duration(slow) > duration(fast) * 1.5);
  assert.ok(fast.every(form => (form.sectionEndTick - form.sectionStartTick) / form.barTicks <= 12));
  assert.equal(slow[0].themeId, fast[0].themeId);
  for (const forms of [slow, fast]) for (const family of new Set(forms.map(form => form.themeId))) {
    const first = forms.find(form => form.themeId === family && form.role !== 'intro')!;
    assert.equal(first.role, 'theme');
    assert.ok((first.sectionEndTick - first.sectionStartTick) / first.barTicks >= 8);
  }
  assert.equal(new Set(fast.map(form => form.instrument)).size, 9);
  assert.ok(new Set(fast.filter(form => form.themeId === 'theme-a').map(form => form.grooveId)).size > 1);
  assert.ok(new Set(fast.filter(form => form.grooveId === 'steady-pocket').map(form => form.themeId)).size > 1);
  assert.ok(fast.every(form => form.swing >= 0 && form.swing <= .2 && PPQ % form.subdivisionTicks === 0));
});

test('native tuning residences cross whole sections and return home through prepared boundaries', () => {
  for (const home of ['12tet', '19edo', '24edo', '31edo'] as const) {
    const forms = sections('tuning-route', 60, DEFAULT_CONDUCTOR, home);
    for (let index = 0; index < forms.length - 1; index++) {
      const form = forms[index];
      const changed = index > 0 && form.tuning !== forms[index - 1].tuning;
      assert.equal(form.gliding, changed);
      assert.equal(formAt('tuning-route', form.sectionStartTick + FRAME_TICKS - 1, DEFAULT_CONDUCTOR, home).gliding, changed);
      assert.equal(formAt('tuning-route', form.sectionStartTick + FRAME_TICKS, DEFAULT_CONDUCTOR, home).gliding, false);
      if (form.tuning !== home) {
        assert.ok(['12tet', '19edo', '24edo', '31edo'].includes(form.tuning));
        if (changed) assert.equal(form.behavior!.entry, 'flow');
      }
    }
    for (let cycle = 0; cycle < forms.at(-1)!.cycle; cycle++) {
      const chapter = forms.filter(form => form.cycle === cycle), away = chapter.filter(form => form.tuning !== home);
      assert.ok(away.length >= 3 && away.length <= 4);
      assert.equal(new Set(away.map(form => form.tuning)).size, 1);
      assert.equal(away.at(-1)!.sectionIndex - away[0].sectionIndex + 1, away.length);
      assert.equal(chapter[0].tuning, home); assert.equal(chapter.at(-1)!.tuning, home);
    }
    const fixed = sections('tuning-route', 16, { ...DEFAULT_CONDUCTOR, tuningTravel: false }, home);
    assert.ok(fixed.every(form => form.tuning === home && !form.gliding));
  }
});

test('all macro trajectories remain bounded and continuous except at declared section cuts', () => {
  const forms = sections('macro-continuity', 24);
  for (const form of forms) {
    for (let tick = form.sectionStartTick; tick < form.sectionEndTick; tick += FRAME_TICKS) {
      const parameters = conductParameters('macro-continuity', tick, DEFAULT_PARAMETERS, DEFAULT_CONDUCTOR);
      for (const definition of PARAMETER_DEFINITIONS) assert.ok(parameters[definition.key] >= definition.min && parameters[definition.key] <= definition.max);
    }
    const before = conductParameters('macro-continuity', form.sectionEndTick - 1, DEFAULT_PARAMETERS, DEFAULT_CONDUCTOR);
    const after = conductParameters('macro-continuity', form.sectionEndTick, DEFAULT_PARAMETERS, DEFAULT_CONDUCTOR);
    const next = formAt('macro-continuity', form.sectionEndTick, DEFAULT_CONDUCTOR);
    if (next.behavior?.entry !== 'cut') for (const definition of PARAMETER_DEFINITIONS) assert.ok(Math.abs(after[definition.key] - before[definition.key]) < .0001, `${definition.key} jumped at section ${form.sectionIndex}`);
    if (form.phraseEndTick < form.sectionEndTick) {
      const left = conductParameters('macro-continuity', form.phraseEndTick - 1, DEFAULT_PARAMETERS, DEFAULT_CONDUCTOR);
      const right = conductParameters('macro-continuity', form.phraseEndTick, DEFAULT_PARAMETERS, DEFAULT_CONDUCTOR);
      for (const definition of PARAMETER_DEFINITIONS) assert.ok(Math.abs(right[definition.key] - left[definition.key]) < (definition.key === 'tempo' ? .03 : .001));
    }
  }
});

test('home hooks contrast with exploration while keeping the chosen tempo', () => {
  const config = { ...DEFAULT_CONDUCTOR, pace: 1 };
  const forms = sections('contrast', 128, config);
  const values = forms.map(form => conductParameters('contrast', form.sectionStartTick, DEFAULT_PARAMETERS, config));
  const atRole = (role: FormState['role']) => {
    const form = forms.find(form => form.role === role)!;
    return conductParameters('contrast', Math.floor((form.sectionStartTick + form.sectionEndTick) / 2), DEFAULT_PARAMETERS, config);
  };
  const theme = atRole('theme'), development = atRole('development'), peak = atRole('climax'), rest = atRole('breakdown'), returning = atRole('return');
  assert.ok(theme.tonalClarity > .68 && theme.dissonance < .25 && theme.melodicFamiliarity > .75);
  assert.ok(returning.motifRecurrence > .9 && returning.motifTransformation < .13);
  assert.ok(development.dissonance > theme.dissonance && development.tonalClarity < theme.tonalClarity - .1);
  assert.ok(development.melodicFamiliarity > .5, 'Development retains a recognizable source even while harmony travels.');
  assert.ok(peak.tension > .8 && rest.tension < .13);
  assert.ok(peak.dynamics - rest.dynamics > .65);
  assert.ok(values.every(parameters => parameters.tempo === DEFAULT_PARAMETERS.tempo));
  for (const definition of PARAMETER_DEFINITIONS.filter(item => !['tempo', 'ideaDensity', 'ensembleSize'].includes(item.key))) assert.ok(new Set(values.map(parameters => parameters[definition.key])).size > 3, `${definition.key} never develops`);
});

test('the chosen pulse remains exact across every section, phrase, amount and pace', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'steady-pulse']) {
    for (const pace of [0, .6, 1]) {
      const config = { ...DEFAULT_CONDUCTOR, pace };
      const forms = sections(seed, 40, config);
      for (const tempo of [40, 88, 123.456789, 180]) {
        for (const form of forms) {
          for (const tick of [form.sectionStartTick, form.sectionStartTick + form.barTicks, form.sectionEndTick - form.barTicks / 2, form.sectionEndTick - 1]) {
            for (const amount of [0, .35, 1]) assert.equal(conductParameters(seed, tick, { ...DEFAULT_PARAMETERS, tempo }, { ...config, amount }).tempo, tempo);
          }
        }
      }
    }
  }
});

test('harmonic character remains established while expression and a multi-bar approach develop', () => {
  const config = { ...DEFAULT_CONDUCTOR, amount: 1 };
  let preparedEarlier = 0, flowingContrasts = 0;
  for (const form of sections('section-identity', 40, config)) {
    const first = conductParameters('section-identity', form.sectionStartTick, DEFAULT_PARAMETERS, config);
    const next = conductParameters('section-identity', form.sectionEndTick, DEFAULT_PARAMETERS, config);
    const stableEnd = form.sectionStartTick + Math.floor((form.sectionEndTick - form.sectionStartTick) * .6);
    for (let tick = form.sectionStartTick; tick <= stableEnd; tick += PPQ / 2) {
      const actual = conductParameters('section-identity', tick, DEFAULT_PARAMETERS, config);
      for (const key of ['tonalClarity', 'dissonance', 'harmonicMobility', 'melodicFamiliarity'] as const) assert.ok(Math.abs(actual[key] - first[key]) <= .023, `${form.role} ${key} abandoned its identity early`);
    }
    const beforeFinalBar = conductParameters('section-identity', form.sectionEndTick - form.barTicks, DEFAULT_PARAMETERS, config);
    const nextForm = formAt('section-identity', form.sectionEndTick, config);
    if (Math.abs(next.tonalClarity - first.tonalClarity) > .25 && nextForm.behavior?.entry !== 'cut') {
      flowingContrasts++;
      if (Math.abs(beforeFinalBar.tonalClarity - first.tonalClarity) > .05) preparedEarlier++;
    }
    const dynamics = Array.from({ length: 32 }, (_, index) => conductParameters('section-identity',
      form.sectionStartTick + Math.floor((form.sectionEndTick - form.sectionStartTick) * index / 32), DEFAULT_PARAMETERS, config).dynamics);
    const extent = Math.max(...dynamics) - Math.min(...dynamics);
    if (extent > .025) assert.ok(dynamics.slice(1).every((value, index) => Math.abs(value - dynamics[index]) < Math.max(.015, extent * .3)),
      'An actual sweep distributes its change over several readings; a continuing thought may hold before it releases.');
  }
  assert.ok(flowingContrasts >= 3);
  assert.equal(preparedEarlier, flowingContrasts, 'Every substantial flowing contrast receives preparation; explicitly cut blocks are kept intact.');
});

test('long form has no missing, overlapping, or prematurely advanced sections across layout wraps', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'wrap-boundary-庭']) {
    for (const pace of [0, .6, 1]) {
      const config = { ...DEFAULT_CONDUCTOR, pace };
      const forms = sections(seed, 257, config);
      for (let index = 0; index < forms.length - 1; index++) {
        const section = forms[index], next = forms[index + 1];
        assert.equal(section.sectionIndex, index);
        assert.ok(next.cycle === section.cycle || next.cycle === section.cycle + 1);
        if (next.cycle > section.cycle) assert.equal(next.cycle, section.cycle + 1);
        assert.equal(section.sectionEndTick, next.sectionStartTick);
        assert.equal(section.bar + (section.sectionEndTick - section.sectionStartTick) / section.barTicks, next.bar);
        for (const tick of [section.sectionStartTick, section.sectionStartTick + 1, section.sectionStartTick + section.barTicks, section.sectionEndTick - FRAME_TICKS, section.sectionEndTick - 1]) {
          const form = formAt(seed, tick, config);
          assert.equal(form.sectionIndex, index);
          assert.ok(form.sectionStartTick <= tick && tick < form.sectionEndTick);
          assert.ok(form.phraseStartTick <= tick && tick < form.phraseEndTick);
          assert.ok(form.barStartTick <= tick && tick < form.barStartTick + form.barTicks);
          assert.ok(form.progress >= 0 && form.progress < 1);
          assert.ok(form.phrasePosition >= 0 && form.phrasePosition < 1);
          assert.equal(barToTick(seed, form.bar, config), form.barStartTick);
        }
        assert.equal(formAt(seed, section.sectionEndTick, config).sectionIndex, index + 1);
        assert.equal(formAt(seed, section.sectionEndTick, config).phraseIndex, formAt(seed, section.sectionEndTick - 1, config).phraseIndex + 1);
      }
    }
  }
});

test('different seeds have stronger character differences at high Freedom without moving the tempo', () => {
  const sample = (amount: number) => Array.from({ length: 40 }, (_, index) => {
    const seed = `distinct-character-${index}`, config = { ...DEFAULT_CONDUCTOR, amount };
    const development = sections(seed, 128, config).find(form => form.role === 'development')!;
    return conductParameters(seed, development.sectionStartTick, DEFAULT_PARAMETERS, config);
  });
  const low = sample(.25), high = sample(1);
  const range = (values: typeof low, key: keyof typeof DEFAULT_PARAMETERS) => Math.max(...values.map(value => value[key])) - Math.min(...values.map(value => value[key]));
  for (const key of ['brightness', 'harmonicMobility', 'quartalTendency', 'rhythmicDensity', 'bassIndependence'] as const) {
    assert.ok(range(high, key) > .25, `${key} needs audible room to differ among seeds`);
    assert.ok(range(high, key) > range(low, key) * 6, `${key} should explore a wider range at high Freedom`);
  }
  assert.ok([...low, ...high].every(parameters => parameters.tempo === DEFAULT_PARAMETERS.tempo));
  assert.equal(new Set(high.map(parameters => JSON.stringify(parameters))).size, high.length);
});

test('seed palettes, recurring grooves and richer subdivision choices stay fixed inside each section', () => {
  const openingColors = new Set<string>(), gridChoices = new Set<number>(), openingGrooves = new Set<string>();
  const lowGridChoices = new Set<number>();
  for (let index = 0; index < 64; index++) {
    const seed = `orchestration-${index}`, config = { ...DEFAULT_CONDUCTOR, amount: 1 };
    const forms = sections(seed, 24, config);
    openingColors.add(forms[0].instrument);
    openingGrooves.add(forms[0].grooveId);
    for (const form of forms) {
      gridChoices.add(form.subdivisionTicks);
      const nearEnd = formAt(seed, form.sectionEndTick - 1, config);
      assert.equal(nearEnd.instrument, form.instrument);
      assert.equal(nearEnd.grooveId, form.grooveId);
      assert.equal(nearEnd.subdivisionTicks, form.subdivisionTicks);
      assert.equal(nearEnd.swing, form.swing);
      assert.equal(PPQ % form.subdivisionTicks, 0);
    }
    for (const returning of forms.filter(form => form.role === 'return')) {
      const theme = forms.find(form => form.sectionIndex < returning.sectionIndex && form.themeId === returning.themeId && ['theme', 'answer'].includes(form.role))!;
      assert.equal(returning.instrument, theme.instrument);
      assert.ok(['steady-pocket', 'lilting-pocket', 'broken-pocket'].includes(returning.grooveId));
      assert.equal(PPQ % returning.subdivisionTicks, 0, 'A new reading can change density while preserving the returned groove and quarter pulse.');
    }
    for (const form of sections(seed, 8, { ...config, amount: .25 })) lowGridChoices.add(form.subdivisionTicks);
  }
  assert.equal(openingColors.size, 9);
  assert.equal(openingGrooves.size, 3);
  assert.deepEqual([...gridChoices].sort((a, b) => a - b), [80, 120, 160, 240, 480]);
  assert.deepEqual([...lowGridChoices].sort((a, b) => a - b), [120, 240, 480]);
});

test('broader seed character preserves clear returning hooks, release and changing readings of repeated roles', () => {
  for (let index = 0; index < 24; index++) {
    const seed = `protected-return-${index}`, config = { ...DEFAULT_CONDUCTOR, amount: 1 };
    const forms = sections(seed, 256, config);
    const at = (form: FormState) => conductParameters(seed, form.sectionStartTick, DEFAULT_PARAMETERS, config);
    for (const section of forms.filter(form => form.role === 'theme' || form.role === 'return')) {
      const home = at(section);
      assert.ok(home.tonalClarity >= .7 - 1e-12 && home.dissonance <= .23 + 1e-12);
      assert.ok(home.melodicFamiliarity >= .78 - 1e-12 && home.metricStability >= .74 - 1e-12);
    }
    const interior = (form: FormState) => conductParameters(seed, Math.floor((form.sectionStartTick + form.sectionEndTick) / 2), DEFAULT_PARAMETERS, config);
    const peak = interior(forms.find(form => form.role === 'climax')!), rest = interior(forms.find(form => form.role === 'breakdown')!);
    assert.ok(peak.tension >= .83 && rest.tension <= .13);
    assert.ok(peak.dynamics - rest.dynamics >= .62);
    assert.ok(peak.rhythmicDensity - rest.rhythmicDensity >= .5);
    const answers = forms.filter(form => form.role === 'answer'), themes = forms.filter(form => form.role === 'theme');
    assert.notDeepEqual(at(answers[0]), at(answers[1]), 'Repeated answer roles should develop a section-specific reading.');
    assert.notDeepEqual(at(themes[0]), at(themes[1]), 'A later theme should retain its identity while its character develops.');
  }
});

test('home sections retain genuinely different harmonic and rhythmic characters across seeds', () => {
  const config = { ...DEFAULT_CONDUCTOR, amount: 1 };
  const readings = Array.from({ length: 64 }, (_, index) => {
    const seed = `home-character-${index}`, theme = sections(seed, 4, config).find(form => form.role === 'theme')!;
    return conductParameters(seed, theme.sectionStartTick, DEFAULT_PARAMETERS, config);
  });
  for (const key of ['tonalClarity', 'tonalGravity', 'dissonance', 'voiceLeading', 'rhythmicPredictability', 'melodicFamiliarity'] as const) {
    const values = readings.map(reading => reading[key]);
    assert.ok(Math.max(...values) - Math.min(...values) > .19, `${key} must not collapse into the old narrow home clamp`);
    assert.ok(new Set(values.map(value => value.toFixed(3))).size >= 20, `${key} should retain more than two clipped styles`);
  }
  assert.ok(readings.every(reading => reading.tempo === DEFAULT_PARAMETERS.tempo));
});

test('every transformation and return is earned by an actual exposition of its family', () => {
  for (let index = 0; index < 32; index++) {
    const seed = `causal-narrative-${index}`, forms = sections(seed, 270);
    const heard = new Map<string, number>();
    const departure = new Map<string, number>();
    for (const form of forms) {
      assert.ok(themeIds(seed).includes(form.themeId));
      assert.ok(form.formName && form.sectionIntent && form.sectionName);
      if (form.role === 'theme' || form.role === 'answer') {
        if (!heard.has(form.themeId)) assert.ok((form.sectionEndTick - form.sectionStartTick) / form.barTicks >= 8, 'A new tune gets a complete statement.');
        heard.set(form.themeId, form.sectionIndex);
      } else if (form.role !== 'intro') {
        assert.ok(heard.has(form.themeId), `${form.role} cannot refer to an unheard ${form.themeId} at ${form.sectionIndex}`);
      }
      if (form.role === 'development') departure.set(form.themeId, form.sectionIndex);
      if (form.role === 'climax') assert.ok((departure.get(form.themeId) ?? Infinity) < form.sectionIndex, 'A peak pays off still-unresolved development of its own family.');
      if (['climax', 'return', 'breakdown'].includes(form.role)) departure.delete(form.themeId);
      if (form.role === 'return') {
        const statementIndex = heard.get(form.themeId)!;
        assert.ok(form.sectionIndex - statementIndex >= 2, 'A return has an intervening episode rather than immediate literal repetition.');
        assert.ok(forms.slice(statementIndex + 1, form.sectionIndex).some(episode => episode.role === 'development' || episode.themeId !== form.themeId));
        assert.equal(form.tonalOffsetCents, 0, 'A returning family arrives in the physical home region.');
      }
    }
    assert.equal(heard.size, themeIds(seed).length, 'Long form introduces the complete declared repertoire.');
    for (const family of themeIds(seed).slice(1)) assert.equal(forms.find(form => form.themeId === family)!.role, 'theme');
  }
});

test('context-composed journeys vary their order and may continue without a climax or homecoming', () => {
  const signatures = new Set<string>(), counts = new Set<number>(), endings = new Set<string>(), delays = new Set<number>();
  let withoutClimax = 0, withoutReturn = 0, directContinuations = 0;
  for (let index = 0; index < 40; index++) {
    const forms = sections(`route-identity-${index}`, 128);
    for (let cycle = 0; cycle < 16; cycle++) {
      const journey = forms.filter(form => form.cycle === cycle);
      signatures.add(journey.map(form => `${form.role}:${form.themeId}:${(form.sectionEndTick - form.sectionStartTick) / form.barTicks}`).join('|'));
      counts.add(journey.length); endings.add(journey.at(-1)!.role);
      assert.ok(journey.every(form => form.formName === journey[0].formName));
      if (!journey.some(form => form.role === 'climax')) withoutClimax++;
      if (!journey.some(form => form.role === 'return')) withoutReturn++;
      if (cycle && journey[0].themeId === forms[journey[0].sectionIndex - 1].themeId) directContinuations++;
      for (const returning of journey.filter(form => form.role === 'return')) {
        const source = forms.find(form => form.themeId === returning.themeId && form.role === 'theme')!;
        assert.ok(source.sectionIndex < returning.sectionIndex);
        delays.add(returning.sectionIndex - source.sectionIndex);
      }
    }
  }
  assert.equal(counts.size, 8, 'Every episode count from five through twelve is used.');
  assert.ok(endings.size >= 5, 'A journey boundary is not an obligatory return or cadence.');
  assert.ok(signatures.size > 600 && delays.size > 30);
  assert.ok(withoutClimax > 250 && withoutReturn > 30 && directContinuations > 100);
});

test('tonal regions hold for entire sections, departures move away, and recollections arrive home', () => {
  const regions = new Set<number>();
  for (let index = 0; index < 16; index++) {
    const seed = `regional-story-${index}`;
    for (const form of sections(seed, 80)) {
      assert.ok([0, 500, 700, 900, 200, -300].includes(form.tonalOffsetCents!));
      regions.add(form.tonalOffsetCents!);
      for (const tick of [form.sectionStartTick + 1, form.phraseEndTick - 1, form.sectionEndTick - 1]) assert.equal(formAt(seed, tick, DEFAULT_CONDUCTOR).tonalOffsetCents, form.tonalOffsetCents);
      if (form.role === 'development') assert.notEqual(form.tonalOffsetCents, 0);
      if (form.role === 'return') assert.equal(form.tonalOffsetCents, 0);
    }
  }
  assert.equal(regions.size, 6);
});

test('openings state a whole idea promptly while later families enter at different ages and positions', () => {
  let directOpenings = 0, pickups = 0;
  const entrancePositions = new Set<number>(), initialFamilyCounts = new Set<number>(), finalEntranceCycles = new Set<number>();
  for (let index = 0; index < 40; index++) {
    const seed = `opening-material-${index}`, families = themeIds(seed);
    const forms = sections(seed, 48), opening = forms.filter(form => form.cycle === 0);
    if (opening[0].role === 'intro') {
      pickups++;
      const minimumWholeBars = Math.ceil(12 * PPQ / opening[0].barTicks);
      assert.ok((opening[0].sectionEndTick - opening[0].sectionStartTick) / opening[0].barTicks <= Math.max(4, minimumWholeBars) + 3,
        'A pickup stays short while retaining frame-aligned true bars and at least twelve quarter beats.');
      assert.equal(opening[1].role, 'theme');
    } else { directOpenings++; assert.equal(opening[0].role, 'theme'); }
    const introductions = families.map(family => forms.find(form => form.themeId === family && form.role !== 'intro')!);
    assert.ok(introductions.every(form => form && form.role === 'theme' && form.sectionIndex <= (families.length - 1) * 5 + 7));
    for (const form of introductions) assert.ok((form.sectionEndTick - form.sectionStartTick) / form.barTicks >= 8);
    introductions.slice(1).forEach(form => entrancePositions.add(form.sectionIndex));
    initialFamilyCounts.add(new Set(opening.filter(form => form.role !== 'intro').map(form => form.themeId)).size);
    finalEntranceCycles.add(Math.max(...introductions.map(form => form.cycle)));
  }
  assert.ok(directOpenings >= 30 && pickups <= 10);
  assert.ok(entrancePositions.size >= 8 && initialFamilyCounts.size >= 2 && finalEntranceCycles.size >= 2);
});

test('repertoire size varies while every family earns its place and distant navigation preserves aggregate geometry', () => {
  const sizes = new Set<number>();
  for (let index = 0; index < 30; index++) {
    const seed = `repertoire-${index}`, families = themeIds(seed), copy = [...families];
    sizes.add(families.length);
    assert.ok(families.length >= 3 && families.length <= 7);
    assert.equal(new Set(families).size, families.length);
    assert.ok(Object.isFrozen(families));
    formAt('unrelated-repertoire', index * 12345, DEFAULT_CONDUCTOR);
    assert.deepEqual(themeIds(seed), copy);
    for (const pace of [0, 1]) {
      const config = { ...DEFAULT_CONDUCTOR, pace }, forms = sections(seed, 257, config);
      for (const family of families) {
        const first = forms.find(form => form.themeId === family && form.role !== 'intro')!;
        assert.ok(first && first.role === 'theme' && first.sectionIndex < 128);
        assert.ok((first.sectionEndTick - first.sectionStartTick) / first.barTicks >= 8);
      }
      assert.equal(forms[256].sectionStartTick, forms[128].sectionStartTick * 2);
      assert.equal(forms[256].bar, forms[128].bar * 2);
      assert.equal(forms[256].phraseIndex, forms[128].phraseIndex * 2);
      for (const bar of [forms[127].bar, forms[128].bar, forms[256].bar, 1_000_000 + index]) {
        const tick = barToTick(seed, bar, config), form = formAt(seed, tick, config);
        assert.equal(form.bar, bar);
        assert.equal(form.barStartTick, tick);
        assert.ok(families.includes(form.themeId));
        assert.ok(form.instrument);
      }
    }
  }
  assert.deepEqual([...sizes].sort(), [3, 4, 5, 6, 7]);
});

test('later cache blocks compose new routes and durations rather than replaying a permuted atlas', () => {
  const seed = 'unfolding-atlas', forms = sections(seed, 385);
  const first = forms.slice(0, 128), second = forms.slice(128, 256), third = forms.slice(256, 384);
  const signature = (group: FormState[]) => group.map(form => `${form.role}/${form.themeId}/${form.meter.numerator}:${form.meter.denominator}/${(form.sectionEndTick - form.sectionStartTick) / form.barTicks}`);
  assert.notDeepEqual(signature(first), signature(second));
  assert.notDeepEqual([...signature(first)].sort(), [...signature(second)].sort(), 'Later material must be newly composed, not a shuffle of the same role/length pairs.');
  assert.notDeepEqual(signature(second), signature(third));
  assert.equal(second[0].sectionStartTick * 2, third[0].sectionStartTick);
  assert.equal(second[0].bar * 2, third[0].bar);
  for (const start of [second[0], third[0]]) {
    const before = formAt(seed, start.sectionStartTick - 1, DEFAULT_CONDUCTOR);
    assert.equal(before.sectionIndex + 1, start.sectionIndex);
    assert.equal(before.phraseIndex + 1, start.phraseIndex);
    assert.equal(before.cycle + 1, start.cycle);
    assert.equal(barToTick(seed, start.bar, DEFAULT_CONDUCTOR), start.sectionStartTick);
  }
  for (const form of second) assert.deepEqual(formAt(seed, barToTick(seed, form.bar, DEFAULT_CONDUCTOR), DEFAULT_CONDUCTOR), form);
});

test('an optional reply never duplicates the immediately following family answer', () => {
  for (const seed of ['glass-garden', ...Array.from({ length: 40 }, (_, index) => `earned-reply-${index}`)]) {
    const forms = sections(seed, 400);
    for (let index = 1; index < forms.length; index++) {
      const previous = forms[index - 1], current = forms[index];
      assert.ok(previous.role !== current.role || previous.themeId !== current.themeId || previous.sectionIntent !== current.sectionIntent,
        `${seed}: ${current.sectionName} repeats the same episode at ${current.sectionIndex}`);
    }
  }
});

test('slow form can sustain a whole theme for several passes while default pacing stays compact', () => {
  const extendedSizes = new Set<number>();
  for (let index = 0; index < 16; index++) {
    const seed = `extended-thought-${index}`;
    const slowConfig = { ...DEFAULT_CONDUCTOR, pace: 0 };
    for (const form of sections(seed, 40, slowConfig)) {
      const bars = (form.sectionEndTick - form.sectionStartTick) / form.barTicks;
      assert.ok(Number.isInteger(bars) && bars <= 32);
      if (bars > 16) {
        extendedSizes.add(bars);
        if (bars > 20) assert.ok(form.role === 'theme' || form.role === 'return');
        assert.equal(form.sectionStartTick % FRAME_TICKS, 0); assert.equal(form.sectionEndTick % FRAME_TICKS, 0);
        const last = formAt(seed, form.sectionEndTick - 1, slowConfig);
        assert.equal(last.sectionIndex, form.sectionIndex);
        assert.equal(last.phraseIndex - form.phraseIndex + 1, Math.ceil(bars / 4));
        assert.equal(conductParameters(seed, form.sectionEndTick - 1, DEFAULT_PARAMETERS, slowConfig).tempo, DEFAULT_PARAMETERS.tempo);
      }
    }
    for (const pace of [.4, DEFAULT_CONDUCTOR.pace, 1]) {
      for (const form of sections(seed, 40, { ...DEFAULT_CONDUCTOR, pace })) assert.ok((form.sectionEndTick - form.sectionStartTick) / form.barTicks <= 16);
    }
  }
  assert.ok(extendedSizes.has(24) && extendedSizes.has(32));
});
