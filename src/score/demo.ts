import { callCoreSync } from '../core/sync';
export function demonstrationPlan() { return callCoreSync('demonstrationPlan', {}); }
export function demonstrationScore() { return callCoreSync('compileComposition', { plan: demonstrationPlan() }); }
