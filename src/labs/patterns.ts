import './patterns.css';
import type { CompositionPlan } from '../core/generated/CompositionPlan';
import type { PatternLabDefaults } from '../core/generated/PatternLabDefaults';
import type { PatternLabOptions } from '../core/generated/PatternLabOptions';
import type { PatternTime } from '../core/generated/PatternTime';
import type { LabSession } from './types';
import { mountScorePreview, type ScorePreviewResult } from './shared/score-preview';
import { createLiveUpdate } from './shared/live-update';
import { mountValueTreeEditor, type ValueTreeEditorState } from './value-tree-editor';

type PatternSource = 'trees' | 'program';
type PatternUpdate = { source: 'trees'; options: PatternLabOptions } | { source: 'program'; plan: CompositionPlan };
type AcceptedPattern = ScorePreviewResult & { plan: CompositionPlan; source: PatternSource };

interface PatternDraft {
  fields: Record<string, string>;
  trees: {
    degrees: ValueTreeEditorState<number>;
    durations: ValueTreeEditorState<PatternTime>;
    gates: ValueTreeEditorState<boolean>;
    offsets: ValueTreeEditorState<number>;
  };
  program: string;
  example: string;
  detailsOpen: boolean;
  programOpen: boolean;
  source: PatternSource;
}

/** This view edits Rust inputs and executable programs. All pattern operations,
 * pitch interpretation and note realization belong to the composition compiler. */
