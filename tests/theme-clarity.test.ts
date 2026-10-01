import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';
import { TUNINGS, type TuningId } from '../src/pitch';
import { PPQ } from '../src/types';
import { transformGesture } from '../src/engine/idea-tools';
import { realizeThemeDelivery } from '../src/engine/theme-realization';
import type { LyricalNote, LyricalSentence } from '../src/engine/lyrical';

const seeds = ['glass-garden', 'velvet-orbit', 'amber-current', 'scoped-argument', 'independent-answer', 'clarity-5'];
const densities = [0, .5, 1];
const spans = [PPQ * 8, PPQ * 16, PPQ * 32];
const intervals = (degrees: readonly number[]) => degrees.slice(1).map((degree, index) => degree - degrees[index]);
const reversals = (degrees: readonly number[]) => {
  const motion = intervals(degrees).map(Math.sign).filter(Boolean);
  return motion.slice(1).filter((direction, index) => direction !== motion[index]).length;
};
const realize = (seed: string, density: number, duration: number, tuning: TuningId = '12tet') => {
  const core = composeThemeCore(seed, 'theme-a', 4);
  const line = realizeThemeCore(core, { startTick: 0, endTick: duration, tuning, occurrence: 0,
    cadence: 'closed', treatment: 'reharmonize', argument: { seed, ideaDensity: density, activity: .5, register: .5 } });
  return { core, line };
};

test('a default thematic source is a compact family of related gestures rather than a mandatory long argument', () => {
  for (const seed of seeds) {
    const core = composeThemeCore(seed, 'theme-a', 4);
    const head = core.clauses.find(clause => clause.sourceId === core.headId)!;
    assert.ok(head.notes.length >= 2 && head.notes.length <= 5, `${seed}: ${head.notes.length} identifying notes`);
    assert.ok(reversals(head.notes.map(note => note.degree)) <= 1,
      `${seed}: the default identifying gesture needs a clear direction or one turn`);
    assert.ok(core.clauses.length >= 4 && core.clauses.length <= 5, `${seed}: ${core.clauses.length} available clauses`);
    assert.ok(core.clauses.filter(clause => clause !== head).every(clause => clause.parentId === core.headId),
      `${seed}: continuations need explicit ancestry in the identifying gesture`);
    assert.equal(new Set(core.clauses.map(clause => clause.sourceId)).size, core.clauses.length);
  }
});

test('the first source reply repeats a recognizable interval and rhythm identity at its new destination', () => {
  for (const seed of seeds) {
    const core = composeThemeCore(seed, 'theme-a', 4);
    const [head, reply] = core.clauses;
    assert.deepEqual(intervals(reply.notes.map(note => note.degree)), intervals(head.notes.map(note => note.degree)),
      `${seed}: the first reply must develop an audible subject, not only claim its parent ID`);
    const relativeRhythm = (notes: typeof head.notes) => {
      const duration = notes.reduce((sum, note) => sum + note.rhythmUnits, 0);
      return notes.map(note => note.rhythmUnits / duration);
    };
    assert.deepEqual(relativeRhythm(reply.notes), relativeRhythm(head.notes));
    assert.equal(reply.notes.at(-1)!.degree, reply.goalDegree);
  }
});

test('sparse and dense delivery both establish the complete identifying head within four quarter pulses', () => {
  for (const seed of seeds) for (const density of densities) for (const span of spans) {
    const { core, line } = realize(seed, density, span);
    const head = line.segments.find(segment => segment.sourceId === core.headId)!;
    const source = core.clauses.find(clause => clause.sourceId === core.headId)!;
    assert.ok(head.endTick - head.startTick <= 4 * PPQ,
      `${seed} density ${density}, ${span / PPQ} pulses: the head occupies ${(head.endTick - head.startTick) / PPQ} pulses`);
    assert.deepEqual(head.notes.map(note => note.sourceId), source.notes.map(note => note.id));
    assert.deepEqual(intervals(head.notes.map(note => note.degree)), intervals(source.notes.map(note => note.degree)));
    assert.ok(head.notes.every(note => note.duration > 0 && note.tick >= head.startTick && note.tick < head.endTick && note.tick + note.duration <= span),
      'A shorter head retains every identifying event, including a bounded legato tail.');
  }
});

