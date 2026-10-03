import '../generators.css';
import type { CompositionPlan } from '../../core/generated/CompositionPlan';
import type { LabContext, LabSession } from '../types';
import { mountScorePreview, type ScorePreviewResult } from './score-preview';

interface GeneratorStudy<Options> {
  controls: string;
  action: string;
  filename: string;
  defaults(context: LabContext): Promise<Options>;
  write(form: HTMLFormElement, options: Options): void;
  read(form: HTMLFormElement, defaults: Options): Options;
  generate(context: LabContext, options: Options): Promise<CompositionPlan>;
}

/** Shared interaction for these two generator studies, not the lab host contract.
 * Sessions retain plain data; each mount owns fresh DOM and cancellable resources. */
export function createGeneratorStudy<Options>(study: GeneratorStudy<Options>): LabSession {
  let defaults: Options | undefined, draft: Record<string, string> | undefined;
  let accepted: ScorePreviewResult & { plan: CompositionPlan } | undefined;
  let revision = 0;
  return {
    async mount(container, context) {
      const mountRevision = ++revision;
      let disposed = false, generation = 0;
      context.onDispose(() => { disposed = true; generation++; });
      const active = () => !disposed && !context.signal.aborted && mountRevision === revision;
      container.classList.add('generator-lab');
      container.innerHTML = `<section class="panel generator-settings"><div class="generator-settings-heading"><p class="eyebrow">PARAMETERS</p><h2>Shape the idea</h2></div><form data-generator="form"><fieldset class="generator-fieldset" disabled><legend class="generator-sr-only">Generation settings</legend><div class="generator-fields">${study.controls}</div><div class="generator-submit"><button class="button primary" type="submit">${study.action}</button><span>Adjust, generate, listen.</span></div></fieldset></form><p class="generator-status" data-generator="status" role="status" aria-live="polite">Loading the musical core…</p></section><section data-generator="preview"></section>`;
      const form = container.querySelector<HTMLFormElement>('[data-generator="form"]')!;
      const fields = form.querySelector<HTMLFieldSetElement>('fieldset')!;
      const status = container.querySelector<HTMLElement>('[data-generator="status"]')!;
      const preview = mountScorePreview(container.querySelector<HTMLElement>('[data-generator="preview"]')!, context, study.filename);
      const showStatus = (text: string, error = false) => { if (active()) { status.textContent = text; status.classList.toggle('lab-error', error); } };
      const remember = () => { draft = Object.fromEntries(Array.from(form.querySelectorAll<HTMLInputElement>('input[name]'), input => [input.name, input.value])); };
      form.addEventListener('input', () => {
        remember(); generation++;
        showStatus(accepted ? 'Settings changed. Generate to update the result.' : 'Generate to hear these settings.');
      }, { signal: context.signal });
      form.addEventListener('submit', event => { event.preventDefault(); void generate(); }, { signal: context.signal });
      if (accepted) preview.setResult(accepted);
      async function generate(): Promise<void> {
        if (!active() || defaults === undefined || !form.reportValidity()) return;
        remember(); const ticket = ++generation; preview.pause();
        showStatus('Generating…');
        try {
          const options = study.read(form, defaults);
          const plan = await study.generate(context, options);
          if (!active() || ticket !== generation) return;
          const score = await context.call('compileComposition', { plan });
          if (!active() || ticket !== generation) return;
          const meter = await context.call('scoreMeter', { score });
          if (!active() || ticket !== generation) return;
          accepted = { plan, score, meter }; preview.setResult(accepted);
          showStatus('Ready. Play the result or change a parameter.');
        } catch (error) {
          if (active() && ticket === generation) showStatus(`${accepted ? 'Previous result retained. ' : ''}${message(error)}`, true);
        }
      }
      const loaded = defaults ?? await study.defaults(context);
      if (!active()) return;
      defaults = loaded; study.write(form, defaults);
      for (const input of form.querySelectorAll<HTMLInputElement>('input[name]')) if (draft && input.name in draft) input.value = draft[input.name];
      fields.disabled = false;
      if (accepted) showStatus('Your settings and last result are retained. Generate to apply changes.');
      else await generate();
    },
  };
}

export function numberField(form: HTMLFormElement, name: string): number {
  const field = form.elements.namedItem(name) as HTMLInputElement;
  const value = field.valueAsNumber;
  if (!Number.isFinite(value)) throw new Error(`Enter a number for ${field.labels?.[0]?.textContent?.trim() ?? name}.`);
  return value;
}

export function writeFields(form: HTMLFormElement, values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) (form.elements.namedItem(name) as HTMLInputElement).value = String(value);
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
