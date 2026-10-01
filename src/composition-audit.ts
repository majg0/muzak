import { renderOffline } from './audio';
import { DEFAULT_COMPOSITION } from './composition';
import { DEFAULT_CONDUCTOR } from './conductor';
import { MusicEngine, eventHash } from './engine';
import { DEFAULT_PARAMETERS } from './parameters';
import { DEFAULT_PHRASING } from './phrasing';
import { ENGINE_VERSION, type Frame, type NoteEvent } from './types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const tidy = (value: number) => Math.round(value * 1e7) / 1e7;
const core = (notes: NoteEvent[]) => notes.filter(note => note.part === 'melody' && note.expression?.role === 'anchor')
  .map(note => [note.tick, note.absolutePitch?.millicents, note.expression?.sourceId]);

function signal(buffer: AudioBuffer) {
  let peak = 0, sum = 0, nonFinite = 0, clipped = 0;
  const windows: number[] = [], width = Math.round(buffer.sampleRate * .1);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let window = 0;
    for (let index = 0; index < data.length; index++) {
      const value = data[index];
      if (!Number.isFinite(value)) { nonFinite++; continue; }
      peak = Math.max(peak, Math.abs(value)); sum += value * value; window += value * value;
      if (Math.abs(value) >= .999) clipped++;
      if (index % width === width - 1) { windows.push(Math.sqrt(window / width)); window = 0; }
    }
  }
  windows.sort((a, b) => a - b);
  const low = windows[Math.floor(windows.length * .1)] ?? 0, high = windows[Math.floor(windows.length * .9)] ?? 0;
  return { peak: tidy(peak), rms: tidy(Math.sqrt(sum / (buffer.length * buffer.numberOfChannels))), nonFinite, clipped,
    dynamicRangeDb: tidy(20 * Math.log10(Math.max(1e-7, high) / Math.max(1e-7, low))) };
}

/** Compare one immutable source with its arranged realization. Several
 * orchestration controls differ together; this is not a single-term ablation. */
export async function auditComposition(options: {
  seed?: string;
  onProgress?: (message: string) => void;
  onRendered?: (label: string, buffer: AudioBuffer) => void;
} = {}) {
  const seed = options.seed ?? 'glass-garden';
  const passages: Frame[][] = [], reports = [];
  for (const arranged of [false, true]) {
    const label = arranged ? 'B · The same theme, embellished and coordinated' : 'A · The theme with restrained delivery';
    options.onProgress?.(`Composing ${label}`);
    const composition = { ...DEFAULT_COMPOSITION, ...(arranged ? {} : { embellishment: 0, cohesion: 0, accent: 0, dynamicRange: 0 }) };
    const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor: { ...DEFAULT_CONDUCTOR, tuningTravel: false },
      phrasing: { ...DEFAULT_PHRASING, composition } });
    const frames: Frame[] = [];
    let end: number | undefined;
    for (let index = 0; index < 384; index++) {
      const frame = engine.step();
      if (end === undefined && frame.form?.role === 'theme') end = frame.form.sectionEndTick;
      if (end !== undefined) frames.push(frame);
      if (end !== undefined && engine.tick >= end) break;
      if (index % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!end || engine.tick < end || !frames.length) throw new Error('No complete opening theme within the bounded audition window.');
    options.onProgress?.(`Rendering ${label}`);
    const buffer = await renderOffline(frames, .65);
    options.onRendered?.(label, buffer);
    const notes = frames.flatMap(frame => frame.notes), lead = notes.filter(note => note.part === 'melody');
    const cues = [...new Map(frames.flatMap(frame => (frame.phrase?.composition?.cues ?? []).map(cue => [cue.id, cue] as const))).values()];
    const liveCues = cues.filter(cue => notes.some(note => note.part === 'melody' && note.tick === cue.tick));
    reports.push({ label, notes: notes.length, musicalSeconds: tidy(frames.reduce((sum, frame) => sum + frame.duration / 480 * 60 / frame.parameters.tempo, 0)),
      anchorNotes: lead.filter(note => note.expression?.role === 'anchor').length,
      ornaments: lead.filter(note => note.expression?.role === 'ornament').length,
      meanAnchorVelocity: tidy(mean(lead.filter(note => note.expression?.role === 'anchor').map(note => note.velocity))),
      meanOrnamentVelocity: tidy(mean(lead.filter(note => note.expression?.role === 'ornament').map(note => note.velocity))),
      structuralCues: liveCues.length,
      cuesAcrossThreeParts: liveCues.filter(cue => new Set(notes.filter(note => note.tick === cue.tick).map(note => note.part)).size >= 3).length,
      explicitSupports: notes.filter(note => note.expression?.role === 'support').length,
      eventHash: eventHash(notes), signal: signal(buffer) });
    passages.push(frames);
  }
  const a = passages[0].flatMap(frame => frame.notes), b = passages[1].flatMap(frame => frame.notes);
  const checks = {
    retainedCorePitchesAndOnsets: eventHash(core(a)) === eventHash(core(b)) && core(a).length > 0,
    addedEmbellishments: reports[1].ornaments > reports[0].ornaments,
    coordinatedSupport: reports[1].explicitSupports > 0 && reports[1].cuesAcrossThreeParts > reports[0].cuesAcrossThreeParts,
    anchorsStrongerThanOrnaments: reports[1].meanAnchorVelocity > reports[1].meanOrnamentVelocity,
    finiteUnclipped: reports.every(report => report.signal.nonFinite === 0 && report.signal.clipped === 0 && report.signal.peak < .98),
    audible: reports.every(report => report.signal.rms > .001),
  };
  return { engineVersion: ENGINE_VERSION, seed, passed: Object.values(checks).every(Boolean), checks, reports,
    method: 'The same complete opening theme is rendered through the production Web Audio rack twice. B enables embellishment, ensemble cohesion, structural accents and dynamic breadth together. The core-note source identities, physical pitches and onset ticks must remain identical; durations and velocities may change. Sparse exact-tick agreements and source relationships are inspected in events; finite samples, clipping, RMS and dynamic range are measured in the actual stereo waveform. This comparison is available for listening and is not a measure of artistic quality.' };
}
