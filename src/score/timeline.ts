import './timeline.css';
import type { Score, ScoreNote } from './score';
import type { ScoreMeterMap } from '../core/generated/ScoreMeterMap';
import { mountScoreNavigator } from './navigator';
import { adjacentMarkerTick, precedingMarker, type ScoreViewport } from './navigation';

export interface TimelineSelection {
  noteIds: readonly string[];
  focusedNoteId?: string;
  /** Optional extent for selections without notes, such as a silent region. */
  range?: ScoreViewport | null;
  /** Restrict highlighted note segments without changing note membership. */
  highlightRange?: ScoreViewport;
  noteColors?: ReadonlyMap<string, string>;
}

export interface TimelineRegion {
  from: number;
  to: number;
  /** Omitted pitch bounds fill the visible register; units are native millicents. */
  low?: number;
  high?: number;
  label?: string;
  selected?: boolean;
  color?: string;
}

export interface TimelineLink {
  fromNoteId: string;
  toNoteId: string;
  color?: string;
  targetColor?: string;
}

export interface TimelineOverlays {
  regions?: readonly TimelineRegion[];
  links?: readonly TimelineLink[];
}

export interface ScoreTimelineOptions {
  /** Caller-owned annotation UI, placed between navigation and the piano roll. */
  aboveRoll?: HTMLElement;
  onSeek?(tick: number, mode: 'instant' | 'scrub'): void;
  onScrubStart?(): void;
  onScrubEnd?(cancelled: boolean): void;
  onTogglePlayback?(): void;
  onSelectNote?(id: string): void;
  onViewportChange?(view: ScoreViewport): void;
}

interface DrawnNote {id: string; x: number; y: number; width: number; height: number}
const colors = ['#9ac9c0', '#b7a0d5', '#d3b88a', '#85aecd', '#bb99ac'];
let timelineSequence = 0;

/** A score view with independent navigation and transport gestures. The caller
 * owns score production, meter computation, interpretation and playback. */
