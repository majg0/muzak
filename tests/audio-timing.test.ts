import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayer, renderOffline, ensemblePartials } from '../src/audio';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_SOUND } from '../src/spectrum';
import { degreeToPitch, midiToPitch, pitchToHz } from '../src/pitch';
import { MusicEngine } from '../src/engine';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_PHRASING } from '../src/phrasing';
import type { Frame, NoteEvent } from '../src/types';

// This records the actual Web Audio scheduling calls made by the live player
// and offline rack, without relying on wall-clock sleeps or an audio device.
class Parameter {
  value = 0;
  events: Array<{ kind: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time = 0) { this.events.push({ kind: 'set', value, time }); this.value = value; return this; }
  setTargetAtTime(value: number) { this.value = value; return this; }
  linearRampToValueAtTime(value: number, time = 0) { this.events.push({ kind: 'linear', value, time }); this.value = value; return this; }
  exponentialRampToValueAtTime(value: number, time = 0) { this.events.push({ kind: 'exponential', value, time }); this.value = value; return this; }
  cancelAndHoldAtTime(time = 0) { this.events.push({ kind: 'hold', value: this.value, time }); return this; }
  cancelScheduledValues(time = 0) { this.events.push({ kind: 'cancel', value: this.value, time }); return this; }
}
class Node {
  gain = new Parameter(); frequency = new Parameter(); pan = new Parameter(); Q = new Parameter(); delayTime = new Parameter();
  threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
  type = ''; buffer: unknown; fftSize = 256; onended?: () => void;
  starts: number[] = []; stops: number[] = [];
  connections: Node[] = [];
  disconnections = 0;
  connect(node: Node) { this.connections.push(node); return node; }
  disconnect() { this.disconnections++; }
  start(time: number) { this.starts.push(time); }
  stop(time = 0) { this.stops.push(time); }
  getFloatTimeDomainData(data: Float32Array) { data.fill(0); }
}
class Buffer {
  private data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.data[channel]; }
}
class Context {
  static latest: Context;
  currentTime = 0; sampleRate = 44100; state = 'suspended'; destination = new Node(); oscillators: Node[] = []; bufferSources: Node[] = []; analysers: Node[] = [];
  onstatechange: (() => void) | null = null;
  resumeCalls = 0;
  gains: Node[] = [];
  constructor() { Context.latest = this; }
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createAnalyser() { const node = new Node(); this.analysers.push(node); return node; }
  createDynamicsCompressor() { return new Node(); }
  createBiquadFilter() { return new Node(); } createStereoPanner() { return new Node(); } createDelay() { return new Node(); }
  createConvolver() { return new Node(); }
  createBufferSource() { const node = new Node(); this.bufferSources.push(node); return node; }
  createBuffer(channels: number, length: number, rate: number) { return new Buffer(channels, length, rate); }
  createOscillator() { const node = new Node(); this.oscillators.push(node); return node; }
  transition(state: string) { this.state = state; this.onstatechange?.(); }
  async resume() { this.resumeCalls++; this.transition('running'); }
  async suspend() { this.transition('suspended'); }
  async close() { this.transition('closed'); }
}
class OfflineContext extends Context {
  result: Buffer;
  constructor(channels: number, length: number, rate: number) { super(); this.result = new Buffer(channels, length, rate); }
  async startRendering() { return this.result; }
}

const note = (tick: number, duration: number, part: NoteEvent['part'], midi: number, voice: number): NoteEvent => ({
  id: `${part}/${midi}`, tick, duration, part, absolutePitch: midiToPitch(midi), voice, velocity: 0.7,
});
const frame = (tick: number, tempo: number, notes: NoteEvent[], additive = false): Frame => ({
  tick, duration: 960, parameters: { ...DEFAULT_PARAMETERS, tempo }, notes,
  sound: { ...DEFAULT_SOUND, instrument: additive ? 'additive' : 'ensemble' },
} as Frame);

async function compareScheduling(frames: Frame[], expectedEnd: number) {
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const previousOffline = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
  const previousInterval = globalThis.setInterval, previousClear = globalThis.clearInterval;
  let pump: () => void = () => {};
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: OfflineContext });
  globalThis.setInterval = ((callback: () => void) => { pump = callback; return 1; }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  let requested = 0;
  const player = new AudioPlayer({ nextFrame: () => { assert.ok(requested < frames.length, 'Do not pre-generate future frames.'); return frames[requested++]; }, onFrame: () => {} });
  try {
    await player.play();
    const live = Context.latest;
    assert.equal(requested, 1);
    let boundary = 0.075;
    for (let i = 1; i < frames.length; i++) {
      boundary += frames[i - 1].duration * 60 / frames[i - 1].parameters.tempo / 480;
      live.currentTime = boundary - 0.1; pump();
      assert.equal(requested, i + 1, 'Only the frame needed by the normal look-ahead should be requested.');
    }
    const stopFor = (context: Context, pitch: number) => context.oscillators.filter(node => node.frequency.value === pitchToHz(midiToPitch(pitch))).map(node => node.stops.at(-1)!);
    const recordedLive = new Map(frames[0].notes.map(note => [note.id, stopFor(live, note.absolutePitch!.millicents / 100_000)]));
    player.pause(); player.dispose();
    await renderOffline(frames);
    const offline = Context.latest;
    for (const note of frames[0].notes) {
      const padding = frames[0].sound.instrument === 'additive' ? 0.09 : (note.part === 'harmony' ? 0.36 : note.part === 'bass' ? 0.14 : 0.24) + 0.025;
      const liveStops = recordedLive.get(note.id)!;
      const offlineStops = stopFor(offline, note.absolutePitch!.millicents / 100_000);
      assert.ok(liveStops.length > 0);
      for (const stop of liveStops) assert.ok(Math.abs(stop - 0.075 - padding - expectedEnd) < 1e-9, `${note.part} live note-off uses integrated tempo`);
      for (const stop of offlineStops) assert.ok(Math.abs(stop - padding - expectedEnd) < 1e-9, `${note.part} offline note-off uses integrated tempo`);
    }
  } finally {
    player.pause(); player.dispose();
    globalThis.setInterval = previousInterval; globalThis.clearInterval = previousClear;
    if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (previousOffline) Object.defineProperty(globalThis, 'OfflineAudioContext', previousOffline); else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
  }
}

test('live harmony, bass and melody durations integrate an accelerating tempo boundary like offline playback', async () => {
  const notes = [note(1680, 590, 'harmony', 60, 0), note(1680, 590, 'bass', 40, 4), note(1680, 590, 'melody', 80, 5)];
  // From tick960: three seconds to tick1920, then350ticks at180BPM.
  await compareScheduling([frame(960, 40, notes), frame(1920, 180, [])], 3 + 350 / 1440);
});

test('slower future tempo extends already scheduled sources before their old stop', async () => {
  const notes = [note(1680, 590, 'harmony', 60, 0), note(1680, 590, 'bass', 40, 4), note(1680, 590, 'melody', 80, 5)];
  await compareScheduling([frame(960, 180, notes), frame(1920, 40, [])], 960 / 1440 + 350 / 320);
});

test('additive notes retime over several committed boundaries without looking ahead in the engine', async () => {
  const notes = [note(720, 2400, 'harmony', 60, 0), note(720, 2400, 'bass', 40, 4), note(720, 2400, 'melody', 80, 5)];
  await compareScheduling([frame(0, 80, notes, true), frame(960, 180, [], true), frame(1920, 40, [], true)], 960 / 640 + 960 / 1440 + 1200 / 320);
});

async function inspectOffline(frames: Frame[], inspect: (context: Context) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
  Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: OfflineContext });
  try { await renderOffline(frames); inspect(Context.latest); }
  finally { if (previous) Object.defineProperty(globalThis, 'OfflineAudioContext', previous); else Reflect.deleteProperty(globalThis, 'OfflineAudioContext'); }
}

test('log-frequency glides retain native pitches and retime their trajectory across a tempo change', async () => {
  const target = degreeToPitch('19edo', 1);
  const gliding = { ...note(1680, 960, 'harmony', 69, 0), endPitch: target, glideTicks: 590 };
  const endHz = pitchToHz(target), fraction = 240 / 590;
  for (const additive of [false, true]) {
    await inspectOffline([frame(960, 40, [gliding], additive), frame(1920, 180, [], additive)], context => {
      const frequency = context.oscillators[0].frequency;
      const ramp = frequency.events.filter(event => event.kind === 'exponential').at(-1)!;
      assert.ok(Math.abs(ramp.time - (3 + 350 / 1440)) < 1e-9);
      assert.ok(Math.abs(ramp.value - endHz) < 1e-9);
      const boundary = frequency.events.find(event => event.kind === 'set' && event.time === 3)!;
      assert.ok(Math.abs(boundary.value - 440 * (endHz / 440) ** fraction) < 1e-9);
      assert.notEqual(ramp.value, pitchToHz(midiToPitch(70)));
    });
  }
});

