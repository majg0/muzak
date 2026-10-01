import { DEFAULT_HARMONY, HARMONY_CONTROLS, normalizeHarmony, type HarmonyConfig } from './harmonic-language';
import type { Frame, Performance } from './types';
import { renderThematicComparison } from './thematic-audit';
import { encodeWav } from './audio';

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const rootName = (degree: number, tuning: import('./pitch').TuningId) => tuning !== '12tet' ? `d${degree}`
  : ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][((degree % 12) + 12) % 12];

export function createHarmonyPanel(host: HTMLElement, options: {
  getPerformance: () => Performance;
  onApply: (config: HarmonyConfig) => Promise<void>;
  onAudition: () => void;
}) {
  const section = document.createElement('section'); section.className = 'panel harmonic-language-panel';
  section.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">AN IDEA, THEN A JOURNEY</span><h2>Theme & harmonic direction</h2></div><a href="./theme-study.html" target="_blank" rel="noopener">Theme studies & strategy ↗</a></div>
    <p class="subtle">A melodic core keeps its identity. Harmony chooses where to go; the voices find a connected path there.</p>
    <div class="harmonic-current" aria-live="polite"><strong id="harmonic-current-name">Waiting for a harmonic destination</strong><span id="harmonic-current-purpose"></span><span id="harmonic-realization"></span></div>
    <div id="harmonic-route" class="harmonic-route" aria-label="Planned harmonic route"></div>
    <div id="thematic-core" class="thematic-core"></div>
    <details class="harmonic-settings" open><summary>Composition tools <span>Hold one relationship, change another</span></summary>
      <div class="phrase-switches">
      <label>Harmonic language<select id="harmony-strategy"><option value="balanced">Directed, with occasional color</option><option value="functional">Functional departures & cadences</option><option value="tonnetz">Tonnetz · common-tone transformations</option><option value="third-cycle">Third-cycle regions · Coltrane-inspired</option></select></label>
      <label>What returns?<select id="harmony-treatment"><option value="develop">Keep the head · develop the continuation</option><option value="reharmonize">Keep the melody · change its harmony</option><option value="sequence">Keep intervals & rhythm · move the region</option></select></label></div>
      <div class="phrase-knobs">${HARMONY_CONTROLS.map(([key, label, help]) => `<div class="parameter"><label for="harmony-${key}">${label}<output id="harmony-value-${key}"></output></label><input id="harmony-${key}" type="range" min="0" max="1" step=".01" aria-describedby="harmony-help-${key}"/><p id="harmony-help-${key}">${help}</p></div>`).join('')}</div>
      <p class="subtle tiny">Every composition connects thematic identity, harmonic destinations and voice movement. 19, 24 and 31-EDO use explicitly chosen native collections and unequal region cycles. In 24-EDO, major/minor labels mean the chosen 450/250-cent third colors, not classical tonal function. Sensory roughness remains a separate sound-dependent objective.</p>
      <div class="phrase-apply"><button id="apply-harmony" class="button primary">Apply tools & restart</button><span id="harmony-status">The previous performance is saved. Changes become part of replay and sharing.</span></div>
    </details>
    <div class="experiment-compare"><div><strong>One tune, three harmonic readings</strong><span>Hear the bare core, functional support, common-tone color, and third-cycle regions. All three keep the same melody notes and timing.</span></div><button id="compare-themes" class="button">Render theme comparison</button></div>
    <div id="theme-comparison" class="theme-comparison"></div>`;
  host.after(section);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => section.querySelector<T>(selector)!;
  let frameKey = '', urls: string[] = [], comparing = false;
  function sync() {
    const recipe = options.getPerformance(), config = normalizeHarmony(recipe.phrasing?.harmony);
    $<HTMLSelectElement>('#harmony-strategy').value = config.strategy;
    $<HTMLSelectElement>('#harmony-treatment').value = config.treatment;
    for (const [key] of HARMONY_CONTROLS) {
      $<HTMLInputElement>(`#harmony-${key}`).value = String(config[key]);
      $(`#harmony-value-${key}`).textContent = percent(config[key]);
      $(`#harmony-${key}`).style.setProperty('--fill', percent(config[key]));
    }
    frameKey = '';
  }
  for (const [key] of HARMONY_CONTROLS) $<HTMLInputElement>(`#harmony-${key}`).oninput = () => {
    const value = Number($<HTMLInputElement>(`#harmony-${key}`).value);
    $(`#harmony-value-${key}`).textContent = percent(value); $(`#harmony-${key}`).style.setProperty('--fill', percent(value));
  };
  $('#apply-harmony').onclick = async () => {
    const button = $<HTMLButtonElement>('#apply-harmony'); button.disabled = true;
    try {
      const config = normalizeHarmony({ ...DEFAULT_HARMONY,
        strategy: $<HTMLSelectElement>('#harmony-strategy').value as HarmonyConfig['strategy'],
        treatment: $<HTMLSelectElement>('#harmony-treatment').value as HarmonyConfig['treatment'],
        ...Object.fromEntries(HARMONY_CONTROLS.map(([key]) => [key, Number($<HTMLInputElement>(`#harmony-${key}`).value)])),
      });
      await options.onApply(config); sync(); $('#harmony-status').textContent = 'Applied to this seed. Ready to hear the new interpretation.';
    } catch (error) { $('#harmony-status').textContent = (error as Error).message; }
    finally { button.disabled = false; }
  };
  $('#compare-themes').onclick = async () => {
    if (comparing) return;
    comparing = true; $<HTMLButtonElement>('#compare-themes').disabled = true; options.onAudition();
    urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
    const results = $('#theme-comparison'); results.replaceChildren();
    const status = document.createElement('p'); status.setAttribute('role', 'status'); results.append(status);
    try {
      const report = await renderThematicComparison(options.getPerformance(), {
        onProgress: message => { status.textContent = message; },
        onRendered: (label, buffer) => {
          const article = document.createElement('article'), heading = document.createElement('strong'), audio = document.createElement('audio');
          heading.textContent = label; audio.controls = true; audio.preload = 'metadata';
          const url = URL.createObjectURL(new Blob([new Uint8Array(encodeWav(buffer))], { type: 'audio/wav' })); urls.push(url); audio.src = url;
          article.append(heading, audio); results.append(article);
        },
      });
      status.textContent = `Same core confirmed · ${report.melodyNotes} melody notes · ${report.bars} bars · ${report.tuning}. ${report.distinctReadings} distinct accompaniments; melody pitches and timing are identical.${report.distinctReadings < 3 ? ' Some strategies converge on the same support for this tune.' : ''}`;
      const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
      summary.textContent = 'Composition and audio measurements'; pre.textContent = JSON.stringify(report, null, 2); details.append(summary, pre); results.append(details);
    } catch (error) { status.textContent = `Comparison could not complete: ${(error as Error).message}`; }
    finally { comparing = false; $<HTMLButtonElement>('#compare-themes').disabled = false; }
  };
  function update(frame?: Frame) {
    const plan = frame?.diagnostics.harmonicPlan, core = frame?.phrase?.themeCore;
    const key = `${frame?.index}:${frame?.phrase?.startTick}:${plan?.current.id ?? 'off'}`;
    if (key === frameKey) return; frameKey = key;
    if (!plan || !frame) {
      $('#harmonic-current-name').textContent = 'The harmonic route is taking shape';
      $('#harmonic-current-purpose').textContent = 'Play to follow the theme and its destinations.';
      $('#harmonic-realization').textContent = ''; $('#harmonic-route').replaceChildren(); $('#thematic-core').replaceChildren(); return;
    }
    const { current, realization } = plan, tuning = frame.sound.tuning;
    $('#harmonic-current-name').textContent = `${rootName(current.root, tuning)} ${current.quality} · ${current.function}`;
    $('#harmonic-current-purpose').textContent = `${current.operation}${current.cadence ? ` · ${current.cadence} cadence` : ''}`;
    $('#harmonic-realization').textContent = `${realization.matched ? 'Voicing plan matches' : 'Voicing plan approaching destination'} · ${percent(realization.chordToneFraction)} chord tones · planned bass ${realization.bassOnRoot ? 'on root' : 'in inversion / transition'}. The arrangement chooses which players sound.`;
    $('#harmonic-route').innerHTML = plan.destinations.map(item => `<div class="harmonic-stop${item.id === current.id ? ' active' : ''}" title="${escape(item.operation)}"><b>${rootName(item.root, tuning)} ${escape(item.quality)}</b><span>${escape(item.function)}</span><small>${item.cadence ? escape(item.cadence) : escape(item.operation)}</small></div>`).join('');
    $('#thematic-core').innerHTML = core ? `<div class="mini-heading">PROTECTED MELODIC CORE <span>${escape(core.grammar)} · ${escape(core.treatment)}</span></div><p>Core <code>${escape(core.id)}</code> · ${core.notes.length} structural notes. The played notes keep these identities through new harmonic readings.</p><div class="core-notes">${core.notes.map(note => `<span title="${escape(`${note.purpose} · ${(note.endTick - note.startTick) / 480} beats · ${note.sourceId}`)}"><b>${note.degree + 1}</b><small>${escape(note.role)}</small></span>`).join('')}</div>` : '';
  }
  sync(); return { sync, update };
}
