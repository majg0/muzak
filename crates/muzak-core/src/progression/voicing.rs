//! Bounded passage voicing over exact chord pitch classes. These choices supply
//! pitches to the composition compiler; they do not emit notes or infer voices.

use super::catalog::ProgressionChord;
use crate::harmonic_connection::{self, ConnectionWeights};
use crate::harmonic_lines;
use std::collections::BTreeSet;

/// Retain every chord member while choosing the complete passage's inversions
/// and register jointly. A supplied harmonic root does not dictate the bass.
pub(super) fn voice_with_continuity(
    chords: &[ProgressionChord],
    continuity_weight: f64,
) -> Vec<Vec<i32>> {
    let choices: Vec<_> = chords
        .iter()
        .map(|chord| candidates(chord.root_pitch_class, &chord.intervals))
        .collect();
    select_passage_with_continuity(&choices, continuity_weight)
}

pub(super) fn candidates(root: i32, intervals: &[i32]) -> Vec<Vec<i32>> {
    let root = root.rem_euclid(12);
    let classes: BTreeSet<_> = intervals
        .iter()
        .map(|interval| (root + interval).rem_euclid(12))
        .collect();
    let mut result = BTreeSet::new();
    for bass in 36..=55 {
        let bass_class = bass % 12;
        if !classes.contains(&bass_class) {
            continue;
        }
        // Triads may double any member, independently from the chosen bass.
        // Seventh and richer chords retain each distinct class exactly once.
        let mut upper_structures = Vec::new();
        if classes.len() == 3 {
            for &doubled in &classes {
                let mut upper: Vec<_> = classes.iter().copied().collect();
                upper.push(doubled);
                upper.remove(upper.iter().position(|class| *class == bass_class).unwrap());
                upper_structures.push(upper);
            }
        } else {
            upper_structures.push(
                classes
                    .iter()
                    .copied()
                    .filter(|class| classes.len() < 4 || *class != bass_class)
                    .collect(),
            );
        }
        let mut upper_choices = BTreeSet::new();
        for upper_classes in upper_structures {
            if upper_classes.is_empty() {
                upper_choices.insert(Vec::new());
            }
            for first_class in upper_classes.iter().copied().collect::<BTreeSet<_>>() {
                for first in 55..=72 {
                    if first % 12 != first_class {
                        continue;
                    }
                    let mut occupied = BTreeSet::new();
                    for class in &upper_classes {
                        let mut pitch = first + (class - first_class).rem_euclid(12);
                        while occupied.contains(&pitch) {
                            pitch += 12;
                        }
                        occupied.insert(pitch);
                    }
                    let upper: Vec<_> = occupied.into_iter().collect();
                    add_upper(&mut upper_choices, upper.clone());
                    // Closed and drop positions give useful register alternatives
                    // without enumerating every possible octave assignment.
                    if upper.len() >= 3 {
                        for dropped in [upper.len() - 2, upper.len() - 3] {
                            let mut spread = upper.clone();
                            spread[dropped] -= 12;
                            spread.sort_unstable();
                            add_upper(&mut upper_choices, spread);
                        }
                    }
                }
            }
        }
        for upper in &upper_choices {
            if upper.first().is_some_and(|first| first - bass < 7) {
                continue;
            }
            let mut voiced = vec![bass];
            voiced.extend(upper);
            result.insert(voiced);
        }
    }
    let mut ranked: Vec<_> = result
        .into_iter()
        .map(|voicing| (register_cost(&voicing) as f64, voicing))
        .collect();
    ranked.sort_by(|(cost_a, a), (cost_b, b)| cost_a.total_cmp(cost_b).then(a.cmp(b)));
    // Keep all bass-class alternatives represented, then the closest register
    // shapes. The passage search is conditional on this finite vocabulary.
    retain_inversions(ranked, 64)
}

