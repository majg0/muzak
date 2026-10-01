import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MusicEngine, eventHash } from '../src/engine';
import { explorationPerformance } from '../src/exploration';
import { createPerformance, parsePerformance, serializePerformance } from '../src/serialization';
import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent, type Performance as Recipe } from '../src/types';

const round = (n: number) => Math.round(n * 1000) / 1000;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? round(sorted[Math.round((sorted.length - 1) * fraction)]) : null;
};
const distribution = (values: number[]) => ({ minimum: quantile(values, 0), median: quantile(values, .5), p90: quantile(values, .9), maximum: quantile(values, 1) });
const sortNotes = (notes: NoteEvent[]) => [...notes].sort((a, b) => a.tick - b.tick || a.voice - b.voice || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const pitched = (note: NoteEvent) => note.endPitch?.millicents ?? note.absolutePitch?.millicents ?? (note.midiNote ?? 0) * 100000;
const span = (notes: NoteEvent[]) => notes.length ? Math.max(...notes.map(note => note.tick + note.duration)) - Math.min(...notes.map(note => note.tick)) : 0;
const fingerprint = (notes: NoteEvent[], delivery = false) => {
  const ordered = sortNotes(notes), origin = ordered[0];
  return eventHash(ordered.map(note => [note.tick - origin.tick, pitched(note) - pitched(origin),
    ...(delivery ? [note.duration, note.velocity, note.voice, note.expression?.role] : [])]));
};
const engineFor = (recipe: Recipe) => new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters,
  automation: recipe.automation, automationRevisions: recipe.automationRevisions, weights: recipe.weights,
  sound: recipe.sound, conductor: recipe.conductor, phrasing: recipe.phrasing });

function harmonicSummary(frames: Frame[]) {
  const observations = frames.map(frame => frame.diagnostics.harmonicTension!);
  assert.ok(observations.every(Boolean), 'The audit needs the new measured harmonic diagnostics.');
  const errors = observations.map(value => Math.abs(value.actual - value.target));
  return { observations: observations.length, meanActual: round(mean(observations.map(value => value.actual))),
    meanTarget: round(mean(observations.map(value => value.target))), meanAbsoluteError: round(mean(errors)),
    error: distribution(errors), fractionWithinPoint1: round(errors.filter(error => error <= .1).length / Math.max(1, errors.length)) };
}

function orchestrationSummary(frames: Frame[]) {
  const observed = frames.map(frame => frame.diagnostics.orchestration!);
  assert.ok(observed.every(Boolean), 'The audit needs final-event orchestration observations.');
  const notes = frames.flatMap(frame => frame.notes), beats = frames.reduce((total, frame) => total + frame.duration / PPQ, 0);
  return { frames: frames.length, actualAttacksPerQuarterBeat: round(notes.length / Math.max(1, beats)),
    meanWrittenVelocity: round(mean(notes.map(note => note.velocity))),
    meanOfWindowMaximumActiveVoices: round(mean(observed.map(row => row.activeVoices))),
    maximumObservedActiveVoices: Math.max(0, ...observed.map(row => row.activeVoices)),
    meanHeldGainProxy: round(mean(observed.map(row => row.heldGainProxy))),
    meanRequestedEnergy: round(mean(observed.map(row => row.requestedEnergy))),
    emittedParts: Object.fromEntries(['harmony', 'bass', 'melody', 'percussion'].map(part => [part, notes.filter(note => note.part === part).length])) };
}

