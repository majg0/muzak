import { renderOffline } from './audio';
import { DEFAULT_COMPOSITION } from './composition';
import { DEFAULT_CONDUCTOR } from './conductor';
import { MusicEngine, eventHash } from './engine';
import { DEFAULT_PARAMETERS } from './parameters';
import { DEFAULT_PHRASING, restAppliesToNote } from './phrasing';
import { ENGINE_VERSION, type Frame, type NoteEvent } from './types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const round = (value: number) => Math.round(value * 1e7) / 1e7;
const tune = (notes: NoteEvent[]) => notes.filter(note => note.part === 'melody' && ['anchor', 'layer'].includes(note.expression?.role ?? ''))
  .map(note => [note.tick, note.absolutePitch?.millicents, note.expression?.sourceId]);

/** Three audible treatments of one seed. B/C isolate transition energy while
 * preserving the layered tune; A/B change how the idea sits against the bar. */
export async function auditFlow(options: {
  seed?: string;
  onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer) => void;
} = {}) {
  const seed = options.seed ?? 'glass-garden', reports = [];
  for (const [label, independent, transition] of [
    ['A · Bar-following rhythm, sparse pickup', false, .15],
    ['B · Overlapping ideas, sparse pickup', true, .15],
    ['C · The same layered ideas, gathering into the change', true, .95],
  ] as const) {
    options.onProgress?.(`Composing ${label}`);
    const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS,
      conductor: { ...DEFAULT_CONDUCTOR, tuningTravel: false },
      phrasing: { ...DEFAULT_PHRASING, composition: { ...DEFAULT_COMPOSITION,
        displacement: independent ? .85 : 0, polymeter: independent ? .7 : 0, transition } },
      automation: ['rhythmicDensity', 'rhythmicComplexity'].map(parameter => ({ parameter: parameter as 'rhythmicDensity' | 'rhythmicComplexity', points: [{ tick: 0, value: .8 }] })),
    });
    const frames: Frame[] = [];
    let end: number | undefined;
    for (let index = 0; index < 160; index++) {
      const frame = engine.step(); frames.push(frame);
      if (frame.form!.sectionIndex > 0 && end === undefined) end = frame.form!.sectionStartTick + frame.form!.barTicks * 4;
      // Include enough of the conversation to observe independent breathing,
      // not only the first foreground phrase. At the default tempo 45 frames
      // span just over a minute and include three prepared arrivals.
      if (end !== undefined && engine.tick >= end && frames.length >= 45) break;
      if (index % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
    }
    options.onProgress?.(`Rendering ${label}`);
    const buffer = await renderOffline(frames, .65); options.onRendered?.(label, buffer);
    const notes = frames.flatMap(frame => frame.notes);
    const shorts = [...new Map(frames.flatMap(frame => (frame.phrase?.composition?.shortPhrases ?? []).map(cell => [cell.id, { ...cell, barTicks: frame.form!.barTicks, sectionStartTick: frame.form!.sectionStartTick }] as const))).values()].filter(cell => cell.endTick <= engine.tick);
    const cues = [...new Map(frames.flatMap(frame => (frame.phrase?.composition?.cues ?? []).filter(cue => cue.ensemble === 'cell').map(cue => [cue.id, cue] as const))).values()];
    const transitions = [...new Map(frames.flatMap(frame => frame.phrase?.composition?.transition ? [[frame.phrase.composition.transition.boundaryTick, frame.phrase.composition.transition] as const] : [])).values()].filter(change => change.boundaryTick < engine.tick);
    const transitionNotes = notes.filter(note => note.id.startsWith('transition:'));
    const leadBreaths = frames.flatMap(frame => frame.phrase?.rests.filter(rest => rest.scope === 'lead') ?? []);
    let peak = 0, sum = 0, invalid = 0, clipped = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const sample of buffer.getChannelData(channel)) {
      if (!Number.isFinite(sample)) { invalid++; continue; }
      peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; if (Math.abs(sample) >= .999) clipped++;
    }
    const rows = transitions.map(change => ({ ...change, attacks: transitionNotes.filter(note => note.tick >= change.startTick && note.tick < change.boundaryTick).length,
      arrival: transitionNotes.some(note => note.tick === change.boundaryTick),
      finalBeatAttacks: transitionNotes.filter(note => note.tick >= change.boundaryTick - 480 && note.tick < change.boundaryTick).length }));
    reports.push({ label, frames: frames.length, musicalSeconds: round(frames.reduce((sum, frame) => sum + frame.duration / 480 * 60 / frame.parameters.tempo, 0)),
      shortPhraseCyclesInEighths: [...new Set(shorts.map(cell => cell.cycleTicks / 240))],
      shortPhrasesAcrossBars: shorts.filter(cell => Math.floor((cell.startTick - cell.sectionStartTick) / cell.barTicks) !== Math.floor((cell.endTick - 1 - cell.sectionStartTick) / cell.barTicks)).length,
      independentNotes: notes.filter(note => note.voice === 8).length,
      independentAnswersDuringForegroundBreaths: notes.filter(note => note.voice === 8 && leadBreaths.some(rest => note.tick < rest.endTick && note.tick + note.duration > rest.startTick && !restAppliesToNote(note, rest))).length,
      cellAttacksAcrossThreeParts: cues.filter(cue => new Set(notes.filter(note => note.tick === cue.tick).map(note => note.part)).size >= 3).length,
      transitionGestures: rows, meanTransitionVelocity: round(mean(transitionNotes.map(note => note.velocity))),
      coreHash: eventHash(tune(notes)), eventHash: eventHash(notes),
      signal: { peak: round(peak), rms: round(Math.sqrt(sum / buffer.length / buffer.numberOfChannels)), invalid, clipped } });
  }
  const checks = {
    independentIdeasSound: reports[0].independentNotes === 0 && reports[1].independentNotes > 0,
    separateBreathing: reports[1].independentAnswersDuringForegroundBreaths > 0,
    crossBarPhrases: reports[1].shortPhrasesAcrossBars > 0 && reports[1].shortPhraseCyclesInEighths.some(length => length % 2 === 1),
    sharedCellAccents: reports[1].cellAttacksAcrossThreeParts > 0,
    sameTuneAcrossTransitionTreatments: reports[1].coreHash === reports[2].coreHash,
    distinctBuildup: reports[2].transitionGestures.reduce((sum, change) => sum + change.attacks, 0) > reports[1].transitionGestures.reduce((sum, change) => sum + change.attacks, 0),
    arrivalsPresent: reports.slice(1).every(report => report.transitionGestures.length && report.transitionGestures.every(change => change.arrival)),
    finiteUnclippedAudio: reports.every(report => !report.signal.invalid && !report.signal.clipped && report.signal.rms > .001 && report.signal.peak < .98),
  };
  return { engineVersion: ENGINE_VERSION, seed, passed: Object.values(checks).every(Boolean), checks, reports,
    method: 'Production Web Audio renders at least 45 frames (61.36 seconds at the default tempo), covering the first section change and at least four bars beyond it. Only completed short phrases and arrivals are counted. Density and rhythmic complexity are fixed at 80% for this comparison. A favors bar-related cells; B introduces independent clocks; C preserves B’s melody and counterline while changing transition energy from 15% to 95%. Gesture names describe the plan; attack counts describe committed events after shared breaks and ensemble merging. A shared break can shorten or replace the final preparation with silence. Event relationships and finite/unclipped waveform presence are checked. These are audible comparison tools, not an assessment of artistic quality.' };
}
