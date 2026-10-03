import type { MelodyLabOptions } from '../core/generated/MelodyLabOptions';
import type { LabSession } from './types';
import { createGeneratorStudy, numberField, writeFields } from './shared/generator-study';

export function createSession(): LabSession {
  return createGeneratorStudy<MelodyLabOptions>({
    action: 'Generate melody', filename: 'continuum-melody',
    controls: `<label>Seed<input name="seed" type="number" min="0" max="4294967295" step="1" required/><span>The same seed repeats the idea.</span></label><label>Notes per phrase<input name="notes" type="number" min="1" max="128" step="1" required/></label><label>Maximum degree step<input name="maxStep" type="number" min="0" max="32" step="1" required/></label><label>Tempo<input name="tempo" type="number" min="20" max="400" step="1" required/><span>Quarter notes per minute</span></label><label>Repeats<input name="repeats" type="number" min="1" max="16" step="1" required/></label>`,
    defaults: async context => (await context.call('getLabDefaults', {})).melody,
    write: (form, options) => writeFields(form, { seed: options.seed, notes: options.notes, maxStep: options.maxStep, tempo: options.tempo, repeats: options.repeats }),
    read: (form, defaults) => ({ ...defaults, seed: numberField(form, 'seed'), notes: numberField(form, 'notes'), maxStep: numberField(form, 'maxStep'), tempo: numberField(form, 'tempo'), repeats: numberField(form, 'repeats') }),
    generate: (context, options) => context.call('generateMelodyLab', { options }),
  });
}
