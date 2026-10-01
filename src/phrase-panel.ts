import { DEFAULT_PHRASING, restAppliesToNote, type PhraseConfig, type PhraseSnapshot } from './phrasing';
import { COMPOSITION_CONTROLS, normalizeComposition, type IndependentLayerSnapshot } from './composition';
import type { Frame, NoteEvent } from './types';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const bounded = (value: number) => Math.max(0, Math.min(1, value));
const controls = [
  ['renewal', 'Variation memory', 'Record actually heard thematic variations in the memory view.'],
  ['variation', 'Ornament allowance', 'Permit more of the available embellishment within connected continuations. The identifying head and cadence stay intact.'],
] as const;
const compositionControls = COMPOSITION_CONTROLS.filter(([key]) => key !== 'development' && key !== 'repetition');

/** Only controls consumed by the common composer are editable here. Older
 * recipe fields remain intact so saving this panel does not erase history. */
export function applyVisiblePhraseControls(config: PhraseConfig, phraseValues: Partial<Record<'renewal' | 'variation', number>>,
  compositionValues: Partial<Record<typeof compositionControls[number][0], number>>): PhraseConfig {
  return { ...config, enabled: true, character: 'lyrical',
    ...Object.fromEntries(controls.filter(([key]) => Number.isFinite(phraseValues[key])).map(([key]) => [key, bounded(phraseValues[key]!)])),
    composition: normalizeComposition({ ...config.composition,
      ...Object.fromEntries(compositionControls.filter(([key]) => Number.isFinite(compositionValues[key])).map(([key]) => [key, bounded(compositionValues[key]!)])) }),
  };
}

export function phraseSettingsMarkup(): string {
  return `<details class="phrase-settings"><summary>Shape the composition <span>Surface detail, independent layers & ensemble expression</span></summary><p class="phrase-settings-copy subtle tiny">A protected thematic core supplies the head, continuation and arrival. Surface ornaments and related answers develop around it; the shared expression plan controls texture and dynamic contrast.</p><div class="phrase-knobs">${compositionControls.map(([key, label, help]) => `<div class="parameter"><label for="composition-${key}">${label}<output id="composition-value-${key}"></output></label><input id="composition-${key}" data-composition-control="${key}" type="range" min="0" max="1" step=".01" aria-describedby="composition-help-${key}"/><p id="composition-help-${key}">${help}</p></div>`).join('')}</div><div class="phrase-knobs">${controls.map(([key, label, help]) => `<div class="parameter"><label for="phrase-${key}">${label}<output id="phrase-value-${key}"></output></label><input id="phrase-${key}" data-phrase-control="${key}" type="range" min="0" max="1" step=".01" aria-describedby="phrase-help-${key}"/><p id="phrase-help-${key}">${help}</p></div>`).join('')}</div><div class="phrase-apply"><button id="apply-phrasing" class="button primary">Apply composition & restart</button><span id="phrase-settings-status">Applies to the same seed from the beginning. Live musical-character controls remain available.</span></div></details>`;
}

/** Report the common intention separately from scored attacks and audio level.
 * Only committed moments up to the displayed frame contribute to the range. */
