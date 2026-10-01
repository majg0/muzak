import { FRAME_TICKS, type Parameters } from '../types';
import type { TuningId } from '../pitch';
import type { HarmonyConfig } from '../harmonic-language';
import type { PhraseLayer } from './phrase';
import type { ScoreTimeline } from './score-timeline';
import { harmonicDestinationAt, harmonicVocabulary, planHarmonicRoute, type HarmonicRoute } from './harmonic-tools';
import { melodicAnchorsAt } from './melodic-anchors';
import type { PlanningIntent } from './intent';

/** Theme identity precedes harmonic reading; voicing realizes that reading.
 * This component owns only destinations, never audio, texture or note dressing. */
export class HarmonicDirector {
  private readonly routes = new Map<string, HarmonicRoute>();
  constructor(private readonly seed: string, private readonly language: HarmonyConfig,
    private readonly phrases: PhraseLayer, private readonly timeline: ScoreTimeline) {}

  routeAt(tick: number, tuning: TuningId): HarmonicRoute | undefined {
    const context = this.phrases.lyricalContextAt(tick);
    if (!context) return undefined;
    const id = `${context.themeId}:${context.startTick}:${tuning}`;
    let route = this.routes.get(id);
    if (!route) {
      const p = this.timeline.parametersAt(Math.floor(context.startTick / FRAME_TICKS));
      const expression = this.timeline.at(context.startTick).expression;
      const departure = Math.max(0, Math.min(1, this.language.harmonicColor * .55 + p.harmonicSurprise * .25
        + p.harmonicMobility * .2 + (expression.energy - .5) * .22));
      route = planHarmonicRoute({ seed: this.seed, phraseId: id, themeId: context.themeId,
        occurrence: context.occurrence, startTick: context.startTick, endTick: context.endTick,
        barTicks: this.timeline.formAt(context.startTick).barTicks, tuning,
        center: context.tonic, third: context.third, cadence: context.cadence,
        config: { ...this.language, harmonicColor: departure },
        plan: { scope: `harmony:${tuning}:${context.cadence}`, ordinal: context.harmonyOccurrence,
          vocabulary: harmonicVocabulary({ ...this.language, harmonicColor: departure }, context.cadence), maxRegret: .4 + departure * .35 },
        melodyTargetsAt: (at, duration) => this.phrases.harmonicTargets(at, duration),
        melodyAnchorsAt: (at, duration) => melodicAnchorsAt(context.core, at, duration),
      });
      this.routes.set(id, route);
      if (this.routes.size > 8) this.routes.delete(this.routes.keys().next().value!);
    }
    return route;
  }

  intentAt(index: number, parameters: Parameters, tuning: TuningId): PlanningIntent {
    const tick = index * FRAME_TICKS, context = this.phrases.lyricalContextAt(tick);
    const route = this.routeAt(tick, tuning), destination = route && harmonicDestinationAt(route, tick);
    // Never invent a future theme beyond the currently authored argument.
    return { targetTension: parameters.tension, lyrical: true, holdHarmony: !destination || tick !== destination.startTick,
      harmonicDestination: destination, homeThird: context?.third ?? 4,
      ...(tuning === '12tet' ? { tonalCenter12: destination?.region ?? context?.tonic }
        : { centerDegreeNative: destination?.region ?? context?.tonic }),
      melodyTargetsCents: destination ? this.phrases.harmonicTargets(destination.startTick, destination.endTick - destination.startTick) : [],
      melodyAnchors: destination ? melodicAnchorsAt(context?.core, destination.startTick, destination.endTick - destination.startTick) : [],
      melodySupport: .8,
    };
  }
}
