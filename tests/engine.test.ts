import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicEngine, eventHash, random, targetTension, validVoices, voiceLeadingDistance } from '../src/engine/index';
import { DEFAULT_PARAMETERS, DEFAULT_WEIGHTS } from '../src/parameters';
import { aggregateTension, BASS_RANGE, dissonance, harmonicDistance, pitchClassMask, tensionComponents } from '../src/engine/analysis';
import { degreeToPitch, pitchToDegree, pitchToMidi } from '../src/pitch';
import { DEFAULT_SOUND, SPECTRA, type SoundConfig } from '../src/spectrum';
import { edo19Collection, EDO19_BASS_RANGE, EDO19_VOICE_RANGES, validEdo19Voices } from '../src/engine/edo19';
import { harmonicRealization } from '../src/engine/harmonic-tools';
import { createRoughnessScorer, roughnessTargetAt, type RoughnessScorer } from '../src/engine/roughness-scoring';
import { initialEdo19State, planEdo19 } from '../src/engine/edo19';
import { plan } from '../src/engine/planner';
import { midiToPitch } from '../src/pitch';
import { integer } from '../src/engine/random';
import type { AutomationLane, AutomationRevision, EngineConfig, Frame } from '../src/types';

function generate(count: number, config: Partial<EngineConfig> = {}): Frame[] {
  const engine = new MusicEngine({ seed: 'glass-garden', parameters: DEFAULT_PARAMETERS, ...config });
  return Array.from({ length: count }, () => engine.step());
}
const midiVoices = (frame: Frame) => frame.voicePitches.map(pitchToMidi);
const midiBass = (frame: Frame) => pitchToMidi(frame.bassPitch);
const legacyNotes = (frames: Frame[]) => frames.flatMap(f => f.notes).map(note => ({ id: note.id, tick: note.tick, duration: note.duration, pitch: note.midiNote, velocity: note.velocity, part: note.part, voice: note.voice }));

test('replay produces identical complete frames and a golden event hash', () => {
  const a = generate(32), b = generate(32);
  assert.deepEqual(a, b);
  // Version19 composes concise gestures and directed refinements through a shared tool algebra.
  assert.equal(eventHash(legacyNotes(a)), '62424683');
  assert.notEqual(eventHash(a.flatMap(f => f.notes)), eventHash(generate(32, { seed: 'other-garden' }).flatMap(f => f.notes)));
});

test('random domains are stateless, independently addressed, and unambiguous', () => {
  const expected = random('seed', 'harmony', 4, 2, 'movement');
  for (let i = 0; i < 100; i++) random('seed', 'percussion', i, 'hat');
  assert.equal(random('seed', 'harmony', 4, 2, 'movement'), expected);
  assert.notEqual(random('seed', 'percussion', 4, 2, 'movement'), expected);
  assert.notEqual(random('ab', 'c', 1), random('a', 'bc', 1));
  assert.equal(expected >= 0 && expected < 1, true);
});

test('all committed events respect range, crossing, integer-time and velocity constraints', () => {
  for (const seed of ['a', 'b', 'c', 'empty', '🎵']) {
    const parameters = { ...DEFAULT_PARAMETERS, voiceLeading: 0.15, harmonicMobility: 0.95, bassIndependence: 1, bassMobility: 1 };
    for (const frame of generate(48, { seed, parameters })) {
      assert.ok(validVoices(midiVoices(frame)));
      assert.ok(midiBass(frame) >= BASS_RANGE[0] && midiBass(frame) <= BASS_RANGE[1]);
      assert.ok(midiVoices(frame)[0] - midiBass(frame) >= 7);
      assert.equal(frame.diagnostics.horizon, 8);
      assert.ok(frame.diagnostics.candidatesEvaluated >= 8);
      assert.equal(frame.diagnostics.harmonicPlan?.realization.matched, true);
      assert.ok(frame.notes.every(n => Number.isInteger(n.midiNote) && (n.part === 'percussion' || Number.isInteger(n.absolutePitch?.millicents)) && Number.isInteger(n.tick) && Number.isInteger(n.duration) && n.duration > 0 && n.tick >= frame.tick && n.tick < frame.tick + frame.duration && n.velocity >= 0 && n.velocity <= 1));
    }
  }
});