test('ensemble colors have distinct oscillator spectra and timbre changes break common-tone ties', async () => {
  const colors = ['keys', 'glass', 'reed', 'pluck', 'round', 'strings', 'flute', 'brass', 'lead'] as const;
  assert.equal(new Set(colors.map(color => JSON.stringify(ensemblePartials(color, 0.5)))).size, colors.length);
  const first = { ...note(0, 990, 'harmony', 60, 0), timbre: 'keys' as const };
  const second = { ...note(960, 990, 'harmony', 60, 0), timbre: 'glass' as const };
  await inspectOffline([frame(0, 88, [first]), frame(960, 88, [second])], context => {
    assert.equal(context.oscillators.length, ensemblePartials('keys', 0.5).length + ensemblePartials('glass', 0.5).length);
  });
  await inspectOffline([frame(0, 88, [first], true), frame(960, 88, [second], true)], context => {
    assert.equal(context.oscillators.length, DEFAULT_SOUND.spectrum.partials.length, 'Additive ignores ensemble colors and retains its shared spectrum.');
  });
});

test('a new glide on a common tone always creates an audible pitch trajectory', async () => {
  const first = note(0, 990, 'harmony', 69, 0);
  const second = { ...note(960, 960, 'harmony', 69, 0), endPitch: degreeToPitch('19edo', 1), glideTicks: 480 };
  await inspectOffline([frame(0, 88, [first]), frame(960, 88, [second])], context => {
    assert.equal(context.oscillators.length, 6);
    assert.ok(context.oscillators[3].frequency.events.some(event => event.kind === 'exponential' && event.value === pitchToHz(second.endPitch)));
  });
});

const phraseRest = (startTick: number, endTick: number, scope: 'lead' | 'ensemble' | 'accompaniment'): NonNullable<Frame['phrase']> => ({
  rests: [{ startTick, endTick, scope, reason: 'Test breath' }],
} as NonNullable<Frame['phrase']>);

test('declared lead rests release theme, solo and counter while accompaniment continues', async () => {
  const notes = [note(0, 1920, 'harmony', 60, 0), note(0, 1920, 'bass', 40, 4),
    note(0, 1920, 'melody', 72, 5), note(0, 1920, 'melody', 80, 6), note(0, 1920, 'melody', 85, 7), note(600, 120, 'melody', 90, 6)];
  const passage = { ...frame(0, 60, notes), phrase: phraseRest(480, 960, 'lead') };
  await inspectOffline([passage], context => {
    for (const midi of [72, 80, 85]) {
      const sources = context.oscillators.filter(item => item.frequency.value === pitchToHz(midiToPitch(midi)));
      assert.ok(sources.some(source => Math.abs(source.stops.at(-1)! - 1.04) < 1e-9));
    }
    for (const midi of [40, 60]) assert.ok(context.oscillators.find(item => item.frequency.value === pitchToHz(midiToPitch(midi)))!.stops.at(-1)! > 4);
    assert.ok(!context.oscillators.some(item => item.frequency.value === pitchToHz(midiToPitch(90))), 'No onset is emitted inside the rest.');
  });
});

test('a new accompaniment rest cuts prior-frame holds and drum hits at the new tempo', async () => {
  const previous = frame(0, 60, [note(0, 1920, 'harmony', 60, 0), note(0, 1920, 'melody', 80, 6)]);
  const kick: NoteEvent = { id: 'kick', tick: 1140, duration: 180, part: 'percussion', voice: 9, midiNote: 36, velocity: 0.6 };
  const next = { ...frame(960, 180, [kick]), phrase: phraseRest(1200, 1500, 'accompaniment') };
  await inspectOffline([previous, next], context => {
    const time = 2 + 240 / 1440;
    const harmony = context.oscillators.find(item => item.frequency.value === pitchToHz(midiToPitch(60)))!;
    const solo = context.oscillators.find(item => item.frequency.value === pitchToHz(midiToPitch(80)))!;
    const drum = context.oscillators.find(item => item.frequency.value === 43)!;
    assert.ok(Math.abs(harmony.stops.at(-1)! - time - 0.04) < 1e-9);
    assert.ok(Math.abs(drum.stops.at(-1)! - time - 0.023) < 1e-9);
    assert.ok(solo.stops.at(-1)! > time + 0.3);
  });
});

test('a voice-scoped foreground breath leaves an independent answer sounding, while a shared break ends it', async () => {
  const notes = [{ ...note(0, 1920, 'melody', 72, 5), timbre: 'keys' as const },
    { ...note(0, 1920, 'melody', 67, 8), timbre: 'glass' as const }, note(600, 180, 'melody', 69, 8)];
  const phrase = phraseRest(480, 960, 'lead'); phrase.rests[0].voices = [5, 6, 7];
  await inspectOffline([{ ...frame(0, 60, notes), phrase }], context => {
    const lead = context.oscillators.find(item => item.frequency.value === pitchToHz(midiToPitch(72)))!;
    const independent = context.oscillators.find(item => item.frequency.value === pitchToHz(midiToPitch(67)))!;
    assert.ok(lead.stops.at(-1)! < 1.05);
    assert.ok(independent.stops.at(-1)! > 1.25 && independent.stops.at(-1)! < 1.32,
      'Its own later attack replaces the hold; the lead breath at one second does not cut it.');
    assert.ok(context.oscillators.some(item => item.frequency.value === pitchToHz(midiToPitch(69))), 'The separate line can enter during a foreground breath.');
  });
  await inspectOffline([{ ...frame(0, 60, notes), phrase: phraseRest(480, 960, 'ensemble') }], context => {
    assert.ok(context.oscillators.find(item => item.frequency.value === pitchToHz(midiToPitch(67)))!.stops.at(-1)! < 1.05);
    assert.ok(!context.oscillators.some(item => item.frequency.value === pitchToHz(midiToPitch(69))));
  });
});

test('explicitly coordinated upper-voice accents start at the shared audio subdivision', async () => {
  const cue = [0, 2].map(voice => ({ ...note(360, 180, 'harmony', 60 + voice * 3, voice), expression: { role: 'support' as const, cueId: 'shared-cell' } }));
  await inspectOffline([frame(0, 120, cue)], context => {
    assert.ok(context.oscillators.length > 0);
    assert.ok(context.oscillators.every(source => source.starts[0] === .375));
  });
});

test('a real tick gap never ties old harmony into a new note', async () => {
  await inspectOffline([frame(0, 60, [note(0, 945, 'harmony', 60, 0)]), frame(960, 60, [note(960, 960, 'harmony', 60, 0)])], context => {
    assert.equal(context.oscillators.length, 6);
  });
});

test('very short rests keep releases inside the gap and invalid note durations never schedule audio', async () => {
  const notes = [note(0, 960, 'harmony', 60, 0), note(120, -10, 'melody', 80, 5), note(240, Number.NaN, 'melody', 90, 6)];
  const passage = { ...frame(0, 180, notes, true), phrase: phraseRest(480, 492, 'ensemble') };
  await inspectOffline([passage], context => {
    assert.equal(context.oscillators.length, 5);
    const stop = context.oscillators[0].stops.at(-1)!;
    assert.ok(stop > 480 / 1440 && stop < 492 / 1440);
    assert.ok(context.oscillators.every(item => item.stops.every(Number.isFinite)));
  });
});

test('overlapping ensemble solo notes connect at native pitch without another near-zero attack', async () => {
  const nextPitch = degreeToPitch('19edo', 3);
  const first = { ...note(0, 520, 'melody', 69, 6), timbre: 'reed' as const };
  const next = { ...note(480, 520, 'melody', 69, 6), absolutePitch: nextPitch, timbre: 'reed' as const };
  await inspectOffline([frame(0, 120, [first, next])], context => {
    assert.equal(context.oscillators.length, ensemblePartials('reed', 0.5).length);
    const fundamental = context.oscillators[0];
    const target = fundamental.frequency.events.find(event => event.kind === 'set' && event.value === pitchToHz(nextPitch))!;
    assert.equal(target.time, 0.5);
    assert.ok(!fundamental.frequency.events.some(event => event.kind === 'exponential'), 'Ordinary legato has no undeclared pitch slide.');
    const envelope = fundamental.connections[0].connections[0];
    assert.equal(envelope.gain.events.filter(event => event.kind === 'set' && event.value === 0.0001).length, 1);
    assert.ok(envelope.gain.events.some(event => event.kind === 'linear' && event.time === 0.525 && Math.abs(event.value - .7 * .15 * .88) < 1e-12), 'Legato remains sustained at the revised, 16.7% quieter solo level.');
  });
});

test('solo gaps and color changes retrigger; the additive experiment never adds solo portamento', async () => {
  const first = { ...note(0, 470, 'melody', 69, 6), timbre: 'reed' as const };
  const second = { ...note(480, 480, 'melody', 71, 6), timbre: 'reed' as const };
  await inspectOffline([frame(0, 120, [first, second])], context => assert.equal(context.oscillators.length, 8));
  await inspectOffline([frame(0, 120, [{ ...first, duration: 520 }, { ...second, timbre: 'glass' }])], context => assert.equal(context.oscillators.length, 8));
  await inspectOffline([frame(0, 120, [{ ...first, duration: 520 }, second], true)], context => {
    assert.equal(context.oscillators.length, 10);
    assert.ok(context.oscillators.every(source => !source.frequency.events.some(event => event.kind === 'exponential')));
  });
});

