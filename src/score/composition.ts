import { callCoreSync } from '../core/sync';
import type { CompositionPlan } from '../core/generated/CompositionPlan';
import type { CompositionLimits } from '../core/generated/CompositionLimits';
export type { CompositionPlan } from '../core/generated/CompositionPlan';
export type { CompositionLimits } from '../core/generated/CompositionLimits';
export type { CompositionDefinition } from '../core/generated/CompositionDefinition';
export type { MaterialPlacement } from '../core/generated/MaterialPlacement';
export type { ScoreMaterial } from '../core/generated/ScoreMaterial';
export function compileComposition(plan: CompositionPlan, limits: CompositionLimits = {}) { return callCoreSync('compileComposition', { plan, limits }); }
