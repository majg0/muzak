import test from 'node:test';
import assert from 'node:assert/strict';
import { planOrnaments, ORNAMENT_KINDS } from '../src/engine/ornaments';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { lyricalField } from '../src/engine/lyrical-support';
import { TUNINGS, type TuningId } from '../src/pitch';

const core = [0, 400, 200, 700, 500, 0].map((cents, index) => ({ tick: index * 960, duration: 900, cents, accent: index === 0 ? 1 : .85,
  landing: index === 5, sourceId: `tune:${index}` }));
const input = { seed: 'decorated-theme', occurrenceId: 'phrase:3:1', sourceId: 'theme-a:question', core,
  endTick: 5760, subdivisionTicks: 120, parameters: DEFAULT_PARAMETERS, amount: 1, variation: 1, energy: .8 };

test('ornaments leave the structural tune untouched and make explicit room through duration trims', () => {
  const copy = structuredClone(core), plan = planOrnaments(input);
  assert.deepEqual(core, copy); assert.ok(plan.notes.length >= 6);
  assert.equal(plan.coreDurations.length, core.length);
  assert.ok(plan.coreDurations.every((duration, i) => duration > 0 && duration <= core[i].duration));
  for (const ornament of plan.notes) {
    assert.ok(ornament.core === false && ornament.landing === false);
    assert.ok(!core.some(note => note.tick === ornament.tick));
    assert.ok(ornament.tick >= 0 && ornament.tick + ornament.duration <= input.endTick);
    assert.ok(Number.isSafeInteger(ornament.tick) && Number.isSafeInteger(ornament.duration) && Number.isFinite(ornament.cents));
    assert.ok(ornament.accent < .85);
  }
  assert.deepEqual(planOrnaments({ ...input, amount: 0 }), { notes: [], coreDurations: core.map(note => note.duration), kinds: [] });
});

test('context-sensitive vocabulary includes all twelve physical figures, with explicit opt-in pitch ramps', () => {
  const available = new Set<string>(), slides: ReturnType<typeof planOrnaments>['notes'] = [];
  const subjects = [0, 200, 0, 500, 200, 700, 0].map((cents, i, list) => ({ tick: i * 960,
    duration: 960, cents, accent: .9, landing: i === list.length - 1, role: 'continuation' as const }));
  for (let index = 0; index < 200; index++) {
    const plan = planOrnaments({ ...input, core: subjects, endTick: 6720, occurrenceId: `vocabulary:${index}`, allowGlides: true,
      plan: { scope: 'vocabulary', ordinal: index, vocabulary: ORNAMENT_KINDS, maxRegret: .6 } });
    for (const kind of plan.kinds) available.add(kind);
    slides.push(...plan.notes.filter(note => note.endCents !== undefined));
  }
  assert.deepEqual([...available].sort(), [...ORNAMENT_KINDS].sort());
  assert.ok(slides.length > 0);
  assert.ok(slides.every(note => note.endCents !== note.cents && note.glideTicks === note.duration && note.articulation === 'connected'));
  assert.ok(planOrnaments({ ...input, core: subjects, endTick: 6720 }).notes.every(note => note.endCents === undefined));
});

test('all native fields preserve degree locations, including sub-semitone enclosure neighbors', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const divisions = TUNINGS[tuning].divisions, fieldCents = lyricalField(tuning, 3).map(degree => degree * 1200 / divisions);
    const nativeCore = [0, 2, 1, 4, 3, 0].map((degree, index) => ({ ...core[index], cents: fieldCents[degree], duration: 960 }));
    let subSemitone = false, count = 0;
    for (let index = 0; index < 40; index++) {
      const plan = planOrnaments({ ...input, core: nativeCore, occurrenceId: `native:${index}`,
        parameters: { ...DEFAULT_PARAMETERS, chromaticism: .9 }, native: { fieldCents, chromaticStepCents: 1200 / divisions }, allowGlides: true,
        plan: { scope: `native:${tuning}`, ordinal: index, vocabulary: ORNAMENT_KINDS, maxRegret: .6 } });
      for (const note of plan.notes) {
        count++;
        for (const cents of [note.cents, ...(note.endCents === undefined ? [] : [note.endCents])]) {
          const degree = cents * divisions / 1200;
          assert.ok(Math.abs(degree - Math.round(degree)) < 1e-7, `${tuning} off-grid ornament at ${cents}`);
          if (Math.abs(cents / 100 - Math.round(cents / 100)) > 1e-5) subSemitone = true;
        }
      }
    }
    assert.ok(count > 30);
    if (tuning !== '12tet') assert.ok(subSemitone, `${tuning} must not collapse to a semitone vocabulary.`);
  }
});