export function mountScoreTimeline(host: HTMLElement, options: ScoreTimelineOptions = {}) {
  const abort = new AbortController(), helpId = `score-timeline-help-${++timelineSequence}`;
  let score: Score = {ppq: 480, duration: 0, notes: [], parts: [], attachments: [], trackEnds: []};
  let meter: ScoreMeterMap | undefined, meterError = '';
  let notesById = new Map<string, ScoreNote>(), partColors = new Map<string, string>();
  let selection: TimelineSelection = {noteIds: []}, selectedIds = new Set<string>(), overlays: TimelineOverlays = {};
  let cursor = 0, disposed = false, frame = 0, drawnNotes: DrawnNote[] = [];
  let drag: {id: number; x: number; view: ScoreViewport} | undefined, suppressClick = false;
  let scrub: {id: number; target: HTMLElement} | undefined;
  host.classList.add('score-timeline');
  host.innerHTML = `<div class="sw-navigator" data-timeline="navigator"></div><div class="sw-timeline-heading"><strong>Timeline</strong><span>Ruler seeks · drag notes to pan · wheel zooms</span></div><div class="sw-roll"><div class="sw-ruler" data-timeline="ruler" tabindex="0" role="slider" aria-label="Playback position" aria-orientation="horizontal" aria-describedby="${helpId}"><canvas data-timeline="ruler-canvas" aria-hidden="true"></canvas></div><canvas data-timeline="roll" tabindex="0" role="img" aria-label="Score timeline"></canvas><div class="sw-playhead" data-timeline="playhead" hidden><span class="sw-playhead-cap" data-timeline="playhead-cap" aria-hidden="true" title="Drag to seek"></span></div></div><span class="sw-sr-only" id="${helpId}">Drag the ruler or playhead to seek. Left and right move by beat; Shift moves by bar. Home and End move to score boundaries. Space plays or pauses.</span>`;
  const get = <T extends HTMLElement>(name: string) => host.querySelector<T>(`[data-timeline="${name}"]`)!;
  const on = (element: HTMLElement, event: string, listener: EventListener, extra: AddEventListenerOptions = {}) => element.addEventListener(event, listener, {signal: abort.signal, ...extra});
  const canvas = get<HTMLCanvasElement>('roll'), ruler = get('ruler');
  if (options.aboveRoll) ruler.parentElement!.before(options.aboveRoll);
  const positionLabel = (tick: number) => {
    const marker = precedingMarker(meter?.markers ?? [], tick);
    return marker ? `${marker.label}${tick > marker.tick + .001 ? ' +' : ''}` : `q ${Number((tick / score.ppq).toFixed(2))}`;
  };
  function selectionRange(): ScoreViewport | null {
    if (selection.range !== undefined) return selection.range;
    let from = Infinity, to = -Infinity;
    for (const id of selectedIds) { const note = notesById.get(id); if (note) { from = Math.min(from, note.onset); to = Math.max(to, note.onset + note.duration); } }
    return from === Infinity ? null : {from, to: Math.min(score.duration, Math.max(from + 1, to))};
  }
  function requestDraw(): void { if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); }
  const navigator = mountScoreNavigator(get('navigator'), {selection: selectionRange, positionLabel, changed: view => { requestDraw(); options.onViewportChange?.(view); }});
  function renderCursor(): void {
    const {from, to} = navigator.getViewport(), head = get('playhead');
    head.hidden = cursor < from || cursor > to || to <= from;
    head.style.left = `${43 + (cursor - from) / Math.max(1, to - from) * (canvas.clientWidth - 53)}px`;
    ruler.setAttribute('aria-valuemin', '0'); ruler.setAttribute('aria-valuemax', String(score.duration)); ruler.setAttribute('aria-valuenow', String(Math.round(cursor)));
    ruler.setAttribute('aria-valuetext', positionLabel(cursor)); ruler.setAttribute('aria-disabled', String(!score.duration || !options.onSeek));
    navigator.setCursor(cursor);
  }
  function tickAt(clientX: number): number {
    const {from, to} = navigator.getViewport(), fraction = Math.max(0, Math.min(1, (clientX - canvas.getBoundingClientRect().left - 43) / Math.max(1, canvas.clientWidth - 53)));
    return Math.max(0, Math.min(score.duration, Math.round(from + fraction * (to - from))));
  }
  function seek(tick: number, mode: 'instant' | 'scrub'): void {
    if (!options.onSeek) return;
    cursor = Math.max(0, Math.min(score.duration, Math.round(tick))); renderCursor(); options.onSeek(cursor, mode);
  }
  function finishScrub(cancelled: boolean): void {
    const active = scrub; scrub = undefined;
    if (!active) return;
    if (active.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
    options.onScrubEnd?.(cancelled);
  }
  function cancelGesture(): void {
    finishScrub(true);
    const pointer = drag?.id; drag = undefined; suppressClick = pointer !== undefined;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  }
  function draw(): void {
    if (disposed) return;
    const width = Math.max(240, canvas.clientWidth), height = 300, ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = height * ratio;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio, ratio); ctx.fillStyle = '#131218'; ctx.fillRect(0, 0, width, height);
    const {from, to} = navigator.getViewport(), span = Math.max(1, to - from), left = 43, top = 8, plotHeight = height - 16;
    const highlight = selection.highlightRange;
    const visible = score.notes.filter(note => note.duration ? note.onset < to && note.onset + note.duration > from : note.onset >= from && note.onset <= to);
    let low = 48, high = 84;
    if (visible.length) {
      low = Infinity; high = -Infinity;
      for (const note of visible) for (const pitch of [note.pitch, ...note.pitchEnvelope?.map(point => point.pitch) ?? []]) { low = Math.min(low, pitch.millicents / 100000); high = Math.max(high, pitch.millicents / 100000); }
      low = Math.floor(low) - 2; high = Math.ceil(high) + 2;
    }
    const row = plotHeight / Math.max(12, high - low + 1), x = (tick: number) => left + (tick - from) / span * (width - left - 10), y = (pitch: number) => top + (high - pitch / 100000) * row;
    ctx.font = '10px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const octaveStride = 12 * Math.max(1, Math.ceil((high - low) / 12 / Math.max(1, Math.floor(plotHeight / 14))));
    for (let pitch = Math.ceil(low / octaveStride) * octaveStride; pitch <= high; pitch += octaveStride) { ctx.fillStyle = '#211e29'; ctx.fillRect(left, y(pitch * 100000), width - left, Math.max(1, row)); ctx.fillStyle = '#888291'; ctx.fillText(`C${Math.floor(pitch / 12) - 1}`, 8, y(pitch * 100000) + row / 2); }
    const rulerCanvas = get<HTMLCanvasElement>('ruler-canvas'), rulerContext = rulerCanvas.getContext('2d');
    rulerCanvas.width = Math.round(width * ratio); rulerCanvas.height = 30 * ratio;
    if (rulerContext) {
      rulerContext.scale(ratio, ratio); rulerContext.fillStyle = '#1d1b23'; rulerContext.fillRect(0, 0, width, 30);
      rulerContext.font = '10px "Segoe UI", sans-serif'; rulerContext.textBaseline = 'middle';
      rulerContext.save(); rulerContext.beginPath(); rulerContext.rect(left, 0, width - left - 10, 30); rulerContext.clip();
      const markers = meter?.markers.filter(marker => marker.tick >= from && marker.tick <= to) ?? [];
      let previousLine = -Infinity;
      for (const marker of markers) {
        const xx = x(marker.tick); if (xx - previousLine < (marker.kind === 'bar' ? 3 : 10)) continue;
        previousLine = xx; const strong = marker.kind === 'bar';
        ctx.strokeStyle = strong ? '#514757' : '#282530'; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, height); ctx.stroke();
        rulerContext.strokeStyle = strong ? '#a096ab' : '#504857'; rulerContext.beginPath(); rulerContext.moveTo(xx, strong ? 0 : 21); rulerContext.lineTo(xx, 30); rulerContext.stroke();
      }
      let labelEnd = -Infinity;
      const occupied: {left: number; right: number}[] = [];
      for (const marker of markers.filter(marker => marker.kind === 'bar')) {
        const xx = x(marker.tick), labelWidth = rulerContext.measureText(marker.label).width;
        if (xx < labelEnd + 14) continue;
        rulerContext.fillStyle = '#dbd0e4'; rulerContext.fillText(marker.label, xx + 5, 13); labelEnd = xx + 5 + labelWidth;
        occupied.push({left: xx, right: labelEnd + 10});
      }
      let minorEnd = -Infinity, occupiedIndex = 0;
      for (const marker of markers.filter(marker => marker.kind !== 'bar')) {
        const xx = x(marker.tick), end = xx + rulerContext.measureText(marker.label).width + 12;
        while (occupied[occupiedIndex]?.right <= xx) occupiedIndex++;
        if (xx < minorEnd + 12 || occupied[occupiedIndex] && end > occupied[occupiedIndex].left) continue;
        rulerContext.fillStyle = '#948b9f'; rulerContext.fillText(marker.label, xx + 5, 13); minorEnd = end;
      }
      if (!meter) { rulerContext.fillStyle = '#a59bad'; rulerContext.fillText(meterError ? 'Meter unavailable' : 'Reading score meter…', left + 8, 15); }
      rulerContext.restore();
      let segment = meter?.segments[0];
      for (const entry of meter?.segments ?? []) { if (entry.startTick > from) break; segment = entry; }
      const signature = segment?.numerator && segment.denominator ? `${segment.numerator}/${segment.denominator}` : '—';
      rulerContext.fillStyle = '#bda7cd'; rulerContext.font = '9px "Segoe UI", sans-serif'; rulerContext.fillText(signature, 5, 13);
      ruler.title = signature === '—' ? 'No supported source meter here; quarter-note positions only.' : `Source meter ${signature}. Labels are bar:denominator beat; bar phase is a display assumption.`;
    }
    drawnNotes = [];
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, width - left - 10, plotHeight); ctx.clip();
    for (const note of visible) {
      const box = {id: note.id, x: x(Math.max(from, note.onset)), y: y(note.pitch.millicents), width: Math.max(2, x(Math.min(to, note.onset + note.duration)) - x(Math.max(from, note.onset)) - 1), height: Math.max(2, row - 1)};
      drawnNotes.push(box); ctx.globalAlpha = highlight ? .3 : !selectedIds.size || selectedIds.has(note.id) ? .9 : .32; ctx.fillStyle = partColors.get(note.part) ?? colors[0]; ctx.fillRect(box.x, box.y, box.width, box.height);
      if (selectedIds.has(note.id)) {
        const start = Math.max(from, note.onset, highlight?.from ?? from), end = Math.min(to, note.onset + note.duration, highlight?.to ?? to);
        if (end >= start) {
          const highlightLeft = x(start), highlightWidth = Math.max(2, x(end) - highlightLeft - 1);
          ctx.save(); ctx.globalAlpha = 1;
          if (highlight) { const windowLeft = x(Math.max(from, highlight.from)), windowRight = x(Math.min(to, highlight.to)); ctx.beginPath(); ctx.rect(windowLeft, top, Math.max(0, windowRight - windowLeft), plotHeight); ctx.clip(); }
          const color = selection.noteColors?.get(note.id);
          if (color) { ctx.fillStyle = color; ctx.fillRect(highlightLeft, box.y, highlightWidth, box.height); }
          ctx.strokeStyle = note.id === selection.focusedNoteId ? '#ffd18f' : color ?? '#d3eadc'; ctx.strokeRect(highlightLeft, box.y, highlightWidth, box.height);
          ctx.restore();
        }
      }
      if (note.pitchEnvelope?.length) {
        ctx.globalAlpha = selectedIds.has(note.id) ? .9 : .4; ctx.strokeStyle = '#f0e8fb'; ctx.beginPath();
        note.pitchEnvelope.forEach((point, i) => { const yy = y(point.pitch.millicents) + row / 2; if (i) ctx.lineTo(x(note.onset + point.tick), yy); else ctx.moveTo(x(note.onset + point.tick), yy); });
        ctx.lineTo(x(note.onset + note.duration), y(note.pitchEnvelope.at(-1)!.pitch.millicents) + row / 2); ctx.stroke();
      }
    }
    for (const link of overlays.links ?? []) {
      const anchor = notesById.get(link.fromNoteId), target = notesById.get(link.toNoteId);
      if (!anchor || !target || Math.max(anchor.onset, target.onset) < from || Math.min(anchor.onset, target.onset) > to) continue;
      const ax = x(anchor.onset), ay = y(anchor.pitch.millicents) + row / 2, tx = x(target.onset), ty = y(target.pitch.millicents) + row / 2;
      ctx.globalAlpha = .9; ctx.lineWidth = 1; ctx.strokeStyle = link.color ?? '#91d8db';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = link.color ?? '#91d8db'; ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = link.targetColor ?? '#ffd18f'; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const region of overlays.regions ?? []) {
      if (region.from > to || region.to < from) continue;
      const selected = region.selected, boxLeft = x(Math.max(from, region.from)), boxTop = y(region.high ?? high * 100000);
      const boxWidth = Math.max(2, x(Math.min(to, region.to)) - boxLeft), boxHeight = Math.max(2, y(region.low ?? low * 100000) - boxTop + row);
      ctx.globalAlpha = selected ? 1 : .6; ctx.strokeStyle = region.color ?? (selected ? '#f0d2a1' : '#bba6dc'); ctx.lineWidth = selected ? 2 : 1;
      ctx.setLineDash(selected ? [] : [4, 4]); ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight); ctx.setLineDash([]); ctx.lineWidth = 1;
      if (region.label) {
        const fullLabel = region.label, maxWidth = Math.min(260, width - left - 20); let label = fullLabel;
        while (label.length > 1 && ctx.measureText(label + (label.length < fullLabel.length ? '…' : '')).width > maxWidth - 10) label = label.slice(0, -1);
        if (label.length < fullLabel.length) label += '…';
        const labelWidth = ctx.measureText(label).width + 10, labelLeft = Math.max(left + 2, Math.min(boxLeft + 3, width - 12 - labelWidth));
        const labelTop = Math.max(top + 2, Math.min(boxTop + 3, top + plotHeight - 18));
        ctx.fillStyle = '#443525'; ctx.fillRect(labelLeft, labelTop, labelWidth, 16); ctx.fillStyle = '#ffe6bb'; ctx.fillText(label, labelLeft + 5, labelTop + 8);
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    if (!visible.length) { ctx.fillStyle = '#a49bab'; ctx.fillText('No note events in this window.', left + 12, height / 2); }
    canvas.setAttribute('aria-label', `Score: ${visible.length} visible notes, ${positionLabel(from)} to ${positionLabel(to)}. Drag to pan; use the ruler to seek.`); renderCursor();
  }

  for (const target of [ruler, get('playhead-cap')]) {
    on(target, 'pointerdown', event => {
      const pointer = event as PointerEvent; if (pointer.button !== 0 || !score.duration || !options.onSeek) return;
      pointer.preventDefault(); pointer.stopPropagation(); finishScrub(true); options.onScrubStart?.();
      scrub = {id: pointer.pointerId, target}; ruler.focus({preventScroll: true}); target.setPointerCapture(pointer.pointerId);
      seek(tickAt(pointer.clientX), 'scrub');
    });
    on(target, 'pointermove', event => { const pointer = event as PointerEvent; if (scrub?.id === pointer.pointerId) seek(tickAt(pointer.clientX), 'scrub'); });
    on(target, 'pointerup', event => {
      const pointer = event as PointerEvent; if (scrub?.id !== pointer.pointerId) return;
      seek(tickAt(pointer.clientX), 'scrub'); finishScrub(false);
    });
    for (const event of ['pointercancel', 'lostpointercapture']) on(target, event, pointer => { if (scrub?.id === (pointer as PointerEvent).pointerId && scrub.target === target) finishScrub(true); });
  }
  on(ruler, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(key.key)) return;
    key.preventDefault(); key.stopPropagation(); if (!score.duration) return;
    if (key.key === ' ') { options.onTogglePlayback?.(); return; }
    if (key.key === 'Home' || key.key === 'End') { seek(key.key === 'Home' ? 0 : score.duration, 'instant'); return; }
    const markers = key.shiftKey ? meter?.markers.filter(marker => marker.kind === 'bar') ?? [] : meter?.markers ?? [];
    if (markers.length) seek(adjacentMarkerTick(markers, cursor, key.key === 'ArrowLeft' || key.key === 'ArrowDown' ? -1 : 1, score.duration), 'instant');
  });
  on(canvas, 'pointerdown', event => { const pointer = event as PointerEvent; if (pointer.button !== 0) return; drag = {id: pointer.pointerId, x: pointer.clientX, view: navigator.getViewport()}; suppressClick = false; canvas.setPointerCapture(pointer.pointerId); });
  on(canvas, 'pointermove', event => {
    const pointer = event as PointerEvent; if (!drag || pointer.pointerId !== drag.id) return;
    const dx = pointer.clientX - drag.x; if (Math.abs(dx) < 3 && !suppressClick) return;
    suppressClick = true; const delta = -dx / Math.max(1, canvas.clientWidth - 53) * (drag.view.to - drag.view.from);
    navigator.setViewport({from: drag.view.from + delta, to: drag.view.to + delta});
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, event, () => { drag = undefined; });
  on(canvas, 'click', event => {
    if (suppressClick) return;
    const mouse = event as MouseEvent, box = canvas.getBoundingClientRect(), xx = mouse.clientX - box.left, yy = mouse.clientY - box.top;
    const note = drawnNotes.slice().reverse().find(note => xx >= note.x && xx <= note.x + note.width && yy >= note.y && yy <= note.y + note.height);
    if (note) options.onSelectNote?.(note.id);
  });
  on(canvas, 'wheel', event => {
    const wheel = event as WheelEvent; wheel.preventDefault(); const {from, to} = navigator.getViewport();
    if (wheel.shiftKey || Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) navigator.pan((wheel.deltaX || wheel.deltaY) / 500 * (to - from));
    else navigator.zoom(Math.exp(Math.max(-1, Math.min(1, wheel.deltaY * .002))), tickAt(wheel.clientX));
  }, {passive: false});
  on(canvas, 'keydown', event => {
    const key = event as KeyboardEvent, range = navigator.getViewport(), span = range.to - range.from;
    if (!['ArrowLeft', 'ArrowRight', '+', '=', '-', '_', 'Home', 'End', ' '].includes(key.key)) return;
    key.preventDefault(); key.stopPropagation();
    if (key.key === ' ') options.onTogglePlayback?.();
    else if (key.key === 'Home') navigator.pan(-score.duration);
    else if (key.key === 'End') navigator.pan(score.duration);
    else if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') navigator.pan((key.key === 'ArrowLeft' ? -1 : 1) * span * (key.shiftKey ? .5 : .1));
    else navigator.zoom(key.key === '+' || key.key === '=' ? .5 : 2);
  });
  const resize = new ResizeObserver(requestDraw); resize.observe(canvas); navigator.setScore(score); requestDraw();
  return {
    setScore(value: Score, settings: {preserveViewport?: boolean} = {}): void {
      cancelGesture(); const previous = navigator.getViewport(); score = value;
      notesById = new Map(score.notes.map(note => [note.id, note])); partColors = new Map(score.parts.map((part, index) => [part.id, colors[index % colors.length]]));
      navigator.setScore(score);
      if (settings.preserveViewport) { navigator.setViewport(previous); cursor = Math.min(cursor, score.duration); }
      else {
        cursor = 0; meter = undefined; meterError = ''; selection = {noteIds: []}; selectedIds.clear(); overlays = {};
        const next = navigator.getViewport();
        if (next.from !== previous.from || next.to !== previous.to) options.onViewportChange?.(next);
      }
      navigator.refresh(); renderCursor(); requestDraw();
    },
    setMeter(value?: ScoreMeterMap, error = ''): void { meter = value; meterError = error; navigator.refresh(); requestDraw(); },
    setCursor(tick: number): void { cursor = Math.max(0, Math.min(score.duration, tick)); renderCursor(); },
    setSelection(value: TimelineSelection): void { selection = structuredClone(value); selectedIds = new Set(value.noteIds); navigator.refresh(); requestDraw(); },
    getSelection: (): TimelineSelection => structuredClone(selection),
    setOverlays(value: TimelineOverlays): void { overlays = structuredClone(value); requestDraw(); },
    getViewport: navigator.getViewport,
    setViewport: navigator.setViewport,
    positionLabel,
    dispose(): void {
      if (disposed) return;
      disposed = true; cancelGesture(); abort.abort(); resize.disconnect(); cancelAnimationFrame(frame); navigator.dispose();
      host.replaceChildren(); host.classList.remove('score-timeline');
    },
  };
}
