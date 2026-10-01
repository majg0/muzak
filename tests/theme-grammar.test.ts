import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';
import { PhraseLayer } from '../src/engine/phrase';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_HARMONY } from '../src/harmonic-language';
import { DEFAULT_CONDUCTOR, formAt } from '../src/conductor';
import { TUNINGS, degreeToPitch, pitchToDegree, midiToPitch, type TuningId } from '../src/pitch';
import { MusicEngine } from '../src/engine';
import { compositionStudy } from '../src/composition-studies';
import { createPerformance } from '../src/serialization';
import { restAppliesToNote } from '../src/phrasing';

test('source goal paths are generated and their contour labels describe actual motion', () => {
  const shapes = new Set<string>(), contours = new Set<string>(), lengths = new Set<number>();
  let falling = 0;
  for (let index = 0; index < 96; index++) {
    const core = composeThemeCore('general-' + index, 'theme-a', 4), notes = core.clauses.flatMap(clause => clause.notes);
    contours.add(core.contour!); lengths.add(core.clauses.length); shapes.add(notes.map(note => note.degree).join(','));
    const path = [core.clauses[0].notes.at(-1)!.degree, ...core.goals!];
    if (core.contour === 'descending') { falling++; assert.ok(path.every((value, i) => !i || value <= path[i - 1])); }
    assert.equal(core.clauses.filter(clause => clause.sourceId === core.headId).length, 1);
    assert.ok(notes.every((note, i) => !i || Math.abs(note.degree - notes[i - 1].degree) <= 7));
  }
  assert.ok(contours.size >= 4 && shapes.size > 85 && lengths.size >= 2 && falling >= 5,
    'Distinct compact arguments need not manufacture alternating destinations or extra clauses for variety.');
});

test('one compiler refines source motifs into real nested phrases, varied rhythms and prepared endpoints', () => {
  const rhythms = new Set<string>(), paths = new Set<string>(), endings = new Set<number>();
  let heldAndBurst = 0;
  for (let index = 0; index < 96; index++) {
    const seed = 'general-' + index, core = composeThemeCore(seed, 'theme-a', 4);
    const input = { startTick: 0, endTick: 15360, tuning: '12tet' as const, occurrence: 0, cadence: 'open' as const,
      treatment: 'reharmonize' as const, argument: { seed, ideaDensity: 1, activity: .8, register: .5 } };
    const line = realizeThemeCore(core, input);
    assert.deepEqual(line, realizeThemeCore(core, { ...input, occurrence: 9 }));
    const motifs = line.realization!.motifs!, phrases = line.realization!.phrases!;
    paths.add(motifs.map(motif => motif.parentId + ':' + motif.goalDegree).join('|'));
    rhythms.add(line.notes.slice(1).map((note, i) => note.tick - line.notes[i].tick).join(','));
    assert.equal(line.segments.filter(segment => segment.sourceId === core.headId).length, 1);
    assert.equal(phrases.length, motifs.length, 'Each source gesture is authored once; density refines its intervals.');
    assert.ok(phrases.slice(1).every(phrase => phrase.anchors && phrase.anchors.length <= 5));
    for (const phrase of phrases) {
      const motif = motifs.find(motif => motif.id === phrase.motifId)!;
      assert.ok(phrase.startTick >= motif.startTick && phrase.endTick <= motif.endTick);
      assert.equal(line.notes.filter(n => n.tick >= phrase.startTick && n.tick < phrase.endTick).length, phrase.coreNotes);
    }
    const gaps = line.notes.slice(1).map((note, i) => note.tick - line.notes[i].tick);
    if (gaps.some(gap => gap <= 160) && gaps.some(gap => gap >= 480)) heldAndBurst++;
    const final = line.notes.at(-1)!; endings.add(final.degree);
    assert.ok([2, 4].includes(((final.degree % 7) + 7) % 7));
    assert.equal(final.landing, false); assert.equal(final.tick + final.duration, input.endTick);
    assert.ok(!line.rests.some(rest => rest.endTick === input.endTick));
    assert.ok(line.notes.every((note, i) => !i || Math.abs(note.degree - line.notes[i - 1].degree) <= 7));
  }
  assert.ok(paths.size >= 48 && rhythms.size >= 80 && endings.size >= 5 && heldAndBurst >= 48,
    JSON.stringify({ paths: paths.size, rhythms: rhythms.size, endings: endings.size, heldAndBurst }));
});

test('spacious handoffs compose the whole closing approach toward its non-tonic destination', () => {
  for (let index = 0; index < 24; index++) for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const seed = `sparse-handoff-${index}`, core = composeThemeCore(seed, 'theme-a', 4);
    for (const endingDegree of [2, 4]) {
      const line = realizeThemeCore(core, { startTick: 0, endTick: 30720, tuning, occurrence: 0,
        cadence: 'open', treatment: 'reharmonize', argument: { seed, ideaDensity: 0, activity: .2, register: .5, endingDegree } });
      const closing = line.segments.at(-1)!, before = line.segments.at(-2)!.notes.at(-1)!.degree;
      assert.equal(closing.notes.at(-1)!.degree, endingDegree);
      let previous = before;
      for (const note of closing.notes) {
        assert.ok(Math.abs(note.degree - previous) <= 7);
        assert.ok(Math.abs(endingDegree - note.degree) <= Math.abs(endingDegree - previous),
          'The approach cannot visit an unrelated tonic and then jump to its declared open endpoint.');
        assert.ok(note.degree >= Math.min(before, endingDegree) && note.degree <= Math.max(before, endingDegree));
        previous = note.degree;
      }
      assert.equal(line.notes.at(-1)!.tick + line.notes.at(-1)!.duration, 30720);
      assert.ok(!line.rests.some(rest => rest.endTick === 30720));
    }
  }
});