function materialSummary(frames: Frame[], notes: NoteEvent[]) {
  const end = frames.at(-1)!.tick + frames.at(-1)!.duration;
  const thoughts = [...new Map(frames.filter(frame => frame.phrase?.composition)
    .map(frame => [frame.phrase!.composition!.phraseId, frame])).values()].filter(frame => frame.phrase!.endTick <= end);
  const foreground = notes.filter(note => note.part === 'melody' && [5, 6, 7].includes(note.voice) && note.id.startsWith('phrase:'));
  const cells = thoughts.flatMap(frame => (frame.phrase!.composition!.shortPhrases ?? []).map(cell => {
    const core = foreground.filter(note => note.expression?.role === 'anchor'
      && note.expression.sourceId?.startsWith(`${cell.sourceId}:`) && note.tick >= cell.startTick && note.tick < cell.endTick);
    return { id: cell.id, sourceId: cell.sourceId, expected: cell.coreNotes, heard: core.length, start: cell.startTick,
      span: span(core), fingerprint: core.length ? fingerprint(core) : null };
  }));
  const motifs = thoughts.flatMap(frame => {
    const hierarchy = frame.phrase!.composition!;
    return hierarchy.motifs.map(motif => {
      const childSources = (hierarchy.shortPhrases ?? []).filter(cell => cell.motifId === motif.id).map(cell => cell.sourceId);
      const emitted = foreground.filter(note => note.tick >= motif.startTick && note.tick < motif.endTick
        && childSources.some(source => note.expression?.sourceId?.startsWith(`${source}:`)));
      const core = emitted.filter(note => note.expression?.role === 'anchor');
      return { sourceId: motif.sourceId, coreAttacks: core.length, allAttacks: emitted.length,
        span: span(emitted), fingerprint: core.length ? fingerprint(core) : null,
        playedChildren: cells.filter(cell => childSources.includes(cell.sourceId) && cell.start >= motif.startTick && cell.start < motif.endTick && cell.heard).length };
    });
  }).filter(motif => motif.coreAttacks > 0);
  const phrases = thoughts.map(frame => {
    const phrase = frame.phrase!, hierarchy = phrase.composition!;
    const emitted = foreground.filter(note => note.tick >= phrase.startTick && note.tick < phrase.endTick);
    const core = emitted.filter(note => note.expression?.role === 'anchor');
    return { source: hierarchy.sourcePhraseId, startTick: phrase.startTick, coreAttacks: core.length, allAttacks: emitted.length,
      coreFingerprint: core.length ? fingerprint(core) : null, realization: emitted.length ? fingerprint(emitted, true) : null };
  }).filter(phrase => phrase.allAttacks > 0);
  const repeatedSources = [...new Set(phrases.map(phrase => phrase.source))].map(source => phrases.filter(phrase => phrase.source === source)).filter(group => group.length > 1);
  const frequencies = new Map<string, number>();
  let run = 0, longestRun = 0, previous: string | null = null;
  for (const cell of [...cells].sort((a, b) => a.start - b.start)) {
    if (!cell.fingerprint) continue;
    frequencies.set(cell.fingerprint, (frequencies.get(cell.fingerprint) ?? 0) + 1);
    run = cell.fingerprint === previous ? run + 1 : 1; longestRun = Math.max(longestRun, run); previous = cell.fingerprint;
  }
  const ornamentNotes = foreground.filter(note => note.expression?.sourceId?.includes(':ornament:'));
  const ornamentKinds = [...new Set(ornamentNotes.map(note => note.expression!.sourceId!.split(':ornament:')[1].split(':')[0]))].sort();
  const heard = cells.filter(cell => cell.heard > 0);
  return { motifFingerprints: new Set(motifs.map(motif => motif.fingerprint!).filter(Boolean)),
    report: { emittedMotifs: motifs.length, distinctPlayedMotifFingerprints: new Set(motifs.map(motif => motif.fingerprint)).size,
      emittedCoreNotesPerMotif: distribution(motifs.map(motif => motif.coreAttacks)),
      emittedMotifSpansQuarterBeats: distribution(motifs.map(motif => motif.span / PPQ)),
      motifsWithAtLeastEightCoreAttacks: motifs.filter(motif => motif.coreAttacks >= 8).length,
      motifsWithAtLeastThreeHeardChildren: motifs.filter(motif => motif.playedChildren >= 3).length,
      heardCells: heard.length, fullyEmittedCells: cells.filter(cell => cell.heard === cell.expected).length,
      partiallyEmittedCells: cells.filter(cell => cell.heard > 0 && cell.heard < cell.expected).length,
      silentPlannedCells: cells.filter(cell => !cell.heard).length,
      distinctPlayedCellFingerprints: frequencies.size, longestAdjacentLiteralCellRun: longestRun,
      dominantPlayedCellShare: round(Math.max(0, ...frequencies.values()) / Math.max(1, heard.length)),
      emittedThoughts: phrases.length, distinctPlayedThoughtCoreFingerprints: new Set(phrases.map(phrase => phrase.coreFingerprint)).size,
      repeatedPhraseSources: repeatedSources.length,
      repeatedSourcesWithDifferentRealizations: repeatedSources.filter(group => new Set(group.map(phrase => phrase.realization)).size > 1).length,
      ornamentAttacks: ornamentNotes.length, playedOrnamentKinds: ornamentKinds,
      soloAttacks: foreground.filter(note => note.voice === 6).length,
      examples: motifs.filter(motif => motif.coreAttacks >= 8).slice(0, 3).map(motif => ({ sourceId: motif.sourceId,
        coreAttacks: motif.coreAttacks, allAttacks: motif.allAttacks, playedChildren: motif.playedChildren, heardSpanQuarterBeats: round(motif.span / PPQ) })) } };
}

