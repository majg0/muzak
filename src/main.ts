import "./style.css";
import { COMPOSITION_STUDIES, compositionStudy } from "./composition-studies";
import { explorationPerformance } from "./exploration";
import { lyricalPerformance } from "./lyrical";
import { resolveCompositionProfile } from "./composition-profile";
import { createHarmonyPanel } from "./harmony-panel";
import { MusicEngine } from "./engine";
import { AudioPlayer, renderOffline, encodeWav } from "./audio";
import { exportMidi } from "./midi";
import {
  PARAMETER_DEFINITIONS,
  DEFAULT_WEIGHTS,
  PRESETS,
  interpolateParameters,
  evaluateAutomation,
  normalizeParameters,
} from "./parameters";
import {
  createPerformance,
  serializePerformance,
  parsePerformance,
  upgradeParameterVector,
  encodeShareState,
  loadPresets,
  savePresets,
  recordLiveParameters,
  scheduleParameterTransition,
} from "./serialization";
import {
  ENGINE_VERSION,
  FRAME_TICKS,
  PPQ,
  type Frame,
  type Parameters,
  type ParameterKey,
  type Preset,
  type Performance,
  type ScoreKey,
} from "./types";
import {
  degreeToPitch,
  pitchToMidi,
  pitchToHz,
  pitchLabel,
  TUNINGS,
  type TuningId,
} from "./pitch";
import { DEFAULT_SOUND, SPECTRA, type SoundConfig } from "./spectrum";
import { formAt, barToTick } from "./conductor";
import { DEFAULT_PHRASING } from "./phrasing";
import { createPhrasePanel, compositionExpressionMarkup } from "./phrase-panel";
import { preparePlayback } from "./navigation";
import { freshSeed, newSeedPerformance, readRecentPerformances, rememberPerformance } from "./sessions";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icons: Record<string, string> = {
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
  share: '<path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  volume:
    '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const noteName = (n: number, octave = false) =>
  ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][
    ((n % 12) + 12) % 12
  ] + (octave ? Math.floor(n / 12) - 1 : "");
const conductorConfig = () => performance.conductor ?? resolveCompositionProfile(performance).conductor;
const formForTick = (tick: number) => formAt(performance.seed, Math.max(0, Math.floor(tick)), conductorConfig(), performance.sound.tuning);
const barTick = (bar: number) => barToTick(performance.seed, Math.max(0, Math.round(bar) - 1), conductorConfig(), performance.sound.tuning);
const barLabel = (tick: number) => { const form = formForTick(tick); return `${form.bar + 1}.${Math.floor(form.beat)}`; };
const percent = (n: number) => `${Math.round(n * 100)}%`;
const valueLabel = (key: ParameterKey, v: number) =>
  key === "tempo" ? `${Math.round(v)} BPM` : percent(v);