test('noise attacks have their own bandwidth and snare body without increasing the kick', async () => {
  const notes: NoteEvent[] = [36, 38, 42].map(midiNote => ({ id: `hit-${midiNote}`, tick: 0, duration: 120, part: 'percussion', voice: 9, midiNote, velocity: 0.5 }));
  await inspectOffline([frame(0, 120, notes)], context => {
    const kick = context.oscillators[0].connections[0].gain.events.filter(event => event.kind === 'exponential');
    assert.equal(kick[0].value, 0.085); assert.equal(kick[0].time, 0.003);
    assert.equal(kick[1].time, 0.23); assert.equal(kick[1].value, 0.0001);
    const hat = context.bufferSources.find(source => source.connections[0].type === 'highpass')!;
    assert.ok(hat.connections[0].frequency.value < 6500);
    assert.equal(hat.connections[0].connections[0].frequency.value, 12000, 'The hat retains treble bandwidth beyond the pitched ensemble warmth filter.');
    for (const source of context.bufferSources) {
      const envelope = source.connections[0].connections[0].connections[0];
      const attack = envelope.gain.events.filter(event => event.kind === 'exponential');
      assert.ok(attack[1].time >= 0.012 && attack[1].time <= 0.03);
      assert.ok(attack[1].value >= attack[0].value * 0.45, 'The transient retains a short body before its final decay.');
      const destination = envelope.connections[0].connections[0].connections[0];
      assert.equal(destination.threshold.value, -18, 'Noise attacks enter the compressor without passing through the ensemble low-pass.');
    }
    const snareBody = context.oscillators.find(source => source.frequency.events.some(event => event.value === 190))!;
    assert.ok(snareBody); assert.equal(snareBody.stops.at(-1), 0.1);
    const kickDestination = context.oscillators[0].connections[0].connections[0].connections[0].connections[0];
    assert.equal(kickDestination.frequency.value, 6500, 'The kick still uses its original warmth filter.');
  });
});

test('scoped rests terminate both snare components and the body cleanup preserves the noise envelope', async () => {
  const snare: NoteEvent = { id: 'snare-rest', tick: 0, duration: 180, part: 'percussion', voice: 9, midiNote: 38, velocity: 0.5 };
  await inspectOffline([{ ...frame(0, 120, [snare]), phrase: phraseRest(24, 200, 'accompaniment') }], context => {
    const body = context.oscillators[0], noise = context.bufferSources[0];
    for (const source of [body, noise]) assert.ok(Math.abs(source.stops.at(-1)! - 0.048) < 1e-9);
    const envelope = noise.connections[0].connections[0].connections[0];
    body.onended?.(); assert.equal(envelope.disconnections, 0, 'The short snare body must not disconnect the still-decaying noise.');
    noise.onended?.(); assert.equal(envelope.disconnections, 1);
  });
});

type TimerHarness = {
  players: AudioPlayer[];
  callbacks: Map<number, () => void>;
  allCallbacks: Array<() => void>;
  pulse: () => void;
  closeStopped: () => void;
};
async function withTransport(run: (clock: TimerHarness) => Promise<void>, ContextClass: typeof Context = Context) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const interval = globalThis.setInterval, clear = globalThis.clearInterval, timeout = globalThis.setTimeout;
  const callbacks = new Map<number, () => void>(), allCallbacks: Array<() => void> = [], closes: Array<() => void> = [];
  const players: AudioPlayer[] = []; let id = 0;
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: ContextClass });
  globalThis.setInterval = ((callback: () => void) => { callbacks.set(++id, callback); allCallbacks.push(callback); return id; }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: number) => { callbacks.delete(timer); }) as unknown as typeof clearInterval;
  globalThis.setTimeout = ((callback: () => void) => { closes.push(callback); return ++id; }) as unknown as typeof setTimeout;
  const closeStopped = () => { for (const close of closes.splice(0)) close(); };
  try { await run({ players, callbacks, allCallbacks, pulse: () => { for (const callback of [...callbacks.values()]) callback(); }, closeStopped }); }
  finally {
    for (const player of players) player.dispose(); closeStopped();
    globalThis.setInterval = interval; globalThis.clearInterval = clear; globalThis.setTimeout = timeout;
    if (prior) Object.defineProperty(globalThis, 'AudioContext', prior); else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
}

test('queued frames are announced only at the speaker output clock, not generation or render time', async () => {
  await withTransport(async clock => {
    const heard: number[] = []; let generated = 0;
    const player = new AudioPlayer({ nextFrame: () => frame(generated++ * 960, 120, []), onFrame: item => heard.push(item.tick) });
    clock.players.push(player); await player.play();
    const context = Context.latest;
    Object.assign(context, { baseLatency: 0.02, outputLatency: 0.08 });
    assert.equal(generated, 1); assert.deepEqual(heard, []);
    context.currentTime = 0.12; clock.pulse(); assert.deepEqual(heard, []);
    context.currentTime = 0.18; clock.pulse(); assert.deepEqual(heard, [0]);
    context.currentTime = 1; clock.pulse(); assert.equal(generated, 2); assert.deepEqual(heard, [0]);
    context.currentTime = 1.15; clock.pulse(); assert.deepEqual(heard, [0]);
    context.currentTime = 1.18; clock.pulse(); assert.deepEqual(heard, [0, 960]);
    assert.ok(player.currentTick >= 963 && player.currentTick <= 965);
  });
});

test('measured output timestamp takes precedence over approximate output latency', async () => {
  await withTransport(async clock => {
    const heard: number[] = [];
    const player = new AudioPlayer({ nextFrame: () => frame(0, 120, []), onFrame: item => heard.push(item.tick) });
    clock.players.push(player); await player.play();
    const context = Context.latest;
    let audibleTime = 0.03;
    Object.assign(context, { baseLatency: 0, outputLatency: 0, getOutputTimestamp: () => ({ contextTime: audibleTime, performanceTime: performance.now() + 1 }) });
    context.currentTime = 0.2; clock.pulse(); assert.deepEqual(heard, []);
    audibleTime = 0.08; clock.pulse(); assert.deepEqual(heard, [0]);
  });
});

test('late planning rebases the first note and frame announcement to a future audio boundary', async () => {
  await withTransport(async clock => {
    const heard: number[] = [];
    const player = new AudioPlayer({ nextFrame: () => {
      Context.latest.currentTime += 0.3;
      return frame(0, 120, [note(0, 480, 'bass', 40, 4)]);
    }, onFrame: item => heard.push(item.tick) });
    clock.players.push(player); await player.play();
    const context = Context.latest;
    assert.ok(context.oscillators.every(source => source.starts[0] >= 0.34 - 1e-9));
    assert.deepEqual(heard, []);
    context.currentTime = 0.33; clock.pulse(); assert.deepEqual(heard, []);
    context.currentTime = 0.35; clock.pulse(); assert.deepEqual(heard, [0]);
  });
});

test('pause freezes the playhead and resume preserves queued frames without regeneration', async () => {
  await withTransport(async clock => {
    let requested = 0; const heard: number[] = [];
    const player = new AudioPlayer({ nextFrame: () => frame(requested++ * 960, 120, []), onFrame: item => heard.push(item.tick) });
    clock.players.push(player); await player.play();
    const context = Context.latest;
    context.currentTime = 1; clock.pulse(); assert.equal(requested, 2); assert.deepEqual(heard, [0]);
    const before = player.currentTick; player.pause();
    context.currentTime = 1.03; clock.pulse();
    assert.equal(player.currentTick, before); assert.equal(player.playing, false); assert.equal(clock.callbacks.size, 0);
    await player.play(); assert.equal(requested, 2); assert.equal(Context.latest, context);
    context.currentTime = 1.08; clock.pulse(); assert.deepEqual(heard, [0, 960]);
    assert.equal(requested, 2); assert.equal(clock.callbacks.size, 1);
  });
});

test('stop and seek cannot leak queued callbacks or old context cleanup into the new player', async () => {
  await withTransport(async clock => {
    let tick = 0; const heard: number[] = [];
    const player = new AudioPlayer({ nextFrame: () => frame(tick += 960, 120, []), onFrame: item => heard.push(item.tick) });
    clock.players.push(player); await player.play(); const old = Context.latest, staleCallback = clock.allCallbacks[0];
    player.stop(); tick = 9600; await player.play(); const current = Context.latest;
    assert.notEqual(old, current); old.currentTime = 100; staleCallback(); clock.closeStopped();
    assert.deepEqual(heard, []); assert.equal(current.state, 'running'); assert.equal(old.state, 'closed');
    current.currentTime = 0.08; clock.pulse(); assert.deepEqual(heard, [10560]);
  });
});

test('stopping from an onFrame callback aborts the pump before requesting another engine frame', async () => {
  await withTransport(async clock => {
    let requests = 0;
    const player = new AudioPlayer({ nextFrame: () => { requests++; return frame(0, 120, []); }, onFrame: () => player.stop() });
    clock.players.push(player); await player.play(); Context.latest.currentTime = 2;
    assert.doesNotThrow(clock.pulse); assert.equal(requests, 1); assert.equal(player.playing, false); assert.equal(clock.callbacks.size, 0);
  });
});

