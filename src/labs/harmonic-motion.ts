import './harmonic-motion.css';
import type { CompositionPlan } from '../core/generated/CompositionPlan';
import type { HarmonicMotionOptions } from '../core/generated/HarmonicMotionOptions';
import type { HarmonicMotionAnalysis } from '../core/generated/HarmonicMotionAnalysis';
import type { ProgressionDefaults } from '../core/generated/ProgressionDefaults';
import type { ProgressionOptions } from '../core/generated/ProgressionOptions';
import type { ProgressionResult } from '../core/generated/ProgressionResult';
import type { ProgressionChord } from '../core/generated/ProgressionChord';
import type { ConnectionWeights } from '../core/generated/ConnectionWeights';
import type { ConnectionRoute } from '../core/generated/ConnectionRoute';
import type { ConnectionMovement } from '../core/generated/ConnectionMovement';
import type { ProgressionConnectionResult } from '../core/generated/ProgressionConnectionResult';
import type { ProgressionConnectionPreview } from '../core/generated/ProgressionConnectionPreview';
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
  let connectionWeights: ConnectionWeights | undefined;
  let connection: ProgressionConnectionResult | undefined;
  let connectionPreview: (ScorePreviewResult & { value: ProgressionConnectionPreview; fromIndex: number }) | undefined;
  let lineSolo: (ScorePreviewResult & { id: string; label: string; plan: CompositionPlan }) | undefined;
  return {
    async mount(container, context) {
      const version = ++mountVersion;
      let disposed = false, job = 0, analysisJob = 0, connectionJob = 0, lineJob = 0, busy = false, connectionBusy = false, lineBusy = false, downloadUrl: string | undefined;
      context.onDispose(() => { disposed = true; job++; analysisJob++; connectionJob++; lineJob++; if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
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
          <div class="motion-preview-banner" data-motion="preview-banner" hidden><p data-motion="preview-description"></p><button class="button" type="button" data-motion="restore-original">Restore original phrase</button></div>
          <details class="motion-roman-help"><summary>How to read Roman numerals</summary><p>Numerals locate a root relative to the tonic. Uppercase is major; lowercase is minor. ° means diminished, ø means half-diminished, and + means augmented. ♭ or ♯ changes the root’s scale degree. A slash names a temporary target: V7/V is the dominant seventh of the dominant. Alterations in parentheses change chord tones.</p></details>
        </section>
        <section data-motion="preview"></section>
        <details class="panel motion-panel motion-voices" data-motion="voices" hidden><summary>Follow each voice through the phrase</summary><p class="motion-note" data-motion="voice-description"></p><div class="motion-actions"><button class="button" type="button" data-motion="full-phrase" hidden>Return to full phrase</button><p class="motion-exact-status" data-motion="voice-status" role="status" aria-live="polite"></p></div><div data-motion="voice-paths"></div></details>
        <section class="panel motion-panel motion-selection" data-motion="selection-panel" hidden>
          <div class="motion-section-heading"><div><p class="eyebrow" data-motion="selected-position"></p><h2 data-motion="selected-heading"></h2></div><div class="motion-neighbors" data-motion="neighbors"></div></div>
          <p class="motion-selected-reason" data-motion="selected-reason"></p>
          <div class="motion-selected-facts" data-motion="selected-facts"></div>
          <section class="motion-connection" data-motion="connection-section" aria-label="Connection into selected chord">
            <div class="motion-section-heading"><div><h3 data-motion="connection-heading">The way into this chord</h3><p class="motion-note" data-motion="connection-description"></p></div><button class="button" type="button" data-motion="find-connection">Find a smooth connection</button></div>
            <div data-motion="connection-metrics"></div>
            <p class="motion-exact-status" data-motion="connection-status" role="status" aria-live="polite"></p>
            <div data-motion="connection-routes"></div>
          </section>
          <div data-motion="replacement-section"><div class="motion-section-heading motion-replacement-heading"><h3>Try a different direction</h3><span data-motion="replacement-hint">Replace this chord and revoice the phrase.</span></div><div class="motion-replacements" data-motion="replacements"></div><details class="motion-more-replacements" data-motion="more-replacements"><summary>More alternatives</summary><div class="motion-replacements" data-motion="other-replacements"></div></details></div>
        </section>
        <section class="panel motion-panel motion-theory">
          <div class="motion-section-heading"><div><p class="eyebrow">ONE MODEL, DIFFERENT MUSICAL LANGUAGES</p><h2>Voices → sonorities → context → phrase</h2></div></div>
          <ol class="motion-model">
            <li><span>1</span><div><strong>Follow the voices</strong><p>Each part traces a line through time. Hear its contour, repeated notes, leaps and changes of direction across the whole phrase.</p></div></li>
            <li><span>2</span><div><strong>Hear their sonorities</strong><p>Simultaneous notes form intervals and chords. Smooth movement can connect distant chord colors; a chord label alone does not describe the lines.</p></div></li>
            <li><span>3</span><div><strong>Read the context</strong><p>A tonic and collection give notes scale degrees and chords Roman numerals. Borrowing, substitutions and temporary targets describe additional relationships.</p></div></li>
            <li><span>4</span><div><strong>Shape the phrase</strong><p>Duration, recurrence and arrival points change the meaning of a sonority. Balance the continuity of individual lines with the direction of the whole passage.</p></div></li>
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
              <label>Line continuity<input type="number" min="0" max="100" step="any" required data-motion="lineContinuity" data-generator-input form="motion-generator" disabled></label>
              <label class="motion-check"><input type="checkbox" data-motion="arpeggiate" data-generator-input form="motion-generator" disabled>Arpeggiate the chords</label>
            </div>
            <p class="motion-note">Generate applies these settings. The same inputs reproduce the same phrase. Line continuity weighs changes in each melodic line’s successive steps; zero disables that preference.</p>
            <details class="motion-detail" data-motion="connection-controls"><summary>Connection cost &amp; search limits</summary><p class="motion-note">Search compares the direct move with up to three inserted chords. Connectors share the preceding chord’s time; the selected arrival and the rest of the phrase stay in place. These search preferences do not change the current phrase.</p><div class="motion-controls motion-connection-controls" data-motion="connection-weights"></div><p class="motion-note">Movement uses total semitones and the sum of squared individual steps. Chromatic entry squares the count of newly introduced out-of-scale pitch classes. Exposure counts outside tones or semitone/tritone pairs × quarters. The connector cost must be positive. These are compositional preferences, not a universal measure of musical quality.</p></details>
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
      const connectionStatus = (text: string, error = false) => {
        if (!active()) return;
        get('connection-status').textContent = text; get('connection-status').classList.toggle('lab-error', error);
      };
      const voiceStatus = (text: string, error = false) => {
        if (!active()) return;
        get('voice-status').textContent = text; get('voice-status').classList.toggle('lab-error', error);
      };
      const sourceOptions = () => accepted?.kind === 'progression' ? accepted.result.motionOptions : accepted?.options;
      const sourcePlan = () => accepted?.kind === 'progression' ? accepted.result.plan : accepted?.plan;
      function updateActions(): void {
        for (const name of ['generate', 'variation']) get<HTMLButtonElement>(name).disabled = !options || busy;
        for (const name of ['inspect-exact', 'apply-exact', 'reset-exact', 'download-request', 'download-program']) get<HTMLButtonElement>(name).disabled = !accepted || busy;
        get<HTMLButtonElement>('download-analysis').disabled = !analysis || busy;
        get('generate').toggleAttribute('aria-busy', busy);
        for (const button of container.querySelectorAll<HTMLButtonElement>('[data-replace]')) button.disabled = busy || dirty;
        get<HTMLButtonElement>('find-connection').disabled = accepted?.kind !== 'progression' || !accepted.result.transitions || selectedIndex < 1 || dirty || busy || connectionBusy || !!get('connection-weights').querySelector(':invalid');
        get('find-connection').toggleAttribute('aria-busy', connectionBusy);
        for (const button of container.querySelectorAll<HTMLButtonElement>('[data-preview-route]')) button.disabled = busy || connectionBusy || dirty;
        get<HTMLButtonElement>('restore-original').disabled = busy || !connectionPreview;
        for (const button of container.querySelectorAll<HTMLButtonElement>('[data-solo-line]')) button.disabled = busy || lineBusy;
        get<HTMLButtonElement>('full-phrase').disabled = busy;
        get('replacement-hint').textContent = dirty ? 'Generate to apply your changed settings before editing a chord.' : 'Replace this chord and revoice the phrase.';
      }
      function writeOptions(): void {
        if (!defaults || !options) return;
        get<HTMLSelectElement>('tonic').value = options.tonic;
        get<HTMLSelectElement>('scale').value = JSON.stringify([options.family, options.mode]);
        get<HTMLSelectElement>('color').value = options.color;
        for (const field of ['length', 'tempo', 'seed'] as const) get<HTMLInputElement>(field).value = String(options[field]);
        const continuity = options.lineContinuity ?? defaults.options.lineContinuity;
        get<HTMLInputElement>('lineContinuity').disabled = continuity === undefined;
        get<HTMLInputElement>('lineContinuity').value = continuity === undefined ? '' : String(continuity);
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
          ...(get<HTMLInputElement>('lineContinuity').disabled ? {} : { lineContinuity: get<HTMLInputElement>('lineContinuity').valueAsNumber }),
          arpeggiate: get<HTMLInputElement>('arpeggiate').checked };
      }
      function validForm(): boolean {
        // Native form validation must be able to focus an invalid advanced input.
        if (get('advanced').querySelector(':invalid')) get<HTMLDetailsElement>('advanced').open = true;
        return form.reportValidity();
      }
      function changed(): void {
        job++; connectionJob++; lineJob++; busy = false; connectionBusy = false; lineBusy = false; dirty = true;
        const next = readOptions(); if (next) options = next;
        renderColorHint(); updateActions();
        showStatus('Settings changed. Generate a progression to hear them; your current phrase is still below.');
      }
      function refreshExact(): void {
        if (!exactDirty) exactDraft = JSON.stringify(sourceOptions(), null, 2) ?? '';
        get<HTMLTextAreaElement>('json').value = exactDraft;
      }
      function chordCard(chord: ProgressionChord, index: number, quarters: number, voicedName = chord.name): string {
        return `<li><button type="button" class="motion-chord" data-select-step="${index}" aria-pressed="${index === selectedIndex}" aria-label="Chord ${index + 1}: ${html(chord.roman)}, ${html(voicedName)}. ${html(chord.role)}. ${format(quarters)} quarters."><span class="motion-chord-position">${index + 1}</span><strong class="motion-roman">${html(chord.roman)}</strong><span class="motion-chord-name">${html(voicedName)}</span><span class="motion-role" data-role="${html(chord.role)}">${html(chord.role)}</span><span class="motion-chord-duration">${quarters === 4 ? '1 bar' : `${format(quarters)} quarters`}</span></button></li>`;
      }
      function renderAuditionState(): void {
        get('preview-banner').hidden = !connectionPreview;
        get('preview-description').textContent = connectionPreview
          ? `Preview: ${connectionPreview.value.intermediateCount} connecting ${connectionPreview.value.intermediateCount === 1 ? 'chord shares' : 'chords share'} bar ${connectionPreview.fromIndex + 1}. The original arrival and later bars keep their timing and pitches.` : '';
        get('preview').querySelector('h2')!.textContent = lineSolo ? `Hear ${lineSolo.label.toLowerCase()}` : connectionPreview ? 'Hear the connection in your phrase' : 'Hear your progression';
        get('full-phrase').hidden = !lineSolo;
      }
      function renderChordCards(): void {
        if (accepted?.kind !== 'progression') return;
        const source = accepted.result;
        get('passage').innerHTML = connectionPreview
          ? connectionPreview.value.steps.map(step => step.anchorIndex === null
            ? `<li><div class="motion-chord motion-connector"><span class="motion-chord-position">CONNECTOR</span><strong class="motion-roman">${html(step.chord.roman)}</strong><span class="motion-chord-name">${html(step.voicedName ?? step.chord.name)}</span><span class="motion-role">${format(step.duration.numerator / step.duration.denominator)} quarters</span></div></li>`
            : chordCard(step.chord, step.anchorIndex, step.duration.numerator / step.duration.denominator, step.voicedName)).join('')
          : source.steps.map(step => {
            const duration = source.motionOptions.history[step.index].duration;
            return chordCard(step.chord, step.index, duration.numerator / duration.denominator, step.voicedName);
          }).join('');
        renderAuditionState();
      }
      function renderPassage(): void {
        if (!accepted) return;
        get('passage-panel').hidden = false; get('selection-panel').hidden = false;
        if (accepted.kind === 'progression') {
          const { result } = accepted;
          if (selectedIndex < 0 || selectedIndex >= result.steps.length) selectedIndex = Math.max(0, result.steps.length - 2);
          get('passage-heading').textContent = result.catalog.scaleName;
          get('collection').innerHTML = `<span>Scale notes</span>${result.catalog.scaleTones.map((tone, index) => `<span class="motion-scale-tone"><strong>${html(tone)}</strong><small>${html(result.catalog.degreeNames[index] ?? '')}</small></span>`).join('')}`;
          renderChordCards();
          get('passage-reason').textContent = 'Select a chord to inspect the move into it, find a smoother route, or replace the chord itself.';
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
          renderAuditionState();
        }
        renderSelection(); renderVoices(); refreshExact(); updateActions();
      }
      function renderSelection(): void {
        if (!accepted) return;
        const source = accepted;
        for (const button of get('passage').querySelectorAll<HTMLButtonElement>('[data-select-step]')) button.setAttribute('aria-pressed', String(Number(button.dataset.selectStep) === selectedIndex));
        get('selected-position').textContent = connectionPreview ? `ORIGINAL CHORD ${selectedIndex + 1} · ANCHOR CONTEXT` : `CHORD ${selectedIndex + 1} · IN CONTEXT`;
        if (source.kind === 'exact') {
          const step = source.options.history[selectedIndex], chord = source.options.chords.find(chord => chord.id === step?.chordId);
          get('selection-panel').hidden = !chord;
          if (!chord) return;
          get('selected-heading').textContent = chord.name; get('neighbors').textContent = '';
          get('selected-reason').textContent = 'Custom coordinates preserve your supplied voicing and tuning. Inspect the exact relationship request below to compare its movement and tonal frames.';
          get('selected-facts').innerHTML = `<div><span>Members · native millicents</span><strong>${chord.pitchesMillicents.join(' · ')}</strong></div><div><span>Supplied root · native millicents</span><strong>${chord.rootMillicents ?? 'Unknown'}</strong></div>`;
          get('replacement-section').hidden = true; get('connection-section').hidden = true; return;
        }
        const { result } = source, step = result.steps[selectedIndex]; if (!step) return;
        const { chord } = step;
        get('selected-heading').textContent = `${chord.roman} · ${step.voicedName ?? chord.name}`;
        get('neighbors').innerHTML = [result.steps[selectedIndex - 1], step, result.steps[selectedIndex + 1]].map((neighbor, index) => neighbor ? `<span${index === 1 ? ' class="motion-current-neighbor"' : ''}>${html(neighbor.chord.roman)}<small>${html(neighbor.voicedName ?? neighbor.chord.name)}</small></span>` : '<span class="motion-phrase-end">Phrase edge</span>').join('<span class="motion-arrow" aria-hidden="true">→</span>');
        get('selected-reason').textContent = `${connectionPreview ? 'In the original anchor sequence: ' : ''}${step.reason}`;
        get('selected-facts').innerHTML = `<div><span>Chord tones</span><strong>${html(chord.toneNames.join(' · '))}</strong></div><div><span>Relative to ${html(result.catalog.tonic)}</span><strong>${html(chord.globalRoman)}</strong></div><details class="motion-construction"><summary>How it is built</summary><p>${html(chord.derivation)}</p></details>`;
        renderConnection();
        const replacements = step.replacements.flatMap(replacement => {
          const candidate = result.catalog.chords.find(chord => chord.id === replacement.chordId);
          return candidate ? [{ candidate, reason: replacement.reason, cost: replacement.cost }] : [];
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
        const replacementCard = ({ candidate, reason, cost }: typeof replacements[number]) => `<button class="motion-replacement" type="button" data-replace="${html(candidate.id)}"><span><strong>${html(candidate.roman)}</strong><span>${html(candidate.name)}</span></span><span class="motion-operator">${html(readable(candidate.operator))}</span><small>${html(reason)}</small><small>Potential transition cost ${format(cost)}</small><span class="motion-replace-action">Use this chord <span aria-hidden="true">↗</span></span></button>`;
        get('replacement-section').hidden = false;
        get('replacements').innerHTML = featured.map(replacementCard).join('') || '<p class="motion-note">This phrase anchor has no compatible replacement in the current palette.</p>';
        get('other-replacements').innerHTML = other.map(replacementCard).join('');
        get('more-replacements').hidden = other.length === 0; updateActions();
      }
      function renderConnectionWeights(): void {
        if (!connectionWeights) return;
        const labels: Record<keyof ConnectionWeights, string> = {
          motionLinear: 'Total voice movement', motionSquared: 'Large-step penalty', addedMembers: 'Entering / leaving voices',
          chromaticEntry: 'New out-of-scale tones', collectionExposure: 'Out-of-scale tone time',
          sonorityExposure: 'Sonority strain × time', insertion: 'Each connector',
        };
        get('connection-weights').innerHTML = Object.entries(connectionWeights).map(([key, value]) => `<label>${html(labels[key as keyof ConnectionWeights])}<input type="number" min="${key === 'insertion' ? '0.000001' : '0'}" max="100" step="any" required value="${value}" data-connection-weight="${key}" aria-label="Connection cost: ${html(labels[key as keyof ConnectionWeights])}"></label>`).join('');
      }
      function renderVoices(): void {
        const phrase = accepted?.kind === 'progression' ? connectionPreview?.value ?? accepted.result : undefined;
        const analysis = phrase?.lines;
        get('voices').hidden = !analysis;
        if (!phrase || !analysis) return;
        if (!lineBusy && !lineSolo) voiceStatus('');
        get('voice-description').textContent = `${analysis.lines.length} proposed melodic lines through ${connectionPreview ? 'this connection preview' : 'the original phrase'}. Hear a line on its own, then return to the whole phrase. Plots show harmonic positions; arpeggiated attacks retain their offsets in playback.`;
        const end = Math.max(1, ...analysis.lines.flatMap(line => line.points.map(point => point.onsetQuarters + point.duration.numerator / point.duration.denominator)));
        const span = Math.max(1, ...analysis.lines.map(line => line.rangeMillicents));
        get('voice-paths').innerHTML = analysis.lines.map((line, index) => {
          const pitches = line.points.map(point => point.pitchMillicents);
          const middle = (Math.min(...pitches) + Math.max(...pitches)) / 2;
          const points = line.points.map(point => {
            const step = phrase.steps[point.stepIndex];
            const label = step?.voicedToneNames[point.memberIndex] ?? '';
            return { point, label, x: 24 + point.onsetQuarters / end * 832, y: 52 - (point.pitchMillicents - middle) / span * 46 };
          });
          const selected = lineSolo?.id === line.id;
          return `<article class="motion-voice" data-selected="${selected}"><div class="motion-section-heading"><div><h3>Line ${index + 1}</h3><p class="motion-note">Largest step ${format(line.maxMotionMillicents / 100_000)} semitones · range ${format(line.rangeMillicents / 100_000)} · ${line.directionReversalCount} direction ${line.directionReversalCount === 1 ? 'reversal' : 'reversals'}</p></div><button type="button" class="button" data-solo-line="${index}" aria-pressed="${selected}">${selected ? 'Solo in player' : 'Hear this line'}</button></div><div class="motion-voice-chart"><svg viewBox="0 0 880 90" role="img" aria-label="Line ${index + 1} contour: ${html(points.map(point => point.label).join(', '))}"><line x1="24" y1="78" x2="856" y2="78" class="motion-voice-axis"/><polyline points="${points.map(point => `${point.x},${point.y}`).join(' ')}" class="motion-voice-line"/>${points.map(({ point, label, x, y }) => `<g><title>${html(label)} · ${format(point.pitchMillicents / 1_000)} cents · harmonic onset ${format(point.onsetQuarters)} quarters</title><circle cx="${x}" cy="${y}" r="3.5" class="motion-voice-point"/><text x="${x}" y="${y - 9}" text-anchor="middle" class="motion-voice-pitch">${html(label)}</text><text x="${x}" y="88" text-anchor="middle" class="motion-voice-time">${format(point.onsetQuarters)}</text></g>`).join('')}</svg></div><details class="motion-metric-detail"><summary>Exact notes &amp; melodic steps</summary><p class="motion-note">Signed moves in semitones: ${line.stepsMillicents.map(step => signed(step / 100_000)).join(' · ') || 'No move'}.</p><div class="motion-scroll"><table class="motion-table"><thead><tr><th>Harmonic onset · quarters</th><th>Note</th><th>Exact pitch · cents</th></tr></thead><tbody>${points.map(({ point, label }) => `<tr><td>${format(point.onsetQuarters)}</td><td>${html(label)}</td><td>${format(point.pitchMillicents / 1_000)}</td></tr>`).join('')}</tbody></table></div></details></article>`;
        }).join('') + `<details class="motion-metric-detail"><summary>What these lines establish</summary><p class="motion-note">${html(analysis.explanation)}</p><p class="motion-note">All plots use the same pitch scale, centered on each line’s register. Horizontal coordinates are quarters. Continuity cost ${format(analysis.continuityCost)} is a compositional proxy; these paths do not establish inferred performer identities or a complete counterpoint analysis.</p><pre class="motion-analysis-json">${html(JSON.stringify(analysis, null, 2))}</pre></details>`;
        renderAuditionState(); updateActions();
      }
      async function soloLine(index: number): Promise<void> {
        const source = accepted, bridge = connectionPreview;
        const phrase = source?.kind === 'progression' ? bridge?.value ?? source.result : undefined;
        const line = phrase?.lines?.lines[index], plan = phrase?.linePlans?.[index];
        if (!phrase || !line || !plan || lineSolo?.id === line.id || busy || lineBusy) return;
        const ticket = ++lineJob;
        connectionJob++; connectionBusy = false;
        lineBusy = true; updateActions(); voiceStatus(`Preparing line ${index + 1}…`);
        const current = () => active() && ticket === lineJob && accepted === source && connectionPreview === bridge;
        try {
          const score = await context.call('compileComposition', { plan });
          if (!current()) return;
          const meter = await context.call('scoreMeter', { score });
          if (!current()) return;
          lineSolo = { id: line.id, label: `Line ${index + 1}`, plan, score, meter }; lineBusy = false;
          preview.setResult(lineSolo); renderVoices(); renderConnection();
          voiceStatus(`Line ${index + 1} is in the player. Use Play to hear it alone; Return to full phrase restores all parts.`);
        } catch (error) { if (current()) voiceStatus(`Current audition retained. ${message(error)}`, true); }
        finally { if (current()) { lineBusy = false; updateActions(); } }
      }
      function fullPhrase(): void {
        if (!accepted) return;
        lineJob++; connectionJob++; lineBusy = false; connectionBusy = false;
        if (lineSolo) { lineSolo = undefined; preview.setResult(connectionPreview ?? accepted); }
        renderVoices(); renderConnection(); voiceStatus('Full phrase is in the player.');
      }
      function renderConnection(): void {
        if (accepted?.kind !== 'progression') { get('connection-section').hidden = true; return; }
        get('connection-section').hidden = false;
        const source = accepted.result, from = source.steps[selectedIndex - 1], to = source.steps[selectedIndex];
        const metrics = source.transitions?.[selectedIndex - 1];
        get('connection-routes').replaceChildren();
        if (!connectionBusy) connectionStatus('');
        if (!from || !to || !metrics) {
          get('connection-heading').textContent = 'Choose a move to explore';
          get('connection-description').textContent = source.transitions ? 'Select the second chord or any later chord to measure the incoming move and find connecting steps.' : 'Metrics will be available when the musical core rebuild finishes. Your current phrase remains playable.';
          get('connection-metrics').replaceChildren(); updateActions(); return;
        }
        get('connection-heading').textContent = `Original move: ${from.voicedName ?? from.chord.name} → ${to.voicedName ?? to.chord.name}`;
        get('connection-description').textContent = 'Small voice movements can still introduce a strong new color. Compare motion, new scale outsiders, sonority and the time they occupy.';
        const duration = source.motionOptions.history[selectedIndex].duration, quarters = duration.numerator / duration.denominator;
        const movementCard = (name: string, movement: ConnectionMovement | null, kind: string) => `<div class="motion-metric" data-kind="${kind}"><span>${name}</span><strong>${movement ? `${format(movement.meanMotionCents / 100)} semitones` : 'Unknown'}</strong><small>${movement ? `Mean per matched voice · max ${format(movement.maxMotionMillicents / 100_000)}<br>${movement.commonToneCount} ${kind === 'periodic' ? 'common-tone matches' : 'held members'}` : 'No period supplied'}</small></div>`;
        const strain = metrics.destinationStrain;
        get('connection-metrics').innerHTML = `<div class="motion-metrics">${movementCard('Actual register', metrics.registered, 'registered')}${movementCard('Pitch-class proximity', metrics.periodic, 'periodic')}<div class="motion-metric"><span>New out-of-scale tones</span><strong>${metrics.newOutsideClasses?.length ?? 'Unknown'}</strong><small>${metrics.destinationOutsideClasses === null ? 'No collection supplied' : `${metrics.destinationOutsideClasses.length} outside scale ${metrics.destinationOutsideClasses.length === 1 ? 'tone' : 'tones'} in the arrival`}</small></div><div class="motion-metric"><span>Arrival sonority &amp; time</span><strong>${quarters === 4 ? '1 bar' : `${format(quarters)} quarters`}</strong><small>${strain ? `${strain.minorSecondPairs} semitone ${strain.minorSecondPairs === 1 ? 'pair' : 'pairs'} · ${strain.tritonePairs} ${strain.tritonePairs === 1 ? 'tritone' : 'tritones'}` : 'Interval strain unknown'}</small></div></div><details class="motion-metric-detail"><summary>Follow the individual notes &amp; understand these measures</summary><p class="motion-note">Actual register uses the emitted notes. Pitch-class proximity wraps distances around the octave without changing the sounding voicing or bass. Both show a correspondence selected by the movement costs, not recovered performer voices. Semitone and tritone counts describe interval content; they are not an acoustic roughness measurement.</p>${movementTable('Actual register', metrics.registered, false)}${metrics.periodic ? movementTable('Pitch-class proximity', metrics.periodic, true) : ''}<p class="motion-note">Motion alone does not determine function or structural importance. A full-bar chord is not classified as passing merely because its notes connect smoothly.</p></details>`;
        function movementTable(title: string, movement: ConnectionMovement, periodic: boolean): string {
          const links = movement.representative.links;
          const departures = movement.representative.departures.map(index => `${html(from.voicedToneNames[index])} · ${from.voicedMidi[index]}`).join(', ');
          const arrivals = movement.representative.arrivals.map(index => `${html(to.voicedToneNames[index])} · ${to.voicedMidi[index]}`).join(', ');
          return `<h4>${title}</h4><p class="motion-note">${movement.optimalCorrespondenceCount} retained cost-minimizing ${movement.optimalCorrespondenceCount === 1 ? 'assignment' : 'assignments'} · ${movement.unmatchedCount} unmatched ${movement.unmatchedCount === 1 ? 'member' : 'members'}. One representative is shown.</p><div class="motion-scroll"><table class="motion-table"><thead><tr><th>From · MIDI</th><th>To · MIDI</th><th>${periodic ? 'Wrapped' : 'Signed'} move · semitones</th>${periodic ? '<th>Actual move · semitones</th><th>Octave winding</th>' : ''}</tr></thead><tbody>${links.map(link => `<tr><td>${html(from.voicedToneNames[link.fromMember] ?? '')} · ${from.voicedMidi[link.fromMember]}</td><td>${html(to.voicedToneNames[link.toMember] ?? '')} · ${to.voicedMidi[link.toMember]}</td><td>${signed(link.displacementMillicents / 100_000)}${link.halfPeriodTie ? ' (opposite direction ties)' : ''}</td>${periodic ? `<td>${signed(link.registeredDisplacementMillicents / 100_000)}</td><td>${link.winding ?? '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>${departures || arrivals ? `<p class="motion-note">Leaving: ${departures || 'none'} · Entering: ${arrivals || 'none'}</p>` : ''}`;
        }
        if (connection?.fromIndex !== selectedIndex - 1) { updateActions(); return; }
        const search = connection;
        const costLabels: Record<Exclude<keyof ConnectionRoute['cost'], 'total'>, string> = {
          motionLinear: 'Total movement', motionSquared: 'Large steps', addedMembers: 'Entering / leaving voices',
          chromaticEntry: 'New outside tones', collectionExposure: 'Outside tone time', sonorityExposure: 'Sonority strain × time', insertion: 'Connectors',
        };
        get('connection-routes').innerHTML = `<p class="motion-note">Compare the same arrival with zero to three connecting chords. Each preview starts from the original phrase and preserves its length. Lower cost reflects the preferences under More control &amp; theory.</p><div class="motion-routes">${search.analysis.routes.map((route, index) => {
          const value = search.previews.find(candidate => candidate.intermediateCount === route.intermediateCount);
          if (!value) return '';
          const routeSteps = value.steps.filter(step => step.anchorIndex === search.fromIndex || step.anchorIndex === null || step.anchorIndex === search.fromIndex + 1);
          const current = connectionPreview?.fromIndex === search.fromIndex && connectionPreview.value === value;
          const original = route.intermediateCount === 0;
          return `<article class="motion-route" data-best="${index === search.analysis.bestRouteIndex}"><h4>${original ? 'Direct · original' : `${route.intermediateCount} ${route.intermediateCount === 1 ? 'connector' : 'connectors'}`}${index === search.analysis.bestRouteIndex ? '<small>Lowest cost</small>' : ''}</h4><p class="motion-route-chords">${routeSteps.map(step => html(step.voicedName ?? step.chord.name)).join(' → ')}</p><p class="motion-route-cost"><strong>${format(route.cost.total)}</strong>cost ${original ? '' : `· ${signed(route.costChangeFromDirect)} vs direct`}</p><p class="motion-note">Largest move ${format(route.maxMotionMillicents / 100_000)} semitones</p><details><summary>Cost breakdown &amp; scope</summary><dl class="motion-cost-breakdown">${Object.entries(costLabels).map(([key, label]) => `<div><dt>${html(label)}</dt><dd>${format(route.cost[key as keyof typeof costLabels])}</dd></div>`).join('')}</dl><p class="motion-note">${route.optimalRouteCount} retained minimum ${route.optimalRouteCount === 1 ? 'route' : 'routes'} for this number of connectors. ${html(value.explanation)}</p></details><button type="button" class="button" data-preview-route="${route.intermediateCount}" aria-pressed="${!lineSolo && (original ? !connectionPreview : current)}">${original ? 'Hear original' : current && !lineSolo ? 'Loaded in player' : 'Preview whole phrase'}</button></article>`;
        }).join('')}</div><details class="motion-metric-detail"><summary>Search limits &amp; exact transition evidence</summary>${search.analysis.diagnostics.map(note => `<p class="motion-note">${html(note)}</p>`).join('')}<p class="motion-note">${search.analysis.stateCount} fixed voiced states, ${search.analysis.intermediateStateCount} admitted intermediate states. Optimality is limited to this catalog, these voicings and at most three insertions. With equal-sized chords, intermediate steps cannot lower minimum total absolute motion; they can lower the squared large-step penalty or contextual exposure.</p><pre class="motion-analysis-json">${html(JSON.stringify(search.analysis, null, 2))}</pre></details>`;
        updateActions();
      }
      async function findConnection(): Promise<void> {
        if (accepted?.kind !== 'progression' || selectedIndex < 1 || dirty || !connectionWeights) return;
        const source = accepted, fromIndex = selectedIndex - 1, ticket = ++connectionJob;
        connectionBusy = true; updateActions();
        connectionStatus('Comparing the direct move with up to three connecting chords…');
        try {
          const result = await context.call('connectProgression', {
            options: source.result.options, chordIds: source.result.steps.map(step => step.chordId),
            fromIndex, maxIntermediates: 3, weights: structuredClone(connectionWeights),
          });
          if (!active() || ticket !== connectionJob || accepted !== source) return;
          connection = result; connectionBusy = false; renderConnection();
          connectionStatus('Routes compared. Preview one in the whole phrase, then use Play to hear it.');
        } catch (error) { if (active() && ticket === connectionJob) connectionStatus(`Current phrase retained. ${message(error)}`, true); }
        finally { if (active() && ticket === connectionJob) { connectionBusy = false; updateActions(); } }
      }
      async function previewConnection(intermediateCount: number): Promise<void> {
        if (accepted?.kind !== 'progression' || !connection || dirty || connectionBusy) return;
        if (intermediateCount === 0) { restoreOriginal(); return; }
        const value = connection.previews.find(candidate => candidate.intermediateCount === intermediateCount);
        if (!value) return;
        if (connectionPreview?.value === value) { fullPhrase(); return; }
        const source = accepted, search = connection, ticket = ++connectionJob;
        lineJob++; lineBusy = false;
        connectionBusy = true; updateActions(); connectionStatus('Preparing this connection in the whole phrase…');
        try {
          const score = await context.call('compileComposition', { plan: value.plan });
          if (!active() || ticket !== connectionJob || accepted !== source || connection !== search) return;
          const meter = await context.call('scoreMeter', { score });
          if (!active() || ticket !== connectionJob || accepted !== source || connection !== search) return;
          connectionPreview = { value, score, meter, fromIndex: search.fromIndex }; connectionBusy = false; lineSolo = undefined;
          preview.setResult(connectionPreview); renderChordCards(); renderSelection(); renderVoices(); updateActions();
          connectionStatus('Connection loaded in the player. Play the whole phrase to compare; Restore original returns to your original chords.');
        } catch (error) { if (active() && ticket === connectionJob) connectionStatus(`Current audition retained. ${message(error)}`, true); }
        finally { if (active() && ticket === connectionJob) { connectionBusy = false; updateActions(); } }
      }
      function restoreOriginal(): void {
        if (!accepted) return;
        connectionJob++; lineJob++; connectionBusy = false; lineBusy = false;
        if (connectionPreview || lineSolo) { connectionPreview = undefined; lineSolo = undefined; preview.setResult(accepted); }
        renderChordCards(); renderSelection(); renderVoices(); updateActions();
        connectionStatus('Original phrase is in the player.');
      }
      function renderAnalysis(): void {
        if (!analysis) { get('relationships').replaceChildren(); return; }
        const value = analysis;
        get('relationships').innerHTML = `<p class="motion-note">${value.pairCount} ordered pairs, including self-transitions. ${value.selectedCorrespondences.length} minimum assignments for the request’s selected pair; equal costs do not establish voice identity.</p><div class="motion-scroll"><table class="motion-table"><thead><tr><th>From</th><th>To</th><th>Mean motion · cents</th><th>Shared tones</th><th>Assignments</th></tr></thead><tbody>${value.atlas.map(pair => `<tr><td>${html(pair.fromChordId)}</td><td>${html(pair.toChordId)}</td><td>${format(pair.meanMotionCents)}</td><td>${pair.commonToneCount}</td><td>${pair.optimalCorrespondenceCount}</td></tr>`).join('')}</tbody></table></div><details class="motion-detail"><summary>Exact assignments, frame effects &amp; complete analysis</summary><pre class="motion-analysis-json">${html(JSON.stringify(value, null, 2))}</pre></details>`;
        updateActions();
      }
      async function generate(proposed: ProgressionOptions, chordIds?: string[]): Promise<void> {
        const ticket = ++job, snapshot = structuredClone(proposed);
        analysisJob++; connectionJob++; lineJob++; lineBusy = false; connectionBusy = false; busy = true; updateActions();
        showStatus(chordIds ? 'Revoicing the phrase around your chosen chord…' : 'Shaping a phrase and connecting its voices…');
        try {
          const result = await context.call('generateProgression', { options: snapshot, chordIds });
          if (!active() || ticket !== job) return;
          const score = await context.call('compileComposition', { plan: result.plan });
          if (!active() || ticket !== job) return;
          const meter = await context.call('scoreMeter', { score });
          if (!active() || ticket !== job) return;
          const scoreChanged = !accepted || JSON.stringify(lineSolo?.score ?? connectionPreview?.score ?? accepted.score) !== JSON.stringify(score);
          options = result.options; accepted = { kind: 'progression', result, score, meter };
          connection = undefined; connectionPreview = undefined; lineSolo = undefined;
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
        if (realize) { connectionJob++; lineJob++; lineBusy = false; connectionBusy = false; busy = true; updateActions(); }
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
            const scoreChanged = !accepted || JSON.stringify(lineSolo?.score ?? connectionPreview?.score ?? accepted.score) !== JSON.stringify(score);
            accepted = { kind: 'exact', options: proposed, plan, score, meter };
            connection = undefined; connectionPreview = undefined; lineSolo = undefined;
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
        if (target.dataset.connectionWeight && target instanceof HTMLInputElement && connectionWeights) {
          connectionJob++; connectionBusy = false; connection = undefined;
          if (target.validity.valid) connectionWeights = { ...connectionWeights, [target.dataset.connectionWeight]: target.valueAsNumber };
          renderConnection(); updateActions(); connectionStatus('Cost preferences changed. Find a connection to compare new routes.');
        }
        else if (target.dataset.motion === 'json') { exactDraft = target.value; exactDirty = true; analysisJob++; job++; connectionJob++; lineJob++; lineBusy = false; connectionBusy = false; busy = false; analysis = undefined; inspectedOptions = undefined; renderAnalysis(); updateActions(); exactStatus('Request edited. Inspect it, or apply it to the player.'); }
        else if (target.hasAttribute('data-generator-input')) changed();
      }, { signal: context.signal });
      container.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
        if (button.dataset.selectStep !== undefined) { connectionJob++; connectionBusy = false; selectedIndex = Number(button.dataset.selectStep); renderSelection(); return; }
        if (button.dataset.previewRoute !== undefined) { void previewConnection(Number(button.dataset.previewRoute)); return; }
        if (button.dataset.soloLine !== undefined) { void soloLine(Number(button.dataset.soloLine)); return; }
        if (button.dataset.replace && accepted?.kind === 'progression' && !dirty && !busy) {
          const step = accepted.result.steps[selectedIndex];
          if (!step?.replacements.some(replacement => replacement.chordId === button.dataset.replace)) return;
          const chordIds = accepted.result.steps.map((step, index) => index === selectedIndex ? button.dataset.replace! : step.chordId);
          void generate(accepted.result.options, chordIds); return;
        }
        switch (button.dataset.motion) {
          case 'find-connection': void findConnection(); break;
          case 'restore-original': restoreOriginal(); break;
          case 'full-phrase': fullPhrase(); break;
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
          case 'download-program': download('program', lineSolo?.plan ?? connectionPreview?.value.plan ?? sourcePlan()); break;
        }
      }, { signal: context.signal });
      if (accepted) { renderPassage(); renderAnalysis(); preview.setResult(lineSolo ?? connectionPreview ?? accepted); }
      try {
        defaults ??= await context.call('getProgressionDefaults', {});
        if (!active()) return;
        options ??= structuredClone(defaults.options);
        connectionWeights ??= structuredClone(defaults.connectionWeights); renderConnectionWeights();
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
function signed(value: number): string { return `${value > 0 ? '+' : ''}${format(value)}`; }
function readable(value: string): string { const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2'); return spaced[0].toUpperCase() + spaced.slice(1).toLowerCase(); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
