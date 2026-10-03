import type { RhythmLabOptions } from '../core/generated/RhythmLabOptions';
import type { LabSession } from './types';
import { createGeneratorStudy, numberField, writeFields } from './shared/generator-study';

export function createSession(): LabSession {
  return createGeneratorStudy<RhythmLabOptions>({
    action: 'Generate rhythm', filename: 'continuum-rhythm',
    controls: `<label>Steps<input name="steps" type="number" min="1" max="128" step="1" required/></label><label>Pulses<input name="pulses" type="number" min="0" max="128" step="1" required/><span>Attacks distributed over the steps.</span></label><label>Rotation<input name="rotation" type="number" min="-2147483648" max="2147483647" step="1" required/><span>Positive values move attacks later.</span></label><label>Tempo<input name="tempo" type="number" min="20" max="400" step="1" required/><span>Quarter notes per minute</span></label><label>Repeats<input name="repeats" type="number" min="1" max="16" step="1" required/></label><fieldset class="generator-ratio"><legend>Step length · quarter notes</legend><label><span class="generator-sr-only">Step numerator</span><input name="stepNumerator" type="number" min="1" max="64" step="1" required/></label><span aria-hidden="true">/</span><label><span class="generator-sr-only">Step denominator</span><input name="stepDenominator" type="number" min="1" max="1024" step="1" required/></label></fieldset>`,
    defaults: async context => (await context.call('getLabDefaults', {})).rhythm,
    write: (form, options) => writeFields(form, { steps: options.steps, pulses: options.pulses, rotation: options.rotation, tempo: options.tempo, repeats: options.repeats, stepNumerator: options.step.numerator, stepDenominator: options.step.denominator }),
    read: (form, defaults) => ({ ...defaults, steps: numberField(form, 'steps'), pulses: numberField(form, 'pulses'), rotation: numberField(form, 'rotation'), tempo: numberField(form, 'tempo'), repeats: numberField(form, 'repeats'), step: { numerator: numberField(form, 'stepNumerator'), denominator: numberField(form, 'stepDenominator') } }),
    generate: (context, options) => context.call('generateRhythmLab', { options }),
  });
}