test('native ornament feasibility accepts the actual millicent precision of written source notes', () => {
  for (const tuning of ['19edo', '31edo'] as const) {
    const divisions = TUNINGS[tuning].divisions;
    const fieldCents = lyricalField(tuning, 4).map(degree => degree * 1200 / divisions);
    const written = [1, 2].map((degree, index) => ({ ...core[index], tick: index * 960, duration: 960,
      cents: Math.round(fieldCents[degree] * 1000) / 1000, role: 'continuation' as const, landing: index === 1 }));
    const plan = planOrnaments({ ...input, core: written, endTick: 1920, allowGlides: true,
      native: { fieldCents, chromaticStepCents: 1200 / divisions },
      plan: { scope: 'rounded-native-slide', ordinal: 0, vocabulary: ['connected-slide'], maxRegret: 1 } });
    assert.deepEqual(plan.kinds, ['connected-slide']);
    assert.equal(plan.notes[0].cents, written[0].cents);
    assert.equal(plan.notes[0].endCents, written[1].cents);
  }
});

test('protected structural gates and written breaths survive decoration', () => {
  const subjects = core.map((note, index) => ({ ...note, role: (['head', 'continuation', 'apex', 'approach', 'cadence', 'cadence'] as const)[index],
    duration: index === 1 ? 300 : note.duration }));
  const before = structuredClone(subjects);
  for (let index = 0; index < 30; index++) {
    const plan = planOrnaments({ ...input, core: subjects, occurrenceId: `protected:${index}`, allowGlides: true });
    for (const protectedIndex of [0, 2, 4, 5]) assert.equal(plan.coreDurations[protectedIndex], subjects[protectedIndex].duration);
    for (const note of plan.notes) {
      const sourceIndex = Number(note.sourceId.split(':').at(-2)), source = subjects[sourceIndex];
      assert.ok(note.tick > source.tick && note.tick + note.duration <= source.tick + source.duration);
      assert.ok(note.tick + note.duration <= subjects[sourceIndex + 1].tick);
      assert.ok(!subjects.some(anchor => anchor.tick === note.tick));
    }
  }
  assert.deepEqual(subjects, before);
  assert.throws(() => planOrnaments({ ...input, native: { fieldCents: [], chromaticStepCents: 100 } }), RangeError);
});

test('the vocabulary contains audible multi-note gestures with different approach contours', () => {
  const examples = new Map<string, ReturnType<typeof planOrnaments>>();
  for (let index = 0; index < 80; index++) {
    const plan = planOrnaments({ ...input, occurrenceId: `phrase:${index}`,
      plan: { scope: 'figures', ordinal: index, vocabulary: ORNAMENT_KINDS, maxRegret: .6 } });
    for (const kind of plan.kinds) if (!examples.has(kind)) examples.set(kind, plan);
  }
  for (const kind of ['upper-mordent', 'lower-mordent', 'turn', 'enclosure', 'passing-chain', 'accented-repetition']) {
    const plan = examples.get(kind); assert.ok(plan, `Missing ${kind}`);
    const notes = plan.notes.filter(note => note.sourceId.includes(`:${kind}:`));
    assert.ok(notes.length >= 2, `${kind} is a figure, not a renamed isolated neighbor.`);
    if (kind === 'accented-repetition') {
      assert.ok(notes.some((note, index) => index && note.cents === notes[index - 1].cents));
      assert.ok(notes.every(note => note.duration < 60));
      assert.ok(new Set(notes.map(note => note.accent)).size >= 2);
    }
  }
  const turn = examples.get('turn')!.notes.filter(note => note.sourceId.includes(':turn:')).slice(0, 3);
  assert.ok(turn[0].cents > turn[1].cents && turn[1].cents > turn[2].cents);
});

