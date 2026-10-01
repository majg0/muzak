import assert from 'node:assert/strict';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING, envelopeAt, type PhraseCell } from '../src/phrasing';
import { gainEnvelopeAt } from '../src/note-expression';
import type { Pitch } from '../src/pitch';
import { ENGINE_VERSION, FRAME_TICKS, PPQ, type Frame, type NoteEvent } from '../src/types';

// This audit measures committed musical events, not PCM or perceived quality.
// In particular its held-gain proxy excludes instrument spectra, attack/release
// envelopes, compression, effects and the short physical replacement crossfade.
const round = (value: number) => Math.round(value * 1000) / 1000;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const fraction = (count: number, total: number) => total ? round(count / total) : null;
const quantile = (values: number[], amount: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? round(sorted[Math.round((sorted.length - 1) * amount)]) : null;
};
const compare = (a: NoteEvent, b: NoteEvent) => a.tick - b.tick || a.voice - b.voice || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const destination = (note: NoteEvent) => note.endPitch ?? note.absolutePitch;
const inside = (note: NoteEvent, cell: PhraseCell) => note.tick >= cell.startTick && note.tick < cell.endTick;
const isQuote = (cell: PhraseCell) => cell.role === 'solo' && ['Quote the theme', 'Recognize the theme again'].includes(cell.label);
const distance = (pitch: Pitch, guides: Pitch[]) => guides.length ? Math.min(...guides.map(guide => {
  const difference = ((pitch.millicents - guide.millicents) % 1_200_000 + 1_200_000) % 1_200_000;
  return Math.min(difference, 1_200_000 - difference) / 1000;
})) : null;
const pitchAt = (note: NoteEvent, tick: number): Pitch => {
  const start = note.absolutePitch!;
  if (!note.endPitch) return start;
  const progress = Math.max(0, Math.min(1, (tick - note.tick) / (note.glideTicks ?? note.duration)));
  return { millicents: Math.round(start.millicents + (note.endPitch.millicents - start.millicents) * progress) };
};

/** Approximate the physical upper-voice replacement policy, with bass attacks
 * retained until their written gate ends. Excludes release/ambience tails. */
function activeAt(notes: NoteEvent[], tick: number): NoteEvent[] {
  const upper = new Map<number, NoteEvent>();
  const others: NoteEvent[] = [];
  for (const note of notes) {
    if (note.tick > tick) break;
    // A later upper attack replaces an earlier hold even when its own short
    // gate has ended; the older hold must never silently become audible again.
    if (note.part === 'harmony') upper.set(note.voice, note);
    else if (note.tick + note.duration > tick) others.push(note);
  }
  return [...others, ...[...upper.values()].filter(note => note.tick + note.duration > tick)];
}

function heldGains(frames: Frame[], notes: NoteEvent[]) {
  const perFrame = new Map<number, number>();
  let cursor = 0, active: NoteEvent[] = [];
  for (const frame of frames) {
    const samples: number[] = [];
    for (let tick = frame.tick; tick < frame.tick + frame.duration; tick += PPQ / 4) {
      while (cursor < notes.length && notes[cursor].tick <= tick) {
        const note = notes[cursor++];
        if (note.part === 'harmony') active = active.filter(previous => previous.part !== 'harmony' || previous.voice !== note.voice);
        active.push(note);
      }
      active = active.filter(note => note.tick + note.duration > tick);
      samples.push(active.reduce((sum, note) => sum + (note.velocity * gainEnvelopeAt(note.gainEnvelope, tick - note.tick)) ** 2, 0));
    }
    perFrame.set(frame.index, mean(samples));
  }
  return perFrame;
}

