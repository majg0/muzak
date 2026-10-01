import { writeFileSync } from 'node:fs';
import { performance as clock } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { MusicEngine } from '../src/engine';
import { conductParameters, formAt } from '../src/conductor';
import { expressiveContourAt } from '../src/engine/expression';
import { textureIntentAt } from '../src/engine/texture';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { ENGINE_VERSION, FRAME_TICKS, type Frame, type NoteEvent, type Performance } from '../src/types';

const mean = (items: number[]) => items.length ? items.reduce((sum, item) => sum + item, 0) / items.length : 0;
const round = (n: number) => Math.round(n * 1000) / 1000;
const quantile = (items: number[], fraction: number) => [...items].sort((a, b) => a - b)[Math.floor(Math.max(0, items.length - 1) * fraction)] ?? 0;
const make = (recipe: Performance) => new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters,
  weights: recipe.weights, sound: recipe.sound, conductor: recipe.conductor, phrasing: recipe.phrasing,
  automation: recipe.automation, automationRevisions: recipe.automationRevisions });

function audit(seed: string) {
  const recipe = createPerformance(seed);
  const conductor = recipe.conductor!;
  const paramsAt = (tick: number) => conductParameters(seed, Math.floor(tick / FRAME_TICKS) * FRAME_TICKS, recipe.initialParameters, conductor, recipe.sound.tuning);
  const textureAt = (tick: number) => textureIntentAt(paramsAt(tick), formAt(seed, tick, conductor, recipe.sound.tuning),
    expressiveContourAt(seed, tick, at => formAt(seed, at, conductor, recipe.sound.tuning), conductor.enabled ? conductor.amount : 0));
  const engine = make(recipe), frames: Frame[] = [];
  const started = clock.now();
  do { frames.push(engine.step()); } while (formAt(seed, engine.tick, conductor, recipe.sound.tuning).cycle === 0 && frames.length < 1800);
  const millisecondsPerFrame = (clock.now() - started) / frames.length;
  const groups = (predicate: (frame: Frame) => boolean) => {
    const chosen = frames.filter(predicate), notes = chosen.flatMap(frame => frame.notes);
    const parts = Object.fromEntries((['bass', 'harmony', 'melody', 'percussion'] as const).map(part => {
      const events = notes.filter(note => note.part === part);
      const nonPerc = events.filter(note => note.absolutePitch);
      return [part, { attacksPerBeat: round(events.length / Math.max(1, chosen.length * 2)),
        meanVelocity: round(mean(events.map(note => note.velocity))), medianGateBeats: round(quantile(events.map(note => note.duration / 480), .5)),
        offQuarterFraction: round(mean(events.map(note => Number(note.tick % 480 !== 0)))),
        sustainedFraction: round(mean(nonPerc.map(note => Number(note.articulation === 'sustained')))) }];
    }));
    return { frames: chosen.length, parts };
  };
  const calm = groups(frame => textureAt(frame.tick).pace < .3);
  const crest = groups(frame => textureAt(frame.tick).pace > .75);
  const rising = groups(frame => expressiveContourAt(seed, frame.tick, at => formAt(seed, at, conductor), conductor.amount).direction === 'gathering');
  const notes = frames.flatMap(frame => frame.notes);
  const byTick = new Map<number, Set<string>>();
  for (const note of notes) {
    const set = byTick.get(note.tick) ?? new Set(); set.add(note.part); byTick.set(note.tick, set);
  }
  const sharedFineBackingAttacks = [...byTick].filter(([tick, parts]) => tick % 480 !== 0 && textureAt(tick).pace > .75
    && parts.has('bass') && parts.has('harmony') && parts.has('percussion')).length;
  const retreatFills = notes.filter(note => (note.id.startsWith('fill:') || note.id.startsWith('transition:')) && textureAt(note.tick).pace < .3);
  const leapSummary = (voice: number) => {
    const line = notes.filter(note => note.voice === voice && note.absolutePitch).sort((a, b) => a.tick - b.tick);
    const leaps = line.slice(1).map((note, i) => Math.abs(note.absolutePitch!.millicents - (line[i].endPitch ?? line[i].absolutePitch)!.millicents) / 1000);
    return { attacks: line.length, medianCents: round(quantile(leaps, .5)), largeOverOctave: leaps.filter(cents => cents > 1200).length };
  };
  const sameVoiceOverlaps: { voice: number; before: string; after: string; ticks: number }[] = [];
  for (const voice of [4, 8]) {
    const line = notes.filter(note => note.voice === voice).sort((a, b) => a.tick - b.tick);
    for (let i = 1; i < line.length; i++) {
      const over = line[i - 1].tick + line[i - 1].duration - line[i].tick;
      if (over > 0 && sameVoiceOverlaps.length < 8) sameVoiceOverlaps.push({ voice, before: line[i - 1].id, after: line[i].id, ticks: over });
    }
  }
  const restored = make(parsePerformance(serializePerformance(recipe)));
  for (const frame of frames) assert.deepEqual(restored.step(), frame);
  return { seed, frames: frames.length, millisecondsPerFrame: round(millisecondsPerFrame), calm, crest, rising,
    sharedFineBackingAttacks, retreatFillAttacks: retreatFills.length, retreatFillMaxVelocity: round(Math.max(0, ...retreatFills.map(note => note.velocity))),
    lead: leapSummary(5), solo: leapSummary(6), counter: leapSummary(8), sameVoiceOverlaps,
    exactSerializedReplay: true };
}

const cases = ['glass-garden', 'velvet-orbit', 'amber-current'].map(audit);
const report = { engineVersion: ENGINE_VERSION, scope: 'First narrative, final symbolic notes; no listening or PCM loudness claim. Overlap probes exclude synthesis replacement crossfades.', cases };
writeFileSync('texture-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
