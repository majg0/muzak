import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import type {ScorePreviewResult} from '../src/labs/shared/score-preview';
import type {ScorePlaybackOptions} from '../src/score/playback';
import type {Score} from '../src/score/score';
import type {ScoreTimelineOptions} from '../src/score/timeline';
import type {ScoreViewport} from '../src/score/navigation';

// Run the actual preview module against controlled device/view boundaries. This
// lets old asynchronous audio preparations finish after a newer edit or pause.
const source = ts.transpileModule(readFileSync(new URL('../src/labs/shared/score-preview.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

class Element extends EventTarget {
  classList = {add() {}, toggle() {}};
  textContent = ''; disabled = false; hidden = false; href = ''; download = '';
  children = new Map<string, Element>();
  set innerHTML(value: string) {
    for (const match of value.matchAll(/data-preview="([^"]+)"/g)) this.children.set(match[1], new Element());
  }
  querySelector(selector: string) { return this.children.get(selector.match(/data-preview="([^"]+)"/)![1]); }
  replaceChildren(..._children: Element[]) {}
  click() { this.dispatchEvent(new Event('click')); }
}

function result(ppq: number, duration: number): ScorePreviewResult {
  return {score: {ppq, duration, notes: [{id: 'note'} as Score['notes'][number]], parts: [], attachments: [], trackEnds: []},
    meter: {fromTick: 0, toTick: duration, markers: [], segments: [], diagnostics: []}};
}

function fixture() {
  const preparations: Array<{score: Score; options: ScorePlaybackOptions; finish(): void}> = [];
  let stopCount = 0, currentCursor = 0, viewport: ScoreViewport = {from: 0, to: 0};
  let timelineOptions: ScoreTimelineOptions;
  const scoreSettings: Array<{preserveViewport?: boolean}> = [];
  const cleanups: Array<() => void> = [];
  class Player {
    warnings: string[] = [];
    play(score: Score, options: ScorePlaybackOptions) {
      return new Promise<void>(resolve => preparations.push({score, options, finish: resolve}));
    }
    stop() { stopCount++; }
    dispose() { this.stop(); }
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(source, {exports, document: {createElement: () => new Element()}, URL,
    require: (id: string) => {
      if (id.endsWith('.css')) return {};
      if (id.endsWith('/playback')) return {ScorePlayer: Player};
      if (id.endsWith('/timeline')) return {mountScoreTimeline: (_host: Element, options: ScoreTimelineOptions) => {
        timelineOptions = options;
        return {
          setScore(score: Score, settings: {preserveViewport?: boolean} = {}) {
            scoreSettings.push(settings);
            if (!settings.preserveViewport) viewport = {from: 0, to: score.duration};
          },
          setMeter() {}, setSelection() {}, dispose() {},
          positionLabel: (tick: number) => String(tick),
          setCursor: (tick: number) => { currentCursor = tick; },
          getViewport: () => viewport,
          setViewport: (value: ScoreViewport) => { viewport = value; },
        };
      }};
      throw new Error(`Unexpected preview dependency: ${id}`);
    }});
  const host = new Element(), abort = new AbortController();
  const mount = exports.mountScorePreview as typeof import('../src/labs/shared/score-preview').mountScorePreview;
  const preview = mount(host as unknown as HTMLElement, {
    signal: abort.signal, onDispose: cleanup => cleanups.push(cleanup), call: async () => { throw new Error('Unexpected core call'); },
  }, 'test');
  return {preview, preparations, scoreSettings,
    get cursor() { return currentCursor; }, get viewport() { return viewport; }, get stops() { return stopCount; },
    seek: (tick: number) => timelineOptions.onSeek!(tick, 'instant'),
    pan: (value: ScoreViewport) => { viewport = value; },
    click: (name: string) => host.children.get(name)!.click(),
    button: (name: string) => host.children.get(name)!,
    dispose: () => { abort.abort(); cleanups.forEach(cleanup => cleanup()); },
  };
}

test('live edits preserve paused quarter position and navigation across exact PPQ changes', () => {
  const view = fixture();
  try {
    view.preview.setResult(result(480, 3840));
    view.seek(960); view.pan({from: 480, to: 1920});
    view.preview.setResult(result(6, 48), {live: true});
    assert.equal(view.cursor, 12);
    assert.equal(view.viewport.from, 6); assert.equal(view.viewport.to, 24);
    assert.equal(view.preparations.length, 0, 'An edit must not start paused audio.');
    assert.equal(view.button('play').disabled, false);
    assert.equal(view.scoreSettings.at(-1)?.preserveViewport, true);
    view.preview.setResult(result(6, 60));
    assert.equal(view.cursor, 0, 'Explicit new generations retain the existing reset behavior.');
    assert.equal(view.viewport.from, 0); assert.equal(view.viewport.to, 60);
  } finally { view.dispose(); }
});

test('live edits replace playing or preparing audio while stale callbacks cannot move or stop the newest score', async () => {
  const view = fixture();
  try {
    view.preview.setResult(result(480, 3840)); view.click('play');
    const first = view.preparations[0]; first.options.onPosition!(960);
    const next = result(6, 48);
    view.preview.setResult(next, {live: true});
    const second = view.preparations[1];
    assert.equal(second.score, next.score); assert.equal(second.options.fromTick, 12);
    const thirdScore = result(12, 96);
    view.preview.setResult(thirdScore, {live: true});
    const third = view.preparations[2];
    assert.equal(third.score, thirdScore.score); assert.equal(third.options.fromTick, 24);
    const stops = view.stops;
    first.options.onPosition!(3800); first.options.onEnd!(); first.finish();
    second.options.onPosition!(47); second.options.onEnd!(); second.finish();
    await Promise.resolve();
    assert.equal(view.cursor, 24); assert.equal(view.stops, stops);
    assert.equal(view.button('pause').disabled, false);
    third.options.onPosition!(36); assert.equal(view.cursor, 36);
    view.click('pause'); third.finish(); await Promise.resolve();
    view.preview.setResult(result(6, 48), {live: true});
    assert.equal(view.preparations.length, 3, 'Pausing during preparation cancels playback intent.');
    assert.equal(view.cursor, 18); assert.equal(view.button('pause').disabled, true);
  } finally { view.dispose(); }
});

test('a live edit wraps a playing cursor beyond the new end but clamps a paused cursor', () => {
  const view = fixture();
  try {
    view.preview.setResult(result(4, 32)); view.seek(24); view.click('play');
    view.preview.setResult(result(6, 18), {live: true});
    assert.equal(view.preparations.at(-1)?.options.fromTick, 0);
    view.click('pause'); view.seek(16);
    view.preview.setResult(result(6, 12), {live: true});
    assert.equal(view.cursor, 12);
    assert.equal(view.preparations.length, 2);
    view.preview.setResult({...result(6, 12), score: {...result(6, 12).score, notes: []}}, {live: true});
    assert.equal(view.button('play').disabled, true);
  } finally { view.dispose(); }
});