function ensembleSummary(frames: Frame[], gains: Map<number, number>, effectiveGates: Map<string, number>) {
  const notes = frames.flatMap(frame => frame.notes);
  const upper = notes.filter(note => note.part === 'harmony');
  const beats = frames.reduce((sum, frame) => sum + frame.duration / PPQ, 0);
  const intensityAt = (frame: Frame) => {
    const phrase = frame.phrase!;
    return envelopeAt(phrase.envelopes.find(envelope => envelope.key === 'intensity')!.realized,
      (frame.tick - phrase.startTick) / (phrase.endTick - phrase.startTick));
  };
  return { frames: frames.length, quarterBeats: beats,
    attacksPerQuarterBeat: round(notes.length / Math.max(1, beats)),
    upperAttacksPerQuarterBeat: round(upper.length / Math.max(1, beats)),
    meanWrittenVelocity: round(mean(notes.map(note => note.velocity))),
    meanHeldGainSquaredProxy: round(mean(frames.map(frame => gains.get(frame.index)!))),
    upperMedianGateQuarterBeats: quantile(upper.map(note => note.duration / PPQ), .5),
    upperMedianEffectiveGateQuarterBeats: quantile(upper.map(note => effectiveGates.get(note.id)! / PPQ), .5),
    upperEffectiveGate90thPercentileQuarterBeats: quantile(upper.map(note => effectiveGates.get(note.id)! / PPQ), .9),
    upperHoldsOfAtLeastTwoBeats: upper.filter(note => effectiveGates.get(note.id)! >= PPQ * 2).length,
    upperSharedSupports: upper.filter(note => note.expression?.role === 'support').length,
    framesBelowPoint36Intensity: frames.filter(frame => intensityAt(frame) < .36).length,
    sharedSupportsBelowPoint36Intensity: frames.filter(frame => intensityAt(frame) < .36)
      .flatMap(frame => frame.notes).filter(note => note.part === 'harmony' && note.expression?.role === 'support').length,
    meanDynamics: round(mean(frames.map(frame => frame.parameters.dynamics))),
    meanDensity: round(mean(frames.map(frame => frame.parameters.rhythmicDensity))),
  };
}

function quotationSummary(frames: Frame[], notes: NoteEvent[]) {
  const snapshots = [...new Map(frames.filter(frame => frame.phrase).map(frame => [frame.phrase!.startTick, frame.phrase!])).values()];
  const solos = notes.filter(note => note.part === 'melody' && note.voice === 6);
  const quotes = snapshots.flatMap(snapshot => snapshot.cells.filter(isQuote));
  const windows = snapshots.flatMap(snapshot => {
    const cells = snapshot.cells.filter(isQuote).sort((a, b) => a.startTick - b.startTick);
    if (!cells.length) return [];
    const takes = cells.map(cell => {
      const sounded = solos.filter(note => inside(note, cell)).sort(compare);
      const first = sounded.length ? destination(sounded[0])!.millicents : 0;
      // Literal interval sequence, independent of global transposition and
      // expressive timing. Counts come from emitted notes, not cell metadata.
      return { label: cell.label, tick: cell.startTick, attacks: sounded.length,
        intervalFingerprint: sounded.map(note => round((destination(note)!.millicents - first) / 1000)) };
    });
    const initial = takes[0];
    return [{ startTick: snapshot.startTick, endTick: snapshot.endTick, theme: snapshot.themeName,
      quotations: takes.length, heardQuotations: takes.filter(take => take.attacks >= 2).length,
      literalReturns: takes.slice(1).filter(take => take.attacks >= 2 && JSON.stringify(take.intervalFingerprint) === JSON.stringify(initial.intervalFingerprint)).length,
      takes }];
  });
  return { quotes, report: { soloWindows: windows.length,
    windowsWithHeardReturn: windows.filter(window => window.takes.slice(1).some(take => take.attacks >= 2)).length,
    literalIntervalReturns: windows.reduce((sum, window) => sum + window.literalReturns, 0), windows } };
}

