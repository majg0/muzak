import test from 'node:test';
import assert from 'node:assert/strict';
import { melodicIntentSummary } from '../src/melodic-intent-audit';
import { midiToPitch } from '../src/pitch';
import type { Frame, NoteEvent } from '../src/types';

test('foreground interval, gate and target metrics cannot mistake a static top harmony for the melody', () => {
  const note = (voice: number, tick: number, pitch: number, duration: number, velocity: number): NoteEvent => ({
    id: `${voice}:${tick}`, voice, tick, absolutePitch: midiToPitch(pitch), duration, velocity,
    part: voice === 5 ? 'melody' : 'harmony', timbre: 'reed', articulation: 'connected',
    expression: { role: 'anchor', sourceId: 'test-subject' } });
  const frames = [{ tick: 0, duration: 1920, notes: [note(5, 0, 60, 510, .5), note(5, 480, 67, 990, .8),
    note(5, 1440, 65, 240, .6), note(3, 0, 72, 990, .4), note(3, 960, 73, 990, .4)] } as Frame];
  const report = melodicIntentSummary(frames);
  assert.equal(report.foreground.intervalCents.max, 700);
  assert.equal(report.topHarmony.intervalCents.max, 100);
  assert.equal(report.foreground.leapTargets.attacks, 1);
  assert.equal(report.foreground.leapTargets.meanVelocity, .8);
  assert.equal(report.foreground.leapTargets.stepwiseOppositeRecoveries, 1);
  assert.ok(report.foreground.leapTargets.meanVelocity > report.foreground.leapTargets.otherMeanVelocity);
  assert.equal(report.foreground.durationBeats.median, 1.0625);
  assert.equal(report.foreground.pitchChangingLegatoCandidates, 2);
  assert.equal(report.foreground.explicitPitchGlides, 0);
  assert.equal(report.foreground.overlapConnections, 2);
  assert.deepEqual(report.foreground.nativeRangeMidiEquivalent, [60, 67]);
});

test('written breaths, color changes and declared pitch slides are separate from ordinary legato candidates', () => {
  const common = { voice: 5, part: 'melody' as const, timbre: 'strings' as const, articulation: 'sustained' as const, velocity: .7 };
  const frames = [{ tick: 0, duration: 1920, notes: [
    { ...common, id: 'a', tick: 0, duration: 240, absolutePitch: midiToPitch(60) },
    { ...common, id: 'b', tick: 480, duration: 510, absolutePitch: midiToPitch(67) },
    { ...common, id: 'c', tick: 960, duration: 510, absolutePitch: midiToPitch(67), endPitch: midiToPitch(69), glideTicks: 480 },
    { ...common, id: 'd', tick: 1440, duration: 480, absolutePitch: midiToPitch(69), timbre: 'reed' },
  ] } as Frame];
  const report = melodicIntentSummary(frames).foreground;
  assert.equal(report.writtenBreaths, 1); assert.equal(report.explicitPitchGlides, 1);
  assert.equal(report.legatoReuseCandidates, 0);
  assert.equal(report.intervalHistogramCents['-Infinity<value<=0'], 1);
});
