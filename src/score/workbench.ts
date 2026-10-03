import './workbench.css';
import type { Score, ScoreIssue, ScoreNote } from './score';
import type { SceneNode } from '../core/generated/SceneNode';
import type { HarmonyWindow } from '../core/generated/HarmonyWindow';
import type { ScoreMeterMap } from '../core/generated/ScoreMeterMap';
import { ScorePlayer } from './playback';
import { mountScoreTimeline, type TimelineRegion, type TimelineLink } from './timeline';
import type { ScoreViewport } from './navigation';
import { mountSceneInspector } from './scene-inspector';
import { createScoreCodecController, type ScoreCodecResult } from './codec-controller';
import { callCore, type CoreCall } from '../core/client';

interface LocalReference {id: string; artist: string; work: string; game?: string; edition: string; sourceUrls: string[]}
/** Session state only: accepted source/program data survives a lab unmount.
 * Workers, DOM, playback and pending edits never enter the snapshot. */
export interface WorkbenchState {
  hasSource: boolean;
  source: Score;
  title: string;
  result?: ScoreCodecResult;
  issues: ScoreIssue[];
  provenance?: LocalReference;
  sourceSha256?: string;
  view: 'source' | 'decoded';
  viewport: ScoreViewport;
  cursor: number;
  selectedNodeId?: string;
  selectedNote: string;
  selectedIds: string[];
  generator: Record<string, string>;
  childRegions: boolean;
}
const roleColors = {core: '#94d4bd', color: '#be9fe4', residual: '#e5b075', unsupported: '#b2acb8', percussion: '#9eb6c9'};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function mountScoreWorkbench(container: HTMLElement, initialState?: WorkbenchState, call: CoreCall = callCore) {
  const abort = new AbortController(), player = new ScorePlayer(call);
  let hasSource = false;
  let source: Score = {ppq: 480, duration: 0, notes: [], parts: [], attachments: [], trackEnds: []};
  let title = 'Composition', result: ScoreCodecResult | undefined, view: 'source' | 'decoded' = 'source';
  let issues: ScoreIssue[] = [], provenance: LocalReference | undefined, sourceSha256: string | undefined;
  let selectedIds = new Set<string>(), selectedNote = '', selectedNode: SceneNode | undefined;
  let notesById = new Map<string, ScoreNote>();
  let harmonyById = new Map<string, HarmonyWindow>(), bandKey = '', codecFailure = false;
  let meter: ScoreMeterMap | undefined, meterError = '';
  let cursor = 0, playing = false, disposed = false, loadVersion = 0, playbackVersion = 0;
  let downloadUrl: string | undefined, warnings: string[] = [];
  let scrubbing = false, resumeAfterScrub = false;
  let pendingProgramTitle: string | undefined;
  container.classList.add('score-workbench');
  container.innerHTML = `<header class="sw-heading"><h2>Compose or import</h2><div class="sw-actions"><label class="button primary sw-open">Open MIDI<input data-sw="file" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="Open a local MIDI file"/></label><label class="sw-reference-picker" data-sw="reference-picker" hidden>Local references<select data-sw="reference"><option value="">Choose a reference…</option></select></label></div></header>
    <form class="sw-generator" data-sw="generator"><label>Seed<input data-sw="seed" type="number" min="0" max="4294967295" step="1" value="1" required/></label><label>Tempo<input data-sw="tempo" type="number" min="40" max="240" value="104" required/></label><label>Density<input data-sw="density" type="range" min="0" max="1" step="0.05" value="0.6"/></label><label>Variation<input data-sw="variation" type="range" min="0" max="1" step="0.05" value="0.35"/></label><button class="button primary" data-sw="generate" type="submit">Generate</button><button class="button quiet" data-sw="new-seed" type="button">New seed</button><details><summary>Composition</summary><div class="sw-generator-more"><label>Phrases<input data-sw="phrases" type="number" min="1" max="16" value="4" required/></label><label>Bars per phrase<input data-sw="bars" type="number" min="2" max="8" value="4" required/></label><label>Beats per bar<input data-sw="beats" type="number" min="2" max="9" value="4" required/></label><label>Tonic<select data-sw="tonic">${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'].map((name, value) => `<option value="${value}"${value === 2 ? ' selected' : ''}>${name}</option>`).join('')}</select></label><label>Mode<select data-sw="mode"><option value="major">Major</option><option value="minor">Minor</option><option value="dorian" selected>Dorian</option><option value="lydian">Lydian</option></select></label><label>Color<input data-sw="color" type="range" min="0" max="1" step="0.05" value="0.6"/></label></div></details></form>
    <p class="sw-status" data-sw="status" role="status" aria-live="polite">Loading the musical core…</p><a class="button" data-sw="download-ready" hidden>Save file</a>
    <section class="panel sw-score-panel"><div class="sw-score-heading"><div><h2 data-sw="title"></h2><p class="subtle" data-sw="inventory"></p></div><div class="sw-actions"><button class="button quiet" data-sw="rewind" aria-label="Return playback to start">↤</button><button class="button primary" data-sw="play" disabled>Play</button><button class="button quiet" data-sw="stop" disabled>Pause</button><output class="sw-position" data-sw="transport-label" aria-label="Playback location">—</output><button class="button quiet" data-sw="export" disabled>Export MIDI</button><button class="button quiet" data-sw="save-scene" disabled>Save scene</button></div></div>
      <div class="sw-codec-status" data-sw="codec" role="status">Waiting for a score.</div>
      <div class="sw-timeline-tools"><fieldset class="sw-views"><legend class="sw-sr-only">Score view</legend><label><input type="radio" name="score-view" value="source" checked/>Original source</label><label><input type="radio" name="score-view" value="decoded" disabled/><span data-sw="decoded-label">Decoded program</span></label></fieldset><label class="sw-inline-check"><input data-sw="regions" type="checkbox" checked/>Child regions</label></div>
      <div data-sw="harmony-decoration"><div class="sw-harmony-band-heading"><span data-sw="harmony-label">Global harmony · waiting for the scene</span><span>Chord / color hypotheses</span></div><div class="sw-harmony-band" data-sw="harmony-band" role="group" aria-label="Global harmony sequence in the current viewport"></div></div><div data-sw="timeline"></div><p class="sw-selection" data-sw="selection">Select a scene node or note.</p></section>
    <section class="panel sw-scene-panel" data-sw="scene"></section><details class="sw-details"><summary>Source and audition limits</summary><div data-sw="limits"></div></details>`;
  const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-sw="${name}"]`)!;
  const on = (element: HTMLElement, event: string, listener: EventListener) => element.addEventListener(event, listener, {signal: abort.signal});
  const activeScore = () => view === 'decoded' && result ? result.decoded : source;
  const status = (text: string, error = false) => { get('status').textContent = text; get('status').classList.toggle('sw-error', error); };
  const timeline = mountScoreTimeline(get('timeline'), {
    aboveRoll: get('harmony-decoration'),
    onSeek: (tick, mode) => { if (mode === 'scrub') { cursor = tick; renderTransport(); } else seek(tick); },
    onScrubStart: () => { const resume = playing; stop(); scrubbing = true; resumeAfterScrub = resume; },
    onScrubEnd: cancelled => { const resume = resumeAfterScrub; scrubbing = false; resumeAfterScrub = false; if (!cancelled && resume && cursor < source.duration) void play(); },
    onTogglePlayback: () => { if (playing) stop(); else void play(); },
    onSelectNote: id => inspector.selectNote(id),
    onViewportChange: ({from, to}) => renderHarmonyBand(from, to),
  });
  const positionLabel = timeline.positionLabel;
  const selectedHarmony = () => selectedNode ? harmonyById.get(selectedNode.id) : undefined;
  function selectionRange(): ScoreViewport | null {
    const window = selectedHarmony(); if (window) return {from: window.startTick, to: window.endTick};
    let from = Infinity, to = -Infinity;
    for (const id of selectedIds) { const note = notesById.get(id); if (note) { from = Math.min(from, note.onset); to = Math.max(to, note.onset + note.duration); } }
    return from === Infinity ? null : {from, to: Math.min(source.duration, Math.max(from + 1, to))};
  }
  const inspector = mountSceneInspector(get('scene'), {
    select: (node, noteId, members) => {
      selectedNode = node; selectedIds = new Set(members ?? node?.noteIds ?? []); selectedNote = noteId ?? '';
      get('selection').textContent = node ? `${node.label} · ${selectedIds.size} highlighted of ${node.noteIds.length} member notes${selectedHarmony() ? ' · roles apply only within the selected harmonic window' : ''}${noteId ? ' · selected note outlined in amber' : ''}.` : 'Select a scene node or a note to inspect its meaning.';
      renderTransport(); refreshTimeline();
    },
    fit: () => { const selection = selectionRange(); if (selection) timeline.setViewport(selection); },
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
    } else if (snapshot.status === 'error') { codecFailure = !result; pendingProgramTitle = undefined; bandKey = ''; codec.textContent = `${result ? 'Change not applied; previous program retained' : 'Scene unavailable'}: ${snapshot.error}.`; refreshTimeline(); }
    else codec.textContent = ({encoding: 'Encoding the complete score into a musical scene…', editing: 'Applying the change to the current program…', decoding: 'Decoding the scene through the composition compiler…', verifying: 'Comparing decoded note events with the immutable original source…'}[snapshot.status]);
  }});
  function refreshView(): void {
    const viewport = timeline.getViewport(), score = activeScore();
    notesById = new Map(score.notes.map(note => [note.id, note]));
    timeline.setScore(score, {preserveViewport: true}); timeline.setViewport(viewport); timeline.setCursor(cursor);
    get('play').title = get('export').title = `Uses ${view === 'source' ? 'original source' : 'current program'}`;
    refreshTimeline();
  }
  function renderTransport(): void {
    get('transport-label').textContent = positionLabel(cursor); get('transport-label').title = `${positionLabel(cursor)} · tick ${Math.round(cursor)}${meterError ? ` · ${meterError}` : ''}`;
    timeline.setCursor(cursor);
    get<HTMLButtonElement>('play').disabled = playing || !source.notes.length; get<HTMLButtonElement>('stop').disabled = !playing;
  }
  function stop(): void { playbackVersion++; playing = false; if (scrubbing) resumeAfterScrub = false; player.stop(); renderTransport(); }
  function seek(tick: number, resume = playing): void { stop(); cursor = Math.max(0, Math.min(source.duration, Math.round(tick))); renderTransport(); if (resume && cursor < source.duration) void play(); }
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
  function refreshTimeline(): void {
    const harmony = selectedHarmony();
    timeline.setSelection({noteIds: [...selectedIds], focusedNoteId: selectedNote, range: selectionRange(),
      highlightRange: harmony ? {from: harmony.startTick, to: harmony.endTick} : undefined,
      noteColors: harmony ? new Map(harmony.roles.map(item => [item.noteId, roleColors[item.role]])) : undefined});
    const links: TimelineLink[] = [], regions: TimelineRegion[] = [];
    if (result && selectedNode) {
      if (selectedNode.kind === 'elaboration') {
        const members = new Set(selectedNode.noteIds);
        for (const relation of result.scene.pitchRelations) if (relation.selected && members.has(relation.noteId)) {
          for (const id of new Set([...relation.fromNoteIds, ...relation.toNoteIds])) links.push({fromNoteId: id, toNoteId: relation.noteId});
        }
      }
      const children = new Set(selectedNode.children), drawChildren = get<HTMLInputElement>('regions').checked;
      for (const node of [...(drawChildren ? result.scene.nodes.filter(node => children.has(node.id) && node.id !== selectedNode!.id) : []), selectedNode]) {
        let from = Infinity, to = -Infinity, low = Infinity, high = -Infinity;
        for (const id of node.noteIds) {
          const note = notesById.get(id); if (!note) continue;
          from = Math.min(from, note.onset); to = Math.max(to, note.onset + note.duration);
          for (const pitch of [note.pitch, ...note.pitchEnvelope?.map(point => point.pitch) ?? []]) { low = Math.min(low, pitch.millicents); high = Math.max(high, pitch.millicents); }
        }
        const window = harmonyById.get(node.id); if (window) { from = window.startTick; to = window.endTick; }
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        const selected = node.id === selectedNode.id;
        regions.push({from, to, low: Number.isFinite(low) ? low : undefined, high: Number.isFinite(high) ? high : undefined, selected,
          label: selected ? node.label + (node.kind === 'rhythm' && node.materialId ? ` · ${node.materialId}` : '') : undefined});
      }
    }
    timeline.setOverlays({regions, links});
    const {from, to} = timeline.getViewport(); renderHarmonyBand(from, to); renderTransport();
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
    stop();
    hasSource = true;
    source = score; title = name; issues = importIssues; provenance = reference; sourceSha256 = hash; result = undefined; view = 'source'; cursor = 0; warnings = []; meter = undefined; meterError = '';
    notesById = new Map(score.notes.map(note => [note.id, note]));
    selectedIds.clear(); selectedNode = undefined; selectedNote = ''; harmonyById.clear(); bandKey = ''; codecFailure = false;
    get('title').textContent = title; get('inventory').textContent = `${score.notes.length.toLocaleString()} notes · ${score.parts.length} parts · ${Number((score.duration / score.ppq).toFixed(2))} quarter notes`;
    container.querySelectorAll<HTMLInputElement>('.sw-views input').forEach(input => { input.checked = input.value === 'source'; input.disabled = input.value === 'decoded'; });
    get<HTMLButtonElement>('export').disabled = score.trackEnds.length === 0; get<HTMLButtonElement>('save-scene').disabled = true;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = undefined; get('download-ready').hidden = true;
    get('decoded-label').textContent = 'Decoded program';
    timeline.setScore(score); timeline.setMeter(); inspector.setScene(score); renderLimits(); if (analyze) { pendingProgramTitle = undefined; controller.setSource(score); } refreshTimeline();
    const version = loadVersion;
    void call('scoreMeter', {score}).then(map => { if (!disposed && version === loadVersion) { meter = map; timeline.setMeter(map); bandKey = ''; renderLimits(); refreshTimeline(); } }).catch(error => { if (!disposed && version === loadVersion) { meterError = `Score meter unavailable: ${message(error)}`; timeline.setMeter(undefined, meterError); renderLimits(); refreshTimeline(); } });
    void call('compilePerformance', {score}).then(performance => { if (!disposed && version === loadVersion) { warnings = performance.warnings; renderLimits(); } }).catch(error => { if (!disposed && version === loadVersion) { warnings = [`Audition unavailable: ${message(error)}`]; renderLimits(); } });
  }
  function restore(saved: WorkbenchState): void {
    const state = structuredClone(saved);
    get('generator').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => {
      const value = input.dataset.sw ? state.generator[input.dataset.sw] : undefined;
      if (value !== undefined) input.value = value;
    });
    get<HTMLInputElement>('regions').checked = state.childRegions;
    if (!state.hasSource) { void generate(); return; }
    load(state.source, state.title, state.issues, state.provenance, state.sourceSha256, !state.result);
    if (state.result) controller.restore(state.result);
    view = state.view === 'decoded' && result ? 'decoded' : 'source';
    cursor = Math.max(0, Math.min(source.duration, state.cursor));
    container.querySelectorAll<HTMLInputElement>('.sw-views input').forEach(input => { input.checked = input.value === view; });
    refreshView(); timeline.setViewport(state.viewport);
    if (state.selectedNodeId) inspector.selectNode(state.selectedNodeId);
    if (state.selectedNote) inspector.selectNote(state.selectedNote);
    selectedIds = new Set(state.selectedIds); refreshTimeline();
  }
  async function openBytes(bytes: Uint8Array, name: string, version: number, reference?: LocalReference): Promise<void> {
    const [imported, digest] = await Promise.all([call('importMidi', {bytes: Array.from(bytes)}), crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)]);
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
    try { const scene = await call('generateComposition', {options}); if (!disposed && version === loadVersion) { pendingProgramTitle = `Composition · seed ${options.seed}`; controller.setProgram(scene); } }
    catch (error) { if (!disposed && version === loadVersion) status(`Could not generate: ${message(error)}`, true); }
    finally { if (!disposed) get<HTMLButtonElement>('generate').disabled = false; }
  }
  on(get('generator'), 'submit', event => { event.preventDefault(); void generate(); });
  on(get('new-seed'), 'click', () => { get<HTMLInputElement>('seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]); void generate(); });
  on(get('play'), 'click', () => { void play(); });
  on(get('stop'), 'click', stop); on(container, 'score-workbench-stop', stop); on(get('rewind'), 'click', () => seek(0));
  on(get('regions'), 'change', refreshTimeline);
  container.querySelectorAll<HTMLInputElement>('.sw-views input').forEach(input => on(input, 'change', () => { stop(); view = input.value as typeof view; refreshView(); }));
  on(container, 'score-workbench-load', async event => { const version = ++loadVersion; try { const detail = (event as CustomEvent<{score: Score; title: string; issues?: ScoreIssue[]}>).detail; if (!detail || typeof detail.title !== 'string') throw new Error('The supplied score needs a title.'); await call('validateScore', {score: detail.score}); if (!disposed && version === loadVersion) load(structuredClone(detail.score), detail.title, detail.issues ?? []); } catch (error) { if (!disposed && version === loadVersion) status(`Could not load the score: ${message(error)}`, true); } });
  function download(blob: Blob, suffix: string): void { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = URL.createObjectURL(blob); const link = get<HTMLAnchorElement>('download-ready'); link.href = downloadUrl; link.download = `${title.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'score'}-${suffix}`; link.textContent = `Save ${link.download}`; link.hidden = false; link.click(); }
  on(get('export'), 'click', async () => { const version = loadVersion, current = activeScore(), label = view; try { const bytes = await call('exportScoreMidi', {score: current}); if (!disposed && version === loadVersion) download(new Blob([Uint8Array.from(bytes).buffer], {type: 'audio/midi'}), `${label}.mid`); } catch (error) { if (!disposed && version === loadVersion) status(`MIDI export unavailable: ${message(error)}`, true); } });
  on(get('save-scene'), 'click', () => { if (!result) return; download(new Blob([JSON.stringify({scene: result.scene, provenance: provenance ?? null, sourceSha256: sourceSha256 ?? null, comparison: result.comparison}, null, 2) + '\n'], {type: 'application/json'}), 'scene.json'); status('Scene ready to save. Its executable materials contain retained source music.'); });
  timeline.setScore(source);
  if (initialState) restore(initialState); else void generate();
  if ((import.meta as ImportMeta & {env: {DEV: boolean}}).env.DEV) void fetch('./__references', {signal: abort.signal}).then(async response => {
    if (!response.ok) return; const data: unknown = await response.json(); if (!Array.isArray(data) || disposed) return;
    const references = data.filter((item): item is LocalReference => item && ['id', 'artist', 'work', 'edition'].every(key => typeof item[key] === 'string') && Array.isArray(item.sourceUrls) && item.sourceUrls.every((value: unknown) => typeof value === 'string'));
    if (!references.length) return; const select = get<HTMLSelectElement>('reference'); references.forEach(reference => select.add(new Option(`${reference.game ?? reference.artist} · ${reference.work}`, reference.id))); get('reference-picker').hidden = false;
    on(select, 'change', async () => { const reference = references.find(item => item.id === select.value); if (!reference) return; const version = ++loadVersion; stop(); status(`Opening ${reference.work}…`); try { const response = await fetch(`./__references/${encodeURIComponent(reference.id)}`, {signal: abort.signal}); if (!response.ok) throw new Error('The local reference is unavailable.'); await openBytes(new Uint8Array(await response.arrayBuffer()), reference.work, version, reference); } catch (error) { if (!disposed && version === loadVersion) status(`Could not open reference: ${message(error)}`, true); } });
  }).catch(() => { /* Local reference files are optional and absent in production. */ });
  return {
    snapshot(): WorkbenchState {
      const generator: Record<string, string> = {};
      get('generator').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => { if (input.dataset.sw) generator[input.dataset.sw] = input.value; });
      return structuredClone({hasSource, source, title, result, issues, provenance, sourceSha256, view, viewport: timeline.getViewport(), cursor,
        selectedNodeId: selectedNode?.id, selectedNote, selectedIds: [...selectedIds], generator, childRegions: get<HTMLInputElement>('regions').checked});
    },
    dispose(): void {
      disposed = true; loadVersion++; stop(); controller.dispose(); player.dispose(); abort.abort(); timeline.dispose();
      if (downloadUrl) URL.revokeObjectURL(downloadUrl); container.replaceChildren(); container.classList.remove('score-workbench');
    },
  };
}