test('the physical voice planner supports high harmonic travel with upper steps within two semitones', () => {
  const parameters = { ...DEFAULT_PARAMETERS, harmonicMobility: .95, voiceLeading: .99, tonalClarity: .28, chromaticism: .85, bassIndependence: .85 };
  const run = (p: typeof parameters) => {
    let state = { voices: [55, 60, 64, 69], bass: 36, center: 0, index: 0, recent: [] as number[] };
    return Array.from({ length: 96 }, () => {
      const winner = plan('smooth-destinations', state, () => p, DEFAULT_WEIGHTS).winner;
      state = winner.state; return winner;
    });
  };
  const high = run(parameters), low = run({ ...parameters, harmonicMobility: .1 });
  const mean = (values: typeof high) => values.reduce((sum, item) => sum + item.distance, 0) / values.length;
  assert.ok(mean(high) > mean(low) + .15);
  assert.ok(new Set(high.map(item => pitchClassMask(item.state.voices, item.state.bass))).size >= 40);
  high.slice(1).forEach((item, index) => item.state.voices.forEach((pitch, voice) => assert.ok(Math.abs(pitch - high[index].state.voices[voice]) <= 2)));
});

test('voice leading and bass reinterpretation are distinct measurements', () => {
  const voices = [55, 60, 64, 69];
  assert.equal(voiceLeadingDistance(voices, [56, 60, 63, 71]), 4);
  assert.equal(voiceLeadingDistance(voices, voices), 0);
  assert.equal(harmonicDistance(voices, 36, voices, 36), 0);
  assert.ok(harmonicDistance(voices, 36, voices, 37) > 0.2);
  assert.ok(dissonance([55, 60, 64, 67], 36) < dissonance([55, 56, 60, 61], 36));
});

test('multiscale tension remains bounded and releases inside each phrase', () => {
  const targets = Array.from({ length: 256 }, (_, i) => targetTension(i, DEFAULT_PARAMETERS));
  assert.ok(targets.every(t => t >= 0 && t <= 1));
  assert.ok(targets[4] > targets[7]);
  assert.ok(new Set(targets).size > 20);
  const components = tensionComponents([55, 60, 64, 69], 36, [54, 60, 65, 69], DEFAULT_PARAMETERS, 0, 4);
  assert.ok(Object.values(components).every(v => v >= 0 && v <= 1));
  assert.ok(aggregateTension(components) >= 0 && aggregateTension(components) <= 1);
});

test('automation, live parameter changes and diagnostic weights preserve reproducible continuation', () => {
  const config: EngineConfig = { seed: 'automation', parameters: DEFAULT_PARAMETERS, automation: [{ parameter: 'harmonicMobility', points: [{ tick: 0, value: 0.1 }, { tick: 960 * 32, value: 0.95 }] }] };
  const a = new MusicEngine(config), b = new MusicEngine(config);
  for (let i = 0; i < 32; i++) {
    if (i === 8) { a.setParameters({ ...DEFAULT_PARAMETERS, tension: 0.7 }); b.setParameters({ ...DEFAULT_PARAMETERS, tension: 0.7 }); }
    if (i === 16) { a.setWeights({ commonTones: 0 }); b.setWeights({ commonTones: 0 }); }
    const frameA = a.step(), frameB = b.step();
    assert.deepEqual(frameA, frameB);
    if (i >= 16) assert.equal(frameA.diagnostics.scores.commonTones, 0);
    assert.equal(a.tick, (i + 1) * 960);
  }
  assert.ok(DEFAULT_WEIGHTS.smoothness > 0);
});

test('the receding voice planner anticipates future intent despite identical immediate parameters', () => {
  const seed = 'automation-anticipation-5', center = integer(seed, 'initial', 0, 11, 'center');
  const shift = center <= 6 ? center : center - 12;
  const state = { voices: [55, 60, 64, 69].map(n => n + shift), bass: 36 + center, center, index: 0, recent: [] };
  const constant = plan(seed, state, () => DEFAULT_PARAMETERS, DEFAULT_WEIGHTS).winner;
  const anticipated = plan(seed, state, index => ({ ...DEFAULT_PARAMETERS, dissonance: index < 3 ? DEFAULT_PARAMETERS.dissonance : .8 }), DEFAULT_WEIGHTS).winner;
  assert.notDeepEqual(constant.state, anticipated.state);
  assert.ok(anticipated.total < constant.total, 'A lower immediate score can enable a better future.');
});