/// Supply a small, deterministic register vocabulary for an intermediate chord.
/// It follows the endpoint texture, including undoubled members when supplied.
/// The supplied endpoint notes remain exact premises.
pub(super) fn connection_candidates(
    root: i32,
    intervals: &[i32],
    from: &[i32],
    to: &[i32],
) -> Vec<Vec<i32>> {
    let root = root.rem_euclid(12);
    let classes: BTreeSet<_> = intervals
        .iter()
        .map(|interval| (root + interval).rem_euclid(12))
        .collect();
    if classes.is_empty() || from.is_empty() || to.is_empty() {
        return Vec::new();
    }
    let min_members = from.len().min(to.len());
    let max_members = from.len().max(to.len());
    if max_members > 8 || classes.len() > max_members {
        return Vec::new();
    }
    let lowest = from.iter().chain(to).copied().min().unwrap();
    let highest = from.iter().chain(to).copied().max().unwrap();
    let low = (lowest - 12).clamp(0, 127);
    let high = (highest + 12).clamp(0, 127);
    let mut pool = BTreeSet::new();
    // Every cyclic ordering is an inversion, not a new chord or root reading.
    // Closed positions and drop voicings preserve every distinct chord class.
    for bass in low..=high {
        let bass_class = bass.rem_euclid(12);
        if !classes.contains(&bass_class) {
            continue;
        }
        let mut closed: Vec<_> = classes
            .iter()
            .map(|class| bass + (class - bass_class).rem_euclid(12))
            .collect();
        closed.sort_unstable();
        insert_connection_candidate(&mut pool, closed.clone());
        if closed.len() >= 3 {
            for dropped in [closed.len() - 2, closed.len() - 3] {
                let mut spread = closed.clone();
                spread[dropped] -= 12;
                insert_connection_candidate(&mut pool, spread);
            }
        }
    }
    // Existing bass/upper shapes remain available when the endpoints use that
    // arrangement. Translating by octaves follows their supplied register.
    for candidate in candidates(root, intervals) {
        for shift in -7..=7 {
            let shifted: Vec<_> = candidate.iter().map(|pitch| pitch + shift * 12).collect();
            if shifted[0] >= low && shifted[0] <= high {
                insert_connection_candidate(&mut pool, shifted);
            }
        }
    }
    pool.retain(|candidate| {
        candidate
            .iter()
            .map(|pitch| pitch.rem_euclid(12))
            .collect::<BTreeSet<_>>()
            == classes
    });
    let weights = harmonic_connection::default_weights();
    // The adapter connects the supplied texture. Equal endpoint cardinalities
    // require the same number of voices throughout, so losing a member cannot
    // be used as a cheap substitute for moving it. Different endpoint counts
    // admit only the intervening counts, with arrivals/departures still scored.
    let mut layers: Vec<BTreeSet<Vec<i32>>> = (0..=max_members).map(|_| BTreeSet::new()).collect();
    for candidate in pool {
        if candidate.len() <= max_members {
            layers[candidate.len()].insert(candidate);
        }
    }
    let mut eligible = BTreeSet::new();
    for members in classes.len()..=max_members {
        let frontier = retain_inversions(
            rank_connection_candidates(std::mem::take(&mut layers[members]), from, to, &weights),
            24,
        );
        if members >= min_members {
            eligible.extend(frontier.iter().cloned());
        }
        if members == max_members {
            continue;
        }
        // Add octave copies of existing members, preserving the complete class
        // set. A bounded frontier at each count avoids exponential enumeration
        // when a triad needs several doublings to match a denser texture.
        for candidate in frontier {
            for &pitch in &candidate {
                for octave in [-12, 12] {
                    let added = pitch + octave;
                    if (0..=127).contains(&added) && !candidate.contains(&added) {
                        let mut expanded = candidate.clone();
                        expanded.push(added);
                        expanded.sort_unstable();
                        layers[members + 1].insert(expanded);
                    }
                }
            }
        }
    }
    retain_inversions(rank_connection_candidates(eligible, from, to, &weights), 4)
}

fn rank_connection_candidates(
    pool: BTreeSet<Vec<i32>>,
    from: &[i32],
    to: &[i32],
    weights: &ConnectionWeights,
) -> Vec<(f64, Vec<i32>)> {
    let mut ranked: Vec<_> = pool
        .into_iter()
        .map(|candidate| {
            let cost = shared_movement_cost(from, &candidate, weights)
                + shared_movement_cost(&candidate, to, weights);
            (cost, candidate)
        })
        .collect();
    ranked.sort_by(|(cost_a, a), (cost_b, b)| cost_a.total_cmp(cost_b).then(a.cmp(b)));
    ranked
}

