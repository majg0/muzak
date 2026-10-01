import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, themeIds } from '../src/conductor';
import { MusicEngine, eventHash } from '../src/engine';
import { composeThemeCore, realizeThemeCore } from '../src/engine/theme-core';
import { seedIdea } from '../src/engine/phrase';
import { transformGesture } from '../src/engine/idea-tools';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { degreeToPitch, pitchToDegree } from '../src/pitch';

// Vocabulary measures the actual subjects and their meaningful relationships,
// rather than rewarding a catalogue for having many unused source IDs.
test('seeded source graphs provide distinct related subjects and complete thematic arguments', () => {
  const argumentsSeen = new Set<string>(), subjects = new Set<string>(), wholeTunes = new Set<string>();
  for (let index = 0; index < 100; index++) for (const family of themeIds(`thematic-vocabulary-${index}`)) {
    const seed = `thematic-vocabulary-${index}`, remembered = seedIdea(seed, family);
    const core = composeThemeCore(seed, family, remembered.third);
    const sentence = realizeThemeCore(core, { startTick: 0, endTick: 15360, tuning: '12tet', occurrence: 0,
      cadence: 'closed', treatment: 'reharmonize' });
    const heads = core.clauses.filter(clause => clause.sourceId === core.headId);
    assert.equal(heads.length, 1);
    assert.deepEqual(core.fingerprint!.rhythmUnits, heads[0].notes.map(note => note.rhythmUnits));
    assert.ok(heads[0].notes.length >= 3 && heads[0].notes.length <= 4);
    assert.deepEqual(remembered.cents, sentence.notes.map(note => note.cents), 'Remembered sources and performed grammar are one system.');
    assert.ok(sentence.notes.filter(note => note.coreRole === 'apex').length <= 1);
    assert.equal(sentence.notes.find(note => note.tick === sentence.highPointTick)!.degree, Math.max(...sentence.notes.map(note => note.degree)));
    assert.equal(sentence.notes.at(-1)!.degree, 0);
    assert.ok(sentence.notes.every(note => note.corePurpose && note.sourceId));
    argumentsSeen.add(core.grammar);
    subjects.add(eventHash(heads[0].notes.map(note => [note.degree, note.rhythmUnits])));
    wholeTunes.add(eventHash(sentence.notes.map(note => [note.tick, note.degree])));
  }
  assert.deepEqual(argumentsSeen, new Set(['generated']));
  assert.ok(subjects.size >= 25 && wholeTunes.size >= 80, `${subjects.size} actual subjects and ${wholeTunes.size} complete arguments`);
});

test('emitted phrases reveal their actual core relationships and heard memory remains bounded across narratives', () => {
  for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
    const config = { seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR,
      phrasing: { ...DEFAULT_PHRASING, renewal: 1 } };
    const engine = new MusicEngine(config), frames = Array.from({ length: 320 }, () => engine.step());
    const thoughts = [...new Map(frames.map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
    const complete = thoughts.filter(phrase => phrase.endTick <= engine.tick), notes = frames.flatMap(frame => frame.notes);
    assert.ok(new Set(complete.map(phrase => phrase.themeCore!.id)).size >= 3);
    assert.ok(complete.some(phrase => phrase.composition!.cadence === 'open'));
    assert.ok(complete.some(phrase => phrase.composition!.cadence === 'closed'));
    for (const phrase of complete) {
      const anchors = notes.filter(note => note.id.startsWith('phrase:') && note.expression?.role === 'anchor'
        && note.tick >= phrase.startTick && note.tick < phrase.endTick);
      assert.equal(anchors.length, phrase.themeCore!.notes.length);
      const clauses = phrase.composition!.shortPhrases!;
      assert.equal(clauses.reduce((sum, cell) => sum + cell.coreNotes, 0), anchors.length);
      const heads = clauses.filter(cell => cell.sourceId === phrase.themeCore!.headId);
      assert.ok(heads.length >= 1);
      const source = composeThemeCore(seed, phrase.themeId, seedIdea(seed, phrase.themeId).third);
      const head = source.clauses.find(clause => clause.sourceId === source.headId)!;
      for (const recall of heads) {
        const declared = phrase.themeCore!.realization!.phrases!.find(part => part.startTick === recall.startTick)!;
        const transformed = transformGesture({ sourceId: source.headId, operations: [],
          notes: head.notes.map(note => ({ degree: note.degree, units: note.rhythmUnits, strength: .8 })) }, declared.operations ?? []);
        const written = phrase.themeCore!.notes.filter(note => note.startTick >= recall.startTick && note.startTick < recall.endTick);
        assert.deepEqual((declared.anchors ?? written).map(note => note.degree), transformed.notes.map(note => note.degree),
          'A head quotation follows its declared transformation; it may transpose or change pace without becoming unrelated material.');
        for (const point of declared.anchors ?? []) assert.ok(written.some(note => note.startTick === point.tick && note.degree === point.degree));
        for (const note of written) assert.ok(anchors.some(played => played.tick === note.startTick
          && played.absolutePitch!.millicents === Math.round(note.absolutePitchCents * 1000)), 'The declared head relationship is actually emitted.');
      }
      assert.ok(phrase.composition!.cues.every(cue => anchors.some(note => note.tick === cue.tick)));
    }
    const completed = new Map(complete.map(phrase => [`heard-${phrase.phraseId}`, phrase]));
    let heard = 0;
    for (const frame of frames) for (const motif of frame.motifs.filter(motif => motif.id.startsWith('heard-'))) {
      const origin = completed.get(motif.id);
      assert.ok(origin, 'A remembered derivative belongs to a completed, actually heard thought.');
      assert.equal(motif.intervals.length, Math.min(32, origin.themeCore!.notes.length),
        'Memory retains the complete concise argument up to its declared storage bound.');
      heard++;
    }
    assert.ok(heard > 0);
    assert.ok(frames.every(frame => frame.phrase!.ideas.length <= 18));
    for (const frame of frames) for (const note of frame.notes.filter(note => note.id.startsWith('phrase:'))) {
      assert.ok(Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0);
      assert.deepEqual(note.absolutePitch, degreeToPitch(frame.sound.tuning, pitchToDegree(frame.sound.tuning, note.absolutePitch!)));
    }
    if (seed === 'glass-garden') {
      const replay = new MusicEngine(config);
      for (const frame of frames) assert.deepEqual(replay.step(), frame);
    }
  }
});
