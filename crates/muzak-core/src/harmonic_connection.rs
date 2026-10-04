//! Bounded, authored chord connections. Pitch-class proximity and registered
//! movement are separate projections; neither recovers a performance's voices.
use crate::{
    error::{CoreResult, invalid},
    harmonic_motion::{MotionChord, MotionDuration, MotionStep},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use ts_rs::TS;

const MAX_COORD: i64 = 1_000_000_000_000;
const SEMITONE: f64 = 100_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionGeometry {
    Registered,
    Periodic,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionContext {
    /// A supplied center, retained independently from collection membership.
    /// No tonic penalty is inferred from this optional annotation.
    pub tonic_millicents: Option<i64>,
    /// Absolute coordinates; reduced modulo the period when one is supplied.
    pub collection_millicents: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionWeights {
    /// Per 100-cent unit of total matched movement.
    pub motion_linear: f64,
    /// Per squared 100-cent unit of matched movement.
    pub motion_squared: f64,
    /// Per arrival or departure in maximum-cardinality matching.
    pub added_members: f64,
    /// Per squared count of newly entered outside-collection classes.
    pub chromatic_entry: f64,
    /// Per outside-collection class per quarter of exposure.
    pub collection_exposure: f64,
    /// Per minor-second/tritone class pair per quarter; a structural proxy.
    pub sonority_exposure: f64,
    /// Per inserted state. Strictly positive for bounded-route requests.
    pub insertion: f64,
}

pub fn default_weights() -> ConnectionWeights {
    ConnectionWeights {
        motion_linear: 0.35,
        motion_squared: 0.2,
        added_members: 1.5,
        chromatic_entry: 1.25,
        collection_exposure: 0.15,
        sonority_exposure: 0.1,
        insertion: 0.8,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarmonicConnectionOptions {
    /// Each state includes one fixed voicing used on both adjacent edges.
    pub chords: Vec<MotionChord>,
    pub from_chord_id: String,
    pub to_chord_id: String,
    pub period_millicents: Option<i64>,
    pub context: Option<ConnectionContext>,
    pub geometry: ConnectionGeometry,
    pub weights: ConnectionWeights,
    /// This existing span is divided equally among source and insertions.
    pub source_duration: MotionDuration,
    /// The destination's supplied duration remains unchanged.
    pub destination_duration: MotionDuration,
    pub max_intermediates: u8,
    /// None admits every catalog state, including repeats of endpoint states.
    /// An empty list admits only the direct connection.
    #[serde(default)]
    pub intermediate_chord_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMemberLink {
    pub from_member: usize,
    pub to_member: usize,
    pub from_millicents: i64,
    pub to_millicents: i64,
    pub registered_displacement_millicents: i64,
    /// Registered displacement, or the shortest signed periodic displacement.
    /// The deterministic representative chooses positive at exactly half-period.
    pub displacement_millicents: i64,
    /// registered_displacement = displacement + winding * period.
    pub winding: Option<i64>,
    /// The negative displacement is equally short at exactly half-period.
    /// This direction ambiguity is separate from assignment multiplicity.
    pub half_period_tie: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCorrespondence {
    pub links: Vec<ConnectionMemberLink>,
    pub departures: Vec<usize>,
    pub arrivals: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMovement {
    /// Matched-motion objective used to choose this correspondence. L1, squared
    /// motion and maximum below describe that choice, not separate optima.
    pub objective_cost: f64,
    pub total_motion_millicents: i64,
    pub mean_motion_cents: f64,
    pub max_motion_millicents: i64,
    pub squared_motion_100_cent_units: f64,
    /// Zero displacement in this geometry; periodic common tones may move octaves.
    pub common_tone_count: usize,
    /// Identical actual coordinates in the selected correspondence.
    pub held_tone_count: usize,
    pub unmatched_count: usize,
    /// Number of indexed assignments retained as equal-cost minimal DP prefixes.
    /// This is not an exhaustive count of complete costs that floating-point
    /// rounding might make equal after a much larger later edge. Half-period
    /// direction alternatives are reported on links, not multiplied in.
    pub optimal_correspondence_count: u64,
    pub representative: ConnectionCorrespondence,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStrain {
    pub minor_second_pairs: usize,
    pub tritone_pairs: usize,
    /// Count of the two kinds of unordered, distinct pitch-class pairs.
    /// This is interval content, not acoustic roughness or perceived dissonance.
    pub value: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMetrics {
    pub registered: ConnectionMovement,
    pub periodic: Option<ConnectionMovement>,
    /// Null means no collection was supplied; empty means known and in-collection.
    pub source_outside_classes: Option<Vec<i64>>,
    pub destination_outside_classes: Option<Vec<i64>>,
    pub new_outside_classes: Option<Vec<i64>>,
    /// Known only for an octave period and exact twelve-equal-division intervals.
    pub source_strain: Option<ConnectionStrain>,
    pub destination_strain: Option<ConnectionStrain>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionExposure {
    pub chord_id: String,
    pub duration: MotionDuration,
    pub quarters: f64,
    pub outside_class_quarters: Option<f64>,
    pub strain_pair_quarters: Option<f64>,
    pub collection_cost: f64,
    pub sonority_cost: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCost {
    pub motion_linear: f64,
    pub motion_squared: f64,
    pub added_members: f64,
    pub chromatic_entry: f64,
    pub collection_exposure: f64,
    pub sonority_exposure: f64,
    pub insertion: f64,
    pub total: f64,
}

impl ConnectionCost {
    fn sum(&mut self) {
        self.total = self.motion_linear
            + self.motion_squared
            + self.added_members
            + self.chromatic_entry
            + self.collection_exposure
            + self.sonority_exposure
            + self.insertion;
    }

    fn add(&mut self, other: &Self) {
        self.motion_linear += other.motion_linear;
        self.motion_squared += other.motion_squared;
        self.added_members += other.added_members;
        self.chromatic_entry += other.chromatic_entry;
        self.collection_exposure += other.collection_exposure;
        self.sonority_exposure += other.sonority_exposure;
        self.insertion += other.insertion;
        self.sum();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTransition {
    pub from_chord_id: String,
    pub to_chord_id: String,
    pub metrics: ConnectionMetrics,
    pub source_exposure: ConnectionExposure,
    pub destination_exposure: ConnectionExposure,
    /// Movement and chromatic entry only. Each node exposure is charged exactly
    /// once in the route total, rather than once for each incident edge.
    pub edge_cost: ConnectionCost,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRoute {
    pub chord_ids: Vec<String>,
    pub schedule: Vec<MotionStep>,
    pub exposures: Vec<ConnectionExposure>,
    pub transitions: Vec<ConnectionTransition>,
    pub cost: ConnectionCost,
    pub intermediate_count: u8,
    /// Count of paths retained through equal-cost minimal DP prefixes. Complete
    /// paths rounded into equality after a larger later edge may not be counted.
    pub optimal_route_count: u64,
    pub cost_change_from_direct: f64,
    /// Sum of selected-geometry L1 over the entire route, independently of cost.
    pub total_motion_millicents: i64,
    /// Largest selected matched-member displacement on any edge.
    pub max_motion_millicents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicConnectionAnalysis {
    pub direct: ConnectionRoute,
    /// One minimum per admitted insertion count, beginning with the direct path.
    pub routes: Vec<ConnectionRoute>,
    pub best_route_index: usize,
    pub geometry: ConnectionGeometry,
    pub state_count: usize,
    pub intermediate_state_count: usize,
    pub diagnostics: Vec<String>,
}

fn coordinate_valid(pitch: i64) -> bool {
    pitch.unsigned_abs() <= MAX_COORD as u64
}

pub(crate) fn validate_pitches(pitches: &[i64]) -> CoreResult<()> {
    if pitches.is_empty()
        || pitches.len() > 8
        || pitches.iter().any(|&pitch| !coordinate_valid(pitch))
    {
        return Err(invalid(
            "Connection states need 1–8 ordered members within ±10^12 native millicents.",
        ));
    }
    Ok(())
}

pub(crate) fn validate_weights(weights: &ConnectionWeights) -> CoreResult<()> {
    if [
        weights.motion_linear,
        weights.motion_squared,
        weights.added_members,
        weights.chromatic_entry,
        weights.collection_exposure,
        weights.sonority_exposure,
        weights.insertion,
    ]
    .iter()
    .any(|w| !w.is_finite() || !(0.0..=100.0).contains(w))
    {
        return Err(invalid(
            "Connection weights must be finite numbers in 0–100.",
        ));
    }
    Ok(())
}

fn validate_context(period: Option<i64>, context: Option<&ConnectionContext>) -> CoreResult<()> {
    if period.is_some_and(|p| p <= 0 || p > MAX_COORD) {
        return Err(invalid(
            "Connection period must be positive and at most 10^12 millicents.",
        ));
    }
    if context.is_some_and(|c| {
        c.tonic_millicents.is_some_and(|p| !coordinate_valid(p))
            || c.collection_millicents.len() > 128
            || c.collection_millicents
                .iter()
                .any(|&p| !coordinate_valid(p))
    }) {
        return Err(invalid(
            "Connection context admits at most 128 safe native collection coordinates.",
        ));
    }
    Ok(())
}

fn wrapped(raw: i64, period: i64) -> (i64, bool) {
    let positive = raw.rem_euclid(period);
    let half_tie = positive * 2 == period;
    (
        if positive * 2 > period {
            positive - period
        } else {
            positive
        },
        half_tie,
    )
}

fn link(from: &[i64], to: &[i64], i: usize, j: usize, period: Option<i64>) -> ConnectionMemberLink {
    let raw = to[j] - from[i];
    let (displacement, half_period_tie) = period.map_or((raw, false), |p| wrapped(raw, p));
    ConnectionMemberLink {
        from_member: i,
        to_member: j,
        from_millicents: from[i],
        to_millicents: to[j],
        registered_displacement_millicents: raw,
        displacement_millicents: displacement,
        winding: period.map(|p| (raw - displacement) / p),
        half_period_tie,
    }
}

fn unit_cost(delta: i64, weights: &ConnectionWeights) -> f64 {
    let units = delta.unsigned_abs() as f64 / SEMITONE;
    weights.motion_linear * units + weights.motion_squared * units * units
}

/// Maximum-cardinality injections via a bitmask DP. The smaller side is fully
/// matched; remaining members are explicit arrivals/departures, never invented
/// correspondences. All arithmetic/order is fixed; ties use exact f64 equality.
fn matching(
    from: &[i64],
    to: &[i64],
    period: Option<i64>,
    weights: &ConnectionWeights,
) -> (f64, u64, Vec<(usize, usize)>) {
    let source_small = from.len() <= to.len();
    let small = from.len().min(to.len());
    let large = from.len().max(to.len());
    let states = 1 << large;
    let mut costs = [f64::INFINITY; 256];
    let mut counts = [0u64; 256];
    let mut previous = [0usize; 256];
    let mut assigned = [0usize; 256];
    costs[0] = 0.0;
    counts[0] = 1;
    for mask in 0usize..states {
        let member = mask.count_ones() as usize;
        if member >= small || !costs[mask].is_finite() {
            continue;
        }
        for other in 0..large {
            if mask & (1 << other) != 0 {
                continue;
            }
            let (i, j) = if source_small {
                (member, other)
            } else {
                (other, member)
            };
            let raw = to[j] - from[i];
            let delta = period.map_or(raw, |p| wrapped(raw, p).0);
            let candidate = costs[mask] + unit_cost(delta, weights);
            let next = mask | (1 << other);
            if candidate < costs[next] {
                costs[next] = candidate;
                counts[next] = counts[mask];
                previous[next] = mask;
                assigned[next] = other;
            } else if candidate == costs[next] {
                counts[next] += counts[mask];
            }
        }
    }
    let mut best = f64::INFINITY;
    let mut count = 0;
    let mut selected = 0;
    for mask in 0usize..states {
        if mask.count_ones() as usize != small {
            continue;
        }
        if costs[mask] < best {
            best = costs[mask];
            count = counts[mask];
            selected = mask;
        } else if costs[mask] == best {
            count += counts[mask];
        }
    }
    let mut pairs = Vec::with_capacity(small);
    while selected != 0 {
        let member = selected.count_ones() as usize - 1;
        let other = assigned[selected];
        pairs.push(if source_small {
            (member, other)
        } else {
            (other, member)
        });
        selected = previous[selected];
    }
    pairs.sort_unstable();
    (best, count, pairs)
}

/// Shared scalar for register-search callers; avoids building contextual reports.
pub fn registered_cost(from: &[i64], to: &[i64], weights: &ConnectionWeights) -> CoreResult<f64> {
    validate_pitches(from)?;
    validate_pitches(to)?;
    validate_weights(weights)?;
    Ok(matching(from, to, None, weights).0
        + from.len().abs_diff(to.len()) as f64 * weights.added_members)
}

fn movement(
    from: &[i64],
    to: &[i64],
    period: Option<i64>,
    weights: &ConnectionWeights,
) -> ConnectionMovement {
    let (objective_cost, count, pairs) = matching(from, to, period, weights);
    let links = pairs
        .iter()
        .map(|&(i, j)| link(from, to, i, j, period))
        .collect::<Vec<_>>();
    let departures = (0..from.len())
        .filter(|i| !pairs.iter().any(|&(a, _)| a == *i))
        .collect::<Vec<_>>();
    let arrivals = (0..to.len())
        .filter(|j| !pairs.iter().any(|&(_, b)| b == *j))
        .collect::<Vec<_>>();
    let total = links.iter().map(|l| l.displacement_millicents.abs()).sum();
    ConnectionMovement {
        objective_cost,
        total_motion_millicents: total,
        mean_motion_cents: total as f64 / 1000.0 / links.len() as f64,
        max_motion_millicents: links
            .iter()
            .map(|l| l.displacement_millicents.abs())
            .max()
            .unwrap_or(0),
        squared_motion_100_cent_units: links
            .iter()
            .map(|l| (l.displacement_millicents as f64 / SEMITONE).powi(2))
            .sum(),
        common_tone_count: links
            .iter()
            .filter(|l| l.displacement_millicents == 0)
            .count(),
        held_tone_count: links
            .iter()
            .filter(|l| l.registered_displacement_millicents == 0)
            .count(),
        unmatched_count: arrivals.len() + departures.len(),
        optimal_correspondence_count: count,
        representative: ConnectionCorrespondence {
            links,
            departures,
            arrivals,
        },
    }
}

fn classes(pitches: &[i64], period: Option<i64>) -> BTreeSet<i64> {
    pitches
        .iter()
        .map(|&p| period.map_or(p, |period| p.rem_euclid(period)))
        .collect()
}

fn outside(
    chord: &MotionChord,
    period: Option<i64>,
    context: Option<&ConnectionContext>,
) -> Option<Vec<i64>> {
    context.map(|context| {
        let collection = classes(&context.collection_millicents, period);
        classes(&chord.pitches_millicents, period)
            .difference(&collection)
            .copied()
            .collect()
    })
}

fn strain(chord: &MotionChord, period: Option<i64>) -> Option<ConnectionStrain> {
    if period != Some(1_200_000)
        || chord
            .pitches_millicents
            .iter()
            .any(|p| (p - chord.pitches_millicents[0]).rem_euclid(100_000) != 0)
    {
        return None;
    }
    let pitches = classes(&chord.pitches_millicents, period)
        .into_iter()
        .collect::<Vec<_>>();
    let mut result = ConnectionStrain {
        minor_second_pairs: 0,
        tritone_pairs: 0,
        value: 0,
    };
    for (i, &a) in pitches.iter().enumerate() {
        for &b in &pitches[i + 1..] {
            match (b - a).rem_euclid(1_200_000) / 100_000 {
                1 | 11 => result.minor_second_pairs += 1,
                6 => result.tritone_pairs += 1,
                _ => (),
            }
        }
    }
    result.value = result.minor_second_pairs + result.tritone_pairs;
    Some(result)
}

pub fn pair_metrics(
    from: &MotionChord,
    to: &MotionChord,
    period: Option<i64>,
    context: Option<&ConnectionContext>,
    weights: &ConnectionWeights,
) -> CoreResult<ConnectionMetrics> {
    validate_pitches(&from.pitches_millicents)?;
    validate_pitches(&to.pitches_millicents)?;
    validate_context(period, context)?;
    validate_weights(weights)?;
    let source_outside_classes = outside(from, period, context);
    let destination_outside_classes = outside(to, period, context);
    let new_outside_classes = source_outside_classes
        .as_ref()
        .zip(destination_outside_classes.as_ref())
        .map(|(from, to)| to.iter().filter(|p| !from.contains(p)).copied().collect());
    Ok(ConnectionMetrics {
        registered: movement(
            &from.pitches_millicents,
            &to.pitches_millicents,
            None,
            weights,
        ),
        periodic: period.map(|p| {
            movement(
                &from.pitches_millicents,
                &to.pitches_millicents,
                Some(p),
                weights,
            )
        }),
        source_outside_classes,
        destination_outside_classes,
        new_outside_classes,
        source_strain: strain(from, period),
        destination_strain: strain(to, period),
    })
}

pub fn movement_cost(movement: &ConnectionMovement, weights: &ConnectionWeights) -> f64 {
    // Match the DP's smaller-side accumulation order, including when unequal
    // cardinality makes destination order differ from displayed source order.
    let correspondence = &movement.representative;
    let source_small = correspondence.departures.len() <= correspondence.arrivals.len();
    let mut cost = 0.0;
    for member in 0..correspondence.links.len() {
        let link = correspondence
            .links
            .iter()
            .find(|link| {
                if source_small {
                    link.from_member == member
                } else {
                    link.to_member == member
                }
            })
            .expect("maximum-cardinality correspondence covers its smaller side");
        cost += unit_cost(link.displacement_millicents, weights);
    }
    cost + movement.unmatched_count as f64 * weights.added_members
}

fn selected(
    metrics: &ConnectionMetrics,
    geometry: ConnectionGeometry,
) -> CoreResult<&ConnectionMovement> {
    match geometry {
        ConnectionGeometry::Registered => Ok(&metrics.registered),
        ConnectionGeometry::Periodic => metrics
            .periodic
            .as_ref()
            .ok_or_else(|| invalid("Periodic connection scoring requires a supplied period.")),
    }
}

/// Shared edge plus destination-exposure scorer. Source exposure is deliberately
/// excluded: a route adds its initial source once and each arrival once.
pub fn transition_cost(
    metrics: &ConnectionMetrics,
    geometry: ConnectionGeometry,
    duration: f64,
    weights: &ConnectionWeights,
) -> CoreResult<ConnectionCost> {
    validate_weights(weights)?;
    if !duration.is_finite() || !(0.0..=64.0).contains(&duration) {
        return Err(invalid(
            "Connection exposure duration must be finite in 0–64 quarters.",
        ));
    }
    let movement = selected(metrics, geometry)?;
    let mut cost = ConnectionCost {
        motion_linear: movement.total_motion_millicents as f64 / SEMITONE * weights.motion_linear,
        motion_squared: movement.squared_motion_100_cent_units * weights.motion_squared,
        added_members: movement.unmatched_count as f64 * weights.added_members,
        chromatic_entry: metrics.new_outside_classes.as_ref().map_or(0.0, |v| {
            (v.len() * v.len()) as f64 * weights.chromatic_entry
        }),
        collection_exposure: metrics
            .destination_outside_classes
            .as_ref()
            .map_or(0.0, |v| {
                v.len() as f64 * duration * weights.collection_exposure
            }),
        sonority_exposure: metrics.destination_strain.as_ref().map_or(0.0, |v| {
            v.value as f64 * duration * weights.sonority_exposure
        }),
        ..ConnectionCost::default()
    };
    cost.sum();
    // The explanatory components can differ in their last floating-point bit
    // from this fixed recurrence. Selection and reported total use the latter.
    cost.total = movement_cost(movement, weights)
        + cost.chromatic_entry
        + cost.collection_exposure
        + cost.sonority_exposure;
    Ok(cost)
}

fn quarters(duration: &MotionDuration) -> f64 {
    duration.numerator as f64 / duration.denominator as f64
}

fn exposure(
    chord: &MotionChord,
    duration: &MotionDuration,
    options: &HarmonicConnectionOptions,
) -> ConnectionExposure {
    let quarters = quarters(duration);
    let outside_class_quarters =
        outside(chord, options.period_millicents, options.context.as_ref())
            .map(|v| v.len() as f64 * quarters);
    let strain_pair_quarters =
        strain(chord, options.period_millicents).map(|s| s.value as f64 * quarters);
    ConnectionExposure {
        chord_id: chord.id.clone(),
        duration: duration.clone(),
        quarters,
        outside_class_quarters,
        strain_pair_quarters,
        collection_cost: outside_class_quarters.unwrap_or(0.0)
            * options.weights.collection_exposure,
        sonority_cost: strain_pair_quarters.unwrap_or(0.0) * options.weights.sonority_exposure,
    }
}

fn split_duration(duration: &MotionDuration, count: u8) -> MotionDuration {
    let mut numerator = duration.numerator;
    let mut denominator = duration.denominator * (count as u16 + 1);
    let (mut a, mut b) = (numerator, denominator);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    numerator /= a;
    denominator /= a;
    MotionDuration {
        numerator,
        denominator,
    }
}

fn validate_options(options: &HarmonicConnectionOptions) -> CoreResult<(usize, usize, Vec<usize>)> {
    validate_weights(&options.weights)?;
    validate_context(options.period_millicents, options.context.as_ref())?;
    if options.chords.is_empty()
        || options.chords.len() > 128
        || options.max_intermediates > 3
        || options.weights.insertion <= 0.0
        || (options.geometry == ConnectionGeometry::Periodic && options.period_millicents.is_none())
        || !(1..=64).contains(&options.source_duration.numerator)
        || !(1..=256).contains(&options.source_duration.denominator)
        || !(1..=64).contains(&options.destination_duration.numerator)
        || !(1..=1024).contains(&options.destination_duration.denominator)
    {
        return Err(invalid(
            "Connections admit 1–128 states, 0–3 insertions, a positive insertion weight, and positive durations (numerators 1–64; source denominator 1–256, destination 1–1024). Periodic geometry requires a period.",
        ));
    }
    let mut ids = BTreeSet::new();
    for chord in &options.chords {
        validate_pitches(&chord.pitches_millicents)?;
        if chord.id.is_empty()
            || chord.id.len() > 128
            || !ids.insert(chord.id.as_str())
            || chord.root_millicents.is_some_and(|p| !coordinate_valid(p))
        {
            return Err(invalid(
                "Connection states require unique nonempty IDs up to 128 bytes and safe optional roots.",
            ));
        }
    }
    let index = |id: &str| {
        options
            .chords
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| invalid(format!("Connection chord ID {id:?} does not exist.")))
    };
    let from = index(&options.from_chord_id)?;
    let to = index(&options.to_chord_id)?;
    let intermediates = if let Some(admitted) = &options.intermediate_chord_ids {
        if admitted.len() > 128 || admitted.iter().collect::<BTreeSet<_>>().len() != admitted.len()
        {
            return Err(invalid(
                "Intermediate state IDs must be unique and at most 128.",
            ));
        }
        admitted
            .iter()
            .map(|id| index(id))
            .collect::<CoreResult<Vec<_>>>()?
    } else {
        (0..options.chords.len()).collect()
    };
    Ok((from, to, intermediates))
}

fn make_route(
    options: &HarmonicConnectionOptions,
    path: &[usize],
    count: u64,
    matrix: &[Vec<ConnectionMetrics>],
) -> CoreResult<ConnectionRoute> {
    let intermediate_count = (path.len() - 2) as u8;
    let slice = split_duration(&options.source_duration, intermediate_count);
    let schedule = path
        .iter()
        .enumerate()
        .map(|(i, &index)| MotionStep {
            chord_id: options.chords[index].id.clone(),
            duration: if i + 1 == path.len() {
                options.destination_duration.clone()
            } else {
                slice.clone()
            },
        })
        .collect::<Vec<_>>();
    let exposures = path
        .iter()
        .zip(&schedule)
        .map(|(&index, step)| exposure(&options.chords[index], &step.duration, options))
        .collect::<Vec<_>>();
    let mut cost = ConnectionCost::default();
    let mut transitions = Vec::new();
    let mut total_motion_millicents = 0;
    let mut max_motion_millicents = 0;
    for (i, pair) in path.windows(2).enumerate() {
        let metrics = matrix[pair[0]][pair[1]].clone();
        let edge_cost = transition_cost(&metrics, options.geometry, 0.0, &options.weights)?;
        let movement = selected(&metrics, options.geometry)?;
        total_motion_millicents += movement.total_motion_millicents;
        max_motion_millicents = max_motion_millicents.max(movement.max_motion_millicents);
        cost.add(&edge_cost);
        transitions.push(ConnectionTransition {
            from_chord_id: options.chords[pair[0]].id.clone(),
            to_chord_id: options.chords[pair[1]].id.clone(),
            metrics,
            source_exposure: exposures[i].clone(),
            destination_exposure: exposures[i + 1].clone(),
            edge_cost,
        });
    }
    cost.collection_exposure = exposures.iter().map(|x| x.collection_cost).sum();
    cost.sonority_exposure = exposures.iter().map(|x| x.sonority_cost).sum();
    cost.insertion = intermediate_count as f64 * options.weights.insertion;
    cost.sum();
    let mut objective = exposures[0].collection_cost + exposures[0].sonority_cost;
    for (i, pair) in path.windows(2).enumerate() {
        let arrival = transition_cost(
            &matrix[pair[0]][pair[1]],
            options.geometry,
            quarters(&schedule[i + 1].duration),
            &options.weights,
        )?;
        objective += arrival.total;
        if i + 2 < path.len() {
            objective += options.weights.insertion;
        }
    }
    cost.total = objective;
    Ok(ConnectionRoute {
        chord_ids: schedule.iter().map(|s| s.chord_id.clone()).collect(),
        schedule,
        exposures,
        transitions,
        cost,
        intermediate_count,
        optimal_route_count: count,
        cost_change_from_direct: 0.0,
        total_motion_millicents,
        max_motion_millicents,
    })
}

pub fn analyze(options: &HarmonicConnectionOptions) -> CoreResult<HarmonicConnectionAnalysis> {
    let (from, to, intermediates) = validate_options(options)?;
    let matrix = options
        .chords
        .iter()
        .map(|a| {
            options
                .chords
                .iter()
                .map(|b| {
                    pair_metrics(
                        a,
                        b,
                        options.period_millicents,
                        options.context.as_ref(),
                        &options.weights,
                    )
                })
                .collect::<CoreResult<Vec<_>>>()
        })
        .collect::<CoreResult<Vec<_>>>()?;
    let n = options.chords.len();
    let mut routes = vec![make_route(options, &[from, to], 1, &matrix)?];
    if !intermediates.is_empty() {
        for inserted in 1..=options.max_intermediates {
            let duration = split_duration(&options.source_duration, inserted);
            let start_exposure = exposure(&options.chords[from], &duration, options);
            let mut costs = vec![f64::INFINITY; n];
            let mut counts = vec![0u64; n];
            let mut paths = vec![Vec::<usize>::new(); n];
            costs[from] = start_exposure.collection_cost + start_exposure.sonority_cost;
            counts[from] = 1;
            paths[from] = vec![from];
            for _ in 0..inserted {
                let mut next_costs = vec![f64::INFINITY; n];
                let mut next_counts = vec![0u64; n];
                let mut next_paths = vec![Vec::<usize>::new(); n];
                for a in 0..n {
                    if !costs[a].is_finite() {
                        continue;
                    }
                    for &b in &intermediates {
                        let edge = transition_cost(
                            &matrix[a][b],
                            options.geometry,
                            quarters(&duration),
                            &options.weights,
                        )?;
                        let candidate = costs[a] + edge.total + options.weights.insertion;
                        if candidate < next_costs[b] {
                            next_costs[b] = candidate;
                            next_counts[b] = counts[a];
                            next_paths[b] = paths[a].iter().copied().chain([b]).collect();
                        } else if candidate == next_costs[b] {
                            next_counts[b] += counts[a];
                        }
                    }
                }
                costs = next_costs;
                counts = next_counts;
                paths = next_paths;
            }
            let mut best = f64::INFINITY;
            let mut ties = 0;
            let mut path = Vec::new();
            for a in 0..n {
                if !costs[a].is_finite() {
                    continue;
                }
                let edge = transition_cost(
                    &matrix[a][to],
                    options.geometry,
                    quarters(&options.destination_duration),
                    &options.weights,
                )?;
                let candidate = costs[a] + edge.total;
                if candidate < best {
                    best = candidate;
                    ties = counts[a];
                    path = paths[a].iter().copied().chain([to]).collect();
                } else if candidate == best {
                    ties += counts[a];
                }
            }
            if path.is_empty() {
                return Err(invalid(
                    "The bounded connection search unexpectedly lost an admitted path.",
                ));
            }
            routes.push(make_route(options, &path, ties, &matrix)?);
        }
    }
    let direct = routes[0].clone();
    for route in &mut routes {
        route.cost_change_from_direct = route.cost.total - direct.cost.total;
    }
    let best_route_index = routes
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.cost.total.total_cmp(&b.cost.total))
        .map(|(i, _)| i)
        .unwrap_or(0);
    let mut diagnostics = vec![
        "Finite-domain optimum only: each catalog state has fixed ordered native members; endpoint voicings are preserved and no states are silently pruned.".into(),
        "Each insertion count has its own exact-duration schedule: the original source span is divided equally among source and insertions; destination duration stays fixed.".into(),
        "Motion uses maximum-cardinality matching with linear and squared costs in 100-cent units. Tie counts count equal-cost minimal DP prefixes; they are not exhaustive counts of complete paths that later floating-point rounding might make equal, algebraic-real equivalence or recovered voices.".into(),
        "L1 and maximum motion describe the cost-selected correspondence, not independent minima. Reported objective totals follow the search's fixed accumulation order; regrouped explanatory components may differ in their final floating-point bits.".into(),
        "Periodic links retain exact endpoints and windings. A wrapped matching does not change the played chord's bass or inversion.".into(),
        "For equal cardinalities and pure L1, intermediate chords cannot beat the direct metric distance. Squared motion, maximum step and contextual exposure answer different questions.".into(),
        "The optional twelve-division minor-second/tritone count is interval content, not acoustic roughness, harmonic function or a listener-validated quality scale.".into(),
        "Bounds: 128 states, 8 members, 3 insertions, 128 context members, coordinates and period up to 10^12 millicents, finite nonnegative weights up to 100, strictly positive insertion weight.".into(),
    ];
    if options.context.is_none() {
        diagnostics.push("No collection context was supplied; collection and chromatic-entry evidence is unknown, with zero objective contribution.".into());
    }
    if options.intermediate_chord_ids.is_none() {
        diagnostics.push("All catalog states are admitted as insertions, including endpoint repeats and cycles; the positive insertion charge remains explicit.".into());
    }
    Ok(HarmonicConnectionAnalysis {
        direct,
        routes,
        best_route_index,
        geometry: options.geometry,
        state_count: n,
        intermediate_state_count: intermediates.len(),
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(id: &str, notes: &[i64]) -> MotionChord {
        MotionChord {
            id: id.into(),
            name: id.into(),
            root_millicents: None,
            pitches_millicents: notes.iter().map(|p| p * 100_000).collect(),
        }
    }

    fn weights() -> ConnectionWeights {
        ConnectionWeights {
            motion_linear: 0.0,
            motion_squared: 1.0,
            added_members: 0.0,
            chromatic_entry: 0.0,
            collection_exposure: 0.0,
            sonority_exposure: 0.0,
            insertion: 1.0,
        }
    }

    fn options(chords: Vec<MotionChord>) -> HarmonicConnectionOptions {
        HarmonicConnectionOptions {
            from_chord_id: chords[0].id.clone(),
            to_chord_id: chords[chords.len() - 1].id.clone(),
            chords,
            period_millicents: Some(1_200_000),
            context: None,
            geometry: ConnectionGeometry::Registered,
            weights: weights(),
            source_duration: MotionDuration {
                numerator: 4,
                denominator: 1,
            },
            destination_duration: MotionDuration {
                numerator: 4,
                denominator: 1,
            },
            max_intermediates: 3,
            intermediate_chord_ids: None,
        }
    }

    #[test]
    fn corrected_periodic_loop_preserves_authored_am() {
        let chords = [
            chord("am", &[69, 72, 76]),
            chord("abm", &[68, 71, 75]),
            chord("g", &[67, 71, 74]),
            chord("gbm", &[66, 70, 73]),
            chord("am", &[69, 72, 76]),
        ];
        for (index, pair) in chords.windows(2).enumerate() {
            let m = pair_metrics(&pair[0], &pair[1], Some(1_200_000), None, &weights()).unwrap();
            assert_eq!(
                m.periodic.as_ref().unwrap().total_motion_millicents,
                [300_000, 200_000, 300_000, 400_000][index]
            );
            assert_eq!(
                m.periodic.as_ref().unwrap().squared_motion_100_cent_units,
                [3.0, 2.0, 3.0, 6.0][index]
            );
        }
        let last = pair_metrics(&chords[3], &chords[4], Some(1_200_000), None, &weights()).unwrap();
        let links = &last.periodic.unwrap().representative.links;
        assert_eq!(
            links
                .iter()
                .map(|l| l.displacement_millicents)
                .collect::<Vec<_>>(),
            vec![-200_000, -100_000, -100_000]
        );
        assert_eq!(
            links.iter().map(|l| l.to_millicents).collect::<Vec<_>>(),
            vec![7_600_000, 6_900_000, 7_200_000]
        );
        assert_eq!(
            chords[4].pitches_millicents,
            vec![6_900_000, 7_200_000, 7_600_000]
        );
        assert_eq!(
            pair_metrics(&chords[0], &chords[4], Some(1_200_000), None, &weights())
                .unwrap()
                .registered
                .total_motion_millicents,
            0
        );
    }

    #[test]
    fn octave_motion_and_half_period_direction_are_not_inversions() {
        let a = chord("a", &[60]);
        let b = chord("b", &[72]);
        let metrics = pair_metrics(&a, &b, Some(1_200_000), None, &weights()).unwrap();
        assert_eq!(metrics.registered.total_motion_millicents, 1_200_000);
        let periodic = metrics.periodic.unwrap();
        assert_eq!(periodic.total_motion_millicents, 0);
        assert_eq!(periodic.held_tone_count, 0);
        assert_eq!(periodic.representative.links[0].winding, Some(1));
        let half = pair_metrics(&a, &chord("half", &[66]), Some(1_200_000), None, &weights())
            .unwrap()
            .periodic
            .unwrap();
        assert_eq!(half.optimal_correspondence_count, 1);
        assert!(half.representative.links[0].half_period_tie);
        assert_eq!(
            half.representative.links[0].displacement_millicents,
            600_000
        );
    }

    #[test]
    fn duplicate_members_and_unmatched_emissions_remain_explicit() {
        let m = pair_metrics(
            &chord("a", &[60, 60]),
            &chord("b", &[60, 60, 64]),
            Some(1_200_000),
            None,
            &weights(),
        )
        .unwrap();
        assert_eq!(m.registered.optimal_correspondence_count, 2);
        assert_eq!(m.registered.representative.arrivals, vec![2]);
        assert_eq!(m.registered.representative.departures.len(), 0);
        assert_eq!(m.registered.unmatched_count, 1);
    }

    #[test]
    fn squared_cost_can_reward_bridges_while_l1_cannot() {
        let mut request = options(vec![
            chord("a", &[60]),
            chord("bridge", &[62]),
            chord("b", &[64]),
        ]);
        request.max_intermediates = 1;
        request.intermediate_chord_ids = Some(vec!["bridge".into()]);
        let result = analyze(&request).unwrap();
        assert_eq!(result.direct.cost.total, 16.0);
        assert_eq!(result.routes[1].cost.total, 9.0);
        assert_eq!(
            result.routes[1].total_motion_millicents,
            result.direct.total_motion_millicents
        );
        assert_eq!(result.routes[1].max_motion_millicents, 200_000);
        assert_eq!(result.best_route_index, 1);
        assert_eq!(
            result.routes[1]
                .schedule
                .iter()
                .map(|s| quarters(&s.duration))
                .collect::<Vec<_>>(),
            vec![2.0, 2.0, 4.0]
        );
        request.weights.insertion = 10.0;
        assert_eq!(analyze(&request).unwrap().best_route_index, 0);
        request.weights.motion_squared = 0.0;
        request.weights.motion_linear = 1.0;
        request.weights.insertion = 1.0;
        assert_eq!(analyze(&request).unwrap().best_route_index, 0);
    }

    #[test]
    fn exposure_uses_every_allocated_span_and_unknown_stays_unknown() {
        let mut request = options(vec![
            chord("a", &[60, 61, 62]),
            chord("bridge", &[60, 61]),
            chord("b", &[60]),
        ]);
        request.context = Some(ConnectionContext {
            tonic_millicents: None,
            collection_millicents: vec![6_000_000],
        });
        request.weights = ConnectionWeights {
            collection_exposure: 1.0,
            insertion: 0.5,
            motion_squared: 0.0,
            ..weights()
        };
        request.max_intermediates = 1;
        request.intermediate_chord_ids = Some(vec!["bridge".into()]);
        let result = analyze(&request).unwrap();
        assert_eq!(result.direct.cost.collection_exposure, 8.0);
        assert_eq!(result.routes[1].cost.collection_exposure, 6.0);
        assert_eq!(
            result.routes[1]
                .exposures
                .iter()
                .map(|s| s.quarters)
                .sum::<f64>(),
            8.0
        );
        request.context = None;
        let unknown = analyze(&request).unwrap();
        assert!(unknown.direct.exposures[0].outside_class_quarters.is_none());
        assert_eq!(unknown.direct.cost.collection_exposure, 0.0);
        request.period_millicents = Some(1_900_000);
        assert!(
            analyze(&request).unwrap().direct.transitions[0]
                .metrics
                .destination_strain
                .is_none()
        );
    }

    #[test]
    fn bounded_dp_matches_tiny_exhaustive_paths_and_tie_counts() {
        let mut request = options(vec![
            chord("a", &[60]),
            chord("x", &[62]),
            chord("y", &[64]),
            chord("b", &[67]),
        ]);
        request.intermediate_chord_ids = Some(vec!["x".into(), "y".into()]);
        let result = analyze(&request).unwrap();
        for inserted in 0usize..=3 {
            let mut best = f64::INFINITY;
            let mut ties = 0;
            for mask in 0usize..1 << inserted {
                let mut pitches = vec![60i64];
                pitches.extend((0..inserted).map(|i| if mask & (1 << i) == 0 { 62 } else { 64 }));
                pitches.push(67);
                let cost = pitches
                    .windows(2)
                    .map(|p| ((p[1] - p[0]) as f64).powi(2))
                    .sum::<f64>()
                    + inserted as f64;
                if cost < best {
                    best = cost;
                    ties = 1;
                } else if cost == best {
                    ties += 1;
                }
            }
            assert_eq!(result.routes[inserted].cost.total, best);
            assert_eq!(result.routes[inserted].optimal_route_count, ties);
        }
    }

    #[test]
    fn cost_bounds_and_empty_intermediate_domain_are_explicit() {
        let mut request = options(vec![chord("a", &[60]), chord("b", &[64])]);
        request.intermediate_chord_ids = Some(vec![]);
        assert_eq!(analyze(&request).unwrap().routes.len(), 1);
        request.weights.insertion = 0.0;
        assert!(analyze(&request).is_err());
        request.weights.insertion = 1.0;
        request.weights.motion_squared = f64::NAN;
        assert!(analyze(&request).is_err());
        request.weights.motion_squared = 1.0;
        request.chords[0].pitches_millicents[0] = i64::MIN;
        assert!(analyze(&request).is_err());
    }

    #[test]
    fn numerical_tie_count_is_explicitly_a_minimum_prefix_count() {
        // A very large final move can round two different prefix costs into the
        // same complete f64 value. The documented DP-prefix count stays one.
        let mut request = options(vec![
            chord("source", &[0]),
            chord("x", &[0]),
            chord("y", &[0]),
            chord("end", &[0]),
        ]);
        request.chords[2].pitches_millicents = vec![1];
        request.chords[3].pitches_millicents = vec![-1_000_000_000_000];
        request.max_intermediates = 2;
        request.intermediate_chord_ids = Some(vec!["x".into(), "y".into()]);
        let result = analyze(&request).unwrap();
        assert_eq!(result.routes[2].optimal_route_count, 1);
        assert_eq!(
            2.0 + 100_000_000_000_000.0,
            2.0000000002 + 100_000_000_000_000.0
        );
        assert!(
            result
                .diagnostics
                .iter()
                .any(|message| message.contains("not exhaustive counts of complete paths"))
        );
    }
}
