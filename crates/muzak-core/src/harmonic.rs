//! Bounded recurrent support/co-release hypothesis. Explicit accompaniment prior,
//! not a chord/voice oracle. Analytical joins retain every original attack ID.
use crate::{
    error::{CoreResult, budget, invalid},
    model::*,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeSet, HashMap, HashSet};
use ts_rs::TS;
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicRegionOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub min_support_pitches: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub min_occurrences: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub min_gap_contrast: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_candidate_members: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_context_members: Option<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicParameters {
    pub min_support_pitches: usize,
    pub min_occurrences: usize,
    pub min_gap_contrast: f64,
    pub max_candidate_members: usize,
    pub max_context_members: usize,
    pub selection: ScoreSelection,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicHeldRun {
    pub id: String,
    pub part: String,
    pub start_tick: u64,
    pub end_tick: u64,
    pub pitch_millicents: i64,
    pub note_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicGapEvidence {
    pub preceding_max_gap_ticks: u64,
    pub following_gap_ticks: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SupportCohort {
    pub id: String,
    pub part: String,
    pub start_tick: u64,
    pub end_tick: u64,
    pub note_ids: Vec<String>,
    pub run_ids: Vec<String>,
    pub support_pitches: Vec<i64>,
    pub bass_millicents: i64,
    pub attack_offsets_ticks: Vec<u64>,
    pub shape_key: String,
    pub split: String,
    pub gap_contrast: Option<f64>,
    pub gap_evidence: Option<HarmonicGapEvidence>,
    pub repeated_releases: usize,
    pub selected: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicSupportFamily {
    pub id: String,
    pub part: String,
    pub shape_key: String,
    pub cohort_ids: Vec<String>,
    pub occurrences: usize,
    pub support_pitch_count: usize,
    pub selected: bool,
    pub tied: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicRun {
    pub id: String,
    pub part: String,
    pub start_tick: u64,
    pub end_tick: u64,
    pub note_ids: Vec<String>,
    pub cohort_ids: Vec<String>,
    pub support_pitches: Vec<i64>,
    pub bass_millicents: i64,
    pub quality: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicPitchDifference {
    pub note_id: String,
    pub index: usize,
    pub observed_millicents: i64,
    pub template_millicents: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicMelodyCell {
    pub id: String,
    pub part: String,
    pub run_id: String,
    pub start_tick: u64,
    pub end_tick: u64,
    pub note_ids: Vec<String>,
    pub attack_offsets_ticks: Vec<u64>,
    pub durations_ticks: Vec<u64>,
    pub absolute_pitches: Vec<i64>,
    pub bass_relative_millicents: Vec<String>,
    pub rhythm_key: String,
    pub rhythm_occurrences: usize,
    pub template_pitches: Option<Vec<i64>>,
    pub template_tied: bool,
    pub pitch_differences: Vec<HarmonicPitchDifference>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicDiagnostics {
    pub selected_note_count: usize,
    pub candidate_members: usize,
    pub context_members: usize,
    pub merged_reattacks: usize,
    pub excluded_expressive_note_ids: Vec<String>,
    pub excluded_percussion_note_ids: Vec<String>,
    pub excluded_zero_duration_note_ids: Vec<String>,
    pub ambiguous_parts: Vec<String>,
    pub unsupported_release_groups: usize,
    pub limitations: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicRegionAnalysis {
    pub parameters: HarmonicParameters,
    pub held_runs: Vec<HarmonicHeldRun>,
    pub cohorts: Vec<SupportCohort>,
    pub families: Vec<HarmonicSupportFamily>,
    pub harmonic_runs: Vec<HarmonicRun>,
    pub melody_cells: Vec<HarmonicMelodyCell>,
    pub diagnostics: HarmonicDiagnostics,
}
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}
fn unique_sorted(ids: impl Iterator<Item = String>) -> Vec<String> {
    ids.collect::<BTreeSet<_>>().into_iter().collect()
}
fn bounded(value: usize, name: &str, minimum: usize) -> CoreResult<usize> {
    if value < minimum || value as u64 > MAX_SAFE {
        Err(invalid(format!(
            "{name} must be a safe integer >= {minimum}."
        )))
    } else {
        Ok(value)
    }
}
fn reserve(current: &mut usize, count: usize, limit: usize, name: &str) -> CoreResult<()> {
    if count > limit - *current {
        return Err(budget(format!(
            "Harmonic {name}-member budget exceeded: {} > {limit}.",
            *current + count
        )));
    }
    *current += count;
    Ok(())
}
fn add_cohort(
    runs: &[&HarmonicHeldRun],
    gap: Option<HarmonicGapEvidence>,
    cohorts: &mut Vec<SupportCohort>,
    candidate_members: &mut usize,
    unsupported: &mut usize,
    limit: usize,
) -> CoreResult<()> {
    reserve(candidate_members, runs.len(), limit, "candidate")?;
    for run in runs {
        reserve(candidate_members, run.note_ids.len(), limit, "candidate")?;
    }
    let pitches: Vec<_> = runs
        .iter()
        .map(|x| x.pitch_millicents)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if pitches.len() != runs.len() {
        *unsupported += 1;
        return Ok(());
    }
    let start = runs[0].start_tick;
    let end = runs[0].end_tick;
    let bass = pitches[0];
    let attacks: Vec<_> = runs.iter().map(|x| x.start_tick - start).collect();
    let divisor = attacks.iter().fold(end - start, |a, &b| gcd(a, b));
    let shape = serde_json::to_string(&json!([
        (end - start) / divisor,
        runs.iter()
            .enumerate()
            .map(|(i, x)| json!([
                attacks[i] / divisor,
                (x.pitch_millicents as i128 - bass as i128).to_string()
            ]))
            .collect::<Vec<_>>()
    ]))?;
    cohorts.push(SupportCohort {
        id: format!("cohort-{}", cohorts.len() + 1),
        part: runs[0].part.clone(),
        start_tick: start,
        end_tick: end,
        note_ids: unique_sorted(runs.iter().flat_map(|x| x.note_ids.iter().cloned())),
        run_ids: runs.iter().map(|x| x.id.clone()).collect(),
        support_pitches: pitches,
        bass_millicents: bass,
        attack_offsets_ticks: attacks,
        shape_key: shape,
        split: if gap.is_none() {
            "full-release-group"
        } else {
            "attack-gap-prefix"
        }
        .into(),
        gap_contrast: gap.as_ref().and_then(|x| {
            if x.preceding_max_gap_ticks > 0 {
                Some(x.following_gap_ticks as f64 / x.preceding_max_gap_ticks as f64)
            } else {
                None
            }
        }),
        gap_evidence: gap,
        repeated_releases: 0,
        selected: false,
    });
    Ok(())
}
pub fn infer_harmonic_regions(
    score: &Score,
    selection: &ScoreSelection,
    options: &HarmonicRegionOptions,
) -> CoreResult<HarmonicRegionAnalysis> {
    validate_score(score)?;
    if selection.parts.is_none() && selection.pitch_range.is_none() {
        return Err(invalid("Specify an explicit harmonic selection."));
    }
    let parameters = HarmonicParameters {
        min_support_pitches: bounded(
            options.min_support_pitches.unwrap_or(2),
            "minSupportPitches",
            2,
        )?,
        min_occurrences: bounded(options.min_occurrences.unwrap_or(2), "minOccurrences", 2)?,
        min_gap_contrast: options.min_gap_contrast.unwrap_or(2.),
        max_candidate_members: bounded(
            options.max_candidate_members.unwrap_or(100000),
            "maxCandidateMembers",
            0,
        )?,
        max_context_members: bounded(
            options.max_context_members.unwrap_or(100000),
            "maxContextMembers",
            0,
        )?,
        selection: selection.clone(),
    };
    if !parameters.min_gap_contrast.is_finite() || parameters.min_gap_contrast <= 1. {
        return Err(invalid("minGapContrast must exceed one."));
    }
    let selected = select_notes(score, selection)?;
    let percussion: HashSet<_> = score
        .parts
        .iter()
        .filter(|x| x.percussion)
        .map(|x| x.id.as_str())
        .collect();
    let excluded_percussion_note_ids = unique_sorted(
        selected
            .iter()
            .filter(|x| percussion.contains(x.part.as_str()))
            .map(|x| x.id.clone()),
    );
    let pitched: Vec<_> = selected
        .iter()
        .copied()
        .filter(|x| !percussion.contains(x.part.as_str()))
        .collect();
    let excluded_expressive_note_ids = unique_sorted(
        pitched
            .iter()
            .filter(|x| {
                x.pitch_envelope
                    .as_ref()
                    .is_some_and(|points| points.iter().any(|p| p.pitch != x.pitch))
            })
            .map(|x| x.id.clone()),
    );
    let excluded_zero_duration_note_ids = unique_sorted(
        pitched
            .iter()
            .filter(|x| x.duration == 0)
            .map(|x| x.id.clone()),
    );
    let excluded: HashSet<_> = excluded_expressive_note_ids
        .iter()
        .chain(excluded_zero_duration_note_ids.iter())
        .collect();
    let mut eligible: Vec<_> = pitched
        .iter()
        .copied()
        .filter(|x| !excluded.contains(&x.id))
        .collect();
    eligible.sort_by(|a, b| {
        a.part
            .cmp(&b.part)
            .then(a.pitch.millicents.cmp(&b.pitch.millicents))
            .then(a.onset.cmp(&b.onset))
            .then(a.duration.cmp(&b.duration))
            .then(a.id.cmp(&b.id))
    });
    let mut releases: HashMap<(&str, u64), HashSet<i64>> = HashMap::new();
    for note in &eligible {
        releases
            .entry((&note.part, note.onset + note.duration))
            .or_default()
            .insert(note.pitch.millicents);
    }
    let mut held_runs: Vec<HarmonicHeldRun> = vec![];
    for note in eligible {
        let barrier = releases
            .get(&(note.part.as_str(), note.onset))
            .is_some_and(|x| x.len() >= 2);
        if let Some(previous) = held_runs.last_mut() {
            if previous.part == note.part
                && previous.pitch_millicents == note.pitch.millicents
                && previous.end_tick == note.onset
                && !barrier
            {
                previous.end_tick = note.onset + note.duration;
                previous.note_ids.push(note.id.clone());
                continue;
            }
        }
        held_runs.push(HarmonicHeldRun {
            id: String::new(),
            part: note.part.clone(),
            start_tick: note.onset,
            end_tick: note.onset + note.duration,
            pitch_millicents: note.pitch.millicents,
            note_ids: vec![note.id.clone()],
        });
    }
    held_runs.sort_by(|a, b| {
        a.part
            .cmp(&b.part)
            .then(a.start_tick.cmp(&b.start_tick))
            .then(a.pitch_millicents.cmp(&b.pitch_millicents))
            .then(a.end_tick.cmp(&b.end_tick))
    });
    for (i, run) in held_runs.iter_mut().enumerate() {
        run.id = format!("held-{}", i + 1);
        run.note_ids.sort();
    }
    // Vec groups preserve first-seen order, including deterministic witness IDs.
    let mut release_groups: Vec<Vec<&HarmonicHeldRun>> = vec![];
    let mut release_indices = HashMap::new();
    for run in &held_runs {
        let next = release_groups.len();
        let index = *release_indices
            .entry((run.part.as_str(), run.end_tick))
            .or_insert(next);
        if index == next {
            release_groups.push(vec![]);
        }
        release_groups[index].push(run);
    }
    let mut cohorts = vec![];
    let (mut candidate_members, mut unsupported_release_groups) = (0, 0);
    for mut runs in release_groups {
        runs.sort_by_key(|x| (x.start_tick, x.pitch_millicents));
        if runs.len() < parameters.min_support_pitches {
            continue;
        }
        let mut previous_gap = 0;
        for i in 1..runs.len() {
            let gap = runs[i].start_tick - runs[i - 1].start_tick;
            if i >= parameters.min_support_pitches
                && gap > 0
                && gap as f64 >= previous_gap as f64 * parameters.min_gap_contrast
            {
                add_cohort(
                    &runs[..i],
                    Some(HarmonicGapEvidence {
                        preceding_max_gap_ticks: previous_gap,
                        following_gap_ticks: gap,
                    }),
                    &mut cohorts,
                    &mut candidate_members,
                    &mut unsupported_release_groups,
                    parameters.max_candidate_members,
                )?;
            }
            previous_gap = previous_gap.max(gap);
        }
        add_cohort(
            &runs,
            None,
            &mut cohorts,
            &mut candidate_members,
            &mut unsupported_release_groups,
            parameters.max_candidate_members,
        )?;
    }
    let mut groups: Vec<Vec<usize>> = vec![];
    let mut group_indices = HashMap::new();
    for (i, cohort) in cohorts.iter().enumerate() {
        let next = groups.len();
        let index = *group_indices
            .entry((cohort.part.clone(), cohort.shape_key.clone()))
            .or_insert(next);
        if index == next {
            groups.push(vec![]);
        }
        groups[index].push(i);
    }
    let mut families: Vec<_> = groups
        .iter()
        .enumerate()
        .map(|(i, group)| {
            let first = &cohorts[group[0]];
            HarmonicSupportFamily {
                id: format!("support-family-{}", i + 1),
                part: first.part.clone(),
                shape_key: first.shape_key.clone(),
                cohort_ids: group.iter().map(|&i| cohorts[i].id.clone()).collect(),
                occurrences: group
                    .iter()
                    .map(|&i| cohorts[i].end_tick)
                    .collect::<HashSet<_>>()
                    .len(),
                support_pitch_count: first.support_pitches.len(),
                selected: false,
                tied: false,
            }
        })
        .collect();
    let parts: BTreeSet<_> = families.iter().map(|x| x.part.clone()).collect();
    let mut ambiguous_parts = vec![];
    for part in parts {
        let mut ranked: Vec<_> = families
            .iter()
            .enumerate()
            .filter(|(_, x)| x.part == part && x.occurrences >= parameters.min_occurrences)
            .map(|(i, _)| i)
            .collect();
        ranked.sort_by(|&a, &b| {
            families[b]
                .occurrences
                .cmp(&families[a].occurrences)
                .then(
                    families[b]
                        .support_pitch_count
                        .cmp(&families[a].support_pitch_count),
                )
                .then(families[a].shape_key.cmp(&families[b].shape_key))
        });
        if ranked.is_empty() {
            continue;
        }
        let first = ranked[0];
        let tied: Vec<_> = ranked
            .into_iter()
            .filter(|&i| {
                families[i].occurrences == families[first].occurrences
                    && families[i].support_pitch_count == families[first].support_pitch_count
            })
            .collect();
        if tied.len() > 1 {
            ambiguous_parts.push(part);
            for i in tied {
                families[i].tied = true;
            }
        } else {
            families[first].selected = true;
        }
    }
    for (i, family) in families.iter().enumerate() {
        for &index in &groups[i] {
            cohorts[index].repeated_releases = family.occurrences;
            cohorts[index].selected = family.selected;
        }
    }
    let mut selected_cohorts: Vec<_> = cohorts.iter().filter(|x| x.selected).collect();
    selected_cohorts.sort_by(|a, b| {
        a.part
            .cmp(&b.part)
            .then(a.start_tick.cmp(&b.start_tick))
            .then(a.end_tick.cmp(&b.end_tick))
    });
    let mut harmonic_runs: Vec<HarmonicRun> = vec![];
    for cohort in selected_cohorts {
        if let Some(previous) = harmonic_runs.last_mut() {
            if previous.part == cohort.part
                && previous.end_tick == cohort.start_tick
                && previous.support_pitches == cohort.support_pitches
            {
                previous.end_tick = cohort.end_tick;
                previous.note_ids = unique_sorted(
                    previous
                        .note_ids
                        .iter()
                        .chain(cohort.note_ids.iter())
                        .cloned(),
                );
                previous.cohort_ids.push(cohort.id.clone());
                continue;
            }
        }
        let classes: HashSet<_> = cohort
            .support_pitches
            .iter()
            .map(|&pitch| (pitch as i128 - cohort.bass_millicents as i128) % 1200000)
            .collect();
        harmonic_runs.push(HarmonicRun {
            id: format!("harmony-{}", harmonic_runs.len() + 1),
            part: cohort.part.clone(),
            start_tick: cohort.start_tick,
            end_tick: cohort.end_tick,
            note_ids: cohort.note_ids.clone(),
            cohort_ids: vec![cohort.id.clone()],
            support_pitches: cohort.support_pitches.clone(),
            bass_millicents: cohort.bass_millicents,
            quality: if classes.len() == 2 && classes.contains(&0) && classes.contains(&700000) {
                "open-fifth"
            } else {
                "unlabelled"
            }
            .into(),
        });
    }
    let support_ids: HashSet<_> = harmonic_runs
        .iter()
        .flat_map(|x| x.note_ids.iter())
        .collect();
    let mut by_part: HashMap<&str, Vec<&ScoreNote>> = HashMap::new();
    for note in pitched {
        if !support_ids.contains(&note.id) {
            by_part.entry(&note.part).or_default().push(note);
        }
    }
    for notes in by_part.values_mut() {
        notes.sort_by(|a, b| {
            a.onset
                .cmp(&b.onset)
                .then(a.duration.cmp(&b.duration))
                .then(a.pitch.millicents.cmp(&b.pitch.millicents))
                .then(a.id.cmp(&b.id))
        });
    }
    let mut context_members = 0;
    let mut melody_cells = vec![];
    for (i, run) in harmonic_runs.iter().enumerate() {
        let empty = vec![];
        let source = by_part.get(run.part.as_str()).unwrap_or(&empty);
        let from = source.partition_point(|x| x.onset < run.start_tick);
        let to = source.partition_point(|x| x.onset < run.end_tick);
        reserve(
            &mut context_members,
            to - from,
            parameters.max_context_members,
            "context",
        )?;
        let notes = &source[from..to];
        let attacks: Vec<_> = notes.iter().map(|x| x.onset - run.start_tick).collect();
        let durations: Vec<_> = notes.iter().map(|x| x.duration).collect();
        let span = run.end_tick - run.start_tick;
        let divisor = attacks
            .iter()
            .chain(durations.iter())
            .fold(span, |a, &b| gcd(a, b));
        melody_cells.push(HarmonicMelodyCell {
            id: format!("melody-{}", i + 1),
            part: run.part.clone(),
            run_id: run.id.clone(),
            start_tick: run.start_tick,
            end_tick: run.end_tick,
            note_ids: notes.iter().map(|x| x.id.clone()).collect(),
            absolute_pitches: notes.iter().map(|x| x.pitch.millicents).collect(),
            bass_relative_millicents: notes
                .iter()
                .map(|x| (x.pitch.millicents as i128 - run.bass_millicents as i128).to_string())
                .collect(),
            rhythm_key: serde_json::to_string(&json!([
                span / divisor,
                attacks
                    .iter()
                    .zip(&durations)
                    .map(|(&a, &d)| [a / divisor, d / divisor])
                    .collect::<Vec<_>>()
            ]))?,
            attack_offsets_ticks: attacks,
            durations_ticks: durations,
            rhythm_occurrences: 0,
            template_pitches: None,
            template_tied: false,
            pitch_differences: vec![],
        });
    }
    let mut rhythm_groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (i, cell) in melody_cells.iter().enumerate() {
        rhythm_groups
            .entry((cell.part.clone(), cell.rhythm_key.clone()))
            .or_default()
            .push(i);
    }
    for indices in rhythm_groups.values() {
        let mut counts: HashMap<String, (Vec<i64>, usize)> = HashMap::new();
        for &i in indices {
            let pitches = &melody_cells[i].absolute_pitches;
            let entry = counts
                .entry(serde_json::to_string(pitches)?)
                .or_insert((pitches.clone(), 0));
            entry.1 += 1;
        }
        let mut ranked: Vec<_> = counts.into_iter().collect();
        ranked.sort_by(|a, b| b.1.1.cmp(&a.1.1).then(a.0.cmp(&b.0)));
        let tied = ranked.len() > 1 && ranked[0].1.1 == ranked[1].1.1;
        for &i in indices {
            let cell = &mut melody_cells[i];
            cell.rhythm_occurrences = indices.len();
            cell.template_tied = tied;
            if !tied {
                let pitches = ranked[0].1.0.clone();
                cell.pitch_differences = pitches
                    .iter()
                    .enumerate()
                    .filter(|(i, p)| **p != cell.absolute_pitches[*i])
                    .map(|(i, &p)| HarmonicPitchDifference {
                        note_id: cell.note_ids[i].clone(),
                        index: i,
                        observed_millicents: cell.absolute_pitches[i],
                        template_millicents: p,
                    })
                    .collect();
                cell.template_pitches = Some(pitches);
            }
        }
    }
    let merged_reattacks = held_runs.iter().map(|x| x.note_ids.len() - 1).sum();
    Ok(HarmonicRegionAnalysis{parameters,held_runs,cohorts,families,harmonic_runs,melody_cells,diagnostics:HarmonicDiagnostics{selected_note_count:selected.len(),candidate_members,context_members,merged_reattacks,excluded_expressive_note_ids,excluded_percussion_note_ids,excluded_zero_duration_note_ids,ambiguous_parts,unsupported_release_groups,limitations:vec![
        "Exact release timing and constant native attack pitch are grouping assumptions; no pedal/controller interpretation.",
        "Touching same-pitch attacks join only across releases not shared by two or more pitches; every attack ID remains evidence.",
        "Dominant recurrent support per part is a declared accompaniment prior; repeated parts are not pooled as independent observations.",
        "Gap contrast, recurrence count and support cardinality are heuristics; tied leading families remain unresolved.",
        "Complement notes are onset-owned within inferred support spans, not independently separated or inferred melody voices.",
        "Native performance, dynamics and attachments remain in Score; summaries and pitch-template differences are not a standalone codec."
    ].into_iter().map(String::from).collect()}})
}

/// Semantic overlay memberships/parameter equivalences are derived here, not
/// reconstructed from rectangles or recomputed by a display filter. Generic
/// event parameters are added by the shared structure batch separately.
pub fn harmonic_structure_regions(
    analysis: &HarmonicRegionAnalysis,
    namespace: &str,
) -> CoreResult<Vec<crate::structure::StructureRegionInput>> {
    use crate::structure::{StructureParameter as Parameter, StructureRegionInput as Region};
    use std::collections::BTreeMap;
    let parameter =
        |key: &str, label: &str, value: String, display: String, projection: &str| Parameter {
            key: key.into(),
            value,
            label: Some(label.into()),
            display_value: Some(display),
            projection: Some(projection.into()),
        };
    let id = |value: &str| format!("harmonic:{namespace}{value}");
    let pitch_class = |pitch: i64| pitch.rem_euclid(1200000);
    let cents = |pitch: i128| {
        let abs = pitch.abs();
        let remainder = format!("{:03}", abs % 1000);
        let fraction = remainder.trim_end_matches('0');
        format!(
            "{}{}{}",
            if pitch < 0 { "−" } else { "" },
            abs / 1000,
            if fraction.is_empty() {
                String::new()
            } else {
                format!(".{fraction}")
            }
        )
    };
    let pitch_name = |pitch: i64| {
        let value = pitch_class(pitch);
        if value % 100000 == 0 {
            [
                "C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B",
            ][(value / 100000) as usize]
                .to_string()
        } else {
            format!("{}¢", cents(value as i128))
        }
    };
    let chord = |run: &HarmonicRun| {
        let pitches: Vec<_> = run
            .support_pitches
            .iter()
            .map(|&x| pitch_class(x))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let name = if run.quality == "open-fifth" {
            format!("{} open fifth", pitch_name(run.bass_millicents))
        } else {
            pitches
                .iter()
                .map(|&x| pitch_name(x))
                .collect::<Vec<_>>()
                .join("–")
        };
        let value =
            serde_json::to_string(&pitches.iter().map(ToString::to_string).collect::<Vec<_>>())
                .unwrap();
        parameter(
            "support-chord",
            "Support sonority",
            value,
            name,
            "Exact observed support pitch classes, folded by octaves. The lowest support pitch anchors open-fifth naming; a missing third does not establish major/minor quality or chord function. Native pitches are not rounded to twelve-tone keys.",
        )
    };
    let family_for: HashMap<_, _> = analysis
        .families
        .iter()
        .filter(|x| x.selected)
        .flat_map(|x| x.cohort_ids.iter().map(move |id| (id.as_str(), x)))
        .collect();
    let cohort_by: HashMap<_, _> = analysis
        .cohorts
        .iter()
        .map(|x| (x.id.as_str(), x))
        .collect();
    let run_by: HashMap<_, _> = analysis
        .harmonic_runs
        .iter()
        .map(|x| (x.id.as_str(), x))
        .collect();
    let mut regions: Vec<Region> = vec![];
    let mut cohort_regions: HashMap<String, usize> = HashMap::new();
    for run in &analysis.harmonic_runs {
        let family = run
            .cohort_ids
            .iter()
            .find_map(|id| family_for.get(id.as_str()));
        let shared = parameter(
            "material",
            "Shared material",
            format!(
                "harmonic:support:{}",
                family
                    .map(|x| x.shape_key.as_str())
                    .unwrap_or(run.id.as_str())
            ),
            format!("{}-pitch support family", run.support_pitches.len()),
            "Observed repeated support shape under the inference method. This is a candidate family, not a decoded composition material.",
        );
        let sonority = chord(run);
        let label = sonority.display_value.clone().unwrap();
        regions.push(Region {
            id: id(&run.id),
            label: format!("{label} · support span"),
            kind: "harmonic support span".into(),
            note_ids: run.note_ids.clone(),
            parent_ids: None,
            parameters: vec![shared.clone(), sonority.clone()],
        });
        for cohort_id in &run.cohort_ids {
            let cohort = cohort_by
                .get(cohort_id.as_str())
                .ok_or_else(|| invalid("Unknown support cohort in harmonic run."))?;
            if !cohort.selected {
                continue;
            }
            if let Some(&index) = cohort_regions.get(&cohort.id) {
                regions[index]
                    .parent_ids
                    .get_or_insert_default()
                    .push(id(&run.id));
                continue;
            }
            cohort_regions.insert(cohort.id.clone(), regions.len());
            regions.push(Region {
                id: id(&cohort.id),
                label: format!("{label} · support cell"),
                kind: "repeated support cohort".into(),
                note_ids: cohort.note_ids.clone(),
                parent_ids: Some(vec![id(&run.id)]),
                parameters: vec![shared.clone(), sonority.clone()],
            });
        }
    }
    let mut rhythms: HashMap<&str, usize> = HashMap::new();
    for cell in &analysis.melody_cells {
        let run = run_by
            .get(cell.run_id.as_str())
            .ok_or_else(|| invalid("Unknown harmonic run in melody cell."))?;
        if cell.bass_relative_millicents.len() != cell.attack_offsets_ticks.len() {
            return Err(invalid("Malformed melody relative-pitch observations."));
        }
        let next = rhythms.len();
        let index = *rhythms.entry(&cell.rhythm_key).or_insert(next);
        let family = if index < 26 {
            ((b'A' + index as u8) as char).to_string()
        } else {
            (index + 1).to_string()
        };
        let change = cell
            .pitch_differences
            .first()
            .map(|x| {
                format!(
                    " · {}→{}{}",
                    pitch_name(x.template_millicents),
                    pitch_name(x.observed_millicents),
                    if cell.pitch_differences.len() > 1 {
                        format!(" +{}", cell.pitch_differences.len() - 1)
                    } else {
                        String::new()
                    }
                )
            })
            .unwrap_or_default();
        let mut groups: BTreeMap<u64, Vec<i128>> = BTreeMap::new();
        for (i, value) in cell.bass_relative_millicents.iter().enumerate() {
            groups
                .entry(cell.attack_offsets_ticks[i])
                .or_default()
                .push(
                    value
                        .parse()
                        .map_err(|_| invalid("Invalid native-pitch interval."))?,
                );
        }
        let groups: Vec<_> = groups
            .into_values()
            .map(|mut x| {
                x.sort();
                x
            })
            .collect();
        let sequence = |classes: bool| {
            groups
                .iter()
                .map(|group| {
                    let values = group
                        .iter()
                        .map(|&pitch| {
                            if classes {
                                let reduced = pitch.rem_euclid(1200000);
                                if reduced % 100000 == 0 {
                                    (reduced / 100000).to_string()
                                } else {
                                    format!("{}¢", cents(reduced))
                                }
                            } else {
                                cents(pitch)
                            }
                        })
                        .collect::<Vec<_>>();
                    if values.len() == 1 {
                        values[0].clone()
                    } else {
                        format!("{{{}}}", values.join(", "))
                    }
                })
                .collect::<Vec<_>>()
                .join(", ")
        };
        let display = if cell.note_ids.is_empty() {
            "no complement notes".into()
        } else {
            format!(
                "{} cents; pitch classes {} above bass",
                sequence(false),
                sequence(true)
            )
        };
        let mut parameters = vec![
            parameter(
                "material",
                "Shared material",
                format!("harmonic:melody:{}", cell.rhythm_key),
                format!("Melody timing {family}"),
                "Cell span and onset/duration pairs, including initial silence and coincident attacks, modulo exact uniform time scaling. Pitches and velocity are omitted. The observed pitch template is chosen separately within each part; these are support-conditioned cells, not inferred melody-phrase boundaries.",
            ),
            chord(run),
            parameter(
                "melody-relative-bass",
                "Melody relative to bass",
                serde_json::to_string(
                    &groups
                        .iter()
                        .map(|x| x.iter().map(ToString::to_string).collect::<Vec<_>>())
                        .collect::<Vec<_>>(),
                )?,
                display,
                "Native attack-pitch intervals above the observed lowest support pitch, which is not a confirmed chord root. Canonical groups preserve successive attacks, octaves, multiplicity and unordered simultaneous membership; exact spacing and durations are omitted. Braces mark simultaneous notes. Whole-number classes are semitones modulo octave, not scale degrees or inferred key/spelling; other classes stay in cents.",
            ),
        ];
        if cell.note_ids.is_empty() {
            parameters.push(parameter(
                "note-count",
                "Selected note count",
                "0".into(),
                "0".into(),
                "Empty complement membership; no pitch or attack shape inferred.",
            ));
        }
        regions.push(Region {
            id: id(&cell.id),
            label: format!("Melody {family}{change}"),
            kind: "support-conditioned complement cell".into(),
            note_ids: cell.note_ids.clone(),
            parent_ids: Some(vec![id(&run.id)]),
            parameters,
        });
    }
    Ok(regions)
}
