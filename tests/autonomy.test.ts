import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDUCTOR, rhythmicHomeFor, themeIds } from '../src/conductor';
import { MusicEngine, eventHash } from '../src/engine';
import { validVoices } from '../src/engine/analysis';
import { validEdo19Voices } from '../src/engine/edo19';
import { pitchToDegree, pitchToMidi } from '../src/pitch';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import { DEFAULT_SOUND } from '../src/spectrum';
import type { Frame } from '../src/types';

function cycle(seed: string, additive = false, ensembleSize = DEFAULT_PARAMETERS.ensembleSize, dynamicRange?: number, journeys = 1): Frame[] {
  const engine = new MusicEngine({ seed, parameters: { ...DEFAULT_PARAMETERS, ensembleSize }, conductor: DEFAULT_CONDUCTOR,
    phrasing: dynamicRange === undefined ? undefined : { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION, dynamicRange } },
    sound: { ...DEFAULT_SOUND, instrument: additive ? 'additive' : 'ensemble' } });
  const frames: Frame[] = [];
  while (frames.length < 640) {
    const frame = engine.step();
    if (frame.form!.cycle >= journeys) break;
    frames.push(frame);
  }
  assert.ok(frames.length < 640, 'The fixture must cover complete bounded journeys rather than truncate a developing form.');
  return frames;
}

test('autonomous form replay is exact across two developing journeys around a steady pulse', () => {
  const a = cycle('velvet-orbit', false, DEFAULT_PARAMETERS.ensembleSize, undefined, 2), b = cycle('velvet-orbit', false, DEFAULT_PARAMETERS.ensembleSize, undefined, 2);
  assert.deepEqual(a, b);
  const roles = new Set(a.map(frame => frame.form!.role));
  for (const role of ['theme', 'development', 'climax', 'return']) assert.ok(roles.has(role as never));
  assert.ok(roles.size >= 6, 'A broader formal argument is allowed to defer its crest until a later journey.');
  assert.equal(new Set(a.map(frame => frame.form!.grooveId)).size, 3);
  for (const frame of a) {
    const form = frame.form!, source = themeIds('velvet-orbit').map(themeId => rhythmicHomeFor('velvet-orbit', themeId))
      .find(home => home.cell.id === form.meterSourceId)!;
    assert.ok(source);
    assert.deepEqual(form.meter, source.meter);
    assert.deepEqual(form.meterGroups, source.groups);
  }
  assert.ok(a.some((frame, index) => index > 0 && frame.form!.sectionIndex !== a[index - 1].form!.sectionIndex
    && frame.form!.meterResidenceStartTick === a[index - 1].form!.meterResidenceStartTick), 'Different sections share an inhabited pulse.');
  assert.ok(new Set(a.map(frame => frame.form!.instrument)).size >= 4);
  assert.ok(a.every(frame => frame.parameters.tempo === DEFAULT_PARAMETERS.tempo));
  assert.ok(a.every(frame => frame.phrase?.themeCore && frame.diagnostics.harmonicPlan));
  assert.ok(a.every(frame => frame.diagnostics.harmonicPlan!.realization.matched));
  assert.ok(a.some(frame => frame.phrase!.themeCore!.occurrence > 0), 'Themes actually return as authored occurrences.');
  const manual = new MusicEngine({ seed: 'velvet-orbit', parameters: DEFAULT_PARAMETERS });
  assert.notEqual(eventHash(a.flatMap(frame => frame.notes)), eventHash(Array.from({ length: a.length }, () => manual.step()).flatMap(frame => frame.notes)));
});

test('harmonic destinations stay legible while the whole ensemble develops from calm to crest', () => {
  // Exercise the full expressive range with a stable full orchestra. Default
  // breadth can spend just a few frames at its highest pace while a longer
  // preparation remains in the middle; that is not a failure to reach a crest.
  const frames = cycle('glass-garden', false, 1, 1);
  const mean = (group: Frame[]) => group.reduce((sum, frame) => sum + frame.diagnostics.dissonance, 0) / group.length;
  const home = frames.filter(frame => frame.sound.tuning === '12tet' && ['theme', 'return'].includes(frame.form!.role));
  const calm = frames.filter(frame => frame.diagnostics.compositionExpression!.pace < .3);
  const climax = frames.filter(frame => frame.diagnostics.compositionExpression!.pace > .72);
  assert.ok(mean(home) < .4, 'Functional triads and sevenths remain clearer than a sustained cluster texture.');
  assert.ok(calm.length > 5 && climax.length > 5);
  const attacks = (group: Frame[]) => group.reduce((sum, frame) => sum + frame.notes.filter(note => note.part !== 'melody').length, 0) / group.length;
  assert.ok(attacks(climax) > attacks(calm) * 1.5, 'The backing develops along with the tune.');
  assert.ok(frames.every(frame => frame.diagnostics.harmonicPlan?.realization.matched));
  assert.ok(frames.filter(frame => frame.form!.role === 'theme').flatMap(frame => frame.notes).filter(note => note.part === 'melody').length >= 16);
});

