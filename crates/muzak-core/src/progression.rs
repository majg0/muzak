//! A bounded forward grammar over a supplied tonal center. Chord meanings are
//! authored premises; route preferences are neither inference nor learned odds.
pub mod catalog;
mod connection;
mod voicing;

use crate::{
    composition::CompositionPlan,
    error::{CoreResult, invalid},
    harmonic_connection::{
        self, ConnectionContext, ConnectionGeometry, ConnectionMetrics, ConnectionWeights,
    },
    harmonic_motion::{
        self, HarmonicMotionOptions, MotionChord, MotionDuration, MotionFrame, MotionFrameRole,
        MotionStep, MotionWeights,
    },
};
pub use catalog::*;
pub use connection::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionColorChoice {
    pub id: ProgressionColor,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionDefaults {
    pub options: ProgressionOptions,
    pub families: Vec<ProgressionFamilyChoice>,
    pub tonics: Vec<String>,
    pub colors: Vec<ProgressionColorChoice>,
    pub connection_weights: ConnectionWeights,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionReplacement {
    pub chord_id: String,
    pub reason: String,
    /// Shared periodic/context cost across both neighboring edges, before the
    /// edited passage chooses actual registered voicings.
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionStep {
    pub index: usize,
    pub chord_id: String,
    pub chord: ProgressionChord,
    /// Actual registered bass in slash notation, independent of the Roman root.
    pub voiced_name: String,
    pub reason: String,
    /// Every emitted member; bass and declared harmonic root are independent.
    pub voiced_midi: Vec<i32>,
    pub voiced_tone_names: Vec<String>,
    pub replacements: Vec<ProgressionReplacement>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionResult {
    pub options: ProgressionOptions,
    pub catalog: ProgressionCatalog,
    pub steps: Vec<ProgressionStep>,
    pub plan: CompositionPlan,
    pub motion_options: HarmonicMotionOptions,
    pub explanation: String,
    pub roman_convention: String,
    /// Adjacent edge i connects steps i and i+1. Geometry never infers voices.
    pub transitions: Vec<ConnectionMetrics>,
    pub lines: crate::harmonic_lines::HarmonicLinesAnalysis,
    /// Independently executable solo plans aligned with `lines.lines`. They keep
    /// the passage duration, original event timing and harmonic member bindings.
    pub line_plans: Vec<CompositionPlan>,
}

pub fn defaults() -> ProgressionDefaults {
    ProgressionDefaults {
        options: catalog::default_options(),
        families: catalog::family_choices(),
        connection_weights: harmonic_connection::default_weights(),
        tonics: ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"]
            .iter().map(|value| (*value).into()).collect(),
        colors: vec![
            ProgressionColorChoice { id: ProgressionColor::Diatonic, name: "In the scale".into(),
                description: "Triads and sevenths built from the chosen collection.".into() },
            ProgressionColorChoice { id: ProgressionColor::Chromatic, name: "Some color".into(),
                description: "Add modal borrowing and directed applied dominants or diminished chords.".into() },
            ProgressionColorChoice { id: ProgressionColor::Adventurous, name: "Rich color".into(),
                description: "Also admit altered dominants and tritone substitutions with explicit resolutions.".into() },
        ],
    }
}

fn color_limit(color: &ProgressionColor) -> u8 {
    match color {
        ProgressionColor::Diatonic => 0,
        ProgressionColor::Chromatic => 1,
        ProgressionColor::Adventurous => 2,
    }
}

fn admitted(chord: &ProgressionChord, options: &ProgressionOptions) -> bool {
    chord.color_cost <= color_limit(&options.color)
}

/// A directed operation keeps its target premise through both generation and
/// editing. Equal pitches in a differently derived chord do not share the target.
fn follows(from: &ProgressionChord, to: &ProgressionChord, catalog: &ProgressionCatalog) -> bool {
    from.resolution_degree.is_none_or(|degree| {
        to.degree == degree
            && to.color_cost == 0
            && from.resolution_root_pitch_class == Some(to.root_pitch_class)
            && catalog
                .chords
                .iter()
                .find(|chord| Some(&chord.id) == from.resolution_chord_id.as_ref())
                .is_some_and(|target| {
                    target.root_pitch_class == to.root_pitch_class
                        && target
                            .intervals
                            .iter()
                            .all(|tone| to.intervals.contains(tone))
                })
    })
}

fn is_home(chord: &ProgressionChord) -> bool {
    chord.degree == 0 && chord.color_cost == 0
}

fn voiced_names(chord: &ProgressionChord, pitches: &[i32]) -> Vec<String> {
    pitches
        .iter()
        .map(|pitch| {
            let member = chord
                .intervals
                .iter()
                .position(|interval| {
                    (chord.root_pitch_class + interval).rem_euclid(12) == pitch.rem_euclid(12)
                })
                .expect("Voicing retains a catalog chord member");
            chord.tone_names[member].clone()
        })
        .collect()
}

fn voiced_name(chord: &ProgressionChord, pitches: &[i32]) -> String {
    if pitches
        .first()
        .is_none_or(|pitch| pitch.rem_euclid(12) == chord.root_pitch_class)
    {
        return chord.name.clone();
    }
    format!("{}/{}", chord.name, voiced_names(chord, pitches)[0])
}

fn connection_context(catalog: &ProgressionCatalog) -> ConnectionContext {
    ConnectionContext {
        tonic_millicents: Some(i64::from(catalog.tonic_pitch_class) * 100_000),
        collection_millicents: catalog
            .scale_offsets
            .iter()
            .map(|offset| i64::from((catalog.tonic_pitch_class + offset).rem_euclid(12)) * 100_000)
            .collect(),
    }
}

fn motion_chord(chord: &ProgressionChord, pitches: &[i32], id: String) -> MotionChord {
    MotionChord {
        id,
        name: format!("{} · {}", chord.roman, voiced_name(chord, pitches)),
        root_millicents: pitches
            .iter()
            .find(|pitch| pitch.rem_euclid(12) == chord.root_pitch_class)
            .map(|&pitch| i64::from(pitch) * 100_000),
        pitches_millicents: pitches
            .iter()
            .map(|&pitch| i64::from(pitch) * 100_000)
            .collect(),
    }
}

fn periodic_chord(chord: &ProgressionChord) -> MotionChord {
    motion_chord(
        chord,
        &chord
            .intervals
            .iter()
            .map(|interval| (chord.root_pitch_class + interval).rem_euclid(12))
            .collect::<Vec<_>>(),
        chord.id.clone(),
    )
}

fn adjacent_cost(
    from: &MotionChord,
    to: &MotionChord,
    context: &ConnectionContext,
    geometry: ConnectionGeometry,
    weights: &ConnectionWeights,
) -> CoreResult<f64> {
    let metrics =
        harmonic_connection::pair_metrics(from, to, Some(1_200_000), Some(context), weights)?;
    Ok(harmonic_connection::transition_cost(&metrics, geometry, 4.0, weights)?.total)
}

fn solo_line_plans(
    plan: &CompositionPlan,
    analysis: &crate::harmonic_lines::HarmonicLinesAnalysis,
) -> CoreResult<Vec<CompositionPlan>> {
    let material_by_id: BTreeMap<_, _> = plan
        .materials
        .iter()
        .map(|material| (material.id.as_str(), material))
        .collect();
    analysis
        .lines
        .iter()
        .enumerate()
        .map(|(line_index, line)| {
            let mut solo = plan.clone();
            solo.materials.clear();
            solo.placements.clear();
            for point in &line.points {
                let original = plan
                    .placements
                    .get(point.step_index)
                    .ok_or_else(|| invalid("A trajectory point has no corresponding placement."))?;
                let material = material_by_id
                    .get(original.material.as_str())
                    .ok_or_else(|| {
                        invalid("A trajectory placement has no corresponding material.")
                    })?;
                let event = material.notes.get(point.member_index).ok_or_else(|| {
                    invalid("A trajectory member has no corresponding material event.")
                })?;
                let binding = original
                    .pitch_bindings
                    .as_ref()
                    .and_then(|bindings| bindings.get(point.member_index))
                    .ok_or_else(|| {
                        invalid("A trajectory member has no corresponding harmonic binding.")
                    })?;
                // Keep the exact original rhythmic event and harmonic address. In
                // particular, a solo arpeggio member retains its within-chord offset;
                // its onset is not replaced by the analytical chord boundary.
                let mut selected_material = (**material).clone();
                selected_material.id = format!("line-{line_index}-step-{}", point.step_index);
                selected_material.notes = vec![event.clone()];
                let mut placement = original.clone();
                placement.material = selected_material.id.clone();
                placement.pitch_bindings = Some(vec![binding.clone()]);
                solo.materials.push(selected_material);
                solo.placements.push(placement);
            }
            crate::composition::compile_composition(
                &solo,
                &crate::composition::CompositionLimits::default(),
            )?;
            Ok(solo)
        })
        .collect()
}

struct Random(u64);
impl Random {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn transition_preference(from: &ProgressionChord, to: &ProgressionChord) -> f64 {
    use ProgressionRole::*;
    let role = match (&from.role, &to.role) {
        (Home, Departure | Preparation | Color) => 3.0,
        (Departure | Color, Preparation) => 3.2,
        (Preparation, Tension) => 4.0,
        (Tension, Home) => 4.5,
        (Tension, Departure) => 1.6,
        (Home, Home) => 0.2,
        _ => 1.0,
    };
    let root = (to.root_pitch_class - from.root_pitch_class).rem_euclid(12);
    let direction = match root {
        5 => 1.8,
        1 | 2 | 10 | 11 => 1.3,
        0 => 0.35,
        _ => 1.0,
    };
    let shared = from
        .intervals
        .iter()
        .filter(|interval| {
            let pc = (from.root_pitch_class + **interval).rem_euclid(12);
            to.intervals
                .iter()
                .any(|other| (to.root_pitch_class + *other).rem_euclid(12) == pc)
        })
        .count();
    role * direction * (1.0 + shared as f64 * 0.12)
}

fn preference(
    from: &ProgressionChord,
    to: &ProgressionChord,
    position: usize,
    length: usize,
    tonic_pc: i32,
    prior: &[usize],
    chords: &[ProgressionChord],
) -> f64 {
    let mut weight = transition_preference(from, to);
    let repeats = prior.iter().filter(|&&i| chords[i].id == to.id).count();
    weight /= 1.0 + repeats as f64 * 2.0;
    if to.id == from.id {
        weight *= 0.025;
    }
    if position + 2 == length {
        let offset = (to.root_pitch_class - tonic_pc).rem_euclid(12);
        weight *= match offset {
            7 => 4.5,
            5 => 3.0,
            1 | 11 => 3.5,
            2 | 10 => 2.5,
            0 => 0.08,
            _ => 0.6,
        };
    } else if is_home(to) {
        weight *= if position * 2 >= length { 0.55 } else { 0.2 };
    }
    // Native diminished/augmented structures remain available, without treating
    // every possible mode's unstable tonic as a conventional major/minor tonic.
    if to.intervals.get(2).is_some_and(|fifth| *fifth != 7) && to.resolution_degree.is_none() {
        weight *= 0.7;
    }
    weight
}

fn operator_prior(operator: &str, color: &ProgressionColor) -> f64 {
    let rich = matches!(color, ProgressionColor::Adventurous);
    match operator {
        "diatonic" => {
            if rich {
                0.42
            } else {
                0.66
            }
        }
        "borrowed" => 0.16,
        "appliedDominant" => {
            if rich {
                0.14
            } else {
                0.12
            }
        }
        "leadingDiminished" => {
            if rich {
                0.09
            } else {
                0.06
            }
        }
        "alteredDominant" => 0.11,
        "tritoneSubstitution" => 0.08,
        _ => 0.0,
    }
}

fn choose_route(
    options: &ProgressionOptions,
    catalog: &ProgressionCatalog,
) -> CoreResult<Vec<usize>> {
    choose_route_with_cost(options, catalog, 0.45)
}

fn choose_route_with_cost(
    options: &ProgressionOptions,
    catalog: &ProgressionCatalog,
    cost_strength: f64,
) -> CoreResult<Vec<usize>> {
    let chords = &catalog.chords;
    let profiles: Vec<_> = chords.iter().map(periodic_chord).collect();
    let context = connection_context(catalog);
    let weights = harmonic_connection::default_weights();
    let mut costs = BTreeMap::<(usize, usize), f64>::new();
    let mut edge_cost = |from: usize, to: usize| -> CoreResult<f64> {
        if let Some(cost) = costs.get(&(from, to)) {
            return Ok(*cost);
        }
        let cost = adjacent_cost(
            &profiles[from],
            &profiles[to],
            &context,
            ConnectionGeometry::Periodic,
            &weights,
        )?;
        costs.insert((from, to), cost);
        Ok(cost)
    };
    let length = usize::from(options.length);
    let home = chords
        .iter()
        .position(|chord| is_home(chord) && chord.intervals.len() == 3)
        .ok_or_else(|| invalid("The chosen collection has no native tonic triad."))?;
    // Feasibility is evaluated backward over the same admitted edges. A directed
    // chord cannot be sampled when there is no room to realize its stated target.
    let mut viable = vec![vec![false; chords.len()]; length];
    let mut colored = vec![vec![false; chords.len()]; length];
    let requested_color = color_limit(&options.color);
    let supplies_color = |chord: &ProgressionChord| match options.color {
        ProgressionColor::Diatonic => false,
        ProgressionColor::Chromatic => {
            chord.color_cost == requested_color
                && chord.intervals.iter().any(|interval| {
                    !catalog.scale_offsets.contains(
                        &(chord.root_pitch_class + interval - catalog.tonic_pitch_class)
                            .rem_euclid(12),
                    )
                })
        }
        ProgressionColor::Adventurous => matches!(
            chord.operator.as_str(),
            "alteredDominant" | "tritoneSubstitution"
        ),
    };
    viable[length - 1][home] = true;
    for position in (0..length - 1).rev() {
        for (i, chord) in chords.iter().enumerate() {
            viable[position][i] = admitted(chord, options)
                && chords
                    .iter()
                    .enumerate()
                    .any(|(j, next)| viable[position + 1][j] && follows(chord, next, catalog));
            colored[position][i] = viable[position][i]
                && (supplies_color(chord)
                    || chords.iter().enumerate().any(|(j, next)| {
                        colored[position + 1][j] && follows(chord, next, catalog)
                    }));
        }
    }
    let mut result = vec![home];
    let mut random = Random(u64::from(options.seed));
    let mut needs_color = colored[0][home];
    for position in 1..length - 1 {
        let from_index = *result.last().unwrap();
        let from = &chords[from_index];
        let candidates: Vec<_> = chords
            .iter()
            .enumerate()
            .filter(|(i, chord)| {
                viable[position][*i]
                    && (!needs_color || colored[position][*i])
                    && admitted(chord, options)
                    && follows(from, chord, catalog)
            })
            .collect();
        let mut counts = BTreeMap::<&str, usize>::new();
        for (_, chord) in &candidates {
            *counts.entry(chord.operator.as_str()).or_default() += 1;
        }
        let mut candidate_costs = Vec::with_capacity(candidates.len());
        for (i, chord) in &candidates {
            // A prospective directed chord must be considered with its actual
            // admitted successor. Collection escape and sustained sonority are
            // charged separately from minimum periodic correspondence motion.
            let mut outgoing = f64::INFINITY;
            for (j, next) in chords.iter().enumerate().filter(|(j, next)| {
                viable[position + 1][*j]
                    && follows(chord, next, catalog)
                    && (!needs_color || supplies_color(chord) || colored[position + 1][*j])
            }) {
                let _ = next;
                outgoing = outgoing.min(edge_cost(*i, j)?);
            }
            candidate_costs.push(edge_cost(from_index, *i)? + outgoing * 0.5);
        }
        let minimum_cost = candidate_costs
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let weighted: Vec<_> = candidates
            .iter()
            .zip(&candidate_costs)
            .map(|((i, chord), cost)| {
                // Operation priors are independent of how many chord realizations
                // each operation contributes to the current catalog.
                let weight = operator_prior(&chord.operator, &options.color)
                    * preference(
                        from,
                        chord,
                        position,
                        length,
                        catalog.tonic_pitch_class,
                        &result,
                        chords,
                    )
                    / counts[chord.operator.as_str()] as f64
                    * (-cost_strength * (cost - minimum_cost)).exp();
                (*i, weight)
            })
            .collect();
        let total: f64 = weighted.iter().map(|(_, weight)| weight).sum();
        if !total.is_finite() || total <= 0.0 {
            return Err(invalid(
                "No complete progression is admitted by these premises.",
            ));
        }
        let mut threshold = random.next() * total;
        let mut selected = weighted.last().unwrap().0;
        for (i, weight) in weighted {
            threshold -= weight;
            if threshold <= 0.0 {
                selected = i;
                break;
            }
        }
        result.push(selected);
        needs_color &= !supplies_color(&chords[selected]);
    }
    result.push(home);
    Ok(result)
}

fn step_reason(
    chord: &ProgressionChord,
    before: Option<&ProgressionChord>,
    after: Option<&ProgressionChord>,
    index: usize,
    length: usize,
    catalog: &ProgressionCatalog,
) -> String {
    if let Some(degree) = chord.resolution_degree {
        let target = after.map_or_else(
            || catalog.degree_names[usize::from(degree)].clone(),
            |next| format!("{} ({})", next.roman, next.name),
        );
        return format!(
            "{} Its directed target is {target}; the next chord realizes that target.",
            chord.derivation
        );
    }
    if index == 0 {
        return format!(
            "Establish {} as the supplied center with {}. {}",
            catalog.tonic, chord.roman, chord.derivation
        );
    }
    if let Some(previous) = before.filter(|previous| previous.resolution_degree.is_some()) {
        return format!(
            "Receive the directed resolution of {} into {}. {}",
            previous.roman, chord.roman, chord.derivation
        );
    }
    if index + 1 == length && is_home(chord) {
        return format!(
            "Return to the opening center, {}. Closure depends on this whole route and the preceding voicing; the symbol alone does not guarantee a cadence.",
            catalog.tonic
        );
    }
    let role = match chord.role {
        ProgressionRole::Home => "Revisit the tonic region",
        ProgressionRole::Departure => "Leave the tonic region while retaining collection tones",
        ProgressionRole::Preparation => "Prepare a change of harmonic weight",
        ProgressionRole::Tension => "Introduce a tension-bearing sonority in this collection",
        ProgressionRole::Color => "Change the harmonic color around the same center",
    };
    let movement = before
        .map(|previous| {
            let shared = previous
                .intervals
                .iter()
                .filter(|interval| {
                    chord.intervals.iter().any(|other| {
                        (previous.root_pitch_class + **interval - chord.root_pitch_class - *other)
                            .rem_euclid(12)
                            == 0
                    })
                })
                .count();
            format!(" Shares {shared} pitch classes with {}.", previous.name)
        })
        .unwrap_or_default();
    format!("{role}.{movement} {}", chord.derivation)
}

pub fn generate(
    options: &ProgressionOptions,
    chord_ids: Option<&[String]>,
) -> CoreResult<ProgressionResult> {
    if !(4..=16).contains(&options.length)
        || !options.tempo.is_finite()
        || !(30.0..=240.0).contains(&options.tempo)
        || !options.line_continuity.is_finite()
        || !(0.0..=100.0).contains(&options.line_continuity)
    {
        return Err(invalid(
            "A progression requires 4–16 chords, finite tempo 30–240 BPM and line continuity 0–100.",
        ));
    }
    let catalog = catalog::catalog(options)?;
    let route = if let Some(ids) = chord_ids {
        if ids.len() != usize::from(options.length) {
            return Err(invalid(
                "An edited progression must contain exactly the requested number of chord IDs.",
            ));
        }
        let route: Vec<_> = ids
            .iter()
            .map(|id| {
                catalog
                    .chords
                    .iter()
                    .position(|chord| chord.id == *id)
                    .ok_or_else(|| invalid(format!("Unknown progression chord ID: {id}")))
            })
            .collect::<CoreResult<_>>()?;
        if route
            .iter()
            .any(|&i| !admitted(&catalog.chords[i], options))
        {
            return Err(invalid(
                "An edited chord exceeds the selected harmonic-color limit.",
            ));
        }
        if !is_home(&catalog.chords[route[0]]) || !is_home(&catalog.chords[*route.last().unwrap()])
        {
            return Err(invalid(
                "This centered progression begins and ends on a native tonic chord.",
            ));
        }
        if route
            .windows(2)
            .any(|pair| !follows(&catalog.chords[pair[0]], &catalog.chords[pair[1]], &catalog))
        {
            return Err(invalid(
                "An edited directed chord must be followed by its stated native target. Choose a replacement offered for this position.",
            ));
        }
        route
    } else {
        choose_route(options, &catalog)?
    };
    let chosen: Vec<_> = route.iter().map(|&i| catalog.chords[i].clone()).collect();
    let voices = voicing::voice_with_continuity(&chosen, options.line_continuity);
    let motion_options = HarmonicMotionOptions {
        period_millicents: Some(1_200_000),
        chords: chosen
            .iter()
            .zip(&voices)
            .enumerate()
            .map(|(index, (chord, pitches))| {
                motion_chord(chord, pitches, format!("progression-{index}"))
            })
            .collect(),
        frames: vec![MotionFrame {
            id: "center".into(),
            name: catalog.scale_name.clone(),
            role: MotionFrameRole::Global,
            tonic_millicents: i64::from(60 + catalog.tonic_pitch_class) * 100_000,
            collection_offsets_millicents: catalog
                .scale_offsets
                .iter()
                .map(|&n| i64::from(n) * 100_000)
                .collect(),
            target_offsets_millicents: catalog.chords[route[0]]
                .intervals
                .iter()
                .map(|&n| i64::from(n) * 100_000)
                .collect(),
            weight: 1.0,
        }],
        history: chosen
            .iter()
            .enumerate()
            .map(|(index, _)| MotionStep {
                chord_id: format!("progression-{index}"),
                duration: MotionDuration {
                    numerator: 4,
                    denominator: 1,
                },
            })
            .collect(),
        from_chord_id: "progression-0".into(),
        to_chord_id: "progression-1".into(),
        weights: MotionWeights {
            motion: 1.0,
            unmatched: 1.5,
            common_tones: 0.2,
            collection_distance: 0.8,
            target_distance: 0.4,
            target_approach: 0.6,
            history_distance: 0.2,
            repetition: 0.5,
        },
        tempo: options.tempo,
        arpeggiate: options.arpeggiate,
    };
    let plan = harmonic_motion::realize(&motion_options)?;
    let context = connection_context(&catalog);
    let connection_weights = harmonic_connection::default_weights();
    let transitions = motion_options
        .chords
        .windows(2)
        .map(|pair| {
            harmonic_connection::pair_metrics(
                &pair[0],
                &pair[1],
                Some(1_200_000),
                Some(&context),
                &connection_weights,
            )
        })
        .collect::<CoreResult<Vec<_>>>()?;
    let lines = crate::harmonic_lines::analyze_with_continuity(
        &motion_options.chords,
        &motion_options.history,
        &connection_weights,
        options.line_continuity,
    )?;
    let line_plans = solo_line_plans(&plan, &lines)?;
    let length = chosen.len();
    let steps = chosen
        .iter()
        .enumerate()
        .map(|(index, chord)| {
            let before = index.checked_sub(1).map(|i| &chosen[i]);
            let after = chosen.get(index + 1);
            let replacements: Vec<_> = catalog
                .chords
                .iter()
                .filter(|candidate| {
                    candidate.id != chord.id
                        && admitted(candidate, options)
                        && ((index != 0 && index + 1 != length) || is_home(candidate))
                        && before.is_none_or(|previous| follows(previous, candidate, &catalog))
                        && after.is_none_or(|next| follows(candidate, next, &catalog))
                })
                .collect();
            let mut ranked = replacements
                .into_iter()
                .map(|candidate| {
                    let candidate_profile = periodic_chord(candidate);
                    let mut cost = 0.0;
                    if let Some(previous) = before {
                        cost += adjacent_cost(
                            &periodic_chord(previous),
                            &candidate_profile,
                            &context,
                            ConnectionGeometry::Periodic,
                            &connection_weights,
                        )?;
                    }
                    if let Some(next) = after {
                        cost += adjacent_cost(
                            &candidate_profile,
                            &periodic_chord(next),
                            &context,
                            ConnectionGeometry::Periodic,
                            &connection_weights,
                        )?;
                    }
                    Ok((candidate, cost))
                })
                .collect::<CoreResult<Vec<_>>>()?;
            ranked.sort_by(|(a, ca), (b, cb)| ca.total_cmp(cb).then(a.id.cmp(&b.id)));
            Ok(ProgressionStep {
                index,
                chord_id: chord.id.clone(),
                chord: chord.clone(),
                voiced_name: voiced_name(chord, &voices[index]),
                voiced_midi: voices[index].clone(),
                voiced_tone_names: voiced_names(chord, &voices[index]),
                reason: step_reason(chord, before, after, index, length, &catalog),
                replacements: ranked
                    .into_iter()
                    .map(|(candidate, cost)| ProgressionReplacement {
                        chord_id: candidate.id.clone(),
                        reason: step_reason(candidate, before, after, index, length, &catalog),
                        cost,
                    })
                    .collect(),
            })
        })
        .collect::<CoreResult<Vec<_>>>()?;
    Ok(ProgressionResult {
        options: options.clone(), catalog, steps, plan, motion_options, transitions, lines, line_plans,
        explanation: "Begin at the supplied tonic, choose a route through the collection and admitted transformations, and return home. Directed chromatic chords keep their resolution targets. Incoming and prospective outgoing periodic motion, newly foreign notes and duration-weighted sonority/context costs guide chord choice; registered voicing keeps the 24 best local-motion/register passages and reranks their complete melodic lines by changes in signed step size. Line continuity is an explicit preference with a zero-weight baseline; this bounded comparison is not a global counterpoint optimum. The reported periodic correspondence is potential motion, not an inferred inversion or recovered voice. Every original chord lasts four quarters. The seed samples explicit compositional preferences, not learned probabilities or a guarantee of musical quality. Conventional naming and this generator use twelve-tone equal temperament; the advanced relation engine still accepts arbitrary native pitches and periods.".into(),
        roman_convention: "Roman roots are measured against the parallel major scale: minor-third, minor-sixth and minor-seventh roots carry ♭. Upper/lower case gives major/minor third; ° is diminished, ø7 half-diminished, + augmented, maj7 a major seventh. A slash names a temporary target (V7/V); the global Roman remains separately visible. These are authored interpretations of the generated program, not source-only chord recognition.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composition::{CompositionLimits, compile_composition};
    use std::collections::BTreeSet;

    #[test]
    fn actual_inversion_names_do_not_replace_the_harmonic_root() {
        let catalog = catalog::catalog(&catalog::default_options()).unwrap();
        let c = catalog
            .chords
            .iter()
            .find(|chord| chord.id == "scale-0-3")
            .unwrap();
        let pitches = [52, 60, 67, 72];
        assert_eq!(voiced_name(c, &pitches), "C/E");
        let motion = motion_chord(c, &pitches, "inverted".into());
        assert_eq!(motion.root_millicents, Some(6_000_000));
        assert_eq!(motion.pitches_millicents[0], 5_200_000);
        let a = catalog
            .chords
            .iter()
            .find(|chord| chord.id == "scale-5-3")
            .unwrap();
        assert_eq!(voiced_name(a, &[57, 60, 64]), "Am");
        assert_eq!(voiced_name(a, &[52, 57, 60]), "Am/E");
    }

    #[test]
    fn solo_lines_partition_actual_events_with_silence_and_arpeggio_offsets() {
        let ids = ["scale-0-3", "altered-0-flat9", "scale-0-3", "scale-0-3"].map(String::from);
        for arpeggiate in [false, true] {
            let options = ProgressionOptions {
                length: 4,
                color: ProgressionColor::Adventurous,
                arpeggiate,
                ..catalog::default_options()
            };
            let generated = generate(&options, Some(&ids)).unwrap();
            let full = compile_composition(&generated.plan, &CompositionLimits::default()).unwrap();
            let key = |note: &crate::model::ScoreNote| {
                (
                    note.part.clone(),
                    note.onset,
                    note.duration,
                    note.pitch.millicents,
                    note.velocity,
                    note.release_velocity,
                )
            };
            let mut expected = full.notes.iter().map(key).collect::<Vec<_>>();
            expected.sort();
            let mut actual = Vec::new();
            assert_eq!(generated.line_plans.len(), generated.lines.lines.len());
            for (line, plan) in generated.lines.lines.iter().zip(&generated.line_plans) {
                let solo = compile_composition(plan, &CompositionLimits::default()).unwrap();
                assert_eq!(solo.duration, full.duration);
                assert_eq!(solo.ppq, full.ppq);
                assert_eq!(solo.notes.len(), line.points.len());
                actual.extend(solo.notes.iter().map(key));
            }
            actual.sort();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn motion_and_exposure_cost_improve_matched_seed_routes() {
        let mut options = catalog::default_options();
        assert_eq!(options.seed, 7);
        let catalog = catalog::catalog(&options).unwrap();
        let context = connection_context(&catalog);
        let weights = harmonic_connection::default_weights();
        let cost = |route: &[usize]| -> f64 {
            route
                .windows(2)
                .map(|pair| {
                    adjacent_cost(
                        &periodic_chord(&catalog.chords[pair[0]]),
                        &periodic_chord(&catalog.chords[pair[1]]),
                        &context,
                        ConnectionGeometry::Periodic,
                        &weights,
                    )
                    .unwrap()
                })
                .sum()
        };
        let baseline = choose_route_with_cost(&options, &catalog, 0.0).unwrap();
        let scored = choose_route(&options, &catalog).unwrap();
        assert_ne!(scored, baseline);
        assert!(
            cost(&scored) < cost(&baseline),
            "default route: {} versus disabled {}",
            cost(&scored),
            cost(&baseline)
        );
        let mut baseline_sum = 0.0;
        let mut scored_sum = 0.0;
        for seed in 0..24 {
            options.seed = seed;
            baseline_sum += cost(&choose_route_with_cost(&options, &catalog, 0.0).unwrap());
            scored_sum += cost(&choose_route(&options, &catalog).unwrap());
        }
        assert!(
            scored_sum < baseline_sum,
            "matched seed total: {scored_sum} versus {baseline_sum}"
        );
    }

    #[test]
    fn seeded_routes_are_reproducible_and_not_fixed_presets() {
        let mut options = catalog::default_options();
        let first = generate(&options, None).unwrap();
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(generate(&options, None).unwrap()).unwrap()
        );
        let mut routes = BTreeSet::new();
        for seed in 0..12 {
            options.seed = seed;
            let result = generate(&options, None).unwrap();
            assert!(result.steps.iter().any(|step| step.chord.color_cost == 1));
            routes.insert(
                result
                    .steps
                    .iter()
                    .map(|step| step.chord_id.clone())
                    .collect::<Vec<_>>(),
            );
        }
        assert!(routes.len() >= 10);
    }

    #[test]
    fn every_mode_and_color_has_complete_admitted_short_routes() {
        let mut options = catalog::default_options();
        options.length = 4;
        for family in catalog::family_choices() {
            options.family = family.id;
            for mode in 0..7 {
                options.mode = mode;
                for color in [
                    ProgressionColor::Diatonic,
                    ProgressionColor::Chromatic,
                    ProgressionColor::Adventurous,
                ] {
                    options.color = color;
                    let result = generate(&options, None).unwrap();
                    assert!(is_home(&result.steps[0].chord));
                    assert!(is_home(&result.steps[3].chord));
                    assert!(result.steps.windows(2).all(|pair| follows(
                        &pair[0].chord,
                        &pair[1].chord,
                        &result.catalog
                    )));
                    assert!(
                        result
                            .steps
                            .iter()
                            .all(|step| step.chord.color_cost <= color_limit(&color))
                    );
                    if color != ProgressionColor::Diatonic {
                        assert!(
                            result
                                .steps
                                .iter()
                                .any(|step| step.chord.color_cost == color_limit(&color))
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn complete_passages_and_admitted_edits_use_the_composition_compiler() {
        let options = ProgressionOptions {
            color: ProgressionColor::Adventurous,
            ..catalog::default_options()
        };
        let result = generate(&options, None).unwrap();
        let score = compile_composition(&result.plan, &CompositionLimits::default()).unwrap();
        assert_eq!(score.duration, score.ppq * 4 * u64::from(options.length));
        for step in &result.steps {
            let mut emitted: Vec<_> = score
                .notes
                .iter()
                .filter(|note| note.onset == step.index as u64 * score.ppq * 4)
                .map(|note| note.pitch.millicents)
                .collect();
            emitted.sort();
            assert_eq!(
                emitted,
                step.voiced_midi
                    .iter()
                    .map(|&pitch| i64::from(pitch) * 100_000)
                    .collect::<Vec<_>>()
            );
        }
        let mut ids: Vec<_> = result
            .steps
            .iter()
            .map(|step| step.chord_id.clone())
            .collect();
        let step = result
            .steps
            .iter()
            .find(|step| {
                step.index > 0
                    && step.index + 1 < result.steps.len()
                    && !step.replacements.is_empty()
            })
            .unwrap();
        ids[step.index] = step.replacements[0].chord_id.clone();
        let edited = generate(&options, Some(&ids)).unwrap();
        assert_eq!(
            edited
                .steps
                .iter()
                .map(|step| step.chord_id.clone())
                .collect::<Vec<_>>(),
            ids
        );
        assert_ne!(
            serde_json::to_value(&result.plan).unwrap(),
            serde_json::to_value(&edited.plan).unwrap()
        );
    }

    #[test]
    fn requested_color_is_audible_and_rich_operators_are_demonstrated() {
        let mut options = ProgressionOptions {
            length: 4,
            ..catalog::default_options()
        };
        for seed in 0..32 {
            options.seed = seed;
            let result = generate(&options, None).unwrap();
            assert!(
                result
                    .steps
                    .iter()
                    .any(|step| step.chord.intervals.iter().any(|interval| !result
                        .catalog
                        .scale_offsets
                        .contains(&(step.chord.root_pitch_class + interval).rem_euclid(12))))
            );
            let rich = generate(
                &ProgressionOptions {
                    color: ProgressionColor::Adventurous,
                    ..options.clone()
                },
                None,
            )
            .unwrap();
            assert!(rich.steps.iter().any(|step| matches!(
                step.chord.operator.as_str(),
                "alteredDominant" | "tritoneSubstitution"
            )));
        }
    }

    #[test]
    fn exact_target_premises_survive_replacements_and_invalid_edits_fail() {
        let options = ProgressionOptions {
            length: 4,
            color: ProgressionColor::Adventurous,
            ..catalog::default_options()
        };
        let ids = vec![
            "scale-0-3".into(),
            "dominant-4".into(),
            "scale-4-3".into(),
            "scale-0-3".into(),
        ];
        let result = generate(&options, Some(&ids)).unwrap();
        let mut extended = ids.clone();
        extended[2] = "scale-4-4".into();
        let seventh_target = generate(&options, Some(&extended)).unwrap();
        assert_eq!(seventh_target.steps[2].chord.name, "G7");
        assert!(result.steps[2].replacements.iter().all(|replacement| {
            let target = result
                .catalog
                .chords
                .iter()
                .find(|chord| chord.id == replacement.chord_id)
                .unwrap();
            target.root_pitch_class == 7 && target.color_cost == 0 && target.degree == 4
        }));
        let mut bad = ids;
        bad[2] = "scale-3-3".into();
        assert!(generate(&options, Some(&bad)).is_err());
        // The same letter degree is insufficient: a target of E minor must not
        // accept borrowed E-flat major.
        let mut same_degree = vec![
            "scale-0-3".into(),
            "dominant-2".into(),
            "scale-2-3".into(),
            "scale-0-3".into(),
        ];
        let lawful = generate(&options, Some(&same_degree)).unwrap();
        same_degree[2] = lawful
            .catalog
            .chords
            .iter()
            .find(|chord| chord.degree == 2 && chord.root_pitch_class == 3)
            .unwrap()
            .id
            .clone();
        assert!(generate(&options, Some(&same_degree)).is_err());
        assert!(
            generate(
                &ProgressionOptions {
                    length: 3,
                    ..options.clone()
                },
                None
            )
            .is_err()
        );
        assert!(
            generate(
                &ProgressionOptions {
                    mode: 7,
                    ..options.clone()
                },
                None
            )
            .is_err()
        );
        assert!(
            generate(
                &ProgressionOptions {
                    tonic: "H".into(),
                    ..options
                },
                None
            )
            .is_err()
        );
    }
}