function guideFit(frames: Frame[], notes: NoteEvent[], quotes: PhraseCell[]) {
  const guides = notes.filter(note => note.part === 'harmony' || note.part === 'bass');
  const results = notes.filter(note => note.voice === 6 && note.absolutePitch && !quotes.some(cell => inside(note, cell))).map(note => {
    const frame = frames[Math.floor(note.tick / FRAME_TICKS)];
    const pitch = destination(note)!;
    const sustained = activeAt(guides, note.tick).filter(guide => guide.absolutePitch).map(guide => pitchAt(guide, note.tick));
    return { strong: note.expression?.role === 'anchor',
      planned: distance(pitch, [...frame.voicePitches, frame.bassPitch])!,
      nativeStepCents: 1200 / (frame.sound.tuning === '19edo' ? 19 : 12),
      sustained: distance(pitch, sustained), guides: sustained.length,
      tick: note.tick, role: frame.form!.role, pitchCents: pitch.millicents / 1000,
      sustainedGuideCents: sustained.map(guide => round(guide.millicents / 1000)) };
  });
  const summary = (strong: boolean) => {
    const rows = results.filter(row => row.strong === strong);
    const heard = rows.filter(row => row.sustained !== null);
    return { attacks: rows.length,
      plannedFieldMeanDistanceCents: round(mean(rows.map(row => row.planned))),
      plannedFieldWithinOneNativeStep: fraction(rows.filter(row => row.planned <= row.nativeStepCents + .002).length, rows.length),
      withSustainedGuides: heard.length, withoutSustainedGuides: rows.length - heard.length,
      meanSustainedGuideCount: round(mean(heard.map(row => row.guides))),
      sustainedMeanDistanceCents: heard.length ? round(mean(heard.map(row => row.sustained!))) : null,
      sustainedDistance90thPercentileCents: quantile(heard.map(row => row.sustained!), .9),
      ...(strong ? { sparseGuideExamples: heard.filter(row => row.sustained! >= 199).map(row => ({ tick: row.tick, role: row.role,
        pitchCents: row.pitchCents, sustainedGuideCents: row.sustainedGuideCents, plannedDistanceCents: round(row.planned), sustainedDistanceCents: round(row.sustained!) })) } : {}) };
  };
  return { definition: 'Solo anchors outside literal quotations are held apex/arrival notes; ornaments include intentional approaches. Planned-field fit uses composed destinations; sustained fit interpolates native glides at the attack and excludes release/FX tails.',
    strong: summary(true), connecting: summary(false) };
}

function upperMotion(frames: Frame[], upper: NoteEvent[]) {
  const previous = new Map<number, NoteEvent>();
  const jumps: Array<{ tick: number; cents: number; gapTicks: number; role: string }> = [];
  for (const note of upper) {
    const prior = previous.get(note.voice), form = frames[Math.floor(note.tick / FRAME_TICKS)].form!;
    if (prior?.absolutePitch && note.absolutePitch && note.tick >= form.sectionStartTick + FRAME_TICKS
      && !note.endPitch && prior.timbre === note.timbre) {
      jumps.push({ tick: note.tick, cents: Math.abs(note.absolutePitch.millicents - pitchAt(prior, note.tick).millicents) / 1000,
        gapTicks: Math.max(0, note.tick - prior.tick - prior.duration), role: form.role });
    }
    previous.set(note.voice, note);
  }
  const connected = jumps.filter(jump => jump.gapTicks <= PPQ / 2);
  return { definition: 'Successive same-timbre upper attacks inside a section; excludes explicit glides. Connected means the written gap is at most half a quarter beat.',
    connectedAttacks: connected.length, medianCents: quantile(connected.map(jump => jump.cents), .5),
    p90Cents: quantile(connected.map(jump => jump.cents), .9), maximumCents: quantile(connected.map(jump => jump.cents), 1),
    jumpsOverFifth: connected.filter(jump => jump.cents > 700).length,
    largest: [...connected].sort((a, b) => b.cents - a.cents).slice(0, 6).map(jump => ({ ...jump, cents: round(jump.cents) })) };
}

function glideSummary(frames: Frame[], notes: NoteEvent[]) {
  const glides = notes.filter(note => note.endPitch && note.absolutePitch && note.endPitch.millicents !== note.absolutePitch.millicents);
  const interior = glides.filter(note => note.tick >= frames[Math.floor(note.tick / FRAME_TICKS)].form!.sectionStartTick + FRAME_TICKS);
  const phases = [0, 0, 0, 0];
  for (const note of interior) {
    const form = frames[Math.floor(note.tick / FRAME_TICKS)].form!;
    phases[Math.min(3, Math.floor((note.tick - form.sectionStartTick) / (form.sectionEndTick - form.sectionStartTick) * 4))]++;
  }
  return { all: glides.length, withinSection: interior.length, firstSectionFrame: glides.length - interior.length,
    interiorBySectionQuarter: phases,
    interiorByPart: Object.fromEntries(['harmony', 'bass', 'melody'].map(part => [part, interior.filter(note => note.part === part).length])),
    interiorMedianCents: quantile(interior.map(note => Math.abs(note.endPitch!.millicents - note.absolutePitch!.millicents) / 1000), .5),
    interiorMedianQuarterBeats: quantile(interior.map(note => (note.glideTicks ?? note.duration) / PPQ), .5) };
}

