import './patterns.css';
import type { CompositionPlan } from '../core/generated/CompositionPlan';
import type { PatternLabDefaults } from '../core/generated/PatternLabDefaults';
import type { PatternLabOptions } from '../core/generated/PatternLabOptions';
import type { PatternTime } from '../core/generated/PatternTime';
import type { LabSession } from './types';
import { mountScorePreview, type ScorePreviewResult } from './shared/score-preview';

interface PatternDraft {
  fields: Record<string, string>;
  program: string;
  example: string;
  detailsOpen: boolean;
  programOpen: boolean;
}

/** This view edits Rust inputs and executable programs. All pattern operations,
 * pitch interpretation and note realization belong to the composition compiler. */
export function createSession(): LabSession {
  let defaults: PatternLabDefaults | undefined;
  let draft: PatternDraft | undefined;
  let accepted: (ScorePreviewResult & { plan: CompositionPlan; label: string }) | undefined;
  let audition: ScorePreviewResult | undefined, auditionVoice = '';
  let revision = 0;
  return {
    async mount(container, context) {
      const mountRevision = ++revision;
      let disposed = false, ready = false, request = 0, downloadUrl: string | undefined;
      const active = () => !disposed && !context.signal.aborted && revision === mountRevision;
      context.onDispose(() => { disposed = true; request++; revokeDownload(); });
      container.classList.add('patterns-lab');
      container.innerHTML = `
        <section class="panel patterns-compose">
          <div class="patterns-heading"><p class="eyebrow">A LINE FROM SHARED PATTERNS</p><h2>Outer shape. Inner figure. Independent rhythm.</h2><p>Place an inner figure at each outer degree. Let rhythm move on its own clock.</p></div>
          <form data-patterns="form"><fieldset data-patterns="fields" disabled>
            <legend class="patterns-sr-only">Pattern settings</legend>
            <div class="patterns-controls">
              <label><span><b>A</b> Outer degrees</span><input name="outer" type="text" spellcheck="false" required aria-describedby="patterns-outer-help"/><small id="patterns-outer-help">Offsets for successive placements of B.</small></label>
              <label><span><b>B</b> Inner degrees</span><input name="inner" type="text" spellcheck="false" required aria-describedby="patterns-inner-help"/><small id="patterns-inner-help">A shared figure, added to each outer offset.</small></label>
              <label><span><b>R</b> Duration pattern</span><input name="durations" type="text" spellcheck="false" required aria-describedby="patterns-rhythm-help"/><small id="patterns-rhythm-help">2,1 holds for two units, then one. Fractions such as 1/3 are exact.</small></label>
            </div>
            <p class="patterns-reading">C Ionian · degree zero is C · one unit is an eighth note. At each attack, rhythm reads the current pitch pattern; a long note holds that pitch. Durations and sound/rest choices are independent.</p>
            <details class="patterns-settings" data-patterns="details"><summary>Sound / rest, pitch offsets &amp; repetition</summary><div class="patterns-extra-controls">
              <label>Sound / rest mask<input name="gates" type="text" spellcheck="false" required/><small>Use on and off, one value per duration cell. The mask cycles independently; a rest keeps its duration. Numeric zero is never a rest instruction.</small></label>
              <label>Native pitch offsets<input name="chromaticMillicents" type="text" spellcheck="false" required/><small>An independent cycle added after scale mapping, in millicents. 100000 = one semitone; 50000 = a quarter tone.</small></label>
              <label>Tempo<input name="tempo" type="number" min="20" max="400" step="1" required/><small>Quarter notes per minute.</small></label>
              <label>Repeats<input name="repeats" type="number" min="1" max="16" step="1" required/><small>Repeat the complete outer × inner window.</small></label>
            </div></details>
            <div class="patterns-actions"><button class="button primary" type="submit">Generate line</button><button class="button quiet" type="button" data-patterns="reset">Reset patterns</button><span>Then press Play below.</span></div>
          </fieldset></form>
          <p class="patterns-status" data-patterns="status" role="status" aria-live="polite">Loading the musical core…</p>
        </section>
        <section class="patterns-audition"><div class="patterns-voice-picker" data-patterns="voice-picker" hidden><label>Listen to<select data-patterns="voice"><option value="">Full passage</option></select></label><p>Solo one authored voice, preserving its pitch and timing relationships.</p></div><div data-patterns="preview"></div></section>
        <details class="panel patterns-program" data-patterns="program-details"><summary>Compose with the full pattern algebra</summary><div class="patterns-program-body">
          <p>Shared definitions can nest, combine several patterns, gate subdivisions, layer voices, or repeat into an exact time window. The editable program below preserves these relationships.</p>
          <div class="patterns-example-controls"><label>Worked example<select data-patterns="example" disabled><option value="">Choose an example…</option></select></label><button class="button" type="button" data-patterns="load-example" disabled>Load into editor</button></div>
          <p class="patterns-example-description" data-patterns="example-description">Explore independent cycles, unequal subdivisions and shared edits.</p>
          <label class="patterns-program-label" for="patterns-program">Composition program</label><textarea id="patterns-program" data-patterns="program" rows="18" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="patterns-program-help" disabled></textarea>
          <p id="patterns-program-help" class="patterns-program-help">Apply to validate and hear this program. Invalid edits leave the last accepted result available. Generating from the simple controls replaces the editor with that new program.</p>
          <div class="patterns-actions"><button class="button primary" type="button" data-patterns="apply-program" disabled>Apply program</button><button class="button" type="button" data-patterns="restore-program" disabled>Restore last accepted</button><button class="button quiet" type="button" data-patterns="download-program" disabled>Download accepted program</button></div>
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
          fields: Object.fromEntries(Array.from(form.querySelectorAll<HTMLInputElement>('input[name]'), input => [input.name, input.value])),
          program: editor.value, example: examples.value, detailsOpen: details.open, programOpen: programDetails.open,
        };
      };
      const changed = (message: string) => { request++; preview.pause(); voice.value = auditionVoice; remember(); showStatus(message); };
      const button = (name: string) => get<HTMLButtonElement>(name);
      const onClick = (name: string, listener: () => void) => button(name).addEventListener('click', listener, { signal: context.signal });
      const renderExample = () => {
        const example = defaults?.examples.find(item => item.id === examples.value);
        get('example-description').textContent = example?.description ?? 'Explore independent cycles, unequal subdivisions and shared edits.';
        button('load-example').disabled = !example;
      };
      const writeOptions = (options: PatternLabOptions) => {
        const values = {
          outer: options.outer.join(', '), inner: options.inner.join(', '),
          durations: options.durations.map(formatTime).join(', '), gates: options.gates.map(value => value ? 'on' : 'off').join(', '), chromaticMillicents: options.chromaticMillicents.join(', '),
          tempo: String(options.tempo), repeats: String(options.repeats),
        };
        for (const [name, value] of Object.entries(values)) (form.elements.namedItem(name) as HTMLInputElement).value = value;
      };
      const readOptions = (): PatternLabOptions => ({
        outer: integerList(field('outer'), 'Outer degrees'), inner: integerList(field('inner'), 'Inner degrees'),
        durations: durationList(field('durations')), gates: gateList(field('gates')), chromaticMillicents: integerList(field('chromaticMillicents'), 'Native pitch offsets'),
        tempo: integer(field('tempo'), 'Tempo'), repeats: integer(field('repeats'), 'Repeats'),
      });
      function field(name: string): string { return (form.elements.namedItem(name) as HTMLInputElement).value; }
      function revokeDownload(): void { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = undefined; }
      function renderAccepted(): void {
        if (!accepted) return;
        preview.setResult(audition ?? accepted);
        const voices = accepted.plan.patterns?.voices ?? [];
        voice.replaceChildren();
        const all = document.createElement('option'); all.value = ''; all.textContent = 'Full passage'; voice.append(all);
        for (const item of voices) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.id; voice.append(option); }
        voice.value = auditionVoice; get('voice-picker').hidden = voices.length === 0 || (voices.length === 1 && accepted.plan.placements.length === 0);
        button('restore-program').disabled = false; button('download-program').disabled = false;
      }
      async function compile(plan: CompositionPlan, ticket: number, label: string): Promise<void> {
        if (!active() || ticket !== request) return;
        const score = await context.call('compileComposition', { plan });
        if (!active() || ticket !== request) return;
        const meter = await context.call('scoreMeter', { score });
        if (!active() || ticket !== request) return;
        accepted = { plan, score, meter, label };
        audition = undefined; auditionVoice = '';
        editor.value = JSON.stringify(plan, null, 2); remember(); renderAccepted();
        showStatus(`${label} ready. Play to hear it, or edit a shared pattern.`);
      }
      async function generate(): Promise<void> {
        if (!active() || !defaults) return;
        if (!form.checkValidity()) { if (details.querySelector(':invalid')) details.open = true; form.reportValidity(); return; }
        const ticket = ++request; preview.pause(); voice.value = auditionVoice; remember(); showStatus('Generating the pattern line…');
        try {
          const plan = await context.call('generatePatternLab', { options: readOptions() });
          await compile(plan, ticket, 'Pattern line');
        } catch (error) { if (active() && ticket === request) showStatus(`${accepted ? 'Previous result retained. ' : ''}${message(error)}`, true); }
      }
      async function applyProgram(): Promise<void> {
        const ticket = ++request; preview.pause(); voice.value = auditionVoice; remember(); showStatus('Validating and compiling the program…');
        try {
          const plan: unknown = JSON.parse(editor.value);
          if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) throw new Error('The composition program must be a JSON object.');
          await compile(plan as CompositionPlan, ticket, 'Edited program');
        } catch (error) { if (active() && ticket === request) showStatus(`${accepted ? 'Previous result retained. ' : ''}${message(error)}`, true); }
      }
      async function selectVoice(): Promise<void> {
        if (!accepted) return;
        const selected = voice.value, ticket = ++request;
        preview.pause();
        if (!selected) { audition = undefined; auditionVoice = ''; preview.setResult(accepted); showStatus('Full accepted passage restored.'); return; }
        const patterns = accepted.plan.patterns, selectedVoice = patterns?.voices.find(item => item.id === selected);
        if (!patterns || !selectedVoice) { voice.value = auditionVoice; return; }
        showStatus(`Preparing ${selected} alone…`);
        try {
          const plan: CompositionPlan = { ...accepted.plan, placements: [], patterns: { ...patterns, voices: [selectedVoice] } };
          const score = await context.call('compileComposition', { plan });
          if (!active() || ticket !== request) return;
          const meter = await context.call('scoreMeter', { score });
          if (!active() || ticket !== request) return;
          audition = { score, meter }; auditionVoice = selected; preview.setResult(audition);
          showStatus(`${selected} is ready alone. Choose Full passage to hear all parts together.`);
        } catch (error) {
          if (active() && ticket === request) { voice.value = auditionVoice; showStatus(`Previous audition retained. ${message(error)}`, true); }
        }
      }
      form.addEventListener('input', () => changed('Patterns changed. Generate the line to apply them.'), { signal: context.signal });
      form.addEventListener('submit', event => { event.preventDefault(); void generate(); }, { signal: context.signal });
      editor.addEventListener('input', () => changed('Program changed. Apply the program to validate and hear it.'), { signal: context.signal });
      examples.addEventListener('change', () => { changed('Choose Load into editor to inspect this example.'); renderExample(); }, { signal: context.signal });
      voice.addEventListener('change', () => { void selectVoice(); }, { signal: context.signal });
      details.addEventListener('toggle', remember, { signal: context.signal });
      programDetails.addEventListener('toggle', remember, { signal: context.signal });
      onClick('reset', () => { if (!defaults) return; writeOptions(defaults.options); changed('Patterns reset. Generating the default line…'); void generate(); });
      onClick('apply-program', () => { void applyProgram(); });
      onClick('load-example', () => {
        const example = defaults?.examples.find(item => item.id === examples.value); if (!example) return;
        editor.value = JSON.stringify(example.plan, null, 2); changed(`${example.title} loaded. Apply the program to hear it.`);
      });
      onClick('restore-program', () => {
        if (!accepted) return;
        editor.value = JSON.stringify(accepted.plan, null, 2); changed(`${accepted.label} restored in the editor. Your current audition is retained.`);
      });
      onClick('download-program', () => {
        if (!accepted) return;
        revokeDownload(); downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(accepted.plan, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = downloadUrl; link.download = 'continuum-patterns.json'; link.click();
      });
      if (accepted) renderAccepted();
      try {
        const loaded = defaults ?? await context.call('getPatternLabDefaults', {});
        if (!active()) return;
        defaults = loaded; writeOptions(defaults.options);
        for (const example of defaults.examples) { const option = document.createElement('option'); option.value = example.id; option.textContent = example.title; examples.append(option); }
        if (draft) {
          for (const input of form.querySelectorAll<HTMLInputElement>('input[name]')) if (input.name in draft.fields) input.value = draft.fields[input.name];
          editor.value = draft.program; examples.value = draft.example; details.open = draft.detailsOpen; programDetails.open = draft.programOpen;
        }
        ready = true; fields.disabled = false; editor.disabled = false; examples.disabled = false; button('apply-program').disabled = false; renderExample();
        if (accepted) showStatus(`Your draft and last accepted ${accepted.label.toLocaleLowerCase()} are retained.`);
        else if (draft?.program.trim()) showStatus('Your program draft is retained. Apply it to validate and hear it.');
        else await generate();
      } catch (error) { if (active()) showStatus(`Could not load pattern settings. ${message(error)}`, true); }
    },
  };
}

function tokens(value: string): string[] {
  const text = value.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  return text ? text.split(/[,\s]+/) : [];
}
function integer(value: string, label: string): number {
  if (!/^-?\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) throw new Error(`${label} must contain whole numbers.`);
  return Number(value);
}
function integerList(value: string, label: string): number[] {
  const values = tokens(value); if (!values.length) throw new Error(`${label} needs at least one value.`);
  return values.map(item => integer(item, label));
}
function durationList(value: string): PatternTime[] {
  const values = tokens(value); if (!values.length) throw new Error('The duration pattern needs at least one duration.');
  return values.map(item => {
    const match = /^(\d+)(?:\/(\d+))?$/.exec(item);
    if (!match) throw new Error('Use positive durations such as 2 or 1/3. Sound and rest choices belong in the separate mask.');
    const numerator = integer(match[1], 'Duration numerator'), denominator = integer(match[2] ?? '1', 'Duration denominator');
    if (numerator <= 0 || denominator <= 0) throw new Error('Durations and denominators must be positive. Numeric zero does not mean rest.');
    return { numerator, denominator };
  });
}
function gateList(value: string): boolean[] {
  const values = tokens(value); if (!values.length) throw new Error('The sound/rest mask needs at least one value.');
  return values.map(item => {
    if (item.toLocaleLowerCase() === 'on' || item.toLocaleLowerCase() === 'true') return true;
    if (item.toLocaleLowerCase() === 'off' || item.toLocaleLowerCase() === 'false') return false;
    throw new Error('Use on and off (or true and false) for the sound/rest mask. Numeric values belong to pitch or duration patterns.');
  });
}
function formatTime(time: PatternTime): string {
  return `${time.numerator}${time.denominator === 1 ? '' : `/${time.denominator}`}`;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