test('background engine failure stops once, reports once, and never runs a stale interval', async () => {
  await withTransport(async clock => {
    let requests = 0; const errors: string[] = [];
    const player = new AudioPlayer({ nextFrame: () => { if (requests++ === 0) return frame(0, 120, []); throw new Error('Planner failed'); }, onFrame: () => {}, onError: error => errors.push(error.message) });
    clock.players.push(player); await player.play(); const callback = clock.allCallbacks[0];
    Context.latest.currentTime = 1;
    assert.doesNotThrow(clock.pulse); assert.deepEqual(errors, ['Planner failed']); assert.equal(player.playing, false);
    callback(); assert.equal(requests, 2); assert.equal(clock.callbacks.size, 0);
  });
});

class DeferredContext extends Context {
  resumes: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  override resume() { return new Promise<void>((resolve, reject) => this.resumes.push({ resolve: () => { this.state = 'running'; resolve(); }, reject })); }
}

test('duplicate play shares one resume, and a rejected stale resume cannot break a later seek', async () => {
  await withTransport(async clock => {
    const errors: Error[] = []; let requests = 0;
    const player = new AudioPlayer({ nextFrame: () => { requests++; return frame(9600, 120, []); }, onFrame: () => {}, onError: error => errors.push(error) });
    clock.players.push(player);
    const first = player.play(), duplicate = player.play(); await Promise.resolve();
    const old = Context.latest as DeferredContext; assert.equal(old.resumes.length, 1);
    player.stop(); const fresh = player.play(); await Promise.resolve();
    const current = Context.latest as DeferredContext;
    old.resumes[0].reject(new Error('Old context was closed')); current.resumes[0].resolve();
    await Promise.all([first, duplicate, fresh]);
    assert.equal(requests, 1); assert.equal(player.playing, true); assert.equal(clock.callbacks.size, 1); assert.deepEqual(errors, []);
  }, DeferredContext);
});

test('a rejected start and an invalid engine frame leave no active transport or timer', async () => {
  await withTransport(async clock => {
    const player = new AudioPlayer({ nextFrame: () => frame(0, 120, []), onFrame: () => {} }); clock.players.push(player);
    const pending = player.play(); await Promise.resolve();
    (Context.latest as DeferredContext).resumes[0].reject(new Error('Audio device unavailable'));
    await assert.rejects(pending, /Audio device unavailable/); assert.equal(player.playing, false); assert.equal(clock.callbacks.size, 0);
  }, DeferredContext);
  await withTransport(async clock => {
    const player = new AudioPlayer({ nextFrame: () => ({ ...frame(0, 120, []), duration: -1 }), onFrame: () => {} }); clock.players.push(player);
    await assert.rejects(player.play(), /invalid frame time/); assert.equal(player.playing, false); assert.equal(clock.callbacks.size, 0);
  });
});

test('reading live diagnostics measures the analyser without generating or scheduling more music', async () => {
  await withTransport(async clock => {
    let requested = 0;
    const player = new AudioPlayer({ nextFrame: () => { requested++; return frame(0, 120, [note(0, 480, 'bass', 40, 4)]); }, onFrame: () => {} });
    clock.players.push(player); await player.play();
    const context = Context.latest;
    context.analysers[0].getFloatTimeDomainData = data => { data.fill(0.05); };
    const first = player.diagnostics, second = player.diagnostics;
    assert.equal(requested, 1); assert.equal(first.sourceCount, second.sourceCount); assert.equal(first.queuedFrames, 1);
    assert.equal(first.contextState, 'running'); assert.ok(Math.abs(first.rms - 0.05) < 1e-7); assert.ok(Math.abs(first.peak - 0.05) < 1e-7);
    player.pause(); assert.equal(player.diagnostics.contextState, 'suspended'); assert.equal(player.diagnostics.playing, false);
  });
});

