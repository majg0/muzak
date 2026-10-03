import './workbench.css';
import type { Score, ScoreIssue, ScoreNote } from './score';
import type { SceneNode } from '../core/generated/SceneNode';
import type { HarmonyWindow } from '../core/generated/HarmonyWindow';
import type { ScoreMeterMap } from '../core/generated/ScoreMeterMap';
import type { MeterMarker } from '../core/generated/MeterMarker';
import { ScorePlayer } from './playback';
import { mountScoreNavigator } from './navigator';
import { adjacentMarkerTick, precedingMarker, type ScoreViewport } from './navigation';
import { mountSceneInspector } from './scene-inspector';
import { createScoreCodecController, type ScoreCodecResult } from './codec-controller';
import { callCore } from '../core/client';

interface LocalReference {id: string; artist: string; work: string; game?: string; edition: string; sourceUrls: string[]}
interface DrawnNote {id: string; x: number; y: number; width: number; height: number}
const colors = ['#9ac9c0', '#b7a0d5', '#d3b88a', '#85aecd', '#bb99ac'];
const roleColors = {core: '#94d4bd', color: '#be9fe4', residual: '#e5b075', unsupported: '#b2acb8', percussion: '#9eb6c9'};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function mountScoreWorkbench(container: HTMLElement): () => void {
  const abort = new AbortController(), player = new ScorePlayer();
  let source: Score = {ppq: 480, duration: 0, notes: [], parts: [], attachments: [], trackEnds: []};
  let title = 'Composition', result: ScoreCodecResult | undefined, view: 'source' | 'decoded' = 'source';
  let issues: ScoreIssue[] = [], provenance: LocalReference | undefined, sourceSha256: string | undefined;
  let selectedIds = new Set<string>(), selectedNote = '', selectedNode: SceneNode | undefined;
  let notesById = new Map<string, ScoreNote>(), partColors = new Map<string, string>();
  let harmonyById = new Map<string, HarmonyWindow>(), bandKey = '', codecFailure = false;
  let meter: ScoreMeterMap | undefined, meterError = '', barMarkers: MeterMarker[] = [];
  let cursor = 0, playing = false, disposed = false, loadVersion = 0, playbackVersion = 0, renderFrame = 0;
  let downloadUrl: string | undefined, warnings: string[] = [], drawnNotes: DrawnNote[] = [];
  let drag: {id: number; x: number; view: ScoreViewport} | undefined, suppressClick = false;
  let scrub: {id: number; target: HTMLElement; resume: boolean} | undefined;
  let pendingProgramTitle: string | undefined;
  container.classList.add('score-workbench');
  container.innerHTML = `<header class="sw-heading"><h1>Musical codec</h1><div class="sw-actions"><label class="button primary sw-open">Open MIDI<input data-sw="file" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="Open a local MIDI file"/></label><label class="sw-reference-picker" data-sw="reference-picker" hidden>Local references<select data-sw="reference"><option value="">Choose a reference…</option></select></label></div></header>
    <form class="sw-generator" data-sw="generator"><label>Seed<input data-sw="seed" type="number" min="0" max="4294967295" step="1" value="1" required/></label><label>Tempo<input data-sw="tempo" type="number" min="40" max="240" value="104" required/></label><label>Density<input data-sw="density" type="range" min="0" max="1" step="0.05" value="0.6"/></label><label>Variation<input data-sw="variation" type="range" min="0" max="1" step="0.05" value="0.35"/></label><button class="button primary" data-sw="generate" type="submit">Generate</button><button class="button quiet" data-sw="new-seed" type="button">New seed</button><details><summary>Composition</summary><div class="sw-generator-more"><label>Phrases<input data-sw="phrases" type="number" min="1" max="16" value="4" required/></label><label>Bars per phrase<input data-sw="bars" type="number" min="2" max="8" value="4" required/></label><label>Beats per bar<input data-sw="beats" type="number" min="2" max="9" value="4" required/></label><label>Tonic<select data-sw="tonic">${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'].map((name, value) => `<option value="${value}"${value === 2 ? ' selected' : ''}>${name}</option>`).join('')}</select></label><label>Mode<select data-sw="mode"><option value="major">Major</option><option value="minor">Minor</option><option value="dorian" selected>Dorian</option><option value="lydian">Lydian</option></select></label><label>Color<input data-sw="color" type="range" min="0" max="1" step="0.05" value="0.6"/></label></div></details></form>
    <p class="sw-status" data-sw="status" role="status" aria-live="polite">Loading the musical core…</p><a class="button" data-sw="download-ready" hidden>Save file</a>
    <section class="panel sw-score-panel"><div class="sw-score-heading"><div><h2 data-sw="title"></h2><p class="subtle" data-sw="inventory"></p></div><div class="sw-actions"><button class="button quiet" data-sw="rewind" aria-label="Return playback to start">↤</button><button class="button primary" data-sw="play" disabled>Play</button><button class="button quiet" data-sw="stop" disabled>Pause</button><output class="sw-position" data-sw="transport-label" aria-label="Playback location">—</output><button class="button quiet" data-sw="export" disabled>Export MIDI</button><button class="button quiet" data-sw="save-scene" disabled>Save scene</button></div></div>
      <div class="sw-codec-status" data-sw="codec" role="status">Waiting for a score.</div>
      <div class="sw-timeline-tools"><fieldset class="sw-views"><legend class="sw-sr-only">Score view</legend><label><input type="radio" name="score-view" value="source" checked/>Original source</label><label><input type="radio" name="score-view" value="decoded" disabled/><span data-sw="decoded-label">Decoded program</span></label></fieldset><label class="sw-inline-check"><input data-sw="regions" type="checkbox" checked/>Child regions</label></div>
      <div class="sw-navigator" data-sw="navigator"></div><div class="sw-timeline-heading"><strong>Timeline</strong><span>Ruler seeks · drag notes to pan · wheel zooms</span></div><div class="sw-harmony-band-heading"><span data-sw="harmony-label">Global harmony · waiting for the scene</span><span>Chord / color hypotheses</span></div><div class="sw-harmony-band" data-sw="harmony-band" role="group" aria-label="Global harmony sequence in the current viewport"></div><div class="sw-roll"><div class="sw-ruler" data-sw="ruler" tabindex="0" role="slider" aria-label="Playback position" aria-orientation="horizontal" aria-describedby="sw-seek-help"><canvas data-sw="ruler-canvas" aria-hidden="true"></canvas></div><canvas data-sw="roll" tabindex="0" role="img" aria-label="Score timeline"></canvas><div class="sw-playhead" data-sw="playhead" hidden><span class="sw-playhead-cap" data-sw="playhead-cap" aria-hidden="true" title="Drag to seek"></span></div></div><span class="sw-sr-only" id="sw-seek-help">Drag the ruler or playhead to seek. Left and right move by beat; Shift moves by bar. Home and End move to score boundaries. Space plays or pauses.</span><p class="sw-selection" data-sw="selection">Select a scene node or note.</p></section>
    <section class="panel sw-scene-panel" data-sw="scene"></section><details class="sw-details"><summary>Source and audition limits</summary><div data-sw="limits"></div></details>`;
  const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-sw="${name}"]`)!;
  const on = (element: HTMLElement, event: string, listener: EventListener) => element.addEventListener(event, listener, {signal: abort.signal});
  const activeScore = () => view === 'decoded' && result ? result.decoded : source;
  const status = (text: string, error = false) => { get('status').textContent = text; get('status').classList.toggle('sw-error', error); };
  const positionLabel = (tick: number) => {
    const marker = precedingMarker(meter?.markers ?? [], tick);
    return marker ? `${marker.label}${tick > marker.tick + .001 ? ' +' : ''}` : `q ${Number((tick / source.ppq).toFixed(2))}`;
  };
  const timeline = get<HTMLCanvasElement>('roll');
  const ruler = get('ruler');
  const selectedHarmony = () => selectedNode ? harmonyById.get(selectedNode.id) : undefined;
  function selectionRange(): ScoreViewport | null {
    const window = selectedHarmony(); if (window) return {from: window.startTick, to: window.endTick};
    let from = Infinity, to = -Infinity;
    for (const id of selectedIds) { const note = notesById.get(id); if (note) { from = Math.min(from, note.onset); to = Math.max(to, note.onset + note.duration); } }
    return from === Infinity ? null : {from, to: Math.min(source.duration, Math.max(from + 1, to))};
  }
  function requestDraw(): void { if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; draw(); }); }
  const navigator = mountScoreNavigator(get('navigator'), {selection: selectionRange, changed: requestDraw, positionLabel});
  const inspector = mountSceneInspector(get('scene'), {
    select: (node, noteId, members) => {
      selectedNode = node; selectedIds = new Set(members ?? node?.noteIds ?? []); selectedNote = noteId ?? '';
      get('selection').textContent = node ? `${node.label} · ${selectedIds.size} highlighted of ${node.noteIds.length} member notes${selectedHarmony() ? ' · roles apply only within the selected harmonic window' : ''}${noteId ? ' · selected note outlined in amber' : ''}.` : 'Select a scene node or a note to inspect its meaning.';
      renderTransport(); requestDraw();
    },
    fit: () => { const selection = selectionRange(); if (selection) navigator.setViewport(selection); },
    audition: () => { void play(true); },
    transpose: async (scope, target, millicents) => {
      stop(); await controller.edit({op: 'transposeScene', input: {scope, target, millicents}});
    },
    changeHarmony: async (windowId, rootMillicents, coreIntervals) => {
      stop(); await controller.edit({op: 'changeSceneHarmony', input: {windowId, rootMillicents, ...(coreIntervals ? {coreIntervals} : {})}});
    },
  });
  const controller = createScoreCodecController({onSnapshot: snapshot => {
    if (disposed) return;
    const codec = get('codec'); codec.classList.toggle('sw-error', snapshot.status === 'error');
    if (snapshot.status === 'ready') {
      if (pendingProgramTitle !== undefined) { const name = pendingProgramTitle; pendingProgramTitle = undefined; load(snapshot.result.source, name, [], undefined, undefined, false); }
      result = snapshot.result; codecFailure = false;
      const edited = result.scene.programRevision > 0;
      if (edited || result.scene.origin === 'authored') view = 'decoded';
      harmonyById = new Map(result.scene.harmony?.windows.map(window => [window.id, window]) ?? []); bandKey = ''; inspector.setScene(source, result.scene, result.decoded);
      status(edited ? 'Edited program ready. Playback and export follow the selected score view; Original source is unchanged.' : result.scene.origin === 'authored' ? 'Generated program ready. Play it, edit a palette or material, or export MIDI.' : 'Scene ready. Select a region or note to inspect its structure.');
      codec.textContent = edited ? `Edited program · revision ${result.scene.programRevision} · ${result.comparison.equal ? 'notes match the original source' : `${result.comparison.missing.length} source notes changed or absent · ${result.comparison.extra.length} changed or additional decoded notes`}. Source analysis remains evidence.` : result.scene.origin === 'authored' ? 'Authored program · original realization preserved · bindings remain authoritative.' : `${result.comparison.equal ? 'Exact note reconstruction' : 'Reconstruction differs'} · ${result.comparison.missing.length} missing · ${result.comparison.extra.length} extra · context ${result.scene.verification.exactContext ? 'preserved' : 'differs'} · identities ${result.scene.verification.exactIdentities ? 'preserved' : 'differ'}`;
      get('decoded-label').textContent = edited ? 'Edited program' : 'Decoded program';
      get<HTMLInputElement>('save-scene').disabled = false;
      container.querySelectorAll<HTMLInputElement>('.sw-views input').forEach(input => { input.disabled = false; input.checked = input.value === view; });
      refreshView(); renderLimits();
    } else if (snapshot.status === 'error') { codecFailure = !result; pendingProgramTitle = undefined; bandKey = ''; codec.textContent = `${result ? 'Change not applied; previous program retained' : 'Scene unavailable'}: ${snapshot.error}.`; requestDraw(); }
    else codec.textContent = ({encoding: 'Encoding the complete score into a musical scene…', editing: 'Applying the change to the current program…', decoding: 'Decoding the scene through the composition compiler…', verifying: 'Comparing decoded note events with the immutable original source…'}[snapshot.status]);
  }});
  function refreshView(): void {
    const viewport = navigator.getViewport(), score = activeScore();
    notesById = new Map(score.notes.map(note => [note.id, note]));
    navigator.setScore(score); navigator.setViewport(viewport); navigator.setCursor(cursor);
    get('play').title = get('export').title = `Uses ${view === 'source' ? 'original source' : 'current program'}`;
    requestDraw();
  }
  function renderTransport(): void {
    const {from, to} = navigator.getViewport(), head = get('playhead');
    head.hidden = cursor < from || cursor > to || to <= from;
    head.style.left = `${43 + (cursor - from) / Math.max(1, to - from) * (timeline.clientWidth - 53)}px`;
    ruler.setAttribute('aria-valuemin', '0'); ruler.setAttribute('aria-valuemax', String(source.duration)); ruler.setAttribute('aria-valuenow', String(Math.round(cursor)));
    ruler.setAttribute('aria-valuetext', positionLabel(cursor)); ruler.setAttribute('aria-disabled', String(!source.duration));
    get('transport-label').textContent = positionLabel(cursor); get('transport-label').title = `${positionLabel(cursor)} · tick ${Math.round(cursor)}${meterError ? ` · ${meterError}` : ''}`;
    navigator.setCursor(cursor); navigator.refresh();
    get<HTMLButtonElement>('play').disabled = playing || !source.notes.length; get<HTMLButtonElement>('stop').disabled = !playing;
  }
  function stop(): void { playbackVersion++; playing = false; if (scrub) scrub.resume = false; player.stop(); renderTransport(); }
  function seek(tick: number, resume = playing): void { stop(); cursor = Math.max(0, Math.min(source.duration, Math.round(tick))); renderTransport(); if (resume && cursor < source.duration) void play(); }
  function tickAt(clientX: number): number {
    const {from, to} = navigator.getViewport(), fraction = Math.max(0, Math.min(1, (clientX - timeline.getBoundingClientRect().left - 43) / Math.max(1, timeline.clientWidth - 53)));
    return Math.max(0, Math.min(source.duration, Math.round(from + fraction * (to - from))));
  }
  function cancelScrub(): void {
    const active = scrub; scrub = undefined;
    if (active?.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
  }
  async function play(audition = false): Promise<void> {
    stop(); const ticket = playbackVersion, current = activeScore(), selection = audition ? selectionRange() : null;
    if (audition && !selection) return;
    const score = audition ? {...current, notes: current.notes.filter(note => selectedIds.has(note.id))} : current;
    const fromTick = selection?.from ?? (cursor >= score.duration ? 0 : cursor), toTick = selection?.to ?? score.duration;
    if (toTick <= fromTick) return;
    cursor = fromTick; playing = true; renderTransport();
    try { await player.play(score, {fromTick, toTick, onPosition: tick => { if (!disposed && ticket === playbackVersion) { cursor = tick; renderTransport(); } },
      onEnd: () => { if (!disposed && ticket === playbackVersion) { cursor = toTick; stop(); } }}); }
    catch (error) { if (!disposed && ticket === playbackVersion) { stop(); status(`Playback failed: ${message(error)}`, true); } }
  }
  function renderHarmonyBand(from: number, to: number): void {
    const band = get('harmony-band'), key = `${view}:${from}:${to}`;
    if (bandKey !== key) {
      bandKey = key;
      const fragment = document.createDocumentFragment(), windows = [...harmonyById.values()].filter(window => window.startTick < to && window.endTick > from);
      const authored = result?.scene.origin === 'authored';
      const palettes = authored ? result?.scene.nodes.filter(node => node.kind === 'harmony') ?? [] : [];
      let visiblePalettes = 0;
      for (const node of palettes) {
        let start = Infinity, end = -Infinity;
        for (const id of node.noteIds) {
          const note = notesById.get(id); if (!note) continue;
          start = Math.min(start, note.onset); end = Math.max(end, note.onset + note.duration);
        }
        if (start >= to || end <= from) continue;
        visiblePalettes++;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sw-harmony-window'; button.dataset.window = node.id;
        button.style.left = `${(Math.max(from, start) - from) / Math.max(1, to - from) * 100}%`;
        button.style.width = `${(Math.min(to, end) - Math.max(from, start)) / Math.max(1, to - from) * 100}%`;
        const text = `${node.label} · authored palette members · ${positionLabel(start)}–${positionLabel(end)}`;
        button.textContent = node.label; button.title = text; button.setAttribute('aria-label', text);
        button.onclick = () => inspector.selectNode(node.id); fragment.append(button);
      }
      for (const window of windows) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sw-harmony-window'; button.dataset.window = window.id;
        button.classList.toggle('sw-harmony-rest', window.rest); button.classList.toggle('sw-harmony-ambiguous', !window.rest && window.selected === null);
        button.style.left = `${(Math.max(from, window.startTick) - from) / Math.max(1, to - from) * 100}%`;
        button.style.width = `${(Math.min(to, window.endTick) - Math.max(from, window.startTick)) / Math.max(1, to - from) * 100}%`;
        const text = `${window.label} · ${positionLabel(window.startTick)}–${positionLabel(window.endTick)}`;
        button.textContent = window.label; button.title = text; button.setAttribute('aria-label', text); button.onclick = () => inspector.selectNode(window.id); fragment.append(button);
      }
      if (!windows.length && !visiblePalettes) { const empty = document.createElement('span'); empty.className = 'sw-harmony-empty'; empty.textContent = codecFailure ? 'Scene encoding failed; see codec status.' : authored ? 'No authored palette members in this view.' : result ? 'No source harmonic windows available here.' : 'Building the musical scene…'; fragment.append(empty); }
      band.replaceChildren(fragment);
      get('harmony-label').textContent = codecFailure ? 'Source harmony · unavailable' : authored ? `Authored palettes · ${visiblePalettes} of ${palettes.length} visible` : result ? `Source harmony evidence · ${windows.length} of ${harmonyById.size} windows visible` : 'Global harmony · waiting for the scene';
      band.previousElementSibling!.lastElementChild!.textContent = authored ? 'Select a palette to edit' : 'Chord / color hypotheses';
    }
    band.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.window === selectedNode?.id)));
  }
  function draw(): void {
    if (disposed) return;
    const width = Math.max(240, timeline.clientWidth), height = 300, ratio = Math.min(2, devicePixelRatio || 1);
    timeline.width = Math.round(width * ratio); timeline.height = height * ratio;
    const ctx = timeline.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio, ratio); ctx.fillStyle = '#131218'; ctx.fillRect(0, 0, width, height);
    const {from, to} = navigator.getViewport(), span = Math.max(1, to - from), left = 43, top = 8, plotHeight = height - 16;
    renderHarmonyBand(from, to);
    const harmony = selectedHarmony(), roles = new Map(harmony?.roles.map(item => [item.noteId, item.role]) ?? []);
    const visible = activeScore().notes.filter(note => note.duration ? note.onset < to && note.onset + note.duration > from : note.onset >= from && note.onset <= to);
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
      drawnNotes.push(box); ctx.globalAlpha = harmony ? .3 : !selectedIds.size || selectedIds.has(note.id) ? .9 : .32; ctx.fillStyle = partColors.get(note.part) ?? colors[0]; ctx.fillRect(box.x, box.y, box.width, box.height);
      if (selectedIds.has(note.id)) {
        const start = Math.max(from, note.onset, harmony?.startTick ?? from), end = Math.min(to, note.onset + note.duration, harmony?.endTick ?? to);
        if (end >= start) {
          const highlightLeft = x(start), highlightWidth = Math.max(2, x(end) - highlightLeft - 1);
          ctx.save(); ctx.globalAlpha = 1;
          if (harmony) { const windowLeft = x(Math.max(from, harmony.startTick)), windowRight = x(Math.min(to, harmony.endTick)); ctx.beginPath(); ctx.rect(windowLeft, top, Math.max(0, windowRight - windowLeft), plotHeight); ctx.clip(); }
          if (harmony) { ctx.fillStyle = roleColors[roles.get(note.id) ?? 'unsupported']; ctx.fillRect(highlightLeft, box.y, highlightWidth, box.height); }
          ctx.strokeStyle = note.id === selectedNote ? '#ffd18f' : harmony ? roleColors[roles.get(note.id) ?? 'unsupported'] : '#d3eadc'; ctx.strokeRect(highlightLeft, box.y, highlightWidth, box.height);
          ctx.restore();
        }
      }
      if (note.pitchEnvelope?.length) {
        ctx.globalAlpha = selectedIds.has(note.id) ? .9 : .4; ctx.strokeStyle = '#f0e8fb'; ctx.beginPath();
        note.pitchEnvelope.forEach((point, i) => { const yy = y(point.pitch.millicents) + row / 2; if (i) ctx.lineTo(x(note.onset + point.tick), yy); else ctx.moveTo(x(note.onset + point.tick), yy); });
        ctx.lineTo(x(note.onset + note.duration), y(note.pitchEnvelope.at(-1)!.pitch.millicents) + row / 2); ctx.stroke();
      }
    }
    if (result && selectedNode) {
      if (selectedNode.kind === 'elaboration') {
        const members = new Set(selectedNode.noteIds);
        ctx.globalAlpha = .9; ctx.lineWidth = 1;
        for (const relation of result.scene.pitchRelations) if (relation.selected && members.has(relation.noteId)) {
          const dependent = notesById.get(relation.noteId); if (!dependent) continue;
          const targetX = x(dependent.onset), targetY = y(dependent.pitch.millicents) + row / 2;
          for (const id of new Set([...relation.fromNoteIds, ...relation.toNoteIds])) {
            const anchor = notesById.get(id); if (!anchor) continue;
            if (Math.max(anchor.onset, dependent.onset) < from || Math.min(anchor.onset, dependent.onset) > to) continue;
            const anchorX = x(anchor.onset), anchorY = y(anchor.pitch.millicents) + row / 2;
            ctx.strokeStyle = '#91d8db'; ctx.beginPath(); ctx.moveTo(anchorX, anchorY); ctx.lineTo(targetX, targetY); ctx.stroke();
            ctx.fillStyle = '#91d8db'; ctx.beginPath(); ctx.arc(anchorX, anchorY, 3, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = '#ffd18f'; ctx.beginPath(); ctx.arc(targetX, targetY, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      const children = new Set(selectedNode.children), drawChildren = get<HTMLInputElement>('regions').checked;
      const regions = [...(drawChildren ? result.scene.nodes.filter(node => children.has(node.id) && node.id !== selectedNode!.id) : []), selectedNode];
      for (const node of regions) if (node.noteIds.length || harmonyById.has(node.id)) {
        let start = Infinity, end = -Infinity, min = Infinity, max = -Infinity;
        for (const id of node.noteIds) { const note = notesById.get(id); if (!note) continue; start = Math.min(start, note.onset); end = Math.max(end, note.onset + note.duration); for (const p of [note.pitch, ...note.pitchEnvelope?.map(point => point.pitch) ?? []]) { min = Math.min(min, p.millicents); max = Math.max(max, p.millicents); } }
        const window = harmonyById.get(node.id); if (window) { start = window.startTick; end = window.endTick; if (!node.noteIds.length) { min = low * 100000; max = high * 100000; } }
        if (start > to || end < from) continue;
        const selected = node.id === selectedNode.id, boxLeft = x(Math.max(from, start)), boxTop = y(max);
        const boxWidth = Math.max(2, x(Math.min(to, end)) - boxLeft), boxHeight = Math.max(2, y(min) - boxTop + row);
        ctx.globalAlpha = selected ? 1 : .6; ctx.strokeStyle = selected ? '#f0d2a1' : '#bba6dc'; ctx.lineWidth = selected ? 2 : 1;
        ctx.setLineDash(selected ? [] : [4, 4]); ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight); ctx.setLineDash([]); ctx.lineWidth = 1;
        if (selected) {
          const fullLabel = node.label + (node.kind === 'rhythm' && node.materialId ? ` · ${node.materialId}` : '');
          const maxWidth = Math.min(260, width - left - 20); let label = fullLabel;
          while (label.length > 1 && ctx.measureText(label + (label.length < fullLabel.length ? '…' : '')).width > maxWidth - 10) label = label.slice(0, -1);
          if (label.length < fullLabel.length) label += '…';
          const labelWidth = ctx.measureText(label).width + 10, labelLeft = Math.max(left + 2, Math.min(boxLeft + 3, width - 12 - labelWidth));
          const labelTop = Math.max(top + 2, Math.min(boxTop + 3, top + plotHeight - 18));
          ctx.fillStyle = '#443525'; ctx.fillRect(labelLeft, labelTop, labelWidth, 16); ctx.fillStyle = '#ffe6bb'; ctx.fillText(label, labelLeft + 5, labelTop + 8);
        }
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    if (!visible.length) { ctx.fillStyle = '#a49bab'; ctx.fillText('No note events in this window.', left + 12, height / 2); }
    timeline.setAttribute('aria-label', `${view} score: ${visible.length} visible notes, ${positionLabel(from)} to ${positionLabel(to)}. Drag to pan; use the ruler to seek.`); renderTransport();
  }
  function renderLimits(): void {
    const host = get('limits'); host.replaceChildren();
    const add = (text: string) => { const p = document.createElement('p'); p.textContent = text; host.append(p); };
    add('The scene describes this symbolic score. MIDI arrangements may differ from the original recording. Exact reconstruction does not validate a musical interpretation.');
    add('Audition uses simplified tones. The roll shows held notes and native pitch curves; MIDI controllers can change the sounding result.');
    for (const text of [...issues.map(issue => issue.message), ...warnings, ...meter?.diagnostics ?? [], ...(meterError ? [meterError] : [])]) add(text);
    if (provenance) { add(`${provenance.artist} · ${provenance.work}. ${provenance.edition}`); for (const value of provenance.sourceUrls) { try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) continue; const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `Source: ${url.hostname}${url.pathname}`; host.append(link); } catch { /* Invalid provenance URL is not linked. */ } } }
  }
  function load(score: Score, name: string, importIssues: ScoreIssue[], reference?: LocalReference, hash?: string, analyze = true): void {
    stop(); cancelScrub(); const pointer = drag?.id; drag = undefined; suppressClick = pointer !== undefined;
    if (pointer !== undefined && timeline.hasPointerCapture(pointer)) timeline.releasePointerCapture(pointer);
    source = score; title = name; issues = importIssues; provenance = reference; sourceSha256 = hash; result = undefined; view = 'source'; cursor = 0; warnings = []; meter = undefined; meterError = ''; barMarkers = [];
    notesById = new Map(score.notes.map(note => [note.id, note])); partColors = new Map(score.parts.map((part, i) => [part.id, colors[i % colors.length]]));
    selectedIds.clear(); selectedNode = undefined; selectedNote = ''; harmonyById.clear(); bandKey = ''; codecFailure = false;
    get('title').textContent = title; get('inventory').textContent = `${score.notes.length.toLocaleString()} notes · ${score.parts.length} parts · ${Number((score.duration / score.ppq).toFixed(2))} quarter notes`;
    container.querySelectorAll<HTMLInputElement>('.sw-views input').forEach(input => { input.checked = input.value === 'source'; input.disabled = input.value === 'decoded'; });
    get<HTMLButtonElement>('export').disabled = score.trackEnds.length === 0; get<HTMLButtonElement>('save-scene').disabled = true;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = undefined; get('download-ready').hidden = true;
    get('decoded-label').textContent = 'Decoded program';
    navigator.setScore(score); inspector.setScene(score); renderLimits(); if (analyze) { pendingProgramTitle = undefined; controller.setSource(score); } requestDraw();
    const version = loadVersion;
    void callCore('scoreMeter', {score}).then(map => { if (!disposed && version === loadVersion) { meter = map; barMarkers = map.markers.filter(marker => marker.kind === 'bar'); bandKey = ''; navigator.refresh(); renderLimits(); requestDraw(); } }).catch(error => { if (!disposed && version === loadVersion) { meterError = `Score meter unavailable: ${message(error)}`; renderLimits(); requestDraw(); } });
    void callCore('compilePerformance', {score}).then(performance => { if (!disposed && version === loadVersion) { warnings = performance.warnings; renderLimits(); } }).catch(error => { if (!disposed && version === loadVersion) { warnings = [`Audition unavailable: ${message(error)}`]; renderLimits(); } });
  }
  async function openBytes(bytes: Uint8Array, name: string, version: number, reference?: LocalReference): Promise<void> {
    const [imported, digest] = await Promise.all([callCore('importMidi', {bytes: Array.from(bytes)}), crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)]);
    if (disposed || version !== loadVersion) return;
    load(imported.score, name, imported.issues, reference, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
    status(`Opened ${name} locally. Encoding the complete score.`);
  }
  on(get('file'), 'change', async () => {
    const input = get<HTMLInputElement>('file'), file = input.files?.[0]; if (!file) return;
    const version = ++loadVersion; stop(); status(`Opening ${file.name}…`);
    try { if (file.size > 10 * 1024 * 1024) throw new Error('Choose a MIDI file smaller than 10 MB.'); await openBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.midi?$/i, ''), version); }
    catch (error) { if (!disposed && version === loadVersion) status(`Could not open the file: ${message(error)}`, true); } finally { input.value = ''; }
  });
  async function generate(): Promise<void> {
    if (!get<HTMLFormElement>('generator').reportValidity()) return;
    const number = (name: string) => Number(get<HTMLInputElement>(name).value);
    const options = {seed: number('seed'), tempo: number('tempo'), phrases: number('phrases'), barsPerPhrase: number('bars'), beatsPerBar: number('beats'), density: number('density'), variation: number('variation'), color: number('color'), tonic: number('tonic'), mode: get<HTMLSelectElement>('mode').value as 'major' | 'minor' | 'dorian' | 'lydian'};
    const version = ++loadVersion; stop(); status('Generating an executable composition…'); get<HTMLButtonElement>('generate').disabled = true;
    try { const scene = await callCore('generateComposition', {options}); if (!disposed && version === loadVersion) { pendingProgramTitle = `Composition · seed ${options.seed}`; controller.setProgram(scene); } }
    catch (error) { if (!disposed && version === loadVersion) status(`Could not generate: ${message(error)}`, true); }
    finally { if (!disposed) get<HTMLButtonElement>('generate').disabled = false; }
  }
  on(get('generator'), 'submit', event => { event.preventDefault(); void generate(); });
  on(get('new-seed'), 'click', () => { get<HTMLInputElement>('seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]); void generate(); });
  on(get('play'), 'click', () => { void play(); });
  on(get('stop'), 'click', stop); on(container, 'score-workbench-stop', stop); on(get('rewind'), 'click', () => seek(0));
  on(get('regions'), 'change', requestDraw);
  for (const target of [ruler, get('playhead-cap')]) {
    on(target, 'pointerdown', event => {
      const pointer = event as PointerEvent; if (pointer.button !== 0 || !source.duration) return;
      pointer.preventDefault(); pointer.stopPropagation(); cancelScrub(); const resume = playing; stop();
      scrub = {id: pointer.pointerId, target, resume}; ruler.focus({preventScroll: true}); target.setPointerCapture(pointer.pointerId);
      cursor = tickAt(pointer.clientX); renderTransport();
    });
    on(target, 'pointermove', event => { const pointer = event as PointerEvent; if (scrub?.id === pointer.pointerId) { cursor = tickAt(pointer.clientX); renderTransport(); } });
    on(target, 'pointerup', event => {
      const pointer = event as PointerEvent; if (scrub?.id !== pointer.pointerId) return;
      cursor = tickAt(pointer.clientX); const resume = scrub.resume; cancelScrub(); renderTransport(); if (resume && cursor < source.duration) void play();
    });
    for (const event of ['pointercancel', 'lostpointercapture']) on(target, event, pointer => { if (scrub?.id === (pointer as PointerEvent).pointerId && scrub.target === target) cancelScrub(); });
  }
  on(ruler, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(key.key)) return;
    key.preventDefault(); key.stopPropagation(); if (!source.duration) return;
    if (key.key === ' ') { if (playing) stop(); else void play(); return; }
    if (key.key === 'Home' || key.key === 'End') { seek(key.key === 'Home' ? 0 : source.duration); return; }
    const markers = key.shiftKey ? barMarkers : meter?.markers ?? [];
    if (!markers.length) return;
    seek(adjacentMarkerTick(markers, cursor, key.key === 'ArrowLeft' || key.key === 'ArrowDown' ? -1 : 1, source.duration));
  });
  container.querySelectorAll<HTMLInputElement>('.sw-views input').forEach(input => on(input, 'change', () => { stop(); view = input.value as typeof view; refreshView(); }));
  on(timeline, 'pointerdown', event => { const pointer = event as PointerEvent; if (pointer.button !== 0) return; drag = {id: pointer.pointerId, x: pointer.clientX, view: navigator.getViewport()}; suppressClick = false; timeline.setPointerCapture(pointer.pointerId); });
  on(timeline, 'pointermove', event => { const pointer = event as PointerEvent; if (!drag || pointer.pointerId !== drag.id) return; const dx = pointer.clientX - drag.x; if (Math.abs(dx) < 3 && !suppressClick) return; suppressClick = true; const delta = -dx / Math.max(1, timeline.clientWidth - 53) * (drag.view.to - drag.view.from); navigator.setViewport({from: drag.view.from + delta, to: drag.view.to + delta}); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(timeline, event, () => { drag = undefined; });
  on(timeline, 'click', event => { if (suppressClick) return; const mouse = event as MouseEvent, box = timeline.getBoundingClientRect(), xx = mouse.clientX - box.left, yy = mouse.clientY - box.top; const note = drawnNotes.slice().reverse().find(note => xx >= note.x && xx <= note.x + note.width && yy >= note.y && yy <= note.y + note.height); if (note) inspector.selectNote(note.id); });
  timeline.addEventListener('wheel', event => { event.preventDefault(); const {from, to} = navigator.getViewport(); if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) navigator.pan((event.deltaX || event.deltaY) / 500 * (to - from)); else { const fraction = Math.max(0, Math.min(1, (event.clientX - timeline.getBoundingClientRect().left - 43) / Math.max(1, timeline.clientWidth - 53))); navigator.zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * .002))), from + fraction * (to - from)); } }, {signal: abort.signal, passive: false});
  on(timeline, 'keydown', event => { const key = event as KeyboardEvent, range = navigator.getViewport(), span = range.to - range.from; if (!['ArrowLeft', 'ArrowRight', '+', '=', '-', '_', 'Home', 'End', ' '].includes(key.key)) return; key.preventDefault(); if (key.key === ' ') { if (playing) stop(); else void play(); } else if (key.key === 'Home') navigator.pan(-source.duration); else if (key.key === 'End') navigator.pan(source.duration); else if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') navigator.pan((key.key === 'ArrowLeft' ? -1 : 1) * span * (key.shiftKey ? .5 : .1)); else navigator.zoom(key.key === '+' || key.key === '=' ? .5 : 2); });
  on(container, 'score-workbench-load', async event => { const version = ++loadVersion; try { const detail = (event as CustomEvent<{score: Score; title: string; issues?: ScoreIssue[]}>).detail; if (!detail || typeof detail.title !== 'string') throw new Error('The supplied score needs a title.'); await callCore('validateScore', {score: detail.score}); if (!disposed && version === loadVersion) load(structuredClone(detail.score), detail.title, detail.issues ?? []); } catch (error) { if (!disposed && version === loadVersion) status(`Could not load the score: ${message(error)}`, true); } });
  function download(blob: Blob, suffix: string): void { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = URL.createObjectURL(blob); const link = get<HTMLAnchorElement>('download-ready'); link.href = downloadUrl; link.download = `${title.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'score'}-${suffix}`; link.textContent = `Save ${link.download}`; link.hidden = false; link.click(); }
  on(get('export'), 'click', async () => { const version = loadVersion, current = activeScore(), label = view; try { const bytes = await callCore('exportScoreMidi', {score: current}); if (!disposed && version === loadVersion) download(new Blob([Uint8Array.from(bytes).buffer], {type: 'audio/midi'}), `${label}.mid`); } catch (error) { if (!disposed && version === loadVersion) status(`MIDI export unavailable: ${message(error)}`, true); } });
  on(get('save-scene'), 'click', () => { if (!result) return; download(new Blob([JSON.stringify({scene: result.scene, provenance: provenance ?? null, sourceSha256: sourceSha256 ?? null, comparison: result.comparison}, null, 2) + '\n'], {type: 'application/json'}), 'scene.json'); status('Scene ready to save. Its executable materials contain retained source music.'); });
  const resize = new ResizeObserver(requestDraw); resize.observe(timeline); navigator.setScore(source); void generate();
  if ((import.meta as ImportMeta & {env: {DEV: boolean}}).env.DEV) void fetch('./__references', {signal: abort.signal}).then(async response => {
    if (!response.ok) return; const data: unknown = await response.json(); if (!Array.isArray(data) || disposed) return;
    const references = data.filter((item): item is LocalReference => item && ['id', 'artist', 'work', 'edition'].every(key => typeof item[key] === 'string') && Array.isArray(item.sourceUrls) && item.sourceUrls.every((value: unknown) => typeof value === 'string'));
    if (!references.length) return; const select = get<HTMLSelectElement>('reference'); references.forEach(reference => select.add(new Option(`${reference.game ?? reference.artist} · ${reference.work}`, reference.id))); get('reference-picker').hidden = false;
    on(select, 'change', async () => { const reference = references.find(item => item.id === select.value); if (!reference) return; const version = ++loadVersion; stop(); status(`Opening ${reference.work}…`); try { const response = await fetch(`./__references/${encodeURIComponent(reference.id)}`, {signal: abort.signal}); if (!response.ok) throw new Error('The local reference is unavailable.'); await openBytes(new Uint8Array(await response.arrayBuffer()), reference.work, version, reference); } catch (error) { if (!disposed && version === loadVersion) status(`Could not open reference: ${message(error)}`, true); } });
  }).catch(() => { /* Local reference files are optional and absent in production. */ });
  return () => { disposed = true; loadVersion++; cancelScrub(); controller.dispose(); player.dispose(); abort.abort(); resize.disconnect(); cancelAnimationFrame(renderFrame); navigator.dispose(); if (downloadUrl) URL.revokeObjectURL(downloadUrl); container.replaceChildren(); container.classList.remove('score-workbench'); };
}
