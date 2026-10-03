import type { MusicalScene } from '../core/generated/MusicalScene';
import type { SceneNode } from '../core/generated/SceneNode';
import type { HarmonyWindow } from '../core/generated/HarmonyWindow';
import type { Score } from './score';

/** Navigation through codec nodes and their observed evidence; no inference. */
export function mountSceneInspector(host: HTMLElement, options: {
  select(node: SceneNode | undefined, noteId?: string, members?: readonly string[]): void;
  fit(): void;
  audition(): void;
  transpose(scope: 'material' | 'occurrence', target: string, millicents: number): Promise<void>;
  changeHarmony(windowId: string, rootMillicents: number, coreIntervals?: number[]): Promise<void>;
}) {
  let scene: MusicalScene | undefined, score: Score | undefined, decoded: Score | undefined, selected: SceneNode | undefined;
  let memberIds: readonly string[] = [];
  const nodes = new Map<string, SceneNode>(), buttons = new Map<string, HTMLButtonElement[]>(), labels = new Map<string, string>();
  host.innerHTML = `<div class="sw-scene-heading"><div><span class="eyebrow">MUSICAL SCENE</span><h2>Ideas, evidence, and executable parts</h2></div><p data-scene="status">Import a score to build its scene.</p></div>
    <div class="sw-scene-layout"><nav class="sw-scene-tree" data-scene="tree" aria-label="Musical scene hierarchy"></nav><section class="sw-scene-detail" aria-label="Selected scene node"><span class="sw-node-kind" data-scene="kind"></span><h3 data-scene="title">No node selected</h3><p data-scene="membership"></p><p data-scene="codec"></p><div class="sw-actions"><button class="button quiet" data-scene="fit" disabled>Fit node</button><button class="button quiet" data-scene="audition" disabled>Audition node</button></div>
      <div class="sw-scene-edit" data-scene="edit" hidden><label data-scene="scope-label">Change<select data-scene="edit-scope"><option value="occurrence">This occurrence</option><option value="material">Every use of this material</option></select></label><label><span data-scene="pitch-label">Pitch shift · semitones</span><input data-scene="semitones" type="number" step="0.01" value="0"/></label><label data-scene="interval-label" hidden>Palette intervals · semitones above root<input data-scene="intervals" type="text" spellcheck="false" placeholder="Comma-separated intervals"/></label><button class="button" data-scene="apply">Apply to program</button><p data-scene="edit-status">The compiler decodes the changed program. Original observations remain unchanged.</p></div>
      <div class="sw-harmony-evidence" data-scene="harmony" hidden></div><div class="sw-relation-evidence" data-scene="relations" hidden></div><ul class="sw-evidence" data-scene="evidence"></ul><dl class="sw-scene-parameters" data-scene="parameters"></dl><label class="sw-note-picker" data-scene="note-label" hidden>Inspect a member note<select data-scene="note"></select></label><div class="sw-note-evidence" data-scene="note-evidence"></div></section></div>
    <details class="sw-codec-limits"><summary>Codec accounting and interpretation limits</summary><dl data-scene="costs"></dl><div data-scene="limits"></div><details><summary>Recorded encoder settings · experimental</summary><dl data-scene="settings"></dl></details></details>`;
  const get = <T extends HTMLElement>(name: string) => host.querySelector<T>(`[data-scene="${name}"]`)!;
  const fmt = (value: number) => Number(value.toFixed(3));
  const human = (value: string) => value.replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const pitchLabel = (millicents: number) => {
    const key = millicents / 100000;
    return Number.isInteger(key) ? `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}` : `key ${key}`;
  };
  const harmonyWindow = () => scene?.harmony?.windows.find(window => window.id === selected?.id);
  const harmonyFrame = () => scene?.program.harmonies?.find(frame => frame.id === selected?.id);
  const editableIntervals = () => {
    const frame = harmonyFrame(), window = harmonyWindow();
    const coreCount = window && window.selected !== null ? window.alternatives[window.selected].coreIntervals.length : frame?.intervals.length ?? 0;
    return frame?.intervals.slice(0, coreCount) ?? [];
  };
  const noteLabel = (id: string) => { const note = score?.notes.find(item => item.id === id); return note && score ? `${pitchLabel(note.pitch.millicents)} at q${fmt(note.onset / score.ppq)}` : id; };
  const routeLabel = (id: string) => { const part = score?.notes.find(note => note.id === id)?.part; return score?.parts.find(item => item.id === part)?.name || part || id; };
  function renderRelations(noteId?: string): void {
    const target = get('relations'); target.replaceChildren();
    const members = new Set(selected?.noteIds), relations = scene?.pitchRelations.filter(relation => selected?.kind === 'elaboration'
      ? members.has(relation.noteId)
      : !!noteId && [relation.noteId, ...relation.fromNoteIds, ...relation.toNoteIds].includes(noteId)) ?? [];
    target.hidden = !relations.length; if (!relations.length) return;
    const summary = document.createElement('p'); summary.textContent = `${relations.filter(relation => relation.selected).length} note bindings selected from ${relations.length} candidate paths${selected?.kind === 'elaboration' ? ' for this component' : ' touching this note'}. Doubled notes can share a value path. Cyan anchors → amber dependent notes. The lattice is an observed pitch vocabulary; neither a confirmed key nor an established voice.`; target.append(summary);
    // Group identical explanations for display; every dependent stays selectable.
    const displayed = new Map<string, typeof relations>();
    for (const relation of relations) {
      const key = JSON.stringify([relation.kind, relation.lattice, relation.selected, relation.fromNoteIds, relation.toNoteIds]);
      const group = displayed.get(key) ?? []; group.push(relation); displayed.set(key, group);
    }
    const list = document.createElement('ul');
    for (const group of displayed.values()) {
      const relation = group[0];
      const item = document.createElement('li'), heading = document.createElement('strong'); heading.textContent = `${human(relation.kind)} · ${group.length} ${relation.selected ? 'executable' : 'candidate'} note ${group.length === 1 ? 'binding' : 'bindings'}`; item.append(heading);
      const roles = document.createElement('p');
      const witnesses = [...relation.fromNoteIds.map(id => [`From anchor${relation.fromNoteIds.length > 1 ? ` · ${routeLabel(id)}` : ''}`,id]), ...relation.toNoteIds.map(id => [`To anchor${relation.toNoteIds.length > 1 ? ` · ${routeLabel(id)}` : ''}`,id]), ...group.map(item => [`Dependent${group.length > 1 ? ` · ${routeLabel(item.noteId)}` : ''}`, item.noteId])];
      for (const [role, id] of witnesses) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sw-relation-note'; button.dataset.role = role.startsWith('Dependent') ? 'dependent' : 'anchor'; button.textContent = `${role}: ${noteLabel(id)}`; button.title = id;
        button.onclick = () => { if (memberIds.includes(id)) { get<HTMLSelectElement>('note').value = id; showNote(id); } else chooseNote(id); }; roles.append(button);
      }
      item.append(roles);
      const lattice = scene?.program.pitchLattices?.find(entry => entry.id === relation.lattice), premise = document.createElement('p');
      premise.textContent = lattice ? `Lattice ${lattice.id}: origin ${lattice.originMillicents / 100000} st, ordered intervals {${lattice.intervals.map(value => value / 100000).join(', ')}}, period ${lattice.periodMillicents / 100000} st. Shared by every binding referencing this lattice.` : `Lattice: ${relation.lattice}.`;
      item.append(premise);
      const details = document.createElement('details'), title = document.createElement('summary'); title.textContent = 'Evidence and assumptions'; details.append(title);
      for (const text of new Set(group.flatMap(item => item.evidence))) { const evidence = document.createElement('p'); evidence.textContent = text; details.append(evidence); }
      item.append(details);
      list.append(item);
    }
    target.append(list);
  }
  function renderMembers(ids: readonly string[], noteId?: string): void {
    if (!score) return;
    memberIds = ids;
    const select = get<HTMLSelectElement>('note'), notes = new Map(score.notes.map(note => [note.id, note])), fragment = document.createDocumentFragment();
    const multipleParts = new Set(ids.map(id => notes.get(id)?.part)).size > 1;
    for (const id of ids) { const note = notes.get(id); if (note) fragment.append(new Option(`q${fmt(note.onset / score.ppq)} · key ${fmt(note.pitch.millicents / 100000)}${multipleParts ? ` · ${routeLabel(id)}` : ''}`, id)); }
    select.replaceChildren(fragment); get('note-label').hidden = select.length === 0;
    if (noteId && ids.includes(noteId)) select.value = noteId;
    get<HTMLButtonElement>('audition').disabled = !ids.length;
    showNote(select.value, false);
    options.select(selected, noteId && ids.includes(noteId) ? noteId : undefined, ids);
  }
  function renderHarmony(window?: HarmonyWindow): void {
    const target = get('harmony'); target.replaceChildren(); target.hidden = !window;
    if (!window || !score) return;
    const currentScore = score, selectedHypothesis = window.selected === null ? undefined : window.alternatives[window.selected];
    const sourceNotes = new Map(score.notes.map(note => [note.id, note])), relations = new Map(window.roles.map(relation => [relation.noteId, relation]));
    const summary = document.createElement('p');
    summary.textContent = `Original source evidence · quarter positions ${fmt(window.startTick / score.ppq)}–${fmt(window.endTick / score.ppq)}. ${window.rest ? 'Rest window.' : selectedHypothesis ? `${selectedHypothesis.label} was the inferred realization.` : 'No chord selected; alternatives remain unresolved.'}${window.functionalRoot ? ` Functional-root proposal: pitch class ${fmt(window.functionalRoot.rootMillicents / 100000)} semitones, supported by the same bass and resolution in the next window.${window.functionalRoot.evidence.resolutionAlternativeIndex === undefined ? ' Resolution tones are observed.' : ' Some resolution tones are implied by the next selected chord; this proposal depends on that interpretation.'} Key is not inferred; this alone does not establish a cadence. Core and color intervals remain relative to the realization root.` : ''} ${scene?.programRevision ? 'Roles and hypotheses describe the original source, not a new analysis of the edited program.' : 'Role highlighting and audition stop at this window’s boundaries.'}`;
    const label = document.createElement('label'), roles = document.createElement('select');
    label.className = 'sw-harmony-role'; label.append('Highlight and audition ', roles); roles.setAttribute('aria-label', 'Harmonic note role');
    const memberships: Array<[string, readonly string[]]> = [['All notes', window.noteIds], ['Core', window.coreNoteIds], ['Color', window.colorNoteIds], ['Residual', window.residualNoteIds], ['Unsupported', window.unsupportedNoteIds], ['Percussion', window.percussionNoteIds]];
    memberships.forEach(([name, ids], index) => { const option = new Option(`${name} (${ids.length})`, String(index)); option.disabled = !ids.length && index !== 0; roles.add(option); });
    roles.onchange = () => renderMembers(memberships[Number(roles.value)][1]);
    const legend = document.createElement('p'); legend.className = 'sw-harmony-legend';
    for (const [role, text] of [['core', 'Core'], ['color', 'Color'], ['residual', 'Residual'], ['unsupported', 'Unsupported'], ['percussion', 'Percussion']]) { const item = document.createElement('span'); item.dataset.role = role; item.textContent = text; legend.append(item); }
    const alternatives = document.createElement('details'), alternativesTitle = document.createElement('summary'), list = document.createElement('ul');
    alternativesTitle.textContent = `Chord alternatives (${window.alternatives.length}) · model evidence`;
    for (const [index, hypothesis] of window.alternatives.entries()) {
      const item = document.createElement('li');
      item.textContent = `${index === window.selected ? 'Selected: ' : ''}${hypothesis.label} · root pitch class ${fmt(hypothesis.rootMillicents / 100000)} semitones · core {${hypothesis.coreIntervals.map(value => fmt(value / 100000)).join(', ')}} · observed color {${hypothesis.colorIntervals.map(value => fmt(value / 100000)).join(', ')}} · contextual cost ${hypothesis.contextualCost === null ? 'unavailable' : `+${fmt(hypothesis.contextualCost)}`}, local fit ${fmt(hypothesis.score)}, core coverage ${fmt(hypothesis.coreCoverage)}, core mass fraction ${fmt(hypothesis.coreMassFraction)}.`;
      list.append(item);
    }
    const caveat = document.createElement('p'); caveat.textContent = `Contextual cost compares complete chord sequences while retaining this window’s internal subdivisions; lower is better. Local fit uses only this window. Neither is a probability.${window.ambiguityGap === null ? '' : ` Contextual gap: ${fmt(window.ambiguityGap)}.`}${window.localAmbiguityGap === null ? '' : ` Local gap: ${fmt(window.localAmbiguityGap)}.`} Intervals describe pitch classes above the proposed root, not harmonic function.`;
    alternatives.append(alternativesTitle, list, caveat);
    const rhythm = document.createElement('details'), rhythmTitle = document.createElement('summary');
    rhythmTitle.textContent = `Rhythmic realization · ${window.rhythms.length} parts`; rhythm.append(rhythmTitle);
    const gaps = scene?.harmony?.rests.filter(rest => rest.startTick < window.endTick && rest.endTick > window.startTick) ?? [];
    const gapText = document.createElement('p');
    gapText.textContent = `Source gaps in held pitched notes: ${gaps.length} intersect this window, totaling ${fmt(gaps.reduce((total, gap) => total + Math.min(gap.endTick, window.endTick) - Math.max(gap.startTick, window.startTick), 0) / currentScore.ppq)} quarters inside it. These gaps remain separate from harmonic span boundaries; percussion is excluded.`;
    rhythm.append(gapText);
    let populated = false;
    rhythm.ontoggle = () => {
      if (!rhythm.open || populated) return; populated = true;
      const explanation = document.createElement('p'); explanation.textContent = 'Source attacks and durations are retained independently of chord roles. Negative offsets are notes carried into this window; overlap is the portion inside it. Equal attacks do not imply a melody order. Pitch names use a sharp-label display convention, not inferred spelling; fractional pitches retain their MIDI-key coordinate. Expand a pitch for its source ID.'; rhythm.append(explanation);
      for (const part of window.rhythms) {
        const section = document.createElement('details'), heading = document.createElement('summary'); heading.textContent = `${currentScore.parts.find(item => item.id === part.part)?.name || part.part} · ${part.notes.length} notes`; section.append(heading);
        const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody'); table.className = 'sw-rhythm-table';
        const row = document.createElement('tr'); for (const text of ['Pitch', 'Chord relation', 'Velocity', 'Attack offset', 'Duration', 'Overlap']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; row.append(th); } head.append(row);
        for (const note of part.notes) {
          const source = sourceNotes.get(note.noteId), relation = relations.get(note.noteId), row = document.createElement('tr'), pitch = document.createElement('td');
          const details = document.createElement('details'), title = document.createElement('summary'), identity = document.createElement('code');
          title.textContent = (source ? pitchLabel(source.pitch.millicents) : 'Unknown pitch') + (note.carriedIn ? ' · held in' : '');
          identity.textContent = note.noteId; details.append(title, identity); pitch.append(details); row.append(pitch);
          const role = relation ? `${relation.role}${relation.interval === null ? '' : ` · ${fmt(relation.interval / 100000)} st above root (PC)`}` : 'Unspecified';
          for (const text of [role, source ? `${source.velocity}/127` : 'Unknown', ...[note.onsetOffsetTicks, note.durationTicks, note.overlapTicks].map(tick => `${fmt(tick / currentScore.ppq)} q`)]) { const td = document.createElement('td'); td.textContent = text; row.append(td); }
          body.append(row);
        }
        table.append(head, body); const scroll = document.createElement('div'); scroll.className = 'sw-rhythm-scroll'; scroll.append(table); section.append(scroll); rhythm.append(section);
      }
    };
    target.append(summary, label, legend, alternatives, rhythm);
  }
  function showNote(id: string, notify = true): void {
    if (!score || !scene) return;
    const note = score.notes.find(item => item.id === id), cue = scene.noteWeights.find(item => item.noteId === id), target = get('note-evidence');
    target.replaceChildren(); if (!note) return;
    const add = (text: string) => { const line = document.createElement('p'); line.textContent = text; target.append(line); };
    add(`Original note · quarter position ${fmt(note.onset / score.ppq)} · MIDI-key coordinate ${fmt(note.pitch.millicents / 100000)} · duration ${fmt(note.duration / score.ppq)} quarters · attack velocity ${note.velocity}/127.`);
    const currentNote = decoded?.notes.find(item => item.id === id);
    if (scene.programRevision > 0 && currentNote) add(`Current program · ${pitchLabel(currentNote.pitch.millicents)} · MIDI-key coordinate ${fmt(currentNote.pitch.millicents / 100000)}${currentNote.pitch.millicents !== note.pitch.millicents ? ` · changed by ${fmt((currentNote.pitch.millicents - note.pitch.millicents) / 100000)} semitones` : ' · attack pitch unchanged'}. Native expression curves are decoded by the compiler.`);
    const window = harmonyWindow(), relation = window?.roles.find(item => item.noteId === id);
    if (window && relation) add(`This harmonic window: ${relation.role}${relation.interval === null ? '' : ` · relative pitch class ${fmt(relation.interval / 100000)} semitones (${relation.interval} millicents)`}. The role applies only inside the selected window.`);
    for (const dependency of scene.pitchRelations ?? []) {
      if (dependency.noteId === id) add(`${dependency.selected ? 'Executable dependent' : 'Candidate dependent'}: ${human(dependency.kind)} between ${dependency.fromNoteIds.map(noteLabel).join(' / ')} and ${dependency.toNoteIds.map(noteLabel).join(' / ')} in lattice ${dependency.lattice}.`);
      else if (dependency.fromNoteIds.includes(id) || dependency.toNoteIds.includes(id)) add(`${dependency.selected ? 'Executable anchor witness' : 'Candidate anchor witness'} for ${noteLabel(dependency.noteId)} · ${routeLabel(dependency.noteId)} (${human(dependency.kind)}, lattice ${dependency.lattice}).`);
    }
    if (cue) {
      add(`Partition weight ${fmt(cue.weight)}. Observed features: normalized velocity ${fmt(cue.velocity)}, duration ${fmt(cue.duration)}, quarter phase ${cue.quarterPhase}, notated accent ${cue.notatedAccent === null ? 'unknown' : fmt(cue.notatedAccent)}.`);
      add(`Co-release support context: ${cue.supportMembership === null ? 'unknown' : cue.supportMembership ? 'member' : 'non-member'}; support pitch-class relation: ${cue.supportPitchClass === null ? 'unknown' : cue.supportPitchClass ? 'matches' : 'does not match'}; interval above observed bass: ${cue.bassRelativeMillicents === null ? 'unknown' : `${cue.bassRelativeMillicents} millicents`}. This partition cue is separate from global harmony; observed bass is not necessarily a chord root.`);
    } else add('No weighted context was supplied for this note.');
    renderRelations(id);
    if (notify) options.select(selected, id, memberIds);
  }
  function chooseNote(id: string): void {
    const node = selected?.noteIds.includes(id) ? selected : scene?.nodes.filter(item => item.noteIds.includes(id)).sort((a, b) => a.noteIds.length - b.noteIds.length)[0];
    if (node) choose(node.id, id);
  }
  function choose(id: string, noteId?: string): void {
    selected = nodes.get(id); if (!selected || !score) return;
    for (const [key, values] of buttons) for (const button of values) button.setAttribute('aria-pressed', String(key === id));
    get('kind').textContent = human(selected.kind) + (scene?.origin === 'authored' ? ' · authored' : ['part', 'partition'].includes(selected.kind) ? '' : ' · source hypothesis');
    get('title').textContent = labels.get(id) ?? selected.label;
    get('membership').textContent = `${selected.noteIds.length} actual member notes · ${selected.children.length} child nodes. Enclosed background notes are not members.`;
    const frame = harmonyFrame();
    get('codec').textContent = frame ? `Executable harmonic palette: ${frame.id}. Rhythm, routing and exact voicing bindings remain separate.` : selected.materialId ? `Executable material: ${selected.materialId}${selected.placementPath ? ` · placement ${selected.placementPath}` : ''}.`
      : 'Evidence node. This interpretation does not emit a second copy of its notes.';
    get('edit').hidden = !selected.materialId && !frame;
    get('scope-label').hidden = !!frame; get('pitch-label').textContent = frame ? 'Harmony root shift · semitones' : 'Pitch shift · semitones';
    get('interval-label').hidden = !frame;
    const intervals = editableIntervals();
    get<HTMLInputElement>('intervals').value = intervals.map(value => value / 100000).join(', ');
    get<HTMLInputElement>('semitones').value = '0';
    get('apply').textContent = frame ? 'Apply harmony change' : 'Apply to program';
    get('edit-status').textContent = frame ? `Current program root ${frame.rootMillicents / 100000} semitones. Keep ${intervals.length} intervals in binding order; commas separate values. Bound attacks and executable dependencies follow the edit. The compiler validates and retains this program.` : 'The compiler changes the current program and retains its bindings. Original observations remain unchanged.';
    const scope = get<HTMLSelectElement>('edit-scope'); scope.options[0].disabled = !selected.placementPath; scope.value = selected.placementPath ? 'occurrence' : 'material';
    const evidence = document.createDocumentFragment();
    for (const text of selected.evidence) { const item = document.createElement('li'); item.textContent = text; evidence.append(item); }
    get('evidence').replaceChildren(evidence);
    renderHarmony(harmonyWindow());
    renderRelations();
    const parameters = document.createDocumentFragment();
    for (const parameter of scene?.regions.find(region => region.id === id)?.parameters ?? []) {
      const term = document.createElement('dt'), value = document.createElement('dd');
      term.textContent = parameter.label ?? human(parameter.key); value.append(document.createTextNode(parameter.displayValue ?? parameter.value));
      if (parameter.projection) { const projection = document.createElement('small'); projection.textContent = parameter.projection; value.append(projection); }
      if (parameter.displayValue && parameter.displayValue !== parameter.value) {
        const exact = document.createElement('details'), summary = document.createElement('summary'), code = document.createElement('code');
        summary.textContent = 'Exact encoded value'; code.textContent = parameter.value; exact.append(summary, code); value.append(exact);
      }
      parameters.append(term, value);
    }
    get('parameters').replaceChildren(parameters);
    get<HTMLButtonElement>('fit').disabled = !selected.noteIds.length && !harmonyWindow();
    renderMembers(selected.noteIds, noteId);
  }
  function branch(id: string, ancestors: Set<string>): HTMLLIElement {
    const item = document.createElement('li'), node = nodes.get(id); if (!node || ancestors.has(id)) return item;
    const row = document.createElement('div'), toggle = document.createElement('button'), select = document.createElement('button'), children = document.createElement('ul');
    row.className = 'sw-tree-row'; toggle.className = 'sw-tree-toggle'; select.className = 'sw-tree-node';
    toggle.type = select.type = 'button'; toggle.textContent = node.children.length ? '▸' : '·'; toggle.disabled = node.children.length === 0;
    const label = labels.get(id) ?? node.label;
    toggle.setAttribute('aria-label', `Expand ${label}`); toggle.setAttribute('aria-expanded', 'false'); children.hidden = true;
    select.textContent = label; select.title = `${human(node.kind)} · ${node.noteIds.length} notes`; select.setAttribute('aria-pressed', String(selected?.id === id));
    const values = buttons.get(id) ?? []; values.push(select); buttons.set(id, values);
    select.onclick = () => choose(id);
    let populated = false;
    toggle.onclick = () => {
      children.hidden = !children.hidden;
      if (!populated) { populated = true; const path = new Set(ancestors).add(id); node.children.forEach(child => children.append(branch(child, path))); }
      toggle.textContent = children.hidden ? '▸' : '▾'; toggle.setAttribute('aria-expanded', String(!children.hidden));
      toggle.setAttribute('aria-label', `${children.hidden ? 'Expand' : 'Collapse'} ${label}`);
    };
    row.append(toggle, select); item.append(row, children); return item;
  }
  get('fit').onclick = options.fit; get('audition').onclick = options.audition;
  get<HTMLSelectElement>('note').onchange = () => showNote(get<HTMLSelectElement>('note').value);
  get('apply').onclick = async () => {
    const originalSource = score;
    const frame = harmonyFrame(); if (!selected?.materialId && !frame) return;
    const scope = get<HTMLSelectElement>('edit-scope').value as 'material' | 'occurrence', target = scope === 'material' ? selected?.materialId : selected?.placementPath;
    const value = get<HTMLInputElement>('semitones').valueAsNumber, millicents = Math.round(value * 100000);
    if ((!target && !frame) || !Number.isFinite(value) || !Number.isSafeInteger(millicents) || (frame && !Number.isSafeInteger(frame.rootMillicents + millicents))) { get('edit-status').textContent = 'Enter a finite pitch shift that fits integer millicents.'; return; }
    const intervalText = get<HTMLInputElement>('intervals').value.trim(), coreIntervals = frame && intervalText ? intervalText.split(/[\s,]+/).filter(Boolean).map(token => Math.round(Number(token) * 100000)) : undefined;
    if (frame && (!coreIntervals?.length || coreIntervals.some(value => !Number.isSafeInteger(value)))) { get('edit-status').textContent = 'Enter core intervals as finite numbers separated by commas, in semitones above the root.'; return; }
    get<HTMLButtonElement>('apply').disabled = true; get('edit-status').textContent = 'Applying the executable change…';
    try { if (frame) await options.changeHarmony(frame.id, frame.rootMillicents + millicents, coreIntervals); else await options.transpose(scope, target!, millicents); if (score === originalSource) get('edit-status').textContent = 'Change applied to the retained program. The next edit starts from these parameters; original source evidence is unchanged.'; }
    catch (error) { if (score === originalSource) get('edit-status').textContent = `Change unavailable: ${error instanceof Error ? error.message : String(error)}`; }
    finally { get<HTMLButtonElement>('apply').disabled = false; }
  };
  return {
    setScene(value: Score, result?: MusicalScene, realization?: Score): void {
      const previousId = score === value ? selected?.id : undefined, previousNote = score === value ? get<HTMLSelectElement>('note').value : undefined;
      score = value; scene = result; decoded = realization; nodes.clear(); buttons.clear(); labels.clear(); selected = undefined; memberIds = [];
      get('tree').replaceChildren(); get('note-evidence').replaceChildren(); get('evidence').replaceChildren(); get('parameters').replaceChildren(); get('note-label').hidden = true;
      get('edit').hidden = true;
      renderHarmony();
      renderRelations();
      get('title').textContent = result ? 'Select a scene node' : 'Building the musical scene…';
      for (const name of ['kind', 'membership', 'codec']) get(name).textContent = '';
      get<HTMLButtonElement>('fit').disabled = get<HTMLButtonElement>('audition').disabled = true;
      get('costs').replaceChildren(); get('limits').replaceChildren(); get('settings').replaceChildren();
      if (!result) { get('status').textContent = 'The encoder observes the complete score. Pan and zoom only change the view.'; options.select(undefined); return; }
      const notes = new Map(value.notes.map(note => [note.id, note])), windows = new Map(result.harmony?.windows.map(window => [window.id, window]) ?? []);
      result.nodes.forEach(node => {
        nodes.set(node.id, node);
        if (node.kind === 'rhythm') { labels.set(node.id, `${node.label} · ${node.materialId ?? node.id}`); return; }
        let start = Infinity, end = -Infinity;
        for (const id of node.noteIds) { const note = notes.get(id); if (note) { start = Math.min(start, note.onset); end = Math.max(end, note.onset + note.duration); } }
        const window = windows.get(node.id); if (window) { start = window.startTick; end = window.endTick; }
        labels.set(node.id, node.label + (start === Infinity ? '' : ` · q${fmt(start / value.ppq)}–${fmt(end / value.ppq)}`));
      });
      const ordinaryRoots = result.roots.filter(id => !['rhythm', 'harmony'].includes(nodes.get(id)?.kind ?? '')), reusedRoots = result.roots.filter(id => nodes.get(id)?.kind === 'rhythm'), harmonyRoots = result.roots.filter(id => nodes.get(id)?.kind === 'harmony');
      const roots = document.createElement('ul'); ordinaryRoots.forEach(id => roots.append(branch(id, new Set()))); get('tree').append(roots);
      if (result.pitchRelations.length) {
        const disclosure = document.createElement('details'), summary = document.createElement('summary'); disclosure.className = 'sw-reused-roots';
        const selectedCount = result.pitchRelations.filter(relation => relation.selected).length;
        summary.textContent = `Pitch relationships (${selectedCount} selected / ${result.pitchRelations.length} candidates)`; disclosure.append(summary);
        let populated = false; disclosure.ontoggle = () => {
          if (!disclosure.open || populated) return; populated = true;
          const explanation = document.createElement('p'); explanation.className = 'sw-tree-explanation'; explanation.textContent = 'Browse existing executable groups and alternative hypotheses. This index does not add a musical parent or change ownership.'; disclosure.append(explanation);
          const owners = document.createElement('ul'); result.nodes.filter(node => node.kind === 'elaboration').forEach(node => owners.append(branch(node.id, new Set()))); disclosure.append(owners);
          const alternatives = new Map<string, number>();
          for (const relation of result.pitchRelations) if (!relation.selected) alternatives.set(relation.noteId, (alternatives.get(relation.noteId) ?? 0) + 1);
          if (alternatives.size) {
            const unselected = document.createElement('details'), label = document.createElement('summary'), list = document.createElement('ul'); unselected.className = 'sw-relation-alternatives'; label.textContent = `Unselected hypotheses · ${alternatives.size} dependent notes`; unselected.append(label, list);
            for (const [id, count] of alternatives) {
              const item = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'sw-tree-node'; button.textContent = `${noteLabel(id)} · ${count} ${count === 1 ? 'hypothesis' : 'hypotheses'}`; button.title = id; button.onclick = () => chooseNote(id); item.append(button); list.append(item);
            }
            disclosure.append(unselected);
          }
        };
        get('tree').append(disclosure);
      }
      for (const [title, groupedRoots] of [[result.origin === 'authored' ? 'Program palettes' : 'Source harmony sequence', harmonyRoots], ['Reused materials', reusedRoots]] as const) if (groupedRoots.length) {
        const disclosure = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ul');
        disclosure.className = 'sw-reused-roots'; summary.textContent = `${title} (${groupedRoots.length})`; disclosure.append(summary, list);
        let populated = false; disclosure.ontoggle = () => { if (disclosure.open && !populated) { populated = true; groupedRoots.forEach(id => list.append(branch(id, new Set()))); } };
        get('tree').append(disclosure);
      }
      get('status').textContent = `${result.origin === 'authored' ? 'Authored composition' : 'Inferred scene'} · program revision ${result.programRevision} · ${result.nodes.length} nodes.${result.programRevision ? ' Edits retain executable bindings; original evidence is unchanged.' : ' Select a palette or material to edit.'}`;
      const costs = document.createDocumentFragment();
      for (const [key, value] of Object.entries(result.costs)) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = human(key); detail.textContent = String(value); costs.append(term, detail); }
      get('costs').append(costs);
      const settings = document.createDocumentFragment();
      const addSettings = (data: unknown, path = ''): void => {
        if (data && typeof data === 'object' && !Array.isArray(data)) { for (const [key, child] of Object.entries(data)) addSettings(child, path ? `${path} · ${human(key)}` : human(key)); return; }
        const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = path; detail.textContent = typeof data === 'object' ? JSON.stringify(data) : String(data); settings.append(term, detail);
      };
      addSettings(result.parameters); get('settings').append(settings);
      const harmonyLimits = result.harmony ? [`Global harmony: ${result.harmony.offGridNoteIds.length} off-grid notes, ${result.harmony.unsupportedNoteIds.length} unsupported notes, ${result.harmony.percussionNoteIds.length} percussion notes. Exact source events are retained.`, ...result.harmony.diagnostics, ...result.harmony.limitations].map(text => `Harmony · ${text}`) : [];
      for (const text of [...result.limitations, ...harmonyLimits, ...result.issues.map(issue => `${issue.stage}${issue.part ? ` (${issue.part})` : ''}: ${issue.message}`)]) { const paragraph = document.createElement('p'); paragraph.textContent = text; get('limits').append(paragraph); }
      const first = previousId && nodes.has(previousId) ? previousId : ordinaryRoots[0] ?? harmonyRoots[0] ?? reusedRoots[0]; if (first) choose(first, previousNote);
    },
    selectNode(id: string): void { choose(id); },
    selectNote: chooseNote,
    selected: () => selected,
  };
}