const cases = [];
for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
  const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
  const frames: Frame[] = [];
  let elapsed = 0, finished = false;
  for (let index = 0; index < 1400; index++) {
    const started = performance.now(), frame = engine.step();
    elapsed += performance.now() - started;
    if (frame.form!.cycle !== 0) { finished = true; break; }
    frames.push(frame);
  }
  assert.ok(finished && frames.length, `${seed}: audit must include a complete first narrative`);
  const notes = frames.flatMap(frame => frame.notes).sort(compare);
  assert.ok(notes.every(note => Number.isSafeInteger(note.tick) && Number.isSafeInteger(note.duration) && note.duration > 0 && Number.isFinite(note.velocity)), `${seed}: events must be finite integer-time notes`);
  assert.ok(notes.every(note => !note.gainEnvelope || note.gainEnvelope.every((point, index, points) => Number.isSafeInteger(point.tick)
    && point.tick >= 0 && point.tick <= note.duration && Number.isFinite(point.gain) && point.gain >= 0 && point.gain <= 1
    && (index === 0 || point.tick > points[index - 1].tick))), `${seed}: committed gain trajectories must be bounded by the final gate`);
  const tempoValues = [...new Set(frames.map(frame => frame.parameters.tempo))];
  assert.deepEqual(tempoValues, [DEFAULT_PARAMETERS.tempo], `${seed}: autonomous expression must keep the chosen BPM`);
  const gains = heldGains(frames, notes);
  const calm = frames.filter(frame => ['intro', 'breakdown'].includes(frame.form!.role));
  const peak = frames.filter(frame => frame.form!.role === 'climax');
  assert.ok(calm.length && peak.length, `${seed}: the route must expose both calm and peak sections`);
  const upper = notes.filter(note => note.part === 'harmony');
  const nextByVoice = new Map<number, number>(), effectiveGates = new Map<string, number>();
  for (const note of [...upper].reverse()) {
    effectiveGates.set(note.id, Math.min(note.duration, (nextByVoice.get(note.voice) ?? Infinity) - note.tick));
    nextByVoice.set(note.voice, note.tick);
  }
  const quotes = quotationSummary(frames, notes);
  const sectionFrames = [...new Map(frames.map(frame => [frame.form!.sectionIndex, frame])).values()];
  cases.push({ seed, frames: frames.length, seconds: round(frames.reduce((sum, frame) => sum + frame.duration / PPQ * 60 / frame.parameters.tempo, 0)),
    millisecondsPerFrame: round(elapsed / (frames.length + 1)), tempoValues, eventHash: eventHash(notes),
    calm: ensembleSummary(calm, gains, effectiveGates), peak: ensembleSummary(peak, gains, effectiveGates),
    sections: sectionFrames.map(first => ({ role: first.form!.role, index: first.form!.sectionIndex,
      ...ensembleSummary(frames.filter(frame => frame.form!.sectionIndex === first.form!.sectionIndex), gains, effectiveGates) })),
    upperArticulation: { attacks: upper.length, distinctGateTicks: new Set(upper.map(note => note.duration)).size,
      onsetPhasesWithinPlanningFrame: [...new Set(upper.map(note => note.tick % FRAME_TICKS))].sort((a, b) => a - b),
      gateQuarterBeats: { p10: quantile(upper.map(note => note.duration / PPQ), .1), median: quantile(upper.map(note => note.duration / PPQ), .5), p90: quantile(upper.map(note => note.duration / PPQ), .9) },
      writtenSweeps: upper.filter(note => note.id.endsWith(':sweep')).length,
      writtenFigures: upper.filter(note => note.id.endsWith(':figure')).length,
      writtenFlights: upper.filter(note => note.id.endsWith(':flight')).length,
      sharedSupports: upper.filter(note => note.expression?.role === 'support').length,
      gainTrajectories: upper.filter(note => note.gainEnvelope).length,
      motion: upperMotion(frames, upper) },
    glides: glideSummary(frames, notes), quotations: quotes.report, guideFit: guideFit(frames, notes, quotes.quotes) });
}

console.log(JSON.stringify({ engineVersion: ENGINE_VERSION,
  scope: 'Complete first narratives with default ensemble, conductor and phrasing; symbolic event analysis, not listening or PCM loudness.',
  heldGainProxy: 'Mean sampled sum of (velocity × written gain)² across active notes, 120-tick spacing; upper attacks replace their own prior voice. Excludes timbre, attack/release envelopes, effects and physical crossfades.',
  cases }, null, 2));