fn retain_inversions(ranked: Vec<(f64, Vec<i32>)>, limit: usize) -> Vec<Vec<i32>> {
    // Keep the best realization of each bass class first. Four near-identical
    // root-position registers would unnecessarily suppress useful inversions.
    let mut selected = Vec::new();
    let mut bass_classes = BTreeSet::new();
    for (_, candidate) in &ranked {
        if bass_classes.insert(candidate[0].rem_euclid(12)) {
            selected.push(candidate.clone());
            if selected.len() == limit {
                return selected;
            }
        }
    }
    for (_, candidate) in ranked {
        if !selected.contains(&candidate) {
            selected.push(candidate);
            if selected.len() == limit {
                break;
            }
        }
    }
    selected
}

fn insert_connection_candidate(pool: &mut BTreeSet<Vec<i32>>, mut pitches: Vec<i32>) {
    pitches.sort_unstable();
    if pitches.iter().all(|pitch| (0..=127).contains(pitch))
        && pitches.windows(2).all(|pair| pair[0] < pair[1])
    {
        pool.insert(pitches);
    }
}

fn add_upper(choices: &mut BTreeSet<Vec<i32>>, upper: Vec<i32>) {
    if upper.first().is_some_and(|pitch| *pitch < 55)
        || upper.last().is_some_and(|pitch| *pitch > 84)
        || upper
            .windows(2)
            .any(|pair| pair[0] >= pair[1] || pair[0] < 60 && pair[1] - pair[0] < 3)
    {
        return;
    }
    choices.insert(upper);
}

fn register_cost(voicing: &[i32]) -> i64 {
    let bass = (voicing[0] - 45).abs() as i64 * 2;
    let upper = &voicing[1..];
    let center = if upper.is_empty() {
        0
    } else {
        // Compare mean register in fixed units so richer chords do not acquire
        // a larger register prior merely by having more notes.
        (upper.iter().sum::<i32>() * 2 / upper.len() as i32 - 131).abs() as i64
    };
    let span = upper
        .first()
        .zip(upper.last())
        .map_or(0, |(low, high)| (high - low - 19).max(0) as i64 * 3);
    bass + center + span
}

fn shared_movement_cost(before: &[i32], after: &[i32], weights: &ConnectionWeights) -> f64 {
    let native = |pitches: &[i32]| -> Vec<i64> {
        pitches
            .iter()
            .map(|pitch| i64::from(*pitch) * 100_000)
            .collect()
    };
    harmonic_connection::registered_cost(&native(before), &native(after), weights)
        .expect("Internal voicing pitches must satisfy the connection metric contract")
}

#[cfg(test)]
fn select_passage(choices: &[Vec<Vec<i32>>]) -> Vec<Vec<i32>> {
    select_passage_with_continuity(choices, harmonic_lines::DEFAULT_CONTINUITY_WEIGHT)
}

#[derive(Clone, Copy)]
struct PassageState {
    cost: f64,
    parent: Option<(usize, usize)>,
}