test('35 seconds of live frame scheduling survives real-time source cleanup and scoped phrase rests', async () => {
  await withTransport(async clock => {
    const engine = new MusicEngine({ seed: 'velvet-orbit', parameters: { ...DEFAULT_PARAMETERS, tempo: 82 }, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
    let requested = 0, heard = 0, samplesWithSources = 0;
    const errors: Error[] = [];
    const player = new AudioPlayer({ nextFrame: () => { requested++; return engine.step(); }, onFrame: () => { heard++; }, onError: error => errors.push(error) });
    clock.players.push(player); await player.play(); const context = Context.latest;
    const ended = new Set<Node>();
    for (let sample = 1; sample <= 1400; sample++) {
      context.currentTime = sample * 0.025;
      // Web Audio fires onended only for the most recently scheduled stop.
      // This exercises graph cleanup while later frames are still generated,
      // unlike an OfflineAudioContext scheduling-only assertion.
      for (const source of [...context.oscillators, ...context.bufferSources]) {
        if (!ended.has(source) && source.stops.at(-1)! <= context.currentTime) { ended.add(source); source.onended?.(); }
      }
      clock.pulse();
      if (context.oscillators.some(source => !ended.has(source) && source.starts[0] <= context.currentTime)) samplesWithSources++;
    }
    assert.deepEqual(errors, []); assert.equal(player.playing, true);
    assert.ok(requested >= 20 && heard >= 20); assert.ok(player.currentTick > 15_000);
    assert.ok(samplesWithSources > 900, 'Pitched sources keep sounding beyond the first beat, allowing intended phrase rests.');
    assert.ok(ended.size > 100, 'The run must exercise actual source cleanup, not only scheduling.');
    assert.ok(player.diagnostics.sourceCount > 0 && player.diagnostics.sourceCount < 100, 'Ended sources do not accumulate indefinitely.');
  });
});

test('external suspension or interruption pauses the transport and resumes its exact queued frames once', async () => {
  for (const state of ['suspended', 'interrupted']) await withTransport(async clock => {
    let requested = 0; const heard: number[] = [], statuses: boolean[] = [];
    const player = new AudioPlayer({ nextFrame: () => frame(requested++ * 960, 120, []), onFrame: item => heard.push(item.tick), onStatus: value => statuses.push(value) });
    clock.players.push(player); await player.play(); const context = Context.latest;
    context.currentTime = 1; clock.pulse();
    assert.equal(requested, 2); assert.deepEqual(heard, [0]);
    const oldTimer = clock.allCallbacks[0], heldTick = player.currentTick;
    context.transition(state);
    assert.equal(player.playing, false); assert.equal(player.interrupted, true); assert.equal(player.diagnostics.contextState, state);
    assert.equal(clock.callbacks.size, 0);
    context.currentTime = 1.03; oldTimer();
    assert.equal(player.currentTick, heldTick); assert.equal(requested, 2); assert.equal(player.diagnostics.queuedFrames, 1);
    const first = player.play(), duplicate = player.play(); await Promise.all([first, duplicate]);
    assert.equal(player.playing, true); assert.equal(player.interrupted, false); assert.equal(context.resumeCalls, 2);
    assert.equal(Context.latest, context); assert.equal(requested, 2); assert.equal(clock.callbacks.size, 1);
    context.currentTime = 1.08; clock.pulse(); assert.deepEqual(heard, [0, 960]);
    assert.deepEqual(statuses, [true, false, true]);
  });
});

test('explicit user pause is not reported as a browser interruption', async () => {
  await withTransport(async clock => {
    const player = new AudioPlayer({ nextFrame: () => frame(0, 120, []), onFrame: () => {} });
    clock.players.push(player); await player.play(); player.pause();
    assert.equal(Context.latest.state, 'suspended'); assert.equal(player.playing, false); assert.equal(player.interrupted, false);
    Context.latest.transition('interrupted');
    assert.equal(player.interrupted, false, 'An already user-paused transport does not become an unexpected interruption.');
  });
});

test('Play reconciles an external suspension even before the browser statechange event arrives', async () => {
  await withTransport(async clock => {
    let requested = 0;
    const player = new AudioPlayer({ nextFrame: () => frame(requested++ * 960, 120, []), onFrame: () => {} });
    clock.players.push(player); await player.play(); const context = Context.latest;
    context.state = 'suspended';
    await player.play();
    assert.equal(context.resumeCalls, 2); assert.equal(player.playing, true); assert.equal(requested, 1); assert.equal(clock.callbacks.size, 1);
  });
});

test('unexpected context closure reports one recoverable error and drops the unusable graph', async () => {
  await withTransport(async clock => {
    const errors: Error[] = [];
    const player = new AudioPlayer({ nextFrame: () => frame(0, 120, []), onFrame: () => {}, onError: error => errors.push(error) });
    clock.players.push(player); await player.play(); const context = Context.latest, staleStateChange = context.onstatechange;
    context.transition('closed'); staleStateChange?.();
    assert.equal(errors.length, 1); assert.match(errors[0].message, /closed the audio device/);
    assert.equal(player.playing, false); assert.equal(player.interrupted, false); assert.equal(clock.callbacks.size, 0);
    assert.equal(player.diagnostics.contextState, 'absent'); assert.equal(player.diagnostics.queuedFrames, 0);
  });
});

async function withoutNativeHold(run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(Parameter.prototype, 'cancelAndHoldAtTime')!;
  Object.defineProperty(Parameter.prototype, 'cancelAndHoldAtTime', { configurable: true, writable: true, value: undefined });
  try { await run(); }
  finally { Object.defineProperty(Parameter.prototype, 'cancelAndHoldAtTime', descriptor); }
}

test('missing cancelAndHoldAtTime preserves the future exponential envelope value at a rest', async () => {
  await withoutNativeHold(async () => {
    await inspectOffline([{ ...frame(0, 120, [note(0, 1920, 'harmony', 69, 0)]), phrase: phraseRest(480, 960, 'ensemble') }], context => {
      const envelope = context.oscillators[0].connections[0].connections[0];
      const events = envelope.gain.events;
      const cancel = events.findIndex(event => event.kind === 'cancel' && event.time === 0.5);
      assert.ok(cancel >= 0);
      const held = events[cancel + 1];
      const sustain = 0.7 * 0.085 * 0.52;
      const expected = sustain * (0.0001 / sustain) ** (0.04 / 0.4);
      assert.equal(held.kind, 'exponential'); assert.equal(held.time, 0.5);
      assert.ok(Math.abs(held.value - expected) < 1e-10, 'The fallback reconstructs the value at the future rest boundary.');
      assert.ok(held.value > 0.001, 'It does not use the mock parameter’s last scheduled value (near silence).');
    });
  });
});

test('missing cancelAndHoldAtTime keeps native-frequency glides intact across tempo boundaries', async () => {
  await withoutNativeHold(async () => {
    const target = degreeToPitch('19edo', 1);
    const gliding = { ...note(1680, 960, 'harmony', 69, 0), endPitch: target, glideTicks: 590 };
    await inspectOffline([frame(960, 40, [gliding]), frame(1920, 180, [])], context => {
      const events = context.oscillators[0].frequency.events;
      const cancel = events.findIndex(event => event.kind === 'cancel' && event.time === 3);
      const held = events[cancel + 1];
      assert.equal(held.kind, 'exponential'); assert.equal(held.time, 3);
      assert.ok(Math.abs(held.value - 440 * (pitchToHz(target) / 440) ** (240 / 590)) < 1e-9);
      assert.equal(events.at(-1)!.value, pitchToHz(target));
    });
  });
});

test('repeated fallback holds on a shared snare envelope preserve the incoming exponential curve', async () => {
  await withoutNativeHold(async () => {
    const snare: NoteEvent = { id: 'held-snare', tick: 0, duration: 180, part: 'percussion', voice: 9, midiNote: 38, velocity: 0.5 };
    await inspectOffline([{ ...frame(0, 120, [snare]), phrase: phraseRest(48, 200, 'accompaniment') }], context => {
      const envelope = context.bufferSources[0].connections[0].connections[0].connections[0];
      const events = envelope.gain.events;
      const held = events.flatMap((event, index) => event.kind === 'cancel' && event.time === 0.05 ? [events[index + 1]] : []);
      assert.equal(held.length, 2, 'The noise and body both stop at the same rest.');
      assert.equal(held[0].kind, 'exponential'); assert.deepEqual(held[1], held[0]);
      const expected = 0.5 * 0.075 * 0.6 * (0.0001 / (0.5 * 0.075 * 0.6)) ** (0.025 / 0.155);
      assert.ok(Math.abs(held[0].value - expected) < 1e-10);
    });
  });
});

test('fallback holds preserve an additive linear attack at a tempo boundary', async () => {
  await withoutNativeHold(async () => {
    await inspectOffline([frame(0, 120, [note(950, 1920, 'harmony', 69, 0)], true), frame(960, 180, [], true)], context => {
      const envelope = context.oscillators[0].connections[0].connections[0];
      const events = envelope.gain.events;
      const cancel = events.findIndex(event => event.kind === 'cancel' && event.time === 1);
      assert.equal(events[cancel + 1].kind, 'linear');
      assert.ok(Math.abs(events[cancel + 1].value - 0.04 * ((1 - 950 / 960) / 0.025)) < 1e-10);
    });
  });
});

test('fallback stop holds the interpolated volume target instead of jumping to its destination', async () => {
  await withoutNativeHold(async () => {
    await withTransport(async clock => {
      const player = new AudioPlayer({ nextFrame: () => frame(0, 120, []), onFrame: () => {} });
      clock.players.push(player); await player.play(); const context = Context.latest;
      context.currentTime = 0.1; player.setVolume(0.2);
      context.currentTime = 0.125; player.stop();
      const events = context.gains[0].gain.events;
      const cancel = events.findIndex(event => event.kind === 'cancel');
      const expected = 0.2 * 0.78 + (0.7 * 0.78 - 0.2 * 0.78) * Math.exp(-1);
      assert.equal(events[cancel + 1].kind, 'set');
      assert.ok(Math.abs(events[cancel + 1].value - expected) < 1e-10);
    });
  });
});

test('a browser without cancelAndHoldAtTime keeps playing past multiple frames, pauses, resumes and stops', async () => {
  await withoutNativeHold(async () => {
    await withTransport(async clock => {
      const engine = new MusicEngine({ seed: 'velvet-orbit', parameters: { ...DEFAULT_PARAMETERS, tempo: 82 }, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
      const errors: Error[] = []; let heard = 0;
      const player = new AudioPlayer({ nextFrame: () => engine.step(), onFrame: () => { heard++; }, onError: error => errors.push(error) });
      clock.players.push(player); await player.play(); const context = Context.latest;
      for (let sample = 1; sample <= 600; sample++) { context.currentTime = sample * 0.025; clock.pulse(); }
      assert.equal(player.playing, true); assert.ok(heard >= 10); assert.deepEqual(errors, []);
      player.pause(); await player.play(); assert.equal(player.playing, true);
      assert.doesNotThrow(() => player.stop()); clock.closeStopped(); assert.equal(context.state, 'closed');
    });
  });
});

test('audio cleanup failures never replace the original scheduler error', async () => {
  await withoutNativeHold(async () => {
    const originalCancel = Parameter.prototype.cancelScheduledValues;
    Parameter.prototype.cancelScheduledValues = () => { throw new Error('Secondary cleanup failure'); };
    try {
      await withTransport(async clock => {
        let requests = 0; const errors: Error[] = [];
        const player = new AudioPlayer({ nextFrame: () => { if (requests++ === 0) return frame(0, 120, []); throw new Error('Original engine failure'); }, onFrame: () => {}, onError: error => errors.push(error) });
        clock.players.push(player); await player.play(); Context.latest.currentTime = 1;
        assert.doesNotThrow(clock.pulse); assert.equal(errors.length, 1); assert.equal(errors[0].message, 'Original engine failure');
        assert.equal(player.playing, false); assert.equal(clock.callbacks.size, 0);
      });
    } finally { Parameter.prototype.cancelScheduledValues = originalCancel; }
  });
});

test('held-note swells follow musical ticks across acceleration and slowdown in their own gain stage', async () => {
  const held = { ...note(0, 2880, 'harmony', 60, 0), gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 1440, gain: 1 }, { tick: 2880, gain: .4 }] };
  await inspectOffline([frame(0, 60, [held]), frame(960, 180, []), frame(1920, 120, [])], context => {
    const envelope = context.oscillators[0].connections[0].connections[0];
    const dynamics = envelope.connections[0];
    const events = dynamics.gain.events;
    const firstBoundary = events.find(event => event.kind === 'set' && event.time === 2)!;
    assert.ok(Math.abs(firstBoundary.value - (.2 + .8 * 960 / 1440)) < 1e-12);
    assert.ok(events.some(event => event.kind === 'linear' && event.value === 1 && Math.abs(event.time - (2 + 480 / 1440)) < 1e-12));
    const secondBoundary = events.find(event => event.kind === 'set' && Math.abs(event.time - (2 + 960 / 1440)) < 1e-12)!;
    assert.ok(Math.abs(secondBoundary.value - .8) < 1e-12);
    const final = events.at(-1)!;
    assert.equal(final.value, .4); assert.ok(Math.abs(final.time - (2 + 960 / 1440 + 1)) < 1e-12);
    assert.ok(events.every(event => Number.isFinite(event.value) && Number.isFinite(event.time) && event.value >= 0 && event.value <= 1));
    assert.ok(envelope.gain.events.some(event => event.kind === 'exponential' && event.value === .0001), 'The independent instrument release is retained.');
  });
});

test('common-tone refresh retains one oscillator bank and smoothly joins the long gain trajectory', async () => {
  const first = { ...note(0, 990, 'harmony', 60, 0), gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 990, gain: .7 }] };
  const second = { ...note(960, 990, 'harmony', 60, 0), gainEnvelope: [{ tick: 0, gain: .68 }, { tick: 990, gain: .3 }] };
  await inspectOffline([frame(0, 120, [first]), frame(960, 120, [second])], context => {
    assert.equal(context.oscillators.length, 3);
    const dynamics = context.oscillators[0].connections[0].connections[0].connections[0];
    assert.ok(dynamics.gain.events.some(event => event.kind === 'hold' && event.time === 1));
    assert.ok(dynamics.gain.events.some(event => event.kind === 'linear' && event.time === 1.025 && event.value === .68));
    assert.ok(!dynamics.gain.events.some(event => event.time >= 1 && event.value === 0));
  });
});

