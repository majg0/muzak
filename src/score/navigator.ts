import type { Score } from './score';
import { clampViewport, panViewport, resizeViewport, zoomViewport, type ScoreViewport } from './navigation';

/** The overview moves a view rectangle; its cursor is a read-only transport marker. */
export function mountScoreNavigator(host: HTMLElement, options: {
  changed(view: ScoreViewport): void;
  selection(): ScoreViewport | null;
  positionLabel(tick: number): string;
}) {
  const abort = new AbortController();
  let score: Score | undefined, view: ScoreViewport = { from: 0, to: 0 }, cursor = 0;
  let drag: { id: number; x: number; view: ScoreViewport; mode: 'pan' | 'start' | 'end' } | undefined;
  host.innerHTML = `<div class="sw-navigator-heading"><strong>Full score</strong><span data-nav="readout"></span></div><div class="sw-minimap" data-nav="map"><canvas data-nav="canvas" aria-label="All score notes; the outlined rectangle is the timeline viewport" role="img"></canvas><div class="sw-minimap-window" data-nav="window"><button type="button" class="sw-minimap-pan" data-nav="pan" role="slider" aria-label="Timeline viewport position"></button><button type="button" class="sw-minimap-handle start" data-nav="start" role="slider" aria-label="Timeline viewport start"></button><button type="button" class="sw-minimap-handle end" data-nav="end" role="slider" aria-label="Timeline viewport end"></button></div><span class="sw-minimap-cursor" data-nav="cursor" aria-hidden="true"></span></div><div class="sw-navigation-tools"><div><button class="button quiet" type="button" data-nav="previous" aria-label="Pan timeline earlier">←</button><button class="button quiet" type="button" data-nav="next" aria-label="Pan timeline later">→</button><button class="button quiet" type="button" data-nav="out" aria-label="Zoom timeline out">−</button><button class="button quiet" type="button" data-nav="in" aria-label="Zoom timeline in">+</button><button class="button quiet" type="button" data-nav="all">Fit score</button><button class="button quiet" type="button" data-nav="selection">Fit selection</button></div><span>Drag the view or its edges · wheel zoom · Shift-wheel pan</span></div>`;
  const get = <T extends HTMLElement>(key: string) => host.querySelector<T>(`[data-nav="${key}"]`)!;
  const map = get('map'), canvas = get<HTMLCanvasElement>('canvas'), windowBox = get('window');
  const on = (target: HTMLElement, name: string, listener: EventListener, extra = {}) => target.addEventListener(name, listener, { signal: abort.signal, ...extra });
  const duration = () => score?.duration ?? 0;
  const minimum = () => Math.max(1, Math.round((score?.ppq ?? 1) / 4));
  const tickAt = (x: number) => (x - map.getBoundingClientRect().left) / Math.max(1, map.clientWidth) * duration();
  function controls(): void {
    const total = Math.max(1, duration());
    windowBox.style.left = `${view.from / total * 100}%`; windowBox.style.width = `${(view.to - view.from) / total * 100}%`;
    get('cursor').style.left = `${Math.max(0, Math.min(1, cursor / total)) * 100}%`;
    get('readout').textContent = `${options.positionLabel(view.from)} — ${options.positionLabel(view.to)} · ${Number(((view.to - view.from) / (score?.ppq ?? 1)).toFixed(2))} quarters`;
    for (const [name, now] of [['pan', view.from], ['start', view.from], ['end', view.to]] as const) {
      const element = get(name), min = name === 'end' ? Math.min(duration(), view.from + minimum()) : 0;
      const max = name === 'pan' ? duration() - (view.to - view.from) : name === 'start' ? Math.max(0, view.to - minimum()) : duration();
      element.setAttribute('aria-valuemin', String(min)); element.setAttribute('aria-valuemax', String(max)); element.setAttribute('aria-valuenow', String(now));
      element.setAttribute('aria-valuetext', name === 'pan' ? `${options.positionLabel(view.from)} to ${options.positionLabel(view.to)}` : options.positionLabel(now));
    }
    get<HTMLButtonElement>('selection').disabled = !options.selection();
    get<HTMLButtonElement>('previous').disabled = !view.from;
    get<HTMLButtonElement>('next').disabled = view.to >= duration();
    get<HTMLButtonElement>('in').disabled = view.to - view.from <= minimum();
    get<HTMLButtonElement>('out').disabled = view.to - view.from >= duration();
  }
  function setViewport(next: ScoreViewport): void {
    const changed = clampViewport(next, duration(), minimum());
    const differs = changed.from !== view.from || changed.to !== view.to; view = changed; controls();
    if (differs) options.changed({ ...view });
  }
  function zoom(factor: number, anchor = (view.from + view.to) / 2): void { setViewport(zoomViewport(view, factor, anchor, duration(), minimum())); }
  function pan(delta: number): void { setViewport(panViewport(view, delta, duration())); }
  function draw(): void {
    const width = Math.max(1, canvas.clientWidth), height = 78, ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = height * ratio;
    const context = canvas.getContext('2d'); if (!context) return; context.scale(ratio, ratio);
    context.fillStyle = '#12151a'; context.fillRect(0, 0, width, height);
    if (!score?.notes.length) { context.fillStyle = '#948ca0'; context.font = '11px sans-serif'; context.fillText('No note events', 12, 44); controls(); return; }
    let low = Infinity, high = -Infinity;
    for (const note of score.notes) { low = Math.min(low, note.pitch.millicents); high = Math.max(high, note.pitch.millicents); }
    const pitchSpan = Math.max(100000, high - low), total = Math.max(1, score.duration);
    const palette = ['#9ac9c0', '#b7a0d5', '#d3b88a', '#85aecd', '#bb99ac'];
    const parts = new Map(score.parts.map((part, index) => [part.id, index]));
    for (const note of score.notes) {
      context.fillStyle = palette[(parts.get(note.part) ?? 0) % palette.length]; context.globalAlpha = .62;
      context.fillRect(note.onset / total * width, 5 + (high - note.pitch.millicents) / pitchSpan * 64,
        Math.max(1, note.duration / total * width), 2);
    }
    context.globalAlpha = 1; controls();
  }
  on(map, 'pointerdown', event => {
    const pointer = event as PointerEvent; if (pointer.button !== 0 || !duration()) return;
    const target = pointer.target as HTMLElement, mode = target.dataset.nav === 'start' ? 'start' : target.dataset.nav === 'end' ? 'end' : 'pan';
    (mode === 'pan' ? get('pan') : target).focus({preventScroll: true});
    if (mode === 'pan' && !windowBox.contains(target)) setViewport({ from: tickAt(pointer.clientX) - (view.to - view.from) / 2, to: tickAt(pointer.clientX) + (view.to - view.from) / 2 });
    drag = { id: pointer.pointerId, x: pointer.clientX, view: { ...view }, mode }; map.setPointerCapture(pointer.pointerId); pointer.preventDefault();
  });
  on(map, 'pointermove', event => {
    const pointer = event as PointerEvent; if (!drag || drag.id !== pointer.pointerId) return;
    const delta = (pointer.clientX - drag.x) / Math.max(1, map.clientWidth) * duration();
    setViewport(drag.mode === 'pan' ? panViewport(drag.view, delta, duration())
      : resizeViewport(drag.view, drag.mode, (drag.mode === 'start' ? drag.view.from : drag.view.to) + delta, duration(), minimum()));
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(map, event, () => { drag = undefined; });
  on(map, 'wheel', event => {
    const wheel = event as WheelEvent; wheel.preventDefault();
    if (wheel.shiftKey || Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) pan((wheel.deltaX || wheel.deltaY) / 500 * (view.to - view.from));
    else zoom(Math.exp(Math.max(-1, Math.min(1, wheel.deltaY * .002))), Math.max(view.from, Math.min(view.to, tickAt(wheel.clientX))));
  }, { passive: false });
  for (const name of ['pan', 'start', 'end']) on(get(name), 'keydown', event => {
    const key = event as KeyboardEvent, step = Math.max(1, Math.round((view.to - view.from) * (key.shiftKey ? .5 : .05)));
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', '+', '=', '-', '_'].includes(key.key)) { key.preventDefault(); key.stopPropagation(); } else return;
    if (['+', '=', '-', '_'].includes(key.key)) { zoom(key.key === '+' || key.key === '=' ? .5 : 2); return; }
    if (name === 'pan') {
      if (key.key === 'Home') pan(-duration()); else if (key.key === 'End') pan(duration()); else pan(key.key === 'ArrowLeft' ? -step : step);
    } else {
      const edge = name as 'start' | 'end', tick = edge === 'start' ? view.from : view.to;
      setViewport(resizeViewport(view, edge, key.key === 'Home' ? 0 : key.key === 'End' ? duration() : tick + (key.key === 'ArrowLeft' ? -step : step), duration(), minimum()));
    }
  });
  on(get('previous'), 'click', () => pan(-(view.to - view.from) / 2)); on(get('next'), 'click', () => pan((view.to - view.from) / 2));
  on(get('in'), 'click', () => zoom(.5)); on(get('out'), 'click', () => zoom(2));
  on(get('all'), 'click', () => setViewport({ from: 0, to: duration() }));
  on(get('selection'), 'click', () => { const selection = options.selection(); if (selection) setViewport(selection); });
  const resize = new ResizeObserver(draw); resize.observe(canvas);
  return {
    setScore(value: Score): void {
      if (drag && map.hasPointerCapture(drag.id)) map.releasePointerCapture(drag.id);
      drag = undefined;
      score = value; cursor = 0; view = clampViewport({ from: 0, to: Math.min(value.duration, 16 * value.ppq) }, value.duration, minimum()); draw();
    },
    setViewport, pan, zoom, getViewport: () => ({ ...view }), refresh: controls,
    setCursor(tick: number): void { cursor = tick; get('cursor').style.left = `${Math.max(0, Math.min(1, cursor / Math.max(1, duration()))) * 100}%`; },
    dispose(): void { abort.abort(); resize.disconnect(); host.replaceChildren(); },
  };
}