fn select_passage_with_continuity(
    choices: &[Vec<Vec<i32>>],
    continuity_weight: f64,
) -> Vec<Vec<i32>> {
    let Some(first) = choices.first() else {
        return Vec::new();
    };
    // Nonempty catalog chords always admit a close voicing within these bounds.
    // Fail loudly if an internal candidate change ever breaks that contract.
    assert!(choices.iter().all(|chords| !chords.is_empty()));
    assert!(continuity_weight.is_finite() && continuity_weight >= 0.0);
    let weights = harmonic_connection::default_weights();
    // Keep the best complete first-order candidates, then compare their whole
    // member trajectories. This is a bounded reranking heuristic, not an exact
    // optimum over every possible phrase. Zero strength retains the original
    // first-order decoder, including its deterministic tie choices.
    const COMPLETE_CANDIDATES: usize = 24;
    let retained = if continuity_weight == 0.0 {
        1
    } else {
        COMPLETE_CANDIDATES
    };
    let initial: Vec<_> = first
        .iter()
        .map(|voicing| {
            vec![PassageState {
                cost: register_cost(voicing) as f64 * 0.75,
                parent: None,
            }]
        })
        .collect();
    let mut layers = vec![initial];
    for step in 1..choices.len() {
        let mut next = Vec::with_capacity(choices[step].len());
        for after in &choices[step] {
            let mut paths = Vec::new();
            for (index, before) in choices[step - 1].iter().enumerate() {
                let movement = shared_movement_cost(before, after, &weights);
                for (rank, state) in layers[step - 1][index].iter().enumerate() {
                    paths.push(PassageState {
                        cost: state.cost + movement,
                        parent: Some((index, rank)),
                    });
                }
            }
            paths.sort_by(|a, b| a.cost.total_cmp(&b.cost).then(a.parent.cmp(&b.parent)));
            paths.truncate(retained);
            for state in &mut paths {
                state.cost += register_cost(after) as f64 * 0.25;
            }
            next.push(paths);
        }
        layers.push(next);
    }
    let mut endings = Vec::new();
    for (index, states) in layers.last().unwrap().iter().enumerate() {
        for (rank, state) in states.iter().enumerate() {
            endings.push((state.cost, index, rank));
        }
    }
    endings.sort_by(|a, b| a.0.total_cmp(&b.0).then((a.1, a.2).cmp(&(b.1, b.2))));
    endings.truncate(retained);
    let mut selected = Vec::new();
    let mut selected_cost = f64::INFINITY;
    for (base_cost, mut index, mut rank) in endings {
        let mut result = vec![Vec::new(); choices.len()];
        for step in (0..choices.len()).rev() {
            result[step] = choices[step][index].clone();
            if let Some(parent) = layers[step][index][rank].parent {
                (index, rank) = parent;
            }
        }
        let continuity = if continuity_weight == 0.0 {
            0.0
        } else {
            let native: Vec<Vec<_>> = result
                .iter()
                .map(|voicing| {
                    voicing
                        .iter()
                        .map(|pitch| i64::from(*pitch) * 100_000)
                        .collect()
                })
                .collect();
            harmonic_lines::continuity_cost(&native, &weights, continuity_weight)
                .expect("Internal passage pitches must satisfy the trajectory contract")
        };
        let cost = base_cost + continuity;
        if cost < selected_cost {
            selected_cost = cost;
            selected = result;
        }
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passage(chords: &[(i32, &[i32])]) -> Vec<Vec<i32>> {
        select_passage(
            &chords
                .iter()
                .map(|(root, intervals)| candidates(*root, intervals))
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn every_altered_diminished_and_extended_member_sounds() {
        for intervals in [
            &[0, 4, 7][..],
            &[0, 3, 6, 9][..],
            &[0, 4, 6, 8, 10, 13, 15][..],
            &[0, 3, 7, 11, 14][..],
        ] {
            for root in 0..12 {
                let expected: BTreeSet<_> = intervals
                    .iter()
                    .map(|interval| (root + interval) % 12)
                    .collect();
                let actual = passage(&[(root, intervals)]).pop().unwrap();
                assert_eq!(
                    actual
                        .iter()
                        .map(|pitch| pitch % 12)
                        .collect::<BTreeSet<_>>(),
                    expected
                );
                assert_eq!(actual.len(), expected.len().max(4));
                let choices = candidates(root, intervals);
                assert!(choices.len() <= 64);
                assert_eq!(
                    choices
                        .iter()
                        .map(|choice| choice[0] % 12)
                        .collect::<BTreeSet<_>>(),
                    expected
                );
                assert!((36..=55).contains(&actual[0]));
                assert!(actual[1..].iter().all(|pitch| (55..=84).contains(pitch)));
                assert!(actual.windows(2).all(|pair| pair[0] < pair[1]));
            }
        }
    }

    #[test]
    fn root_wrap_and_cardinality_changes_keep_all_members_smooth() {
        let voiced = passage(&[(11, &[0, 4, 7, 10]), (0, &[0, 4, 7]), (1, &[0, 3, 6, 9])]);
        assert!(voiced.iter().all(|chord| chord.len() == 4));
        for line in line_analysis(&voiced).lines {
            assert!(line.max_motion_millicents <= 400_000);
        }
    }

    fn line_analysis(voicings: &[Vec<i32>]) -> harmonic_lines::HarmonicLinesAnalysis {
        use crate::harmonic_motion::{MotionChord, MotionDuration, MotionStep};
        let chords: Vec<_> = voicings
            .iter()
            .enumerate()
            .map(|(index, voiced)| MotionChord {
                id: format!("step-{index}"),
                name: String::new(),
                root_millicents: None,
                pitches_millicents: voiced
                    .iter()
                    .map(|pitch| i64::from(*pitch) * 100_000)
                    .collect(),
            })
            .collect();
        let history: Vec<_> = chords
            .iter()
            .map(|chord| MotionStep {
                chord_id: chord.id.clone(),
                duration: MotionDuration {
                    numerator: 4,
                    denominator: 1,
                },
            })
            .collect();
        harmonic_lines::analyze(&chords, &history, &harmonic_connection::default_weights()).unwrap()
    }

    #[test]
    fn releasing_the_root_bass_constraint_improves_complete_member_lines() {
        let source: &[(i32, &[i32])] = &[
            (0, &[0, 4, 7]),
            (5, &[0, 4, 7]),
            (7, &[0, 4, 7]),
            (0, &[0, 4, 7]),
        ];
        let choices: Vec<_> = source
            .iter()
            .map(|(root, intervals)| candidates(*root, intervals))
            .collect();
        let constrained: Vec<_> = choices
            .iter()
            .zip(source)
            .map(|(choices, (root, _))| {
                choices
                    .iter()
                    .filter(|voiced| voiced[0] % 12 == *root)
                    .cloned()
                    .collect()
            })
            .collect();
        let rooted = line_analysis(&select_passage(&constrained));
        let free = line_analysis(&select_passage(&choices));
        assert!(
            rooted
                .lines
                .iter()
                .any(|line| line.max_motion_millicents >= 500_000)
        );
        assert!(
            free.lines
                .iter()
                .all(|line| line.max_motion_millicents <= 300_000)
        );
        assert!(
            free.continuity_cost < rooted.continuity_cost,
            "free {} vs root-constrained {}",
            free.continuity_cost,
            rooted.continuity_cost
        );
        // Every melodic member is measured by the same composed correspondence.
        assert_eq!(free.lines.len(), 4);
        assert!(
            free.lines
                .iter()
                .all(|line| line.points.len() == source.len())
        );
    }

    #[test]
    fn triad_doublings_are_independent_from_the_bass_member() {
        let choices = candidates(0, &[0, 4, 7]);
        let mut pairs = BTreeSet::new();
        for choice in choices {
            let doubled = [0, 4, 7]
                .into_iter()
                .find(|class| choice.iter().filter(|pitch| *pitch % 12 == *class).count() == 2)
                .unwrap();
            pairs.insert((choice[0] % 12, doubled));
        }
        assert_eq!(pairs.len(), 9);
    }

    #[test]
    fn cadence_keeps_shared_upper_notes_and_is_deterministic() {
        let source: &[(i32, &[i32])] = &[
            (2, &[0, 3, 7, 10]),
            (7, &[0, 4, 7, 10]),
            (0, &[0, 4, 7, 11]),
        ];
        let voiced = passage(source);
        assert_eq!(voiced, passage(source));
        assert!(voiced.windows(2).all(|pair| {
            pair[0][1..]
                .iter()
                .any(|pitch| pair[1][1..].contains(pitch))
        }));
        assert!(passage(&[]).is_empty());
    }

    #[test]
    fn connection_candidates_keep_every_class_and_offer_actual_inversions() {
        let from = [57, 60, 64];
        let to = [55, 59, 62];
        let choices = connection_candidates(8, &[0, 3, 7], &from, &to);
        assert_eq!(choices, connection_candidates(8, &[0, 3, 7], &from, &to));
        assert!(!choices.is_empty() && choices.len() <= 4);
        assert_eq!(choices[0], vec![56, 59, 63]);
        let expected = BTreeSet::from([3, 8, 11]);
        for choice in &choices {
            assert_eq!(
                choice
                    .iter()
                    .map(|pitch| pitch % 12)
                    .collect::<BTreeSet<_>>(),
                expected
            );
            assert!(choice.iter().all(|pitch| (0..=127).contains(pitch)));
            assert!(choice.windows(2).all(|pair| pair[0] < pair[1]));
        }
        assert_eq!(
            choices
                .iter()
                .map(|choice| choice[0] % 12)
                .collect::<BTreeSet<_>>(),
            expected
        );
    }

    #[test]
    fn connection_register_follows_endpoint_registers() {
        let low = [9, 12, 16];
        let high = [103, 107, 110];
        let low_choices = connection_candidates(8, &[0, 3, 7], &low, &[7, 11, 14]);
        let high_choices = connection_candidates(8, &[0, 3, 7], &[105, 108, 112], &high);
        assert_eq!(low_choices[0], vec![8, 11, 15]);
        assert_eq!(high_choices[0], vec![104, 107, 111]);
        assert!(connection_candidates(0, &[0, 4, 7], &[], &high).is_empty());
        assert!(connection_candidates(0, &[], &low, &high).is_empty());
    }

    #[test]
    fn connection_candidates_preserve_dense_and_rootless_upper_structures() {
        for intervals in [
            &[0, 3, 6, 9][..],
            &[0, 4, 6, 8, 10, 13, 15][..],
            &[4, 7, 10][..],
        ] {
            let expected: BTreeSet<_> = intervals.iter().map(|pitch| pitch % 12).collect();
            let endpoints: Vec<_> = (0..expected.len().max(4))
                .map(|index| 48 + index as i32 * 3)
                .collect();
            let choices = connection_candidates(0, intervals, &endpoints, &endpoints);
            assert!(!choices.is_empty() && choices.len() <= 4);
            for choice in choices {
                assert_eq!(choice.len(), endpoints.len());
                assert_eq!(
                    choice
                        .iter()
                        .map(|pitch| pitch % 12)
                        .collect::<BTreeSet<_>>(),
                    expected
                );
            }
        }
    }

    #[test]
    fn equal_endpoint_textures_cannot_take_a_cheaper_voice_dropout() {
        let choices = connection_candidates(0, &[0, 4, 7], &[36, 60, 64, 67], &[48, 60, 64, 67]);
        assert!(!choices.is_empty());
        for choice in choices {
            assert_eq!(choice.len(), 4);
            assert_eq!(
                choice
                    .iter()
                    .map(|pitch| pitch % 12)
                    .collect::<BTreeSet<_>>(),
                BTreeSet::from([0, 4, 7])
            );
        }
        assert!(
            connection_candidates(0, &[0, 2, 4, 7, 10], &[48, 60, 64, 67], &[48, 60, 64, 67])
                .is_empty()
        );
    }

    #[test]
    fn octave_doublings_match_dense_endpoints_without_new_classes() {
        for members in [5, 8] {
            let from: Vec<_> = [24, 36, 48, 60, 64, 67, 72, 76][..members].to_vec();
            let to: Vec<_> = from.iter().map(|pitch| pitch + 12).collect();
            let choices = connection_candidates(0, &[0, 4, 7], &from, &to);
            assert!(!choices.is_empty() && choices.len() <= 4);
            for choice in choices {
                assert_eq!(choice.len(), members);
                assert_eq!(
                    choice
                        .iter()
                        .map(|pitch| pitch % 12)
                        .collect::<BTreeSet<_>>(),
                    BTreeSet::from([0, 4, 7])
                );
                assert!(choice.iter().all(|pitch| (0..=127).contains(pitch)));
            }
        }
        let mixed = connection_candidates(0, &[0, 4, 7], &[48, 60, 64, 67], &[48, 60, 64, 67, 72]);
        assert!(mixed.iter().all(|choice| (4..=5).contains(&choice.len())));
    }

    #[test]
    fn whole_phrase_reranking_improves_step_continuity_with_an_exact_disabled_control() {
        let choices = vec![vec![vec![60]], vec![vec![61], vec![62]], vec![vec![64]]];
        // The lower middle register makes the first-order total 0.1 cheaper.
        // Its 1,3-semitone line has a step change; the 2,2 line has none.
        let baseline = select_passage_with_continuity(&choices, 0.0);
        assert_eq!(baseline, vec![vec![60], vec![61], vec![64]]);
        let voiced = select_passage(&choices);
        assert_eq!(voiced, vec![vec![60], vec![62], vec![64]]);
        let native = |passage: &[Vec<i32>]| -> Vec<Vec<i64>> {
            passage
                .iter()
                .map(|voicing| {
                    voicing
                        .iter()
                        .map(|pitch| i64::from(*pitch) * 100_000)
                        .collect()
                })
                .collect()
        };
        let weights = harmonic_connection::default_weights();
        let before = harmonic_lines::continuity_cost(&native(&baseline), &weights, 1.0).unwrap();
        let after = harmonic_lines::continuity_cost(&native(&voiced), &weights, 1.0).unwrap();
        assert_eq!(before, 4.0);
        assert_eq!(after, 0.0);
        assert_eq!(select_passage_with_continuity(&choices, 0.0), baseline);
    }
}
