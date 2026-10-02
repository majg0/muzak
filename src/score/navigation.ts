export interface ScoreViewport { from: number; to: number }

/** Search already-computed display coordinates; no meter is inferred here. */
export function precedingMarker<T extends {tick: number}>(markers: readonly T[], tick: number): T | undefined {
  let low = 0, high = markers.length;
  while (low < high) { const middle = (low + high) >>> 1; if (markers[middle].tick <= tick) low = middle + 1; else high = middle; }
  return markers[low - 1];
}

/** Keyboard seeking uses the core's exact marker order, never a guessed beat size. */
export function adjacentMarkerTick(markers: readonly {tick: number}[], tick: number, direction: -1 | 1, duration: number): number {
  let low = 0, high = markers.length;
  while (low < high) { const middle = (low + high) >>> 1, position = Math.round(markers[middle].tick); if (position < tick || direction === 1 && position === tick) low = middle + 1; else high = middle; }
  return Math.max(0, Math.min(duration, Math.round(markers[direction === 1 ? low : low - 1]?.tick ?? (direction === 1 ? duration : 0))));
}

/** Integer score coordinates for the view only. No transport state belongs here. */
export function clampViewport(view: ScoreViewport, duration: number, minimumSpan = 1): ScoreViewport {
  if (!Number.isSafeInteger(duration) || duration < 0 || !Number.isFinite(view.from) || !Number.isFinite(view.to)) throw new Error('Invalid viewport coordinates.');
  if (!duration) return { from: 0, to: 0 };
  const minimum = Math.min(duration, Math.max(1, Math.round(minimumSpan)));
  const span = Math.min(duration, Math.max(minimum, Math.round(view.to - view.from)));
  const from = Math.max(0, Math.min(duration - span, Math.round(view.from)));
  return { from, to: from + span };
}

export function panViewport(view: ScoreViewport, delta: number, duration: number): ScoreViewport {
  return clampViewport({ from: view.from + delta, to: view.to + delta }, duration);
}

/** Positive factors below one zoom in. The anchor retains its viewport fraction
 * unless a score edge clamps the resulting range; rounding is at most one tick. */
export function zoomViewport(view: ScoreViewport, factor: number, anchor: number, duration: number, minimumSpan = 1): ScoreViewport {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) throw new Error('Invalid viewport zoom.');
  const current = clampViewport(view, duration, minimumSpan), oldSpan = current.to - current.from;
  if (!oldSpan) return current;
  const fraction = Math.max(0, Math.min(1, (anchor - current.from) / oldSpan));
  const span = Math.min(duration, Math.max(Math.min(duration, Math.max(1, minimumSpan)), oldSpan * factor));
  return clampViewport({ from: anchor - fraction * span, to: anchor + (1 - fraction) * span }, duration, minimumSpan);
}

export function resizeViewport(view: ScoreViewport, edge: 'start' | 'end', tick: number, duration: number, minimumSpan = 1): ScoreViewport {
  const current = clampViewport(view, duration, minimumSpan), minimum = Math.min(duration, Math.max(1, Math.round(minimumSpan)));
  if (!Number.isFinite(tick)) throw new Error('Invalid viewport edge.');
  return edge === 'start'
    ? { from: Math.max(0, Math.min(current.to - minimum, Math.round(tick))), to: current.to }
    : { from: current.from, to: Math.min(duration, Math.max(current.from + minimum, Math.round(tick))) };
}