test('recorded knowledge revisions reproduce live edits without leaking future edits backward', () => {
  const firstEdit: AutomationLane[] = [{ parameter: 'dissonance', points: [{ tick: 4800, value: 0.8 }] }];
  const secondEdit: AutomationLane[] = [...firstEdit, { parameter: 'harmonicMobility', points: [{ tick: 10560, value: 0.1 }, { tick: 19200, value: 0.9 }] }];
  const revisions: AutomationRevision[] = [{ tick: 0, lanes: [] }, { tick: 4800, lanes: firstEdit }, { tick: 10560, lanes: secondEdit }];
  const live = new MusicEngine({ seed: 'knowledge-replay', parameters: DEFAULT_PARAMETERS });
  const replay = new MusicEngine({ seed: 'knowledge-replay', parameters: DEFAULT_PARAMETERS, automation: secondEdit, automationRevisions: revisions });
  for (let i = 0; i < 28; i++) {
    if (i === 5) live.setAutomation(firstEdit);
    if (i === 11) live.setAutomation(secondEdit);
    assert.deepEqual(replay.step(), live.step());
  }
});

test('rhythmic predictability changes accompaniment while protecting the thematic core', () => {
  const readings = [0.2, 0.5, 0.8].map(rhythmicPredictability => {
    // Allow the independent response layer to enter and offer several answers.
    const frames = generate(384, { seed: 'rhythm-review', parameters: { ...DEFAULT_PARAMETERS, melodicActivity: 1, rhythmicComplexity: 0.7, rhythmicPredictability } });
    return { rhythm: eventHash(frames.flatMap(f => f.notes).filter(n => n.part === 'percussion').map(n => [n.tick, n.duration])),
      heads: frames.map(frame => frame.phrase?.themeCore?.notes.filter(note => note.role === 'head')) };
  });
  assert.equal(new Set(readings.map(reading => reading.rhythm)).size, 3);
  assert.deepEqual(readings[0].heads, readings[1].heads);
  assert.deepEqual(readings[1].heads, readings[2].heads);
});

test('hierarchical memory stays bounded, returns older ideas, and snapshots cannot mutate the engine', () => {
  const parameters = { ...DEFAULT_PARAMETERS, motifRecurrence: 1, melodicActivity: 0.8 };
  const engine = new MusicEngine({ seed: 'memory', parameters });
  const control = new MusicEngine({ seed: 'memory', parameters });
  let recalls = 0;
  for (let i = 0; i < 160; i++) {
    const frame = engine.step(), expected = control.step();
    assert.deepEqual(frame, expected);
    assert.ok(frame.motifs.length <= 18);
    if (i % 8 === 0 && frame.diagnostics.recall) recalls++;
    frame.voicePitches[0].millicents = 0;
    frame.motifs[0].intervals[0] = 999;
  }
  assert.ok(recalls > 4);
});