let customPresets = loadPresets();
let performance: Performance;
let initialMessage = "";
let previousRecipe: string | null = null;
let sessionWriteAllowed = true;
let loadedLocalRecipe: string | null = null;
try { loadedLocalRecipe = localStorage.getItem("continuum.session"); } catch { sessionWriteAllowed = false; }
let freshOnReload = true;
try { freshOnReload = localStorage.getItem("continuum.fresh-on-reload") !== "false"; } catch { /* Storage is optional. */ }
const priorVersions = ["continuum-2.0.0", "continuum-3.0.0", "continuum-4.0.0", "continuum-4.1.0", "continuum-4.2.0", "continuum-5.0.0", "continuum-6.0.0", "continuum-7.0.0", "continuum-8.0.0", "continuum-9.0.0", "continuum-10.0.0", "continuum-11.0.0", "continuum-12.0.0", "continuum-13.0.0", "continuum-14.0.0", "continuum-15.0.0", "continuum-16.0.0", "continuum-17.0.0", "continuum-18.0.0", "continuum-19.0.0"];
function normalizedRecipe(recipe: Performance): Performance {
  return { ...recipe, ...resolveCompositionProfile(recipe) };
}
function preserveRawRecipe(raw: string) {
  try { if (rememberPerformance(localStorage, raw)) return; } catch { /* Preserve it in Export when storage is unavailable. */ }
  previousRecipe = raw;
  sessionWriteAllowed = false;
}
function reinterpreted(source: Partial<Performance>, recipe: Performance): boolean {
  return source.engineVersion !== recipe.engineVersion
    || JSON.stringify(source.conductor) !== JSON.stringify(recipe.conductor)
    || JSON.stringify(source.phrasing) !== JSON.stringify(recipe.phrasing);
}
function clearRecipeLocation() {
  const url = new URL(location.href);
  if (url.hash.startsWith("#p=")) url.hash = "";
  url.searchParams.delete("at");
  history.replaceState(null, "", url);
}
function readCompatibleRecipe(stored: string): Performance {
  const source = JSON.parse(stored);
  let recipe: Performance;
  if (source.engineVersion !== ENGINE_VERSION && priorVersions.includes(source.engineVersion)) {
    recipe = parsePerformance(JSON.stringify({ ...source, engineVersion: ENGINE_VERSION, initialParameters: upgradeParameterVector(source.initialParameters) }));
  } else recipe = parsePerformance(stored);
  recipe = normalizedRecipe(recipe);
  if (reinterpreted(source, recipe)) {
    preserveRawRecipe(stored);
    initialMessage = "Your settings now use the shared composition plan. The original recipe is preserved; this engine makes a new interpretation.";
  }
  return recipe;
}
function readSharedRecipe(hash: string): Performance {
  if (hash.length > 4_000_000) throw new Error("The shared performance is too large.");
  const payload = new URLSearchParams(hash.replace(/^#/, "")).get("p");
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("The shared performance is invalid.");
  const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  return readCompatibleRecipe(raw);
}
try {
  if (location.hash.startsWith("#p=")) {
    if (loadedLocalRecipe) {
      if (!rememberPerformance(localStorage, loadedLocalRecipe)) {
        previousRecipe = loadedLocalRecipe; sessionWriteAllowed = false;
      }
    }
    performance = readSharedRecipe(location.hash);
  } else {
    const stored = loadedLocalRecipe;
    if (stored) {
      const source = JSON.parse(stored);
      if (source.engineVersion !== ENGINE_VERSION && priorVersions.includes(source.engineVersion)) {
        previousRecipe = stored;
        try { localStorage.setItem(`continuum.previous-${source.engineVersion}`, stored); }
        catch { sessionWriteAllowed = false; }
        performance = readCompatibleRecipe(stored);
        initialMessage = "Your seed, settings, automation and bookmarks are retained. The updated composer makes a new interpretation; the original recipe is backed up in Export.";
      } else performance = readCompatibleRecipe(stored);
      if (freshOnReload) {
        const archived = rememberPerformance(localStorage, stored);
        if (!archived) { previousRecipe = stored; sessionWriteAllowed = false; }
        performance = newSeedPerformance(performance, freshSeed());
        clearRecipeLocation();
        initialMessage = archived ? "Fresh seed · settings retained · your previous performance is in Recent performances." : "Fresh seed · storage unavailable; the previous recipe is preserved in Export.";
      }
    } else performance = lyricalPerformance(createPerformance(freshSeed(), PRESETS[0])).recipe;
  }
} catch (error) {
  // Preserve an unreadable/incompatible local document instead of overwriting
  // it with the fallback performance during a development reload or upgrade.
  if (loadedLocalRecipe) { previousRecipe = loadedLocalRecipe; sessionWriteAllowed = false; }
  performance = lyricalPerformance(createPerformance(freshSeed(), PRESETS[0])).recipe;
  initialMessage = `Started a fresh performance: ${(error as Error).message}`;
}
let params = { ...performance.initialParameters };
let engine = makeEngine();
let frames: Frame[] = [];
let previewFrames: Frame[] = [];
let currentFrame: Frame | undefined;
let pendingFrame: Frame | undefined;
let visualRevision = 0;
let queuedFirstFrame: Frame | undefined;
let phrasePanel: ReturnType<typeof createPhrasePanel> | undefined;
let harmonyPanel: ReturnType<typeof createHarmonyPanel> | undefined;
let seekPosition = 0;
let hasAudioPosition = false;
let needsReconstruction = false;
let lastObservedTick = 0;
const playbackTick = () => hasAudioPosition ? player.currentTick : seekPosition;
let formRenderGeneration = 0;
let currentGroup = "Harmony";
let chosenPresetId = performance.presetId;
let morphFrom = { ...params };
let morphTargetId = PRESETS[1].id;
let busy = false;
let seekCancelled = false;
let undoneTimeline:
  Pick<Performance, "automation" | "automationRevisions"> | undefined;
let uiTimer = 0;
const COLORS = [
  "#b8a1ed",
  "#988fe5",
  "#79beb1",
  "#d5b783",
  "#e299a7",
  "#738792",
];
const MAX_HISTORY = 8192;
function engineConfig(sound = performance.sound) {
  return {
    seed: performance.seed,
    parameters: performance.initialParameters,
    automation: performance.automation,
    automationRevisions: performance.automationRevisions,
    weights: performance.weights,
    sound,
    conductor: performance.conductor,
    phrasing: performance.phrasing,
  };
}
function makeEngine(sound = performance.sound) { return new MusicEngine(engineConfig(sound)); }
function allPresets() {
  return [...PRESETS, ...customPresets];
}
function persist() {
  formRenderGeneration++;
  if (!sessionWriteAllowed) return;
  try {
    localStorage.setItem(
      "continuum.session",
      serializePerformance(performance),
    );
  } catch {
    /* Export remains available when storage is disabled. */
  }
}
function archiveCurrent() {
  const serialized = serializePerformance(performance);
  try { if (rememberPerformance(localStorage, serialized)) return; } catch { /* Keep a recoverable in-memory copy. */ }
  previousRecipe = serialized;
  sessionWriteAllowed = false;
}
async function loadRecipe(recipe: Performance, play = false, sourceRaw?: string) {
  archiveCurrent();
  const normalized = normalizedRecipe(recipe);
  // Retain an incoming original after archiving the outgoing performance:
  // when storage fails, Export is the incoming document's last recovery path.
  if (sourceRaw && reinterpreted(JSON.parse(sourceRaw), normalized)) preserveRawRecipe(sourceRaw);
  else if (reinterpreted(recipe, normalized)) preserveRawRecipe(JSON.stringify(recipe));
  pauseAuditions(); player.stop();
  performance = normalized;
  chosenPresetId = recipe.presetId;
  $<HTMLInputElement>("#seed").value = recipe.seed;
  // A subsequently edited/imported recipe must not be hidden by an older URL recipe on reload.
  clearRecipeLocation();
  invalidateTimelineUndo(); clearComparison(); persist();
  renderConductorSettings(); phrasePanel?.sync(); harmonyPanel?.sync();
  await restartAt(0, play);
  morphFrom = { ...recipe.initialParameters };
  $<HTMLInputElement>("#morph").value = "0";
  $("#morph-value").textContent = "0%";
  renderSoundControls(); renderPresets(); renderAutomation(); createScoreControls(); generatePreview();
}
function showFrame(frame: Frame) {
  pendingFrame = undefined;
  visualRevision++;
  currentFrame = frame;
  params = { ...frame.parameters };
  updateReadout(); updateSliders(); renderMemory(); renderScores();
  updateSoundReadout(frame); updateConductor(frame); phrasePanel?.update(frame); harmonyPanel?.update(frame);
}
function holdFailedPosition(tick: number) {
  pendingFrame = undefined;
  hasAudioPosition = false;
  needsReconstruction = true;
  seekPosition = Math.max(0, Math.floor(tick / FRAME_TICKS) * FRAME_TICKS);
  queuedFirstFrame = currentFrame = undefined;
  frames = []; previewFrames = [];
  updateConductor(); phrasePanel?.update(); harmonyPanel?.update(); updateTransport();
}
const player = new AudioPlayer({
  nextFrame: () => {
    const frame = queuedFirstFrame ?? engine.step();
    queuedFirstFrame = undefined;
    hasAudioPosition = true;
    frames.push(frame);
    if (frames.length > MAX_HISTORY) frames.shift();
    return frame;
  },
  // The audio timer only publishes the audible frame. Expensive score DOM and
  // canvas work belongs to the display loop, outside the scheduling deadline.
  onFrame: frame => { pendingFrame = frame; lastObservedTick = frame.tick; },
  onStatus: () => updateTransport(),
  onError: (error) => { holdFailedPosition(lastObservedTick); toast(`Playback stopped: ${error.message}. Press Play to retry, or choose another section.`); },
});

$("#app").innerHTML = `
<header class="topbar"><a class="brand" href="#" aria-label="Continuum home"><span class="brand-mark">∿</span>continuum<span class="brand-period">.</span></a><span class="brand-description">A GENERATIVE INSTRUMENT</span><div class="top-actions"><span class="local-badge"><i></i> All music, on your device</span><button id="about" class="icon-button" aria-label="About this instrument">${icon("info")}</button><button id="share" class="button quiet">${icon("share")}<span>Share performance</span></button><button id="export" class="button">${icon("download")}<span>Export</span></button></div></header>
<main>
  <section class="intro"><div><div class="eyebrow">DETERMINISTIC BY NATURE. ENDLESS BY DESIGN.</div><h1>Find the music between.</h1><p>A seed, a little intention, and somewhere new to go.</p></div><div class="engine-badge"><span class="orbit-symbol">◎</span><div>CONTINUUM ENGINE<span>${ENGINE_VERSION.replace("continuum-", "v")} <b>•</b> 8-step horizon</span></div></div></section>
  <section class="transport panel" aria-label="Playback controls"><div class="transport-start"><button id="play" class="play-button" aria-label="Play">${icon("play")}<span>Play</span></button><button id="restart" class="icon-button" aria-label="Restart exact performance" title="Replay the seed and recorded automation from the beginning">${icon("restart")}</button><div class="transport-position"><strong id="position">001 <span>: 01</span></strong><span id="transport-state">READY TO EXPLORE</span></div></div><div class="seed-control"><label for="seed">SEED</label><input id="seed" value="${esc(performance.seed)}" maxlength="128" spellcheck="false" aria-label="Seed"/><button id="copy-seed" class="icon-button small" aria-label="Copy seed">${icon("copy")}</button><button id="random-seed" class="icon-button small" aria-label="Randomize seed">${icon("dice")}</button></div><label class="tempo-control">TEMPO <input id="tempo" type="number" min="40" max="180" step="1" value="${params.tempo}"/><span>BPM</span></label><div class="volume-control">${icon("volume")}<input id="volume" aria-label="Volume" type="range" min="0" max="1" step="0.01" value="0.65"/><div class="level"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></section>
  <div class="session-options"><label><input id="fresh-on-reload" type="checkbox" ${freshOnReload ? "checked" : ""}/>New seed on reload</label><span id="composition-character">Keep a favorite in Recent performances.</span><button id="recent-performances" class="button quiet">Recent performances</button><button id="lyrical-score" class="button" title="A parameter recipe favoring connected melodies, remembered themes and gentle departures. Uses the same composition plan; saves this performance.">Singing themes</button><button id="composition-studies" class="button quiet">Composition studies</button><button id="wide-exploration" class="button quiet" title="New seed and wider parameter ranges in the same composition plan. Keeps BPM; saves this performance and clears its automation.">Wide exploration ${icon("dice")}</button></div>
  <div class="workspace"><div class="main-column">
    <section class="panel voice-panel"><div class="panel-heading"><div><span class="eyebrow">THE CURRENT</span><h2>Voices in motion <span class="live-tag" id="live-tag">SEED PREVIEW</span></h2></div><button id="bookmark" class="button quiet" aria-label="Bookmark current moment">${icon("bookmark")}<span>Bookmark</span></button></div><div class="voice-legend"><span><i style="--dot:${COLORS[0]}"></i>Upper voices</span><span><i style="--dot:${COLORS[4]}"></i>Bass</span><span><i style="--dot:${COLORS[3]}"></i>Melody</span><span class="legend-note">Small steps. New harmonic worlds.</span></div><div class="roll-wrap"><canvas id="piano-roll" aria-label="Piano roll showing individual voice movement"></canvas><div id="roll-empty" class="roll-overlay" hidden>Preparing your seed…</div></div><div class="harmonic-strip"><div><span>TONAL GRAVITY</span><strong id="tonal-center">—</strong></div><div><span>PITCH COLLECTION</span><strong id="pitch-collection">—</strong></div><div><span>BASS</span><strong id="bass-note">—</strong></div><div><span>VOICE MOVEMENT</span><strong id="voice-distance">— <small>st</small></strong></div><div><span>HARMONIC DISTANCE</span><strong id="harmonic-distance">—</strong></div></div></section>
    <section class="panel controls-panel"><div class="panel-heading"><div><span class="eyebrow">SHAPE THE INTENTION</span><h2>Musical character</h2></div><span class="subtle tiny">Changes become part of your performance</span></div><div class="parameter-tabs" role="tablist" aria-label="Parameter groups">${["Harmony", "Motion", "Melody", "Rhythm", "Texture"].map((x) => `<button role="tab" aria-selected="${x === currentGroup}" data-group="${x}" class="${x === currentGroup ? "active" : ""}">${x}</button>`).join("")}</div><div id="parameter-controls" class="parameter-grid"></div></section>
    <section class="panel tension-panel"><div class="panel-heading"><div><span class="eyebrow">EBB & FLOW</span><h2>Tension & orchestral force</h2></div><div class="tension-legend"><span><i></i>Actual</span><span><i></i>Target</span><strong id="tension-value">—</strong></div></div><p id="tension-explanation" class="subtle tiny">Harmonic tension follows friction, ambiguity and voice movement. Rhythm, layering and dynamics supply orchestral force.</p><canvas id="tension-chart" aria-label="Actual and target harmonic tension history"></canvas><div class="tension-components" id="tension-components"></div><div id="orchestration-readout" class="orchestration-readout" aria-label="Requested energy and measured score activity"></div></section>
  </div><aside class="side-column">
    <section class="panel palette-panel"><div class="panel-heading"><div><span class="eyebrow">START SOMEWHERE</span><h2>Sound worlds</h2></div><button id="save-preset" class="icon-button" aria-label="Save or duplicate current preset" title="Save your current settings as a preset">${icon("plus")}</button></div><div id="preset-list" class="preset-list"></div><div class="morph-area"><div class="morph-heading"><span>MORPH TO ANOTHER WORLD</span><button id="reset-morph" title="Use current settings as morph starting point">Reset A</button></div><select id="morph-target" aria-label="Morph target preset"></select><div class="morph-labels"><span id="morph-origin">Current settings</span><span id="morph-value">0%</span></div><input id="morph" class="morph-slider" aria-label="Preset interpolation" type="range" min="0" max="1" step="0.01" value="0"/><div class="morph-scale"><span>A · Origin</span><span>Destination · B</span></div></div></section>
    <section class="panel memory-panel"><div class="panel-heading"><div><span class="eyebrow">A MUSICAL MEMORY</span><h2>Ideas that return</h2></div><span class="memory-count" id="memory-count">0</span></div><div id="memory-list"></div><p class="panel-footnote">Ideas rest, transform, and find their way back.</p></section>
  </aside></div>
  <section class="panel tuning-panel"><div class="panel-heading"><div><span class="eyebrow">A SMALL EXPERIMENT IN ANOTHER PITCH SPACE</span><h2>Tuning meets timbre <span class="count-tag">EXPERIMENTAL</span></h2></div><span class="subtle tiny" id="sound-mode-label"></span></div><div class="tuning-content"><div class="tuning-description"><p>What feels rough depends on what is sounding. Explore native 19, 24 and 31 equal divisions of the octave. Use the ensemble for expressive colors, or five explicit additive partials shared by synthesis and the sensory model.</p><div id="spectrum-plot" class="spectrum-plot" aria-label="Spectrum partial amplitudes"></div><p class="spectral-caption" id="spectrum-caption"></p><p class="tuning-reference">Based on <a href="https://sethares.engr.wisc.edu/consemi.html" target="_blank" rel="noopener noreferrer">William Sethares’s tuning–timbre relationship ↗</a>. Sensory roughness is one objective alongside movement, memory, and musical tension.</p></div><div id="sound-controls"></div></div><div class="roughness-readout"><div><span>MODEL ROUGHNESS</span><strong id="roughness-actual">—</strong></div><div><span>DESIRED TRAJECTORY</span><strong id="roughness-target">—</strong></div><div><span>SCORE CONTRIBUTION</span><strong id="roughness-score">—</strong></div><div><span>MEAN VOICE MOVEMENT</span><strong id="movement-cents">—</strong></div><p id="frequency-readout">Play to inspect the actual sounding frequencies.</p></div><div class="experiment-compare"><div><strong>A controlled comparison</strong><span>Same seed and intentions. Sixteen harmonic steps with the roughness term off, then on.</span></div><button id="compare-sound" class="button">Render A / B audition</button></div><div id="comparison-results"></div></section>
  <section class="panel timeline-panel"><div class="panel-heading"><div><span class="eyebrow">THE LONG VIEW</span><h2>Performance journey <span id="automation-count" class="count-tag">0 lanes</span></h2></div><div class="inline-actions"><button id="add-automation" class="button quiet">${icon("plus")}Add a transition</button><button id="replay" class="button quiet">${icon("restart")}Exact replay</button></div></div><div id="automation-lanes"></div><div class="bookmarks-row"><span class="eyebrow">BOOKMARKS</span><div id="bookmark-list"></div></div></section>
  <details class="panel lab-panel"><summary><span>${icon("info")} Inside the composition</span><span class="subtle">Planner diagnostics & scoring controls <b>⌄</b></span></summary><div class="lab-content"><div class="lab-intro"><h3>Every choice has a reason.</h3><p>The planner follows four voices and an independent bass through eight possible future steps. These weights change the musical hypotheses it uses to choose its next move.</p><p id="planner-status" class="mono"></p><p id="audio-timing" class="tiny subtle" aria-live="off">Audio timing appears during playback.</p><button id="reset-weights" class="button quiet">Reset scoring weights</button><p class="tiny subtle">Scoring changes start a new replay from the same seed.</p></div><div id="score-controls" class="score-controls"></div></div></details>
  <footer><span><span class="footer-mark">∿</span> Music = F(seed, intention, time)</span><span>No samples. No cloud. Your own unfolding composition.</span><button id="import" class="text-button">Import JSON ${icon("arrow")}</button></footer>
</main><div id="toast" role="status" aria-live="polite"></div><dialog id="dialog"><div id="dialog-content"></div></dialog><input id="import-file" type="file" accept=".json,application/json" hidden/>
`;

function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  window.clearTimeout(uiTimer);
  uiTimer = window.setTimeout(
    () => $("#toast").classList.remove("visible"),
    4200,
  );
}
function modal(title: string, content: string) {
  $("#dialog-content").innerHTML =
    `<div class="dialog-heading"><h2>${title}</h2><button class="icon-button" id="close-dialog" aria-label="Close dialog">${icon("close")}</button></div>${content}`;
  $("#close-dialog").onclick = () => $<HTMLDialogElement>("dialog").close();
  $<HTMLDialogElement>("dialog").showModal();
}
function setRangeFill(input: HTMLInputElement) {
  const fraction =
    (Number(input.value) - Number(input.min)) /
    (Number(input.max) - Number(input.min));
  input.style.setProperty("--fill", `${fraction * 100}%`);
}
let formRenderKey = "";
let formAudioUrl = "";
function createConductorPanel() {
  const section = document.createElement("section");
  section.className = "panel conductor-panel";
  section.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">A COMPOSITION WITH A DESTINATION</span><h2>Let the music lead <span class="count-tag" id="conductor-mode">COMPOSING</span></h2></div><button id="next-section" class="button quiet">Next section ${icon("arrow")}</button></div>
    <div class="conductor-now"><div><span class="eyebrow">NOW</span><strong id="form-name">An opening</strong><span id="form-phrase">A theme is taking shape.</span></div><div class="form-facts"><span id="form-meter">4 / 4</span><span id="form-subdivision">Eighths</span><span id="form-instrument">Keys</span><span id="form-tuning">12-TET</span></div></div>
    <p id="form-intent" class="form-intent"></p>
    <div id="form-route" class="form-route" aria-label="Upcoming musical sections"></div>
    <div class="form-identities"><span>THEME <strong id="form-theme">—</strong></span><span>GROOVE <strong id="form-groove">—</strong></span><span id="form-progress">—</span></div>
    <div id="composition-expression" class="composition-expression" aria-label="Shared expression and scored texture"></div><div class="conductor-settings"><label>Freedom <output id="autonomy-value"></output><input id="autonomy-amount" aria-label="Autonomous variation" type="range" min="0" max="1" step=".01"/></label><label>Form pace <output id="pace-value"></output><input id="form-pace" aria-label="Form pace" type="range" min="0" max="1" step=".01"/></label><label class="switch-label"><input id="tuning-travel" type="checkbox"/> Tuning journeys & glides</label><button id="apply-conductor" class="button primary">Apply & restart</button></div>
    <p class="conductor-explanation">Calm sweeps, returning themes and fast flights share a steady pulse. Crescendos and retreats prepare changes across several bars. Tuning journeys also enable selective glides within phrases. Tempo follows your BPM control or tempo lane; other manual parameter lanes also take priority.</p>
    <div class="form-audition"><button id="render-form" class="button">Render this section</button><span class="subtle tiny">An exact WAV of the current section, including its instruments and pitch glides.</span><div id="form-audio"></div></div>`;
  $(".session-options").after(section);
  const ensemble = document.createElement("button");
  ensemble.id = "expressive-ensemble";
  ensemble.className = "button quiet";
  ensemble.textContent = "Use changing ensemble instruments";
  $(".form-audition").prepend(ensemble);
  ensemble.onclick = async () => {
    if (busy) return;
    performance.sound = { ...performance.sound, tuning: "12tet", instrument: "ensemble", roughnessWeight: 0 };
    invalidateTimelineUndo(); clearComparison(); persist();
    await restartAt(0); renderSoundControls(); renderConductorSettings(); generatePreview();
    toast("Expressive ensemble · 12-TET home, native tuning journeys, and five changing instrument colors");
  };
  renderConductorSettings();
  $<HTMLInputElement>("#autonomy-amount").oninput = () => { $("#autonomy-value").textContent = percent(Number($<HTMLInputElement>("#autonomy-amount").value)); setRangeFill($<HTMLInputElement>("#autonomy-amount")); };
  $<HTMLInputElement>("#form-pace").oninput = () => { $("#pace-value").textContent = percent(Number($<HTMLInputElement>("#form-pace").value)); setRangeFill($<HTMLInputElement>("#form-pace")); };
  $("#apply-conductor").onclick = async () => {
    if (busy) return;
    const recipe = structuredClone(performance);
    recipe.conductor = { enabled: true, amount: Number($<HTMLInputElement>("#autonomy-amount").value), pace: Number($<HTMLInputElement>("#form-pace").value), tuningTravel: $<HTMLInputElement>("#tuning-travel").checked };
    await loadRecipe(recipe, player.playing || auditionsPlaying());
    toast("The same seed now follows your new form settings");
  };
  $("#next-section").title = "Jump immediately to the next section. Otherwise each section plays to its end.";
  $("#next-section").onclick = () => { if (!busy) void restartAt(formForTick(playbackTick()).sectionEndTick); };
  $("#render-form").onclick = async () => {
    const button = $<HTMLButtonElement>("#render-form");
    if (busy) return;
    const snapshot = structuredClone(performance);
    const generation = formRenderGeneration;
    const at = formForTick(playbackTick());
    const start = at.sectionStartTick, end = at.sectionEndTick;
    button.disabled = true; button.textContent = "Composing and rendering…";
    pauseAuditions(); player.pause(); updateTransport();
    try {
      const composer = new MusicEngine({ seed: snapshot.seed, parameters: snapshot.initialParameters, automation: snapshot.automation, automationRevisions: snapshot.automationRevisions, weights: snapshot.weights, sound: snapshot.sound, conductor: snapshot.conductor, phrasing: snapshot.phrasing });
      const passage: Frame[] = [];
      while (composer.tick < end) { const frame = composer.step(); if (frame.tick >= start) passage.push(frame); if (frame.index % 24 === 0) await new Promise(r => setTimeout(r, 0)); }
      const buffer = await renderOffline(passage, .65);
      if (generation !== formRenderGeneration) { toast("Section render discarded because the performance changed"); return; }
      if (formAudioUrl) URL.revokeObjectURL(formAudioUrl);
      formAudioUrl = URL.createObjectURL(new Blob([encodeWav(buffer) as unknown as BlobPart], { type: "audio/wav" }));
      $("#form-audio").innerHTML = `<strong>Section preview · ${esc(at.sectionName)} · seed ${esc(snapshot.seed)}</strong><audio controls src="${formAudioUrl}" aria-label="Rendered musical section"></audio><span class="tiny subtle">This recording has its own playhead. Live composition is paused during preview.</span><a href="${formAudioUrl}" download="continuum-section.wav">Download this section as WAV</a>`;
      $("#form-audio audio").onplay = () => { player.pause(); updateTransport(); };
    } catch (error) { toast(`Render failed: ${(error as Error).message}`); }
    finally { button.disabled = false; button.textContent = "Render this section"; }
  };
}
function renderConductorSettings() {
  const config = conductorConfig();
  $<HTMLInputElement>("#tuning-travel").checked = config.tuningTravel;
  $<HTMLInputElement>("#autonomy-amount").value = String(config.amount);
  $<HTMLInputElement>("#form-pace").value = String(config.pace);
  $("#autonomy-value").textContent = percent(config.amount);
  $("#pace-value").textContent = percent(config.pace);
  formRenderKey = "";
  updateConductor();
}
function updateConductor(frame?: Frame) {
  if (!document.querySelector("#conductor-mode")) return;
  $("#composition-character").textContent = "One composition · choose an intention, then shape its range";
  const form = frame?.form ?? formForTick(playbackTick());
  const expression = frame?.diagnostics.compositionExpression;
  const colors = [...new Set(frame?.notes.filter(note => note.part !== 'percussion').map(note => note.timbre).filter(Boolean) ?? [])];
  $("#conductor-mode").textContent = "COMPOSING";
  $("#form-name").textContent = form.sectionName;
  $("#form-phrase").textContent = `Movement ${form.cycle + 1} · ${form.formName ?? "Evolving form"}`;
  const direction = form.behavior?.phase === 'prepare' && form.behavior.destinationSection !== undefined
    ? `Preparing a destination ${form.behavior.destinationSection - form.sectionIndex} sections ahead`
    : form.behavior?.phase === 'arrive' ? 'Arriving at the larger destination'
      : form.behavior?.phase === 'settle' ? 'Letting the destination settle' : undefined;
  $("#form-intent").textContent = [frame?.phrase?.themeCore?.name, form.sectionIntent, direction,
    form.behavior?.ending === 'open' ? 'Open handoff' : undefined].filter(Boolean).join(' · ') || "The ensemble develops the current idea.";
  $("#form-meter").textContent = `${form.meter.numerator} / ${form.meter.denominator}`;
  const subdivision = expression?.subdivisionTicks ?? form.subdivisionTicks;
  $("#form-subdivision").textContent = ({ 480: "Quarters", 240: "Eighths", 160: "Triplets", 120: "Sixteenths", 80: "Sextuplets", 60: "Thirty-seconds" } as Record<number,string>)[subdivision] ?? `${Math.round(PPQ / subdivision)} / beat`;
  $("#form-instrument").textContent = performance.sound.instrument === "additive" ? "Matched additive" : colors.length ? colors.join(' · ') : "No new pitched entrance";
  $("#expressive-ensemble").hidden = performance.sound.instrument !== "additive";
  $("#form-tuning").textContent = `${TUNINGS[form.tuning].name}${form.gliding ? " · gliding" : ""}`;
  $("#form-theme").textContent = form.themeId.replace(/^theme-/, "Family ").replace(/ [a-d]$/, letter => letter.toUpperCase());
  $("#form-groove").textContent = form.grooveId;
  $("#form-progress").textContent = `${Math.round(form.progress * 100)}% through section · ${Math.round(form.swing * 100)}% swing`;
  $(".conductor-explanation").textContent = "Themes develop inside longer journeys. Pulse, riff and response layers enter on independent schedules; flowing changes prepare across sections. Freedom controls autonomous variation; zero holds your intention steady while composition continues. Tempo and recorded parameter lanes remain authoritative.";
  $("#composition-expression").innerHTML = compositionExpressionMarkup(frame, frames);
  const key = `${performance.seed}/${JSON.stringify(conductorConfig())}/${form.sectionIndex}/${form.cycle}/${performance.sound.tuning}`;
  if (key !== formRenderKey) {
    formRenderKey = key;
    const route = [];
    let tick = form.sectionStartTick;
    for (let i = 0; i < 8; i++) { const next = formForTick(tick); route.push(next); tick = next.sectionEndTick; }
    $("#form-route").innerHTML = route.map((item, i) => `<button class="form-stop ${i === 0 ? "current" : ""}" data-section-tick="${item.sectionStartTick}" title="${esc(item.sectionIntent ?? item.sectionName)}"><span>${i === 0 ? "NOW" : "THEN"} · BAR ${item.bar + 1}</span><strong>${esc(item.sectionName)}</strong><small>${item.themeId.replace('theme-', '').toUpperCase()} · ${item.meter.numerator}/${item.meter.denominator} · ${TUNINGS[item.tuning].name}</small></button>`).join("");
    document.querySelectorAll<HTMLButtonElement>("[data-section-tick]").forEach(button => button.onclick = () => { if (!busy) void restartAt(Number(button.dataset.sectionTick)); });
  }
}
function renderParameters() {
  $("#parameter-controls").innerHTML = PARAMETER_DEFINITIONS.filter(
    (p) => p.group === currentGroup && p.key !== "tempo",
  )
    .map(
      (p) =>
        `<div class="parameter"><label for="param-${p.key}">${p.label}<output id="value-${p.key}">${valueLabel(p.key, params[p.key])}</output></label><input id="param-${p.key}" data-parameter="${p.key}" type="range" min="${p.min}" max="${p.max}" step="0.01" value="${params[p.key]}" aria-describedby="help-${p.key}"/><p id="help-${p.key}">${p.description}</p></div>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLInputElement>("[data-parameter]")
    .forEach((input) => {
      setRangeFill(input);
      input.oninput = () => {
        const key = input.dataset.parameter as ParameterKey;
        changeParameters({ [key]: Number(input.value) });
        setRangeFill(input);
        $(`#value-${key}`).textContent = valueLabel(key, params[key]);
      };
    });
}
function updateSliders() {
  document
    .querySelectorAll<HTMLInputElement>("[data-parameter]")
    .forEach((input) => {
      if (document.activeElement !== input) {
        const key = input.dataset.parameter as ParameterKey;
        input.value = String(params[key]);
        $(`#value-${key}`).textContent = valueLabel(key, params[key]);
        setRangeFill(input);
      }
    });
  if (document.activeElement !== $<HTMLInputElement>("#tempo"))
    $<HTMLInputElement>("#tempo").value = String(Math.round(params.tempo));
}
function changeParameters(changes: Partial<Parameters>) {
  if (busy) return;
  if (needsReconstruction) { toast("Retry playback or restart before recording parameter changes."); return; }
  const previousParams = params;
  params = normalizeParameters({ ...params, ...changes });
  const normalizedChanges = Object.fromEntries(
    Object.keys(changes).map((key) => [key, params[key as ParameterKey]]),
  ) as Partial<Parameters>;
  try {
    if (!frames.length && !player.playing && !performance.automation.length) {
      performance.initialParameters = { ...performance.initialParameters, ...normalizedChanges };
      engine = makeEngine();
    } else {
      performance = recordLiveParameters(
        performance,
        normalizedChanges,
        engine.tick,
      );
      engine.setAutomation(
        performance.automation,
        performance.automationRevisions,
      );
    }
    invalidateTimelineUndo();
    refreshUnplayedOrigin();
    persist();
  } catch (error) {
    params = previousParams;
    toast(`Change could not be recorded: ${(error as Error).message}`);
  }
  updateSliders();
  renderAutomation();
}
function refreshUnplayedOrigin() {
  if (hasAudioPosition || seekPosition !== 0 || frames.length || player.playing) return;
  engine = makeEngine();
  queuedFirstFrame = currentFrame = undefined;
  needsReconstruction = false;
  generatePreview();
}
function renderPresets() {
  $("#preset-list").innerHTML = allPresets()
    .map(
      (p) =>
        `<button class="preset-card ${p.id === chosenPresetId ? "selected" : ""}" data-preset="${esc(p.id)}" style="--preset-color:${/^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#b8a1ed"}"><span class="preset-orb"></span><span><strong>${esc(p.name)}</strong><small>${esc(p.description)}</small></span><span class="preset-selected">${p.id === chosenPresetId ? "↗" : ""}</span></button>`,
    )
    .join("");
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach(
    (button) =>
      (button.onclick = () => {
        if (busy) return;
        if (needsReconstruction) { toast("Retry playback or restart before changing the sound world."); return; }
        const preset = allPresets().find(
          (p) => p.id === button.dataset.preset,
        )!;
        chosenPresetId = preset.id;
        performance.presetId = preset.id;
        changeParameters(preset.parameters);
        morphFrom = { ...params };
        $<HTMLInputElement>("#morph").value = "0";
        $("#morph-value").textContent = "0%";
        renderPresets();
        if (!frames.length) generatePreview();
        toast(
          `${preset.name} ${frames.length ? "enters at the next musical step" : "is ready"}`,
        );
      }),
  );
  $<HTMLInputElement>("#morph-target").innerHTML = allPresets()
    .map(
      (p) =>
        `<option value="${esc(p.id)}" ${p.id === morphTargetId ? "selected" : ""}>${esc(p.name)}</option>`,
    )
    .join("");
}
function updateTransport() {
  visualRevision++;
  const playing = player.playing;
  const previewing = auditionsPlaying();
  $<HTMLButtonElement>("#play").disabled = busy;
  $<HTMLButtonElement>("#next-section").disabled = busy;
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("[data-parameter], #tempo, #morph, #add-automation, [data-preset]").forEach(control => control.disabled = busy || needsReconstruction);
  document.querySelectorAll<HTMLButtonElement>("[data-section-tick]").forEach(button => button.disabled = busy);
  $("#play").innerHTML =
    `${icon(playing ? "pause" : "play")}<span>${playing ? "Pause" : "Play"}</span>`;
  $("#play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("#transport-state").textContent = busy ? "PREPARING POSITION · ↻ TO CANCEL" : needsReconstruction ? "PLAYBACK STOPPED · PLAY TO RETRY" : player.interrupted ? "AUDIO INTERRUPTED · PLAY TO RESUME" : previewing ? "PREVIEW PLAYING · LIVE POSITION HELD" : playing
    ? "FOLLOWING THE CURRENT"
    : frames.length
      ? "PAUSED · YOUR PLACE IS HELD"
      : "READY TO EXPLORE";
  $("#live-tag").textContent = previewing ? "PREVIEW · LIVE PAUSED" : playing
    ? "LIVE"
    : frames.length
      ? "PAUSED"
      : "SEED PREVIEW";
  $("#live-tag").classList.toggle("live", playing);
}
function auditionsPlaying() { return Array.from(document.querySelectorAll("audio")).some(audio => !audio.paused && !audio.ended); }
function pauseAuditions() { document.querySelectorAll("audio").forEach(audio => audio.pause()); }
async function togglePlay() {
  if (busy) return;
  if (needsReconstruction) { await restartAt(seekPosition, true); return; }
  try {
    if (player.playing) player.pause();
    else {
      pauseAuditions();
      await player.play();
    }
    updateTransport();
  } catch (e) {
    holdFailedPosition(lastObservedTick);
    toast(`Audio could not start: ${(e as Error).message}`);
  }
}
async function restartAt(tick = 0, play = player.playing || auditionsPlaying()) {
  if (busy) return;
  if (!Number.isSafeInteger(tick) || tick < 0 || tick > barTick(10_001)) {
    toast(
      "Interactive navigation supports the first 10,000 bars. The complete performance recipe is still exportable.",
    );
    return;
  }
  busy = true;
  seekCancelled = false;
  $("#restart").setAttribute("aria-label", "Cancel seek");
  try {
    const heldPosition = playbackTick();
    pauseAuditions();
    player.stop();
    pendingFrame = undefined;
    hasAudioPosition = false;
    seekPosition = heldPosition;
    updateTransport();
    if (tick > 0) toast(`Returning to bar ${barLabel(tick)}…`);
    const prepared = await preparePlayback(engineConfig(), tick, {
      maxHistory: MAX_HISTORY,
      cancelled: () => seekCancelled,
      onProgress: position => {
        $("#transport-state").textContent =
          `REBUILDING BAR ${barLabel(position)} · ↻ TO CANCEL`;
      },
      yield: () => new Promise(r => setTimeout(r, 0)),
    });
    // At the origin a displayed preview must not consume compositional time:
    // bar-one automation and preset edits remain editable before pressing Play.
    engine = prepared.tick === 0 ? makeEngine() : prepared.engine;
    frames = prepared.history;
    queuedFirstFrame = prepared.tick === 0 ? undefined : prepared.firstFrame;
    seekPosition = prepared.tick;
    lastObservedTick = prepared.tick;
    needsReconstruction = false;
    showFrame(prepared.firstFrame);
    if (play && !seekCancelled) await player.play();
    if (seekCancelled)
      toast(`Reconstruction stopped at bar ${barLabel(seekPosition)}`);
  } catch (e) {
    holdFailedPosition(tick);
    toast((e as Error).message);
  } finally {
    busy = false;
    $("#restart").setAttribute("aria-label", "Restart exact performance");
    updateTransport();
  }
}
function generatePreview() {
  if (frames.length || player.playing) return;
  try {
    const preview = makeEngine();
    previewFrames = Array.from({ length: 20 }, () => preview.step());
    visualRevision++;
    if (!frames.length) {
      updateReadout(previewFrames[0]);
      updateSoundReadout(previewFrames[0]);
      updateConductor(previewFrames[0]);
      phrasePanel?.update(previewFrames[0]);
      harmonyPanel?.update(previewFrames[0]);
    }
  } catch (e) {
    toast(`Engine error: ${(e as Error).message}`);
  }
}
function updateReadout(frame = currentFrame) {
  if (!frame) return;
  const d = frame.diagnostics;
  $("#tonal-center").innerHTML =
    frame.sound.tuning !== "12tet"
      ? `d${d.tonalCenterDegree ?? 0} <small>attraction</small>`
      : `${noteName(d.tonalCenter ?? 0)} <small>${percent(d.clarity)} clarity</small>`;
  $("#pitch-collection").textContent =
    frame.sound.tuning !== "12tet"
      ? frame.voicePitches
          .map((p) => pitchLabel(p, frame.sound.tuning).split(" · ")[0])
          .join(" · ")
      : [
          ...new Set(frame.voicePitches.map((p) => noteName(pitchToMidi(p)))),
        ].join(" · ");
  $("#bass-note").textContent =
    frame.sound.tuning !== "12tet"
      ? `${pitchToHz(frame.bassPitch).toFixed(1)} Hz`
      : pitchLabel(frame.bassPitch, "12tet");
  $("#voice-distance").innerHTML =
    `${d.voiceLeadingCents.toFixed(0)} <small>cents / voice</small>`;
  $("#harmonic-distance").textContent = percent(d.harmonicDistance);
  $("#tension-value").textContent = percent(d.harmonicTension?.actual ?? d.actualTension);
  $("#tension-explanation").textContent = d.harmonicTension
    ? "Harmonic tension follows friction, ambiguity and voice movement. Rhythm, layering and dynamics supply orchestral force."
    : "Aggregate tension combines harmony, rhythm, register, density and phrase pressure.";
  $("#tension-components").innerHTML = Object.entries(d.harmonicTension
    ? Object.fromEntries(Object.entries(d.harmonicTension.components).map(([name, item]) => [name, item.actual])) : d.tension)
    .map(
      ([name, value]) =>
        `<span>${name}<i><b style="width:${Math.max(0, Math.min(100, value * 100))}%"></b></i></span>`,
    )
    .join("");
  const orchestra = d.orchestration;
  $("#orchestration-readout").innerHTML = orchestra ? `<div><span>REQUESTED ENERGY</span><strong>${percent(orchestra.requestedEnergy)}</strong><progress aria-label="Requested orchestral energy" max="1" value="${orchestra.requestedEnergy}"></progress></div><div><span>NOTE ATTACKS / BEAT</span><strong>${orchestra.attacksPerBeat.toFixed(1)}</strong></div><div><span>ACTIVE VOICES</span><strong>${orchestra.activeVoices}</strong></div><div><span>ATTACK STRENGTH</span><strong>${percent(orchestra.meanVelocity)}</strong></div><small>Activity over four beats of the score; audio loudness also depends on the instruments.</small>` : '';
  $("#planner-status").textContent =
    `${d.horizon}-step horizon · ${d.candidatesEvaluated} candidates · phrase ${d.phrase + 1} · section ${d.section + 1}${d.melodicSupport === undefined ? "" : ` · melody support ${percent(d.melodicSupport)} (structure objective)`}`;
  const timing = player.diagnostics;
  $("#audio-timing").textContent = `Audio look-ahead ${Math.round(timing.lookAheadSeconds * 1000)} ms · peak planning ${timing.maxPlanningMs.toFixed(1)} ms · peak scheduling ${timing.maxSchedulingMs.toFixed(1)} ms · ${timing.underruns} late note batches${timing.lateNoteTasks ? ` (${timing.lateNoteTasks} notes; worst ${timing.maxLatenessMs.toFixed(1)} ms)` : ''}. These measure scheduling deadlines, not device-level audio dropouts.`;
}
function renderMemory() {
  const motifs = currentFrame?.motifs || [];
  $("#memory-count").textContent = String(motifs.length);
  if (!motifs.length) {
    $("#memory-list").innerHTML =
      '<div class="memory-empty"><span class="memory-glyph">⌁</span><strong>Every seed has a story.</strong><p>Play to discover the first ideas.<br/>Listen for them to return.</p></div>';
    return;
  }
  $("#memory-list").innerHTML = motifs
    .slice(-4)
    .reverse()
    .map((m) => {
      const recalled = currentFrame?.diagnostics.recall?.motifId === m.id;
      return `<div class="motif-card ${recalled ? "recalled" : ""}"><div><strong>${esc(m.name)}</strong><span>${recalled ? esc(currentFrame!.diagnostics.recall!.transformation) : m.level}</span></div><svg viewBox="0 0 200 30" aria-label="Motif interval contour"><polyline points="${m.intervals.map((n, i) => `${10 + (i * 180) / Math.max(1, m.intervals.length - 1)},${15 - Math.max(-7, Math.min(7, n)) * 1.8}`).join(" ")}"/></svg><small>${m.recalls ? `${m.recalls} returns` : "A new idea"}<span>bar ${barLabel(m.born * FRAME_TICKS)}</span></small></div>`;
    })
    .join("");
}
function renderAutomation() {
  if (!document.querySelector("#clear-timeline")) {
    const control = document.createElement("button");
    control.id = "clear-timeline";
    control.className = "button quiet";
    $(".timeline-panel .inline-actions").prepend(control);
    control.onclick = async () => {
      if (busy) return;
      if (undoneTimeline) {
        performance.automation = undoneTimeline.automation;
        performance.automationRevisions = undoneTimeline.automationRevisions;
        undoneTimeline = undefined;
      } else {
        undoneTimeline = structuredClone({
          automation: performance.automation,
          automationRevisions: performance.automationRevisions,
        });
        performance.automation = [];
        delete performance.automationRevisions;
      }
      persist();
      await restartAt(0, false);
      renderAutomation();
      generatePreview();
      toast(
        undoneTimeline
          ? "Timeline cleared. Restore timeline will undo this change."
          : "Timeline restored",
      );
    };
  }
  $("#clear-timeline").textContent = undoneTimeline
    ? "Restore timeline"
    : "Clear timeline";
  $("#clear-timeline").hidden =
    !undoneTimeline && !performance.automation.length;
  $("#automation-count").textContent = `${performance.automation.length} lanes`;
  if (!performance.automation.length)
    $("#automation-lanes").innerHTML =
      `<div class="timeline-empty"><div class="timeline-rule">${[1, 8, 16, 24, 32].map((v) => `<span>${v}</span>`).join("")}</div><div class="empty-journey"><span class="journey-line"></span><p>Your performance unfolds here. Add a transition, or shape the sliders as you listen.</p></div></div>`;
  else {
    const max = Math.max(
      barTick(33),
      ...performance.automation.flatMap((l) => l.points.map((p) => p.tick)),
    );
    $("#automation-lanes").innerHTML =
      performance.automation
        .map((l) => {
          const def = PARAMETER_DEFINITIONS.find((d) => d.key === l.parameter)!;
          return `<div class="automation-lane"><span>${def.label}</span><svg viewBox="0 0 700 40" preserveAspectRatio="none" aria-label="${def.label} automation"><path d="${l.points
            .map((p, i) => {
              const x = (p.tick / max) * 680 + 10,
                y = 34 - ((p.value - def.min) / (def.max - def.min)) * 28;
              const prev = l.points[i - 1];
              return `${i ? (prev.curve === "step" ? `H${x} V${y}` : "L" + x + "," + y) : "M" + x + "," + y}`;
            })
            .join(
              " ",
            )}"/>${l.points.map((p) => `<circle cx="${(p.tick / max) * 680 + 10}" cy="${34 - ((p.value - def.min) / (def.max - def.min)) * 28}" r="3"/>`).join("")}</svg><span class="lane-end">${valueLabel(l.parameter, l.points.at(-1)!.value)}</span></div>`;
        })
        .join("") +
      `<div class="timeline-labels"><span>Bar 1</span><span>Bar ${formForTick(max).bar + 1}</span></div>`;
  }
  $("#bookmark-list").innerHTML = performance.bookmarks.length
    ? performance.bookmarks
        .map(
          (b) =>
            `<div class="bookmark-group"><button class="bookmark-chip" data-bookmark="${esc(b.id)}" title="Replay from ${esc(b.name)}">${icon("bookmark")}<strong>${esc(b.name)}</strong><span>${barLabel(b.tick)}</span></button><button class="bookmark-link" data-bookmark-share="${esc(b.id)}" aria-label="Copy link to ${esc(b.name)}">${icon("share")}</button></div>`,
        )
        .join("")
    : '<span class="subtle tiny">Hear something you love? Keep its place.</span>';
  document.querySelectorAll<HTMLButtonElement>("[data-bookmark]").forEach(
    (b) =>
      (b.onclick = () => {
        const mark = performance.bookmarks.find(
          (m) => m.id === b.dataset.bookmark,
        )!;
        void restartAt(mark.tick, true);
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-bookmark-share]").forEach(
    (button) =>
      (button.onclick = () => {
        const mark = performance.bookmarks.find(
          (b) => b.id === button.dataset.bookmarkShare,
        )!;
        sharePerformance(mark.tick);
      }),
  );
}
function invalidateTimelineUndo() {
  if (!undoneTimeline) return;
  undoneTimeline = undefined;
  renderAutomation();
}
const scoreLabels: Record<ScoreKey, string> = {
  smoothness: "Smooth voice leading",
  commonTones: "Common tones",
  harmonicMotion: "Harmonic motion",
  tonalGravity: "Tonal attraction",
  dissonance: "Controlled dissonance",
  tension: "Tension trajectory",
  independence: "Voice independence",
  novelty: "Novelty / memory",
  structure: "Long-form structure",
};
function createScoreControls() {
  $("#score-controls").innerHTML = (Object.keys(DEFAULT_WEIGHTS) as ScoreKey[])
    .map(
      (k) =>
        `<div class="score-row"><label><input type="checkbox" data-score-enable="${k}" ${performance.weights[k] > 0 ? "checked" : ""}/> ${scoreLabels[k]}</label><input type="range" data-weight="${k}" aria-label="${scoreLabels[k]} weight" min="0" max="3" step="0.1" value="${performance.weights[k]}"/><output data-score="${k}">—</output></div>`,
    )
    .join("");
  document.querySelectorAll<HTMLInputElement>("[data-weight]").forEach(
    (i) =>
      (i.onchange = () => {
        if (busy) {
          createScoreControls();
          return;
        }
        performance.weights[i.dataset.weight as ScoreKey] = Number(i.value);
        invalidateTimelineUndo();
        persist();
        void restartAt(0);
        createScoreControls();
      }),
  );
  document.querySelectorAll<HTMLInputElement>("[data-score-enable]").forEach(
    (i) =>
      (i.onchange = () => {
        if (busy) {
          createScoreControls();
          return;
        }
        performance.weights[i.dataset.scoreEnable as ScoreKey] = i.checked
          ? 1
          : 0;
        invalidateTimelineUndo();
        persist();
        void restartAt(0);
        createScoreControls();
      }),
  );
}
function renderScores() {
  if (!currentFrame) return;
  for (const [k, v] of Object.entries(currentFrame.diagnostics.scores)) {
    const el = document.querySelector<HTMLOutputElement>(`[data-score="${k}"]`);
    if (el) {
      el.textContent = `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
      el.classList.toggle("negative", v < 0);
    }
  }
}

function renderSoundControls() {
  const sound = performance.sound;
  const spectra = SPECTRA.some((s) => s.id === sound.spectrum.id)
    ? SPECTRA
    : [...SPECTRA, sound.spectrum];
  $("#sound-controls").innerHTML =
    `<div class="sound-grid"><label class="field">Pitch space<select id="tuning-select">${Object.values(TUNINGS).map(t => `<option value="${t.id}" ${sound.tuning === t.id ? "selected" : ""}>${t.name} · ${t.id === "12tet" ? "baseline" : t.id === "19edo" ? "warm native thirds" : t.id === "24edo" ? "quarter-tone wide / narrow thirds" : "fine chromatic shading"}</option>`).join("")}</select></label><label class="field">Instrument<select id="instrument-select"><option value="ensemble" ${sound.instrument === "ensemble" ? "selected" : ""}>Warm ensemble</option><option value="additive" ${sound.instrument === "additive" ? "selected" : ""}>Matched additive instrument</option></select></label><label class="field sound-spectrum">Spectrum<select id="spectrum-select">${spectra.map((s) => `<option value="${esc(s.id)}" ${s.id === sound.spectrum.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><label class="field">Roughness influence <output id="roughness-weight-value">${sound.roughnessWeight.toFixed(1)}×</output><input id="roughness-weight" aria-label="Roughness influence" type="range" min="0" max="3" step="0.1" value="${sound.roughnessWeight}"/></label><label class="field">Desired roughness <output id="desired-roughness-value">${percent(sound.roughnessTarget)}</output><input id="desired-roughness" aria-label="Desired roughness" type="range" min="0" max="1" step="0.01" value="${sound.roughnessTarget}"/></label></div><div class="sound-apply"><span id="sound-help">${sound.instrument === "ensemble" ? "Select additive to match the sound and sensory model." : "Five sine partials. No detuning or spectral effects."}<br/>Applying settings restarts this seed.</span><button id="apply-sound" class="button primary">Apply & restart</button></div>`;
  const tuning = $<HTMLSelectElement>("#tuning-select"),
    instrument = $<HTMLSelectElement>("#instrument-select"),
    weight = $<HTMLInputElement>("#roughness-weight");
  function updatePending() {

    const additive = instrument.value === "additive";
    weight.disabled = !additive;
    $<HTMLInputElement>("#desired-roughness").disabled = !additive;
    $<HTMLSelectElement>("#spectrum-select").disabled = !additive;
    $("#sound-help").innerHTML =
      `${additive ? "Five fixed-amplitude partials match the sensory model. Choose Warm ensemble to hear velocity accents and dynamic shading." : "Velocity shapes attacks and dynamic shading. Select additive for the matched sensory experiment."}<br/>Applying settings restarts this seed.`;
    $("#roughness-weight-value").textContent =
      `${Number(weight.value).toFixed(1)}×`;
    $("#desired-roughness-value").textContent = percent(
      Number($<HTMLInputElement>("#desired-roughness").value),
    );
    const spectrum = spectra.find(
      (s) => s.id === $<HTMLSelectElement>("#spectrum-select").value,
    )!;
    $("#spectrum-plot").innerHTML = spectrum.partials
      .map(
        (p) =>
          `<div><i style="height:${p.amplitude * 54}px"></i><span>${p.ratio}f</span></div>`,
      )
      .join("");
    $("#spectrum-caption").textContent =
      `Relative amplitudes: ${spectrum.partials.map((p) => p.amplitude.toFixed(2)).join(" / ")}`;
    setRangeFill(weight);
    setRangeFill($<HTMLInputElement>("#desired-roughness"));
  }
  tuning.onchange = () => {
    if (tuning.value !== "12tet" && instrument.value === "additive" && Number(weight.value) === 0)
      weight.value = "1";
    updatePending();
  };
  instrument.onchange = () => {
    if (instrument.value === "additive" && Number(weight.value) === 0)
      weight.value = "1";
    updatePending();
  };
  weight.oninput = updatePending;
  $<HTMLInputElement>("#desired-roughness").oninput = updatePending;
  $<HTMLSelectElement>("#spectrum-select").onchange = updatePending;
  $("#apply-sound").onclick = async () => {
    if (busy) return;
    const next: SoundConfig = {
      tuning: tuning.value as TuningId,
      instrument: instrument.value as "ensemble" | "additive",
      spectrum: structuredClone(
        spectra.find(
          (s) => s.id === $<HTMLSelectElement>("#spectrum-select").value,
        )!,
      ),
      roughnessWeight:
        instrument.value === "ensemble" ? 0 : Number(weight.value),
      roughnessTarget: Number($<HTMLInputElement>("#desired-roughness").value),
    };
    performance.sound = next;
    invalidateTimelineUndo();
    persist();
    clearComparison();
    await restartAt(0, false);
    renderSoundControls();
    generatePreview();
    toast(
      `${TUNINGS[next.tuning].name} ${next.instrument === "additive" ? "with a matched five-partial instrument" : "with the warm ensemble"} · press Play`,
    );
  };
  $("#sound-mode-label").textContent =
    `${TUNINGS[sound.tuning].name} · ${sound.instrument === "ensemble" ? "warm ensemble" : sound.spectrum.name}`;
  updatePending();
}
function updateSoundReadout(frame: Frame) {
  const d = frame.diagnostics,
    modeled = frame.sound.instrument === "additive";
  $("#roughness-actual").textContent =
    modeled && d.sensoryRoughness !== undefined
      ? d.sensoryRoughness.toFixed(3)
      : "Not modeled";
  $("#roughness-target").textContent =
    modeled && d.roughnessTarget !== undefined
      ? d.roughnessTarget.toFixed(3)
      : "—";
  $("#roughness-score").textContent =
    modeled && d.roughnessContribution !== undefined
      ? `${d.roughnessContribution >= 0 ? "+" : ""}${d.roughnessContribution.toFixed(3)}`
      : "0 · inactive";
  $("#movement-cents").textContent = `${d.voiceLeadingCents.toFixed(1)} ¢`;
  $("#sound-mode-label").textContent = `${TUNINGS[frame.sound.tuning].name} · ${frame.sound.instrument === "additive" ? "matched additive" : (frame.notes.find(n => n.timbre)?.timbre ?? "warm ensemble")}${frame.notes.some(note => note.endPitch) ? " · glide to destination" : ""}`;
  $("#frequency-readout").textContent =
    `${frame.form?.gliding ? "Glide destinations (roughness evaluates the settled sonority): " : "Upper voices: "}${frame.voicePitches.map((p) => pitchToHz(p).toFixed(2)).join(" · ")} Hz    /    Bass: ${pitchToHz(frame.bassPitch).toFixed(2)} Hz`;
}
let comparisonUrls: string[] = [];
let comparisonGeneration = 0;
function clearComparison() {
  comparisonGeneration++;
  document
    .querySelectorAll<HTMLAudioElement>("#comparison-results audio")
    .forEach((a) => a.pause());
  comparisonUrls.forEach(URL.revokeObjectURL);
  comparisonUrls = [];
  $("#comparison-results").innerHTML = "";
}
$("#compare-sound").onclick = async () => {
  if (busy) return;
  player.pause();
  updateTransport();
  clearComparison();
  const generation = comparisonGeneration;
  const snapshot = structuredClone(performance);
  const button = $("#compare-sound");
  button.setAttribute("disabled", "");
  try {
    const base = {
      ...snapshot.sound,
      instrument: "additive" as const,
    };
    const onWeight = Math.max(1, base.roughnessWeight);
    const passages: Frame[][] = [];
    for (const [index, weight] of [0, onWeight].entries()) {
      button.textContent = `Rendering ${index ? "B" : "A"}…`;
      await new Promise((r) => setTimeout(r, 0));
      if (generation !== comparisonGeneration) return;
      const composer = new MusicEngine({
          seed: snapshot.seed,
          parameters: snapshot.initialParameters,
          automation: snapshot.automation,
          automationRevisions: snapshot.automationRevisions,
          weights: snapshot.weights,
          sound: { ...base, roughnessWeight: weight },
          conductor: snapshot.conductor,
          phrasing: snapshot.phrasing,
        }),
        passage: Frame[] = [];
      for (let i = 0; i < 16; i++) {
        passage.push(composer.step());
        if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      passages.push(passage);
      const buffer = await renderOffline(passage, 0.65);
      if (generation !== comparisonGeneration) return;
      const bytes = encodeWav(buffer),
        url = URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type: "audio/wav" }),
        );
      comparisonUrls.push(url);
      const mean = (get: (f: Frame) => number) =>
        passage.reduce((sum, f) => sum + get(f), 0) / passage.length;
      const collections = new Set(
        passage.map((f) =>
          f.voicePitches
            .map((p) => p.millicents % 1_200_000)
            .sort((a, b) => a - b)
            .join(","),
        ),
      ).size;
      const div = document.createElement("div");
      div.className = "comparison-card";
      div.innerHTML = `<div><strong>${index ? "B · Roughness term on" : "A · Roughness term off"}</strong><span>${TUNINGS[base.tuning].name} · ${weight.toFixed(1)}× weight</span></div><audio controls preload="auto" src="${url}" aria-label="Audition ${index ? "B roughness enabled" : "A roughness disabled"}"></audio><p>Mean movement ${mean((f) => f.diagnostics.voiceLeadingCents).toFixed(1)}¢ · ${collections} collections · target error ${mean((f) => Math.abs((f.diagnostics.sensoryRoughness ?? 0) - (f.diagnostics.roughnessTarget ?? base.roughnessTarget))).toFixed(3)}</p><a href="${url}" download="continuum-${base.tuning}-${index ? "roughness-on" : "roughness-off"}.wav">Download WAV</a>`;
      div.querySelector("audio")!.onplay = (event) => {
        player.pause();
        updateTransport();
        document
          .querySelectorAll<HTMLAudioElement>("#comparison-results audio")
          .forEach((a) => {
            if (a !== event.target) a.pause();
          });
      };
      $("#comparison-results").append(div);
    }
    const changed = passages[0].filter(
      (f, i) =>
        f.voicePitches.some(
          (p, v) => p.millicents !== passages[1][i].voicePitches[v].millicents,
        ) || f.bassPitch.millicents !== passages[1][i].bassPitch.millicents,
    ).length;
    const note = document.createElement("p");
    note.className = "comparison-note";
    note.textContent = `${changed} of 16 harmonic choices differ. Both passages use identical ${base.spectrum.name.toLowerCase()}, seed “${snapshot.seed}”, and a snapshot of the same parameter history. Listen for continuity and character; a lower target error is not a measure of better music. Roughness models the harmonic bed, excluding percussion and momentary melody.`;
    $("#comparison-results").append(note);
  } catch (error) {
    toast(`Comparison failed: ${(error as Error).message}`);
  } finally {
    button.removeAttribute("disabled");
    button.textContent = "Render A / B audition";
  }
};

function canvasContext(id: string) {
  const canvas = $<HTMLCanvasElement>(id),
    rect = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(rect.width * dpr) ||
    canvas.height !== Math.round(rect.height * dpr)
  ) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}
function visibleFrames(count = 26) {
  if (!frames.length && !currentFrame) return previewFrames;
  const visible: Frame[] = [];
  for (let i = frames.length - 1; i >= 0 && visible.length < count; i--) {
    if (!currentFrame || frames[i].index <= currentFrame.index) visible.push(frames[i]);
  }
  visible.reverse();
  if (currentFrame && visible.at(-1)?.index !== currentFrame.index) visible.push(currentFrame);
  return visible.slice(-count);
}
function drawRoll() {
  const { ctx, w, h } = canvasContext("#piano-roll");
  if (!w) return;
  const list = visibleFrames();
  const left = 42,
    right = w - 20,
    top = 16,
    bottom = h - 28;
  const low = 27,
    high = Math.max(88, ...list.flatMap(frame => frame.notes.filter(note => note.absolutePitch).map(note => pitchToMidi(note.absolutePitch!) + 2)));
  const y = (p: number) => bottom - ((p - low) / (high - low)) * (bottom - top);
  const cols = 26;
  const step = (right - left) / cols;
  ctx.font = '10px "Segoe UI", sans-serif';
  const displayedTuning = currentFrame?.sound.tuning ?? previewFrames[0]?.sound.tuning ?? performance.sound.tuning;
  if (displayedTuning !== "12tet") {
    const divisions = TUNINGS[displayedTuning].divisions;
    for (let degree = -4 * divisions; degree <= 3 * divisions; degree++) {
      const pitch = degreeToPitch(displayedTuning, degree),
        p = pitchToMidi(pitch);
      if (p < low || p > high) continue;
      ctx.strokeStyle = degree % divisions === 0 ? "#403348" : "#211d28";
      ctx.beginPath();
      ctx.moveTo(left, y(p));
      ctx.lineTo(right, y(p));
      ctx.stroke();
      if (degree % divisions === 0) {
        ctx.fillStyle = "#9581a6";
        ctx.fillText(`${pitchToHz(pitch).toFixed(0)}`, 7, y(p) + 3);
      }
    }
  } else
    for (let p = low; p <= high; p++) {
      if ([1, 3, 6, 8, 10].includes(p % 12)) {
        ctx.fillStyle = "rgba(255,255,255,.012)";
        ctx.fillRect(left, y(p) - 2, right - left, 4);
      }
      if (p % 12 === 0) {
        ctx.strokeStyle = "#2b2a32";
        ctx.beginPath();
        ctx.moveTo(left, y(p));
        ctx.lineTo(right, y(p));
        ctx.stroke();
        ctx.fillStyle = "#74717f";
        ctx.fillText(noteName(p, true), 10, y(p) + 3);
      }
    }
  for (let i = 0; i <= cols; i++) {
    const x = left + i * step;
    ctx.strokeStyle = i % 2 === 0 ? "#292830" : "#201f27";
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom + 6);
    ctx.stroke();
    if (i % 4 === 0) {
      ctx.fillStyle = "#6d6976";
      const idx = (list[0]?.index || 0) + i;
      ctx.fillText(
        String(formForTick(idx * FRAME_TICKS).bar + 1).padStart(2, "0"),
        x + 3,
        h - 6,
      );
    }
  }
  const series = [...new Set([0, 1, 2, 3, 4, ...list.flatMap(frame => frame.notes.filter(note => note.part === 'harmony').map(note => note.voice))])];
  for (const voice of series) {
    let prev: number | undefined;
    for (let i = 0; i < list.length; i++) {
      if (list[i].phrase) {
        const frame = list[i];
        const sounding = frame.notes.filter(note => note.voice === voice && (note.part === 'harmony' || note.part === 'bass'));
        ctx.fillStyle = COLORS[voice % COLORS.length]; ctx.globalAlpha = .8;
        for (const note of sounding) {
          const x = left + (i + (note.tick - frame.tick) / FRAME_TICKS) * step;
          ctx.globalAlpha = .2 + note.velocity * .75;
          ctx.beginPath(); ctx.roundRect(x, y(pitchToMidi(note.absolutePitch!)) - 2.1, Math.max(2, note.duration / FRAME_TICKS * step - 1), 4.2, 2); ctx.fill();
        }
        prev = undefined;
        continue;
      }
      if (voice > 4) continue;
      const frame = list[i],
        pitch = pitchToMidi(
          voice === 4 ? frame.bassPitch : frame.voicePitches[voice],
        ),
        x = left + i * step,
        yy = y(pitch);
      ctx.strokeStyle = COLORS[voice];
      ctx.globalAlpha = 0.35;
      if (prev !== undefined) {
        ctx.beginPath();
        ctx.moveTo(x - 3, y(prev));
        ctx.lineTo(x + 2, yy);
        ctx.stroke();
      }
      ctx.globalAlpha = frames.length ? 0.8 : 0.65;
      ctx.fillStyle = COLORS[voice];
      ctx.beginPath();
      ctx.roundRect(x + 2, yy - 2.1, Math.max(2, step - 4), 4.2, 2);
      ctx.fill();
      prev = pitch;
    }
  }
  ctx.globalAlpha = 0.78;
  for (let i = 0; i < list.length; i++) {
    for (const event of list[i].notes.filter(n => n.endPitch && n.absolutePitch)) {
      const x = left + (i + (event.tick - list[i].tick) / FRAME_TICKS) * step;
      ctx.strokeStyle = event.part === "bass" ? COLORS[4] : event.part === "melody" ? COLORS[3] : COLORS[event.voice % 4];
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(x, y(pitchToMidi(event.absolutePitch!)));
      ctx.lineTo(x + (event.glideTicks ?? event.duration) / FRAME_TICKS * step, y(pitchToMidi(event.endPitch!)));
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < list.length; i++)
    for (const event of list[i].notes.filter((n) => n.part === "melody")) {
      ctx.fillStyle = event.voice === 8 ? "#79b4de" : event.voice === 7 ? "#79beb1" : event.voice === 6 ? "#ebbc72" : "#c1a5ed";
      ctx.globalAlpha = .22 + event.velocity * .78;
      const x = left + (i + (event.tick - list[i].tick) / FRAME_TICKS) * step;
      const thickness = event.expression?.role === 'ornament' ? 2 : 2.5 + event.velocity * 2;
      ctx.beginPath();
      ctx.roundRect(
        x,
        y(pitchToMidi(event.absolutePitch!)) - thickness / 2,
        Math.max(2, (event.duration / FRAME_TICKS) * step - 1),
        thickness,
        1,
      );
      ctx.fill();
    }
  ctx.globalAlpha = 1;
  if (currentFrame) {
    const frac = Math.max(
      0,
      Math.min(
        1,
        (playbackTick() - currentFrame.tick) / currentFrame.duration,
      ),
    );
    const x = Math.min(
      right,
      left +
        (list.findIndex((f) => f.index === currentFrame!.index) + frac) * step,
    );
    const gradient = ctx.createLinearGradient(x - 20, 0, x, 0);
    gradient.addColorStop(0, "rgba(185,163,232,0)");
    gradient.addColorStop(1, "rgba(185,163,232,.08)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - 20, top, 20, bottom - top);
    ctx.strokeStyle = "#d6c7f1";
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom + 5);
    ctx.stroke();
    ctx.fillStyle = "#d6c7f1";
    ctx.beginPath();
    ctx.moveTo(x - 3, top);
    ctx.lineTo(x + 3, top);
    ctx.lineTo(x, top + 5);
    ctx.fill();
  }
}
function drawTension() {
  const { ctx, w, h } = canvasContext("#tension-chart");
  if (!w) return;
  const list = visibleFrames(64);
  const left = 24,
    right = w - 24,
    top = 10,
    bottom = h - 20;
  ctx.font = '9px "Segoe UI", sans-serif';
  [0.25, 0.5, 0.75].forEach((v) => {
    const yy = bottom - v * (bottom - top);
    ctx.strokeStyle = "#292630";
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
  });
  for (const target of [false, true]) {
    if (!list.length) continue;
    ctx.setLineDash(target ? [4, 5] : []);
    ctx.strokeStyle = target ? "#8d869b" : "#b79be2";
    ctx.lineWidth = target ? 1 : 1.8;
    ctx.beginPath();
    list.forEach((f, i) => {
      const x = left + (i / Math.max(19, list.length - 1)) * (right - left),
        y =
          bottom -
          (target ? f.diagnostics.harmonicTension?.target ?? f.diagnostics.targetTension : f.diagnostics.harmonicTension?.actual ?? f.diagnostics.actualTension) *
            (bottom - top);
      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (!target) {
      ctx.lineTo(
        left +
          ((list.length - 1) / Math.max(19, list.length - 1)) * (right - left),
        bottom,
      );
      ctx.lineTo(left, bottom);
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, "rgba(170,128,213,.14)");
      grad.addColorStop(1, "rgba(170,128,213,0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.fillStyle = "#77717f";
  ctx.fillText("RELEASE", left, h - 3);
  ctx.textAlign = "right";
  ctx.fillText(
    currentFrame
      ? `PHRASE ${currentFrame.diagnostics.phrase + 1}`
      : "PHRASE-SCALE TENSION",
    right,
    h - 3,
  );
  ctx.textAlign = "left";
}
let lastDraw = 0, lastVisualRevision = -1;
const visibleCharts = new Set<string>();
const chartObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) visibleCharts.add(entry.target.id);
    else visibleCharts.delete(entry.target.id);
  }
  visualRevision++;
}, { rootMargin: '100px' });
for (const id of ['piano-roll', 'tension-chart']) chartObserver.observe(document.getElementById(id)!);
window.addEventListener('resize', () => visualRevision++);
function animate(now: number) {
  if (document.visibilityState !== 'hidden' && now - lastDraw > 40) {
    if (pendingFrame) showFrame(pendingFrame);
    const dirty = visualRevision !== lastVisualRevision;
    if (player.playing || dirty) {
      phrasePanel?.tick(playbackTick());
      if (visibleCharts.has('piano-roll')) drawRoll();
      if (dirty && visibleCharts.has('tension-chart')) drawTension();
      {
        const tick = playbackTick();
        lastObservedTick = tick;
        const position = formForTick(tick);
        const label = `${String(position.bar + 1).padStart(3, "0")} <span>: ${String(Math.floor(position.beat)).padStart(2, "0")}</span>`;
        if ($("#position").innerHTML !== label) $("#position").innerHTML = label;
        if (!busy) $("#form-progress").textContent = `${Math.floor(position.progress * 100)}% through section · ${Math.round(position.swing * 100)}% swing`;
      }
      const level = player.playing ? Math.min(1, player.level) : 0;
      document.querySelectorAll<HTMLElement>(".level i").forEach((el, i) => el.classList.toggle("lit", level > i / 8));
      lastVisualRevision = visualRevision;
    }
    lastDraw = now;
  }
  requestAnimationFrame(animate);
}

$("#play").onclick = () => void togglePlay();
$<HTMLInputElement>("#fresh-on-reload").onchange = () => {
  freshOnReload = $<HTMLInputElement>("#fresh-on-reload").checked;
  try { localStorage.setItem("continuum.fresh-on-reload", String(freshOnReload)); }
  catch { toast("This browser cannot save the reload preference."); }
};
$("#recent-performances").onclick = () => {
  let recipes: string[] = [];
  try { recipes = readRecentPerformances(localStorage); } catch { /* Storage may be disabled. */ }
  modal("Recent performances", `<p class="subtle">The last ten performances are saved on this browser when you change seeds or reload. Settings and recorded automation are included. Older engine versions can be reinterpreted; their original JSON remains downloadable.</p>${recipes.length ? recipes.map((raw, i) => {
    const recipe = JSON.parse(raw);
    const sameVersion = recipe.engineVersion === ENGINE_VERSION;
    return `<div class="export-option"><strong>${esc(recipe.seed)}</strong><span>${esc(recipe.engineVersion)} · ${recipe.automation?.length ?? 0} automation lanes</span><button class="button" data-restore-recipe="${i}">${sameVersion ? "Restore" : "Reinterpret in current engine"}</button> <button class="button quiet" data-download-recipe="${i}">Download JSON</button></div>`;
  }).join("") : '<p class="subtle">Your next seed change will save this performance here.</p>'}`);
  document.querySelectorAll<HTMLButtonElement>("[data-restore-recipe]").forEach(button => button.onclick = async () => {
    if (busy) return;
    try {
      const raw = recipes[Number(button.dataset.restoreRecipe)];
      const recipe = readCompatibleRecipe(raw);
      $<HTMLDialogElement>("dialog").close();
      await loadRecipe(recipe, false, raw);
      toast("Performance restored · ready from the beginning");
    } catch (error) { toast((error as Error).message); }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-download-recipe]").forEach(button => button.onclick = () => download(recipes[Number(button.dataset.downloadRecipe)], "application/json", "continuum-saved-performance.json"));
};
$("#lyrical-score").onclick = async () => {
  if (busy) return;
  const playing = player.playing;
  const { recipe, description } = lyricalPerformance(performance);
  await loadRecipe(recipe, playing);
  toast(`${description}. Previous performance saved.`);
};
$("#composition-studies").onclick = () => {
  modal("Composition studies", `<p class="subtle">Six editable starting points in the same composer. Keep this seed and tempo, clear automation, and restart. These demonstrate musical capabilities, not artist imitations. Native tunings use the ensemble; the matched additive experiment remains available under Sound.</p>${COMPOSITION_STUDIES.map(study => `<div class="export-option"><strong>${esc(study.name)} · ${TUNINGS[study.tuning].name}</strong><span>${esc(study.intent)}</span><button class="button" data-study="${study.id}">Use ${esc(study.name)}</button></div>`).join("")}`);
  document.querySelectorAll<HTMLButtonElement>("[data-study]").forEach(button => button.onclick = async () => {
    if (busy) return;
    const recipe = compositionStudy(performance, button.dataset.study!);
    $<HTMLDialogElement>("dialog").close();
    await loadRecipe(recipe, player.playing);
    toast("Composition study loaded. Previous performance saved.");
  });
};
$("#wide-exploration").onclick = async () => {
  if (busy) return;
  const playing = player.playing;
  const { recipe, description } = explorationPerformance(performance, freshSeed());
  await loadRecipe(recipe, playing);
  toast(`New exploration · ${description}. Tempo retained; previous performance saved; automation cleared.`);
};
$("#restart").onclick = () => {
  if (busy) {
    seekCancelled = true;
    return;
  }
  void restartAt(0);
  toast("Same seed. Same trajectory. Back to the beginning.");
};
$("#replay").onclick = () => {
  void restartAt(0, true);
  toast("Replaying the complete recorded performance");
};
$<HTMLInputElement>("#tempo").onchange = () =>
  changeParameters({ tempo: Number($<HTMLInputElement>("#tempo").value) });
$<HTMLInputElement>("#volume").oninput = () => {
  player.setVolume(Number($<HTMLInputElement>("#volume").value));
  setRangeFill($<HTMLInputElement>("#volume"));
};
player.setVolume(0.65);
$<HTMLInputElement>("#seed").onchange = async () => {
  if (busy) {
    $<HTMLInputElement>("#seed").value = performance.seed;
    return;
  }
  const seed = $<HTMLInputElement>("#seed").value.trim().slice(0, 128);
  if (!seed) {
    $<HTMLInputElement>("#seed").value = performance.seed;
    return;
  }
  if (seed === performance.seed) return;
  await loadRecipe(newSeedPerformance(performance, seed), player.playing);
  toast(`Seed ${seed} is ready`);
};
$("#random-seed").onclick = () => {
  if (busy) return;
  $<HTMLInputElement>("#seed").value = freshSeed();
  $<HTMLInputElement>("#seed").dispatchEvent(new Event("change"));
};
async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    modal(
      "Copy this text",
      `<p class="subtle">Select and copy with your keyboard.</p><textarea class="copy-area" readonly>${esc(text)}</textarea>`,
    );
  }
}
$("#copy-seed").onclick = () => void copy(performance.seed, "Seed copied");
$("#share").onclick = () => {
  sharePerformance();
};
function sharePerformance(tick?: number) {
  try {
    const url = new URL(location.href);
    url.hash = encodeShareState(performance).replace(/^#/, "");
    if (tick === undefined) url.searchParams.delete("at");
    else url.searchParams.set("at", String(tick));
    void copy(
      url.href,
      tick === undefined
        ? "Performance link copied · seed, settings, and automation included"
        : `Bookmark link copied · starts at bar ${barLabel(tick)}`,
    );
  } catch (error) {
    toast(
      `Share failed: ${(error as Error).message}. Export performance JSON instead.`,
    );
  }
}
document.querySelectorAll<HTMLButtonElement>("[data-group]").forEach(
  (button) =>
    (button.onclick = () => {
      currentGroup = button.dataset.group!;
      document.querySelectorAll("[data-group]").forEach((el) => {
        const active = el === button;
        el.classList.toggle("active", active);
        el.setAttribute("aria-selected", String(active));
      });
      renderParameters();
    }),
);
$<HTMLInputElement>("#morph-target").onchange = () => {
  morphTargetId = $<HTMLInputElement>("#morph-target").value;
  morphFrom = { ...params };
  $<HTMLInputElement>("#morph").value = "0";
  $("#morph-value").textContent = "0%";
  setRangeFill($<HTMLInputElement>("#morph"));
};
$<HTMLInputElement>("#morph").oninput = () => {
  const amount = Number($<HTMLInputElement>("#morph").value),
    target = allPresets().find((p) => p.id === morphTargetId)!;
  changeParameters(interpolateParameters(morphFrom, target.parameters, amount));
  $("#morph-value").textContent = percent(amount);
  setRangeFill($<HTMLInputElement>("#morph"));
};
$("#reset-morph").onclick = () => {
  morphFrom = { ...params };
  $<HTMLInputElement>("#morph").value = "0";
  $("#morph-value").textContent = "0%";
  setRangeFill($<HTMLInputElement>("#morph"));
  toast("Current sound is now the morph origin");
};
$("#save-preset").onclick = () => {
  modal(
    "Keep this sound world",
    `<p class="subtle">Save a new, independent preset from the current musical character.</p><label class="field">Preset name<input id="preset-name" maxlength="60" value="My sound world"/></label><div class="dialog-actions"><button id="save-preset-confirm" class="button primary">Save preset</button></div>`,
  );
  $("#save-preset-confirm").onclick = () => {
    if (busy) return;
    const name = $<HTMLInputElement>("#preset-name").value.trim();
    if (!name) return;
    const preset: Preset = {
      id: `custom-${crypto.randomUUID()}`,
      name,
      description: "Your own musical intention",
      color: "#a8c4b1",
      parameters: { ...params },
      custom: true,
    };
    customPresets.push(preset);
    try {
      savePresets(customPresets);
    } catch {
      toast(
        "Preset kept for this session. Browser storage is unavailable; export it as JSON to keep it.",
      );
      renderPresets();
      $<HTMLDialogElement>("dialog").close();
      return;
    }
    chosenPresetId = preset.id;
    performance.presetId = preset.id;
    persist();
    renderPresets();
    $<HTMLDialogElement>("dialog").close();
    toast("Preset saved to this browser");
  };
};
$("#bookmark").onclick = () => {
  if (busy) return;
  if (!currentFrame) {
    toast("Play the instrument to bookmark a moment");
    return;
  }
  const tick = currentFrame.tick;
  performance.bookmarks.push({
    id: crypto.randomUUID(),
    name: `Moment ${performance.bookmarks.length + 1}`,
    tick,
  });
  persist();
  renderAutomation();
  toast(`Saved bar ${barLabel(tick)} · click its bookmark to return`);
};
$("#add-automation").onclick = () => {
  modal(
    "Give the music somewhere to go",
    `<p class="subtle">Write a transition in musical time. It will replay exactly, every time.</p><label class="field">Parameter<select id="auto-param"><option value="world">Morph to a sound world</option>${PARAMETER_DEFINITIONS.map((p) => `<option value="${p.key}">${p.label}</option>`).join("")}</select></label><div class="field-pair"><label class="field">Start at bar<input id="auto-start" type="number" min="1" max="10000" value="${formForTick(engine.tick).bar + (engine.tick === 0 ? 1 : 2)}"/></label><label class="field">Length in bars<input id="auto-length" type="number" min="1" max="1000" value="16"/></label></div><label class="field" id="auto-world-field">Destination sound world<select id="auto-world">${allPresets()
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join(
        "",
      )}</select></label><label class="field" id="auto-value-field" hidden>Destination <output id="auto-value">75%</output><input id="auto-target" type="range" min="0" max="1" step="0.01" value="0.75"/></label><label class="field">Curve<select id="auto-curve"><option value="linear">Linear · steady change</option><option value="smooth">Smooth · ease in and out</option><option value="step">Step · switch at the end</option></select></label><div class="dialog-actions"><button id="auto-confirm" class="button primary">Add transition</button></div>`,
  );
  $<HTMLInputElement>("#auto-param").onchange = () => {
    const raw = $<HTMLInputElement>("#auto-param").value;
    $("#auto-world-field").hidden = raw !== "world";
    $("#auto-value-field").hidden = raw === "world";
    if (raw === "world") return;
    const key = raw as ParameterKey,
      def = PARAMETER_DEFINITIONS.find((p) => p.key === key)!;
    $<HTMLInputElement>("#auto-target").min = String(def.min);
    $<HTMLInputElement>("#auto-target").max = String(def.max);
    $<HTMLInputElement>("#auto-target").step = key === "tempo" ? "1" : ".01";
    $<HTMLInputElement>("#auto-target").value = String(params[key]);
    $("#auto-value").textContent = valueLabel(key, params[key]);
  };
  $<HTMLInputElement>("#auto-target").oninput = () => {
    $("#auto-value").textContent = valueLabel(
      $<HTMLInputElement>("#auto-param").value as ParameterKey,
      Number($<HTMLInputElement>("#auto-target").value),
    );
  };
  $("#auto-confirm").onclick = () => {
    if (busy || needsReconstruction) {
      toast("Finish navigation, retry playback or restart before changing the timeline");
      return;
    }
    const key = $<HTMLInputElement>("#auto-param").value as ParameterKey,
      startBar = Math.round(Math.max(1, Math.min(10000, Number($<HTMLInputElement>("#auto-start").value) || 1))),
      start = barTick(startBar),
      lengthBars = Math.round(Math.max(1, Math.min(1000, Number($<HTMLInputElement>("#auto-length").value) || 16))),
      length = barTick(startBar + lengthBars) - start,
      value = Number($<HTMLInputElement>("#auto-target").value),
      curve = $<HTMLInputElement>("#auto-curve").value as
        "linear" | "smooth" | "step";
    if (frames.length && start < engine.tick) {
      toast("Choose a future bar, or restart before editing earlier music");
      return;
    }
    try {
      const changes =
        $<HTMLInputElement>("#auto-param").value === "world"
          ? allPresets().find(
              (p) => p.id === $<HTMLSelectElement>("#auto-world").value,
            )!.parameters
          : { [key]: value };
      let next = performance;
      for (const [parameter, target] of Object.entries(changes))
        next = scheduleParameterTransition(
          next,
          parameter as ParameterKey,
          start,
          start + length,
          target,
          curve,
          engine.tick,
        );
      performance = next;
      engine.setAutomation(
        performance.automation,
        performance.automationRevisions,
      );
      refreshUnplayedOrigin();
      invalidateTimelineUndo();
      persist();
      renderAutomation();
      $<HTMLDialogElement>("dialog").close();
      toast("Transition added to your performance");
    } catch (error) {
      toast(`Transition could not be saved: ${(error as Error).message}`);
    }
  };
};
function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.textContent = `Save ${filename}`;
  a.className = "download-ready";
  document.querySelector(".download-ready")?.remove();
  const destination = $<HTMLDialogElement>("dialog").open
    ? $("#dialog-content")
    : $("#comparison-results");
  destination.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 300_000);
}
$("#export").onclick = () => {
  const microtonal = performance.sound.tuning !== "12tet" || (conductorConfig().enabled && conductorConfig().tuningTravel);
  const endBar = Math.max(
    2,
    formForTick(frames.at(-1)?.tick ?? barTick(17)).bar + 2,
  );
  modal(
    "Take the music with you",
    `<p class="subtle">MIDI carries individual voices and tempo changes into your DAW. JSON preserves the complete recipe for an exact replay.</p><div class="export-option"><strong>Multitrack MIDI</strong><span>${microtonal ? "Microtonal tunings and glides require exact JSON or WAV. Disable tuning journeys and use 12-TET for standard MIDI. No pitches are silently rounded." : "Bass, four harmonic voices, melody & percussion"}</span><div class="field-pair"><label class="field">From bar<input id="midi-start" type="number" min="1" max="1000" value="1"/></label><label class="field">To bar (exclusive)<input id="midi-end" type="number" min="2" max="1001" value="${Math.min(1001, endBar)}"/></label></div><button id="export-midi" class="button primary" ${microtonal ? "disabled" : ""}>${icon("download")}Export MIDI</button></div><div class="export-option"><strong>Reproducible performance</strong><span>Seed, conductor, tuning journeys, automation, scoring & bookmarks</span><button id="export-json" class="button">Export performance JSON</button></div><div class="export-option"><strong>Current preset</strong><span>Save this parameter vector for another seed</span><button id="export-preset" class="button">Export preset JSON</button></div>`,
  );
  $("#export-json").onclick = () =>
    download(
      serializePerformance(performance),
      "application/json",
      "continuum-performance.json",
    );
  let originalRecipe = previousRecipe;
  try { originalRecipe ??= [...priorVersions].reverse().map(version => localStorage.getItem(`continuum.previous-${version}`)).find(Boolean) ?? localStorage.getItem("continuum.previous-v4") ?? localStorage.getItem("continuum.previous-v3") ?? localStorage.getItem("continuum.previous-v2"); } catch { /* The in-memory backup remains exportable. */ }
  if (originalRecipe) {
    const backup = document.createElement("button");
    backup.className = "button quiet";
    let originalVersion = "unrecognized";
    try { originalVersion = JSON.parse(originalRecipe).engineVersion ?? "unrecognized"; } catch { /* Even an unreadable backup can be downloaded. */ }
    backup.textContent = `Download original ${originalVersion} recipe`;
    backup.onclick = () => download(originalRecipe, "application/json", `continuum-original-${originalVersion}.json`);
    $("#dialog-content").append(backup);
    const restore = document.createElement("button");
    restore.className = "button quiet";
    restore.textContent = "Restore original musical settings";
    restore.title = "Restore seed, macro parameters, automation and bookmarks; keep current sound, form and phrase controls. This creates a new composition.";
    restore.onclick = async () => {
      if (busy) return;
      try {
        const original = JSON.parse(originalRecipe!);
        const restored = parsePerformance(JSON.stringify({ ...original, engineVersion: ENGINE_VERSION, initialParameters: upgradeParameterVector(original.initialParameters), sound: performance.sound, conductor: performance.conductor, phrasing: performance.phrasing ?? DEFAULT_PHRASING }));
        await loadRecipe(restored);
        $<HTMLDialogElement>("dialog").close();
        toast("Original musical settings restored with current instruments and phrasing. The original recipe remains available.");
      } catch (error) { toast(`Restore failed: ${(error as Error).message}`); }
    };
    $("#dialog-content").append(restore);
  }
  $("#export-preset").onclick = () =>
    download(
      JSON.stringify(
        {
          format: "continuum-preset",
          name:
            allPresets().find((p) => p.id === chosenPresetId)?.name ||
            "My sound world",
          parameters: params,
        },
        null,
        2,
      ),
      "application/json",
      "continuum-preset.json",
    );
  $("#export-midi").onclick = async () => {
    const start = barTick(Math.max(1, Math.min(1000, Number($<HTMLInputElement>("#midi-start").value) || 1))),
      end = barTick(Math.max(2, Math.min(1001, Number($<HTMLInputElement>("#midi-end").value) || 17)));
    if (end <= start) {
      toast("The ending bar must come after the starting bar");
      return;
    }
    const button = $("#export-midi");
    button.setAttribute("disabled", "");
    button.textContent = "Composing your export…";
    try {
      const output: Frame[] = [];
      const composer = makeEngine();
      while (composer.tick < end) {
        const frame = composer.step();
        if (
          frame.tick + frame.duration > start ||
          frame.notes.some((note) => note.tick + note.duration > start)
        )
          output.push(frame);
        if (frame.index % 24 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      const bytes = exportMidi(output, start, end);
      download(bytes as unknown as BlobPart, "audio/midi", "continuum.mid");
      toast("MIDI exported with separate instrument tracks");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      button.removeAttribute("disabled");
      button.innerHTML = `${icon("download")}Export MIDI`;
    }
  };
};
$("#import").onclick = () => $<HTMLInputElement>("#import-file").click();
$<HTMLInputElement>("#import-file").onchange = async () => {
  const file = $<HTMLInputElement>("#import-file").files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000)
      throw new Error("Please choose a JSON file smaller than 2 MB.");
    const text = await file.text(),
      raw = JSON.parse(text);
    if (busy) {
      toast("Finish or cancel navigation before importing a performance");
      return;
    }
    if (raw.format === "continuum-preset") {
      if (
        typeof raw.name !== "string" ||
        !raw.parameters ||
        typeof raw.parameters !== "object" ||
        PARAMETER_DEFINITIONS.some(
          (p) =>
            typeof raw.parameters[p.key] !== "number" ||
            !Number.isFinite(raw.parameters[p.key]) ||
            raw.parameters[p.key] < p.min ||
            raw.parameters[p.key] > p.max,
        )
      )
        throw new Error("This preset has invalid or missing parameters.");
      const preset: Preset = {
        id: `custom-${crypto.randomUUID()}`,
        name: raw.name.slice(0, 60),
        parameters: normalizeParameters(raw.parameters),
        custom: true,
        color: "#a8c4b1",
        description: "Imported sound world",
      };
      customPresets.push(preset);
      savePresets(customPresets);
      renderPresets();
      toast("Preset imported into Sound worlds");
    } else {
      const imported = readCompatibleRecipe(text);
      await loadRecipe(imported, false, text);
      toast(reinterpreted(raw, imported)
        ? "Performance reinterpreted by the shared composition plan · original recipe preserved"
        : "Performance imported · ready for exact replay");
    }
  } catch (e) {
    toast(`Import failed: ${(e as Error).message}`);
  } finally {
    $<HTMLInputElement>("#import-file").value = "";
  }
};
$("#reset-weights").onclick = () => {
  if (busy) return;
  performance.weights = { ...DEFAULT_WEIGHTS };
  invalidateTimelineUndo();
  persist();
  createScoreControls();
  void restartAt(0);
};
$("#about").onclick = () =>
  modal(
    "An instrument, with a memory.",
    `<div class="about-copy"><p>Continuum composes an endless piece from a seed and your changing musical intentions. Four upper voices take small, independent steps while the bass can reinterpret the space beneath them.</p><p><strong>Try the central experiment.</strong> In Harmony, raise harmonic mobility. In Motion, keep voice-leading smoothness high. Watch the voices move by small pitch steps as the harmonic world changes.</p><p>Play and pause with <kbd>Space</kbd>. Sliders and morphs are recorded at musical boundaries. Exact replay restores the seed and its entire parameter journey. Save a preset to keep a sound; export a performance to keep its history.</p><p>Bookmarks return by deterministically rebuilding the preceding music. Export any interval up to bar 1001 as MIDI, including music you haven’t reached yet. Recent generated events are retained in memory; older moments remain reproducible from the performance.</p><p class="subtle">${ENGINE_VERSION} · All composition and synthesis happen in your browser. A shared link works wherever this app is served. Audio timbre may differ slightly between browsers; the musical event stream stays the same.</p></div>`,
  );
document.addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
      (e.target as HTMLElement).tagName,
    ) &&
    !$<HTMLDialogElement>("dialog").open
  ) {
    e.preventDefault();
    if (!e.repeat) void togglePlay();
  }
});
$<HTMLDialogElement>("dialog").addEventListener("click", (e) => {
  if (e.target === $<HTMLDialogElement>("dialog")) {
    const r = $<HTMLDialogElement>("dialog").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $<HTMLDialogElement>("dialog").close();
  }
});
document.addEventListener("play", (event) => {
  if (!(event.target instanceof HTMLAudioElement)) return;
  player.pause(); updateTransport();
  document.querySelectorAll("audio").forEach(audio => { if (audio !== event.target) audio.pause(); });
}, true);
document.addEventListener("pause", event => { if (event.target instanceof HTMLAudioElement) updateTransport(); }, true);
document.addEventListener("ended", event => { if (event.target instanceof HTMLAudioElement) updateTransport(); }, true);
$("#app .brand").onclick = (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
};
createConductorPanel();
phrasePanel = createPhrasePanel($(".conductor-panel"), {
  getConfig: () => performance.phrasing,
  onApply: async config => {
    if (busy) throw new Error("Finish or cancel navigation before applying phrasing.");
    const recipe = structuredClone(performance);
    recipe.phrasing = config;
    await loadRecipe(recipe, player.playing || auditionsPlaying());
    toast("Composition applied · same seed, a new interpretation");
  },
});
harmonyPanel = createHarmonyPanel($(".conductor-panel"), {
  getPerformance: () => performance,
  onAudition: () => { player.pause(); updateTransport(); },
  onApply: async config => {
    if (busy) throw new Error("Finish or cancel navigation before applying composition tools.");
    const recipe = structuredClone(performance);
    recipe.phrasing = { ...resolveCompositionProfile(recipe).phrasing, harmony: config };
    await loadRecipe(recipe, player.playing);
    toast("Composition tools applied · same seed, new harmonic reading");
  },
});
renderParameters();
renderPresets();
renderMemory();
renderAutomation();
createScoreControls();
renderSoundControls();
updateTransport();
document
  .querySelectorAll<HTMLInputElement>('input[type="range"]')
  .forEach(setRangeFill);
requestAnimationFrame(animate);
setTimeout(() => {
  const tick = Number(new URL(location.href).searchParams.get("at"));
  if (tick > 0) void restartAt(tick, false);
  else generatePreview();
}, 20);
if (initialMessage) setTimeout(() => toast(initialMessage), 500);
persist();
