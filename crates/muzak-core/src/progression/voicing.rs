//! Bounded passage voicing over exact chord pitch classes. These choices supply
//! pitches to the composition compiler; they do not emit notes or infer voices.

use super::catalog::ProgressionChord;
use std::collections::BTreeSet;

/// Retain every chord member, with an independent root bass and smooth upper
/// parts. The whole passage chooses its register jointly, including its ending.
pub(super) fn voice(chords: &[ProgressionChord]) -> Vec<Vec<i32>> {
    let choices: Vec<_> = chords
        .iter()
        .map(|chord| candidates(chord.root_pitch_class, &chord.intervals))
        .collect();
    select_passage(&choices)
}

fn candidates(root: i32, intervals: &[i32]) -> Vec<Vec<i32>> {
    let root = root.rem_euclid(12);
    let mut classes: BTreeSet<_> = intervals
        .iter()
        .map(|interval| (root + interval).rem_euclid(12))
        .collect();
    // Triads can double their root. Richer chords already have a bass root and
    // keep all their other members without crowding a second copy into the top.
    if classes.len() >= 4 {
        classes.remove(&root);
    }
    // This is also defined for a bass-only chord, though the catalog uses fuller
    // sonorities. An omitted root in a supplied upper structure stays in the bass.
    let classes: Vec<_> = classes.into_iter().collect();
    let mut upper_choices = BTreeSet::new();
    if classes.is_empty() {
        upper_choices.insert(Vec::new());
    }
    for &first_class in &classes {
        for first in 55..=72 {
            if first % 12 != first_class {
                continue;
            }
            let mut upper: Vec<_> = classes
                .iter()
                .map(|class| first + (class - first_class).rem_euclid(12))
                .collect();
            upper.sort_unstable();
            add_upper(&mut upper_choices, upper.clone());
            // A close position and its drop voicings cover useful piano shapes
            // without an exponential catalog of arbitrary octave assignments.
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
    let mut result = BTreeSet::new();
    for bass in 36..=55 {
        if bass % 12 != root {
            continue;
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
    result.into_iter().collect()
}

fn add_upper(choices: &mut BTreeSet<Vec<i32>>, upper: Vec<i32>) {
    if upper.first().is_some_and(|pitch| *pitch < 55)
        || upper.last().is_some_and(|pitch| *pitch > 84)
        || upper
            .windows(2)
            .any(|pair| pair[0] < 60 && pair[1] - pair[0] < 3)
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

fn movement_cost(before: &[i32], after: &[i32]) -> i64 {
    let bass = (before[0] - after[0]).abs() as i64 * 3;
    let a = &before[1..];
    let b = &after[1..];
    // Monotone minimum-cost correspondence allows changing cardinality without
    // assuming that the third or highest note is a persistent named voice.
    const UNMATCHED: i64 = 18;
    let mut row: Vec<_> = (0..=b.len()).map(|j| j as i64 * UNMATCHED).collect();
    for (i, &pitch) in a.iter().enumerate() {
        let mut next = vec![(i as i64 + 1) * UNMATCHED; b.len() + 1];
        for (j, &target) in b.iter().enumerate() {
            next[j + 1] = (row[j] + (pitch - target).abs() as i64 * 4)
                .min(row[j + 1] + UNMATCHED)
                .min(next[j] + UNMATCHED);
        }
        row = next;
    }
    bass + row[b.len()]
}

fn select_passage(choices: &[Vec<Vec<i32>>]) -> Vec<Vec<i32>> {
    let Some(first) = choices.first() else {
        return Vec::new();
    };
    // Nonempty catalog chords always admit a close voicing within these bounds.
    // Fail loudly if an internal candidate change ever breaks that contract.
    assert!(choices.iter().all(|chords| !chords.is_empty()));
    let mut costs: Vec<_> = first
        .iter()
        .map(|voicing| register_cost(voicing) * 3)
        .collect();
    let mut back = Vec::new();
    for step in 1..choices.len() {
        let mut next_costs = Vec::with_capacity(choices[step].len());
        let mut parents = Vec::with_capacity(choices[step].len());
        for after in &choices[step] {
            let (parent, cost) = choices[step - 1]
                .iter()
                .enumerate()
                .map(|(index, before)| (index, costs[index] + movement_cost(before, after)))
                .min_by_key(|&(index, cost)| (cost, index))
                .unwrap();
            parents.push(parent);
            next_costs.push(cost + register_cost(after));
        }
        costs = next_costs;
        back.push(parents);
    }
    let mut index = (0..costs.len())
        .min_by_key(|&index| (costs[index], index))
        .unwrap();
    let mut result = vec![Vec::new(); choices.len()];
    for step in (0..choices.len()).rev() {
        result[step] = choices[step][index].clone();
        if step > 0 {
            index = back[step - 1][index];
        }
    }
    result
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
                assert_eq!(actual[0] % 12, root);
                assert!((36..=55).contains(&actual[0]));
                assert!(actual[1..].iter().all(|pitch| (55..=84).contains(pitch)));
                assert!(actual.windows(2).all(|pair| pair[0] < pair[1]));
            }
        }
    }

    #[test]
    fn root_wrap_and_cardinality_changes_keep_a_smooth_register() {
        let voiced = passage(&[(11, &[0, 4, 7, 10]), (0, &[0, 4, 7]), (1, &[0, 3, 6, 9])]);
        assert_eq!(
            voiced.iter().map(|chord| chord[0]).collect::<Vec<_>>(),
            vec![47, 48, 49]
        );
        for pair in voiced.windows(2) {
            assert!((pair[0].last().unwrap() - pair[1].last().unwrap()).abs() <= 4);
        }
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
}
