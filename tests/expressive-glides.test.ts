import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpressiveGlides, glideGestureFor } from '../src/engine/expressive-glides';
import { MusicEngine } from '../src/engine';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_PHRASING, restAppliesToNote } from '../src/phrasing';
import { DEFAULT_SOUND } from '../src/spectrum';
import { degreeToPitch } from '../src/pitch';
import type { NoteEvent } from '../src/types';

const note = (index: number, role: 'anchor' | 'ornament' | 'support' | 'layer' = 'layer'): NoteEvent => ({
  id: `sweep-${index}`, tick: index * 960, duration: 1000, absolutePitch: degreeToPitch('19edo', index % 5),
  part: role === 'anchor' || role === 'ornament' ? 'melody' : 'harmony', voice: role === 'anchor' || role === 'ornament' ? 5 : 0,
  timbre: 'reed', velocity: .4, expression: { role },
});

test('a source repeats its glide gesture on active lead continuations while written anchors stay exact in every native grid', () => {
  for (const tuning of ['12tet', '19edo', '24edo', '31edo'] as const) {
    const layer = new ExpressiveGlides('recurring-connection');
    const sourceId = 'theme-source';
    const gestures: boolean[][] = [];
    for (let occurrence = 0; occurrence < 2; occurrence++) {
      const startTick = occurrence * 15360;
      const input = Array.from({ length: 16 }, (_, index) => ({ ...note(index, index % 4 ? 'ornament' : 'anchor'),
        id: `occurrence-${occurrence}:note-${index}`, tick: startTick + index * 960,
        absolutePitch: degreeToPitch(tuning, 70 + index % 5),
        ...(tuning === '12tet' ? { midiNote: 70 + index % 5 } : {}) }));
      const output = layer.apply(input, DEFAULT_PARAMETERS, [], { sourceId, startTick, endTick: startTick + 15360 });
      gestures.push(output.map(event => !!event.endPitch));
      assert.ok(output.some(event => event.voice === 5 && event.endPitch));
      output.forEach((event, index) => {
        assert.equal(event.tick, input[index].tick);
        assert.deepEqual(event.endPitch ?? event.absolutePitch, input[index].absolutePitch);
        if (event.expression?.role === 'anchor') assert.deepEqual(event, input[index]);
        if (event.endPitch) assert.equal(event.midiNote, undefined, '12-TET glides also keep explicit physical endpoints.');
      });
      assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
    }
    assert.deepEqual(gestures[0], gestures[1], 'An occurrence does not roll a different articulation lottery for each note ID.');
    assert.deepEqual(glideGestureFor('recurring-connection', sourceId), glideGestureFor('recurring-connection', sourceId));
  }
});

test('a replacement connects from the currently heard point of an unfinished native glide', () => {
  const layer = new ExpressiveGlides('physical-connection');
  const first: NoteEvent = { ...note(0), duration: 960, absolutePitch: { millicents: 0 },
    endPitch: { millicents: 300000 }, glideTicks: 960 };
  layer.apply([first], DEFAULT_PARAMETERS, [], { sourceId: 'continuation', startTick: 0, endTick: 960 });
  const next: NoteEvent = { ...note(1), tick: 480, absolutePitch: { millicents: 400000 } };
  const [connected] = layer.apply([next], DEFAULT_PARAMETERS, [], { sourceId: 'continuation', startTick: 0, endTick: 960 });
  assert.deepEqual(connected.absolutePitch, { millicents: 150000 });
  assert.deepEqual(connected.endPitch, next.absolutePitch);
});
test('interior glides preserve native destinations and literal anchors with stable addressed choices', () => {
  const input = Array.from({ length: 48 }, (_, i) => note(i));
  const a = new ExpressiveGlides('glide-review').apply(input, DEFAULT_PARAMETERS, []);
  const b = new ExpressiveGlides('glide-review').apply(input, DEFAULT_PARAMETERS, []);
  assert.deepEqual(a, b);
  assert.ok(a.filter(n => n.endPitch).length >= 6);
  a.forEach((n, i) => assert.deepEqual(n.endPitch ?? n.absolutePitch, input[i].absolutePitch));
  assert.ok(a.filter(n => n.endPitch).every(n => n.midiNote === undefined && n.glideTicks! <= n.duration));
  for (const role of ['anchor', 'support'] as const) {
    const protectedNotes = Array.from({ length: 24 }, (_, i) => note(i, role));
    assert.deepEqual(new ExpressiveGlides('glide-review').apply(protectedNotes, DEFAULT_PARAMETERS, []), protectedNotes);
  }
});