export function compositionExpressionMarkup(frame?: Frame, history: readonly Frame[] = []): string {
  const expression = frame?.diagnostics.compositionExpression;
  if (!frame || !expression) return '<p class="subtle tiny">The shared expression and scored texture appear with the first composed moment.</p>';
  const moments = new Map(history.filter(item => item.tick >= frame.tick - 480 * 128 && item.tick <= frame.tick)
    .map(item => [item.tick, item.diagnostics.compositionExpression]));
  moments.set(frame.tick, expression);
  const keys = ['energy', 'activity', 'intensity', 'register', 'sustain', 'accent'] as const;
  const instruments = [...new Set(frame.notes.filter(note => note.part !== 'percussion').map(note => note.timbre).filter(Boolean))];
  const articulations = [...new Set(frame.notes.filter(note => note.part !== 'percussion').map(note => note.articulation).filter(Boolean))];
  const arrangement = frame.diagnostics.arrangement;
  const rhythm = expression.rhythm;
  return `<div class="expression-caption"><strong>Shared expression · ${escape(expression.direction)}</strong><span>Texture pace ${percent(expression.pace)} · rhythm drive ${percent(expression.rhythmDrive)} · ${escape(expression.articulation)}</span></div><div class="expression-values">${keys.map(key => {
    const values = [...moments.values()].flatMap(value => value && Number.isFinite(value[key]) ? [value[key]] : []);
    const low = Math.min(...values), high = Math.max(...values);
    return `<div><span>${key}</span><strong>${percent(expression[key])}</strong><progress aria-label="Current ${key} intention" max="1" value="${bounded(expression[key])}"></progress><small>${percent(low)}–${percent(high)} observed</small></div>`;
  }).join('')}</div><p class="subtle tiny"><strong>Idea density ${percent(frame.parameters.ideaDensity)} · ${arrangement ? `${escape(arrangement.name)} · ${arrangement.voices.length} planned ${arrangement.voices.length === 1 ? 'player' : 'players'}` : `Ensemble size ${percent(frame.parameters.ensembleSize)}`}</strong>${rhythm ? `<br>Shared riff: ${escape(rhythm.feel)} time · ${escape(rhythm.treatment)} · ${Math.round(rhythm.cycleTicks / 480 * 100) / 100} beat cycle` : ''}</p><p class="subtle tiny">Observed score range: ${[...moments.values()].filter(Boolean).length} moments within the last 128 beats. These are musical intentions, not measured audio loudness.${articulations.length ? ` Notes in this moment: ${articulations.map(value => escape(value!)).join(', ')}.` : ' No new pitched notes in this moment.'}${instruments.length && frame.sound.instrument !== 'additive' ? ` Colors: ${instruments.map(value => escape(value!)).join(', ')}.` : ''}</p>`;
}

/** The snapshot describes one actual cycle; never invent a new one at its end. */
export function layerPhaseAt(layer: IndependentLayerSnapshot, tick: number): number {
  return bounded((tick - layer.cycleStartTick) / Math.max(1, layer.cycleTicks));
}

/** A map of authored relationships, not a second interpretation of the notes. */
export function ideaJourneyMarkup(phrase: PhraseSnapshot): string {
  const plan = phrase.composition;
  if (!plan?.fingerprint) return '';
  const sign = (value: number) => `${value > 0 ? '+' : ''}${value}`;
  return `<div class="idea-journey"><div class="mini-heading">IDEA IN USE <span>Source → transformation → destination</span></div>
    <div class="idea-fingerprint"><strong>Hook fingerprint</strong><span>${plan.fingerprint.intervals.map(sign).join(' · ')} <small>scale-degree intervals</small></span><span>${plan.fingerprint.rhythmUnits.join(' : ')} <small>relative durations</small></span></div>
    <ol class="idea-branches" style="--idea-columns:${plan.motifs.length <= 4 ? 2 : 3}">${plan.motifs.map((motif, index) => `<li data-idea-start="${motif.startTick}" data-idea-end="${motif.endTick}" title="${escape(`${motif.id} ← ${motif.sourceId}${motif.parentId ? ` ← ${motif.parentId}` : ''}`)}"><span>${index + 1}</span><div><strong>${escape(motif.relationship ?? motif.treatment)}</strong><small>${motif.goalDegree === undefined ? '' : `Target degree offset ${sign(motif.goalDegree)} · `}${motif.attackCount === undefined ? '' : `${motif.attackCount} structural notes · `}${Math.round((motif.endTick - motif.startTick) / 480 * 10) / 10} quarter beats</small></div></li>`).join('')}</ol>
    <p class="subtle tiny">The opening interval and rhythm identify the hook. Related phrases develop toward these written targets; orchestral delivery adds the surface detail.</p></div>`;
}