test('a replaced upper line crossfades and cleans up without stopping its successor', async () => {
  const first = { ...note(0, 2880, 'harmony', 60, 0), gainEnvelope: [{ tick: 0, gain: .4 }, { tick: 2880, gain: .9 }] };
  const replacement = { ...note(960, 990, 'harmony', 62, 0), gainEnvelope: [{ tick: 0, gain: .6 }, { tick: 990, gain: .7 }] };
  const same = { ...replacement, id: 'same-continued', tick: 1920 };
  await inspectOffline([frame(0, 120, [first]), frame(960, 120, [replacement]), frame(1920, 120, [same])], context => {
    assert.equal(context.oscillators.length, 6, 'The replacement is new, and its common-tone continuation ties.');
    assert.ok(context.oscillators.slice(0, 3).every(source => Math.abs(source.stops.at(-1)! - 1.065) < 1e-12));
    assert.ok(context.oscillators.slice(3).every(source => source.stops.at(-1)! > 3));
    const oldEnvelope = context.oscillators[0].connections[0].connections[0];
    const newEnvelope = context.oscillators[3].connections[0].connections[0];
    context.oscillators[0].onended?.();
    assert.equal(oldEnvelope.disconnections, 1); assert.equal(newEnvelope.disconnections, 0);
    assert.ok(context.oscillators.flatMap(source => source.stops).every(time => Number.isFinite(time) && time >= 0));
  });
});

test('rests hold the swell while the dry source releases, and additive ignores expressive gain', async () => {
  const held = { ...note(0, 1920, 'harmony', 60, 0), gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 1440, gain: 1 }, { tick: 1920, gain: .4 }] };
  await inspectOffline([{ ...frame(0, 120, [held]), phrase: phraseRest(480, 960, 'accompaniment') }], context => {
    const envelope = context.oscillators[0].connections[0].connections[0], dynamics = envelope.connections[0];
    assert.equal(dynamics.gain.events.at(-1)!.kind, 'hold'); assert.equal(dynamics.gain.events.at(-1)!.time, .5);
    assert.ok(dynamics.gain.events.some(event => event.kind === 'linear' && event.time === .5 && Math.abs(event.value - (.2 + .8 / 3)) < 1e-12));
    assert.ok(envelope.gain.events.some(event => event.kind === 'linear' && event.time === .535 && event.value === 0));
    assert.ok(dynamics.connections.length > 0, 'Effect sends are not abruptly disconnected by the written rest.');
  });
  await inspectOffline([frame(0, 120, [held], true)], context => {
    const envelope = context.oscillators[0].connections[0].connections[0];
    assert.equal(envelope.connections[0], context.gains[0], 'Matched additive synthesis still connects its unchanged common envelope directly to output.');
    assert.ok(envelope.gain.events.some(event => event.value === .04));
  });
});

test('the missing-method fallback preserves a future linear swell during tempo retiming', async () => {
  await withoutNativeHold(async () => {
    const held = { ...note(0, 1920, 'harmony', 60, 0), gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 1920, gain: 1 }] };
    await inspectOffline([frame(0, 60, [held]), frame(960, 180, [])], context => {
      const dynamics = context.oscillators[0].connections[0].connections[0].connections[0];
      const events = dynamics.gain.events, index = events.findIndex(event => event.kind === 'cancel' && event.time === 2);
      assert.ok(index >= 0); assert.equal(events[index + 1].kind, 'linear'); assert.ok(Math.abs(events[index + 1].value - .6) < 1e-12);
      assert.equal(events.at(-1)!.value, 1); assert.ok(Math.abs(events.at(-1)!.time - (2 + 960 / 1440)) < 1e-12);
    });
  });
});

test('dense frames allocate only nearby note tasks while retaining exact later onsets', async () => {
  await withTransport(async clock => {
    let requests = 0;
    const notes = Array.from({ length: 32 }, (_, index) => ({ ...note(index * 30, 24, 'melody', 70 + index % 8, 5), id: `dense/${index}` }));
    const player = new AudioPlayer({ nextFrame: () => frame(requests++ * 960, 120, requests === 1 ? notes : []), onFrame: () => {} });
    clock.players.push(player); await player.play(); const context = Context.latest;
    const partials = ensemblePartials('pluck', DEFAULT_PARAMETERS.brightness).length;
    assert.equal(context.oscillators.length, 11 * partials, 'Only onsets through 400 ms allocate sources on the first pump.');
    assert.equal(player.diagnostics.pendingAudioTasks, 21);
    for (let step = 1; step <= 28; step++) { context.currentTime = step * .025; clock.pulse(); }
    assert.equal(context.oscillators.length, notes.length * partials);
    for (let index = 0; index < notes.length; index++) assert.ok(Math.abs(context.oscillators[index * partials].starts[0] - (.075 + index / 32)) < 1e-12);
    assert.equal(player.diagnostics.lateNoteTasks, 0); assert.equal(player.diagnostics.underruns, 0);
    assert.ok(player.diagnostics.maxNotesPerPump < notes.length);
  });
});

test('a 250 ms timer gap stays inside the buffer and does not lose audible frame ordering', async () => {
  await withTransport(async clock => {
    let requests = 0; const audible: number[] = [];
    const player = new AudioPlayer({ nextFrame: () => {
      const tick = requests++ * 960;
      return frame(tick, 120, Array.from({ length: 16 }, (_, i) => ({ ...note(tick + i * 60, 40, 'melody', 72, 5), id: `buffer/${tick}/${i}` })));
    }, onFrame: current => audible.push(current.tick) });
    clock.players.push(player); await player.play(); const context = Context.latest;
    for (let step = 1; step <= 10; step++) { context.currentTime = step * .25; clock.pulse(); }
    assert.deepEqual(audible, [0, 960, 1920]);
    assert.equal(player.diagnostics.underruns, 0); assert.equal(player.diagnostics.lateNoteTasks, 0);
    assert.equal(player.diagnostics.maxPumpGapMs, 250);
    assert.ok(context.oscillators.every(source => source.starts.every(Number.isFinite) && source.stops.every(Number.isFinite)));
  });
});

test('pause retains deferred note tasks and stop discards them before a new transport', async () => {
  await withTransport(async clock => {
    let tick = 0;
    const player = new AudioPlayer({ nextFrame: () => { const current = tick; tick += 960; return frame(current, 120, [note(current + 720, 120, 'melody', 80, 5)]); }, onFrame: () => {} });
    clock.players.push(player); await player.play(); const first = Context.latest;
    assert.equal(first.oscillators.length, 0); assert.equal(player.diagnostics.pendingAudioTasks, 1);
    player.pause(); await player.play();
    assert.equal(player.diagnostics.pendingAudioTasks, 1); assert.equal(tick, 960);
    first.currentTime = .5; clock.pulse();
    assert.equal(first.oscillators.length, 3); assert.equal(first.oscillators[0].starts[0], .825);
    player.stop(); tick = 9600; await player.play(); const second = Context.latest;
    assert.equal(second.oscillators.length, 0); assert.equal(player.diagnostics.pendingAudioTasks, 1);
    second.currentTime = .5; clock.pulse();
    assert.equal(second.oscillators.length, 3); assert.equal(first.oscillators.length, 3);
    assert.equal(player.diagnostics.lateNoteTasks, 0);
  });
});

test('a gap beyond the lookahead is reported without unbounded catch-up generation', async () => {
  await withTransport(async clock => {
    let requests = 0;
    const player = new AudioPlayer({ nextFrame: () => { const tick = requests++ * 960; return frame(tick, 120, [note(tick + 720, 120, 'melody', 80, 5)]); }, onFrame: () => {} });
    clock.players.push(player); await player.play(); Context.latest.currentTime = 2; clock.pulse();
    assert.equal(player.diagnostics.underruns, 1); assert.equal(player.diagnostics.lateNoteTasks, 1);
    assert.ok(player.diagnostics.maxLatenessMs >= 1174); assert.equal(requests, 2);
    assert.ok(Context.latest.oscillators.every(source => source.starts.every(Number.isFinite) && source.stops.every(Number.isFinite)));
  });
});

test('sustained articulation gives keys, glass and pluck a slow attack and a held body', async () => {
  for (const timbre of ['keys', 'glass', 'pluck'] as const) {
    const sustained: NoteEvent = { ...note(0, 2880, 'harmony', 60, 0), timbre, articulation: 'sustained', expression: { role: 'support' } };
    await inspectOffline([frame(0, 120, [sustained])], context => {
      const envelope = context.oscillators[0].connections[0].connections[0];
      const attack = envelope.gain.events[1], body = envelope.gain.events[2];
      assert.ok(attack.time >= .14 && attack.time <= .26);
      assert.ok(Math.abs(body.value - .7 * .085 * .9) < 1e-12); assert.ok(body.time > 2.9);
      assert.ok(context.oscillators[0].stops[0] > 3.4, 'The pluck color cannot silently override a written sustained gesture.');
    });
  }
});