test('complete figure feasibility precedes selection and leaves protected time untouched when no alternative fits', () => {
  const subject = [0, 200].map((cents, index) => ({ tick: index * 300, duration: 300, cents, accent: .9,
    landing: index === 1, role: 'continuation' as const }));
  const constrained = { ...input, core: subject, endTick: 600, noteBudget: 2,
    pitchInRange: (cents: number) => cents >= 0 && cents <= 200,
    plan: { scope: 'small-gap', ordinal: 0, vocabulary: ['lower-mordent', 'neighbor-return'], maxRegret: 1 } };
  const plan = planOrnaments(constrained);
  assert.ok(plan.notes.length > 0 && plan.notes.length <= 2, 'A feasible shorter figure survives an unavailable planned tool.');
  assert.ok(plan.notes.every(note => note.cents >= 0 && note.cents <= 200 && note.tick + note.duration <= 300));
  assert.ok(plan.kinds.every(kind => kind !== 'lower-mordent' && kind !== 'neighbor-return'));
  assert.deepEqual(plan.decisions![0].coverage!.deferred, ['lower-mordent', 'neighbor-return']);
  assert.equal(plan.decisions![0].coverage!.fulfilled, false);
  for (const change of [{ noteBudget: 0 }, { pitchInRange: () => false }]) {
    const silent = planOrnaments({ ...constrained, ...change });
    assert.deepEqual(silent.notes, []);
    assert.deepEqual(silent.coreDurations, [300, 300]);
  }
  assert.throws(() => planOrnaments({ ...constrained, noteBudget: -1 }), RangeError);
});

test('long-form ornament opportunities obey the evaluated regret budget and do not depend on query order', () => {
  const subject = [400, 200].map((cents, index) => ({ tick: index * 960, duration: 960, cents, accent: .9,
    landing: index === 1, role: 'continuation' as const }));
  const base = { ...input, core: subject, endTick: 1920, allowGlides: true };
  const total = (costs: Readonly<Record<string, number>>) => Object.values(costs).reduce((sum, value) => sum + value, 0);
  const best = total(planOrnaments(base).decisions![0].costs);
  const render = (ordinal: number) => planOrnaments({ ...base,
    plan: { scope: 'bounded-expression', ordinal, vocabulary: ORNAMENT_KINDS, maxRegret: .05 } });
  const forward = Array.from({ length: 36 }, (_, ordinal) => render(ordinal));
  for (let ordinal = forward.length - 1; ordinal >= 0; ordinal--) {
    assert.deepEqual(render(ordinal), forward[ordinal]);
    const decision = forward[ordinal].decisions![0];
    assert.ok(total(decision.costs) <= best + .05 + 1e-12);
    assert.ok(decision.candidatesEvaluated > 1);
    assert.deepEqual(decision.coverage!.used, forward[ordinal].kinds);
  }
  assert.ok(forward.some(plan => !plan.decisions![0].coverage!.fulfilled), 'Costly opportunities are honestly deferred.');
});

test('energy changes physical subdivision and ornament quantity, without consuming another random domain', () => {
  const quiet = planOrnaments({ ...input, energy: .1 }), intense = planOrnaments(input);
  assert.ok(intense.notes.length > quiet.notes.length);
  assert.ok(intense.notes.some((note, index, notes) => index && note.tick - notes[index - 1].tick === 60));
  assert.ok(!quiet.notes.some((note, index, notes) => index && note.tick - notes[index - 1].tick === 60));
  assert.deepEqual(planOrnaments(input), intense);
  assert.notDeepEqual(planOrnaments({ ...input, occurrenceId: 'other-occurrence' }), intense);
  const tight = core.map((note, index) => ({ ...note, tick: index * 90, duration: 80 }));
  assert.deepEqual(planOrnaments({ ...input, core: tight }).notes, [], 'Do not crowd a core line already faster than the available decoration grid.');
});
