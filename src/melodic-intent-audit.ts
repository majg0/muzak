import { PPQ, type Frame, type NoteEvent } from './types';
import { renderOffline } from './audio';
import { capabilityCases, generateCapabilityStudy } from './capability-audit';
import { degreeToPitch, pitchToHz } from './pitch';
import { MusicEngine } from './engine';
const tidy = (value: number) => Math.round(value * 10000) / 10000;
const mean = (values: number[]) => tidy(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
const quantiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: tidy(sorted[0] ?? 0), p10: tidy(sorted[Math.floor((sorted.length - 1) * .1)] ?? 0),
    median: tidy(sorted[Math.floor((sorted.length - 1) * .5)] ?? 0), p90: tidy(sorted[Math.floor((sorted.length - 1) * .9)] ?? 0), max: tidy(sorted.at(-1) ?? 0) };
};
const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
const histogram = (values: number[], bounds: number[]) => Object.fromEntries(bounds.map((high, index) => {
  const low = index ? bounds[index - 1] : -Infinity;
  return [`${low}<value<=${high}`, values.filter(value => value > low && value <= high).length];
}));

/** Final committed score, separating foreground5 from top harmony3. These
 * metrics are observations, never a beauty score or a hearing claim. */
export function melodicIntentSummary(frames: Frame[]) {
  const notes = frames.flatMap(frame => frame.notes).filter(note => note.absolutePitch);
  const structure = new Map<number, string>();
  for (const frame of frames) for (const note of frame.phrase?.themeCore?.notes ?? []) structure.set(note.startTick, note.role);
  const summarize = (voice: number) => {
    const line = notes.filter(note => note.voice === voice).sort((a, b) => a.tick - b.tick);
    const intervals = line.slice(1).map((note, index) => (note.absolutePitch!.millicents - line[index].absolutePitch!.millicents) / 1000);
    const gaps = line.slice(1).map((note, index) => (note.tick - line[index].tick - line[index].duration) / PPQ);
    const durations = line.map(note => note.duration / PPQ), velocities = line.map(note => note.velocity);
    const leaps = line.flatMap((note, index) => index && Math.abs(intervals[index - 1]) >= 300 ? [{ note, index }] : []);
    const canTie = (note: NoteEvent) => note.timbre === 'strings' || note.articulation === 'connected'
      && ['reed', 'flute', 'brass', 'lead', 'strings'].includes(note.timbre ?? '') || voice === 6;
    const automaticConnections = line.slice(1).filter((note, index) => canTie(note) && note.articulation !== 'detached'
      && line[index].articulation !== 'detached' && !note.endPitch && !line[index].endPitch && note.timbre === line[index].timbre
      && note.tick <= line[index].tick + line[index].duration);
    return { voice, attacks: line.length, intervalCents: quantiles(intervals.map(Math.abs)),
      intervalHistogramCents: histogram(intervals.map(Math.abs), [0, 100.01, 250, 500, 800, Infinity]),
      durationBeats: quantiles(durations), durationHistogramBeats: histogram(durations, [.25, .5, 1, 2, 4, Infinity]),
      onsetGapBeats: quantiles(line.slice(1).map((note, index) => (note.tick - line[index].tick) / PPQ)),
      velocity: quantiles(velocities), uniqueVelocities: new Set(velocities).size,
      overlapConnections: gaps.filter(gap => gap <= 0).length, writtenBreaths: gaps.filter(gap => gap > 0).length,
      gapBeats: quantiles(gaps), articulations: counts(line.map(note => note.articulation ?? 'unspecified')),
      colors: counts(line.map(note => note.timbre ?? 'default')), explicitPitchGlides: line.filter(note => note.endPitch).length,
      legatoReuseCandidates: automaticConnections.length,
      pitchChangingLegatoCandidates: automaticConnections.filter(note => {
        const index = line.indexOf(note); return note.absolutePitch!.millicents !== line[index - 1].absolutePitch!.millicents;
      }).length,
      repeatedPitchLegatoCandidates: automaticConnections.filter(note => {
        const index = line.indexOf(note); return note.absolutePitch!.millicents === line[index - 1].absolutePitch!.millicents;
      }).length,
      leapTargets: { attacks: leaps.length, meanVelocity: mean(leaps.map(item => item.note.velocity)),
        otherMeanVelocity: mean(line.filter((_, index) => !index || Math.abs(intervals[index - 1]) < 300).map(note => note.velocity)),
        meanDurationBeats: mean(leaps.map(item => item.note.duration / PPQ)),
        structuralRoles: counts(leaps.map(item => voice === 5 ? structure.get(item.note.tick) ?? 'surface' : 'accompaniment')),
        stepwiseOppositeRecoveries: leaps.filter(({ index }) => index < intervals.length
          && Math.abs(intervals[index]) <= 250 && intervals[index] * intervals[index - 1] < 0).length },
      nativeRangeMidiEquivalent: line.length ? [tidy(Math.min(...line.map(note => note.absolutePitch!.millicents / 100000))),
        tidy(Math.max(...line.map(note => note.absolutePitch!.millicents / 100000)))] : [],
    };
  };
  return { frameCount: frames.length, startTick: frames[0]?.tick ?? 0,
    endTick: frames.at(-1) ? frames.at(-1)!.tick + frames.at(-1)!.duration : 0,
    foreground: summarize(5), topHarmony: summarize(3) };
}

