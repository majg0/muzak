import type { HarmonicDestination, MelodyAnchor } from './harmonic-tools';
/** Optional autonomous form intent. The manual engine omits this entirely. */
export interface PlanningIntent {
  /** A lyrical structural hold still advances time and diagnostics. */
  holdHarmony?: boolean;
  /** Explicit sentence-supporting native field; absent preserves the legacy search. */
  lyrical?: boolean;
  /** Phrase-authored semantic destination, distinct from its voice placement. */
  harmonicDestination?: HarmonicDestination;
  targetTension: number;
  tonalCenter12?: number;
  homeRoot?: number;
  homeThird?: 3 | 4;
  homeStrength?: number;
  /** Physical cents of important lead notes in the committed phrase plan.
   * Melodic compatibility is musical support, not sensory roughness. */
  melodyTargetsCents?: number[];
  melodyAnchors?: MelodyAnchor[];
  melodySupport?: number;
  /** Explicit native attraction degree for the bounded 19-EDO experiment. */
  centerDegree19?: number;
  /** Degree relative to A4 in the explicitly selected native tuning. */
  centerDegreeNative?: number;
}