export function createSession(): LabSession {
  let defaults: PatternLabDefaults | undefined;
  let draft: PatternDraft | undefined;
  let accepted: AcceptedPattern | undefined;
  let audition: ScorePreviewResult | undefined, auditionVoice = '';
  let revision = 0;
  return {
    async mount(container, context) {
      const mountRevision = ++revision;
      let disposed = false, ready = false, auditionRequest = 0, downloadUrl: string | undefined;
      let source: PatternSource = draft?.source ?? 'trees';
      const active = () => !disposed && !context.signal.aborted && revision === mountRevision;
      context.onDispose(() => { disposed = true; auditionRequest++; revokeDownload(); });
      container.classList.add('patterns-lab');
      container.innerHTML = `
        <section class="panel patterns-compose">
          <form data-patterns="form" novalidate><fieldset data-patterns="fields" disabled>
            <legend class="patterns-sr-only">Pattern settings</legend>
            <div class="patterns-controls">
              <label title="Take this many values from each independent tree.">Steps<input name="steps" type="number" min="1" max="256" step="1" required/></label>
              <label title="Repeat the phrase, restarting each tree.">Repeats<input name="repeats" type="number" min="1" max="16" step="1" required/></label>
              <label title="Quarter notes per minute.">Tempo<input name="tempo" type="number" min="20" max="400" step="1" required/></label>
              <button class="button quiet" type="button" data-patterns="reset">Reset</button>
              <p class="patterns-status" data-patterns="status" role="status" aria-live="polite">Loading…</p>
            </div>
            <p class="patterns-reading">C Ionian · 0 = C · duration 1 = an eighth note · edits are live</p>
            <div class="patterns-trees">
              <div data-patterns="degree-tree"></div>
              <div data-patterns="duration-tree"></div>
            </div>
            <details class="patterns-settings" data-patterns="details"><summary>Sound / rest &amp; pitch offsets</summary><div class="patterns-extra-controls">
              <div data-patterns="gate-tree"></div>
              <div data-patterns="offset-tree"></div>
            </div></details>
          </fieldset></form>
        </section>
        <section class="patterns-audition"><div class="patterns-voice-picker" data-patterns="voice-picker" hidden><label>Listen to<select data-patterns="voice"><option value="">Full passage</option></select></label></div><div data-patterns="preview"></div></section>
        <details class="panel patterns-program" data-patterns="program-details"><summary>Program &amp; examples</summary><div class="patterns-program-body">
          <div class="patterns-example-controls"><label>Worked example<select data-patterns="example" disabled><option value="">Choose an example…</option></select></label></div>
          <p class="patterns-example-description" data-patterns="example-description">Choose an example to hear it immediately.</p>
          <label class="patterns-program-label" for="patterns-program">Composition program</label><textarea id="patterns-program" data-patterns="program" rows="18" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="patterns-program-help" disabled></textarea>
          <p id="patterns-program-help" class="patterns-program-help">Edits are live. Incomplete edits keep the last valid music. The last editor you change supplies the result: editing a tree replaces this program; program edits keep the tree draft separate.</p>
          <div class="patterns-actions"><button class="button" type="button" data-patterns="restore-program" disabled>Restore last valid</button><button class="button quiet" type="button" data-patterns="download-program" disabled>Download program</button></div>
        </div></details>`;
      const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-patterns="${name}"]`)!;
      const form = get<HTMLFormElement>('form'), fields = get<HTMLFieldSetElement>('fields');
      const editor = get<HTMLTextAreaElement>('program'), examples = get<HTMLSelectElement>('example');
      const voice = get<HTMLSelectElement>('voice');
      const details = get<HTMLDetailsElement>('details'), programDetails = get<HTMLDetailsElement>('program-details');
      const preview = mountScorePreview(get('preview'), context, 'continuum-patterns');
      const showStatus = (value: string, error = false) => {
        if (!active()) return;
        get('status').textContent = value; get('status').classList.toggle('lab-error', error);
      };
      const remember = () => {
        if (!ready) return;
        draft = {
          fields: Object.fromEntries(['steps', 'tempo', 'repeats'].map(name => [name, field(name)])),
          trees: { degrees: degreeTree.getState(), durations: durationTree.getState(), gates: gateTree.getState(), offsets: offsetTree.getState() },
          program: editor.value, example: examples.value, detailsOpen: details.open, programOpen: programDetails.open, source,
        };
      };
      const treeChanged = () => updateTrees();
      const arithmetic = [{ value: 'add' as const, label: 'Add' }, { value: 'multiply' as const, label: 'Multiply' }];
      const degreeTree = mountValueTreeEditor<number>(get('degree-tree'), {
        label: 'Degree tree', description: 'Values form a shape; nesting adds figures to that shape. Shared branches stay linked.', domain: 'degree',
        format: String, parse: value => integer(value, 'Degree'), defaultValue: () => 0, operations: arithmetic,
        onChange: treeChanged, signal: context.signal,
      });
      const durationTree = mountValueTreeEditor<PatternTime>(get('duration-tree'), {
        label: 'Duration tree', description: 'Independent durations, in eighth-note units. Fractions are exact; 2 holds twice as long as 1.', domain: 'duration',
        format: formatTime, parse: durationValue, defaultValue: () => ({ numerator: 1, denominator: 1 }), operations: [...arithmetic].reverse(),
        onChange: treeChanged, signal: context.signal,
      });
      const gateTree = mountValueTreeEditor<boolean>(get('gate-tree'), {
        label: 'Sound / rest tree', description: 'Each step sounds or rests without changing its duration or the position in the pitch tree.', domain: 'gate',
        format: value => value ? 'on' : 'off', parse: gateValue, defaultValue: () => true,
        operations: [{ value: 'all', label: 'All sound' }, { value: 'any', label: 'Any sound' }],
        onChange: treeChanged, signal: context.signal,
      });
      const offsetTree = mountValueTreeEditor<number>(get('offset-tree'), {
        label: 'Pitch offset tree', description: 'Native offsets after scale mapping: 100000 is one semitone; 50000 is a quarter tone.', domain: 'native',
        format: String, parse: value => integer(value, 'Native pitch offset'), defaultValue: () => 0, operations: arithmetic,
        onChange: treeChanged, signal: context.signal,
      });
      const treeEditors = [degreeTree, durationTree, gateTree, offsetTree];
      context.onDispose(() => { remember(); treeEditors.forEach(tree => tree.dispose()); });
      const button = (name: string) => get<HTMLButtonElement>(name);
      const onClick = (name: string, listener: () => void) => button(name).addEventListener('click', listener, { signal: context.signal });
      const renderExample = () => {
        const example = defaults?.examples.find(item => item.id === examples.value);
        get('example-description').textContent = example?.description ?? 'Choose an example to hear it immediately.';
      };
      const writeOptions = (options: PatternLabOptions) => {
        degreeTree.setProgram(options.degrees); durationTree.setProgram(options.durations);
        gateTree.setProgram(options.gates); offsetTree.setProgram(options.chromaticMillicents);
        const values = {
          steps: String(options.steps), tempo: String(options.tempo), repeats: String(options.repeats),
        };
        for (const [name, value] of Object.entries(values)) (form.elements.namedItem(name) as HTMLInputElement).value = value;
      };
      const readOptions = (): PatternLabOptions => ({
        degrees: degreeTree.getProgram(), durations: durationTree.getProgram(), gates: gateTree.getProgram(), chromaticMillicents: offsetTree.getProgram(),
        steps: phraseSteps(field('steps')), tempo: integer(field('tempo'), 'Tempo'), repeats: integer(field('repeats'), 'Repeats'),
      });
      function field(name: string): string { return (form.elements.namedItem(name) as HTMLInputElement).value; }
      function revokeDownload(): void { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = undefined; }
      function renderAccepted(): void {
        if (!accepted) return;
        const voices = accepted.plan.patterns?.voices ?? [];
        voice.replaceChildren();
        const all = document.createElement('option'); all.value = ''; all.textContent = 'Full passage'; voice.append(all);
        for (const item of voices) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.id; voice.append(option); }
        voice.value = auditionVoice; get('voice-picker').hidden = voices.length === 0 || (voices.length === 1 && accepted.plan.placements.length === 0);
        button('restore-program').disabled = false; button('download-program').disabled = false;
      }
      const updates = createLiveUpdate<PatternUpdate>({
        async run(input, isCurrent) {
          const current = () => active() && isCurrent();
          if (!current()) return;
          const plan = input.source === 'trees'
            ? await context.call('generatePatternLab', { options: input.options })
            : input.plan;
          if (!current()) return;
          const score = await context.call('compileComposition', { plan });
          if (!current()) return;
          const meter = await context.call('scoreMeter', { score });
          if (!current()) return;
          const result = { plan, score, meter, source: input.source };
          accepted = result;
          // JSON typing owns its text and caret; only a tree edit replaces it.
          if (input.source === 'trees') editor.value = JSON.stringify(plan, null, 2);
          remember();
          try { await refreshAudition(result); }
          catch (error) {
            if (!active() || accepted !== result) return;
            audition = undefined; auditionVoice = ''; renderAccepted();
            preview.setResult(result, { live: true });
            if (current()) showStatus(`Full passage updated; solo unavailable. ${message(error)}`, true);
            return;
          }
          if (current()) showStatus(`${input.source === 'trees' ? 'Trees' : 'Program'} live`);
        },
        onError: error => showStatus(`${accepted ? 'Last valid music retained. ' : ''}${message(error)}`, true),
      });
      context.onDispose(() => updates.dispose());
      function invalidDraft(error: unknown): void {
        updates.invalidate();
        showStatus(`${message(error)}${accepted ? ' Last valid music retained.' : ''}`, true);
      }
      function updateTrees(delayMs = 80): void {
        if (!active() || !ready) return;
        source = 'trees'; examples.value = ''; renderExample(); remember();
        if (!treeEditors.every(tree => tree.validate())) {
          invalidDraft('Finish the highlighted tree value.'); return;
        }
        const invalid = form.querySelector<HTMLInputElement>('input:invalid');
        if (invalid) { invalidDraft(invalid.validationMessage); return; }
        try {
          updates.request({ source, options: readOptions() }, delayMs);
          showStatus('Updating trees…');
        } catch (error) { invalidDraft(error); }
      }
      function updateProgram(delayMs = 80): void {
        if (!active() || !ready) return;
        source = 'program'; remember();
        try {
          const plan: unknown = JSON.parse(editor.value);
          if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) throw new Error('The program must be a JSON object.');
          updates.request({ source, plan: plan as CompositionPlan }, delayMs);
          showStatus('Updating program…');
        } catch (error) { invalidDraft(error); }
      }
      async function refreshAudition(result: AcceptedPattern): Promise<void> {
        const ticket = ++auditionRequest, selected = auditionVoice;
        const current = () => active() && ticket === auditionRequest && accepted === result;
        const patterns = result.plan.patterns, selectedVoice = patterns?.voices.find(item => item.id === selected);
        if (!patterns || !selectedVoice) {
          audition = undefined; auditionVoice = ''; renderAccepted();
          preview.setResult(result, { live: true }); return;
        }
        try {
          const plan: CompositionPlan = { ...result.plan, placements: [], patterns: { ...patterns, voices: [selectedVoice] } };
          const score = await context.call('compileComposition', { plan });
          if (!current()) return;
          const meter = await context.call('scoreMeter', { score });
          if (!current()) return;
          audition = { score, meter }; renderAccepted(); preview.setResult(audition, { live: true });
        } catch (error) { if (current()) throw error; }
      }
      async function selectVoice(): Promise<void> {
        if (!accepted) return;
        const result = accepted, previous = auditionVoice;
        auditionVoice = voice.value;
        const pending = refreshAudition(result), ticket = auditionRequest;
        try { await pending; }
        catch (error) {
          if (active() && ticket === auditionRequest && accepted === result) {
            auditionVoice = previous; voice.value = previous;
            showStatus(`Previous audition retained. ${message(error)}`, true);
          }
        }
      }
      form.addEventListener('input', () => updateTrees(), { signal: context.signal });
      form.addEventListener('submit', event => { event.preventDefault(); updateTrees(0); }, { signal: context.signal });
      editor.addEventListener('input', () => { examples.value = ''; renderExample(); updateProgram(); }, { signal: context.signal });
      examples.addEventListener('change', () => {
        renderExample();
        const example = defaults?.examples.find(item => item.id === examples.value); if (!example) return;
        editor.value = JSON.stringify(example.plan, null, 2); updateProgram(0);
      }, { signal: context.signal });
      voice.addEventListener('change', () => { void selectVoice(); }, { signal: context.signal });
      details.addEventListener('toggle', remember, { signal: context.signal });
      programDetails.addEventListener('toggle', remember, { signal: context.signal });
      onClick('reset', () => { if (!defaults) return; writeOptions(defaults.options); updateTrees(0); });
      onClick('restore-program', () => {
        if (!accepted) return;
        editor.value = JSON.stringify(accepted.plan, null, 2); examples.value = ''; renderExample(); updateProgram(0);
      });
      onClick('download-program', () => {
        if (!accepted) return;
        revokeDownload(); downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(accepted.plan, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = downloadUrl; link.download = 'continuum-patterns.json'; link.click();
      });
      if (accepted) { renderAccepted(); preview.setResult(audition ?? accepted); }
      try {
        const loaded = defaults ?? await context.call('getPatternLabDefaults', {});
        if (!active()) return;
        defaults = loaded; writeOptions(defaults.options);
        for (const example of defaults.examples) { const option = document.createElement('option'); option.value = example.id; option.textContent = example.title; examples.append(option); }
        if (draft) {
          for (const name of ['steps', 'tempo', 'repeats']) (form.elements.namedItem(name) as HTMLInputElement).value = draft.fields[name];
          degreeTree.setState(draft.trees.degrees); durationTree.setState(draft.trees.durations);
          gateTree.setState(draft.trees.gates); offsetTree.setState(draft.trees.offsets);
          editor.value = draft.program; examples.value = draft.example; details.open = draft.detailsOpen; programDetails.open = draft.programOpen;
        }
        ready = true; fields.disabled = false; editor.disabled = false; examples.disabled = false; renderExample();
        if (source === 'program') updateProgram(0); else updateTrees(0);
      } catch (error) { if (active()) showStatus(`Could not load pattern settings. ${message(error)}`, true); }
    },
  };
}

function integer(value: string, label: string): number {
  if (!/^-?\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) throw new Error(`${label} must contain whole numbers.`);
  return Number(value);
}
function phraseSteps(value: string): number {
  const steps = integer(value, 'Steps per phrase');
  if (steps < 1 || steps > 256) throw new Error('Steps per phrase must be between 1 and 256.');
  return steps;
}
function durationValue(value: string): PatternTime {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(value.trim());
  if (!match) throw new Error('Use a positive duration such as 2 or 1/3.');
  const numerator = integer(match[1], 'Duration numerator'), denominator = integer(match[2] ?? '1', 'Duration denominator');
  if (numerator <= 0 || denominator <= 0) throw new Error('Durations and denominators must be positive.');
  return { numerator, denominator };
}
function gateValue(value: string): boolean {
  if (value.trim().toLocaleLowerCase() === 'on' || value.trim().toLocaleLowerCase() === 'true') return true;
  if (value.trim().toLocaleLowerCase() === 'off' || value.trim().toLocaleLowerCase() === 'false') return false;
  throw new Error('Use on or off for the sound/rest value.');
}
function formatTime(time: PatternTime): string {
  return `${time.numerator}${time.denominator === 1 ? '' : `/${time.denominator}`}`;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