function fillSummary(frames: Frame[], notes: NoteEvent[]) {
  const fills = [...new Map(frames.flatMap(frame => (frame.phrase?.composition?.fills ?? []).map(fill => [fill.id, fill] as const))).values()];
  const heard = fills.map(fill => {
    const pitchedNotes = notes.filter(note => note.expression?.sourceId === fill.id);
    const percussion = notes.filter(note => note.part === 'percussion' && note.id.startsWith('transition:') && note.tick >= fill.startTick && note.tick < fill.endTick);
    const all = [...pitchedNotes, ...percussion];
    const onsets = [...new Set(all.map(note => note.tick))];
    return { shape: fill.shape, boundaryTick: fill.boundaryTick,
      preparationAttacks: all.filter(note => note.tick < fill.boundaryTick).length,
      arrivalAttacks: all.filter(note => note.tick >= fill.boundaryTick).length,
      playedParts: [...new Set(all.map(note => note.part))].sort(),
      sharedThreePartTicks: onsets.filter(tick => new Set(all.filter(note => note.tick === tick).map(note => note.part)).size >= 3).length,
      pitchedAttacks: pitchedNotes.length };
  });
  return { announcedFills: heard.length, fillsWithPitchedParticipation: heard.filter(fill => fill.pitchedAttacks > 0).length,
    fillsWithAtLeastThreeParts: heard.filter(fill => fill.playedParts.length >= 3).length,
    fillsWithAllFourParts: heard.filter(fill => fill.playedParts.length === 4).length,
    actualSharedThreePartTicks: heard.reduce((sum, fill) => sum + fill.sharedThreePartTicks, 0), examples: heard.slice(0, 12) };
}

const cases = [], fingerprintSets: Set<string>[] = [];
const jobs = [
  ...['glass-garden', 'velvet-orbit', 'amber-current', 'wide-development-0', 'wide-development-1', 'wide-development-2'].map(seed => ({ seed, mode: 'wide-exploration' })),
  ...['glass-garden', 'velvet-orbit', 'amber-current'].map(seed => ({ seed, mode: 'full-freedom' })),
];
for (const { seed, mode } of jobs) {
  const selection = mode === 'wide-exploration' ? explorationPerformance(createPerformance('audit-source'), seed)
    : { recipe: createPerformance(seed), description: 'Default recipe with conductor Freedom at1.' };
  const { recipe, description } = selection;
  if (mode === 'full-freedom') recipe.conductor = { ...recipe.conductor!, amount: 1 };
  const engine = engineFor(recipe), frames: Frame[] = [], costs: number[] = [];
  let complete = false;
  for (let index = 0; index < 1800; index++) {
    const before = performance.now(), frame = engine.step(), cost = performance.now() - before;
    if (frame.form!.cycle !== 0) { complete = true; break; }
    frames.push(frame); costs.push(cost);
  }
  assert.ok(complete && frames.length, `${seed}: complete the first narrative before reporting results`);
  const serialized = serializePerformance(recipe), restored = parsePerformance(serialized), replay = engineFor(restored);
  for (const frame of frames) assert.deepEqual(replay.step(), frame, `${seed}: full-frame serialized replay at tick${frame.tick}`);
  assert.ok(frames.every(frame => frame.parameters.tempo === recipe.initialParameters.tempo), `${seed}: chosen tempo must remain fixed`);
  const notes = frames.flatMap(frame => frame.notes);
  assert.ok(notes.every(note => Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0
    && Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1), `${seed}: final emitted notes must be finite and bounded`);
  const interior = (frame: Frame) => frame.form!.progress >= .2 && frame.form!.progress <= .75;
  const calm = frames.filter(frame => ['intro', 'breakdown'].includes(frame.form!.role) && interior(frame));
  const peak = frames.filter(frame => frame.form!.role === 'climax' && interior(frame));
  assert.ok(calm.length && peak.length, `${seed}: compare actual calm and peak interiors`);
  const calmMetrics = orchestrationSummary(calm), peakMetrics = orchestrationSummary(peak);
  const raw = (selected: Frame[]) => ({ attacks: selected.flatMap(frame => frame.notes).length / selected.reduce((sum, frame) => sum + frame.duration / PPQ, 0),
    velocity: mean(selected.flatMap(frame => frame.notes).map(note => note.velocity)), held: mean(selected.map(frame => frame.diagnostics.orchestration!.heldGainProxy)) });
  const quiet = raw(calm), loud = raw(peak);
  const ratio = (high: number, low: number) => low > 0 ? round(high / low) : null;
  const material = materialSummary(frames, notes); fingerprintSets.push(material.motifFingerprints);
  const weaknesses: string[] = [];
  if (peakMetrics.meanWrittenVelocity < calmMetrics.meanWrittenVelocity * 1.5) weaknesses.push('Peak written velocity is less than1.5× calm velocity.');
  if (peakMetrics.meanHeldGainProxy < calmMetrics.meanHeldGainProxy * 4) weaknesses.push('Peak held-gain proxy is less than4× the calm proxy.');
  if (peakMetrics.actualAttacksPerQuarterBeat <= calmMetrics.actualAttacksPerQuarterBeat) weaknesses.push('Peak attack rate does not exceed calm attack rate.');
  if (material.report.longestAdjacentLiteralCellRun > 3) weaknesses.push('More than three adjacent emitted cells have the same interval/rhythm fingerprint.');
  if (!material.report.repeatedSourcesWithDifferentRealizations) weaknesses.push('No repeated phrase source with different emitted realizations was observed in this first narrative.');
  cases.push({ seed, mode, description, route: frames[0].form!.formName, frames: frames.length,
    seconds: round(frames.reduce((sum, frame) => sum + frame.duration / PPQ * 60 / frame.parameters.tempo, 0)),
    millisecondsPerFrame: round(mean(costs)), planningCostMilliseconds: distribution(costs),
    recipe: { tempo: recipe.initialParameters.tempo, conductor: recipe.conductor,
      phrasing: recipe.phrasing, initialParameters: recipe.initialParameters },
    completeSerializedReplay: true, serializedBytes: Buffer.byteLength(serialized), eventHash: eventHash(notes),
    harmonic: harmonicSummary(frames), harmonicByTuning: Object.fromEntries(['12tet', '19edo'].map(tuning => {
      const chosen = frames.filter(frame => frame.sound.tuning === tuning);
      return [tuning, chosen.length ? harmonicSummary(chosen) : null];
    })),
    calm: calmMetrics, peak: peakMetrics,
    contrast: { attackRateRatio: ratio(loud.attacks, quiet.attacks),
      writtenVelocityRatio: ratio(loud.velocity, quiet.velocity), heldGainProxyRatio: ratio(loud.held, quiet.held) },
    material: material.report, fills: fillSummary(frames, notes), weaknesses });
}

