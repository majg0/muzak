import './harmonic-motion.css';
import type { CompositionPlan } from '../core/generated/CompositionPlan';
import type { HarmonicMotionOptions } from '../core/generated/HarmonicMotionOptions';
import type { HarmonicMotionPreset } from '../core/generated/HarmonicMotionPreset';
import type { HarmonicMotionAnalysis } from '../core/generated/HarmonicMotionAnalysis';
import type { MotionCandidate } from '../core/generated/MotionCandidate';
import type { MotionCorrespondence } from '../core/generated/MotionCorrespondence';
import type { MotionFrameEffect } from '../core/generated/MotionFrameEffect';
import type { MotionWeights } from '../core/generated/MotionWeights';
import type { LabSession } from './types';
import { mountScorePreview, type ScorePreviewResult } from './shared/score-preview';

type Accepted = ScorePreviewResult & { options: HarmonicMotionOptions; analysis: HarmonicMotionAnalysis; plan: CompositionPlan };
type Metric = 'meanMotionCents' | 'commonToneCount' | 'unmatchedCount' | 'rootDisplacementMillicents' | 'optimalCorrespondenceCount';
const metrics: Array<{ id: Metric; label: string; unit: string; description: string }> = [
  { id: 'meanMotionCents', label: 'Mean member motion', unit: 'cents', description: 'Minimum absolute displacement in the supplied register, divided by matched members. Smaller values mean less motion.' },
  { id: 'commonToneCount', label: 'Common tones', unit: 'members', description: 'Exact pitch-class matches under the declared period, or exact native matches when no period is supplied.' },
  { id: 'unmatchedCount', label: 'Unmatched members', unit: 'members', description: 'Arrivals or departures required when chords have different member counts.' },
  { id: 'rootDisplacementMillicents', label: 'Signed root motion', unit: 'millicents', description: 'Destination root minus source root in exact native coordinates. Unknown roots remain unknown.' },
  { id: 'optimalCorrespondenceCount', label: 'Assignment ambiguity', unit: 'assignments', description: 'The number of equally minimal member assignments. Geometry alone does not establish voice identity.' },
];

/** An authored finite experiment. All music, context and preference calculations
 * cross the generated Rust contract; this module only edits and displays data. */