function pcmSignal(buffer: AudioBuffer) {
  let sum = 0, peak = 0, nonFinite = 0, clipped = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const value of buffer.getChannelData(channel)) {
    if (!Number.isFinite(value)) { nonFinite++; continue; }
    sum += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= .999) clipped++;
  }
  return { peak: tidy(peak), rmsIncludingTail: tidy(Math.sqrt(sum / (buffer.length * buffer.numberOfChannels))), nonFinite, clipped };
}

/** Short-window spectral projection discriminates immediate arrival from the
 * former50-ms portamento at60BPM. The frequency search does not assume the
 * target already won. This includes the real rack's filter, compressor and FX. */
function frequencyInWindow(buffer: AudioBuffer, start: number, low: number, high: number, length = 1024) {
  const data = buffer.getChannelData(0), offset = Math.round(start * buffer.sampleRate);
  const window = Float64Array.from({ length }, (_, i) => data[offset + i] * .5 * (1 - Math.cos(2 * Math.PI * i / (length - 1))));
  let bestHz = low, bestPower = -Infinity;
  for (let hz = low; hz <= high; hz += .5) {
    const angle = -2 * Math.PI * hz / buffer.sampleRate, c = Math.cos(angle), s = Math.sin(angle);
    let real = 1, imaginary = 0, totalReal = 0, totalImaginary = 0;
    for (const value of window) {
      totalReal += value * real; totalImaginary += value * imaginary;
      const next = real * c - imaginary * s; imaginary = real * s + imaginary * c; real = next;
    }
    const power = totalReal ** 2 + totalImaginary ** 2;
    if (power > bestPower) { bestPower = power; bestHz = hz; }
  }
  return { measuredHz: tidy(bestHz), startSeconds: start, endSeconds: tidy(start + length / buffer.sampleRate) };
}