test('structural destinations carry one clear direction or one turn before the separate terminal cadence', () => {
  for (const seed of seeds) {
    const core = composeThemeCore(seed, 'theme-a', 4);
    const targets = core.clauses.slice(0, -1).map(clause => clause.goalDegree ?? clause.notes.at(-1)!.degree);
    assert.ok(reversals(targets) <= 1, `${seed}: source destinations zigzag through ${targets.join(', ')}`);
    for (const density of densities) {
      const { line } = realize(seed, density, PPQ * 16);
      const actual = line.segments.slice(0, -1).map(segment => segment.notes.at(-1)!.degree);
      assert.ok(reversals(actual) <= 1, `${seed} density ${density}: performed destinations zigzag through ${actual.join(', ')}`);
      assert.equal(line.notes.at(-1)!.degree, 0, 'The terminal cadence retains its own closing obligation.');
    }
  }
});

test('compact statements retain their source fingerprint and finite native events through later development', () => {
  for (const seed of seeds) for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const { core, line } = realize(seed, .5, PPQ * 16, tuning);
    const later = realizeThemeCore(core, { startTick: 0, endTick: PPQ * 16, tuning, occurrence: 3,
      cadence: 'closed', treatment: 'develop', development: { literal: false, amount: .2, familiarity: 1, selection: .5 },
      argument: { seed, ideaDensity: .5, activity: .5, register: .5, familiarity: 1 } });
    const fingerprint = (phrase: typeof line) => phrase.segments[0].notes.map(note => [note.sourceId, note.degree, note.tick, note.duration]);
    assert.deepEqual(fingerprint(later), fingerprint(line), 'A developed reply preserves the heard opening identity.');
    for (const phrase of [line, later]) for (const note of phrase.notes) {
      assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0);
      assert.ok(note.tick >= 0 && note.tick + note.duration <= PPQ * 16);
      const native = note.cents * TUNINGS[tuning].divisions / 1200;
      assert.ok(Math.abs(native - Math.round(native)) < .00003, 'Development stays in the selected native pitch space.');
    }
  }
});

test('a familiar first reply audibly recalls the head whenever its whole transposition is feasible', () => {
  let feasible = 0;
  for (const seed of seeds) for (const density of densities) for (const span of spans) {
    const core = composeThemeCore(seed, 'theme-a', 4), head = core.clauses[0].notes;
    const line = realizeThemeCore(core, { startTick: 0, endTick: span, tuning: '12tet', occurrence: 0,
      cadence: 'closed', treatment: 'reharmonize', argument: { seed, ideaDensity: density, activity: .5, register: .5, familiarity: 1 } });
    const reply = line.segments.find(segment => segment.sourceId === core.clauses[1].sourceId);
    if (!reply) continue;
    const firstReply = line.realization!.phrases!.find(group => group.startTick === reply.startTick)!;
    const heard = line.notes.filter(note => note.tick >= firstReply.startTick && note.tick < firstReply.endTick);
    const shift = heard.at(-1)!.degree - head.at(-1)!.degree;
    const quoted = head.map(note => note.degree + shift);
    if (quoted.some(degree => degree < -7 || degree > 12)
      || Math.abs(quoted[0] - head.at(-1)!.degree) > 7) continue;
    feasible++;
    assert.equal(firstReply.sourceId, core.headId);
    assert.deepEqual(intervals(heard.map(note => note.degree)), intervals(head.map(note => note.degree)),
      `${seed} density ${density}: a feasible familiar reply must be recognizable in the actual notes`);
  }
  assert.ok(feasible >= seeds.length * 2, 'Singing and dense settings must retain meaningful access to quotation.');
});

