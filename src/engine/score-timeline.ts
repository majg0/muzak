import { conductParameters, formAt, type FormState } from '../conductor';
import { evaluateAutomation } from '../parameters';
import { FRAME_TICKS, type AutomationLane, type EngineConfig, type Parameters } from '../types';
import { DEFAULT_SOUND } from '../spectrum';
import { resolveCompositionProfile, type CompositionProfile } from '../composition-profile';
import { compositionExpressionAt } from './composition-expression';
import { textureIntentAt, type TextureIntent } from './texture';
import { RhythmicScore } from './rhythmic-score';

type Expression = ReturnType<typeof compositionExpressionAt>['expression'];
interface ScoreMoment { parameters: Parameters; expression: Expression; texture: TextureIntent; }

/** The common musical clock. Form, expressive trajectories and user automation
 * meet here, before any part chooses notes. Automation is always the final
 * authority. Observing a future moment never advances a random stream. */
export class ScoreTimeline {
  readonly profile: CompositionProfile;
  private parameters: Parameters;
  private automation: AutomationLane[];
  private readonly forms = new Map<number, FormState>();
  private readonly moments = new Map<number, ScoreMoment>();
  private readonly seed: string;
  private readonly tuning: typeof DEFAULT_SOUND.tuning;
  private readonly rhythm: RhythmicScore;
  constructor(config: EngineConfig) {
    this.seed = String(config.seed);
    this.tuning = (config.sound ?? DEFAULT_SOUND).tuning;
    this.profile = resolveCompositionProfile(config);
    this.parameters = { ...config.parameters };
    this.automation = structuredClone(config.automation ?? []);
    this.rhythm = new RhythmicScore(this.seed, this.formAt, this.profile.phrasing.composition);
  }
  formAt = (tick: number): FormState => {
    let value = this.forms.get(tick);
    if (!value) {
      value = formAt(this.seed, tick, this.profile.conductor, this.tuning);
      this.forms.set(tick, value);
      if (this.forms.size > 512) this.forms.delete(this.forms.keys().next().value!);
    }
    return value;
  };
  at(tick: number): ScoreMoment {
    const cached = this.moments.get(tick);
    if (cached) return cached;
    const conducted = conductParameters(this.seed, tick, this.parameters, this.profile.conductor, this.tuning);
    const shaped = compositionExpressionAt(this.seed, tick, conducted, this.formAt, this.profile.phrasing.composition.dynamicRange);
    const parameters = evaluateAutomation(shaped.parameters, this.automation, tick);
    const texture = textureIntentAt(parameters, this.formAt(tick), shaped.expression);
    texture.rhythm = this.rhythm.at(tick, parameters, texture);
    const value = { parameters, expression: shaped.expression, texture };
    this.moments.set(tick, value);
    if (this.moments.size > 512) this.moments.delete(this.moments.keys().next().value!);
    return value;
  }
  parametersAt(index: number): Parameters { return this.at(index * FRAME_TICKS).parameters; }
  textureAt = (tick: number): TextureIntent => this.at(Math.max(0, tick)).texture;
  setParameters(parameters: Parameters): void { this.parameters = { ...parameters }; this.moments.clear(); }
  setAutomation(lanes: AutomationLane[]): void { this.automation = structuredClone(lanes); this.moments.clear(); }
}