test('detached upper notes retrigger and release quickly while sustained common tones tie', async () => {
  for (const articulation of ['sustained', 'detached'] as const) {
    const first = { ...note(0, 1920, 'harmony', 60, 0), articulation };
    const second = { ...note(960, 1920, 'harmony', 60, 0), articulation, id: 'second' };
    await inspectOffline([frame(0, 120, [first]), frame(960, 120, [second])], context => {
      assert.equal(context.oscillators.length, articulation === 'sustained' ? 3 : 6);
      if (articulation === 'detached') assert.ok(context.oscillators.every(source => source.stops.at(-1)! - source.starts[0] <= .385000001));
    });
  }
});

test('a tempo boundary inside a sustained attack retains its peak before settling', async () => {
  await withoutNativeHold(async () => {
    const held: NoteEvent = { ...note(900, 1200, 'harmony', 60, 0), articulation: 'sustained', expression: { role: 'support' } };
    await inspectOffline([frame(0, 120, [held]), frame(960, 180, [])], context => {
      const envelope = context.oscillators[0].connections[0].connections[0], events = envelope.gain.events;
      const boundary = events.findIndex(event => event.kind === 'cancel' && event.time === 1);
      const resumedAttack = events.slice(boundary + 1).find(event => event.kind === 'exponential' && Math.abs(event.value - .7 * .085) < 1e-12)!;
      assert.ok(resumedAttack && resumedAttack.time > 1 && resumedAttack.time < 1.2);
      assert.ok(events.every(event => Number.isFinite(event.value) && Number.isFinite(event.time)));
    });
  });
});

test('a pluck-color tie adopting sustained articulation keeps its held body after a tempo change', async () => {
  const first: NoteEvent = { ...note(0, 990, 'harmony', 60, 0), timbre: 'pluck', articulation: 'connected' };
  const held: NoteEvent = { ...note(960, 2400, 'harmony', 60, 0), timbre: 'pluck', articulation: 'sustained', id: 'held-refresh' };
  await inspectOffline([frame(0, 120, [first]), frame(960, 120, [held]), frame(1920, 60, [])], context => {
    assert.equal(context.oscillators.length, 3);
    const events = context.oscillators[0].connections[0].connections[0].gain.events;
    assert.ok(events.some(event => event.kind === 'exponential' && Math.abs(event.value - .7 * .085 * .9) < 1e-12 && Math.abs(event.time - 4.96) < 1e-12));
    assert.ok(context.oscillators[0].stops.at(-1)! > 5.4);
  });
});

test('ensemble bass attacks replace prior-frame holds in live and offline playback without tying rhythmic repetitions', async () => {
  const held: NoteEvent = { ...note(0, 2880, 'bass', 36, 4), articulation: 'sustained' };
  const cue: NoteEvent = { ...note(960, 1920, 'bass', 41, 4), id: 'bass-cue', articulation: 'connected' };
  const repeated: NoteEvent = { ...cue, tick: 1440, duration: 360, id: 'bass-repeat' };
  const frames = [frame(0, 120, [held]), frame(960, 120, [cue, repeated])];
  const verify = (context: Context, offset: number) => {
    const bank = ensemblePartials('round', DEFAULT_PARAMETERS.brightness).length;
    assert.equal(context.oscillators.length, bank * 3, 'Every bass onset retains its written attack, including repeated pitches.');
    assert.ok(context.oscillators.slice(0, bank).every(source => Math.abs(source.stops.at(-1)! - offset - 1.04) < 1e-12));
    assert.ok(context.oscillators.slice(bank, bank * 2).every(source => Math.abs(source.stops.at(-1)! - offset - 1.54) < 1e-12));
    const successor = context.oscillators[bank].connections[0].connections[0];
    context.oscillators[0].onended?.();
    assert.equal(successor.disconnections, 0, 'Cleaning the earlier bank cannot disconnect the next bass attack.');
  };
  await inspectOffline(frames, context => verify(context, 0));
  await withTransport(async clock => {
    let index = 0;
    const player = new AudioPlayer({ nextFrame: () => frames[index++], onFrame: () => {} });
    clock.players.push(player); await player.play(); const context = Context.latest;
    context.currentTime = .7; clock.pulse();
    context.currentTime = 1.2; clock.pulse();
    verify(context, .075);
  });
  await inspectOffline(frames.map(current => ({ ...current, sound: { ...current.sound, instrument: 'additive' } })), context => {
    assert.ok(context.oscillators[0].stops.at(-1)! > 3, 'Matched additive sonorities retain their declared spectrum and event gates.');
  });
});

test('explicit lyrical strings connect a native-pitch theme without retriggering its warm held body', async () => {
  const a = degreeToPitch('19edo', 2), b = degreeToPitch('19edo', 5);
  const first: NoteEvent = { ...note(0, 990, 'melody', 72, 5), absolutePitch: a, timbre: 'strings', articulation: 'sustained' };
  const second: NoteEvent = { ...first, id: 'lyrical-next', tick: 960, duration: 1440, absolutePitch: b };
  await inspectOffline([frame(0, 120, [first]), frame(960, 60, [second])], context => {
    assert.equal(context.oscillators.length, 4, 'A single warm oscillator bank carries the connected line.');
    const envelope = context.oscillators[0].connections[0].connections[0];
    assert.equal(envelope.gain.events.filter(event => event.kind === 'set' && event.value === .0001).length, 1);
    assert.ok(envelope.gain.events[1].time >= .14);
    assert.ok(envelope.gain.events.some(event => event.kind === 'linear' && Math.abs(event.value - .7 * .16 * .92) < 1e-12));
    assert.ok(context.oscillators[0].frequency.events.some(event => event.kind === 'set' && Math.abs(event.value - pitchToHz(b)) < 1e-10 && event.time === 1));
    assert.ok(!context.oscillators[0].frequency.events.some(event => event.kind === 'exponential'));
    assert.ok(context.oscillators[0].stops.at(-1)! > 4.4);
  });
});

test('ordinary legato reaches every native target exactly at onset while keeping one phase-continuous bank', async () => {
  await withoutNativeHold(async () => {
    for (const tuning of ['12tet', '19edo', '24edo', '31edo'] as const) {
      const first: NoteEvent = { ...note(0, 990, 'melody', 69, 5), absolutePitch: degreeToPitch(tuning, 0),
        timbre: 'reed', articulation: 'connected', expression: { role: 'anchor', sourceId: 'head' } };
      const next: NoteEvent = { ...first, id: 'native-leap-target', tick: 960, duration: 990, absolutePitch: degreeToPitch(tuning, 7) };
      await inspectOffline([frame(0, 120, [first]), frame(960, 60, [next]), frame(1920, 180, [])], context => {
        const partials = ensemblePartials('reed', DEFAULT_PARAMETERS.brightness);
        assert.equal(context.oscillators.length, partials.length);
        context.oscillators.forEach((source, index) => {
          assert.ok(source.frequency.events.some(event => event.kind === 'set' && event.time === 1
            && Math.abs(event.value - pitchToHz(next.absolutePitch!) * partials[index][1]) < 1e-9));
          assert.ok(!source.frequency.events.some(event => event.kind === 'exponential'));
          assert.ok(source.stops.every(Number.isFinite));
        });
      });
    }
  });
});

test('a repeated structural pitch is reaccented without muting the line, raising its ceiling or adding oscillators', async () => {
  const first: NoteEvent = { ...note(0, 990, 'melody', 72, 5), timbre: 'reed', articulation: 'connected',
    expression: { role: 'anchor', sourceId: 'head' } };
  await inspectOffline([frame(0, 120, [first]), frame(960, 120, [{ ...first, id: 'head-return', tick: 960 }])], context => {
    assert.equal(context.oscillators.length, 4);
    const gain = context.oscillators[0].connections[0].connections[0].gain;
    assert.equal(gain.events.filter(event => event.kind === 'set' && event.value === .0001).length, 1);
    const peak = gain.events.find(event => event.kind === 'linear' && event.time === 1.025)!;
    assert.ok(Math.abs(peak.value - .7 * .11) < 1e-12);
    assert.ok(gain.events.some(event => event.kind === 'exponential' && event.time > peak.time && event.time < 1.2
      && event.value > .05 && event.value < peak.value), 'The repeated subject settles smoothly after its audible accent.');
    assert.ok(gain.events.filter(event => !['hold', 'cancel'].includes(event.kind)).every(event => event.value <= .7 * .11 + 1e-12));
  });
});

