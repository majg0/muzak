//! Bass-supported root proposals with observed or explicitly inferred resolution.
//! This is a declared contextual prior, not a key/cadence classifier or a
//! probability. Proposals retain the realized core and the original hypothesis.
//! "Same bass" compares an explicitly selected bass observation per window;
//! it does not assert a continuously held pedal or identified melodic voices.
use crate::{
    error::{CoreResult, budget, invalid},
    harmony::HarmonyWindow,
    model::{MAX_SAFE, Score, ScoreNote, validate_score},
    operations::pitch_at,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
use ts_rs::TS;

const OCTAVE: i64 = 1_200_000;
const RESOLUTION: [i64; 3] = [0, 400_000, 700_000];

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum HarmonyBassPosition {
    #[default]
    FirstSounding,
    LowestSounding,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct HarmonyContextOptions {
    pub include_alternatives: bool,
    pub require_full_core: bool,
    pub bass_position: HarmonyBassPosition,
    /// Permit the next selected realization to supply unheard resolution tones.
    /// Its alternative index is retained separately from observed note evidence.
    pub allow_implied_resolution: bool,
    /// Maximum gap between consecutive predicted windows, in source ticks.
    pub max_gap_ticks: u64,
    /// None admits evidence throughout the immediate next predicted window.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_resolution_ticks: Option<u64>,
    /// None admits the first sounding bass anywhere inside its window.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bass_delay_ticks: Option<u64>,
    pub max_evidence_visits: usize,
    pub max_proposals: usize,
}
impl Default for HarmonyContextOptions {
    fn default() -> Self {
        Self {
            include_alternatives: true,
            require_full_core: false,
            bass_position: HarmonyBassPosition::default(),
            allow_implied_resolution: false,
            max_gap_ticks: 0,
            max_resolution_ticks: None,
            max_bass_delay_ticks: None,
            max_evidence_visits: 1_000_000,
            max_proposals: 20_000,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyResolutionEvidence {
    pub next_window_index: usize,
    pub bass_millicents: i64,
    pub current_bass_tick: u64,
    pub next_bass_tick: u64,
    pub current_bass_note_ids: Vec<String>,
    pub next_bass_note_ids: Vec<String>,
    pub resolution_note_ids: Vec<String>,
    pub observed_resolution_intervals: Vec<i64>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_alternative_index: Option<usize>,
    pub resolution_end_tick: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyFunctionalRoot {
    pub root_millicents: i64,
    pub realization_alternative_index: usize,
    pub evidence: HarmonyResolutionEvidence,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyContextProposal {
    pub window_index: usize,
    pub functional_root: HarmonyFunctionalRoot,
}
struct Observation<'a> {
    notes: Vec<&'a ScoreNote>,
    bass: Option<(i64, u64, Vec<String>)>,
    classes: BTreeSet<i64>,
    end_tick: u64,
}
fn eligible(note: &ScoreNote) -> bool {
    note.duration > 0
        && note.pitch.millicents % 100_000 == 0
        && note
            .pitch_envelope
            .as_ref()
            .is_none_or(|c| c.iter().all(|p| p.pitch == note.pitch))
}

/// Return alternatives; the caller owns acceptance and rebuilding note roles.
/// Inferred resolution tones retain their selected-realization dependency;
/// observed pitch-class support does not assert actual voice leading.
pub fn contextual_harmonic_roots(
    score: &Score,
    windows: &[HarmonyWindow],
    options: &HarmonyContextOptions,
) -> CoreResult<Vec<HarmonyContextProposal>> {
    validate_score(score)?;
    if options.max_gap_ticks > MAX_SAFE
        || options
            .max_resolution_ticks
            .is_some_and(|n| n == 0 || n > MAX_SAFE)
        || options.max_bass_delay_ticks.is_some_and(|n| n > MAX_SAFE)
        || options.max_evidence_visits == 0
        || options.max_evidence_visits > 20_000_000
        || options.max_proposals == 0
        || options.max_proposals > 1_000_000
    {
        return Err(invalid("Invalid harmonic context bounds."));
    }
    // A terminal instantaneous-only score has no pair of harmonic contexts.
    if windows.len() < 2 {
        return Ok(vec![]);
    }
    if windows
        .iter()
        .any(|w| w.start_tick >= w.end_tick || w.end_tick > score.duration)
        || windows.windows(2).any(|w| w[0].end_tick > w[1].start_tick)
    {
        return Err(invalid(
            "Harmonic context requires ordered nonoverlapping positive windows.",
        ));
    }
    if windows.len() > options.max_evidence_visits {
        return Err(budget("Harmonic context window budget exceeded."));
    }
    let percussion: HashSet<_> = score
        .parts
        .iter()
        .filter(|p| p.percussion)
        .map(|p| p.id.as_str())
        .collect();
    let mut notes: Vec<_> = score
        .notes
        .iter()
        .filter(|n| n.duration > 0 && !percussion.contains(n.part.as_str()))
        .collect();
    notes.sort_by_key(|n| (n.onset, n.pitch.millicents, n.duration, n.id.as_str()));
    let mut observations = vec![];
    let mut active: Vec<&ScoreNote> = vec![];
    let mut cursor = 0;
    let mut visits = windows.len();
    for window in windows {
        let end_tick = options
            .max_resolution_ticks
            .map(|limit| window.start_tick.saturating_add(limit).min(window.end_tick))
            .unwrap_or(window.end_tick);
        while cursor < notes.len() && notes[cursor].onset < window.end_tick {
            active.push(notes[cursor]);
            cursor += 1;
        }
        visits = visits
            .checked_add(active.len())
            .filter(|&n| n <= options.max_evidence_visits)
            .ok_or_else(|| budget("Harmonic context evidence visit budget exceeded."))?;
        active.retain(|n| n.onset + n.duration > window.start_tick);
        let members: Vec<_> = active
            .iter()
            .copied()
            .filter(|n| n.onset < end_tick)
            .collect();
        let first = members.iter().map(|n| n.onset.max(window.start_tick)).min();
        visits = members.iter().try_fold(visits, |count, note| {
            count
                .checked_add(note.pitch_envelope.as_ref().map_or(0, Vec::len))
                .filter(|&n| n <= options.max_evidence_visits)
                .ok_or_else(|| budget("Harmonic context trajectory budget exceeded."))
        })?;
        let bass = first.and_then(|first_tick| {
            let candidates: Vec<_> = members
                .iter()
                .copied()
                .filter(|n| {
                    matches!(options.bass_position, HarmonyBassPosition::LowestSounding)
                        || (n.onset <= first_tick && n.onset + n.duration > first_tick)
                })
                .collect();
            let low = candidates.iter().map(|n| n.pitch.millicents).min()?;
            let tick = candidates
                .iter()
                .filter(|n| n.pitch.millicents == low)
                .map(|n| n.onset.max(window.start_tick))
                .min()?;
            if options
                .max_bass_delay_ticks
                .is_some_and(|limit| tick - window.start_tick > limit)
            {
                return None;
            }
            if candidates
                .iter()
                .any(|n| n.pitch.millicents == low && !eligible(n))
            {
                return None;
            }
            // Attack pitch does not bound a moving trajectory. Unsupported
            // motion that reaches beneath the proposed bass stays a barrier.
            if candidates.iter().filter(|n| !eligible(n)).any(|n| {
                let from = if matches!(options.bass_position, HarmonyBassPosition::FirstSounding) {
                    first_tick - n.onset
                } else {
                    window.start_tick.saturating_sub(n.onset)
                };
                let to = if matches!(options.bass_position, HarmonyBassPosition::FirstSounding) {
                    from
                } else {
                    end_tick.min(n.onset + n.duration) - n.onset
                };
                pitch_at(n, from as f64) <= low as f64
                    || pitch_at(n, to as f64) < low as f64
                    || n.pitch_envelope
                        .iter()
                        .flatten()
                        .any(|p| p.tick >= from && p.tick < to && p.pitch.millicents <= low)
            }) {
                return None;
            }
            let ids = members
                .iter()
                .filter(|n| {
                    n.onset <= tick && n.onset + n.duration > tick && n.pitch.millicents == low
                })
                .map(|n| n.id.clone())
                .collect();
            Some((low.rem_euclid(OCTAVE), tick, ids))
        });
        let classes = members
            .iter()
            .filter(|n| eligible(n))
            .map(|n| n.pitch.millicents.rem_euclid(OCTAVE))
            .collect();
        observations.push(Observation {
            notes: members,
            bass,
            classes,
            end_tick,
        });
    }
    let mut proposals = vec![];
    for index in 0..windows.len().saturating_sub(1) {
        let (window, next) = (&windows[index], &windows[index + 1]);
        if window.rest || next.rest || next.start_tick - window.end_tick > options.max_gap_ticks {
            continue;
        }
        let (Some((bass, bass_tick, bass_ids)), Some((next_bass, next_tick, next_ids))) =
            (&observations[index].bass, &observations[index + 1].bass)
        else {
            continue;
        };
        if bass != next_bass {
            continue;
        }
        let observed_resolution_intervals: Vec<_> = RESOLUTION
            .iter()
            .copied()
            .filter(|interval| {
                observations[index + 1]
                    .classes
                    .contains(&((bass + interval).rem_euclid(OCTAVE)))
            })
            .collect();
        let resolution_alternative_index =
            if observed_resolution_intervals.len() == RESOLUTION.len() {
                None
            } else if options.allow_implied_resolution {
                next.selected.filter(|&i| {
                    next.alternatives.get(i).is_some_and(|h| {
                        h.root_millicents == *bass
                            && RESOLUTION.iter().all(|p| h.core_intervals.contains(p))
                    })
                })
            } else {
                None
            };
        if observed_resolution_intervals.len() != RESOLUTION.len()
            && resolution_alternative_index.is_none()
        {
            continue;
        }
        let mut candidates = vec![];
        for (alternative_index, h) in window.alternatives.iter().enumerate() {
            if (!options.include_alternatives && window.selected != Some(alternative_index))
                || (options.require_full_core && h.core_coverage < 1.0)
            {
                continue;
            }
            let mut relative: Vec<_> = h
                .core_intervals
                .iter()
                .map(|p| (h.root_millicents + p - bass).rem_euclid(OCTAVE))
                .collect();
            relative.sort_unstable();
            if relative == [0, 500_000, 900_000] || relative == [0, 500_000, 800_000] {
                candidates.push((alternative_index, relative));
            }
        }
        let shapes: BTreeSet<_> = candidates.iter().map(|(_, shape)| shape.clone()).collect();
        if shapes.len() != 1 {
            continue;
        }
        // Equal-shape alternatives yield the same value proposal; retain the
        // first existing model rank as provenance, never a reference choice.
        let Some((alternative_index, _)) = candidates.into_iter().next() else {
            continue;
        };
        if proposals.len() >= options.max_proposals {
            return Err(budget("Harmonic context proposal budget exceeded."));
        }
        let resolution_note_ids = observations[index + 1]
            .notes
            .iter()
            .filter(|n| {
                eligible(n) && RESOLUTION.contains(&(n.pitch.millicents - bass).rem_euclid(OCTAVE))
            })
            .map(|n| n.id.clone())
            .collect();
        proposals.push(HarmonyContextProposal {
            window_index: index,
            functional_root: HarmonyFunctionalRoot {
                root_millicents: *bass,
                realization_alternative_index: alternative_index,
                evidence: HarmonyResolutionEvidence {
                    next_window_index: index + 1,
                    bass_millicents: *bass,
                    current_bass_tick: *bass_tick,
                    next_bass_tick: *next_tick,
                    current_bass_note_ids: bass_ids.clone(),
                    next_bass_note_ids: next_ids.clone(),
                    resolution_note_ids,
                    observed_resolution_intervals,
                    resolution_alternative_index,
                    resolution_end_tick: observations[index + 1].end_tick,
                },
            },
        });
    }
    Ok(proposals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        harmony::HarmonyHypothesis,
        model::{Pitch, ScorePart},
    };
    fn fixture() -> (Score, Vec<HarmonyWindow>) {
        let notes = [55, 60, 64, 55, 59, 62]
            .iter()
            .enumerate()
            .map(|(i, &p)| ScoreNote {
                id: format!("n{i}"),
                part: "p".into(),
                onset: if i < 3 { 0 } else { 4 },
                duration: 4,
                pitch: Pitch {
                    millicents: p * 100_000,
                },
                velocity: 80,
                release_velocity: 64,
                pitch_envelope: None,
                gain_envelope: None,
                source: None,
            })
            .collect();
        let score = Score {
            ppq: 4,
            duration: 8,
            midi_format: None,
            parts: vec![ScorePart {
                id: "p".into(),
                name: "".into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            notes,
            attachments: vec![],
            track_ends: vec![8],
        };
        let windows = (0..2)
            .map(|i| HarmonyWindow {
                id: format!("w{i}"),
                start_tick: i * 4,
                end_tick: i * 4 + 4,
                label: "".into(),
                rest: false,
                note_ids: vec![],
                core_note_ids: vec![],
                color_note_ids: vec![],
                residual_note_ids: vec![],
                unsupported_note_ids: vec![],
                percussion_note_ids: vec![],
                alternatives: vec![HarmonyHypothesis {
                    root_millicents: if i == 0 { 0 } else { 700_000 },
                    template_id: "major".into(),
                    label: "major".into(),
                    core_intervals: vec![0, 400_000, 700_000],
                    color_intervals: vec![],
                    score: 0.0,
                    core_coverage: 1.0,
                    core_mass_fraction: 1.0,
                    contextual_cost: None,
                }],
                selected: Some(0),
                functional_root: None,
                ambiguity_gap: None,
                local_ambiguity_gap: None,
                roles: vec![],
                rhythms: vec![],
            })
            .collect();
        (score, windows)
    }
    #[test]
    fn same_bass_resolution_proposes_root_without_changing_realized_core() {
        let (score, windows) = fixture();
        let before = serde_json::to_string(&windows).unwrap();
        let p = contextual_harmonic_roots(&score, &windows, &Default::default()).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].functional_root.root_millicents, 700_000);
        assert_eq!(p[0].functional_root.realization_alternative_index, 0);
        assert_eq!(serde_json::to_string(&windows).unwrap(), before);
    }
    #[test]
    fn changing_bass_or_missing_resolution_cannot_manufacture_context() {
        let (mut score, windows) = fixture();
        score.notes[3].pitch.millicents = 5_300_000;
        assert!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .is_empty()
        );
        score.notes[3].pitch.millicents = 5_500_000;
        score.notes[4].pitch.millicents = 6_000_000;
        assert!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .is_empty()
        );
        score.notes[4].pitch.millicents = 5_900_000;
        score.notes[3].pitch.millicents += 1; // Unsupported bass cannot be erased.
        assert!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn time_bounds_and_resource_limits_are_explicit() {
        let (mut score, windows) = fixture();
        score.notes[4].onset = 6;
        score.notes[4].duration = 2;
        assert_eq!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .len(),
            1
        );
        assert!(
            contextual_harmonic_roots(
                &score,
                &windows,
                &HarmonyContextOptions {
                    max_resolution_ticks: Some(2),
                    ..Default::default()
                }
            )
            .unwrap()
            .is_empty()
        );
        assert_eq!(
            contextual_harmonic_roots(
                &score,
                &windows,
                &HarmonyContextOptions {
                    max_evidence_visits: 1,
                    ..Default::default()
                }
            )
            .unwrap_err()
            .code,
            "budget-exceeded"
        );
    }
    #[test]
    fn broken_chord_bass_has_exact_witnesses_and_obeys_bounds() {
        let (mut score, windows) = fixture();
        for i in [0, 3] {
            score.notes[i].onset += 1;
            score.notes[i].duration -= 1;
        }
        assert!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .is_empty()
        );
        let mut options = HarmonyContextOptions {
            bass_position: HarmonyBassPosition::LowestSounding,
            ..Default::default()
        };
        let proposals = contextual_harmonic_roots(&score, &windows, &options).unwrap();
        assert_eq!(proposals.len(), 1);
        let evidence = &proposals[0].functional_root.evidence;
        assert_eq!(
            (evidence.current_bass_tick, evidence.next_bass_tick),
            (1, 5)
        );
        assert_eq!(evidence.current_bass_note_ids, ["n0"]);
        assert_eq!(evidence.next_bass_note_ids, ["n3"]);
        options.max_bass_delay_ticks = Some(0);
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
        options.max_bass_delay_ticks = None;
        options.max_resolution_ticks = Some(1);
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
        options.max_resolution_ticks = None;
        score.notes[0].pitch.millicents += 1;
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn bass_geometry_is_transposition_and_note_order_equivariant() {
        let (mut score, mut windows) = fixture();
        let options = HarmonyContextOptions {
            bass_position: HarmonyBassPosition::LowestSounding,
            ..Default::default()
        };
        for note in &mut score.notes {
            note.pitch.millicents += 300_000;
        }
        for window in &mut windows {
            for hypothesis in &mut window.alternatives {
                hypothesis.root_millicents =
                    (hypothesis.root_millicents + 300_000).rem_euclid(OCTAVE);
            }
        }
        score.notes.reverse();
        let proposals = contextual_harmonic_roots(&score, &windows, &options).unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].functional_root.root_millicents, 1_000_000);
        // A root-position tonic cannot become a resolving six-four just because
        // another chord follows; the actual lowest register matters.
        score
            .notes
            .iter_mut()
            .find(|n| n.id == "n1")
            .unwrap()
            .pitch
            .millicents -= OCTAVE;
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn moving_upper_note_cannot_hide_a_lower_pitch_in_the_evidence_horizon() {
        use crate::model::PitchEnvelopePoint;
        let (mut score, windows) = fixture();
        let mut curve = score.notes[1].clone();
        curve.id = "moving".into();
        curve.pitch.millicents = 7_200_000;
        curve.pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: curve.pitch,
            },
            PitchEnvelopePoint {
                tick: 2,
                pitch: Pitch {
                    millicents: 3_600_000,
                },
            },
            PitchEnvelopePoint {
                tick: 4,
                pitch: curve.pitch,
            },
        ]);
        score.notes.push(curve);
        assert_eq!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .len(),
            1
        );
        let options = HarmonyContextOptions {
            bass_position: HarmonyBassPosition::LowestSounding,
            ..Default::default()
        };
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
        // Interpolated crossings count even when no knot lies in the window.
        let mut shifted = windows.clone();
        shifted[0].start_tick = 1;
        assert!(
            contextual_harmonic_roots(&score, &shifted, &Default::default())
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn selected_only_ablation_and_competing_qualities_abstain() {
        let (score, mut windows) = fixture();
        windows[0].selected = None;
        assert!(
            contextual_harmonic_roots(
                &score,
                &windows,
                &HarmonyContextOptions {
                    include_alternatives: false,
                    ..Default::default()
                }
            )
            .unwrap()
            .is_empty()
        );
        let options = HarmonyContextOptions {
            include_alternatives: true,
            ..Default::default()
        };
        assert_eq!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .len(),
            1
        );
        let mut minor = windows[0].alternatives[0].clone();
        minor.core_intervals = vec![0, 300_000, 700_000];
        windows[0].alternatives.push(minor);
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn implied_resolution_requires_an_explicit_selected_realization_dependency() {
        let (mut score, mut windows) = fixture();
        score.notes.retain(|n| n.id != "n4"); // G-D remains; B is implied only.
        assert!(
            contextual_harmonic_roots(&score, &windows, &Default::default())
                .unwrap()
                .is_empty()
        );
        let options = HarmonyContextOptions {
            allow_implied_resolution: true,
            ..Default::default()
        };
        let proposals = contextual_harmonic_roots(&score, &windows, &options).unwrap();
        assert_eq!(proposals.len(), 1);
        let evidence = &proposals[0].functional_root.evidence;
        assert_eq!(evidence.observed_resolution_intervals, [0, 700_000]);
        assert_eq!(evidence.resolution_note_ids, ["n3", "n5"]);
        assert_eq!(evidence.resolution_alternative_index, Some(0));
        windows[1].selected = None;
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
        windows[1].selected = Some(0);
        windows[1].alternatives[0].core_intervals = vec![0, 300_000, 700_000];
        assert!(
            contextual_harmonic_roots(&score, &windows, &options)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn integrated_functional_root_keeps_realization_roles_and_scene_exact() {
        use crate::{
            harmony::{HarmonyNoteRole, HarmonyOptions, infer_global_harmony},
            scene::{SceneOptions, decode_scene, encode_score},
        };
        let (score, _) = fixture();
        let baseline = infer_global_harmony(
            &score,
            &HarmonyOptions {
                context: None,
                ..Default::default()
            },
        )
        .unwrap();
        let interpreted = infer_global_harmony(&score, &Default::default()).unwrap();
        assert_eq!(baseline.windows.len(), interpreted.windows.len());
        let (index, window) = interpreted
            .windows
            .iter()
            .enumerate()
            .find(|(_, w)| w.functional_root.is_some())
            .expect("Generic resolving inversion should admit contextual root");
        let functional = window.functional_root.as_ref().unwrap();
        assert_eq!(
            window.selected,
            Some(functional.realization_alternative_index)
        );
        assert!((0..OCTAVE).contains(&functional.root_millicents));
        let realization = &window.alternatives[functional.realization_alternative_index];
        let original =
            &baseline.windows[index].alternatives[functional.realization_alternative_index];
        assert_eq!(realization.root_millicents, original.root_millicents);
        assert_eq!(realization.core_intervals, original.core_intervals);
        for role in &window.roles {
            if matches!(role.role, HarmonyNoteRole::Core | HarmonyNoteRole::Color) {
                let note = score.notes.iter().find(|n| n.id == role.note_id).unwrap();
                let interval =
                    (note.pitch.millicents - realization.root_millicents).rem_euclid(OCTAVE);
                assert_eq!(role.interval, Some(interval));
                if role.role == HarmonyNoteRole::Core {
                    assert!(realization.core_intervals.contains(&interval));
                } else {
                    assert!(realization.color_intervals.contains(&interval));
                }
            }
        }
        let scene = encode_score(&score, &SceneOptions::default()).unwrap();
        assert_eq!(decode_scene(&scene).unwrap(), score);
    }
}