/** The reference pulse can cross the notated meter; show both clocks honestly. */
export function pulseMapMarkup(frame?: Frame): string {
  if (!frame?.form) return '';
  const form = frame.form, beat = 480 * 4 / form.meter.denominator;
  const rhythm = frame.diagnostics.compositionExpression?.rhythm;
  const groups = form.meterGroups ?? [];
  const boundaries = new Set<number>([0]);
  let cumulative = 0;
  for (const group of groups) { cumulative += group; boundaries.add(cumulative); }
  return `<div class="idea-pulse"><div class="mini-heading">FIND THE PULSE <span>${form.meter.numerator}/${form.meter.denominator}${groups.length ? ` · grouped ${groups.join(' + ')}` : ''}</span></div>
    <div class="pulse-beats" aria-label="Notated beats and source grouping">${Array.from({ length: form.meter.numerator }, (_, index) => `<span class="pulse-beat ${boundaries.has(index) ? 'group-start' : ''}" data-pulse-start="${form.barStartTick + index * beat}" data-pulse-end="${form.barStartTick + (index + 1) * beat}" data-pulse-period="${form.barTicks}">${index + 1}</span>`).join('')}</div>
    ${rhythm ? `<div class="pulse-clocks"><div><span>Reference · ${rhythm.reference.beatTicks / 480} quarter beat</span><i data-clock-origin="${rhythm.reference.originTick}" data-clock-span="${rhythm.reference.beatTicks}"></i></div><div><span>Hook cycle · ${Math.round(rhythm.cycleTicks / 480 * 100) / 100} quarter beats</span><i data-clock-origin="${rhythm.cycleStartTick}" data-clock-span="${rhythm.cycleTicks}"></i></div></div>` : ''}
    <p class="subtle tiny">${escape(form.meterReason ?? 'The current metrical pulse.')}${form.meterSourceId ? ` · ${escape(form.meterSourceId)}` : ''}</p>
    <div class="sounding-ensemble" aria-label="Instruments sounding at the playhead">${['harmony', 'bass', 'melody', 'percussion'].map(part => `<span data-sounding-part="${part}">${part === 'percussion' ? 'Drums' : part === 'melody' ? 'Melody' : part === 'harmony' ? 'Harmony' : 'Bass'}</span>`).join('')}<small>Sounding parts</small></div></div>`;
}