test('a declared breath remains a break even after its phrase snapshot leaves the caller', () => {
  for (let seed = 0; seed < 20; seed++) {
    const layer = new ExpressiveGlides(String(seed));
    const first = { ...note(0), duration: 930 };
    layer.apply([first], DEFAULT_PARAMETERS, [{ startTick: 930, endTick: 960, scope: 'ensemble', reason: 'Short known break' }]);
    const next = layer.apply([note(1)], DEFAULT_PARAMETERS, []);
    assert.equal(next[0].endPitch, undefined);
  }
});

test('the production lead honors its own breaths without mistaking accompaniment rests for a broken line', () => {
  for (const scope of ['lead', 'ensemble', 'accompaniment'] as const) {
    const layer = new ExpressiveGlides('lead-breath');
    const context = { sourceId: 'heard-theme', startTick: 0, endTick: 1920 };
    layer.apply([{ ...note(0, 'anchor'), duration: 930 }], DEFAULT_PARAMETERS,
      [{ startTick: 930, endTick: 960, scope, reason: 'Written breath' }], context);
    const [next] = layer.apply([note(1, 'ornament')], DEFAULT_PARAMETERS, [], context);
    assert.equal(!!next.endPitch, scope === 'accompaniment');
  }
});

test('ensemble gains stay valid after coordination and rests; interior glide switch preserves the baseline and additive paths', () => {
  for (const [tuningTravel, instrument] of [[true, 'ensemble'], [false, 'ensemble'], [true, 'additive']] as const) {
    const engine = new MusicEngine({ seed: 'glass-garden', parameters: { ...DEFAULT_PARAMETERS,
      ensembleSize: 1, rhythmicDensity: .1, voiceLeading: 1, ideaDensity: .3 },
      conductor: { ...DEFAULT_CONDUCTOR, amount: 0, tuningTravel },
      phrasing: { ...DEFAULT_PHRASING, composition: { ...DEFAULT_PHRASING.composition!, dynamicRange: 0 } },
      sound: { ...DEFAULT_SOUND, instrument } });
    const frames = Array.from({ length: 110 }, () => engine.step());
    const interior = frames.filter(f => !f.form?.gliding).flatMap(f => f.notes).filter(n => n.endPitch);
    if (tuningTravel && instrument === 'ensemble') {
      assert.ok(interior.length >= 4);
      assert.ok(interior.some(n => n.part === 'harmony'));
      assert.ok(interior.some(n => n.voice === 5 && n.expression?.role === 'ornament'), 'The production lead, not a retired solo voice, carries interior connections.');
      assert.ok(interior.every(n => n.expression?.role !== 'anchor'), 'Protected theme anchors are never retuned by a surface effect.');
      const rests = frames.flatMap(frame => frame.phrase?.rests ?? []);
      for (const note of interior) {
        assert.ok(note.glideTicks! > 0 && note.glideTicks! <= note.duration);
        assert.ok(Math.abs(note.endPitch!.millicents - note.absolutePitch!.millicents) <= (note.part === 'harmony' ? 350000 : 450000));
        assert.ok(!rests.some(rest => restAppliesToNote(note, rest) && note.tick < rest.endTick
          && note.tick + note.duration > rest.startTick), 'A physical connection never crosses a published breath.');
      }
    }
    else assert.equal(interior.length, 0);
    for (const frame of frames) for (const event of frame.notes) {
      for (const [index, point] of (event.gainEnvelope ?? []).entries()) {
        assert.ok(Number.isSafeInteger(point.tick) && point.tick >= 0 && point.tick <= event.duration);
        assert.ok(point.gain >= 0 && point.gain <= 1);
        if (index) assert.ok(point.tick > event.gainEnvelope![index - 1].tick);
      }
    }
  }
});