test('sparse thoughts select a smaller active palette while retaining their head and destination', () => {
  for (const seed of seeds) for (const span of spans) {
    const { core, line: sparse } = realize(seed, 0, span);
    const singing = realize(seed, .5, span).line, dense = realize(seed, 1, span).line;
    const sourceIds = (line: typeof sparse) => line.segments.map(segment => segment.sourceId);
    assert.deepEqual(sourceIds(sparse), [core.headId, core.clauses.at(-1)!.sourceId]);
    assert.deepEqual(sourceIds(singing), [core.headId, core.clauses[1].sourceId, core.clauses.at(-1)!.sourceId]);
    assert.ok(sparse.segments.length < singing.segments.length && singing.segments.length < dense.segments.length,
      'Available vocabulary need not all be voiced in every thought.');
    for (const line of [sparse, singing, dense]) {
      assert.equal(line.notes.at(-1)!.degree, 0);
      assert.ok(line.notes.every(note => note.tick >= 0 && note.tick + note.duration <= span));
    }
  }
});

test('subdivision adds repeated pitches only when an explicit pedal idea owns them', () => {
  let refinements = 0;
  for (const seed of seeds) for (const density of densities) for (const span of spans) {
    const { core, line } = realize(seed, density, span);
    for (const group of line.realization!.phrases!) {
      if (!group.anchors) continue;
      const source = core.clauses.find(clause => clause.sourceId === group.sourceId)!;
      const pedal = group.operations!.some(operation => operation.kind === 'pedal')
        || source.operations?.some(operation => operation.kind === 'pedal')
          && group.anchors.every(anchor => anchor.degree === group.anchors![0].degree);
      const anchors = new Set(group.anchors.map(anchor => anchor.tick));
      const heard = line.notes.filter(note => note.tick >= group.startTick && note.tick < group.endTick);
      for (const [index, note] of heard.entries()) {
        if (!index || anchors.has(note.tick)) continue;
        refinements++;
        assert.ok(pedal || note.degree !== heard[index - 1].degree,
          `${seed}: an inserted attack at ${note.tick} needs motion or a declared repetition idea`);
      }
    }
  }
  assert.ok(refinements > seeds.length, 'Coalescing unsupported repetitions still permits real melodic refinement.');
});

test('gesture diagnostics describe the actual source, operation result, evaluation and heard refinement', () => {
  let negotiated = 0;
  for (const seed of seeds) for (const density of densities) {
    const { core, line } = realize(seed, density, PPQ * 16);
    const groups = line.realization!.phrases!;
    for (const group of groups) {
      const source = core.clauses.find(clause => clause.sourceId === group.sourceId);
      assert.ok(source, `${group.id}: declared source must resolve in the source graph`);
      assert.ok(group.operations && group.costs, `${group.id}: declared operations and evaluation must be explicit`);
      assert.ok(Number.isSafeInteger(group.candidatesEvaluated) && group.candidatesEvaluated! >= 1);
      assert.ok(Object.values(group.costs).every(cost => Number.isFinite(cost) && cost >= 0));
      if (group.candidatesEvaluated! > 1) negotiated++;
      const heard = line.notes.filter(note => note.tick >= group.startTick && note.tick < group.endTick);
      assert.equal(group.coreNotes, heard.length, 'The group count describes heard notes, including held destinations.');
      assert.equal(group.transpositionDegrees, heard[0].degree - source.notes[0].degree,
        `${group.id}: transposition is measured from its declared source`);
      const replay = transformGesture({ sourceId: source.sourceId, operations: [],
        notes: source.notes.map(note => ({ degree: note.degree, units: note.rhythmUnits, strength: .8 })) }, group.operations);
      const anchors = group.anchors ?? heard.map(note => ({ tick: note.tick, degree: note.degree }));
      assert.deepEqual(replay.notes.map(note => note.degree), anchors.map(note => note.degree),
        `${group.id}: operations must explain the heard skeleton, not merely label it`);
      for (const anchor of anchors) assert.equal(heard.find(note => note.tick === anchor.tick)?.degree, anchor.degree,
        `${group.id}: every declared anchor must actually sound`);
      if (group.anchors) {
        assert.deepEqual(group.anchors.map(note => note.units), replay.notes.map(note => note.units),
          'The chosen rhythmic transformation survives into the realized skeleton.');
        assert.equal(group.refinement, 'directed-metric');
      }
      for (const [index, left] of anchors.slice(0, -1).entries()) {
        const right = anchors[index + 1];
        const link = heard.filter(note => note.tick >= left.tick && note.tick <= right.tick);
        assert.ok(link.every((note, n) => note.degree >= Math.min(left.degree, right.degree)
          && note.degree <= Math.max(left.degree, right.degree)
          && (!n || Math.abs(right.degree - note.degree) <= Math.abs(right.degree - link[n - 1].degree))),
        `${group.id}: refinement travels toward the next written anchor without inventing contour loops`);
      }
    }
  }
  assert.ok(negotiated >= seeds.length, 'Continuation groups actually compare feasible interpretations.');
});