test('all supported native spaces realize the declared contour and formal handoff without implicit semitone rounding', () => {
  for (const tuning of Object.keys(TUNINGS) as TuningId[]) for (const ending of ['open', 'closed'] as const) {
    const seed = 'native-clause-handoff', initial = formAt(seed, 0, DEFAULT_CONDUCTOR, tuning);
    const form = { ...initial, role: 'development' as const, sectionIndex: 0, sectionStartTick: 0, sectionEndTick: 15360,
      phraseStartTick: 0, phraseEndTick: 7680, barStartTick: 0, beat: 1, barTicks: 1920, meter: { numerator: 4, denominator: 4 as const },
      tuning, behavior: { ...initial.behavior!, ending } };
    const layer = new PhraseLayer(seed, { ...DEFAULT_PHRASING, harmony: { ...DEFAULT_HARMONY, treatment: 'reharmonize' },
      composition: { ...DEFAULT_COMPOSITION, embellishment: 0 } }, 0);
    layer.begin(form, { ...DEFAULT_PARAMETERS, ideaDensity: 1 });
    let snapshot = layer.snapshot()!;
    while (snapshot.endTick < form.sectionEndTick) {
      const start = snapshot.endTick;
      assert.equal(snapshot.composition!.cadence, 'open', 'An interior thought does not prematurely close the formal handoff.');
      layer.begin({ ...form, phraseStartTick: start, phraseEndTick: form.sectionEndTick, barStartTick: start, beat: 1 },
        { ...DEFAULT_PARAMETERS, ideaDensity: 1 });
      snapshot = layer.snapshot()!;
      assert.equal(snapshot.startTick, start);
    }
    const notes = layer.notes(snapshot.startTick, snapshot.endTick - snapshot.startTick, tuning,
      [55, 60, 64, 67].map(midiToPitch), midiToPitch(36), false);
    assert.equal(snapshot.composition!.cadence, ending);
    assert.equal(notes.length, snapshot.themeCore!.notes.length);
    assert.ok(notes.every(note => note.absolutePitch!.millicents >= 5200000 && note.absolutePitch!.millicents <= 9600000));
    for (const [index, note] of notes.entries()) {
      assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)));
      assert.equal(note.absolutePitch!.millicents, Math.round(snapshot.themeCore!.notes[index].absolutePitchCents * 1000));
    }
    if (tuning !== '12tet') assert.ok(notes.some(note => note.absolutePitch!.millicents % 100000 !== 0));
    const final = snapshot.themeCore!.notes.at(-1)!;
    assert.ok(ending === 'closed' ? final.degree === 0 : [2, 4].includes(((final.degree % 7) + 7) % 7));
  }
});

test('ordinary developing performances emit native ornamental figures while leaving the structural head untouched', () => {
  const kinds = new Set<string>();
  let total = 0;
  for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) for (const tuning of Object.keys(TUNINGS) as TuningId[]) {
    const recipe = compositionStudy(createPerformance(seed), 'developing-solo');
    recipe.sound.tuning = tuning;
    const engine = new MusicEngine({ ...recipe, parameters: recipe.initialParameters });
    const seen = new Set<number>(); let ornaments = 0;
    for (let index = 0; index < 300; index++) {
      const frame = engine.step(), phrase = frame.phrase!;
      seen.add(phrase.startTick); if (seen.size > 4) break;
      for (const note of frame.notes.filter(note => note.id.startsWith('phrase:'))) {
        assert.deepEqual(note.absolutePitch, degreeToPitch(tuning, pitchToDegree(tuning, note.absolutePitch!)));
        const source = phrase.themeCore!.notes.find(source => source.startTick === note.tick && source.sourceId === note.expression?.sourceId);
        if (note.expression?.role === 'anchor') {
          assert.ok(source); assert.equal(note.absolutePitch!.millicents, Math.round(source.absolutePitchCents * 1000));
          if (['head', 'apex', 'cadence'].includes(source.role)) assert.equal(note.tick + note.duration, source.endTick);
        } else if (note.expression?.role === 'ornament') {
          ornaments++; total++;
          const identity = note.expression.sourceId!; kinds.add(identity.split(':ornament:')[1].split(':')[0]);
          const owner = phrase.themeCore!.notes.find(source => identity.startsWith(`${source.sourceId}:ornament:`));
          assert.ok(owner && !['head', 'apex', 'cadence'].includes(owner.role));
          assert.ok(phrase.rests.every(rest => !restAppliesToNote(note, rest) || note.tick >= rest.endTick || note.tick + note.duration <= rest.startTick));
        }
      }
    }
    assert.ok(ornaments > 0, `${seed}/${tuning}: declared decoration capability must reach the actual performed notes.`);
  }
  assert.ok(total >= 40 && kinds.size >= 4, `${total} emitted native ornaments across ${[...kinds]}`);
});