test('declared cues reaccent a connected target while ordinary core continuations retain their prior peak', async () => {
  for (const cueId of [undefined, 'phrase:arrival']) {
    const first: NoteEvent = { ...note(0, 990, 'melody', 69, 5), timbre: 'reed', articulation: 'connected',
      expression: { role: 'anchor', sourceId: 'subject' } };
    const next: NoteEvent = { ...first, id: 'target', tick: 960, absolutePitch: midiToPitch(76),
      expression: { role: 'anchor', sourceId: 'continuation', ...(cueId ? { cueId } : {}) } };
    await inspectOffline([frame(0, 120, [first]), frame(960, 120, [next])], context => {
      assert.equal(context.oscillators.length, 4);
      const gain = context.oscillators[0].connections[0].connections[0].gain;
      const peak = gain.events.find(event => event.kind === 'linear' && event.time === 1.025)!;
      assert.ok(Math.abs(peak.value - .7 * .11 * (cueId ? 1 : .88)) < 1e-12);
    });
  }
});

test('an explicit native glide following a connected lead remains a real tempo-retimed pitch trajectory', async () => {
  const from = degreeToPitch('31edo', 0), to = degreeToPitch('31edo', 9);
  const first: NoteEvent = { ...note(0, 990, 'melody', 69, 5), absolutePitch: from, timbre: 'reed', articulation: 'connected' };
  const glide: NoteEvent = { ...first, id: 'intentional-slide', tick: 960, duration: 1920, endPitch: to, glideTicks: 1440 };
  await inspectOffline([frame(0, 120, [first]), frame(960, 120, [glide]), frame(1920, 60, [])], context => {
    assert.equal(context.oscillators.length, 8);
    const fundamental = context.oscillators[4];
    assert.ok(fundamental.frequency.events.some(event => event.kind === 'exponential' && event.time === 3
      && Math.abs(event.value - pitchToHz(to)) < 1e-10));
    assert.ok(context.oscillators.every(source => source.stops.every(Number.isFinite)));
  });
});

test('an explicitly connected reed theme shares one native-pitch voice and preserves musical gain through a tempo boundary', async () => {
  await withoutNativeHold(async () => {
    const first: NoteEvent = { ...note(0, 990, 'melody', 72, 5), absolutePitch: degreeToPitch('19edo', 2), timbre: 'reed', articulation: 'connected',
      gainEnvelope: [{ tick: 0, gain: .3 }, { tick: 990, gain: .8 }] };
    const second: NoteEvent = { ...first, id: 'connected-theme', tick: 960, duration: 1440, absolutePitch: degreeToPitch('19edo', 5),
      gainEnvelope: [{ tick: 0, gain: .6 }, { tick: 720, gain: .9 }, { tick: 1440, gain: .4 }] };
    await inspectOffline([frame(0, 120, [first]), frame(960, 60, [second])], context => {
      assert.equal(context.oscillators.length, 4, 'Connected notes reuse one bounded oscillator bank.');
      const source = context.oscillators[0], envelope = source.connections[0].connections[0], dynamics = envelope.connections[0];
      assert.equal(envelope.gain.events.filter(event => event.kind === 'set' && event.value === .0001).length, 1);
      assert.ok(source.frequency.events.some(event => event.kind === 'set' && Math.abs(event.value - pitchToHz(second.absolutePitch!)) < 1e-10 && event.time === 1));
      assert.ok(!source.frequency.events.some(event => event.kind === 'exponential'));
      assert.ok(dynamics.gain.events.some(event => event.kind === 'linear' && event.value === .6 && event.time === 1.025));
      assert.ok(dynamics.gain.events.some(event => event.kind === 'linear' && event.value === .9 && event.time === 2.5));
      assert.ok(dynamics.gain.events.some(event => event.kind === 'linear' && event.value === .4 && event.time === 4));
      assert.ok(context.oscillators.every(item => item.stops.every(Number.isFinite)));
      for (const oscillator of context.oscillators) oscillator.onended?.();
      assert.ok(envelope.disconnections > 0, 'The reused bank still releases its graph after the final note.');
    });
  });
});

test('connected reed themes breathe, crossfade color changes and leave matched additive unchanged', async () => {
  const first: NoteEvent = { ...note(0, 480, 'melody', 72, 5), timbre: 'reed', articulation: 'connected' };
  const after: NoteEvent = { ...first, id: 'reed-after-breath', tick: 720, absolutePitch: midiToPitch(74) };
  await inspectOffline([frame(0, 120, [first, after])], context => {
    assert.equal(context.oscillators.length, 8, 'A written gap starts a new attack even while ambience remains.');
    assert.equal(context.oscillators[4].starts[0], .75);
  });
  await inspectOffline([frame(0, 120, [{ ...first, duration: 990 }]), frame(960, 120, [{ ...after, tick: 960, timbre: 'strings' }])], context => {
    assert.equal(context.oscillators.length, 8);
    assert.ok(context.oscillators.slice(0, 4).every(source => Math.abs(source.stops.at(-1)! - 1.045) < 1e-12));
  });
  await inspectOffline([frame(0, 120, [{ ...first, duration: 990 }], true), frame(960, 120, [{ ...after, tick: 960 }], true)], context => {
    assert.equal(context.oscillators.length, 10);
    assert.ok(context.oscillators.every(source => source.frequency.events.every(event => event.kind !== 'exponential')));
  });
});

test('lyrical strings respect written breaths and the five legacy colors retain theme attacks', async () => {
  const first: NoteEvent = { ...note(0, 480, 'melody', 72, 5), timbre: 'strings', articulation: 'sustained' };
  const next: NoteEvent = { ...first, id: 'after-breath', tick: 720, absolutePitch: midiToPitch(74) };
  await inspectOffline([frame(0, 120, [first, next])], context => {
    assert.equal(context.oscillators.length, 8);
    assert.equal(context.oscillators[4].starts[0], .75);
    assert.equal(context.oscillators[4].connections[0].connections[0].gain.events[0].value, .0001);
  });
  for (const timbre of ['keys', 'glass', 'reed', 'pluck', 'round'] as const) {
    await inspectOffline([frame(0, 120, [{ ...first, timbre, duration: 990 }]), frame(960, 120, [{ ...next, timbre, tick: 960 }])], context => {
      assert.equal(context.oscillators.length, ensemblePartials(timbre, DEFAULT_PARAMETERS.brightness).length * 2);
    });
  }
  await inspectOffline([frame(0, 120, [{ ...first, duration: 990 }], true), frame(960, 120, [{ ...next, tick: 960 }], true)], context => {
    assert.equal(context.oscillators.length, 10);
    assert.ok(context.oscillators.every(source => source.frequency.events.every(event => event.kind !== 'exponential')), 'Additive mode does not acquire strings color or implied portamento.');
  });
});

test('long matched-additive foundations preserve five-partial levels and cannot revive across a written rest', async () => {
  const pitches = [60, 64, 67, 71, 36];
  const held = pitches.map((pitch, voice): NoteEvent => ({ ...note(0, 3840, voice === 4 ? 'bass' : 'harmony', pitch, voice),
    articulation: 'sustained', timbre: 'strings', gainEnvelope: [{ tick: 0, gain: .2 }, { tick: 3840, gain: .9 }] }));
  const resumed = held.map(event => ({ ...event, id: `resumed/${event.voice}`, tick: 2400, duration: 1440 }));
  const frames = [frame(0, 120, held, true), frame(960, 120, [], true),
    { ...frame(1920, 120, resumed, true), phrase: phraseRest(1920, 2400, 'accompaniment') }, frame(2880, 90, [], true)];
  await inspectOffline(frames, context => {
    assert.equal(context.oscillators.length, 50);
    assert.ok(context.oscillators.slice(0, 25).every(source => Math.abs(source.stops.at(-1)! - 2.04) < 1e-12), 'Later slower tempo never resuscitates a source ended by the shared breath.');
    for (let voice = 0; voice < 5; voice++) for (let partial = 0; partial < 5; partial++) {
      const source = context.oscillators[voice * 5 + partial], declared = DEFAULT_SOUND.spectrum.partials[partial];
      assert.ok(Math.abs(source.frequency.value - pitchToHz(midiToPitch(pitches[voice])) * declared.ratio) < 1e-10);
      assert.equal(source.connections[0].gain.value, declared.amplitude);
      const envelope = source.connections[0].connections[0];
      assert.equal(envelope.connections[0], context.gains[0]);
      assert.ok(envelope.gain.events.some(event => event.value === .04));
    }
    assert.ok(context.oscillators.slice(25).every(source => Math.abs(source.stops.at(-1)! - (3 + 960 / 720 + .09)) < 1e-12));
  });
});

test('lyrical foreground balance is explicit while legacy lead, upper voices and additive levels stay unchanged', async () => {
  for (const [part, voice, timbre, expected] of [
    ['melody', 5, 'strings', .16], ['harmony', 0, 'strings', .065],
    ['melody', 5, 'keys', .11], ['harmony', 0, 'keys', .085], ['melody', 6, 'reed', .15],
  ] as const) {
    const event: NoteEvent = { ...note(0, 1920, part, 72, voice), timbre, articulation: 'sustained' };
    await inspectOffline([frame(0, 120, [event])], context => {
      const envelope = context.oscillators[0].connections[0].connections[0];
      assert.ok(envelope.gain.events.some(value => value.kind === 'exponential' && Math.abs(value.value - .7 * expected) < 1e-12));
    });
  }
});
