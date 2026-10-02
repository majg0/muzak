//! Global harmonic-span hypothesis, separate from rhythmic realization.
//!
//! The bounded segmental objective is informed by Temperley & Sleator (1999),
//! pp. 17–18: pitch/root compatibility, metrically weighted change penalties,
//! and dynamic programming. https://davidtemperley.com/wp-content/uploads/2015/11/temperley-sleator-cmj99.pdf
//! This is NOT their spelling/ornament model or a trained probability model.
//! Exact source events and alternatives survive. The context module separately
//! proposes a functional root from bass/resolution evidence; general function,
//! ornamental roles, voice separation and meter are not inferred here.
use crate::{
    error::{CoreResult, budget, invalid},
    harmony_context::{HarmonyContextOptions, HarmonyFunctionalRoot, contextual_harmonic_roots},
    meter::{MeterSegment as Meter, meter_segments, metrical_position},
    model::*,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use ts_rs::TS;

const SEMITONE: i64 = 100_000;
const OCTAVE: i64 = 1_200_000;
const PITCH_NAMES: [&str; 12] = [
    "C",
    "C♯/D♭",
    "D",
    "D♯/E♭",
    "E",
    "F",
    "F♯/G♭",
    "G",
    "G♯/A♭",
    "A",
    "A♯/B♭",
    "B",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyTemplate {
    pub id: String,
    pub label: String,
    /// Relative pitch classes, in native millicents, including zero.
    pub core_intervals: Vec<i64>,
    /// Permitted non-core pitch classes. A color is a relation, not a function.
    pub color_intervals: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct HarmonyOptions {
    pub templates: Vec<HarmonyTemplate>,
    pub subdivisions_per_denominator_pulse: u64,
    pub max_span_steps: usize,
    pub overlap_weight: f64,
    pub attack_weight: f64,
    pub metric_attack_weight: f64,
    pub velocity_weight: f64,
    /// One normalizes each part independently; zero retains relative note mass.
    pub part_normalization: f64,
    pub color_cost: f64,
    pub missing_core_cost: f64,
    pub complexity_cost: f64,
    pub boundary_cost: f64,
    pub weak_boundary_cost: f64,
    /// Cost per silent quarter bridged by a sounding harmonic span.
    pub silence_bridge_cost: f64,
    pub ambiguity_margin: f64,
    pub min_core_coverage: f64,
    pub max_alternatives: usize,
    pub max_lattice_points: usize,
    pub max_candidate_spans: usize,
    pub max_hypothesis_evaluations: usize,
    pub max_evidence_visits: usize,
    pub max_output_members: usize,
    /// Lattice endpoints times candidate labels; bounds DP/trace storage.
    pub max_state_cells: usize,
    /// Optional bass-and-resolution interpretation; realized sonorities stay separate.
    pub context: Option<HarmonyContextOptions>,
}
impl Default for HarmonyOptions {
    fn default() -> Self {
        let template = |id: &str, label: &str, core: &[i64], colors: &[i64]| HarmonyTemplate {
            id: id.into(),
            label: label.into(),
            core_intervals: core.iter().map(|n| n * SEMITONE).collect(),
            color_intervals: colors.iter().map(|n| n * SEMITONE).collect(),
        };
        Self {
            templates: vec![
                template("open-fifth", "open fifth", &[0, 7], &[2, 5, 9, 10, 11]),
                template("major", "major", &[0, 4, 7], &[2, 5, 9, 10, 11]),
                template("minor", "minor", &[0, 3, 7], &[2, 5, 9, 10, 11]),
                template("diminished", "diminished", &[0, 3, 6], &[2, 5, 9, 10, 11]),
                template("augmented", "augmented", &[0, 4, 8], &[2, 5, 9, 10, 11]),
                template(
                    "dominant-seventh",
                    "dominant seventh",
                    &[0, 4, 7, 10],
                    &[2, 5, 9],
                ),
                template("major-seventh", "major seventh", &[0, 4, 7, 11], &[2, 5, 9]),
                template("minor-seventh", "minor seventh", &[0, 3, 7, 10], &[2, 5, 9]),
                template(
                    "half-diminished",
                    "half diminished",
                    &[0, 3, 6, 10],
                    &[2, 5, 8],
                ),
                template(
                    "diminished-seventh",
                    "diminished seventh",
                    &[0, 3, 6, 9],
                    &[2, 5, 8],
                ),
            ],
            subdivisions_per_denominator_pulse: 2,
            max_span_steps: 32,
            overlap_weight: 1.0,
            attack_weight: 0.15,
            metric_attack_weight: 0.15,
            velocity_weight: 0.15,
            part_normalization: 0.0,
            color_cost: 0.35,
            missing_core_cost: 0.2,
            complexity_cost: 0.035,
            boundary_cost: 0.03,
            weak_boundary_cost: 0.015,
            silence_bridge_cost: 0.1,
            ambiguity_margin: 0.0,
            min_core_coverage: 0.66,
            max_alternatives: 4,
            max_lattice_points: 20_000,
            max_candidate_spans: 600_000,
            max_hypothesis_evaluations: 30_000_000,
            max_evidence_visits: 2_000_000,
            max_output_members: 500_000,
            max_state_cells: 3_000_000,
            context: Some(HarmonyContextOptions::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyHypothesis {
    /// Absolute root pitch class, not an octave/register estimate.
    pub root_millicents: i64,
    pub template_id: String,
    pub label: String,
    pub core_intervals: Vec<i64>,
    /// Only permitted colors actually observed in this window.
    pub color_intervals: Vec<i64>,
    pub score: f64,
    pub core_coverage: f64,
    pub core_mass_fraction: f64,
    /// Best complete-path cost increase when this returned run is forced to this
    /// label, retaining its computational subdivisions. Zero is path-optimal.
    /// Normalized by the run's evidence mass; not a posterior probability.
    pub contextual_cost: Option<f64>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum HarmonyNoteRole {
    Core,
    Color,
    Residual,
    Unsupported,
    Percussion,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyNoteRelation {
    pub note_id: String,
    pub role: HarmonyNoteRole,
    /// Relative pitch class in millicents; absent without a selected root.
    pub interval: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyRhythmNote {
    pub note_id: String,
    /// Signed source attack offset; held-in notes can precede the window.
    pub onset_offset_ticks: i64,
    pub duration_ticks: u64,
    pub overlap_ticks: u64,
    pub carried_in: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyPartRhythm {
    pub part: String,
    pub notes: Vec<HarmonyRhythmNote>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyWindow {
    pub id: String,
    pub start_tick: u64,
    pub end_tick: u64,
    pub label: String,
    pub rest: bool,
    pub note_ids: Vec<String>,
    pub core_note_ids: Vec<String>,
    pub color_note_ids: Vec<String>,
    pub residual_note_ids: Vec<String>,
    pub unsupported_note_ids: Vec<String>,
    pub percussion_note_ids: Vec<String>,
    pub alternatives: Vec<HarmonyHypothesis>,
    pub selected: Option<usize>,
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub functional_root: Option<HarmonyFunctionalRoot>,
    pub ambiguity_gap: Option<f64>,
    /// Gap between independent whole-window fits, before surrounding context.
    pub local_ambiguity_gap: Option<f64>,
    pub roles: Vec<HarmonyNoteRelation>,
    pub rhythms: Vec<HarmonyPartRhythm>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyLatticePoint {
    pub tick: u64,
    pub metric_strength: Option<f64>,
    pub origins: Vec<String>,
    /// A label may change here only with an eligible attack/release or an
    /// explicit rest/meter edge. Other points are computational cuts only.
    pub change_supported: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyRestInterval {
    pub start_tick: u64,
    pub end_tick: u64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonyWork {
    pub candidate_spans: usize,
    pub hypothesis_evaluations: usize,
    pub evidence_visits: usize,
    pub output_members: usize,
    pub collapsed_part_profiles: usize,
    pub unrepresentable_lattice_points: usize,
    pub state_cells: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GlobalHarmonyAnalysis {
    pub parameters: HarmonyOptions,
    pub windows: Vec<HarmonyWindow>,
    pub lattice: Vec<HarmonyLatticePoint>,
    /// Every exact gap in positive-duration pitched notes, independently of
    /// whether a harmonic window bridges an articulation gap.
    pub rests: Vec<HarmonyRestInterval>,
    pub work: HarmonyWork,
    pub off_grid_note_ids: Vec<String>,
    pub unsupported_note_ids: Vec<String>,
    pub percussion_note_ids: Vec<String>,
    pub diagnostics: Vec<String>,
    pub limitations: Vec<String>,
}

fn validate_options(p: &HarmonyOptions) -> CoreResult<()> {
    if p.templates.is_empty()
        || p.templates.len() > 64
        || p.subdivisions_per_denominator_pulse == 0
        || p.subdivisions_per_denominator_pulse > 64
        || p.max_span_steps == 0
        || p.max_alternatives == 0
        || p.max_alternatives > 64
    {
        return Err(invalid(
            "Invalid harmony templates, lattice subdivision, span or alternatives bound.",
        ));
    }
    let mut ids = HashSet::new();
    for t in &p.templates {
        let core: BTreeSet<_> = t.core_intervals.iter().copied().collect();
        let colors: BTreeSet<_> = t.color_intervals.iter().copied().collect();
        if t.id.is_empty()
            || !ids.insert(&t.id)
            || core.len() != t.core_intervals.len()
            || colors.len() != t.color_intervals.len()
            || core.len() < 2
            || !core.contains(&0)
            || core
                .iter()
                .chain(&colors)
                .any(|n| !(0..OCTAVE).contains(n) || n % SEMITONE != 0)
            || !core.is_disjoint(&colors)
        {
            return Err(invalid(
                "Harmony templates require unique IDs, distinct 12-TET core/color classes, and a root in a core of at least two classes.",
            ));
        }
    }
    for value in [
        p.overlap_weight,
        p.attack_weight,
        p.metric_attack_weight,
        p.velocity_weight,
        p.color_cost,
        p.missing_core_cost,
        p.complexity_cost,
        p.boundary_cost,
        p.weak_boundary_cost,
        p.silence_bridge_cost,
        p.ambiguity_margin,
    ] {
        if !value.is_finite() || !(0.0..=1_000.0).contains(&value) {
            return Err(invalid(
                "Harmony weights must be finite and between zero and 1000.",
            ));
        }
    }
    if p.overlap_weight == 0.0
        || p.velocity_weight > 1.0
        || !p.part_normalization.is_finite()
        || !(0.0..=1.0).contains(&p.part_normalization)
        || !p.min_core_coverage.is_finite()
        || !(0.0..=1.0).contains(&p.min_core_coverage)
    {
        return Err(invalid(
            "Harmony overlap weight must be positive; core coverage must be between zero and one.",
        ));
    }
    Ok(())
}

fn charge(count: &mut usize, amount: usize, limit: usize, label: &str) -> CoreResult<()> {
    *count = count
        .checked_add(amount)
        .ok_or_else(|| budget(format!("Harmony {label} budget exceeded.")))?;
    if *count > limit {
        return Err(budget(format!(
            "Harmony {label} budget exceeded ({count} > {limit})."
        )));
    }
    Ok(())
}

fn metric_strength(meters: &[Meter], ppq: u64, tick: u64) -> Option<f64> {
    let position = metrical_position(meters, ppq, tick)?;
    Some(if position.bar {
        1.0
    } else if position.compound_group {
        0.75
    } else if position.denominator_beat {
        0.5
    } else {
        0.0
    })
}

fn add_boundary(
    points: &mut BTreeMap<u64, BTreeSet<String>>,
    tick: u64,
    origin: &str,
    max: usize,
) -> CoreResult<()> {
    points.entry(tick).or_default().insert(origin.into());
    if points.len() > max {
        return Err(budget("Harmony lattice-point budget exceeded."));
    }
    Ok(())
}

fn lattice(
    score: &Score,
    p: &HarmonyOptions,
    meters: &[Meter],
    percussion: &HashSet<&str>,
    work: &mut HarmonyWork,
) -> CoreResult<Vec<HarmonyLatticePoint>> {
    let mut points = BTreeMap::new();
    add_boundary(&mut points, 0, "score-endpoint", p.max_lattice_points)?;
    add_boundary(
        &mut points,
        score.duration,
        "score-endpoint",
        p.max_lattice_points,
    )?;
    for meter in meters {
        let end = meter.end_tick.min(score.duration);
        let (pulse_numerator, pulse_denominator) =
            match (meter.denominator, meter.notated32nds_per_quarter) {
                (Some(d), Some(bb)) => (32 * score.ppq as u128, d as u128 * bb as u128),
                _ => (score.ppq as u128, 1),
            };
        let denominator = pulse_denominator * p.subdivisions_per_denominator_pulse as u128;
        let numerator = pulse_numerator;
        let origin = if meter.numerator.is_some() {
            meter.phase_origin_tick
        } else {
            0
        };
        let first_phase = (meter.start_tick - origin) as u128 * denominator;
        let first = first_phase.div_ceil(numerator);
        let last = (end - origin) as u128 * denominator / numerator;
        let count = last.saturating_sub(first) + 1;
        // Bound rational proposals as well as stored representable points.
        if count > p.max_lattice_points as u128 {
            return Err(budget(
                "Harmony rational lattice proposal budget exceeded; increase maxLatticePoints or reduce subdivision.",
            ));
        }
        for step in first..=last {
            let offset = step * numerator;
            if offset % denominator != 0 {
                charge(
                    &mut work.unrepresentable_lattice_points,
                    1,
                    p.max_lattice_points,
                    "unrepresentable lattice",
                )?;
                continue;
            }
            add_boundary(
                &mut points,
                origin + (offset / denominator) as u64,
                if meter.numerator.is_some() {
                    "meter-lattice"
                } else {
                    "fallback-lattice"
                },
                p.max_lattice_points,
            )?;
        }
        add_boundary(
            &mut points,
            meter.start_tick,
            "meter-origin",
            p.max_lattice_points,
        )?;
    }
    // Exact silence edges are admissible exceptions to the metric lattice.
    // They expose rests without quantizing note ends or swallowing short gaps.
    let mut intervals: Vec<_> = score
        .notes
        .iter()
        .filter(|n| n.duration > 0 && !percussion.contains(n.part.as_str()))
        .map(|n| (n.onset, n.onset + n.duration))
        .collect();
    intervals.sort_unstable();
    let mut end = 0;
    for (start, finish) in intervals {
        if start > end {
            add_boundary(&mut points, end, "pitched-rest-edge", p.max_lattice_points)?;
            add_boundary(
                &mut points,
                start,
                "pitched-rest-edge",
                p.max_lattice_points,
            )?;
        }
        end = end.max(finish);
    }
    if end < score.duration {
        add_boundary(&mut points, end, "pitched-rest-edge", p.max_lattice_points)?;
    }
    for note in score
        .notes
        .iter()
        .filter(|n| eligible(n) && !percussion.contains(n.part.as_str()))
    {
        if let Some(origins) = points.get_mut(&note.onset) {
            origins.insert("eligible-attack".into());
        }
        if let Some(origins) = points.get_mut(&(note.onset + note.duration)) {
            origins.insert("eligible-release".into());
        }
    }
    Ok(points
        .into_iter()
        .map(|(tick, origins)| HarmonyLatticePoint {
            tick,
            metric_strength: metric_strength(meters, score.ppq, tick),
            change_supported: origins.iter().any(|o| {
                matches!(
                    o.as_str(),
                    "eligible-attack"
                        | "eligible-release"
                        | "pitched-rest-edge"
                        | "meter-origin"
                        | "score-endpoint"
                )
            }),
            origins: origins.into_iter().collect(),
        })
        .collect())
}

fn eligible(note: &ScoreNote) -> bool {
    note.duration > 0
        && note.pitch.millicents % SEMITONE == 0
        && note
            .pitch_envelope
            .as_ref()
            .is_none_or(|curve| curve.iter().all(|p| p.pitch == note.pitch))
}

struct Evidence {
    prefix: Vec<[f64; 12]>,
    sounding_prefix: Vec<usize>,
    sounding_ticks_prefix: Vec<u64>,
}
fn evidence(
    score: &Score,
    p: &HarmonyOptions,
    grid: &[HarmonyLatticePoint],
    meters: &[Meter],
    percussion: &HashSet<&str>,
    work: &mut HarmonyWork,
) -> CoreResult<Evidence> {
    let cells = grid.len().saturating_sub(1);
    let mut sounding = vec![false; cells];
    let mut profiles: BTreeMap<(usize, &str), [f64; 12]> = BTreeMap::new();
    let mut notes: Vec<_> = score
        .notes
        .iter()
        .filter(|n| n.duration > 0 && !percussion.contains(n.part.as_str()))
        .collect();
    notes.sort_by_key(|n| (n.onset, n.pitch.millicents, n.duration, n.id.as_str()));
    for note in notes {
        let end = note.onset + note.duration;
        let mut cell = grid
            .partition_point(|g| g.tick <= note.onset)
            .saturating_sub(1);
        while cell < cells && grid[cell].tick < end {
            charge(
                &mut work.evidence_visits,
                1,
                p.max_evidence_visits,
                "note/lattice incidence",
            )?;
            let overlap = end.min(grid[cell + 1].tick) - note.onset.max(grid[cell].tick);
            if overlap > 0 {
                sounding[cell] = true;
                if eligible(note) {
                    let attack = note.onset >= grid[cell].tick;
                    let weight = (p.overlap_weight * overlap as f64 / score.ppq as f64
                        + if attack {
                            p.attack_weight
                                + p.metric_attack_weight
                                    * metric_strength(meters, score.ppq, note.onset).unwrap_or(0.0)
                        } else {
                            0.0
                        })
                        * (1.0 + p.velocity_weight * note.velocity as f64 / 127.0);
                    profiles
                        .entry((cell, note.part.as_str()))
                        .or_insert([0.0; 12])
                        [(note.pitch.millicents.rem_euclid(OCTAVE) / SEMITONE) as usize] += weight;
                }
            }
            cell += 1;
        }
    }
    let mut global = vec![[0.0; 12]; cells];
    let mut current_cell = usize::MAX;
    let mut unique = BTreeMap::<[u64; 12], f64>::new();
    for ((cell, _), mut profile) in profiles {
        if cell != current_cell {
            unique.clear();
            current_cell = cell;
        }
        let total: f64 = profile.iter().sum();
        if total == 0.0 {
            continue;
        }
        for value in &mut profile {
            *value /= total;
        }
        let key = profile.map(f64::to_bits);
        let amplitude = total.powf(1.0 - p.part_normalization);
        let previous = unique.get(&key).copied().unwrap_or(0.0);
        if previous > 0.0 {
            work.collapsed_part_profiles += 1;
        }
        if amplitude > previous {
            unique.insert(key, amplitude);
            for (target, value) in global[cell].iter_mut().zip(profile) {
                *target += value * (amplitude - previous);
            }
        }
    }
    let mut prefix = vec![[0.0; 12]; cells + 1];
    let mut sounding_prefix = vec![0; cells + 1];
    let mut sounding_ticks_prefix = vec![0; cells + 1];
    for cell in 0..cells {
        let scale = (grid[cell + 1].tick - grid[cell].tick) as f64
            / score.ppq as f64
            / global[cell].iter().sum::<f64>().max(1e-30);
        for pc in 0..12 {
            prefix[cell + 1][pc] = prefix[cell][pc] + global[cell][pc] * scale;
        }
        sounding_prefix[cell + 1] = sounding_prefix[cell] + usize::from(sounding[cell]);
        sounding_ticks_prefix[cell + 1] = sounding_ticks_prefix[cell]
            + if sounding[cell] {
                grid[cell + 1].tick - grid[cell].tick
            } else {
                0
            };
    }
    Ok(Evidence {
        prefix,
        sounding_prefix,
        sounding_ticks_prefix,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Choice {
    template: usize,
    root: usize,
}
#[derive(Clone)]
struct Fit {
    choice: Choice,
    loss: f64,
    coverage: f64,
    core_mass: f64,
}
fn distribution(e: &Evidence, start: usize, end: usize) -> [f64; 12] {
    std::array::from_fn(|pc| (e.prefix[end][pc] - e.prefix[start][pc]).max(0.0))
}
fn fits(mass: &[f64; 12], p: &HarmonyOptions, work: &mut HarmonyWork) -> CoreResult<Vec<Fit>> {
    let total: f64 = mass.iter().sum();
    if total < 1e-12 {
        return Ok(vec![]);
    }
    charge(
        &mut work.hypothesis_evaluations,
        p.templates.len() * 12,
        p.max_hypothesis_evaluations,
        "hypothesis evaluation",
    )?;
    let mut fits = Vec::new();
    for (template, t) in p.templates.iter().enumerate() {
        for root in 0..12 {
            let core_mass: f64 = t
                .core_intervals
                .iter()
                .map(|n| mass[(root + (*n / SEMITONE) as usize) % 12])
                .sum();
            let core_count = t
                .core_intervals
                .iter()
                .filter(|n| mass[(root + (**n / SEMITONE) as usize) % 12] > total * 1e-9)
                .count();
            let coverage = core_count as f64 / t.core_intervals.len() as f64;
            if core_count < 2 || coverage < p.min_core_coverage {
                continue;
            }
            let colors: f64 = t
                .color_intervals
                .iter()
                .map(|n| mass[(root + (*n / SEMITONE) as usize) % 12])
                .sum();
            let other = (total - core_mass - colors).max(0.0);
            let loss = other
                + p.color_cost * colors
                + total
                    * (p.missing_core_cost * (1.0 - coverage)
                        + p.complexity_cost * t.core_intervals.len().saturating_sub(2) as f64);
            fits.push(Fit {
                choice: Choice { template, root },
                loss,
                coverage,
                core_mass,
            });
        }
    }
    fits.sort_by(|a, b| {
        a.loss
            .total_cmp(&b.loss)
            .then_with(|| {
                p.templates[a.choice.template]
                    .id
                    .cmp(&p.templates[b.choice.template].id)
            })
            .then(a.choice.root.cmp(&b.choice.root))
    });
    Ok(fits)
}

#[derive(Clone)]
struct Span {
    start: usize,
    end: usize,
    rest: bool,
    choice: Option<Choice>,
    // These subdivisions carry the searched objective when equal labels merge.
    pieces: Vec<(usize, usize)>,
    contextual: Vec<(Choice, f64)>,
}
#[derive(Clone, Copy, Default)]
struct Trace {
    start: u32,
    previous: u16,
}
fn state(choice: Choice) -> usize {
    choice.template * 12 + choice.root
}
fn choice(state: usize, unknown: usize) -> Option<Choice> {
    (state != unknown).then_some(Choice {
        template: state / 12,
        root: state % 12,
    })
}
fn best_two(row: &[f64]) -> [usize; 2] {
    let mut best = [usize::MAX; 2];
    for (index, &cost) in row.iter().enumerate() {
        if !cost.is_finite() {
            continue;
        }
        if best[0] == usize::MAX || cost < row[best[0]] {
            best[1] = best[0];
            best[0] = index;
        } else if best[1] == usize::MAX || cost < row[best[1]] {
            best[1] = index;
        }
    }
    best
}
// A change penalty depends only on the boundary and whether the label changes.
// Consequently same-label vs. best different-label is exact, not beam pruning.
fn joined(row: &[f64], best: [usize; 2], label: usize, change: f64) -> (f64, usize) {
    let other = if best[0] == label { best[1] } else { best[0] };
    let different = if other == usize::MAX {
        f64::INFINITY
    } else {
        row[other] + change
    };
    if row[label] <= different {
        (row[label], label)
    } else {
        (different, other)
    }
}
fn change_cost(grid: &[HarmonyLatticePoint], at: usize, p: &HarmonyOptions) -> f64 {
    if grid[at].change_supported {
        p.boundary_cost + p.weak_boundary_cost * (1.0 - grid[at].metric_strength.unwrap_or(0.0))
    } else {
        f64::INFINITY
    }
}
fn span_fits(
    grid: &[HarmonyLatticePoint],
    e: &Evidence,
    p: &HarmonyOptions,
    ppq: u64,
    start: usize,
    end: usize,
    work: &mut HarmonyWork,
) -> CoreResult<Vec<(usize, f64)>> {
    charge(
        &mut work.candidate_spans,
        1,
        p.max_candidate_spans,
        "candidate span evaluation",
    )?;
    let mass = distribution(e, start, end);
    let ranked = fits(&mass, p, work)?;
    let sounding = e.sounding_prefix[end] - e.sounding_prefix[start];
    let silent_ticks = grid[end].tick
        - grid[start].tick
        - (e.sounding_ticks_prefix[end] - e.sounding_ticks_prefix[start]);
    let silence = if sounding == 0 {
        0.0
    } else {
        p.silence_bridge_cost * silent_ticks as f64 / ppq as f64
    };
    let mut losses: Vec<_> = ranked
        .into_iter()
        .map(|f| (state(f.choice), f.loss + silence))
        .collect();
    // Unknown remains feasible when unsupported change points and the span cap
    // prevent every labelled path. Inference limitations never reject a score.
    losses.push((p.templates.len() * 12, mass.iter().sum::<f64>() + silence));
    Ok(losses)
}
fn segment(
    grid: &[HarmonyLatticePoint],
    e: &Evidence,
    p: &HarmonyOptions,
    ppq: u64,
    work: &mut HarmonyWork,
) -> CoreResult<Vec<Span>> {
    let labels = p.templates.len() * 12 + 1;
    let unknown = labels - 1;
    let count = grid
        .len()
        .checked_mul(labels)
        .ok_or_else(|| budget("Harmony state storage budget exceeded."))?;
    if count > p.max_state_cells || grid.len() > u32::MAX as usize {
        return Err(budget("Harmony state storage budget exceeded."));
    }
    work.state_cells = count;
    let mut forward = vec![f64::INFINITY; count];
    let mut backward = vec![f64::INFINITY; count];
    let mut trace = vec![Trace::default(); count];
    let mut forward_best = vec![[usize::MAX; 2]; grid.len()];
    let mut backward_best = forward_best.clone();
    for end in 1..grid.len() {
        for start in end.saturating_sub(p.max_span_steps)..end {
            for (label, loss) in span_fits(grid, e, p, ppq, start, end, work)? {
                let (prefix, previous) = if start == 0 {
                    (0.0, unknown)
                } else {
                    joined(
                        &forward[start * labels..(start + 1) * labels],
                        forward_best[start],
                        label,
                        change_cost(grid, start, p),
                    )
                };
                let cost = prefix + loss;
                let slot = end * labels + label;
                // Earlier predecessor on a numerical tie favors fewer internal
                // subdivisions. No additional likelihood or confidence is implied.
                if cost < forward[slot] - 1e-10
                    || cost.is_finite()
                        && (cost - forward[slot]).abs() <= 1e-10
                        && start < trace[slot].start as usize
                {
                    forward[slot] = cost;
                    trace[slot] = Trace {
                        start: start as u32,
                        previous: previous as u16,
                    };
                }
            }
        }
        forward_best[end] = best_two(&forward[end * labels..(end + 1) * labels]);
    }
    let last = grid.len() - 1;
    for start in (0..last).rev() {
        for end in start + 1..=last.min(start.saturating_add(p.max_span_steps)) {
            for (label, loss) in span_fits(grid, e, p, ppq, start, end, work)? {
                let suffix = if end == last {
                    0.0
                } else {
                    joined(
                        &backward[end * labels..(end + 1) * labels],
                        backward_best[end],
                        label,
                        change_cost(grid, end, p),
                    )
                    .0
                };
                let slot = start * labels + label;
                backward[slot] = backward[slot].min(loss + suffix);
            }
        }
        backward_best[start] = best_two(&backward[start * labels..(start + 1) * labels]);
    }
    let mut label = forward_best[last][0];
    if label == usize::MAX {
        return Err(invalid("Harmony lattice has no complete segmentation."));
    }
    let optimum = forward[last * labels + label];
    let mut end = last;
    let mut result = Vec::new();
    while end > 0 {
        let step = trace[end * labels + label];
        let start = step.start as usize;
        result.push(Span {
            start,
            end,
            rest: e.sounding_prefix[end] == e.sounding_prefix[start],
            choice: choice(label, unknown),
            pieces: vec![(start, end)],
            contextual: vec![],
        });
        end = start;
        label = step.previous as usize;
    }
    result.reverse();
    let mut merged = Vec::<Span>::new();
    for span in result {
        if let Some(previous) = merged
            .last_mut()
            .filter(|s| s.rest == span.rest && s.choice == span.choice)
        {
            previous.end = span.end;
            previous.pieces.extend(span.pieces);
        } else {
            merged.push(span);
        }
    }
    for span in &mut merged {
        if span.choice.is_none() {
            continue;
        }
        let mut losses = vec![0.0; labels];
        for &(start, end) in &span.pieces {
            let mut piece = vec![f64::INFINITY; labels];
            for (label, cost) in span_fits(grid, e, p, ppq, start, end, work)? {
                piece[label] = cost;
            }
            for (loss, cost) in losses.iter_mut().zip(piece) {
                *loss += cost;
            }
        }
        let mass: f64 = distribution(e, span.start, span.end).iter().sum();
        for (label, loss) in losses.into_iter().enumerate().take(unknown) {
            if !loss.is_finite() {
                continue;
            }
            let prefix = if span.start == 0 {
                0.0
            } else {
                joined(
                    &forward[span.start * labels..(span.start + 1) * labels],
                    forward_best[span.start],
                    label,
                    change_cost(grid, span.start, p),
                )
                .0
            };
            let suffix = if span.end == last {
                0.0
            } else {
                joined(
                    &backward[span.end * labels..(span.end + 1) * labels],
                    backward_best[span.end],
                    label,
                    change_cost(grid, span.end, p),
                )
                .0
            };
            span.contextual.push((
                choice(label, unknown).unwrap(),
                ((prefix + loss + suffix - optimum) / mass).max(0.0),
            ));
        }
    }
    Ok(merged)
}

fn hypothesis(f: &Fit, mass: &[f64; 12], p: &HarmonyOptions) -> HarmonyHypothesis {
    let t = &p.templates[f.choice.template];
    let total: f64 = mass.iter().sum();
    HarmonyHypothesis {
        root_millicents: f.choice.root as i64 * SEMITONE,
        template_id: t.id.clone(),
        label: format!("{} {}", PITCH_NAMES[f.choice.root], t.label),
        core_intervals: t.core_intervals.clone(),
        color_intervals: t
            .color_intervals
            .iter()
            .copied()
            .filter(|n| mass[(f.choice.root + (*n / SEMITONE) as usize) % 12] > total * 1e-9)
            .collect(),
        score: -f.loss / total,
        core_coverage: f.coverage,
        core_mass_fraction: f.core_mass / total,
        contextual_cost: None,
    }
}

/// Whole-score hypothesis. Membership includes sounding overlap; source notes,
/// durations, attacks, routing, trajectories, and attachments are never changed.
pub fn infer_global_harmony(
    score: &Score,
    parameters: &HarmonyOptions,
) -> CoreResult<GlobalHarmonyAnalysis> {
    validate_score(score)?;
    validate_options(parameters)?;
    let mut diagnostics = vec![];
    let mut work = HarmonyWork::default();
    let percussion: HashSet<_> = score
        .parts
        .iter()
        .filter(|p| p.percussion)
        .map(|p| p.id.as_str())
        .collect();
    let (meters, meter_diagnostics) = meter_segments(score, parameters.max_lattice_points)?;
    diagnostics.extend(meter_diagnostics);
    let grid = lattice(score, parameters, &meters, &percussion, &mut work)?;
    let e = evidence(score, parameters, &grid, &meters, &percussion, &mut work)?;
    let spans = if grid.len() > 1 {
        segment(&grid, &e, parameters, score.ppq, &mut work)?
    } else if score.notes.is_empty() {
        vec![]
    } else {
        vec![Span {
            start: 0,
            end: 0,
            rest: true,
            choice: None,
            pieces: vec![],
            contextual: vec![],
        }]
    };
    let mut rests = Vec::<HarmonyRestInterval>::new();
    for cell in 0..grid.len().saturating_sub(1) {
        if e.sounding_prefix[cell + 1] == e.sounding_prefix[cell] {
            if let Some(rest) = rests.last_mut().filter(|r| r.end_tick == grid[cell].tick) {
                rest.end_tick = grid[cell + 1].tick;
            } else {
                rests.push(HarmonyRestInterval {
                    start_tick: grid[cell].tick,
                    end_tick: grid[cell + 1].tick,
                });
            }
        }
    }
    let metric_ticks: HashSet<_> = grid
        .iter()
        .filter(|g| {
            g.origins
                .iter()
                .any(|s| s == "meter-lattice" || s == "fallback-lattice")
        })
        .map(|g| g.tick)
        .collect();
    let mut off_grid_note_ids = vec![];
    let mut unsupported_note_ids = vec![];
    let mut percussion_note_ids = vec![];
    let mut members: Vec<Vec<&ScoreNote>> = vec![vec![]; spans.len()];
    for note in &score.notes {
        if !metric_ticks.contains(&note.onset) {
            off_grid_note_ids.push(note.id.clone());
        }
        if percussion.contains(note.part.as_str()) {
            percussion_note_ids.push(note.id.clone());
        } else if !eligible(note) {
            unsupported_note_ids.push(note.id.clone());
        }
        if spans.is_empty() {
            continue;
        }
        let note_end = note.onset + note.duration;
        let first = spans
            .partition_point(|s| grid[s.end].tick <= note.onset)
            .min(spans.len() - 1);
        for i in first..spans.len() {
            let start = grid[spans[i].start].tick;
            let end = grid[spans[i].end].tick;
            if note.duration > 0 && start >= note_end {
                break;
            }
            if note.duration == 0
                && (note.onset < start || note.onset >= end && i + 1 < spans.len())
            {
                break;
            }
            if note.duration > 0 && (note.onset >= end || note_end <= start) {
                continue;
            }
            charge(
                &mut work.output_members,
                1,
                parameters.max_output_members,
                "window membership",
            )?;
            members[i].push(note);
            if note.duration == 0 {
                break;
            }
        }
    }
    let mut windows = vec![];
    for (index, span) in spans.iter().enumerate() {
        let mass = distribution(&e, span.start, span.end);
        let mut ranked = fits(&mass, parameters, &mut work)?;
        let total: f64 = mass.iter().sum();
        let local_gap = ranked
            .get(1)
            .map(|second| (second.loss - ranked[0].loss) / total);
        let contexts: BTreeMap<_, _> = span
            .contextual
            .iter()
            .map(|(choice, cost)| (state(*choice), *cost))
            .collect();
        if span.choice.is_some() {
            ranked.retain(|f| contexts.contains_key(&state(f.choice)));
            ranked.sort_by(|a, b| {
                contexts[&state(a.choice)]
                    .total_cmp(&contexts[&state(b.choice)])
                    .then_with(|| a.loss.total_cmp(&b.loss))
                    .then_with(|| {
                        parameters.templates[a.choice.template]
                            .id
                            .cmp(&parameters.templates[b.choice.template].id)
                    })
                    .then(a.choice.root.cmp(&b.choice.root))
            });
        }
        let gap = ranked.get(1).and_then(|second| {
            Some(contexts.get(&state(second.choice))? - contexts.get(&state(ranked[0].choice))?)
        });
        let selected = if span.choice.is_some()
            && !ranked.is_empty()
            && gap.is_none_or(|g| g > parameters.ambiguity_margin.max(1e-12))
        {
            Some(0)
        } else {
            None
        };
        let alternatives: Vec<_> = ranked
            .iter()
            .take(parameters.max_alternatives)
            .map(|f| {
                let mut h = hypothesis(f, &mass, parameters);
                h.contextual_cost = contexts.get(&state(f.choice)).copied();
                h
            })
            .collect();
        let chosen = selected.map(|i| &alternatives[i]);
        let start_tick = grid[span.start].tick;
        let end_tick = grid[span.end].tick;
        let mut window = HarmonyWindow {
            id: format!("harmony-window-{index}"),
            start_tick,
            end_tick,
            label: if span.rest {
                "Pitched rest".into()
            } else {
                chosen.map_or_else(
                    || {
                        if alternatives.is_empty() {
                            "Unlabelled harmony".into()
                        } else {
                            "Ambiguous harmony".into()
                        }
                    },
                    |h| h.label.clone(),
                )
            },
            rest: span.rest,
            note_ids: vec![],
            core_note_ids: vec![],
            color_note_ids: vec![],
            residual_note_ids: vec![],
            unsupported_note_ids: vec![],
            percussion_note_ids: vec![],
            roles: vec![],
            rhythms: vec![],
            selected,
            functional_root: None,
            ambiguity_gap: gap,
            local_ambiguity_gap: local_gap,
            alternatives,
        };
        let mut rhythm: BTreeMap<String, Vec<HarmonyRhythmNote>> = BTreeMap::new();
        members[index].sort_by_key(|n| {
            (
                n.onset,
                n.part.as_str(),
                n.pitch.millicents,
                n.duration,
                n.id.as_str(),
            )
        });
        for note in &members[index] {
            window.note_ids.push(note.id.clone());
            rhythm
                .entry(note.part.clone())
                .or_default()
                .push(HarmonyRhythmNote {
                    note_id: note.id.clone(),
                    onset_offset_ticks: note.onset as i64 - start_tick as i64,
                    duration_ticks: note.duration,
                    overlap_ticks: (note.onset + note.duration)
                        .min(end_tick)
                        .saturating_sub(note.onset.max(start_tick)),
                    carried_in: note.onset < start_tick,
                });
        }
        window.rhythms = rhythm
            .into_iter()
            .map(|(part, notes)| HarmonyPartRhythm { part, notes })
            .collect();
        windows.push(window);
    }
    if let Some(options) = parameters.context.as_ref().filter(|_| windows.len() > 1) {
        for proposal in contextual_harmonic_roots(score, &windows, options)? {
            let window = &mut windows[proposal.window_index];
            window.selected = Some(proposal.functional_root.realization_alternative_index);
            window.label = format!(
                "{} · {} functional root",
                window.alternatives[window.selected.unwrap()].label,
                PITCH_NAMES[(proposal.functional_root.root_millicents / SEMITONE) as usize]
            );
            window.functional_root = Some(proposal.functional_root);
        }
    }
    for (window, notes) in windows.iter_mut().zip(&members) {
        let chosen = window.selected.map(|i| &window.alternatives[i]);
        for note in notes {
            let interval =
                chosen.map(|h| (note.pitch.millicents - h.root_millicents).rem_euclid(OCTAVE));
            let role = if percussion.contains(note.part.as_str()) {
                HarmonyNoteRole::Percussion
            } else if !eligible(note) {
                HarmonyNoteRole::Unsupported
            } else if chosen.is_some_and(|h| h.core_intervals.contains(&interval.unwrap())) {
                HarmonyNoteRole::Core
            } else if chosen.is_some_and(|h| h.color_intervals.contains(&interval.unwrap())) {
                HarmonyNoteRole::Color
            } else {
                HarmonyNoteRole::Residual
            };
            match role {
                HarmonyNoteRole::Core => window.core_note_ids.push(note.id.clone()),
                HarmonyNoteRole::Color => window.color_note_ids.push(note.id.clone()),
                HarmonyNoteRole::Residual => window.residual_note_ids.push(note.id.clone()),
                HarmonyNoteRole::Unsupported => window.unsupported_note_ids.push(note.id.clone()),
                HarmonyNoteRole::Percussion => window.percussion_note_ids.push(note.id.clone()),
            }
            window.roles.push(HarmonyNoteRelation {
                note_id: note.id.clone(),
                role,
                interval,
            });
        }
    }
    off_grid_note_ids.sort();
    unsupported_note_ids.sort();
    percussion_note_ids.sort();
    if work.unrepresentable_lattice_points > 0 {
        diagnostics.push(format!("{} rational lattice points were not integer-representable under source PPQ and were skipped, never rounded.", work.unrepresentable_lattice_points));
    }
    Ok(GlobalHarmonyAnalysis {
        parameters: parameters.clone(), windows, lattice: grid, rests, work, off_grid_note_ids, unsupported_note_ids, percussion_note_ids, diagnostics,
        limitations: vec![
            "Experimental 12-TET chord-template and metrical-span objective; scores/gaps are costs, not probabilities or validated confidence. Optional same-bass second-inversion resolution proposes a separate functional root from observed next-window major-triad support; it does not establish voice leading, local key, cadence, spelling or general harmonic function.".into(),
            "Each active part's pitch-class evidence is weighted by raw mass to the power (1-partNormalization); one gives equal part votes, zero retains relative salience. Exactly equal normalized profiles retain their maximum mass, not their sum. Coincident independent parts can therefore collapse as harmonic evidence, while all note witnesses/routing remain distinct. Duration plus separately weighted attacks/metre guide fitting; (1 + velocityWeight × velocity/127) is a soft relative intensity prior, not calibrated loudness. Gain curves and pedal are not interpreted.".into(),
            "Meter changes define local phase. Denominator subdivisions and observed pitched-rest edges supply boundaries; no source event is snapped. Missing meter has no accent evidence. Microtonal attacks, varying native pitch curves and zero-duration notes remain explicit unsupported evidence; percussion is excluded from harmonic fitting.".into(),
            "Label-state segmental DP jointly minimizes template misfit, label-change, weak-beat and silent-quarter bridging costs across lengths up to maxSpanSteps. Label changes require an eligible attack/release at the lattice point or an explicit rest/meter edge; unsupported continuous pitch motion does not license them. A reinterpretation during an unchanged held sonority can therefore be missed. Same-label computational subdivisions remain permitted without a change penalty. Exact pitched rests remain separate. Returned equal-label runs merge computational subdivisions; contextual costs compare complete paths forced to one label across these same subdivisions. They are conditional cost gaps, not posterior confidence or uncertainty over every alternative segmentation. Local whole-run fit gaps remain separate; ties stay unselected. Forward/backward/reconstruction fits all count against the work budgets.".into(),
            "Core coverage counts observed template classes; colors are permitted observed non-core intervals, not proven ornamental functions. Window membership uses sounding overlap; rhythm preserves source attack offsets and full durations separately. Global windows assume one prevailing chord hypothesis and can be inadequate for polychords, independent harmonic layers or unmodelled style.".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(id: &str, pitch: i64, onset: u64, duration: u64) -> ScoreNote {
        ScoreNote {
            id: id.into(),
            part: "p".into(),
            onset,
            duration,
            pitch: Pitch {
                millicents: pitch * SEMITONE,
            },
            velocity: 90,
            release_velocity: 0,
            pitch_envelope: None,
            gain_envelope: None,
            source: None,
        }
    }
    fn score(notes: Vec<ScoreNote>, duration: u64) -> Score {
        Score {
            ppq: 100,
            duration,
            midi_format: None,
            parts: vec![ScorePart {
                id: "p".into(),
                name: "synthetic".into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            notes,
            attachments: vec![ScoreAttachment {
                tick: 0,
                track: 0,
                order: 0,
                bytes: vec![0xff, 0x58, 4, 4, 2, 24, 8],
            }],
            track_ends: vec![duration],
        }
    }
    fn chord(start: u64, length: u64, pitches: &[i64]) -> Vec<ScoreNote> {
        pitches
            .iter()
            .enumerate()
            .map(|(i, &pitch)| note(&format!("{start}-{i}"), pitch, start, length))
            .collect()
    }
    fn label(window: &HarmonyWindow) -> Option<(i64, &str)> {
        window.selected.map(|i| {
            (
                window.alternatives[i].root_millicents,
                window.alternatives[i].template_id.as_str(),
            )
        })
    }
    #[test]
    fn local_candidates_do_not_claim_uncomputed_context_for_an_unknown_path() {
        let mut p = HarmonyOptions::default();
        p.max_span_steps = 1;
        let source = score(vec![note("a", 60, 0, 50), note("b", 64, 50, 50)], 100);
        let result = infer_global_harmony(&source, &p).unwrap();
        assert_eq!(result.windows.len(), 1);
        assert_eq!(result.windows[0].selected, None);
        assert!(!result.windows[0].alternatives.is_empty());
        assert!(
            result.windows[0]
                .alternatives
                .iter()
                .all(|h| h.contextual_cost.is_none())
        );
    }
    #[test]
    fn calibrated_priors_separate_successive_triads_but_preserve_seventh_figurations() {
        let p = HarmonyOptions::default();
        let mut notes = chord(0, 200, &[60, 64, 67]);
        notes.extend(chord(200, 200, &[57, 60, 64]));
        let moving = infer_global_harmony(&score(notes, 400), &p).unwrap();
        assert_eq!(
            moving.windows.iter().map(label).collect::<Vec<_>>(),
            vec![Some((0, "major")), Some((900_000, "minor"))]
        );
        // Doubling C/E makes this sustained seventh's normalized PC totals equal
        // the successive triads above. It still has a different temporal fit.
        let sustained =
            infer_global_harmony(&score(chord(0, 400, &[60, 60, 64, 64, 67, 69]), 400), &p)
                .unwrap();
        assert_eq!(sustained.windows.len(), 1);
        assert_eq!(
            label(&sustained.windows[0]),
            Some((900_000, "minor-seventh"))
        );
        let broken = score(
            [57, 60, 64, 67]
                .into_iter()
                .enumerate()
                .map(|(i, pitch)| note(&format!("upper-{i}"), pitch, i as u64 * 100, 100))
                .collect(),
            400,
        );
        let arpeggio = infer_global_harmony(&broken, &p).unwrap();
        assert_eq!(arpeggio.windows.len(), 1);
        assert_eq!(
            label(&arpeggio.windows[0]),
            Some((900_000, "minor-seventh"))
        );
        let mut pedal = score(
            [60, 64, 67, 60]
                .into_iter()
                .enumerate()
                .map(|(i, pitch)| note(&format!("upper-{i}"), pitch, i as u64 * 100, 100))
                .collect(),
            400,
        );
        let mut bass = note("pedal", 45, 0, 400);
        bass.part = "bass".into();
        pedal.notes.push(bass);
        let mut part = pedal.parts[0].clone();
        part.id = "bass".into();
        part.channel = 1;
        pedal.parts.push(part);
        let held = infer_global_harmony(&pedal, &p).unwrap();
        assert_eq!(held.windows.len(), 1);
        assert!(
            !held
                .lattice
                .iter()
                .find(|g| g.tick == 150)
                .unwrap()
                .change_supported
        );
        assert!(
            held.lattice
                .iter()
                .find(|g| g.tick == 200)
                .unwrap()
                .change_supported
        );
        assert_eq!(
            (
                held.windows[0].alternatives[0].root_millicents,
                held.windows[0].alternatives[0].template_id.as_str()
            ),
            (900_000, "minor-seventh")
        );
        // A changing native pitch curve remains unsupported evidence and cannot
        // manufacture a chord-change boundary inside the held eligible notes.
        let mut native = note("native-motion", 72, 150, 50);
        native.pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: native.pitch.clone(),
            },
            PitchEnvelopePoint {
                tick: 50,
                pitch: Pitch {
                    millicents: 7_350_000,
                },
            },
        ]);
        pedal.notes.push(native);
        let unsupported = infer_global_harmony(&pedal, &p).unwrap();
        assert!(
            !unsupported
                .lattice
                .iter()
                .find(|g| g.tick == 150)
                .unwrap()
                .change_supported
        );
        pedal.attachments.push(ScoreAttachment {
            tick: 150,
            track: 0,
            order: 1,
            bytes: vec![0xff, 0x58, 4, 3, 2, 24, 8],
        });
        let metrical_edge = infer_global_harmony(&pedal, &p).unwrap();
        assert!(
            metrical_edge
                .lattice
                .iter()
                .find(|g| g.tick == 150)
                .unwrap()
                .change_supported
        );
    }
    #[test]
    fn surrounding_triads_support_a_missing_third_without_erasing_a_real_minor_change() {
        let mut p = HarmonyOptions::default();
        // Force computational subdivisions so the result cannot be explained by
        // a single aggregate fit covering the complete phrase.
        p.max_span_steps = 1;
        let mut notes = chord(0, 50, &[60, 64, 67]);
        notes.extend(chord(50, 50, &[60, 67]));
        notes.extend(chord(100, 50, &[60, 64, 67]));
        let contextual = infer_global_harmony(&score(notes, 150), &p).unwrap();
        assert_eq!(contextual.windows.len(), 1);
        assert_eq!(label(&contextual.windows[0]), Some((0, "major")));
        let isolated = infer_global_harmony(&score(chord(0, 50, &[60, 67]), 50), &p).unwrap();
        assert_eq!(label(&isolated.windows[0]), Some((0, "open-fifth")));
        let mut notes = chord(0, 100, &[60, 64, 67]);
        notes.extend(chord(100, 200, &[60, 63, 67]));
        notes.extend(chord(300, 100, &[60, 64, 67]));
        let changed = infer_global_harmony(&score(notes, 400), &p).unwrap();
        assert_eq!(
            changed.windows.iter().map(label).collect::<Vec<_>>(),
            vec![Some((0, "major")), Some((0, "minor")), Some((0, "major"))]
        );
    }
    #[test]
    fn label_state_search_matches_exhaustive_segmentation_and_label_paths() {
        fn brute(
            at: usize,
            previous: Option<usize>,
            grid: &[HarmonyLatticePoint],
            e: &Evidence,
            p: &HarmonyOptions,
        ) -> f64 {
            if at + 1 == grid.len() {
                return 0.0;
            }
            let mut best = f64::INFINITY;
            for end in at + 1..=grid.len().saturating_sub(1).min(at + p.max_span_steps) {
                for (label, loss) in
                    span_fits(grid, e, p, 100, at, end, &mut HarmonyWork::default()).unwrap()
                {
                    let change = if previous.is_some_and(|old| old != label) {
                        change_cost(grid, at, p)
                    } else {
                        0.0
                    };
                    best = best.min(change + loss + brute(end, Some(label), grid, e, p));
                }
            }
            best
        }
        let mut p = HarmonyOptions::default();
        p.templates.retain(|t| t.id == "major" || t.id == "minor");
        p.max_span_steps = 2;
        p.boundary_cost = 0.02;
        p.weak_boundary_cost = 0.01;
        let mut notes = chord(0, 100, &[60, 64, 67]);
        notes.extend(chord(100, 100, &[60, 63, 67]));
        let source = score(notes, 200);
        let (meters, _) = meter_segments(&source, 20_000).unwrap();
        let mut work = HarmonyWork::default();
        let grid = lattice(&source, &p, &meters, &HashSet::new(), &mut work).unwrap();
        let evidence = evidence(&source, &p, &grid, &meters, &HashSet::new(), &mut work).unwrap();
        let spans = segment(&grid, &evidence, &p, source.ppq, &mut work).unwrap();
        let mut actual = 0.0;
        for (i, span) in spans.iter().enumerate() {
            if i > 0 {
                actual += change_cost(&grid, span.start, &p);
            }
            let label = span.choice.map(state).unwrap_or(p.templates.len() * 12);
            for &(start, end) in &span.pieces {
                actual += span_fits(&grid, &evidence, &p, source.ppq, start, end, &mut work)
                    .unwrap()
                    .into_iter()
                    .find(|(s, _)| *s == label)
                    .unwrap()
                    .1;
            }
            assert!(
                span.contextual
                    .iter()
                    .any(|(c, cost)| Some(*c) == span.choice && cost.abs() < 1e-9)
            );
        }
        assert!((actual - brute(0, None, &grid, &evidence, &p)).abs() < 1e-9);
        p.max_state_cells = grid.len() * (p.templates.len() * 12 + 1) - 1;
        assert_eq!(
            infer_global_harmony(&source, &p).unwrap_err().code,
            "budget-exceeded"
        );
    }
    #[test]
    fn variable_harmonic_spans_follow_changes_not_one_winning_grid_length() {
        let mut notes = chord(0, 400, &[60, 64, 67]);
        notes.extend(chord(400, 200, &[62, 65, 69]));
        notes.extend(chord(600, 400, &[61, 65, 68]));
        let source = score(notes, 1000);
        let before = source.clone();
        let result = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert_eq!(
            result
                .windows
                .iter()
                .map(|w| (w.start_tick, w.end_tick))
                .collect::<Vec<_>>(),
            vec![(0, 400), (400, 600), (600, 1000)]
        );
        assert_eq!(label(&result.windows[0]), Some((0, "major")));
        assert_eq!(label(&result.windows[1]), Some((200_000, "minor")));
        assert_eq!(source, before);
    }
    #[test]
    fn compound_meter_supports_dotted_quarter_changes_and_rational_points_are_never_rounded() {
        let mut notes = chord(0, 150, &[60, 64, 67]);
        notes.extend(chord(150, 150, &[61, 65, 68]));
        let mut source = score(notes, 300);
        source.attachments[0].bytes = vec![0xff, 0x58, 4, 6, 3, 24, 8];
        let result = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert_eq!(
            result
                .windows
                .iter()
                .map(|w| (w.start_tick, w.end_tick))
                .collect::<Vec<_>>(),
            vec![(0, 150), (150, 300)]
        );
        assert_eq!(
            result
                .lattice
                .iter()
                .find(|g| g.tick == 150)
                .unwrap()
                .metric_strength,
            Some(0.75)
        );
        source.ppq = 1;
        source.duration = 3;
        source.track_ends = vec![3];
        source.notes = chord(0, 3, &[60, 64, 67]);
        let coarse = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert!(coarse.work.unrepresentable_lattice_points > 0);
        assert_eq!(
            coarse.lattice.iter().map(|g| g.tick).collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
    }
    #[test]
    fn rhythmic_rearticulation_and_inversion_do_not_change_chord_identity() {
        let sustained = score(chord(0, 400, &[64, 67, 72]), 400);
        let mut rearticulated = sustained.clone();
        rearticulated.notes = (0..8)
            .flat_map(|i| chord(i * 50, 50, &[64, 67, 72]))
            .collect();
        let a = infer_global_harmony(&sustained, &HarmonyOptions::default()).unwrap();
        let b = infer_global_harmony(&rearticulated, &HarmonyOptions::default()).unwrap();
        assert_eq!(label(&a.windows[0]), Some((0, "major")));
        assert_eq!(label(&a.windows[0]), label(&b.windows[0]));
        assert_eq!(a.windows.len(), b.windows.len());
        assert_ne!(
            a.windows[0].rhythms[0].notes.len(),
            b.windows[0].rhythms[0].notes.len()
        );
    }
    #[test]
    fn doubled_parts_do_not_double_evidence_but_keep_every_witness() {
        let original = score(chord(0, 400, &[60, 64, 67]), 400);
        let mut doubled = original.clone();
        doubled.parts.push(ScorePart {
            id: "copy".into(),
            name: "doubling".into(),
            track: 0,
            channel: 1,
            percussion: false,
        });
        doubled
            .notes
            .extend(original.notes.iter().cloned().map(|mut n| {
                n.id = format!("copy-{}", n.id);
                n.part = "copy".into();
                n
            }));
        doubled.notes.reverse();
        let a = infer_global_harmony(&original, &HarmonyOptions::default()).unwrap();
        let b = infer_global_harmony(&doubled, &HarmonyOptions::default()).unwrap();
        assert_eq!(
            a.windows[0].alternatives[0].score,
            b.windows[0].alternatives[0].score
        );
        assert_eq!(label(&a.windows[0]), label(&b.windows[0]));
        assert_eq!(b.windows[0].core_note_ids.len(), 6);
        assert!(b.work.collapsed_part_profiles > 0);
    }
    #[test]
    fn colors_and_symmetric_root_ambiguity_are_explicit() {
        let mut notes = chord(0, 400, &[60, 64, 67]);
        notes.push(note("ninth", 74, 150, 25));
        let result = infer_global_harmony(&score(notes, 400), &HarmonyOptions::default()).unwrap();
        assert_eq!(label(&result.windows[0]), Some((0, "major")));
        assert_eq!(result.windows[0].color_note_ids, vec!["ninth"]);
        assert!(
            result.windows[0].alternatives[0]
                .color_intervals
                .contains(&200_000)
        );
        let ambiguous = infer_global_harmony(
            &score(chord(0, 400, &[60, 64, 68]), 400),
            &HarmonyOptions::default(),
        )
        .unwrap();
        assert_eq!(ambiguous.windows[0].selected, None);
        assert!(ambiguous.windows[0].alternatives.len() >= 3);
        assert!(ambiguous.windows[0].core_note_ids.is_empty());
        assert_eq!(ambiguous.windows[0].residual_note_ids.len(), 3);
    }
    #[test]
    fn exact_rest_edges_carried_notes_and_unsupported_evidence_survive() {
        let mut source = score(chord(17, 83, &[60, 64, 67]), 300);
        source.notes.extend(chord(150, 100, &[61, 65, 68]));
        source.notes.push(note("micro", 61, 150, 100));
        source.notes.last_mut().unwrap().pitch.millicents += 1537;
        source.notes.push(note("instant", 60, 300, 0));
        let mut drum = note("drum", 36, 0, 300);
        drum.part = "drums".into();
        source.notes.push(drum);
        source.parts.push(ScorePart {
            id: "drums".into(),
            name: "drums".into(),
            track: 0,
            channel: 9,
            percussion: true,
        });
        let result = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert_eq!(
            result
                .rests
                .iter()
                .map(|w| (w.start_tick, w.end_tick))
                .collect::<Vec<_>>(),
            vec![(0, 17), (100, 150), (250, 300)]
        );
        assert!(result.off_grid_note_ids.contains(&"17-0".into()));
        assert_eq!(result.unsupported_note_ids, vec!["instant", "micro"]);
        assert!(
            result
                .windows
                .last()
                .unwrap()
                .unsupported_note_ids
                .contains(&"instant".into())
        );
        assert!(
            result.windows[1]
                .rhythms
                .iter()
                .find(|r| r.part == "drums")
                .unwrap()
                .notes[0]
                .carried_in
        );
        assert!(
            result
                .windows
                .iter()
                .all(|w| !w.core_note_ids.contains(&"drum".into()))
        );
    }
    #[test]
    fn staccato_gaps_are_evidence_not_forced_harmonic_boundaries() {
        let sustained = score(chord(0, 400, &[60, 64, 67]), 400);
        let articulated = score(
            (0..8)
                .flat_map(|i| chord(i * 50, 40, &[60, 64, 67]))
                .collect(),
            400,
        );
        let p = HarmonyOptions::default();
        let a = infer_global_harmony(&sustained, &p).unwrap();
        let b = infer_global_harmony(&articulated, &p).unwrap();
        assert_eq!(b.windows.len(), 1);
        assert_eq!(label(&a.windows[0]), label(&b.windows[0]));
        assert_eq!((b.windows[0].start_tick, b.windows[0].end_tick), (0, 400));
        assert_eq!(b.rests.len(), 8);
        assert_eq!((b.rests[0].start_tick, b.rests[0].end_tick), (40, 50));
        let mut paused = score(chord(0, 200, &[60, 64, 67]), 800);
        paused.notes.extend(chord(600, 200, &[60, 64, 67]));
        let gap = infer_global_harmony(&paused, &p).unwrap();
        assert_eq!(
            gap.windows
                .iter()
                .map(|w| (w.start_tick, w.end_tick, w.rest))
                .collect::<Vec<_>>(),
            vec![(0, 200, false), (200, 600, true), (600, 800, false)]
        );
        let no_cost = infer_global_harmony(
            &paused,
            &HarmonyOptions {
                silence_bridge_cost: 0.0,
                ..p
            },
        )
        .unwrap();
        assert_eq!(
            no_cost.windows.len(),
            1,
            "Zero bridging cost is an explicit ablation, not source-specific gap tuning."
        );
        assert_eq!(no_cost.rests.len(), 1);
    }
    #[test]
    fn native_pitch_curves_and_source_order_do_not_get_silently_flattened() {
        let mut source = score(chord(0, 400, &[60, 64, 67]), 400);
        source.notes[0].pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: source.notes[0].pitch,
            },
            PitchEnvelopePoint {
                tick: 400,
                pitch: Pitch {
                    millicents: 6_010_000,
                },
            },
        ]);
        let before = source.clone();
        let result = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert_eq!(result.unsupported_note_ids, vec!["0-0"]);
        assert_eq!(source, before);
        source.notes.reverse();
        let reversed = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert_eq!(
            serde_json::to_value(&result.windows).unwrap(),
            serde_json::to_value(&reversed.windows).unwrap()
        );
    }
    #[test]
    fn independent_unchanged_melody_does_not_hide_opposing_two_quarter_harmonies() {
        let mut notes = chord(0, 200, &[48, 52, 55]);
        notes.extend(chord(200, 200, &[54, 58, 61]));
        let mut source = score(notes, 400);
        source.parts.push(ScorePart {
            id: "melody".into(),
            name: "independent".into(),
            track: 0,
            channel: 1,
            percussion: false,
        });
        for onset in [50, 250] {
            let mut n = note(&format!("m-{onset}"), 72, onset, 20);
            n.part = "melody".into();
            source.notes.push(n);
        }
        let a = infer_global_harmony(&source, &HarmonyOptions::default()).unwrap();
        assert_eq!(
            a.windows
                .iter()
                .map(|w| (w.start_tick, w.end_tick))
                .collect::<Vec<_>>(),
            vec![(0, 200), (200, 400)]
        );
        assert_eq!(label(&a.windows[0]), Some((0, "major")));
        assert_eq!(label(&a.windows[1]), Some((600_000, "major")));
        assert!(a.windows[0].core_note_ids.contains(&"m-50".into()));
        assert!(a.windows[1].residual_note_ids.contains(&"m-250".into()));
        let mut shifted = source.clone();
        for n in &mut shifted.notes {
            n.pitch.millicents += 500_000;
        }
        shifted.notes.reverse();
        let b = infer_global_harmony(&shifted, &HarmonyOptions::default()).unwrap();
        assert_eq!(a.windows.len(), b.windows.len());
        for (x, y) in a.windows.iter().zip(&b.windows) {
            assert_eq!((x.start_tick, x.end_tick), (y.start_tick, y.end_tick));
            let (root, kind) = label(x).unwrap();
            assert_eq!(label(y), Some(((root + 500_000) % OCTAVE, kind)));
            assert_eq!(x.core_note_ids, y.core_note_ids);
            assert_eq!(x.color_note_ids, y.color_note_ids);
        }
    }
    #[test]
    fn empty_instantaneous_and_maximum_time_fail_or_report_explicitly_without_runaway() {
        let empty = score(vec![], 0);
        assert!(
            infer_global_harmony(&empty, &HarmonyOptions::default())
                .unwrap()
                .windows
                .is_empty()
        );
        let instant = score(vec![note("instant", 60, 0, 0)], 0);
        let result = infer_global_harmony(&instant, &HarmonyOptions::default()).unwrap();
        assert_eq!(result.windows[0].unsupported_note_ids, vec!["instant"]);
        let huge = score(vec![note("late", 60, MAX_SAFE, 0)], MAX_SAFE);
        assert_eq!(
            infer_global_harmony(&huge, &HarmonyOptions::default())
                .unwrap_err()
                .code,
            "budget-exceeded"
        );
        let mut coarse = huge;
        coarse.ppq = MAX_SAFE;
        let result = infer_global_harmony(&coarse, &HarmonyOptions::default()).unwrap();
        assert_eq!(result.windows[0].end_tick, MAX_SAFE);
        assert_eq!(result.windows[0].unsupported_note_ids, vec!["late"]);
    }
    #[test]
    fn budgets_and_invalid_templates_fail_without_partial_complete_output() {
        let source = score(chord(0, 400, &[60, 64, 67]), 400);
        let p = HarmonyOptions {
            max_evidence_visits: 0,
            ..HarmonyOptions::default()
        };
        assert_eq!(
            infer_global_harmony(&source, &p).unwrap_err().code,
            "budget-exceeded"
        );
        let p = HarmonyOptions {
            max_output_members: 2,
            ..HarmonyOptions::default()
        };
        assert_eq!(
            infer_global_harmony(&source, &p).unwrap_err().code,
            "budget-exceeded"
        );
        let p = HarmonyOptions {
            max_hypothesis_evaluations: 1,
            ..HarmonyOptions::default()
        };
        assert_eq!(
            infer_global_harmony(&source, &p).unwrap_err().code,
            "budget-exceeded"
        );
        let mut p = HarmonyOptions::default();
        p.templates[0].core_intervals.push(1);
        assert_eq!(
            infer_global_harmony(&source, &p).unwrap_err().code,
            "invalid-input"
        );
    }
}