test('dense delivery elaborates one gesture per clause without multiplying its contour cycles', () => {
  for (const seed of seeds) for (const span of spans) {
    const { core, line } = realize(seed, 1, span);
    const gestures = line.realization!.phrases!;
    assert.equal(gestures.length, core.clauses.length, 'Higher density must not automatically replay the subject to fill time.');
    const skeleton = gestures.flatMap(group => group.anchors?.map(note => note.degree)
      ?? line.notes.filter(note => note.tick >= group.startTick && note.tick < group.endTick).map(note => note.degree));
    assert.equal(reversals(line.notes.map(note => note.degree)), reversals(skeleton),
      `${seed}: extra attacks cannot add back-and-forth cycles absent from the selected ideas`);
    assert.ok(reversals(skeleton) <= core.clauses.length * 2,
      `${seed}: the default compact idea needs a bounded number of contrasting turns`);
    assert.ok(gestures[1].coreNotes <= 5, 'The first reply is one complete recognizable gesture, even in a dense performance.');
  }
});

test('short connected links can use finer metric ornaments while the head and cadence retain their notes', () => {
  const source: LyricalNote[] = ['head', 'continuation', 'continuation', 'apex', 'cadence'].map((role, index) => ({
    tick: index * PPQ, duration: PPQ, cents: index * 200, degree: index, accent: .8,
    landing: role === 'cadence', protectedTheme: true, function: 'development', sourceId: `compact:${index}`,
    coreRole: role as LyricalNote['coreRole'],
  }));
  const sentence: LyricalSentence = { notes: source, headId: 'compact', highPointTick: PPQ * 3, rests: [],
    segments: [{ startTick: 0, endTick: PPQ * 5, label: 'A short connected thought', role: 'answer', sourceId: 'compact', notes: source }] };
  let total = 0;
  for (const seed of seeds) for (const subdivisionTicks of [PPQ / 2, PPQ / 2 - 1]) {
    const delivery = realizeThemeDelivery(sentence, { seed, occurrence: 0, tuning: '12tet', third: 4, embellishment: 1,
      textureAt: () => ({ pace: .4, syncopation: .2, subdivisionTicks, gateRatio: 1.1,
        attackSoftness: .6, rhythmDrive: .4, velocityCeiling: .8, articulation: 'connected' }) });
    const ornaments = delivery.segments.flatMap(segment => segment.notes).filter(note => !note.core);
    total += ornaments.length;
    for (const note of ornaments) {
      assert.ok(note.tick >= PPQ && note.tick + note.duration <= PPQ * 3);
      assert.equal(note.tick % (PPQ / 4), 0, 'The ornament uses a descendant subdivision of the surrounding pulse.');
    }
    for (const index of [0, 3, 4]) assert.deepEqual(delivery.anchors[index], { ...source[index], core: true });
  }
  assert.ok(total > 0, 'The compact links must admit actual ornaments, without requiring them in every statement.');
  assert.ok(source.every(note => note.duration === PPQ), 'Delivery must preserve the reusable source.');
});
