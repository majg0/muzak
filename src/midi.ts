import { ENGINE_VERSION, PPQ, type Frame, type NoteEvent } from './types';
import { pitchToMidi } from './pitch';
import { restAppliesToNote } from './phrasing';

type MidiEvent = { tick: number; order: number; bytes: number[] };
const encoder = new TextEncoder();
const ascii = (text: string) => Array.from(encoder.encode(text));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

function variableLength(n: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0x0fffffff) throw new RangeError('MIDI event time is outside the supported range.');
  const bytes = [n & 127];
  while ((n = Math.floor(n / 128)) > 0) bytes.unshift((n & 127) | 128);
  return bytes;
}

function meta(tick: number, type: number, payload: number[], order = 0): MidiEvent {
  return { tick, order, bytes: [255, type, ...variableLength(payload.length), ...payload] };
}

function makeTrack(name: string, events: MidiEvent[], endTick: number): number[] {
  const ordered = [meta(0, 3, ascii(name), -10), ...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let previousTick = 0;
  for (const event of ordered) {
    data.push(...variableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  data.push(...variableLength(Math.max(0, endTick - previousTick)), 255, 47, 0);
  return [...ascii('MTrk'), ...u32(data.length), ...data];
}

const colorPrograms = { keys: 4, glass: 11, reed: 71, pluck: 12, round: 33, strings: 48, flute: 73, brass: 61, lead: 80 };

/** Standard MIDI File, type 1, with a tempo map and independently editable voices.
 * Ticks are engine PPQ ticks. The selected interval is rebased to zero; sustained
 * notes crossing its boundaries are clipped and retriggered at the start.
 */
export function exportMidi(frames: Frame[], startTick = 0, endTick?: number): Uint8Array {
  if (!Number.isSafeInteger(startTick) || startTick < 0) throw new RangeError('Start must be a non-negative integer tick.');
  if (frames.some(frame => frame.sound.tuning !== '12tet')) throw new Error('Standard MIDI export supports 12-TET only. Export performance JSON to preserve native microtonal pitches exactly.');
  if (frames.some(frame => frame.notes.some(note => note.endPitch !== undefined || note.glideTicks !== undefined))) {
    throw new Error('Standard MIDI export cannot preserve these pitch glides. Export performance JSON to keep the complete pitch trajectories.');
  }
  const midiPitch = (note: NoteEvent): number => {
    const pitch = note.part === 'percussion' ? note.midiNote : note.absolutePitch ? pitchToMidi(note.absolutePitch) : note.midiNote;
    if (pitch === undefined || !Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
      throw new Error('Standard MIDI cannot represent this pitch exactly. Export performance JSON to preserve fractional pitches.');
    }
    return pitch;
  };
  // Validate the full supplied material before exporting: never silently round
  // an absolute microtonal pitch through an optional MIDI adapter.
  for (const frame of frames) for (const note of frame.notes) midiPitch(note);
  const hasSolo = frames.some(frame => frame.notes.some(note => note.part === 'melody' && note.voice === 6));
  const hasCounter = frames.some(frame => frame.notes.some(note => note.part === 'melody' && note.voice === 7));
  const hasLayer = frames.some(frame => frame.notes.some(note => note.part === 'melody' && note.voice === 8));
  const extraVoices = [...new Set(frames.flatMap(frame => frame.notes.filter(note => note.part !== 'percussion' && note.voice >= 10).map(note => note.voice)))].sort((a, b) => a - b);
  if (extraVoices.some(voice => !Number.isInteger(voice) || voice > 15)) throw new Error('This ensemble exceeds the supported independent MIDI channels. Export performance JSON.');
  const channels = [0, 1, 2, 3, 4, 5, ...(hasSolo ? [6] : []), ...(hasCounter ? [7] : []), ...(hasLayer ? [8] : []), ...extraVoices, 9];
  const names = ['Inner voice I', 'Inner voice II', 'Inner voice III', 'Upper voice', 'Round bass', 'Melodic theme',
    ...(hasSolo ? ['Solo voice'] : []), ...(hasCounter ? ['Counter voice'] : []), ...(hasLayer ? ['Independent answer'] : []),
    ...extraVoices.map(voice => ({ 10: 'Cello support', 11: 'Woodwind theme', 12: 'Brass support', 13: 'Upper strings', 14: 'Keyboard figure' }[voice] ?? `Ensemble voice ${voice}`)), 'Percussion'];
  const programs = [4, 4, 4, 4, 33, 11, ...(hasSolo ? [71] : []), ...(hasCounter ? [11] : []), ...(hasLayer ? [11] : []), ...extraVoices.map(() => 48), 0];
  const pans = [42, 56, 72, 86, 64, 70, ...(hasSolo ? [54] : []), ...(hasCounter ? [91] : []), ...(hasLayer ? [37] : []), ...extraVoices.map(voice => [25, 88, 46, 105, 40][(voice - 10) % 5]), 64];
  const trackForNote = (note: NoteEvent) => note.part !== 'percussion' && note.voice >= 10 ? channels.indexOf(note.voice)
    : note.part === 'harmony' ? clamp(Math.round(note.voice), 0, 3)
    : note.part === 'bass' ? 4 : note.part === 'percussion' ? channels.length - 1
      : note.voice === 6 && hasSolo ? 6 : note.voice === 7 && hasCounter ? 6 + Number(hasSolo) : note.voice === 8 && hasLayer ? 6 + Number(hasSolo) + Number(hasCounter) : 5;
  const ordered = [...frames].sort((a, b) => a.tick - b.tick);
  const lastTick = ordered.reduce((end, frame) => Math.max(end, frame.tick + frame.duration,
    ...frame.notes.map(note => note.tick + note.duration)), startTick);
  const end = endTick ?? lastTick;
  if (!Number.isSafeInteger(end) || end < startTick) throw new RangeError('End must follow the start.');
  const length = end - startTick;
  const tempoEvents: MidiEvent[] = [meta(0, 1, ascii(`Continuum · ${ENGINE_VERSION}`))];
  const framesBeforeStart = ordered.filter(frame => frame.tick <= startTick);
  const initialFrame = framesBeforeStart.at(-1) ?? ordered[0];
  let previousMeter = '', previousSection = '';
  const addForm = (frame: Frame | undefined, initial = false) => {
    const form = frame?.form;
    const meter = form?.meter ?? { numerator: 4, denominator: 4 };
    const meterKey = `${meter.numerator}/${meter.denominator}`;
    const tick = initial ? 0 : Math.max(0, (form?.sectionStartTick ?? frame?.tick ?? startTick) - startTick);
    if (meterKey !== previousMeter) {
      tempoEvents.push(meta(tick, 88, [meter.numerator, Math.log2(meter.denominator), 96 / meter.denominator, 8]));
      previousMeter = meterKey;
    }
    const sectionKey = form ? `${form.sectionIndex}/${form.sectionStartTick}` : '';
    if (form && sectionKey !== previousSection) {
      tempoEvents.push(meta(tick, 6, ascii(`${form.sectionIndex + 1}. ${form.sectionName}`)));
      previousSection = sectionKey;
    }
  };
  addForm(initialFrame, true);
  let previousTempo = 0;
  const addTempo = (tick: number, bpm: number) => {
    const microseconds = Math.round(60_000_000 / clamp(bpm, 20, 300));
    if (microseconds === previousTempo) return;
    tempoEvents.push(meta(tick, 81, [(microseconds >>> 16) & 255, (microseconds >>> 8) & 255, microseconds & 255]));
    previousTempo = microseconds;
  };
  addTempo(0, initialFrame?.parameters.tempo ?? 84);
  for (const frame of ordered) if (frame.tick > startTick && frame.tick < end) {
    addTempo(frame.tick - startTick, frame.parameters.tempo);
    addForm(frame);
  }

  const noteTracks: MidiEvent[][] = channels.map((channel, i) => channel === 9 ? [] : [
    { tick: 0, order: -5, bytes: [0xc0 | channel, programs[i]] },
    { tick: 0, order: -4, bytes: [0xb0 | channel, 10, pans[i]] },
  ]);
  const lastPrograms = [...programs];
  const noteIntervals = new Map<string, { track: number; channel: number; pitch: number; intervals: Array<{ begin: number; finish: number; velocity: number; program: number }> }>();
  const realized = ordered.flatMap(frame => frame.notes.map(note => ({ note, monophonicLine: frame.sound.instrument === 'ensemble' && (note.part === 'bass' || note.part === 'melody') })))
    .sort((a, b) => a.note.tick - b.note.tick || a.note.voice - b.note.voice);
  const nextBassOnset = new Map<number, number>();
  for (let i = realized.length - 1; i >= 0; i--) {
    const item = realized[i];
    if (!item.monophonicLine) continue;
    const next = nextBassOnset.get(item.note.voice);
    if (next !== undefined && item.note.tick + item.note.duration > next) item.note = { ...item.note, duration: Math.max(0, next - item.note.tick) };
    nextBassOnset.set(item.note.voice, item.note.tick);
  }
  // A later live player exit can release an earlier committed hold. Export
  // applies the same declared rests as audio, without rewriting stored frames.
  const rests = [...new Map(ordered.flatMap(frame => frame.phrase?.rests ?? [])
    .map(rest => [`${rest.startTick}/${rest.endTick}/${rest.scope}/${rest.voices?.join(',')}`, rest])).values()]
    .sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const restLanes = new Map<string, { rests: typeof rests; index: number }>();
  for (const item of realized) {
    const key = `${item.note.part}/${item.note.voice}`;
    let lane = restLanes.get(key);
    if (!lane) { lane = { rests: rests.filter(rest => restAppliesToNote(item.note, rest)), index: 0 }; restLanes.set(key, lane); }
    while (lane.index < lane.rests.length && lane.rests[lane.index].endTick <= item.note.tick) lane.index++;
    const rest = lane.rests[lane.index];
    if (rest && rest.startTick < item.note.tick + item.note.duration) {
      item.note = { ...item.note, duration: Math.max(0, rest.startTick - item.note.tick) };
    }
  }
  // The ensemble's bass is one physical line: a new attack replaces its old
  // hold, including repeated pitches. Trim before pitch grouping and slicing
  // so overlap merging cannot turn those attacks into a sustained MIDI note.
  // Matched additive sonorities retain their original declared durations.
  for (const { note } of realized) {
    if (note.tick >= end || note.tick + note.duration <= startTick || note.duration <= 0) continue;
    const track = trackForNote(note);
    const channel = channels[track];
    const pitch = midiPitch(note);
    const velocity = Math.round(clamp(note.velocity * 127, 1, 127));
    const begin = Math.max(startTick, Math.round(note.tick)) - startTick;
    const finish = Math.min(end, Math.round(note.tick + note.duration)) - startTick;
    if (finish <= begin) continue;
    const program = note.timbre ? colorPrograms[note.timbre] : programs[track];
    if (channel !== 9 && lastPrograms[track] !== program) {
      noteTracks[track].push({ tick: begin, order: -3, bytes: [0xc0 | channel, program] });
      lastPrograms[track] = program;
    }
    const key = `${track}/${pitch}`;
    const group = noteIntervals.get(key) ?? { track, channel, pitch, intervals: [] };
    group.intervals.push({ begin, finish, velocity, program }); noteIntervals.set(key, group);
  }
  for (const { track, channel, pitch, intervals } of noteIntervals.values()) {
    intervals.sort((a, b) => a.begin - b.begin);
    const merged: typeof intervals = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      // Repeated common tones overlap slightly in the engine. Merge them so a
      // late note-off cannot inadvertently terminate a newer identical pitch.
      if (previous && previous.finish > interval.begin && previous.program === interval.program) previous.finish = Math.max(previous.finish, interval.finish);
      else if (previous && previous.finish > interval.begin) { previous.finish = interval.begin; merged.push({ ...interval }); }
      else merged.push({ ...interval });
    }
    for (const { begin, finish, velocity } of merged) {
      if (finish <= begin) continue;
      noteTracks[track].push({ tick: begin, order: 2, bytes: [0x90 | channel, pitch, velocity] });
      noteTracks[track].push({ tick: finish, order: 1, bytes: [0x80 | channel, pitch, 0] });
    }
  }
  const result = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(channels.length + 1), ...u16(PPQ)];
  // Append in modest chunks: a long performance can exceed argument limits if
  // an entire track is spread into push() at once.
  for (const track of [makeTrack('Conductor / tempo', tempoEvents, length), ...noteTracks.map((events, i) => makeTrack(names[i], events, length))]) {
    for (const byte of track) result.push(byte);
  }
  return new Uint8Array(result);
}
