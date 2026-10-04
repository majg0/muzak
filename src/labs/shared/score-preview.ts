import '../generators.css';
import type { Score } from '../../score/score';
import type { ScoreMeterMap } from '../../core/generated/ScoreMeterMap';
import type { LabContext } from '../types';
import { ScorePlayer } from '../../score/playback';
import { mountScoreTimeline } from '../../score/timeline';

export interface ScorePreviewResult {
  score: Score;
  meter: ScoreMeterMap;
}

/** Optional audition view. Labs without scores need neither this component nor
 * a transport; score creation and interpretation stay with the calling lab. */
export function mountScorePreview(container: HTMLElement, context: LabContext, filename: string) {
  const player = new ScorePlayer(context.call);
  let result: ScorePreviewResult | undefined, cursor = 0, playing = false;
  let disposed = false, playbackVersion = 0, exportVersion = 0, downloadUrl: string | undefined;
  let resumeAfterScrub = false;
  let timeline: ReturnType<typeof mountScoreTimeline> | undefined;
  context.onDispose(() => {
    disposed = true; playbackVersion++; exportVersion++;
    player.dispose(); timeline?.dispose(); revokeDownload();
  });
  container.classList.add('lab-score-preview', 'panel');
  container.innerHTML = `<div class="lab-preview-heading"><div><p class="eyebrow">AUDITION</p><h2>Result</h2><p class="subtle" data-preview="summary">Generate an idea to hear it.</p></div><div class="lab-preview-actions"><button type="button" class="button quiet" data-preview="rewind" disabled aria-label="Return playback to start">↤</button><button type="button" class="button primary" data-preview="play" disabled>Play</button><button type="button" class="button quiet" data-preview="pause" disabled>Pause</button><output data-preview="position" aria-label="Playback location">—</output><button type="button" class="button" data-preview="export" disabled>Export MIDI</button><a class="button" data-preview="download" hidden>Save MIDI</a></div></div><div class="lab-preview-timeline"><div data-preview="timeline"></div></div><p class="lab-preview-status" data-preview="status" role="status" aria-live="polite">The browser instrument is a simple audition sound.</p><details class="lab-preview-details" data-preview="timing" hidden><summary>Timing details</summary><ul data-preview="diagnostics"></ul></details>`;
  const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-preview="${name}"]`)!;
  const on = (name: string, listener: () => void) => get(name).addEventListener('click', listener, { signal: context.signal });
  const status = (text: string, error = false) => {
    if (disposed) return;
    get('status').textContent = text; get('status').classList.toggle('lab-error', error);
  };
  function renderTransport(): void {
    if (disposed) return;
    const hasNotes = !!result?.score.notes.length;
    get<HTMLButtonElement>('play').disabled = !hasNotes || playing;
    get<HTMLButtonElement>('pause').disabled = !playing;
    get<HTMLButtonElement>('rewind').disabled = !result;
    get('position').textContent = timeline?.positionLabel(cursor) ?? '—';
    timeline?.setCursor(cursor);
  }
  function pause(): void {
    playbackVersion++; playing = false; player.stop(); renderTransport();
  }
  async function play(): Promise<void> {
    if (disposed || !result?.score.notes.length) return;
    pause(); const ticket = playbackVersion, score = result.score;
    cursor = cursor >= score.duration ? 0 : cursor;
    playing = true; renderTransport();
    try {
      await player.play(score, {
        fromTick: cursor,
        onPosition: tick => { if (!disposed && ticket === playbackVersion) { cursor = tick; renderTransport(); } },
        onEnd: () => { if (!disposed && ticket === playbackVersion) { cursor = score.duration; pause(); } },
      });
      if (!disposed && ticket === playbackVersion && player.warnings.length) status(player.warnings.join(' '));
    } catch (error) {
      if (!disposed && ticket === playbackVersion) { pause(); status(`Playback failed: ${message(error)}`, true); }
    }
  }
  function seek(tick: number, resume: boolean): void {
    pause(); cursor = Math.max(0, Math.min(result?.score.duration ?? 0, tick)); renderTransport();
    if (resume) void play();
  }
  function revokeDownload(): void {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
  }
  timeline = mountScoreTimeline(get('timeline'), {
    onSeek: (tick, mode) => seek(tick, mode === 'instant' && playing),
    onScrubStart: () => { resumeAfterScrub = playing; pause(); },
    onScrubEnd: cancelled => { const resume = resumeAfterScrub; resumeAfterScrub = false; if (!cancelled && resume) void play(); },
    onTogglePlayback: () => { resumeAfterScrub = false; if (playing) pause(); else void play(); },
    onSelectNote: id => {
      timeline?.setSelection({ noteIds: [id], focusedNoteId: id });
      const note = result?.score.notes.find(note => note.id === id);
      if (note) status(`Selected note at ${timeline?.positionLabel(note.onset)}.`);
    },
  });
  on('play', () => { void play(); });
  on('pause', () => { resumeAfterScrub = false; pause(); });
  on('rewind', () => { resumeAfterScrub = false; seek(0, playing); });
  on('export', () => { void exportMidi(); });
  async function exportMidi(): Promise<void> {
    if (disposed || !result) return;
    const ticket = ++exportVersion, score = result.score;
    get<HTMLButtonElement>('export').disabled = true;
    try {
      const bytes = await context.call('exportScoreMidi', { score });
      if (disposed || context.signal.aborted || ticket !== exportVersion) return;
      revokeDownload();
      downloadUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/midi' }));
      const link = get<HTMLAnchorElement>('download'); link.href = downloadUrl; link.download = `${filename}.mid`; link.hidden = false;
      status('MIDI is ready. Use Save MIDI to download this result.'); link.click();
    } catch (error) {
      if (!disposed && ticket === exportVersion) status(`Export failed: ${message(error)}`, true);
    } finally {
      if (!disposed && ticket === exportVersion) get<HTMLButtonElement>('export').disabled = false;
    }
  }
  return {
    pause(): void { resumeAfterScrub = false; pause(); },
    /** Live edits retain transport intent and quarter-note coordinates. A fresh
     * generation keeps the usual stopped, fully fitted preview. */
    setResult(next: ScorePreviewResult, options: {live?: boolean} = {}): void {
      if (disposed) return;
      const live = !!options.live && !!result, resume = live && playing;
      const scale = live ? next.score.ppq / result!.score.ppq : 1;
      const viewport = live ? timeline!.getViewport() : undefined;
      const nextCursor = live ? Math.min(next.score.duration, cursor * scale) : 0;
      resumeAfterScrub = false; pause(); result = next;
      cursor = resume && nextCursor >= next.score.duration ? 0 : nextCursor;
      exportVersion++; revokeDownload();
      get<HTMLAnchorElement>('download').hidden = true;
      get<HTMLButtonElement>('export').disabled = false;
      get('summary').textContent = `${next.score.notes.length} notes · ${next.score.parts.length} ${next.score.parts.length === 1 ? 'part' : 'parts'}`;
      timeline!.setScore(next.score, {preserveViewport: live});
      if (viewport) timeline!.setViewport({from: viewport.from * scale, to: viewport.to * scale});
      timeline!.setMeter(next.meter); timeline!.setSelection({ noteIds: [] }); renderTransport();
      get('timing').hidden = next.meter.diagnostics.length === 0;
      get('diagnostics').replaceChildren(...next.meter.diagnostics.map(diagnostic => {
        const item = document.createElement('li'); item.textContent = diagnostic; return item;
      }));
      status('The browser instrument is a simple audition sound.');
      if (resume) void play();
    },
  };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