test('native 19-EDO replay has a golden stream, valid degrees and smooth microtonal motion', () => {
  const parameters = { ...DEFAULT_PARAMETERS, harmonicMobility: 0.9, voiceLeading: 0.99, tonalClarity: 0.3 };
  const sound: SoundConfig = { ...DEFAULT_SOUND, tuning: '19edo', instrument: 'additive' };
  // Longer source-aware thoughts can intentionally keep one native field for
  // more than the old fixed clock. Audit exploration across several episodes.
  const a = generate(128, { seed: 'xeno-garden', parameters, sound });
  const b = generate(128, { seed: 'xeno-garden', parameters, sound });
  assert.deepEqual(a, b);
  assert.equal(eventHash(a.slice(0, 64).flatMap(frame => frame.notes)), '65f4f30f');
  const degreeClasses = new Set<number>();
  for (const frame of a) {
    const upper = frame.voicePitches.map(pitch => pitchToDegree('19edo', pitch));
    const bass = pitchToDegree('19edo', frame.bassPitch);
    assert.ok(validEdo19Voices(upper));
    assert.ok(bass >= EDO19_BASS_RANGE[0] && bass <= EDO19_BASS_RANGE[1] && upper[0] - bass >= 11);
    assert.equal(frame.diagnostics.tonalCenter, undefined);
    assert.ok(Number.isInteger(frame.diagnostics.tonalCenterDegree));
    assert.ok(frame.motifs.every(motif => motif.intervalUnit === '19edo-degrees'));
    for (const note of frame.notes.filter(note => note.part !== 'percussion')) {
      assert.equal(note.midiNote, undefined);
      assert.ok(note.absolutePitch);
      const degree = pitchToDegree('19edo', note.absolutePitch!);
      assert.deepEqual(note.absolutePitch, degreeToPitch('19edo', degree));
      degreeClasses.add(((degree % 19) + 19) % 19);
    }
  }
  const heardThrough = a.at(-1)!.tick + a.at(-1)!.duration;
  const authoredClasses = new Set(a.flatMap(frame => frame.phrase!.themeCore!.notes)
    .filter(note => note.startTick < heardThrough).map(note => {
      const degree = pitchToDegree('19edo', { millicents: Math.round(note.absolutePitchCents * 1000) });
      return ((degree % 19) + 19) % 19;
    }));
  assert.ok(authoredClasses.size > 0 && [...authoredClasses].every(degree => degreeClasses.has(degree)),
    'The heard native vocabulary covers the authored source; a coherent field need not visit an arbitrary quota of foreign degrees.');
  assert.ok(a.flatMap(frame => frame.notes).some(note => note.absolutePitch && note.absolutePitch.millicents % 100000 !== 0));
  assert.deepEqual(a.map(frame => edo19Collection([...frame.voicePitches, frame.bassPitch].map(pitch => pitchToDegree('19edo', pitch)))),
    a.map(frame => edo19Collection(frame.diagnostics.harmonicPlan!.current.pitchClasses)),
    'Every physical sonority realizes its authored native collection; repeated destinations need not invent extra chords.');
  assert.ok(new Set(a.map(frame => frame.diagnostics.harmonicPlan!.current.root)).size >= 4, 'Native harmony visits distinct destinations while allowing each one to support a complete thought.');
  a.slice(1).forEach((frame, i) => {
    const prior = a[i].voicePitches.map(pitch => pitchToDegree('19edo', pitch));
    const current = frame.voicePitches.map(pitch => pitchToDegree('19edo', pitch));
    const largest = Math.max(...current.map((degree, voice) => Math.abs(degree - prior[voice])));
    if (largest <= 5) return;
    // A complete in-range sonority can occasionally require a larger step.
    // Exhaustively reject a smoother realization, rather than silently relaxing
    // the voice-leading guarantee to an arbitrary larger limit.
    const destination = frame.diagnostics.harmonicPlan!.current;
    const feasible = (radius: number) => {
      let paths: number[][] = [[]];
      EDO19_VOICE_RANGES.forEach(([lo, hi], voice) => {
        const options = Array.from({ length: hi - lo + 1 }, (_, n) => lo + n)
          .filter(degree => Math.abs(degree - prior[voice]) <= radius && destination.pitchClasses.includes(((degree % 19) + 19) % 19));
        paths = paths.flatMap(path => options.map(degree => [...path, degree]));
      });
      return paths.filter(validEdo19Voices).some(upper => {
        for (let bass = EDO19_BASS_RANGE[0]; bass <= EDO19_BASS_RANGE[1]; bass++) {
          if (upper[0] - bass >= 11 && harmonicRealization(destination, upper, bass, '19edo').matched) return true;
        }
        return false;
      });
    };
    assert.ok(feasible(largest));
    assert.equal(feasible(largest - 1), false, 'The exceptional larger transfer must be necessary to realize the complete destination.');
  });
  const baseline = generate(128, { seed: 'xeno-garden', parameters });
  assert.notDeepEqual(a.map(frame => frame.voicePitches), baseline.map(frame => frame.voicePitches.map(pitch => degreeToPitch('19edo', pitchToDegree('19edo', pitch)))));
});

test('roughness-disabled playback preserves event streams and ensemble cannot use an unmatched spectrum objective', () => {
  const baseline = generate(32);
  const additive = generate(32, { sound: { ...DEFAULT_SOUND, instrument: 'additive', roughnessWeight: 0 } });
  const importedEnsemble = generate(32, { sound: { ...DEFAULT_SOUND, instrument: 'ensemble', spectrum: SPECTRA[1], roughnessWeight: 3 } });
  assert.deepEqual(baseline.map(frame => frame.voicePitches), additive.map(frame => frame.voicePitches));
  assert.deepEqual(baseline.map(frame => frame.bassPitch), additive.map(frame => frame.bassPitch));
  assert.ok(additive.flatMap(frame => frame.notes).filter(note => note.part === 'harmony').every(note => !note.gainEnvelope));
  assert.deepEqual(baseline.flatMap(frame => frame.notes), importedEnsemble.flatMap(frame => frame.notes));
  assert.ok(importedEnsemble.every(frame => frame.diagnostics.sensoryRoughness === undefined && frame.diagnostics.roughnessContribution === undefined));
  assert.ok(additive.every(frame => frame.diagnostics.roughnessContribution === 0));
});

