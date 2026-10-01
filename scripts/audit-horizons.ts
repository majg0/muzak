import { formAt, DEFAULT_CONDUCTOR } from '../src/conductor';
import { expressiveContourAt } from '../src/engine/expression';
import { PPQ } from '../src/types';

const config = { ...DEFAULT_CONDUCTOR, amount: 1 };
let cuts = 0, boundaries = 0, prepared = 0, total = 0, maxBoundary = 0;
const tuning: Record<string, number> = {};
let worst: { delta: number; seed?: string; tick?: number; key?: string; role?: string; contour?: string; bars?: number; meter?: unknown } = { delta: 0 };
const keys = ['energy', 'intensity', 'activity', 'register', 'ideaDensity', 'ensembleSize'] as const;
for (let index = 0; index < 48; index++) {
  const seed = `long-destination-${index}`, at = (tick: number) => formAt(seed, tick, config);
  for (let tick = 0, section = 0; section < 56; section++) {
    const form = at(tick); total++;
    if (form.sectionIndex > 0) { boundaries++; if (form.behavior!.entry === 'cut') cuts++; }
    if (form.behavior!.destinationSection! > form.sectionIndex) prepared++;
    tuning[form.tuning] = (tuning[form.tuning] ?? 0) + form.sectionEndTick - form.sectionStartTick;
    const next = at(form.sectionEndTick);
    if (next.behavior!.entry !== 'cut') {
      const before = expressiveContourAt(seed, form.sectionEndTick - 1, at), after = expressiveContourAt(seed, form.sectionEndTick, at);
      for (const key of keys) maxBoundary = Math.max(maxBoundary, Math.abs(before[key]! - after[key]!));
    }
    for (let now = tick; now + PPQ < form.sectionEndTick; now += PPQ / 4) {
      const before = expressiveContourAt(seed, now, at), after = expressiveContourAt(seed, now + PPQ, at);
      for (const key of keys) {
        const delta = Math.abs(before[key]! - after[key]!);
        if (delta > worst.delta) worst = { delta, seed, tick: now, key, role: form.role, contour: form.behavior!.contour,
          bars: (form.sectionEndTick - form.sectionStartTick) / form.barTicks, meter: form.meter };
      }
    }
    tick = form.sectionEndTick;
  }
}
const duration = Object.values(tuning).reduce((sum, value) => sum + value, 0);
console.log(JSON.stringify({ cuts, boundaries, cutRate: cuts / boundaries, prepared, total,
  tuningTimeFractions: Object.fromEntries(Object.entries(tuning).map(([key, value]) => [key, value / duration])),
  worstQuarterNoteChange: worst, maxFlowBoundaryDelta: maxBoundary }, null, 2));
