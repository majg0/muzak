//! Authored parts composed from registered member correspondences across a
//! complete phrase. These are explicit candidate lines, not recovered voices.
use crate::{
    error::{CoreResult, invalid},
    harmonic_connection::{
        ConnectionMemberLink, ConnectionMovement, ConnectionWeights, pair_metrics,
        validate_pitches, validate_weights,
    },
    harmonic_motion::{MotionChord, MotionDuration, MotionStep},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub const DEFAULT_CONTINUITY_WEIGHT: f64 = 0.08;
const HUNDRED_CENTS: f64 = 100_000.0;
const MAX_STEPS: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicLinePoint {
    pub step_index: usize,
    pub member_index: usize,
    pub pitch_millicents: i64,
    /// Display projection of the authored harmonic slot's onset. This is not
    /// the performed onset of an arpeggiated member; exact slot durations remain
    /// in the input history and each point below.
    pub onset_quarters: f64,
    /// Exact authored harmonic slot span, not a performed note's gate duration.
    pub duration: MotionDuration,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicLine {
    /// Local candidate-part identity, independent from pitch equality or rank.
    pub id: String,
    pub points: Vec<HarmonicLinePoint>,
    /// Consecutive signed, registered steps; no pitch-class or octave wrapping.
    pub steps_millicents: Vec<i64>,
    pub total_motion_millicents: i64,
    pub max_motion_millicents: i64,
    pub range_millicents: i64,
    /// Descriptive reversals of nonzero motion; held notes preserve direction.
    pub direction_reversal_count: usize,
    /// Squared change in successive signed step sizes, in 100-cent units.
    /// This is a discrete phrase preference, not physical acceleration.
    pub squared_step_change_100_cent_units: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicLineBoundary {
    pub from_step_index: usize,
    pub to_step_index: usize,
    /// Indexed assignment multiplicity from the pairwise minimum-prefix DP;
    /// this is not an exhaustive count of globally optimal phrase identities.
    pub optimal_correspondence_count: u64,
    pub links: Vec<ConnectionMemberLink>,
    pub arrivals: Vec<usize>,
    pub departures: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicLinesAnalysis {
    pub lines: Vec<HarmonicLine>,
    pub boundaries: Vec<HarmonicLineBoundary>,
    pub continuity_weight: f64,
    pub continuity_cost: f64,
    pub explanation: String,
}

fn validate_voicings(voicings: &[Vec<i64>], weights: &ConnectionWeights) -> CoreResult<()> {
    validate_weights(weights)?;
    if voicings.len() > MAX_STEPS {
        return Err(invalid("Harmonic lines admit at most 128 authored steps."));
    }
    for pitches in voicings {
        validate_pitches(pitches)?;
    }
    Ok(())
}

fn validate_strength(strength: f64) -> CoreResult<()> {
    if !strength.is_finite() || !(0.0..=100.0).contains(&strength) {
        return Err(invalid("Continuity strength must be finite and in 0–100."));
    }
    Ok(())
}

/// Scoring and display deliberately share these exact correspondence choices.
fn registered_boundaries(
    voicings: &[Vec<i64>],
    weights: &ConnectionWeights,
) -> CoreResult<Vec<ConnectionMovement>> {
    voicings
        .windows(2)
        .map(|pair| {
            let chord = |pitches: &[i64]| MotionChord {
                id: String::new(),
                name: String::new(),
                root_millicents: None,
                pitches_millicents: pitches.to_vec(),
            };
            Ok(pair_metrics(&chord(&pair[0]), &chord(&pair[1]), None, None, weights)?.registered)
        })
        .collect()
}

fn squared_step_changes(boundaries: &[ConnectionMovement]) -> f64 {
    let mut total = 0.0;
    for pair in boundaries.windows(2) {
        for previous in &pair[0].representative.links {
            // Equal pitch alone never joins emissions. A continuing part must
            // pass through the very same middle chord member identity.
            if let Some(next) = pair[1]
                .representative
                .links
                .iter()
                .find(|next| previous.to_member == next.from_member)
            {
                let change = (next.registered_displacement_millicents
                    - previous.registered_displacement_millicents)
                    as f64
                    / HUNDRED_CENTS;
                total += change * change;
            }
        }
    }
    total
}

/// Phrase cost over composed registered links. Pairwise representatives use the
/// supplied connection motion weights; continuity does not silently reassign a
/// tied pair. Births and deaths do not invent a step across absent membership.
pub fn continuity_cost(
    voicings: &[Vec<i64>],
    weights: &ConnectionWeights,
    strength: f64,
) -> CoreResult<f64> {
    validate_voicings(voicings, weights)?;
    validate_strength(strength)?;
    if strength == 0.0 || voicings.len() < 3 {
        return Ok(0.0);
    }
    Ok(strength * squared_step_changes(&registered_boundaries(voicings, weights)?))
}

fn point(
    step_index: usize,
    member_index: usize,
    pitch: i64,
    onset: f64,
    step: &MotionStep,
) -> HarmonicLinePoint {
    HarmonicLinePoint {
        step_index,
        member_index,
        pitch_millicents: pitch,
        onset_quarters: onset,
        duration: step.duration.clone(),
    }
}

fn line(points: Vec<HarmonicLinePoint>, index: usize) -> HarmonicLine {
    let steps = points
        .windows(2)
        .map(|pair| pair[1].pitch_millicents - pair[0].pitch_millicents)
        .collect::<Vec<_>>();
    let mut direction = 0;
    let mut reversals = 0;
    for &step in &steps {
        if step != 0 {
            let next_direction = step.signum();
            if direction != 0 && direction != next_direction {
                reversals += 1;
            }
            direction = next_direction;
        }
    }
    HarmonicLine {
        id: format!("line-{}", index + 1),
        total_motion_millicents: steps.iter().map(|step| step.abs()).sum(),
        max_motion_millicents: steps.iter().map(|step| step.abs()).max().unwrap_or(0),
        range_millicents: points
            .iter()
            .map(|point| point.pitch_millicents)
            .max()
            .unwrap_or(0)
            - points
                .iter()
                .map(|point| point.pitch_millicents)
                .min()
                .unwrap_or(0),
        direction_reversal_count: reversals,
        squared_step_change_100_cent_units: steps
            .windows(2)
            .map(|pair| ((pair[1] - pair[0]) as f64 / HUNDRED_CENTS).powi(2))
            .sum(),
        points,
        steps_millicents: steps,
    }
}

/// Build candidate parts across all supplied harmonic slots. Chord names,
/// roots, functional readings and scale membership never define these lines.
pub fn analyze(
    chords: &[MotionChord],
    history: &[MotionStep],
    weights: &ConnectionWeights,
) -> CoreResult<HarmonicLinesAnalysis> {
    analyze_with_continuity(chords, history, weights, DEFAULT_CONTINUITY_WEIGHT)
}

/// The same candidate-part analysis with an explicit authored continuity weight.
/// Zero disables the preference while retaining all displayed line evidence.
pub fn analyze_with_continuity(
    chords: &[MotionChord],
    history: &[MotionStep],
    weights: &ConnectionWeights,
    strength: f64,
) -> CoreResult<HarmonicLinesAnalysis> {
    validate_strength(strength)?;
    validate_weights(weights)?;
    if chords.len() > 128 || history.len() > MAX_STEPS {
        return Err(invalid(
            "Harmonic lines admit at most 128 chords and 128 authored steps.",
        ));
    }
    let mut catalog = BTreeMap::new();
    for chord in chords {
        validate_pitches(&chord.pitches_millicents)?;
        if chord.id.is_empty() || catalog.insert(chord.id.as_str(), chord).is_some() {
            return Err(invalid(
                "Harmonic-line chord identifiers must be nonempty and unique.",
            ));
        }
    }
    let mut voicings = Vec::with_capacity(history.len());
    let mut onsets = Vec::with_capacity(history.len());
    let mut onset = 0.0;
    for step in history {
        if step.duration.numerator == 0 || step.duration.denominator == 0 {
            return Err(invalid(
                "Harmonic-line slot durations must be positive rational values.",
            ));
        }
        let chord = catalog.get(step.chord_id.as_str()).ok_or_else(|| {
            invalid(format!(
                "Harmonic-line history references unknown chord '{}'.",
                step.chord_id
            ))
        })?;
        voicings.push(chord.pitches_millicents.clone());
        onsets.push(onset);
        onset += f64::from(step.duration.numerator) / f64::from(step.duration.denominator);
    }
    let movements = registered_boundaries(&voicings, weights)?;
    let continuity_cost = strength * squared_step_changes(&movements);
    let mut parts: Vec<Vec<HarmonicLinePoint>> = Vec::new();
    let mut active = Vec::new();
    if let Some(pitches) = voicings.first() {
        for (member, &pitch) in pitches.iter().enumerate() {
            active.push(parts.len());
            parts.push(vec![point(0, member, pitch, onsets[0], &history[0])]);
        }
    }
    for (boundary_index, movement) in movements.iter().enumerate() {
        let next_step = boundary_index + 1;
        let mut next_active = vec![usize::MAX; voicings[next_step].len()];
        for link in &movement.representative.links {
            let part = active[link.from_member];
            parts[part].push(point(
                next_step,
                link.to_member,
                link.to_millicents,
                onsets[next_step],
                &history[next_step],
            ));
            next_active[link.to_member] = part;
        }
        for &arrival in &movement.representative.arrivals {
            next_active[arrival] = parts.len();
            parts.push(vec![point(
                next_step,
                arrival,
                voicings[next_step][arrival],
                onsets[next_step],
                &history[next_step],
            )]);
        }
        debug_assert!(next_active.iter().all(|&part| part != usize::MAX));
        active = next_active;
    }
    Ok(HarmonicLinesAnalysis {
        lines: parts.into_iter().enumerate().map(|(index, points)| line(points, index)).collect(),
        boundaries: movements.into_iter().enumerate().map(|(index, movement)| HarmonicLineBoundary {
            from_step_index: index,
            to_step_index: index + 1,
            optimal_correspondence_count: movement.optimal_correspondence_count,
            links: movement.representative.links,
            arrivals: movement.representative.arrivals,
            departures: movement.representative.departures,
        }).collect(),
        continuity_weight: strength,
        continuity_cost,
        explanation: "Candidate parts follow the same exact registered member links across the whole phrase. Signed steps and changes of step size describe their contours; no octave wrapping, bass privilege or chord-function rule is used. Pairwise minimum-prefix matching ties remain explicit: the representative does not establish a unique voice identity or a globally optimal part assignment. Onsets and durations describe harmonic slots; performed arpeggio timing remains in the composition program.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harmonic_connection::default_weights;

    fn analysis(pitches: &[Vec<i64>]) -> HarmonicLinesAnalysis {
        analysis_with_strength(pitches, DEFAULT_CONTINUITY_WEIGHT)
    }

    fn analysis_with_strength(pitches: &[Vec<i64>], strength: f64) -> HarmonicLinesAnalysis {
        let chords = pitches
            .iter()
            .enumerate()
            .map(|(index, pitches)| MotionChord {
                id: index.to_string(),
                name: String::new(),
                root_millicents: None,
                pitches_millicents: pitches.iter().map(|pitch| pitch * 100_000).collect(),
            })
            .collect::<Vec<_>>();
        let history = chords
            .iter()
            .map(|chord| MotionStep {
                chord_id: chord.id.clone(),
                duration: MotionDuration {
                    numerator: 4,
                    denominator: 1,
                },
            })
            .collect::<Vec<_>>();
        analyze_with_continuity(&chords, &history, &default_weights(), strength).unwrap()
    }

    #[test]
    fn explicit_continuity_weight_changes_cost_without_relabeling_parts() {
        let pitches = [vec![60], vec![62], vec![60]];
        let enabled = analysis_with_strength(&pitches, 0.5);
        let disabled = analysis_with_strength(&pitches, 0.0);
        assert_eq!(enabled.continuity_weight, 0.5);
        assert_eq!(enabled.continuity_cost, 8.0);
        assert_eq!(disabled.continuity_weight, 0.0);
        assert_eq!(disabled.continuity_cost, 0.0);
        assert_eq!(
            serde_json::to_value(enabled.lines).unwrap(),
            serde_json::to_value(disabled.lines).unwrap()
        );
    }

    #[test]
    fn equal_pairwise_motion_can_have_different_phrase_contours() {
        let zigzag = analysis(&[vec![60], vec![62], vec![60]]);
        let sustained = analysis(&[vec![60], vec![62], vec![64]]);
        assert_eq!(
            zigzag.lines[0].total_motion_millicents,
            sustained.lines[0].total_motion_millicents
        );
        assert_eq!(zigzag.lines[0].direction_reversal_count, 1);
        assert_eq!(sustained.lines[0].direction_reversal_count, 0);
        assert_eq!(zigzag.continuity_cost, 1.28);
        assert_eq!(sustained.continuity_cost, 0.0);
        let voicings = vec![vec![6_000_000], vec![6_200_000], vec![6_000_000]];
        assert_eq!(
            continuity_cost(&voicings, &default_weights(), DEFAULT_CONTINUITY_WEIGHT).unwrap(),
            zigzag.continuity_cost
        );
    }

    #[test]
    fn arrivals_and_departures_are_not_invented_continuations() {
        let result = analysis(&[vec![60], vec![60, 67], vec![67]]);
        assert_eq!(result.lines.len(), 2);
        assert_eq!(
            result.lines[0]
                .points
                .iter()
                .map(|p| (p.step_index, p.member_index))
                .collect::<Vec<_>>(),
            vec![(0, 0), (1, 0)]
        );
        assert_eq!(
            result.lines[1]
                .points
                .iter()
                .map(|p| (p.step_index, p.member_index))
                .collect::<Vec<_>>(),
            vec![(1, 1), (2, 0)]
        );
        assert_eq!(result.boundaries[0].arrivals, vec![1]);
        assert_eq!(result.boundaries[1].departures, vec![0]);
        assert_eq!(result.continuity_cost, 0.0);
    }

    #[test]
    fn coincident_members_keep_separate_emissions_and_tie_counts() {
        let result = analysis(&[vec![60; 8], vec![60; 8], vec![60; 8]]);
        assert_eq!(result.lines.len(), 8);
        assert!(result.lines.iter().all(|line| line.points.len() == 3));
        assert!(
            result
                .boundaries
                .iter()
                .all(|boundary| boundary.optimal_correspondence_count == 40_320)
        );
        for step in 0..3 {
            let mut members = result
                .lines
                .iter()
                .flat_map(|line| &line.points)
                .filter(|point| point.step_index == step)
                .map(|point| point.member_index)
                .collect::<Vec<_>>();
            members.sort_unstable();
            assert_eq!(members, (0..8).collect::<Vec<_>>());
        }
        let divergent = analysis(&[vec![60, 60], vec![59, 61], vec![58, 62]]);
        assert_eq!(divergent.lines.len(), 2);
        assert_eq!(
            divergent
                .lines
                .iter()
                .map(|line| line.points[2].pitch_millicents)
                .collect::<Vec<_>>(),
            vec![5_800_000, 6_200_000]
        );
    }

    #[test]
    fn whole_phrase_keeps_register_endpoints_and_slot_time() {
        let result = analysis(&[vec![60], vec![72], vec![60]]);
        assert_eq!(
            result.lines[0].steps_millicents,
            vec![1_200_000, -1_200_000]
        );
        assert_eq!(result.lines[0].range_millicents, 1_200_000);
        assert_eq!(result.lines[0].points[2].onset_quarters, 8.0);
        assert_eq!(result.lines[0].points[2].duration.numerator, 4);
        assert!(
            result
                .boundaries
                .iter()
                .flat_map(|boundary| &boundary.links)
                .all(|link| link.winding.is_none())
        );
    }

    #[test]
    fn zero_strength_validates_and_is_an_explicit_disabled_control() {
        let weights = default_weights();
        assert_eq!(
            continuity_cost(&[vec![0], vec![2_000_000], vec![-2_000_000]], &weights, 0.0).unwrap(),
            0.0
        );
        assert!(continuity_cost(&[vec![]], &weights, 0.0).is_err());
        assert!(continuity_cost(&vec![vec![0]; 129], &weights, 0.0).is_err());
        assert!(continuity_cost(&[vec![i64::MAX]], &weights, 0.0).is_err());
        assert!(
            continuity_cost(
                &[],
                &ConnectionWeights {
                    motion_linear: f64::NAN,
                    ..weights.clone()
                },
                0.0
            )
            .is_err()
        );
        assert!(continuity_cost(&[], &weights, f64::INFINITY).is_err());
        assert_eq!(analysis(&[]).lines.len(), 0);
    }

    #[test]
    fn holds_preserve_descriptive_direction_without_erasing_step_changes() {
        let result = analysis(&[vec![60], vec![62], vec![62], vec![60]]);
        assert_eq!(result.lines[0].direction_reversal_count, 1);
        assert_eq!(result.lines[0].squared_step_change_100_cent_units, 8.0);
    }
}