test('native 19-EDO hard constraints survive contrasting seeds and smoothness extremes', () => {
  for (const [index, seed] of ['winter-orbit', 'amber-river', '03:17', '🎼'].entries()) {
    const parameters = { ...DEFAULT_PARAMETERS, voiceLeading: index % 2, harmonicMobility: 0.95, bassIndependence: 1, bassMobility: 1 };
    const frames = generate(40, { seed, parameters, sound: { ...DEFAULT_SOUND, tuning: '19edo', instrument: 'additive', roughnessWeight: 1 } });
    for (const frame of frames) {
      const upper = frame.voicePitches.map(pitch => pitchToDegree('19edo', pitch));
      const bass = pitchToDegree('19edo', frame.bassPitch);
      assert.ok(validEdo19Voices(upper));
      assert.ok(bass >= EDO19_BASS_RANGE[0] && bass <= EDO19_BASS_RANGE[1] && upper[0] - bass >= 11);
      assert.ok(Number.isFinite(frame.diagnostics.totalScore));
    }
  }
});

test('actual-spectrum scoring changes both native planners and reduces mean trajectory error across the audit cohort', () => {
  const parameters = { ...DEFAULT_PARAMETERS, harmonicMobility: 0.9, voiceLeading: 0.99, tonalClarity: 0.3 };
  const averageError = (frames: Frame[]) => frames.reduce((sum, frame) => sum + Math.abs(frame.diagnostics.sensoryRoughness! - frame.diagnostics.roughnessTarget!), 0) / frames.length;
  const soundingIdentity = (frames: Frame[]) => eventHash(frames.map(frame => [...frame.voicePitches, frame.bassPitch]));
  for (const tuning of ['12tet', '19edo'] as const) {
    const sound: SoundConfig = { ...DEFAULT_SOUND, tuning, instrument: 'additive' };
    let unweightedError = 0, weightedError = 0, changedWeight = 0, changedSpectrum = 0;
    const seeds = ['xeno-garden', 'glass-garden', 'velvet-orbit'];
    for (const seed of seeds) {
    const unweighted = generate(64, { seed, parameters, sound });
    const weighted = generate(64, { seed, parameters, sound: { ...sound, roughnessWeight: 3 } });
    unweightedError += averageError(unweighted); weightedError += averageError(weighted);
    changedWeight += Number(soundingIdentity(unweighted) !== soundingIdentity(weighted));
    const stretched = generate(64, { seed, parameters, sound: { ...sound, roughnessWeight: 3, spectrum: SPECTRA[1] } });
    changedSpectrum += Number(soundingIdentity(weighted) !== soundingIdentity(stretched));
    for (const frame of [...weighted, ...stretched]) {
      const musical = Object.values(frame.diagnostics.scores).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(frame.diagnostics.totalScore - musical - frame.diagnostics.roughnessContribution!) < 0.000002);
      assert.equal(frame.diagnostics.roughnessTarget, roughnessTargetAt(frame.index, sound.roughnessTarget));
    }
    }
    // An individual melody can leave little register freedom. The objective
    // competes with those destinations; demand a benefit across held inputs,
    // not the same absolute improvement for every freshly generated theme.
    assert.ok(changedWeight > 0 && changedSpectrum > 0,
      `${tuning}: both objective weight and physical spectrum must influence the cohort's actual five-tone voicings.`);
    assert.ok(weightedError / seeds.length < unweightedError / seeds.length - .01);
  }
});

test('both planners evaluate the independent sensory trajectory at every future frame', () => {
  const visited = new Set<number>();
  const sensory: RoughnessScorer = { applicable: true, enabled: true, evaluate: (_pitches, frameIndex) => {
    visited.add(frameIndex);
    const target = roughnessTargetAt(frameIndex, 0.4);
    return { value: 0.4, target, contribution: -Math.abs(0.4 - target) };
  } };
  plan('sensory-horizon', { voices: [55, 60, 64, 69], bass: 36, center: 0, index: 0, recent: [] }, () => DEFAULT_PARAMETERS, DEFAULT_WEIGHTS, sensory);
  assert.deepEqual([...visited].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  visited.clear();
  planEdo19('sensory-horizon', initialEdo19State('sensory-horizon'), () => DEFAULT_PARAMETERS, DEFAULT_WEIGHTS, sensory);
  assert.deepEqual([...visited].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.notEqual(roughnessTargetAt(0, 0.4), roughnessTargetAt(8, 0.4));
  const ensemble = createRoughnessScorer({ ...DEFAULT_SOUND, roughnessWeight: 3 }, midiToPitch);
  assert.equal(ensemble.enabled, false);
  assert.equal(ensemble.evaluate([55, 60, 64, 69], 0).contribution, 0);
});