test('tuning excursions preserve state and emit genuine absolute-pitch glides into valid native destinations', () => {
  for (const seed of ['velvet-orbit', 'glass-garden', 'amber-river']) {
    const frames = cycle(seed, false, 1);
    const changes = frames.filter((frame, i) => i > 0 && frame.sound.tuning !== frames[i - 1].sound.tuning);
    assert.equal(changes.length, 2);
    for (const frame of frames) {
      assert.equal(frame.sound.tuning, frame.form!.tuning);
      assert.equal(frame.tick, frame.index * 960);
      const upper = frame.voicePitches.map(pitch => frame.sound.tuning === '19edo' ? pitchToDegree('19edo', pitch) : pitchToMidi(pitch));
      assert.ok(frame.sound.tuning === '19edo' ? validEdo19Voices(upper) : validVoices(upper));
      assert.ok(frame.notes.every(note => Number.isInteger(note.tick) && Number.isInteger(note.duration) && note.duration > 0 && note.tick >= frame.tick && note.tick < frame.tick + frame.duration));
      assert.ok(frame.motifs.every(motif => motif.intervalUnit === `${frame.sound.tuning === '19edo' ? '19edo' : '12tet'}-degrees`));
    }
    for (const frame of changes) {
      const prior = frames[frame.index - 1];
      const glides = frame.notes.filter(note => note.endPitch && note.voice <= 4);
      assert.ok(glides.length > 0 && glides.length <= 5, 'The current arrangement realizes its admitted reference voices.');
      assert.ok(glides.some(note => note.absolutePitch!.millicents !== note.endPitch!.millicents));
      for (const note of glides) {
        assert.deepEqual(note.absolutePitch, note.part === 'bass' ? prior.bassPitch : prior.voicePitches[note.voice]);
        assert.deepEqual(note.endPitch, note.part === 'bass' ? frame.bassPitch : frame.voicePitches[note.voice]);
        assert.ok(note.glideTicks! > 0 && note.glideTicks! <= note.duration);
      }
    }
  }
});

test('manual lanes override conducted macros and knowledge revisions still reproduce live edits', () => {
  const config = { seed: 'conducted-edit', parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR };
  const live = new MusicEngine(config);
  const edit = [{ parameter: 'tension' as const, points: [{ tick: 4800, value: 0.42 }] }];
  const replay = new MusicEngine({ ...config, automation: edit, automationRevisions: [{ tick: 0, lanes: [] }, { tick: 4800, lanes: edit }] });
  for (let i = 0; i < 40; i++) {
    if (i === 5) live.setAutomation(edit);
    const actual = live.step(), expected = replay.step();
    assert.deepEqual(actual, expected);
    if (i >= 5) assert.equal(actual.parameters.tension, 0.42);
  }
});

test('explicit tempo automation remains authoritative over the conductor steady pulse', () => {
  const seed = 'intentional-tempo-edit';
  const engine = new MusicEngine({
    seed, parameters: { ...DEFAULT_PARAMETERS, tempo: 96 }, conductor: { ...DEFAULT_CONDUCTOR, pace: 1 },
    automation: [{ parameter: 'tempo', points: [{ tick: 7680, value: 96, curve: 'linear' }, { tick: 11520, value: 108, curve: 'step' }, { tick: 23040, value: 84 }] }],
  });
  for (let index = 0; index < 40; index++) {
    const frame = engine.step();
    const expected = frame.tick < 7680 ? 96 : frame.tick < 11520 ? 96 + (frame.tick - 7680) / 3840 * 12 : frame.tick < 23040 ? 108 : 84;
    assert.equal(frame.parameters.tempo, expected);
  }
});

test('autonomous additive playback keeps sounding five-tone reference coverage between structural destinations', () => {
  const frames = cycle('velvet-orbit', true);
  const held = new Map<number, Frame['notes'][number]>();
  for (const frame of frames) {
    for (const note of frame.notes) if (note.part === 'harmony' || note.part === 'bass') held.set(note.voice, note);
    const rests = frame.phrase!.rests.filter(rest => rest.scope !== 'lead');
    const at = frame.tick + frame.duration / 2;
    if (rests.some(rest => rest.startTick <= at && rest.endTick > at)) continue;
    for (let voice = 0; voice < 5; voice++) {
      const note = held.get(voice);
      assert.ok(note && note.tick <= at && note.tick + note.duration > at, `Reference voice ${voice} missing at ${at}`);
      assert.deepEqual(note.endPitch ?? note.absolutePitch, voice === 4 ? frame.bassPitch : frame.voicePitches[voice]);
      assert.equal(note.gainEnvelope, undefined, 'The additive reference never acquires a varying pitched amplitude envelope.');
    }
  }
});