const pairs = [];
for (let a = 0; a < cases.length; a++) for (let b = a + 1; b < cases.length; b++) {
  if (cases[a].mode !== 'wide-exploration' || cases[b].mode !== 'wide-exploration') continue;
  const shared = [...fingerprintSets[a]].filter(value => fingerprintSets[b].has(value)).length;
  const union = new Set([...fingerprintSets[a], ...fingerprintSets[b]]).size;
  pairs.push({ seeds: [cases[a].seed, cases[b].seed], sharedPlayedMotifFingerprints: shared, union, overlapFraction: round(shared / Math.max(1, union)) });
}
const report = { engineVersion: ENGINE_VERSION,
  scope: 'Six deterministic Wide exploration recipes and three default recipes at full Freedom; complete first narratives, default ensemble. All measurements use final emitted notes or their derived diagnostics. Full-frame replay is compared after strict recipe JSON serialization.',
  limits: [
    'Symbolic event evidence, not a listening-quality judgment or PCM loudness measurement.',
    'Calm/peak observations use20–75% of their sections; orchestration diagnostics look back four quarter notes and activeVoices is that window maximum.',
    'Harmonic error compares the declared candidate-controlled native harmonic measure;12TET friction and19EDO physical crowding have different meanings.',
    'Motif fingerprints use emitted foreground anchor intervals and relative onsets; they remove transposition and omit decorative notes. Played thought realizations include actual ornaments, articulation and velocity.',
    'Fill participation is counted from final fill-owned pitched attacks and transition percussion. Written shared breaks may shorten a preparation.',
  ], cases, crossSeedPlayedMotifOverlap: pairs };
const destination = resolve('development-audit.json');
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: destination, engineVersion: ENGINE_VERSION, cases: cases.map(row => ({ seed: row.seed, mode: row.mode,
  frames: row.frames, millisecondsPerFrame: row.millisecondsPerFrame, harmonicMeanAbsoluteError: row.harmonic.meanAbsoluteError,
  contrast: row.contrast, emittedMotifs: row.material.emittedMotifs, distinctPlayedMotifs: row.material.distinctPlayedMotifFingerprints,
  motifCoreNotes: row.material.emittedCoreNotesPerMotif, heardMotifQuarterBeats: row.material.emittedMotifSpansQuarterBeats,
  threePartFills: row.fills.fillsWithAtLeastThreeParts, completeSerializedReplay: row.completeSerializedReplay, weaknesses: row.weaknesses })) }, null, 2));