export function createSession(): LabSession {
  let presets: HarmonicMotionPreset[] | undefined;
  let options: HarmonicMotionOptions | undefined;
  let accepted: Accepted | undefined;
  let presetId = '', metric: Metric = 'meanMotionCents', correspondenceIndex = 0, editChordId = '';
  let jsonDraft = '', jsonDirty = false, mountVersion = 0;
  return {
    async mount(container, context) {
      const version = ++mountVersion;
      let disposed = false, job = 0, inspectionJob = 0, downloadUrl: string | undefined;
      context.onDispose(() => { disposed = true; job++; inspectionJob++; if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
      const active = () => !disposed && !context.signal.aborted && version === mountVersion;
      container.classList.add('motion-lab');
      container.innerHTML = `
        <form data-motion="form" class="motion-stack">
          <section class="panel motion-panel">
            <div class="motion-heading"><div><p class="eyebrow">A CONTEXTUAL ATLAS</p><h2>Where could this chord go?</h2><p>Compare exact member motion, supplied tonal centers and the entire passage history. Set a preference, inspect its reasons, then listen.</p></div></div>
            <div class="motion-controls">
              <label class="motion-preset">Starting experiment<select data-motion="preset" disabled></select></label>
              <label>Tempo · quarters/min<input type="number" min="20" max="400" step="any" required data-motion="tempo" disabled></label>
              <label class="motion-check"><input type="checkbox" data-motion="arpeggiate" disabled>Arpeggiate</label>
              <button class="button primary" type="submit" data-motion="analyze" disabled>Analyze &amp; realize</button>
            </div>
            <p class="motion-note" data-motion="preset-description"></p>
            <p class="motion-status" data-motion="status" role="status" aria-live="polite">Loading the musical core…</p>
          </section>
          <div class="motion-split">
            <section class="panel motion-panel">
              <div class="motion-heading"><div><p class="eyebrow">THE WHOLE PASSAGE</p><h2>Build a harmonic route</h2><p>Every step contributes its exact duration to history. This is the passage you will hear.</p></div></div>
              <ol class="motion-passage" data-motion="passage"></ol>
              <div class="motion-inline"><select data-motion="append-chord" aria-label="Chord to append" disabled></select><button class="button" type="button" data-motion="append" disabled>Append chord</button></div>
              <p class="motion-note">Duration is a fraction of one quarter note. Chord members retain their supplied register and separate identities.</p>
              <details class="motion-details"><summary>Edit a shared chord’s exact members</summary><p>Changing this chord updates every matching passage step. Replacing a step above changes only that occurrence.</p><label>Shared chord<select data-motion="edit-chord"></select></label><div class="motion-chord-editor" data-motion="chord-editor"></div></details>
              <details class="motion-details"><summary>Passage transitions in their preceding context</summary><div data-motion="path"></div></details>
            </section>
            <section class="panel motion-panel">
              <div class="motion-heading"><div><p class="eyebrow">RELATIVE TO WHAT?</p><h2>Centers, collections &amp; intent</h2><p>Frames are explicit hypotheses. A zero-weight frame remains visible for comparison; no frame means unknown center.</p></div></div>
              <div data-motion="frames"></div>
              <details class="motion-details"><summary>Ranking preferences &amp; factor units</summary><p>Lower total cost ranks first. These editable weights express a preference, not a prediction or a universal law of tension.</p><div class="motion-weights" data-motion="weights"></div><div data-motion="factor-guide"></div></details>
            </section>
          </div>
        </form>
        <div class="motion-summary" data-motion="summary" hidden></div>
        <section data-motion="preview"></section>
        <section class="panel motion-panel" data-motion="atlas-panel" hidden>
          <div class="motion-heading"><div><p class="eyebrow">EVERY ORDERED PAIR</p><h2>Explore the finite atlas</h2><p>Rows depart; columns arrive. Select any cell to inspect its exact assignments and rank every continuation from that source.</p></div><label>Cell value<select data-motion="metric"></select></label></div>
          <div class="motion-scroll" data-motion="matrix"></div>
          <div class="motion-matrix-help"><p class="motion-note" data-motion="metric-description"></p><div class="motion-legend"><span data-motion="metric-min"></span><span class="motion-gradient" aria-hidden="true"></span><span data-motion="metric-max"></span></div></div>
          <p class="motion-note">Tab enters the selected cell. Arrow keys move; Enter or Space selects. Color shows the displayed value, not musical quality. “—” means unknown.</p>
        </section>
        <div class="motion-split" data-motion="evidence" hidden>
          <section class="panel motion-panel"><div class="motion-heading"><div><p class="eyebrow">SELECTED RELATIONSHIP</p><h2>Members, direction &amp; frame</h2></div></div><div data-motion="pair"></div></section>
          <section class="panel motion-panel"><div class="motion-heading"><div><p class="eyebrow">ALL CONTINUATIONS</p><h2 data-motion="successor-heading">Preference ranking</h2><p>Each destination is evaluated against the selected source, supplied frames and the full authored history. Ties retain their rank.</p></div></div><div data-motion="successors"></div><div class="motion-details" data-motion="factors"></div></section>
        </div>
        <section class="panel motion-panel">
          <div class="motion-heading"><div><p class="eyebrow">EXACT &amp; EXTENSIBLE</p><h2>Your own finite harmonic world</h2><p>Edit the complete request: native pitches, roots, period, frames, target collections, durations and weights. The same Rust analyzer validates and exhaustively evaluates your catalog.</p></div></div>
          <details data-motion="json-details"><summary>Advanced request editor &amp; downloads</summary><p class="motion-note">Pitch coordinates are integer millicents (1,000 per cent); periods and centers are explicit. Omit no fields: use null for an unknown root or absent period. Loading a request replaces this lab’s draft only after successful analysis and realization.</p><label class="motion-sr-only" for="motion-json-request">Exact harmonic-motion options JSON</label><textarea id="motion-json-request" class="motion-json" data-motion="json" spellcheck="false"></textarea><div class="motion-json-actions"><button class="button primary" type="button" data-motion="apply-json" disabled>Apply JSON &amp; realize</button><button class="button" type="button" data-motion="reset-json" disabled>Use current controls</button><button class="button" type="button" data-motion="download-request" disabled>Request JSON</button><button class="button" type="button" data-motion="download-analysis" disabled>Analysis JSON</button><button class="button" type="button" data-motion="download-program" disabled>Program JSON</button></div></details>
          <ul class="motion-diagnostics" data-motion="diagnostics"></ul>
          <p class="motion-note">Exhaustive within the supplied finite catalog and supported bounds. A small movement, target arrival or named transformation does not by itself establish cadence, function, style or an emotional effect.</p>
        </section>`;
      const get = <T extends HTMLElement = HTMLElement>(name: string) => container.querySelector<T>(`[data-motion="${name}"]`)!;
      const form = get<HTMLFormElement>('form');
      const preview = mountScorePreview(get('preview'), context, 'continuum-harmonic-motion');
      const showStatus = (text: string, error = false) => {
        if (!active()) return;
        get('status').textContent = text; get('status').classList.toggle('lab-error', error);
      };
      const chordName = (id: string, source = accepted?.options ?? options) => source?.chords.find(chord => chord.id === id)?.name ?? id;
      const chordOptions = (selected?: string) => options!.chords.map(chord => `<option value="${html(chord.id)}"${chord.id === selected ? ' selected' : ''}>${html(chord.name)}</option>`).join('');
      const refreshJson = () => { if (!jsonDirty && options) jsonDraft = JSON.stringify(options, null, 2); get<HTMLTextAreaElement>('json').value = jsonDraft; };
      function changed(): void {
        job++; get('analyze').removeAttribute('aria-busy'); refreshJson();
        showStatus(accepted ? 'Draft changed. Analyze & realize to update the atlas and audition; the accepted result remains below.' : 'Analyze & realize to hear this passage.');
      }
      function renderDraft(): void {
        if (!options) return;
        get<HTMLSelectElement>('preset').value = presetId;
        get('preset-description').textContent = presets?.find(preset => preset.id === presetId)?.description ?? 'Custom request · your supplied catalog and context.';
        get<HTMLInputElement>('tempo').value = String(options.tempo);
        get<HTMLInputElement>('arpeggiate').checked = options.arpeggiate;
        get('passage').innerHTML = options.history.length ? options.history.map((step, index) => `<li class="motion-step"><span class="motion-step-number">${index + 1}</span><select data-step="${index}" data-step-field="chord" aria-label="Chord at step ${index + 1}">${chordOptions(step.chordId)}</select><div class="motion-ratio"><input type="number" min="1" max="64" step="1" required value="${step.duration.numerator}" data-step="${index}" data-step-field="numerator" aria-label="Duration numerator at step ${index + 1}"><span aria-hidden="true">/</span><input type="number" min="1" max="1024" step="1" required value="${step.duration.denominator}" data-step="${index}" data-step-field="denominator" aria-label="Duration denominator at step ${index + 1}"></div><button class="motion-remove" type="button" data-remove-step="${index}" aria-label="Remove step ${index + 1}">×</button></li>`).join('') : '<li class="motion-empty">No passage steps. Append a chord to build the audition.</li>';
        get('append-chord').innerHTML = chordOptions(options.toChordId);
        if (!options.chords.some(chord => chord.id === editChordId)) editChordId = options.toChordId;
        get('edit-chord').innerHTML = chordOptions(editChordId);
        renderChordEditor();
        get('frames').innerHTML = options.frames.length ? options.frames.map((frame, index) => `<div class="motion-frame"><div class="motion-frame-title">${html(frame.name)}<small>${html(frame.role)}</small></div><div class="motion-frame-fields"><label>Tonic · exact millicents<input type="number" step="1" required value="${frame.tonicMillicents}" data-frame="${index}" data-frame-field="tonicMillicents"></label><label>Influence<input type="number" min="0" max="100" step="any" required value="${frame.weight}" data-frame="${index}" data-frame-field="weight"></label></div><p class="motion-note">Collection offsets <code>${html(frame.collectionOffsetsMillicents.join(', ') || 'unknown')}</code><br>Target offsets <code>${html(frame.targetOffsetsMillicents.join(', ') || 'unknown')}</code></p></div>`).join('') : '<p class="motion-empty">Center-free. Only supplied pitch geometry and history contribute; no tonic is inferred.</p>';
        const factors = accepted?.analysis.successors[0]?.factors ?? [];
        get('weights').innerHTML = Object.entries(options.weights).map(([key, value]) => `<label>${html(factors.find(factor => factor.id === key)?.label ?? humanize(key))}<input type="number" min="-100" max="100" step="any" required value="${value}" data-weight="${html(key)}"></label>`).join('');
        refreshJson();
      }
      function renderChordEditor(): void {
        const chord = options?.chords.find(chord => chord.id === editChordId); if (!chord) return;
        get('chord-editor').innerHTML = `<label>Members · exact millicents, in identity order<input type="text" required data-motion="chord-members" value="${html(chord.pitchesMillicents.join(', '))}" spellcheck="false"></label><label>Supplied root · millicents, blank if unknown<input type="number" step="1" data-motion="chord-root" value="${chord.rootMillicents ?? ''}"></label><p class="motion-note">Comma-separated integers; coincident entries remain separate members. 1,000 millicents = 1 cent. Values are native coordinates, with no automatic wrapping or octave adjustment. The chord’s name remains your authored label.</p>`;
      }
      function renderMatrix(): void {
        if (!accepted) return;
        const { analysis, options: source } = accepted;
        const selected = metrics.find(item => item.id === metric)!;
        const values = analysis.atlas.map(pair => pair[metric]).filter((value): value is number => value !== null);
        const min = Math.min(...values), max = Math.max(...values);
        const byPair = new Map(analysis.atlas.map(pair => [pairKey(pair.fromChordId, pair.toChordId), pair]));
        get('matrix').innerHTML = `<table class="motion-matrix" aria-label="All ordered chord pairs, ${html(selected.label)}"><thead><tr><th scope="col">From <small>↓</small> / To <small>→</small></th>${source.chords.map(chord => `<th scope="col" title="${html(chord.name)}">${html(chord.name)}</th>`).join('')}</tr></thead><tbody>${source.chords.map((from, row) => `<tr><th scope="row" title="${html(from.name)}">${html(from.name)}</th>${source.chords.map((to, column) => {
          const pair = byPair.get(pairKey(from.id, to.id))!;
          const value = pair[metric];
          const isSelected = from.id === analysis.selectedPair.fromChordId && to.id === analysis.selectedPair.toChordId;
          const strength = value === null ? 0 : max === min ? 25 : 8 + (value - min) / (max - min) * 56;
          return `<td><button type="button" class="motion-cell" data-pair-from="${html(from.id)}" data-pair-to="${html(to.id)}" data-row="${row}" data-column="${column}" tabindex="${isSelected ? '0' : '-1'}" aria-pressed="${isSelected}" aria-label="${html(from.name)} to ${html(to.name)}: ${format(value)} ${html(selected.unit)}" style="--motion-strength:${strength}%">${format(value)}</button></td>`;
        }).join('')}</tr>`).join('')}</tbody></table>`;
        get('metric-description').textContent = selected.description;
        get('metric-min').textContent = values.length ? format(min) : 'unknown';
        get('metric-max').textContent = values.length ? `${format(max)} ${selected.unit}` : 'unknown';
      }
      function renderCorrespondence(correspondence: MotionCorrespondence): string {
        return `<div class="motion-scroll"><table class="motion-table"><thead><tr><th>Source member</th><th>Destination member</th><th>Signed Δ · millicents</th></tr></thead><tbody>${correspondence.links.map(link => `<tr><td>#${link.fromMember + 1}<small>${link.fromMillicents} mc</small></td><td>#${link.toMember + 1}<small>${link.toMillicents} mc</small></td><td>${signed(link.displacementMillicents)}</td></tr>`).join('')}</tbody></table></div><p class="motion-note">Departures: ${correspondence.departures.map(index => `#${index + 1}`).join(', ') || 'none'} · Arrivals: ${correspondence.arrivals.map(index => `#${index + 1}`).join(', ') || 'none'}</p>`;
      }
      function renderFrameEffect(effect: MotionFrameEffect): string {
        const frame = accepted!.options.frames.find(frame => frame.id === effect.frameId)!;
        return `<details class="motion-member" open><summary>${html(frame.name)} · influence ${format(effect.weight)}</summary><div class="motion-scroll"><table class="motion-table"><thead><tr><th>Relative to frame</th><th>Source</th><th>Destination</th></tr></thead><tbody><tr><td>Root offset · mc</td><td>${format(effect.sourceRootOffsetMillicents)}</td><td>${format(effect.targetRootOffsetMillicents)}</td></tr><tr><td>Collection distance · cents</td><td>${format(effect.sourceCollectionDistanceCents)}</td><td>${format(effect.targetCollectionDistanceCents)}</td></tr><tr><td>Target distance · cents</td><td>${format(effect.sourceTargetDistanceCents)}</td><td>${format(effect.targetTargetDistanceCents)}</td></tr></tbody></table></div><p class="motion-note">Target approach: ${format(effect.targetApproachCents)} cents. Positive means closer to the supplied target collection.</p>${effect.targetWitnesses.length ? `<details class="motion-member"><summary>${effect.targetWitnesses.length} directional target witnesses across optimal assignments</summary><div class="motion-scroll"><table class="motion-table"><thead><tr><th>Members</th><th>Exact endpoints · mc</th><th>Signed Δ</th><th>Support</th><th>Enters target</th></tr></thead><tbody>${effect.targetWitnesses.map(witness => `<tr><td>#${witness.fromMember + 1} → #${witness.toMember + 1}</td><td>${witness.fromMillicents} → ${witness.toMillicents}</td><td>${signed(witness.displacementMillicents)}</td><td>${witness.optimalSupport}/${accepted!.analysis.selectedPair.optimalCorrespondenceCount}</td><td>${witness.entersTarget ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table></div></details>` : '<p class="motion-note">No directional target witnesses.</p>'}</details>`;
      }
      function selectedCandidate(): MotionCandidate | undefined { return accepted?.analysis.successors.find(candidate => candidate.chordId === accepted!.analysis.selectedPair.toChordId); }
      function renderPair(): void {
        if (!accepted) return;
        const pair = accepted.analysis.selectedPair, candidate = selectedCandidate();
        correspondenceIndex = Math.min(correspondenceIndex, accepted.analysis.selectedCorrespondences.length - 1);
        get('pair').innerHTML = `<div class="motion-pair-name">${html(chordName(pair.fromChordId))}<span>→</span>${html(chordName(pair.toChordId))}</div><div class="motion-badges"><span class="motion-badge">${format(pair.meanMotionCents)} cents / matched member</span><span class="motion-badge">${pair.commonToneCount} common tones</span><span class="motion-badge">${pair.unmatchedCount} unmatched</span><span class="motion-badge">${pair.optimalCorrespondenceCount} optimal assignments</span></div><p class="motion-note">Root Δ ${signed(pair.rootDisplacementMillicents)} mc · bass Δ ${signed(pair.bassDisplacementMillicents)} mc · modulo period ${format(pair.rootModuloMillicents)} mc · cycle order ${format(pair.rootCycleOrder)}.</p><p class="motion-note">Triadic P/L/R: ${pair.triadicAdapterEligible ? html(pair.triadicTransforms.join(', ') || 'no single P/L/R move') : 'not applicable to these supplied chord types or period'}.</p><details class="motion-member" open><summary>Exact correspondence · all ${accepted.analysis.selectedCorrespondences.length} minima retained</summary><div class="motion-inline"><label>Assignment<input data-motion="assignment" type="number" min="1" max="${accepted.analysis.selectedCorrespondences.length}" step="1" value="${correspondenceIndex + 1}" aria-label="Optimal assignment number"></label><span class="motion-note">of ${accepted.analysis.selectedCorrespondences.length}</span></div><div data-motion="correspondence">${renderCorrespondence(accepted.analysis.selectedCorrespondences[correspondenceIndex])}</div><p class="motion-note">Member numbers preserve input order. A minimum assignment is a geometric possibility; ties do not select a voice history. Inspect other assignments or download all of them.</p></details>${candidate?.frames.map(renderFrameEffect).join('') ?? ''}`;
      }
      function renderFactors(): void {
        const candidate = selectedCandidate(); if (!candidate) return;
        get('factors').innerHTML = `<h3>${html(chordName(candidate.chordId))} · total cost ${format(candidate.cost)}</h3><div class="motion-scroll"><table class="motion-table"><thead><tr><th>Factor</th><th>Value</th><th>Weight</th><th>Contribution</th></tr></thead><tbody>${candidate.factors.map(factor => `<tr><td title="${html(factor.description)}">${html(factor.label)}<small>${html(factor.unit)}</small></td><td>${format(factor.value)}</td><td>${format(factor.weight)}</td><td>${signed(factor.contribution)}</td></tr>`).join('')}</tbody></table></div><p class="motion-note">Unknown inputs are shown as “—”; they contribute no invented evidence. Ranking costs are not probabilities.</p>`;
        get('factor-guide').innerHTML = candidate.factors.map(factor => `<p class="motion-note"><strong>${html(factor.label)}</strong> · ${html(factor.unit)}. ${html(factor.description)}</p>`).join('');
      }
      function renderResults(): void {
        if (!accepted) return;
        const { analysis, options: source } = accepted;
        get('summary').hidden = false; get('atlas-panel').hidden = false; get('evidence').hidden = false;
        get('summary').innerHTML = `<div><strong>${source.chords.length} chords · ${analysis.pairCount} pairs</strong><span>Every ordered pair, including self-transitions</span></div><div><strong>${source.periodMillicents === null ? 'No period' : `${format(source.periodMillicents)} mc`}</strong><span>${source.periodMillicents === null ? 'Absolute register geometry' : 'Explicit repeating pitch coordinate'}</span></div><div><strong>${format(analysis.historyQuarters)} quarters</strong><span>${source.history.length} authored steps · ${source.frames.length} explicit context frames</span></div>`;
        get('successor-heading').textContent = `Continue from ${chordName(analysis.selectedPair.fromChordId)}`;
        get('successors').innerHTML = `<div class="motion-scroll"><table class="motion-table"><thead><tr><th>Rank</th><th>Destination</th><th>Cost ↓</th><th>Passage</th></tr></thead><tbody>${analysis.successors.map(candidate => `<tr data-selected="${candidate.chordId === analysis.selectedPair.toChordId}"><td class="motion-rank">${candidate.rank}${candidate.tiedCount > 1 ? `<small>${candidate.tiedCount} tied</small>` : ''}</td><td><button type="button" data-pair-from="${html(analysis.selectedPair.fromChordId)}" data-pair-to="${html(candidate.chordId)}">${html(chordName(candidate.chordId))}</button></td><td>${format(candidate.cost)}</td><td><button type="button" data-append-result="${html(candidate.chordId)}" aria-label="Append ${html(chordName(candidate.chordId))} to passage">+ Append</button></td></tr>`).join('')}</tbody></table></div>`;
        get('path').innerHTML = analysis.path.length ? `<div class="motion-scroll"><table class="motion-table"><thead><tr><th>Transition</th><th>Prior exposure</th><th>Cost</th></tr></thead><tbody>${analysis.path.map(path => `<tr><td>${path.fromStep + 1} → ${path.toStep + 1}<small>${html(chordName(source.history[path.fromStep].chordId))} → ${html(chordName(path.effect.chordId))}</small></td><td>${format(path.historyQuarters)} quarters</td><td><details><summary>${format(path.effect.cost)}</summary>${path.effect.factors.map(factor => `<span class="motion-factor" title="${html(factor.description)}">${html(factor.label)} <strong>${signed(factor.contribution)}</strong></span>`).join('')}</details></td></tr>`).join('')}</tbody></table></div>` : '<p class="motion-note">Add at least two steps to inspect a transition.</p>';
        get('diagnostics').replaceChildren(...analysis.diagnostics.map(diagnostic => { const item = document.createElement('li'); item.textContent = diagnostic; return item; }));
        for (const key of ['download-analysis', 'download-program']) get<HTMLButtonElement>(key).disabled = false;
        renderMatrix(); renderPair(); renderFactors();
      }
      async function analyze(proposed = options): Promise<void> {
        if (!active() || !proposed) return;
        const ticket = ++job, snapshot = structuredClone(proposed);
        inspectionJob++;
        const restoreMatrixFocus = get('matrix').contains(document.activeElement);
        preview.pause(); showStatus('Evaluating every pair, full history and exact member assignments…');
        get('analyze').setAttribute('aria-busy', 'true');
        try {
          const analysis = await context.call('analyzeHarmonicMotion', { options: snapshot });
          if (!active() || ticket !== job) return;
          const plan = await context.call('realizeHarmonicMotion', { options: snapshot });
          if (!active() || ticket !== job) return;
          const score = await context.call('compileComposition', { plan });
          if (!active() || ticket !== job) return;
          const meter = await context.call('scoreMeter', { score });
          if (!active() || ticket !== job) return;
          inspectionJob++;
          options = snapshot; accepted = { options: structuredClone(snapshot), analysis, plan, score, meter };
          jsonDirty = false; correspondenceIndex = 0;
          renderDraft(); renderResults(); preview.setResult(accepted);
          if (restoreMatrixFocus) get('matrix').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
          showStatus(`Ready. ${analysis.pairCount} ordered pairs and ${analysis.successors.length} continuations evaluated. Edit the context, inspect a move, or play the passage.`);
        } catch (error) {
          if (active() && ticket === job) showStatus(`${accepted ? 'Previous accepted result retained. ' : ''}${message(error)}`, true);
        } finally {
          if (active() && ticket === job) get('analyze').removeAttribute('aria-busy');
        }
      }
      async function inspectPair(fromChordId: string, toChordId: string): Promise<void> {
        const source = accepted;
        if (!active() || !source) return;
        const ticket = ++inspectionJob;
        const snapshot = { ...source.options, fromChordId, toChordId };
        const restoreFocus = get('matrix').contains(document.activeElement);
        showStatus(`Inspecting ${chordName(fromChordId)} → ${chordName(toChordId)}…`);
        try {
          const analysis = await context.call('analyzeHarmonicMotion', { options: snapshot });
          if (!active() || ticket !== inspectionJob || accepted !== source) return;
          accepted = { ...source, options: snapshot, analysis }; correspondenceIndex = 0;
          if (options?.chords.some(chord => chord.id === fromChordId) && options.chords.some(chord => chord.id === toChordId)) {
            options.fromChordId = fromChordId; options.toChordId = toChordId; refreshJson();
          }
          renderResults();
          if (restoreFocus) get('matrix').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
          showStatus(`Inspecting ${chordName(fromChordId)} → ${chordName(toChordId)}. The atlas uses the last accepted context; Analyze & realize applies draft edits.`);
        } catch (error) {
          if (active() && ticket === inspectionJob) showStatus(`Previous relationship retained. ${message(error)}`, true);
        }
      }
      function append(id: string): void {
        if (!options) return;
        // The duration is an authored UI choice copied from the current musical
        // premise, never a second rhythmic generator.
        const duration = options.history.at(-1)?.duration ?? presets![0].options.history[0].duration;
        options.history.push({ chordId: id, duration: { ...duration } });
        options.fromChordId = id; renderDraft(); changed();
      }
      function download(name: string, data: unknown): void {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = downloadUrl; anchor.download = `continuum-harmonic-motion-${name}.json`; anchor.click();
      }
      form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) void analyze(); }, { signal: context.signal });
      container.addEventListener('input', event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || !options) return;
        if (target.dataset.motion === 'json') { jsonDraft = target.value; jsonDirty = true; job++; showStatus('JSON draft changed. Apply JSON & realize to validate and use it.'); return; }
        if (target.dataset.motion === 'assignment') {
          if (!accepted || !(target instanceof HTMLInputElement) || !target.validity.valid || !Number.isInteger(target.valueAsNumber)) return;
          correspondenceIndex = target.valueAsNumber - 1;
          get('correspondence').innerHTML = renderCorrespondence(accepted.analysis.selectedCorrespondences[correspondenceIndex]); return;
        }
        if (!(target instanceof HTMLInputElement)) return;
        if (target.dataset.motion === 'tempo') options.tempo = target.valueAsNumber;
        else if (target.dataset.motion === 'arpeggiate') options.arpeggiate = target.checked;
        else if (target.dataset.motion === 'chord-members') {
          const entries = target.value.split(',').map(value => value.trim());
          const pitches = entries.map(Number);
          const valid = entries.every(value => value !== '') && pitches.every(Number.isSafeInteger);
          target.setCustomValidity(valid ? '' : 'Enter comma-separated, exact integer millicent coordinates.');
          if (valid) options.chords.find(chord => chord.id === editChordId)!.pitchesMillicents = pitches;
        }
        else if (target.dataset.motion === 'chord-root') options.chords.find(chord => chord.id === editChordId)!.rootMillicents = target.value === '' ? null : target.valueAsNumber;
        else if (target.dataset.step && (target.dataset.stepField === 'numerator' || target.dataset.stepField === 'denominator')) options.history[Number(target.dataset.step)].duration[target.dataset.stepField] = target.valueAsNumber;
        else if (target.dataset.frame && (target.dataset.frameField === 'tonicMillicents' || target.dataset.frameField === 'weight')) options.frames[Number(target.dataset.frame)][target.dataset.frameField] = target.valueAsNumber;
        else if (target.dataset.weight) options.weights[target.dataset.weight as keyof MotionWeights] = target.valueAsNumber;
        else return;
        changed();
      }, { signal: context.signal });
      container.addEventListener('change', event => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !options) return;
        if (target.dataset.motion === 'preset') {
          const preset = presets!.find(preset => preset.id === target.value); if (!preset) return;
          presetId = preset.id; options = structuredClone(preset.options); jsonDirty = false; renderDraft(); changed(); void analyze();
        } else if (target.dataset.motion === 'metric') { metric = target.value as Metric; renderMatrix(); }
        else if (target.dataset.motion === 'edit-chord') { editChordId = target.value; renderChordEditor(); }
        else if (target.dataset.step && target.dataset.stepField === 'chord') { options.history[Number(target.dataset.step)].chordId = target.value; changed(); }
      }, { signal: context.signal });
      container.addEventListener('click', event => {
        const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target || !options) return;
        if (target.dataset.pairFrom && target.dataset.pairTo) {
          void inspectPair(target.dataset.pairFrom, target.dataset.pairTo); return;
        }
        if (target.dataset.removeStep !== undefined) { options.history.splice(Number(target.dataset.removeStep), 1); renderDraft(); changed(); return; }
        if (target.dataset.appendResult) {
          if (options.chords.some(chord => chord.id === target.dataset.appendResult)) append(target.dataset.appendResult);
          else showStatus('This accepted chord is outside the current draft catalog. Analyze & realize the draft before appending its continuations.');
          return;
        }
        switch (target.dataset.motion) {
          case 'append': append(get<HTMLSelectElement>('append-chord').value); break;
          case 'apply-json':
            try {
              const proposed = JSON.parse(jsonDraft) as HarmonicMotionOptions;
              if (proposed === null || typeof proposed !== 'object' || Array.isArray(proposed)) throw new Error('The request must be a JSON object.');
              presetId = ''; void analyze(proposed);
            }
            catch (error) { showStatus(`Request JSON could not be read: ${message(error)}`, true); }
            break;
          case 'reset-json': jsonDirty = false; refreshJson(); break;
          case 'download-request': download('request', options); break;
          case 'download-analysis': if (accepted) download('analysis', { options: accepted.options, analysis: accepted.analysis }); break;
          case 'download-program': if (accepted) download('program', accepted.plan); break;
        }
      }, { signal: context.signal });
      get('matrix').addEventListener('keydown', event => {
        if (!(event instanceof KeyboardEvent)) return;
        const target = event.target as HTMLElement;
        if (!accepted || target.dataset.row === undefined || target.dataset.column === undefined) return;
        let row = Number(target.dataset.row), column = Number(target.dataset.column);
        if (event.key === 'ArrowRight') column++;
        else if (event.key === 'ArrowLeft') column--;
        else if (event.key === 'ArrowDown') row++;
        else if (event.key === 'ArrowUp') row--;
        else if (event.key === 'Home') column = 0;
        else if (event.key === 'End') column = accepted.options.chords.length - 1;
        else return;
        event.preventDefault();
        row = Math.max(0, Math.min(accepted.options.chords.length - 1, row)); column = Math.max(0, Math.min(accepted.options.chords.length - 1, column));
        const next = get('matrix').querySelector<HTMLButtonElement>(`[data-row="${row}"][data-column="${column}"]`);
        if (next) { target.tabIndex = -1; next.tabIndex = 0; next.focus(); }
      }, { signal: context.signal });
      get('metric').innerHTML = metrics.map(item => `<option value="${item.id}"${metric === item.id ? ' selected' : ''}>${item.label}</option>`).join('');
      if (accepted) { renderResults(); preview.setResult(accepted); }
      const loaded = presets ?? await context.call('getHarmonicMotionPresets', {});
      if (!active()) return;
      presets = loaded;
      get('preset').innerHTML = `<option value="" disabled>Custom request</option>${presets.map(preset => `<option value="${html(preset.id)}">${html(preset.name)}</option>`).join('')}`;
      if (!options) { options = structuredClone(presets[0].options); presetId = presets[0].id; }
      renderDraft();
      for (const key of ['preset', 'tempo', 'arpeggiate', 'analyze', 'append-chord', 'append', 'apply-json', 'reset-json', 'download-request']) get<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(key).disabled = false;
      if (accepted) showStatus('Your draft and accepted atlas are retained. Analyze & realize to apply pending changes.');
      else await analyze();
    },
  };
}

function html(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
function pairKey(from: string, to: string): string { return JSON.stringify([from, to]); }
function humanize(value: string): string { const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2'); return spaced[0].toUpperCase() + spaced.slice(1); }
function format(value: number | null): string { return value === null ? '—' : Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 3 }); }
function signed(value: number | null): string { return value === null ? '—' : `${value > 0 ? '+' : ''}${format(value)}`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