/** Render only hierarchy supplied by the actual composition plan. */
export function compositionScoreMarkup(phrase: PhraseSnapshot, beatTicks = 480): string {
  const plan = phrase.composition;
  if (!plan) return '';
  const span = Math.max(1, phrase.endTick - phrase.startTick);
  const left = (tick: number) => bounded((tick - phrase.startTick) / span) * 100;
  const position = (tick: number) => `thought +${Math.round((tick - phrase.startTick) / beatTicks * 100) / 100} beats`;
  const cycleLength = (ticks: number) => `${Math.round(ticks / 480 * 100) / 100} quarter-note beats`;
  const motifs = plan.motifs.filter(motif => motif.endTick > phrase.startTick && motif.startTick < phrase.endTick);
  const shortPhrases = (plan.shortPhrases ?? []).filter(part => part.endTick > phrase.startTick && part.startTick < phrase.endTick);
  const cues = plan.cues.filter(cue => cue.tick >= phrase.startTick && cue.tick < phrase.endTick);
  const sources = [...new Set(motifs.map(motif => motif.sourceId))], sourceCount = sources.length;
  const shortSources = [...new Set(shortPhrases.map(part => part.sourceId))];
  const motifName = (id: string) => `Motif ${sources.indexOf(id) + 1}`;
  const shortName = (id: string) => `Phrase ${shortSources.indexOf(id) + 1}`;
  const transition = plan.transition;
  const inViewTransition = transition && transition.endTick > phrase.startTick && transition.startTick < phrase.endTick ? transition : undefined;
  const layers = plan.layers ?? [];
  return `<div class="composition-heading"><span class="eyebrow">THOUGHT ${plan.phraseOrdinal + 1} OF ${plan.phraseCount}</span><span>Occurrence ${plan.iteration + 1} · ${escape(plan.phraseFunction)} · ${escape(plan.iteration === 0 ? 'first source reading' : plan.treatment)}</span></div>
    <ol class="composition-levels" aria-label="Short phrases, grouped motifs, theme and movement hierarchy">
      <li><span>Short phrases</span><strong>${plan.shortPhrases ? `${shortSources.length} ${shortSources.length === 1 ? 'source' : 'sources'} · ${shortPhrases.length} ${shortPhrases.length === 1 ? 'appearance' : 'appearances'}` : 'Not supplied by this plan'}</strong><small>${plan.shortPhrases ? 'Reusable small melodic ideas' : 'No short-phrase hierarchy inferred'}</small></li>
      <li><span>Grouped motifs</span><strong>${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} · ${motifs.length} ${motifs.length === 1 ? 'appearance' : 'appearances'}</strong><small>${plan.cadence === 'open' ? 'Open ending · the thought continues' : 'Closed ending · a place to arrive'}</small></li>
      <li><span>Theme</span><strong>${escape(plan.themeName)}</strong><small>The current theme occurrence</small></li>
      <li><span>Movement ${plan.movementIndex + 1}</span><strong>${escape(plan.movementName)}</strong><small>The formal route</small></li>
    </ol>
    ${ideaJourneyMarkup(phrase)}
    <div class="composition-theme-progress" aria-label="Playhead within the current theme"><i></i></div>
    <div class="composition-score" aria-label="Short phrases, motifs and ensemble cues at their actual positions within this thought">
      ${plan.shortPhrases ? `<div class="composition-lane"><span>Phrases</span><div class="composition-lane-grid short-phrase-grid">${shortPhrases.map(part => `<span class="composition-short-phrase" data-short-phrase-id="${escape(part.id)}" data-short-source-id="${escape(part.sourceId)}" data-motif-id="${escape(part.motifId)}" style="left:${left(part.startTick)}%;width:${Math.max(.2, left(part.endTick) - left(part.startTick))}%" title="${escape(`${shortName(part.sourceId)} · ${part.coreNotes} core notes · ${cycleLength(part.cycleTicks)} cycle · ${part.transpositionCents >= 0 ? '+' : ''}${part.transpositionCents} cents · interval scale ${part.intervalScale} · ${position(part.startTick)}`)}"><b>${shortName(part.sourceId)}</b><small>${part.coreNotes} core notes</small></span>`).join('')}<i class="phrase-playhead"></i></div></div>` : ''}
      <div class="composition-lane"><span>Motifs</span><div class="composition-lane-grid">${motifs.map(motif => `<span class="composition-motif" data-source-id="${escape(motif.sourceId)}" style="left:${left(motif.startTick)}%;width:${Math.max(.2, left(motif.endTick) - left(motif.startTick))}%" title="${escape(`${motifName(motif.sourceId)} · ${motif.treatment} · ${position(motif.startTick)}`)}"><b>${motifName(motif.sourceId)}</b><small>${escape(motif.treatment)}</small></span>`).join('')}<i class="phrase-playhead"></i></div></div>
      <div class="composition-lane"><span>Cues</span><div class="composition-lane-grid cue-grid">${cues.map(cue => `<span class="composition-cue ${cue.kind}" data-cue-id="${escape(cue.id)}" data-cue-tick="${cue.tick}" style="left:${left(cue.tick)}%;${cue.endTick ? `width:${Math.max(.2, left(cue.endTick) - left(cue.tick))}%;` : ''}--cue-strength:${bounded(cue.strength)}" title="${escape(`${cue.kind}${cue.ensemble ? ` · ensemble ${cue.ensemble}` : ''} · ${position(cue.tick)} · ${percent(cue.strength)} strength`)}"><b>${escape(cue.kind)}</b></span>`).join('')}<i class="phrase-playhead"></i></div></div>
      ${inViewTransition ? `<div class="composition-lane"><span>Change</span><div class="composition-lane-grid transition-grid"><span class="composition-transition" data-transition-start="${inViewTransition.startTick}" data-transition-end="${inViewTransition.endTick}" data-transition-boundary="${inViewTransition.boundaryTick}" style="left:${left(inViewTransition.startTick)}%;width:${Math.max(.2, left(inViewTransition.endTick) - left(inViewTransition.startTick))}%" title="${escape(`Planned ${inViewTransition.kind} into ${inViewTransition.reason} change · ${percent(inViewTransition.energy)} energy. Shared breaks can shorten preparation.`)}">Planned ${escape(inViewTransition.kind)} · ${escape(inViewTransition.reason)}</span><i class="phrase-playhead"></i></div></div>` : ''}
    </div><p id="composition-cue-status" class="composition-cue-status">Shared entrances, accents and arrivals follow these musical positions.</p>
    ${layers.length ? `<div class="composition-layers" aria-label="Independent layer cycles"><div class="mini-heading">INDEPENDENT CYCLES <span>Quarter-note beats; phase shows cycle participation, not continuous sound</span></div>${layers.map(layer => `<div class="composition-layer ${layer.role}" data-layer-id="${escape(layer.id)}" data-cycle-start="${layer.cycleStartTick}" data-cycle-end="${layer.cycleEndTick}"><div><strong>${escape(layer.label)}</strong><small>${escape(layer.role === 'counter' ? 'Counterline' : 'Rhythm')} · ${cycleLength(layer.cycleTicks)}</small></div><div class="composition-cycle" role="progressbar" aria-label="${escape(layer.label)} cycle phase" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(layerPhaseAt(layer, phrase.startTick) * 100)}" style="--cycle-phase:${percent(layerPhaseAt(layer, phrase.startTick))}"><i></i></div><span class="composition-layer-phase">${layer.active ? 'Participating cycle' : 'Resting cycle'}</span></div>`).join('')}</div>` : ''}
    ${transition ? `<p id="composition-transition-status" class="composition-transition-status">Planned ${escape(transition.kind)} for a ${escape(transition.reason)} change · ${percent(transition.energy)} energy. Shared breaks can shorten preparation.</p>` : ''}
    ${(plan.fills ?? []).filter(fill => fill.parts.length > 1).map(fill => `<p class="composition-transition-status" aria-label="Orchestra fill">Ensemble ${escape(fill.shape.replaceAll('-', ' '))} · ${fill.parts.map(part => escape(part)).join(' + ')}${fill.sharedTicks.length ? ` · ${fill.sharedTicks.length} shared attacks` : ''}</p>`).join('')}
    <details class="composition-debug"><summary>Composition source IDs</summary><code>Movement: ${escape(plan.movementId)}<br>Theme: ${escape(plan.themeId)}<br>Thought: ${escape(plan.phraseId)}<br>Thought source: ${escape(plan.sourcePhraseId)}${motifs.map(motif => `<br>${motifName(motif.sourceId)}: ${escape(motif.id)} ← ${escape(motif.sourceId)}`).join('')}${shortPhrases.map(part => `<br>${shortName(part.sourceId)}: ${escape(part.id)} ← ${escape(part.sourceId)} · motif ${escape(part.motifId)}`).join('')}${layers.map(layer => `<br>Layer: ${escape(layer.id)} ← ${escape(layer.sourceId)} · ticks ${layer.cycleStartTick}–${layer.cycleEndTick}`).join('')}${cues.filter(cue => cue.sourceId).map(cue => `<br>Cue: ${escape(cue.id)} ← ${escape(cue.sourceId!)}`).join('')}</code></details>`;
}