export async function auditMelodicIntent(options: {
  seed?: string; study?: string; onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer, frames?: Frame[]) => void | Promise<void>;
} = {}) {
  const item = capabilityCases(options.seed ?? 'glass-garden').find(candidate => candidate.id === (options.study ?? 'developing-solo'));
  if (!item) throw new Error('Choose one of the six composition studies.');
  const recipe = item.recipe;
  const engine = new MusicEngine({ seed: recipe.seed, parameters: recipe.initialParameters, sound: recipe.sound,
    conductor: recipe.conductor, phrasing: recipe.phrasing, weights: recipe.weights });
  const history: Frame[] = [];
  for (let index = 0; index < 128; index++) {
    history.push(engine.step());
    if (index % 8 === 7) { options.onProgress?.(`Measuring actual foreground and harmony · ${index + 1}/128 frames`); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  const score = melodicIntentSummary(history), excerpt = await generateCapabilityStudy(recipe, options.onProgress);
  options.onProgress?.('Rendering the complete opening argument and its isolated foreground');
  const mix = await renderOffline(excerpt.frames, .65), fullSignal = pcmSignal(mix);
  await options.onRendered?.(`${item.label} · complete opening argument · full mix`, mix, excerpt.frames);
  const leadFrames = excerpt.frames.map(frame => ({ ...frame, notes: frame.notes.filter(note => note.voice === 5) }));
  const lead = await renderOffline(leadFrames, .65), leadSignal = pcmSignal(lead);
  await options.onRendered?.(`${item.label} · actual written foreground only`, lead, leadFrames);

  options.onProgress?.('Measuring immediate native legato arrival and an explicitly written glide');
  const base = history[0], origin = degreeToPitch('19edo', 0), destination = degreeToPitch('19edo', 12);
  const probe: Frame = { ...base, tick: 0, duration: 960, phrase: undefined, sound: { ...base.sound, instrument: 'ensemble', tuning: '19edo' },
    parameters: { ...base.parameters, tempo: 60 }, notes: [] };
  const common = { voice: 5, part: 'melody' as const, velocity: .65, timbre: 'reed' as const,
    articulation: 'connected' as const, expression: { role: 'anchor' as const, sourceId: 'native-arrival-probe' } };
  const exact: Frame = { ...probe, notes: [
    { ...common, id: 'connected-before', tick: 0, duration: 510, absolutePitch: origin },
    { ...common, id: 'connected-target', tick: 480, duration: 480, absolutePitch: destination },
  ] };
  const intentional: Frame = { ...probe, notes: [{ ...common, id: 'written-glide', tick: 0, duration: 960,
    absolutePitch: origin, endPitch: destination, glideTicks: 480 }] };
  const exactPcm = await renderOffline([exact], .65), glidePcm = await renderOffline([intentional], .65);
  const fromHz = pitchToHz(origin), targetHz = pitchToHz(destination), early = frequencyInWindow(exactPcm, 1.004, fromHz * .9, targetHz * 1.05);
  const glideMid = frequencyInWindow(glidePcm, .24, fromHz * .9, targetHz * 1.05);
  const midpoint = (glideMid.startSeconds + glideMid.endSeconds) / 2;
  const midExpectedHz = fromHz * (targetHz / fromHz) ** midpoint;
  const arrived = frequencyInWindow(glidePcm, 1.1, fromHz * .9, targetHz * 1.05, 4096);
  await options.onRendered?.('Controlled native legato · exact written target at onset', exactPcm, [exact]);
  await options.onRendered?.('Controlled native glide · only the explicit score requests sliding', glidePcm, [intentional]);
  const probes = { targetHz: tidy(targetHz), ordinaryLegato: { ...early, errorCents: tidy(1200 * Math.log2(early.measuredHz / targetHz)) },
    explicitGlideMidpoint: { ...glideMid, expectedHz: tidy(midExpectedHz), errorCents: tidy(1200 * Math.log2(glideMid.measuredHz / midExpectedHz)) },
    explicitGlideArrival: { ...arrived, errorCents: tidy(1200 * Math.log2(arrived.measuredHz / targetHz)) },
    signals: [pcmSignal(exactPcm), pcmSignal(glidePcm)] };
  const checks = { excerptExactlyReplays: excerpt.exactReplay,
    ordinaryLegatoArrivesImmediately: Math.abs(probes.ordinaryLegato.errorCents) < 25,
    explicitGlideStillTravels: Math.abs(probes.explicitGlideMidpoint.errorCents) < 25 && glideMid.measuredHz < targetHz * .9,
    explicitGlideArrives: Math.abs(probes.explicitGlideArrival.errorCents) < 5,
    finiteUnclipped: [fullSignal, leadSignal, ...probes.signals].every(signal => signal.nonFinite === 0 && signal.clipped === 0 && signal.peak < .98),
    measurableLead: leadSignal.rmsIncludingTail > .001 };
  return { seed: recipe.seed, study: item.id, method: '128 actual committed frames, with foreground5 separate from top harmony3. Full mix/foreground players retain complete first argument windows. Separate controlled native19-EDO probes measure the first4–27ms after a legato target and the midpoint/arrival of an explicit one-second glide. PCM capability measurements do not establish musical taste.',
    score, excerpt: { startTick: excerpt.startTick, endTick: excerpt.endTick, score: melodicIntentSummary(excerpt.frames), fullSignal, leadSignal },
    probes, checks, passed: Object.values(checks).every(Boolean) };
}
