import './harmonic-motion.css';
import type { CompositionPlan } from '../core/generated/CompositionPlan';
import type { HarmonicMotionOptions } from '../core/generated/HarmonicMotionOptions';
import type { HarmonicMotionAnalysis } from '../core/generated/HarmonicMotionAnalysis';
import type { ProgressionDefaults } from '../core/generated/ProgressionDefaults';
import type { ProgressionOptions } from '../core/generated/ProgressionOptions';
import type { ProgressionResult } from '../core/generated/ProgressionResult';
import type { ProgressionChord } from '../core/generated/ProgressionChord';
import type { LabSession } from './types';
import { mountScorePreview, type ScorePreviewResult } from './shared/score-preview';

type Accepted = ScorePreviewResult & (
  { kind: 'progression'; result: ProgressionResult }
  | { kind: 'exact'; options: HarmonicMotionOptions; plan: CompositionPlan }
);

/** Rust supplies vocabulary, functional readings, phrase choices and notes.
 * This view edits premises and displays the resulting executable plan. */
export function createSession(): LabSession {
  let defaults: ProgressionDefaults | undefined, options: ProgressionOptions | undefined;
  let accepted: Accepted | undefined, analysis: HarmonicMotionAnalysis | undefined;
  let inspectedOptions: HarmonicMotionOptions | undefined;
  let selectedIndex = -1, dirty = false, mountVersion = 0;
  let exactDraft = '', exactDirty = false;
  return {
    async mount(container, context) {
      const version = ++mountVersion;
      let disposed = false, job = 0, analysisJob = 0, busy = false, downloadUrl: string | undefined;
      context.onDispose(() => { disposed = true; job++; analysisJob++; if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
      const active = () => !disposed && !context.signal.aborted && version === mountVersion;
      container.classList.add('motion-lab');
      container.innerHTML = `
        <section class="panel motion-panel motion-intro">
          <form id="motion-generator" data-motion="form" novalidate>
            <div class="motion-controls">
              <label>Key<select data-motion="tonic" data-generator-input disabled></select></label>
              <label class="motion-scale-control">Scale / mode<select data-motion="scale" data-generator-input disabled></select></label>
              <label>Length<input data-motion="length" data-generator-input type="number" min="4" max="16" step="1" required disabled></label>
              <label class="motion-color-control">Harmonic color<select data-motion="color" data-generator-input disabled></select></label>
            </div>
            <p class="motion-control-hint" data-motion="color-description"></p>
            <div class="motion-actions"><button type="submit" class="button primary" data-motion="generate" disabled>Generate progression</button><button type="button" class="button" data-motion="variation" disabled>New variation</button><p class="motion-status" data-motion="status" role="status" aria-live="polite">Loading the musical core…</p></div>
          </form>
        </section>
        <section class="panel motion-panel" data-motion="passage-panel" hidden>
          <div class="motion-section-heading"><div><p class="eyebrow">YOUR PROGRESSION</p><h2 data-motion="passage-heading"></h2></div><div class="motion-collection" data-motion="collection"></div></div>
          <ol class="motion-passage" data-motion="passage" aria-label="Progression chords"></ol>
          <p class="motion-passage-reason" data-motion="passage-reason"></p>
          <details class="motion-roman-help"><summary>How to read Roman numerals</summary><p>Numerals locate a root relative to the tonic. Uppercase is major; lowercase is minor. ° means diminished, ø means half-diminished, and + means augmented. ♭ or ♯ changes the root’s scale degree. A slash names a temporary target: V7/V is the dominant seventh of the dominant. Alterations in parentheses change chord tones.</p></details>
        </section>
        <section data-motion="preview"></section>
        <section class="panel motion-panel motion-selection" data-motion="selection-panel" hidden>
          <div class="motion-section-heading"><div><p class="eyebrow" data-motion="selected-position"></p><h2 data-motion="selected-heading"></h2></div><div class="motion-neighbors" data-motion="neighbors"></div></div>
          <p class="motion-selected-reason" data-motion="selected-reason"></p>
          <div class="motion-selected-facts" data-motion="selected-facts"></div>
          <div data-motion="replacement-section"><div class="motion-section-heading motion-replacement-heading"><h3>Try a different direction</h3><span data-motion="replacement-hint">Replace this chord and revoice the phrase.</span></div><div class="motion-replacements" data-motion="replacements"></div><details class="motion-more-replacements" data-motion="more-replacements"><summary>More alternatives</summary><div class="motion-replacements" data-motion="other-replacements"></div></details></div>
        </section>
        <section class="panel motion-panel motion-theory">
          <div class="motion-section-heading"><div><p class="eyebrow">ONE MODEL, DIFFERENT MUSICAL LANGUAGES</p><h2>Home → color → direction → connection</h2></div></div>
          <ol class="motion-model">
            <li><span>1</span><div><strong>Choose a home</strong><p>The tonic and collection give notes their scale degrees. Roman numerals describe chords relative to that home.</p></div></li>
            <li><span>2</span><div><strong>Build and transform</strong><p>Stack the collection’s notes, then borrow or alter them. Diminished chords, extensions and substitutions are transformations with audible consequences.</p></div></li>
            <li><span>3</span><div><strong>Give the phrase direction</strong><p>A chord can leave home, prepare an arrival or pull toward a temporary target. Its effect depends on the whole phrase and what follows.</p></div></li>
            <li><span>4</span><div><strong>Connect the voices</strong><p>Keep shared tones and move the other notes. Smooth motion and harmonic function are separate ingredients in the same progression.</p></div></li>
          </ol>
          <p class="motion-note">These are compositional choices you can hear and edit. A chord’s label describes a reading in this context; it does not dictate one universal effect.</p>
        </section>
        <details class="panel motion-panel motion-advanced" data-motion="advanced">
          <summary>More control &amp; theory</summary>
          <div class="motion-advanced-content">
            <h3>Sound &amp; repeatability</h3>
            <div class="motion-controls motion-sound-controls">
              <label>Tempo · quarters/min<input type="number" min="30" max="240" step="any" required data-motion="tempo" data-generator-input form="motion-generator" disabled></label>
              <label>Seed<input type="number" min="0" max="4294967295" step="1" required data-motion="seed" data-generator-input form="motion-generator" disabled></label>
              <label class="motion-check"><input type="checkbox" data-motion="arpeggiate" data-generator-input form="motion-generator" disabled>Arpeggiate the chords</label>
            </div>
            <p class="motion-note">Generate applies these settings. The same key, scale, color, length and seed reproduce the same phrase.</p>
            <details class="motion-detail" data-motion="vocabulary"><summary>Chord vocabulary &amp; Roman-numeral convention</summary><p class="motion-note" data-motion="generator-explanation"></p><p class="motion-note" data-motion="roman-convention"></p><div class="motion-scroll" data-motion="catalog"></div></details>
            <details class="motion-detail"><summary>Exact relationships, alternate tunings &amp; program</summary>
              <p class="motion-note">The same relationship engine accepts exact pitches, arbitrary periods, tonal frames and entire passages. This request starts from your generated phrase. Custom requests can express other tunings; Roman numerals remain specific to the tonal generator above.</p>
              <label class="motion-json-label">Exact harmonic-motion request<textarea class="motion-json" data-motion="json" spellcheck="false"></textarea></label>
              <div class="motion-actions"><button class="button" type="button" data-motion="inspect-exact" disabled>Inspect relationships</button><button class="button" type="button" data-motion="apply-exact" disabled>Apply &amp; audition custom passage</button><button class="button quiet" type="button" data-motion="reset-exact" disabled>Use current passage</button></div>
              <p class="motion-exact-status" data-motion="exact-status" role="status" aria-live="polite"></p>
              <div data-motion="relationships"></div>
              <div class="motion-actions"><button class="button" type="button" data-motion="download-request" disabled>Request JSON</button><button class="button" type="button" data-motion="download-analysis" disabled>Analysis JSON</button><button class="button" type="button" data-motion="download-program" disabled>Composition program</button></div>
            </details>
          </div>
        </details>`;
      const get = <T extends HTMLElement = HTMLElement>(name: string) => container.querySelector<T>(`[data-motion="${name}"]`)!;
      const form = get<HTMLFormElement>('form');
      const preview = mountScorePreview(get('preview'), context, 'continuum-harmonic-motion');
      // Transport remains visible; the full reusable timeline is optional.
      const timeline = get('preview').querySelector<HTMLElement>('.lab-preview-timeline')!;
      const roll = document.createElement('details'); roll.className = 'motion-roll';
      const summary = document.createElement('summary'); summary.textContent = 'Piano roll & playback navigation';
      timeline.before(roll); roll.append(summary, timeline);
      get('preview').querySelector('h2')!.textContent = 'Hear your progression';
      const showStatus = (text: string, error = false) => {
        if (!active()) return;
        get('status').textContent = text; get('status').classList.toggle('lab-error', error);
      };
      const exactStatus = (text: string, error = false) => {
        if (!active()) return;
        get('exact-status').textContent = text; get('exact-status').classList.toggle('lab-error', error);
      };
      const sourceOptions = () => accepted?.kind === 'progression' ? accepted.result.motionOptions : accepted?.options;
      const sourcePlan = () => accepted?.kind === 'progression' ? accepted.result.plan : accepted?.plan;
      function updateActions(): void {
        for (const name of ['generate', 'variation']) get<HTMLButtonElement>(name).disabled = !options || busy;
        for (const name of ['inspect-exact', 'apply-exact', 'reset-exact', 'download-request', 'download-program']) get<HTMLButtonElement>(name).disabled = !accepted || busy;
        get<HTMLButtonElement>('download-analysis').disabled = !analysis || busy;
        get('generate').toggleAttribute('aria-busy', busy);
        for (const button of container.querySelectorAll<HTMLButtonElement>('[data-replace]')) button.disabled = busy || dirty;
        get('replacement-hint').textContent = dirty ? 'Generate to apply your changed settings before editing a chord.' : 'Replace this chord and revoice the phrase.';
      }
      function writeOptions(): void {
        if (!defaults || !options) return;
        get<HTMLSelectElement>('tonic').value = options.tonic;
        get<HTMLSelectElement>('scale').value = JSON.stringify([options.family, options.mode]);
        get<HTMLSelectElement>('color').value = options.color;
        for (const field of ['length', 'tempo', 'seed'] as const) get<HTMLInputElement>(field).value = String(options[field]);
        get<HTMLInputElement>('arpeggiate').checked = options.arpeggiate;
        renderColorHint();
      }
      function renderColorHint(): void {
        get('color-description').textContent = defaults?.colors.find(color => color.id === get<HTMLSelectElement>('color').value)?.description ?? '';
      }
      function readOptions(): ProgressionOptions | undefined {
        if (!options || !defaults || !form.checkValidity()) return;
        const scale = defaults.families.flatMap(family => family.modes.map((_, mode) => ({ family: family.id, mode })))
          .find(value => JSON.stringify([value.family, value.mode]) === get<HTMLSelectElement>('scale').value);
        const color = defaults.colors.find(value => value.id === get<HTMLSelectElement>('color').value)?.id;
        const tonic = defaults.tonics.find(value => value === get<HTMLSelectElement>('tonic').value);
        if (!scale || !color || !tonic) return;
        return { ...options, ...scale, color, tonic, length: get<HTMLInputElement>('length').valueAsNumber,
          tempo: get<HTMLInputElement>('tempo').valueAsNumber, seed: get<HTMLInputElement>('seed').valueAsNumber,
          arpeggiate: get<HTMLInputElement>('arpeggiate').checked };
      }
      function validForm(): boolean {
        // Native form validation must be able to focus an invalid advanced input.
        if (get('advanced').querySelector(':invalid')) get<HTMLDetailsElement>('advanced').open = true;
        return form.reportValidity();
      }
      function changed(): void {
        job++; busy = false; dirty = true;
        const next = readOptions(); if (next) options = next;
        renderColorHint(); updateActions();
        showStatus('Settings changed. Generate a progression to hear them; your current phrase is still below.');
      }
      function refreshExact(): void {
        if (!exactDirty) exactDraft = JSON.stringify(sourceOptions(), null, 2) ?? '';
        get<HTMLTextAreaElement>('json').value = exactDraft;
      }
      function chordCard(chord: ProgressionChord, index: number): string {
        return `<li><button type="button" class="motion-chord" data-select-step="${index}" aria-pressed="${index === selectedIndex}" aria-label="Chord ${index + 1}: ${html(chord.roman)}, ${html(chord.name)}. ${html(chord.role)}."><span class="motion-chord-position">${index + 1}</span><strong class="motion-roman">${html(chord.roman)}</strong><span class="motion-chord-name">${html(chord.name)}</span><span class="motion-role" data-role="${html(chord.role)}">${html(chord.role)}</span></button></li>`;
      }
      function renderPassage(): void {
        if (!accepted) return;
        get('passage-panel').hidden = false; get('selection-panel').hidden = false;
        if (accepted.kind === 'progression') {
          const { result } = accepted;
          if (selectedIndex < 0 || selectedIndex >= result.steps.length) selectedIndex = Math.max(0, result.steps.length - 2);
          get('passage-heading').textContent = result.catalog.scaleName;
          get('collection').innerHTML = `<span>Scale notes</span>${result.catalog.scaleTones.map((tone, index) => `<span class="motion-scale-tone"><strong>${html(tone)}</strong><small>${html(result.catalog.degreeNames[index] ?? '')}</small></span>`).join('')}`;
          get('passage').innerHTML = result.steps.map(step => chordCard(step.chord, step.index)).join('');
          get('passage-reason').textContent = 'Play the whole phrase, then select a chord to compare other ways of reaching the next one.';
          get('vocabulary').hidden = false;
          get('generator-explanation').textContent = result.explanation;
          get('roman-convention').textContent = result.romanConvention;
          get('catalog').innerHTML = `<table class="motion-table"><thead><tr><th>Roman</th><th>Chord</th><th>Notes</th><th>Construction</th></tr></thead><tbody>${result.catalog.chords.map(chord => `<tr><td>${html(chord.roman)}</td><td>${html(chord.name)}</td><td>${html(chord.toneNames.join(' · '))}</td><td>${html(chord.derivation)}</td></tr>`).join('')}</tbody></table>`;
        } else {
          const source = accepted.options;
          selectedIndex = Math.min(selectedIndex, Math.max(0, source.history.length - 1));
          get('passage-heading').textContent = 'Custom harmonic passage';
          get('collection').textContent = source.frames.map(frame => frame.name).join(' · ') || 'No tonal center supplied';
          get('passage').innerHTML = source.history.map((step, index) => `<li><button type="button" class="motion-chord motion-custom-chord" data-select-step="${index}" aria-pressed="${index === selectedIndex}"><span class="motion-chord-position">${index + 1}</span><strong>${html(source.chords.find(chord => chord.id === step.chordId)?.name ?? step.chordId)}</strong><span class="motion-role">Exact authored chord</span></button></li>`).join('');
          get('passage-reason').textContent = 'This is the exact passage from the advanced editor. Generate a progression above to return to the tonal composer.';
          get('vocabulary').hidden = true;
        }
        renderSelection(); refreshExact(); updateActions();
      }
      function renderSelection(): void {
        if (!accepted) return;
        const source = accepted;
        for (const button of get('passage').querySelectorAll<HTMLButtonElement>('[data-select-step]')) button.setAttribute('aria-pressed', String(Number(button.dataset.selectStep) === selectedIndex));
        get('selected-position').textContent = `CHORD ${selectedIndex + 1} · IN CONTEXT`;
        if (source.kind === 'exact') {
          const step = source.options.history[selectedIndex], chord = source.options.chords.find(chord => chord.id === step?.chordId);
          get('selection-panel').hidden = !chord;
          if (!chord) return;
          get('selected-heading').textContent = chord.name; get('neighbors').textContent = '';
          get('selected-reason').textContent = 'Custom coordinates preserve your supplied voicing and tuning. Inspect the exact relationship request below to compare its movement and tonal frames.';
          get('selected-facts').innerHTML = `<div><span>Members · native millicents</span><strong>${chord.pitchesMillicents.join(' · ')}</strong></div><div><span>Supplied root · native millicents</span><strong>${chord.rootMillicents ?? 'Unknown'}</strong></div>`;
          get('replacement-section').hidden = true; return;
        }
        const { result } = source, step = result.steps[selectedIndex]; if (!step) return;
        const { chord } = step;
        get('selected-heading').textContent = `${chord.roman} · ${chord.name}`;
        get('neighbors').innerHTML = [result.steps[selectedIndex - 1], step, result.steps[selectedIndex + 1]].map((neighbor, index) => neighbor ? `<span${index === 1 ? ' class="motion-current-neighbor"' : ''}>${html(neighbor.chord.roman)}<small>${html(neighbor.chord.name)}</small></span>` : '<span class="motion-phrase-end">Phrase edge</span>').join('<span class="motion-arrow" aria-hidden="true">→</span>');
        get('selected-reason').textContent = step.reason;
        get('selected-facts').innerHTML = `<div><span>Chord tones</span><strong>${html(chord.toneNames.join(' · '))}</strong></div><div><span>Relative to ${html(result.catalog.tonic)}</span><strong>${html(chord.globalRoman)}</strong></div><details class="motion-construction"><summary>How it is built</summary><p>${html(chord.derivation)}</p></details>`;
        const replacements = step.replacements.flatMap(replacement => {
          const candidate = result.catalog.chords.find(chord => chord.id === replacement.chordId);
          return candidate ? [{ candidate, reason: replacement.reason }] : [];
        });
        // Show distinct Rust-provided construction labels, preserving order
        // within each group. This changes presentation, never musical ranking.
        const operators = new Set<string>(), names = new Set<string>();
        const featured = replacements.filter(({ candidate }) => {
          if (operators.size >= 4 || operators.has(candidate.operator) || names.has(candidate.name)) return false;
          operators.add(candidate.operator); names.add(candidate.name); return true;
        }).slice(0, 4);
        for (const replacement of replacements) {
          if (featured.length === 4) break;
          if (!names.has(replacement.candidate.name)) { names.add(replacement.candidate.name); featured.push(replacement); }
        }
        const other = replacements.filter(replacement => !featured.includes(replacement));
        const replacementCard = ({ candidate, reason }: typeof replacements[number]) => `<button class="motion-replacement" type="button" data-replace="${html(candidate.id)}"><span><strong>${html(candidate.roman)}</strong><span>${html(candidate.name)}</span></span><span class="motion-operator">${html(readable(candidate.operator))}</span><small>${html(reason)}</small><span class="motion-replace-action">Use this chord <span aria-hidden="true">↗</span></span></button>`;
        get('replacement-section').hidden = false;
        get('replacements').innerHTML = featured.map(replacementCard).join('') || '<p class="motion-note">This phrase anchor has no compatible replacement in the current palette.</p>';
        get('other-replacements').innerHTML = other.map(replacementCard).join('');
        get('more-replacements').hidden = other.length === 0; updateActions();
      }
      function renderAnalysis(): void {
        if (!analysis) { get('relationships').replaceChildren(); return; }
        const value = analysis;
        get('relationships').innerHTML = `<p class="motion-note">${value.pairCount} ordered pairs, including self-transitions. ${value.selectedCorrespondences.length} minimum assignments for the request’s selected pair; equal costs do not establish voice identity.</p><div class="motion-scroll"><table class="motion-table"><thead><tr><th>From</th><th>To</th><th>Mean motion · cents</th><th>Shared tones</th><th>Assignments</th></tr></thead><tbody>${value.atlas.map(pair => `<tr><td>${html(pair.fromChordId)}</td><td>${html(pair.toChordId)}</td><td>${format(pair.meanMotionCents)}</td><td>${pair.commonToneCount}</td><td>${pair.optimalCorrespondenceCount}</td></tr>`).join('')}</tbody></table></div><details class="motion-detail"><summary>Exact assignments, frame effects &amp; complete analysis</summary><pre class="motion-analysis-json">${html(JSON.stringify(value, null, 2))}</pre></details>`;
        updateActions();
      }
      async function generate(proposed: ProgressionOptions, chordIds?: string[]): Promise<void> {
        const ticket = ++job, snapshot = structuredClone(proposed);
        analysisJob++; busy = true; updateActions();
        showStatus(chordIds ? 'Revoicing the phrase around your chosen chord…' : 'Shaping a phrase and connecting its voices…');
        try {
          const result = await context.call('generateProgression', { options: snapshot, chordIds });
          if (!active() || ticket !== job) return;
          const score = await context.call('compileComposition', { plan: result.plan });
          if (!active() || ticket !== job) return;
          const meter = await context.call('scoreMeter', { score });
          if (!active() || ticket !== job) return;
          const scoreChanged = !accepted || JSON.stringify(accepted.score) !== JSON.stringify(score);
          options = result.options; accepted = { kind: 'progression', result, score, meter };
          dirty = false; exactDirty = false; analysis = undefined; inspectedOptions = undefined; busy = false;
          writeOptions(); renderPassage(); renderAnalysis(); if (scoreChanged) preview.setResult(accepted); exactStatus('');
          showStatus(chordIds ? 'Chord changed. Play the phrase to hear its new direction.' : 'Ready to play. Select any chord to understand it or try a replacement.');
        } catch (error) { if (active() && ticket === job) showStatus(`${accepted ? 'Your current phrase is retained. ' : ''}${message(error)}`, true); }
        finally { if (active() && ticket === job) { busy = false; updateActions(); } }
      }
      async function exactRequest(realize: boolean): Promise<void> {
        if (!accepted) return;
        let proposed: HarmonicMotionOptions;
        try {
          proposed = JSON.parse(exactDraft) as HarmonicMotionOptions;
          if (!proposed || typeof proposed !== 'object' || Array.isArray(proposed)) throw new Error('Enter a harmonic-motion request object.');
        } catch (error) { exactStatus(message(error), true); return; }
        const ticket = ++analysisJob, generationTicket = realize ? ++job : job;
        if (realize) { busy = true; updateActions(); }
        exactStatus(realize ? 'Validating and compiling the custom passage…' : 'Comparing every pair in this exact request…');
        const current = () => active() && ticket === analysisJob && generationTicket === job;
        try {
          const inspected = await context.call('analyzeHarmonicMotion', { options: proposed });
          if (!current()) return;
          if (realize) {
            const plan = await context.call('realizeHarmonicMotion', { options: proposed });
            if (!current()) return;
            const score = await context.call('compileComposition', { plan });
            if (!current()) return;
            const meter = await context.call('scoreMeter', { score });
            if (!current()) return;
            const scoreChanged = !accepted || JSON.stringify(accepted.score) !== JSON.stringify(score);
            accepted = { kind: 'exact', options: proposed, plan, score, meter };
            selectedIndex = 0; exactDirty = false; busy = false;
            renderPassage(); if (scoreChanged) preview.setResult(accepted);
            showStatus('Your custom passage is ready. Generate above to return to the tonal composer.');
          }
          analysis = inspected; inspectedOptions = proposed; renderAnalysis();
          exactStatus(`${inspected.pairCount} ordered pairs inspected.${realize ? ' The custom passage is now in the player.' : ' Playback is unchanged.'}`);
        } catch (error) { if (current()) exactStatus(`Current phrase retained. ${message(error)}`, true); }
        finally { if (current() && realize) { busy = false; updateActions(); } }
      }
      function download(name: string, data: unknown): void {
        if (data === undefined) return;
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = downloadUrl; anchor.download = `continuum-harmony-${name}.json`; anchor.click();
      }
      form.addEventListener('submit', event => {
        event.preventDefault(); if (!validForm()) return;
        const next = readOptions(); if (next) void generate(next);
      }, { signal: context.signal });
      container.addEventListener('input', event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
        if (target.dataset.motion === 'json') { exactDraft = target.value; exactDirty = true; analysisJob++; job++; busy = false; analysis = undefined; inspectedOptions = undefined; renderAnalysis(); updateActions(); exactStatus('Request edited. Inspect it, or apply it to the player.'); }
        else if (target.hasAttribute('data-generator-input')) changed();
      }, { signal: context.signal });
      container.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
        if (button.dataset.selectStep !== undefined) { selectedIndex = Number(button.dataset.selectStep); renderSelection(); return; }
        if (button.dataset.replace && accepted?.kind === 'progression' && !dirty && !busy) {
          const step = accepted.result.steps[selectedIndex];
          if (!step?.replacements.some(replacement => replacement.chordId === button.dataset.replace)) return;
          const chordIds = accepted.result.steps.map((step, index) => index === selectedIndex ? button.dataset.replace! : step.chordId);
          void generate(accepted.result.options, chordIds); return;
        }
        switch (button.dataset.motion) {
          case 'variation': {
            if (!validForm()) return;
            const next = readOptions(); if (next) void generate({ ...next, seed: (next.seed + 1) >>> 0 }); break;
          }
          case 'inspect-exact': void exactRequest(false); break;
          case 'apply-exact': void exactRequest(true); break;
          case 'reset-exact': analysisJob++; exactDirty = false; analysis = undefined; inspectedOptions = undefined; refreshExact(); renderAnalysis(); updateActions(); exactStatus('Request restored from the current passage.'); break;
          case 'download-request':
            try { download('request', JSON.parse(exactDraft)); }
            catch (error) { exactStatus(`Request JSON could not be read: ${message(error)}`, true); }
            break;
          case 'download-analysis': download('analysis', analysis && { options: inspectedOptions, analysis }); break;
          case 'download-program': download('program', sourcePlan()); break;
        }
      }, { signal: context.signal });
      if (accepted) { renderPassage(); renderAnalysis(); preview.setResult(accepted); }
      try {
        defaults ??= await context.call('getProgressionDefaults', {});
        if (!active()) return;
        options ??= structuredClone(defaults.options);
        get('tonic').innerHTML = defaults.tonics.map(tonic => `<option value="${html(tonic)}">${html(tonic)}</option>`).join('');
        get('scale').innerHTML = defaults.families.map(family => `<optgroup label="${html(family.name)}">${family.modes.map((name, mode) => `<option value="${html(JSON.stringify([family.id, mode]))}">${html(name)}</option>`).join('')}</optgroup>`).join('');
        get('color').innerHTML = defaults.colors.map(color => `<option value="${html(color.id)}">${html(color.name)}</option>`).join('');
        for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-generator-input]')) control.disabled = false;
        writeOptions(); updateActions();
        if (accepted) showStatus(dirty ? 'Your settings and current phrase are retained. Generate to apply the settings.' : 'Your phrase is retained. Play it, or select a chord to explore.');
        else await generate(options);
      } catch (error) { if (active()) showStatus(`Could not load the tonal composer: ${message(error)}`, true); }
    },
  };
}

function html(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
function format(value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function readable(value: string): string { const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2'); return spaced[0].toUpperCase() + spaced.slice(1).toLowerCase(); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