export function createPhrasePanel(host: HTMLElement, options: {
  getConfig: () => PhraseConfig | undefined;
  onApply: (config: PhraseConfig) => Promise<void>;
}) {
  const section = document.createElement('section');
  section.className = 'panel phrase-panel';
  section.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">SPACE HAS A PART TO PLAY</span><h2>Theme, development & expression <span id="phrase-mode" class="count-tag">PHRASING</span></h2></div><span id="phrase-role" class="phrase-role">An idea takes shape</span></div>
    <div class="phrase-story"><div><strong id="phrase-name">A little room for surprise</strong><p id="phrase-relationship">An identifying head, a purposeful continuation, and a prepared arrival.</p><span id="phrase-sounding" class="subtle tiny">Waiting for the first entrance</span></div><div id="phrase-pause" class="pause-cue">A breath before the next thought</div></div>
    <div id="idea-pulse-map"></div>
    <div id="composition-hierarchy" class="composition-hierarchy" hidden></div>
    <div id="phrase-score" class="phrase-score" aria-label="Phrase roles, gestures and planned rests"></div>
    <div class="phrase-legend"><span><i class="theme"></i>Theme</span><span><i class="counter"></i>Counterline</span><span><i class="solo"></i>Solo</span><span class="rest-key">▧ Planned space</span><span id="phrase-position"></span></div>
    <div class="phrase-charts shared-expression-charts"><div><div class="mini-heading">SHARED EXPRESSION PLAN <span>Activity · intensity · register through this thought</span></div><div id="phrase-envelopes"></div><p class="subtle tiny">Sampled points from the score’s common trajectory. Texture and ornament delivery read this same plan.</p></div></div>
    <div class="idea-shelf"><span class="eyebrow">REMEMBERED & RECAST</span><div id="phrase-ideas"></div></div>
    ${phraseSettingsMarkup()}`;
  host.after(section);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => section.querySelector<T>(selector)!;
  let shown: PhraseSnapshot | undefined;
  let lastFrameIndex = -1;
  let leadNotes: NoteEvent[] = [];
  let renderKey = '';
  let latestFrame: Frame | undefined;
  let latestTick = 0;
  let visible = true;
  function sync() {
    const config = options.getConfig() ?? DEFAULT_PHRASING;
    for (const [key] of controls) {
      const input = $<HTMLInputElement>(`#phrase-${key}`); input.value = String(config[key]);
      input.style.setProperty('--fill', percent(config[key])); $(`#phrase-value-${key}`).textContent = percent(config[key]);
    }
    const composition = normalizeComposition(config.composition);
    for (const [key] of compositionControls) {
      const input = $<HTMLInputElement>(`#composition-${key}`); input.value = String(composition[key]);
      input.style.setProperty('--fill', percent(composition[key])); $(`#composition-value-${key}`).textContent = percent(composition[key]);
    }
    renderKey = '';
  }
  function draft(): PhraseConfig {
    return applyVisiblePhraseControls(options.getConfig() ?? DEFAULT_PHRASING,
      Object.fromEntries(controls.map(([key]) => [key, Number($<HTMLInputElement>(`#phrase-${key}`).value)])),
      Object.fromEntries(compositionControls.map(([key]) => [key, Number($<HTMLInputElement>(`#composition-${key}`).value)])));
  }
  section.querySelectorAll<HTMLInputElement>('[data-phrase-control]').forEach(input => input.oninput = () => {
    const value = Number(input.value); input.style.setProperty('--fill', percent(value));
    $(`#phrase-value-${input.dataset.phraseControl}`).textContent = percent(value);
    $('#phrase-settings-status').textContent = 'Settings edited. Apply to hear and replay this new interpretation.';
  });
  section.querySelectorAll<HTMLInputElement>('[data-composition-control]').forEach(input => input.oninput = () => {
    const value = Number(input.value); input.style.setProperty('--fill', percent(value));
    $(`#composition-value-${input.dataset.compositionControl}`).textContent = percent(value);
    $('#phrase-settings-status').textContent = 'Composition edited. Apply to rebuild the same seed with these relationships.';
  });
  $('#apply-phrasing').onclick = async () => {
    const button = $<HTMLButtonElement>('#apply-phrasing'); button.disabled = true;
    try { await options.onApply(draft()); sync(); $('#phrase-settings-status').textContent = 'Applied to this performance. The same seed and settings replay exactly.'; }
    catch (error) { $('#phrase-settings-status').textContent = (error as Error).message; }
    finally { button.disabled = false; }
  };
  function update(frame?: Frame) {
    if (!frame || frame.index <= lastFrameIndex) leadNotes = [];
    if (frame) {
      leadNotes = [...leadNotes.filter(note => note.tick + note.duration > frame.tick), ...frame.notes];
      // Upper/bass/lead channels are monophonic in the synth. An incoming
      // short note must not leave an older nominally long tail lit afterward.
      leadNotes = leadNotes.map(note => {
        if (note.part === 'percussion') return note;
        const replacement = leadNotes.filter(next => next.voice === note.voice && next.part === note.part && next.tick > note.tick)
          .reduce((earliest, next) => Math.min(earliest, next.tick), note.tick + note.duration);
        return replacement < note.tick + note.duration ? { ...note, duration: replacement - note.tick } : note;
      });
      lastFrameIndex = frame.index;
    }
    latestFrame = frame;
    shown = frame?.phrase;
    if (visible) render(frame);
  }
  function render(frame?: Frame) {
    const phrase = frame?.phrase;
    $('#idea-pulse-map').innerHTML = pulseMapMarkup(frame);
    $('#phrase-mode').textContent = phrase ? 'COMPOSING' : 'READY';
    if (!phrase) {
      $('#composition-hierarchy').hidden = true; $('#composition-hierarchy').innerHTML = '';
      $('#phrase-sounding').textContent = '';
      $('#phrase-role').textContent = 'An idea takes shape';
      $('#phrase-name').textContent = 'A theme, and room to develop';
      $('#phrase-relationship').textContent = 'The shared plan connects remembered ideas, harmonic direction and ensemble gestures.';
      $('#phrase-score').innerHTML = '<p class="phrase-empty">The phrase map appears when this seed is composed.</p>';
      $('#phrase-envelopes').innerHTML = ''; $('#phrase-ideas').innerHTML = ''; renderKey = ''; return;
    }
    const key = `${phrase.phraseId}/${phrase.startTick}/${phrase.themeId}/${phrase.relationship}/${JSON.stringify(phrase.envelopes)}/${JSON.stringify(phrase.ideas)}/${JSON.stringify(phrase.composition)}`;
    if (key === renderKey) return;
    renderKey = key;
    $('#phrase-role').textContent = phrase.composition ? `${phrase.leadRole} · thought ${phrase.composition.phraseOrdinal + 1} of ${phrase.composition.phraseCount}` : `${phrase.leadRole} · phrase ${phrase.phraseId + 1}`;
    $('#phrase-name').textContent = phrase.themeName;
    $('#phrase-relationship').textContent = `${phrase.gesture} · ${phrase.relationship}`;
    const hierarchy = $('#composition-hierarchy');
    hierarchy.hidden = !phrase.composition;
    hierarchy.innerHTML = compositionScoreMarkup(phrase, 480 * 4 / (frame?.form?.meter.denominator ?? 4));
    const span = Math.max(1, phrase.endTick - phrase.startTick);
    const left = (tick: number) => bounded((tick - phrase.startTick) / span) * 100;
    // The first solo cell describes the whole argument; its children show the
    // successive gestures. Draw the children so labels never cover each other.
    const soloCells = phrase.cells.filter(cell => cell.role === 'solo');
    const visibleCells = soloCells.length > 1 ? phrase.cells.filter(cell => cell !== soloCells[0]) : phrase.cells;
    const rows = [['theme', 'Theme'], ['counter', 'Counter'], ['solo', 'Solo'], ['bass', 'Bass'], ['drums', 'Beat']] as const;
    const laneNotes = { theme: { part: 'melody', voice: 5 }, counter: { part: 'melody', voice: 8 }, solo: { part: 'melody', voice: 6 }, bass: { part: 'bass', voice: 4 }, drums: { part: 'percussion', voice: 9 } };
    $('#phrase-score').innerHTML = rows.map(([role, label]) => `<div class="phrase-lane"><span>${label}</span><div class="phrase-lane-grid">${visibleCells.filter(cell => cell.role === role).map(cell => `<div class="phrase-cell ${role}" style="left:${left(cell.startTick)}%;width:${Math.max(.2, left(cell.endTick) - left(cell.startTick))}%" title="${escape(`${cell.label} · ${cell.ideaId}`)}"><span>${escape(cell.label)}</span></div>`).join('')}${phrase.rests.filter(rest => rest.kind !== 'player-exit' && restAppliesToNote(laneNotes[role], rest)).map(rest => `<div class="phrase-rest" style="left:${left(rest.startTick)}%;width:${left(rest.endTick) - left(rest.startTick)}%" title="${escape(rest.reason)}"></div>`).join('')}<i class="phrase-playhead"></i></div></div>`).join('');
    $('#phrase-envelopes').innerHTML = phrase.envelopes.map(envelope => {
      const point = (position: number, value: number) => `${8 + bounded(position) * 244},${56 - bounded(value) * 48}`;
      const target = envelope.points.map((p, i) => `${i ? 'L' : 'M'}${point(p.position, p.value)}`).join(' ');
      return `<div class="envelope-mini"><span>${escape(envelope.key)}</span><svg viewBox="0 0 260 64" role="img" aria-label="${escape(envelope.key)} shared expression trajectory"><path class="envelope-grid" d="M8,56H252 M8,32H252 M8,8H252"/><path class="envelope-chosen" d="${target}"/>${envelope.points.map(p => `<circle class="envelope-dot" cx="${8 + bounded(p.position) * 244}" cy="${56 - bounded(p.value) * 48}" r="2"/>`).join('')}</svg></div>`;
    }).join('');
    const anchors = phrase.ideas.filter(idea => !idea.sourceId);
    const descendants = phrase.ideas.filter(idea => idea.sourceId).slice(-5);
    $('#phrase-ideas').innerHTML = [...anchors, ...descendants].map(idea => `<span class="idea-token ${idea.id === phrase.themeId ? 'active' : ''}" title="${escape(`Born in phrase ${idea.bornPhrase + 1}; last heard ${idea.lastHeardPhrase + 1}${idea.sourceId ? `; developed from ${idea.sourceId}` : ''}`)}"><strong>${escape(idea.name)}</strong>${idea.signature ? `<span class="idea-signature">${escape(idea.signature)}</span>` : ''}${idea.contour ? `<span class="idea-lineage">${escape(idea.contour)}</span>` : ''}<small>${escape(idea.role)} · ${idea.uses} ${idea.uses === 1 ? 'appearance' : 'appearances'}${idea.lineage ? ` · ${escape(idea.lineage)}` : ''}</small></span>`).join('');
  }
  function tick(tick: number) {
    latestTick = tick;
    if (!shown || !visible) return;
    const sounding = leadNotes.filter(note => note.tick <= tick && note.tick + note.duration > tick
      && !shown!.rests.some(rest => restAppliesToNote(note, rest) && tick >= rest.startTick && tick < rest.endTick));
    const roles = [...new Set(sounding.filter(note => note.part === 'melody').map(note => note.voice === 6 ? 'Lead solo' : note.voice === 8 ? 'Independent counterline' : note.voice === 7 ? 'Counterline' : 'Theme'))];
    section.querySelectorAll<HTMLElement>('[data-sounding-part]').forEach(chip => chip.classList.toggle('active', sounding.some(note => note.part === chip.dataset.soundingPart)));
    section.querySelectorAll<HTMLElement>('[data-pulse-start], [data-idea-start]').forEach(marker => {
      const start = Number(marker.dataset.pulseStart ?? marker.dataset.ideaStart), end = Number(marker.dataset.pulseEnd ?? marker.dataset.ideaEnd);
      const period = Number(marker.dataset.pulsePeriod);
      const active = period > 0 ? ((tick - start) % period + period) % period < end - start : tick >= start && tick < end;
      marker.classList.toggle('active', active);
    });
    section.querySelectorAll<HTMLElement>('[data-clock-origin]').forEach(clock => {
      const period = Number(clock.dataset.clockSpan), phase = ((tick - Number(clock.dataset.clockOrigin)) % period + period) % period / period;
      clock.style.setProperty('--clock-phase', percent(phase));
    });
    $('#phrase-sounding').textContent = roles.length ? `${roles.join(' + ')} · sounding at the playhead` : 'Lead space · the rhythm can carry the phrase';
    const progress = bounded((tick - shown.startTick) / Math.max(1, shown.endTick - shown.startTick));
    section.style.setProperty('--phrase-progress', percent(progress));
    $('#phrase-position').textContent = `${percent(progress)} of ${shown.composition ? 'thought' : 'phrase'}`;
    const rest = shown.rests.find(rest => rest.kind !== 'player-exit' && tick >= rest.startTick && tick < rest.endTick);
    const next = shown.rests.find(rest => rest.kind !== 'player-exit' && rest.startTick > tick);
    $('#phrase-pause').textContent = rest ? `${rest.scope === 'ensemble' ? 'Together, a pause' : rest.scope === 'lead' ? 'The lead takes a breath' : 'Space beneath the lead'} · ${rest.reason}` : next ? `Coming: ${next.reason}` : 'Listening for the next entrance';
    $('#phrase-pause').classList.toggle('is-rest', Boolean(rest));
    const composition = shown.composition;
    if (composition) {
      section.style.setProperty('--theme-progress', percent(bounded((tick - composition.themeStartTick) / Math.max(1, composition.themeEndTick - composition.themeStartTick))));
      const cue = composition.cues.find(cue => tick >= cue.tick && tick < (cue.endTick ?? cue.tick + 120));
      const coming = composition.cues.find(cue => cue.tick > tick);
      $('#composition-cue-status').textContent = cue ? `Planned ${cue.kind} · cue strength ${percent(cue.strength)}` : coming ? `Next shared cue: ${coming.kind}` : composition.cadence === 'open' ? 'An open ending carries the thought onward.' : 'The phrase arrives before the next thought.';
      section.querySelectorAll<HTMLElement>('[data-cue-id]').forEach(marker => marker.classList.toggle('active', marker.dataset.cueId === cue?.id));
      section.querySelectorAll<HTMLElement>('[data-layer-id]').forEach(row => {
        const layer = composition.layers?.find(layer => layer.id === row.dataset.layerId);
        if (!layer) return;
        const phase = layerPhaseAt(layer, tick);
        const active = layer.active && tick >= layer.cycleStartTick && tick < layer.cycleEndTick;
        row.classList.toggle('active', active);
        const cycle = row.querySelector<HTMLElement>('.composition-cycle')!;
        cycle.style.setProperty('--cycle-phase', percent(phase));
        cycle.setAttribute('aria-valuenow', String(Math.round(phase * 100)));
        row.querySelector<HTMLElement>('.composition-layer-phase')!.textContent = `${active ? 'Participating cycle' : tick < layer.cycleStartTick ? 'Upcoming cycle' : tick >= layer.cycleEndTick ? 'Complete cycle' : 'Resting cycle'} · ${percent(phase)}`;
      });
      const transition = composition.transition;
      if (transition) {
        const active = tick >= transition.startTick && tick < transition.endTick;
        $('#composition-transition-status').textContent = `Planned ${transition.kind} · ${active ? 'now' : tick < transition.startTick ? 'coming' : 'window complete'} · ${transition.reason} change · ${percent(transition.energy)} energy. Shared breaks can shorten preparation.`;
        section.querySelector('.composition-transition')?.classList.toggle('active', active);
      }
    }
  }
  // Keep musical state current offscreen, but leave the score DOM alone until
  // it can be seen. Large hierarchy redraws must not compete with audio work.
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      visible = entry.isIntersecting;
      if (visible) { render(latestFrame); tick(latestTick); }
    }
  }, { rootMargin: '100px' });
  observer.observe(section);
  sync();
  return { update, tick, sync };
}
