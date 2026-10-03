//! A finite, authored harmonic-motion laboratory. Geometry, context and an
//! explicit preference objective are separate; none is a learned expectation.
use crate::{
    composition::{
        CompositionHarmony, CompositionLimits, CompositionPlan, MaterialPlacement, PitchBinding,
        ScoreMaterial, TimeScale, compile_composition,
    },
    error::{CoreResult, invalid},
    model::{Pitch, ScoreAttachment, ScoreContext, ScoreNote, ScorePart},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionChord {
    pub id: String,
    pub name: String,
    /// A supplied root hypothesis, independent from the lowest member.
    pub root_millicents: Option<i64>,
    /// Ordered member identities, including coincident but distinct emissions.
    pub pitches_millicents: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum MotionFrameRole {
    Global,
    Local,
    Alternative,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionFrame {
    pub id: String,
    pub name: String,
    pub role: MotionFrameRole,
    pub tonic_millicents: i64,
    pub collection_offsets_millicents: Vec<i64>,
    pub target_offsets_millicents: Vec<i64>,
    /// Explicit influence in the objective; zero keeps a comparison visible.
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MotionDuration {
    pub numerator: u16,
    pub denominator: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionStep {
    pub chord_id: String,
    pub duration: MotionDuration,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionWeights {
    pub motion: f64,
    pub unmatched: f64,
    pub common_tones: f64,
    pub collection_distance: f64,
    pub target_distance: f64,
    pub target_approach: f64,
    pub history_distance: f64,
    pub repetition: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarmonicMotionOptions {
    /// None means absolute register geometry only, with no pitch-class quotient.
    pub period_millicents: Option<i64>,
    pub chords: Vec<MotionChord>,
    pub frames: Vec<MotionFrame>,
    /// Exact duration-weighted exposure, in authored order. No inferred key.
    pub history: Vec<MotionStep>,
    pub from_chord_id: String,
    pub to_chord_id: String,
    pub weights: MotionWeights,
    pub tempo: f64,
    pub arpeggiate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicMotionPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub options: HarmonicMotionOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionMemberLink {
    pub from_member: usize,
    pub to_member: usize,
    pub from_millicents: i64,
    pub to_millicents: i64,
    pub displacement_millicents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionCorrespondence {
    pub links: Vec<MotionMemberLink>,
    pub departures: Vec<usize>,
    pub arrivals: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionPair {
    pub from_chord_id: String,
    pub to_chord_id: String,
    pub total_motion_millicents: i64,
    pub mean_motion_cents: f64,
    pub common_tone_count: usize,
    pub unmatched_count: usize,
    pub root_displacement_millicents: Option<i64>,
    /// Lowest sounding member at each endpoint; this is not inferred voice identity.
    pub bass_displacement_millicents: i64,
    /// [0, period) displacement, never a replacement for the signed endpoint.
    pub root_modulo_millicents: Option<i64>,
    /// Order of repeatedly applying this exact native displacement modulo period.
    pub root_cycle_order: Option<i64>,
    /// P/L/R only on exact 12-TET major/minor three-member pitch-class sets.
    pub triadic_transforms: Vec<String>,
    pub triadic_adapter_eligible: bool,
    pub optimal_correspondence_count: u64,
    /// Deterministic representative only; ties do not establish voice identity.
    pub representative: MotionCorrespondence,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionTargetWitness {
    pub from_member: usize,
    pub to_member: usize,
    pub from_millicents: i64,
    pub to_millicents: i64,
    pub displacement_millicents: i64,
    /// Number of minimum correspondences containing this link.
    pub optimal_support: u64,
    pub enters_target: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionFrameEffect {
    pub frame_id: String,
    pub weight: f64,
    pub source_root_offset_millicents: Option<i64>,
    pub target_root_offset_millicents: Option<i64>,
    pub source_collection_distance_cents: Option<f64>,
    pub target_collection_distance_cents: Option<f64>,
    pub collection_change_cents: Option<f64>,
    pub source_target_distance_cents: Option<f64>,
    pub target_target_distance_cents: Option<f64>,
    /// Positive means the destination is closer to the supplied target collection.
    pub target_approach_cents: Option<f64>,
    pub target_witnesses: Vec<MotionTargetWitness>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionFactor {
    pub id: String,
    pub label: String,
    pub unit: String,
    pub description: String,
    /// Unknown inputs stay null, even though their objective contribution is zero.
    pub value: Option<f64>,
    pub weight: f64,
    pub contribution: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionCandidate {
    pub chord_id: String,
    pub cost: f64,
    pub rank: usize,
    pub tied_count: usize,
    pub factors: Vec<MotionFactor>,
    pub frames: Vec<MotionFrameEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MotionPathEffect {
    pub from_step: usize,
    pub to_step: usize,
    pub history_quarters: f64,
    pub effect: MotionCandidate,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HarmonicMotionAnalysis {
    pub atlas: Vec<MotionPair>,
    pub selected_pair: MotionPair,
    /// All minimum correspondences, including correlated assignments.
    pub selected_correspondences: Vec<MotionCorrespondence>,
    pub successors: Vec<MotionCandidate>,
    pub path: Vec<MotionPathEffect>,
    pub history_quarters: f64,
    pub pair_count: usize,
    pub diagnostics: Vec<String>,
}

const MAX_COORD: i64 = 1_000_000_000_000;
const INF: i64 = i64::MAX / 4;

fn validate(options: &HarmonicMotionOptions) -> CoreResult<()> {
    let coordinate = |x: i64| x.unsigned_abs() <= MAX_COORD as u64;
    if options.chords.is_empty()
        || options.chords.len() > 64
        || options.frames.len() > 8
        || options.history.len() > 128
        || options
            .period_millicents
            .is_some_and(|p| p <= 0 || p > MAX_COORD)
        || !options.tempo.is_finite()
        || !(20. ..=400.).contains(&options.tempo)
    {
        return Err(invalid(
            "Harmonic motion admits 1–64 chords, 0–8 frames, 0–128 history steps, positive period up to 10^12 millicents, and tempo 20–400.",
        ));
    }
    let mut ids = BTreeSet::new();
    for chord in &options.chords {
        if chord.id.is_empty()
            || chord.id.len() > 128
            || !ids.insert(chord.id.as_str())
            || chord.pitches_millicents.is_empty()
            || chord.pitches_millicents.len() > 8
            || chord.pitches_millicents.iter().any(|&p| !coordinate(p))
            || chord.root_millicents.is_some_and(|p| !coordinate(p))
        {
            return Err(invalid(
                "Chords require unique nonempty IDs, 1–8 ordered members and native coordinates within ±10^12 millicents.",
            ));
        }
    }
    if !ids.contains(options.from_chord_id.as_str()) || !ids.contains(options.to_chord_id.as_str())
    {
        return Err(invalid(
            "Selected harmonic-motion chord IDs must exist in the catalog.",
        ));
    }
    for step in &options.history {
        if !ids.contains(step.chord_id.as_str())
            || !(1..=64).contains(&step.duration.numerator)
            || !(1..=1024).contains(&step.duration.denominator)
        {
            return Err(invalid(
                "History needs catalog chord IDs and positive quarter durations with numerator 1–64 and denominator 1–1024.",
            ));
        }
    }
    let mut frames = BTreeSet::new();
    for frame in &options.frames {
        if frame.id.is_empty()
            || !frames.insert(frame.id.as_str())
            || !coordinate(frame.tonic_millicents)
            || !frame.weight.is_finite()
            || !(0. ..=100.).contains(&frame.weight)
            || frame.collection_offsets_millicents.len() > 128
            || frame.target_offsets_millicents.len() > 128
            || frame
                .collection_offsets_millicents
                .iter()
                .chain(&frame.target_offsets_millicents)
                .any(|&p| !coordinate(p))
        {
            return Err(invalid(
                "Frames need unique IDs, finite weights 0–100, safe native coordinates, and at most 128 collection and target members.",
            ));
        }
    }
    let w = &options.weights;
    if [
        w.motion,
        w.unmatched,
        w.common_tones,
        w.collection_distance,
        w.target_distance,
        w.target_approach,
        w.history_distance,
        w.repetition,
    ]
    .iter()
    .any(|x| !x.is_finite() || !(-100. ..=100.).contains(x))
    {
        return Err(invalid(
            "Harmonic-motion objective weights must be finite and within −100–100.",
        ));
    }
    Ok(())
}

fn gcd(mut a: i64, mut b: i64) -> i64 {
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    a.abs()
}

fn distance(a: i64, b: i64, period: Option<i64>) -> i64 {
    match period {
        Some(p) => {
            let d = (a - b).rem_euclid(p);
            d.min(p - d)
        }
        None => (a - b).abs(),
    }
}

fn collection_distance(pitches: &[i64], collection: &[i64], period: Option<i64>) -> Option<f64> {
    if collection.is_empty() {
        return None;
    }
    Some(
        pitches
            .iter()
            .map(|&pitch| {
                collection
                    .iter()
                    .map(|&c| distance(pitch, c, period))
                    .min()
                    .unwrap() as f64
            })
            .sum::<f64>()
            / pitches.len() as f64
            / 1000.,
    )
}

/// Exact minimum-cost injection. A mask names already used members of the
/// larger chord; every smaller member is assigned exactly once. Distinct member
/// indices remain distinct when pitches coincide. Endpoints are never lifted.
struct Assignment<'a> {
    from: &'a [i64],
    to: &'a [i64],
    reverse: bool,
    small: usize,
    large: usize,
    memo: Vec<Option<(i64, u64)>>,
}

impl<'a> Assignment<'a> {
    fn new(from: &'a [i64], to: &'a [i64]) -> Self {
        let large = from.len().max(to.len());
        Self {
            from,
            to,
            reverse: from.len() > to.len(),
            small: from.len().min(to.len()),
            large,
            memo: vec![None; 1 << large],
        }
    }
    fn indices(&self, row: usize, column: usize) -> (usize, usize) {
        if self.reverse {
            (column, row)
        } else {
            (row, column)
        }
    }
    fn edge_cost(&self, row: usize, column: usize) -> i64 {
        let (i, j) = self.indices(row, column);
        (self.from[i] - self.to[j]).abs()
    }
    fn solve(&mut self, mask: usize) -> (i64, u64) {
        if let Some(value) = self.memo[mask] {
            return value;
        }
        let row = mask.count_ones() as usize;
        let answer = if row == self.small {
            (0, 1)
        } else {
            let mut best = INF;
            let mut count = 0;
            for column in 0..self.large {
                if mask & (1 << column) != 0 {
                    continue;
                }
                let (remaining, ways) = self.solve(mask | (1 << column));
                let cost = remaining + self.edge_cost(row, column);
                if cost < best {
                    best = cost;
                    count = ways;
                } else if cost == best {
                    count += ways;
                }
            }
            (best, count)
        };
        self.memo[mask] = Some(answer);
        answer
    }
    fn optimal_columns(&self, mask: usize) -> Vec<usize> {
        let row = mask.count_ones() as usize;
        if row == self.small {
            return vec![];
        }
        (0..self.large)
            .filter(|&column| {
                mask & (1 << column) == 0
                    && self.memo[mask | (1 << column)].unwrap().0 + self.edge_cost(row, column)
                        == self.memo[mask].unwrap().0
            })
            .collect()
    }
    fn correspondence(&self, columns: &[usize]) -> MotionCorrespondence {
        let mut links: Vec<_> = columns
            .iter()
            .enumerate()
            .map(|(row, &column)| {
                let (i, j) = self.indices(row, column);
                MotionMemberLink {
                    from_member: i,
                    to_member: j,
                    from_millicents: self.from[i],
                    to_millicents: self.to[j],
                    displacement_millicents: self.to[j] - self.from[i],
                }
            })
            .collect();
        links.sort_by_key(|link| (link.from_member, link.to_member));
        MotionCorrespondence {
            departures: (0..self.from.len())
                .filter(|i| !links.iter().any(|link| link.from_member == *i))
                .collect(),
            arrivals: (0..self.to.len())
                .filter(|i| !links.iter().any(|link| link.to_member == *i))
                .collect(),
            links,
        }
    }
    fn representative(&self) -> MotionCorrespondence {
        let mut mask = 0;
        let mut columns = vec![];
        for _ in 0..self.small {
            let column = self.optimal_columns(mask)[0];
            columns.push(column);
            mask |= 1 << column;
        }
        self.correspondence(&columns)
    }
    fn support(&self) -> Vec<Vec<u64>> {
        let mut supports = vec![vec![0; self.to.len()]; self.from.len()];
        let mut prefixes = vec![0u64; 1 << self.large];
        prefixes[0] = 1;
        for mask in 0..prefixes.len() {
            if prefixes[mask] == 0 || mask.count_ones() as usize == self.small {
                continue;
            }
            for column in self.optimal_columns(mask) {
                let next = mask | (1 << column);
                let (i, j) = self.indices(mask.count_ones() as usize, column);
                supports[i][j] += prefixes[mask] * self.memo[next].unwrap().1;
                prefixes[next] += prefixes[mask];
            }
        }
        supports
    }
    fn all(&self) -> Vec<MotionCorrespondence> {
        fn visit(
            search: &Assignment<'_>,
            mask: usize,
            columns: &mut Vec<usize>,
            result: &mut Vec<MotionCorrespondence>,
        ) {
            if columns.len() == search.small {
                result.push(search.correspondence(columns));
                return;
            }
            for column in search.optimal_columns(mask) {
                columns.push(column);
                visit(search, mask | (1 << column), columns, result);
                columns.pop();
            }
        }
        let mut result = Vec::with_capacity(self.memo[0].unwrap().1 as usize);
        visit(self, 0, &mut vec![], &mut result);
        result
    }
}

fn triad(chord: &MotionChord, period: Option<i64>) -> Option<(i64, bool)> {
    if period != Some(1_200_000) || chord.pitches_millicents.len() != 3 {
        return None;
    }
    let pcs: BTreeSet<_> = chord
        .pitches_millicents
        .iter()
        .map(|p| p.rem_euclid(1_200_000))
        .collect();
    for &root in &pcs {
        for (third, major) in [(400_000, true), (300_000, false)] {
            if pcs
                == [
                    root,
                    (root + third) % 1_200_000,
                    (root + 700_000) % 1_200_000,
                ]
                .into_iter()
                .collect()
            {
                return Some((root, major));
            }
        }
    }
    None
}

struct PairData {
    pair: MotionPair,
    support: Vec<Vec<u64>>,
}

fn pair_data(from: &MotionChord, to: &MotionChord, period: Option<i64>) -> PairData {
    let mut assignment = Assignment::new(&from.pitches_millicents, &to.pitches_millicents);
    let (cost, count) = assignment.solve(0);
    let class = |p: i64| period.map_or(p, |m| p.rem_euclid(m));
    let mut a = BTreeMap::<i64, usize>::new();
    let mut b = BTreeMap::<i64, usize>::new();
    for &p in &from.pitches_millicents {
        *a.entry(class(p)).or_default() += 1;
    }
    for &p in &to.pitches_millicents {
        *b.entry(class(p)).or_default() += 1;
    }
    let common = a
        .iter()
        .map(|(pitch, n)| n.min(b.get(pitch).unwrap_or(&0)))
        .sum();
    let root_motion = from
        .root_millicents
        .zip(to.root_millicents)
        .map(|(a, b)| b - a);
    let modulo = root_motion.zip(period).map(|(d, p)| d.rem_euclid(p));
    let root_cycle_order = modulo.zip(period).map(|(d, p)| p / gcd(d, p));
    let mut transforms = vec![];
    let triads = triad(from, period).zip(triad(to, period));
    if let Some(((r, major), (s, other_major))) = triads {
        if major != other_major {
            for (name, offset) in [
                ("P", 0),
                ("L", if major { 400_000 } else { 800_000 }),
                ("R", if major { 900_000 } else { 300_000 }),
            ] {
                if (r + offset) % 1_200_000 == s {
                    transforms.push(name.into());
                }
            }
        }
    }
    PairData {
        support: assignment.support(),
        pair: MotionPair {
            from_chord_id: from.id.clone(),
            to_chord_id: to.id.clone(),
            total_motion_millicents: cost,
            mean_motion_cents: cost as f64 / assignment.small as f64 / 1000.,
            common_tone_count: common,
            unmatched_count: from
                .pitches_millicents
                .len()
                .abs_diff(to.pitches_millicents.len()),
            root_displacement_millicents: root_motion,
            bass_displacement_millicents: to.pitches_millicents.iter().min().unwrap()
                - from.pitches_millicents.iter().min().unwrap(),
            root_modulo_millicents: modulo,
            root_cycle_order,
            triadic_transforms: transforms,
            triadic_adapter_eligible: triads.is_some(),
            optimal_correspondence_count: count,
            representative: assignment.representative(),
        },
    }
}

fn frame_effect(
    from: &MotionChord,
    to: &MotionChord,
    pair: &PairData,
    frame: &MotionFrame,
    period: Option<i64>,
) -> MotionFrameEffect {
    let collection: Vec<_> = frame
        .collection_offsets_millicents
        .iter()
        .map(|p| p + frame.tonic_millicents)
        .collect();
    let target: Vec<_> = frame
        .target_offsets_millicents
        .iter()
        .map(|p| p + frame.tonic_millicents)
        .collect();
    let source_collection = collection_distance(&from.pitches_millicents, &collection, period);
    let destination_collection = collection_distance(&to.pitches_millicents, &collection, period);
    let source_target = collection_distance(&from.pitches_millicents, &target, period);
    let destination_target = collection_distance(&to.pitches_millicents, &target, period);
    let root_offset = |root: Option<i64>| {
        root.map(|root| {
            period.map_or(root - frame.tonic_millicents, |p| {
                (root - frame.tonic_millicents).rem_euclid(p)
            })
        })
    };
    let in_target = |pitch: i64| target.iter().any(|&t| distance(pitch, t, period) == 0);
    let mut witnesses = vec![];
    for (i, &a) in from.pitches_millicents.iter().enumerate() {
        for (j, &b) in to.pitches_millicents.iter().enumerate() {
            let support = pair.support[i][j];
            if support > 0 && in_target(b) {
                witnesses.push(MotionTargetWitness {
                    from_member: i,
                    to_member: j,
                    from_millicents: a,
                    to_millicents: b,
                    displacement_millicents: b - a,
                    optimal_support: support,
                    enters_target: !in_target(a),
                });
            }
        }
    }
    MotionFrameEffect {
        frame_id: frame.id.clone(),
        weight: frame.weight,
        source_root_offset_millicents: root_offset(from.root_millicents),
        target_root_offset_millicents: root_offset(to.root_millicents),
        source_collection_distance_cents: source_collection,
        target_collection_distance_cents: destination_collection,
        collection_change_cents: source_collection
            .zip(destination_collection)
            .map(|(a, b)| b - a),
        source_target_distance_cents: source_target,
        target_target_distance_cents: destination_target,
        target_approach_cents: source_target.zip(destination_target).map(|(a, b)| a - b),
        target_witnesses: witnesses,
    }
}

fn quarters(step: &MotionStep) -> f64 {
    f64::from(step.duration.numerator) / f64::from(step.duration.denominator)
}

fn factor(
    id: &str,
    label: &str,
    unit: &str,
    description: &str,
    value: Option<f64>,
    weight: f64,
    scale: f64,
) -> MotionFactor {
    MotionFactor {
        id: id.into(),
        label: label.into(),
        unit: unit.into(),
        description: description.into(),
        value,
        weight,
        contribution: value.unwrap_or(0.) * weight * scale,
    }
}

fn candidate(
    options: &HarmonicMotionOptions,
    from: usize,
    to: usize,
    pair: &PairData,
    history: &[MotionStep],
    index: &BTreeMap<&str, usize>,
) -> MotionCandidate {
    let a = &options.chords[from];
    let b = &options.chords[to];
    let w = &options.weights;
    let frames: Vec<_> = options
        .frames
        .iter()
        .map(|frame| frame_effect(a, b, pair, frame, options.period_millicents))
        .collect();
    let weighted = |select: fn(&MotionFrameEffect) -> Option<f64>| -> Option<f64> {
        let mut numerator = 0.;
        let mut denominator = 0.;
        for frame in &frames {
            if let Some(value) = select(frame) {
                numerator += value * frame.weight;
                denominator += frame.weight;
            }
        }
        (denominator > 0.).then(|| numerator / denominator)
    };
    let exposure: f64 = history.iter().map(quarters).sum();
    let history_distance = (exposure > 0.).then(|| {
        history
            .iter()
            .map(|step| {
                quarters(step)
                    * collection_distance(
                        &b.pitches_millicents,
                        &options.chords[index[step.chord_id.as_str()]].pitches_millicents,
                        options.period_millicents,
                    )
                    .unwrap()
            })
            .sum::<f64>()
            / exposure
    });
    let repetition = (exposure > 0.).then(|| {
        history
            .iter()
            .filter(|step| step.chord_id == b.id)
            .map(quarters)
            .sum::<f64>()
            / exposure
    });
    let factors = vec![
        factor(
            "motion",
            "Member motion",
            "cents",
            "Mean absolute native-register movement of a maximum-cardinality minimum-cost injection; cost per 100 cents.",
            Some(pair.pair.mean_motion_cents),
            w.motion,
            0.01,
        ),
        factor(
            "unmatched",
            "Arrivals / departures",
            "members",
            "Absolute member-count difference; correspondence never invents or duplicates a member.",
            Some(pair.pair.unmatched_count as f64),
            w.unmatched,
            1.,
        ),
        factor(
            "commonTones",
            "Common tones",
            "members",
            "Maximum multiset overlap under the declared period, or exact native pitch without a period. Positive weight rewards overlap.",
            Some(pair.pair.common_tone_count as f64),
            w.common_tones,
            -1.,
        ),
        factor(
            "collectionDistance",
            "Collection distance",
            "cents",
            "Destination mean nearest collection-member distance, averaged over explicitly weighted available frames; cost per 100 cents.",
            weighted(|f| f.target_collection_distance_cents),
            w.collection_distance,
            0.01,
        ),
        factor(
            "targetDistance",
            "Target distance",
            "cents",
            "Destination mean nearest supplied target-member distance, averaged over explicitly weighted available frames; cost per 100 cents.",
            weighted(|f| f.target_target_distance_cents),
            w.target_distance,
            0.01,
        ),
        factor(
            "targetApproach",
            "Target approach",
            "cents",
            "Source target-distance minus destination target-distance. Positive weight rewards approach, per 100 cents; this alone is not a cadence.",
            weighted(|f| f.target_approach_cents),
            w.target_approach,
            -0.01,
        ),
        factor(
            "historyDistance",
            "History distance",
            "cents",
            "Duration-weighted mean of destination-to-each-past-chord nearest-member distances. All authored history contributes; cost per 100 cents, not learned surprise.",
            history_distance,
            w.history_distance,
            0.01,
        ),
        factor(
            "repetition",
            "Identity exposure",
            "fraction",
            "Fraction of authored history duration using this exact catalog chord ID. Positive weight penalizes repeated parameter identity.",
            repetition,
            w.repetition,
            1.,
        ),
    ];
    MotionCandidate {
        chord_id: b.id.clone(),
        cost: factors.iter().map(|factor| factor.contribution).sum(),
        rank: 0,
        tied_count: 0,
        factors,
        frames,
    }
}

fn rank(candidates: &mut [MotionCandidate]) {
    candidates.sort_by(|a, b| a.cost.total_cmp(&b.cost).then(a.chord_id.cmp(&b.chord_id)));
    let mut first = 0;
    while first < candidates.len() {
        let mut end = first + 1;
        while end < candidates.len()
            && (candidates[end].cost - candidates[first].cost).abs() <= 1e-9
        {
            end += 1;
        }
        for candidate in &mut candidates[first..end] {
            candidate.rank = first + 1;
            candidate.tied_count = end - first;
        }
        first = end;
    }
}

/// Every ordered pair and successor in the admitted catalog is evaluated.
/// The result is conditional on the supplied voicings, frames and objective.
pub fn analyze(options: &HarmonicMotionOptions) -> CoreResult<HarmonicMotionAnalysis> {
    validate(options)?;
    let n = options.chords.len();
    let index: BTreeMap<_, _> = options
        .chords
        .iter()
        .enumerate()
        .map(|(i, chord)| (chord.id.as_str(), i))
        .collect();
    let pairs: Vec<_> = options
        .chords
        .iter()
        .flat_map(|from| {
            options
                .chords
                .iter()
                .map(move |to| pair_data(from, to, options.period_millicents))
        })
        .collect();
    let from = index[options.from_chord_id.as_str()];
    let to = index[options.to_chord_id.as_str()];
    let mut selected_search = Assignment::new(
        &options.chords[from].pitches_millicents,
        &options.chords[to].pitches_millicents,
    );
    selected_search.solve(0);
    let mut successors: Vec<_> = (0..n)
        .map(|target| {
            candidate(
                options,
                from,
                target,
                &pairs[from * n + target],
                &options.history,
                &index,
            )
        })
        .collect();
    rank(&mut successors);
    let mut path = vec![];
    let mut exposure = 0.;
    for step in 0..options.history.len().saturating_sub(1) {
        exposure += quarters(&options.history[step]);
        let a = index[options.history[step].chord_id.as_str()];
        let b = index[options.history[step + 1].chord_id.as_str()];
        let mut candidates: Vec<_> = (0..n)
            .map(|target| {
                candidate(
                    options,
                    a,
                    target,
                    &pairs[a * n + target],
                    &options.history[..=step],
                    &index,
                )
            })
            .collect();
        rank(&mut candidates);
        path.push(MotionPathEffect {
            from_step: step,
            to_step: step + 1,
            history_quarters: exposure,
            effect: candidates
                .into_iter()
                .find(|candidate| candidate.chord_id == options.chords[b].id)
                .unwrap(),
        });
    }
    let mut diagnostics=vec![
        format!("Exhaustive within this supplied catalog: {n} chords, {} ordered pairs including identity, and {n} successor candidates. No voicing, tuning or chord outside this catalog was searched.",n*n),
        "Assignments minimize total absolute native-register displacement at maximum cardinality. They propose geometric correspondences, not recovered voices; all minimum assignments are retained for the selected pair.".into(),
        "Frame profiles are supplied hypotheses. Their nonnegative weights average available distances; zero-weight alternatives remain visible. Unknown factors remain null and contribute zero to the explicit objective.".into(),
        "Ranking is an authored linear cost, not a probability, style model, universal tension or emotional prediction. Lower is preferred; ties use absolute cost tolerance 10^-9 and lexical ordering only for display.".into(),
        "Path effects use each source-inclusive prefix only. Successors use the entire supplied history and selected source. Exact durations determine exposure; no decay, key inference or temporal expectation model is assumed.".into(),
        "Native root cycle order is exact integer modular order. Rounded equal-division or logarithmic tuning coordinates need not retain an ideal tuning's symbolic cycle order.".into(),
    ];
    if options.period_millicents.is_none() {
        diagnostics.push("No period supplied: every collection, overlap and history comparison uses absolute native pitch. Pitch-class and cyclic-root metrics are unavailable.".into());
    }
    if options.frames.iter().all(|frame| frame.weight == 0.) {
        diagnostics.push("No weighted center is supplied. Target and collection objective factors are unknown, not evidence of a weak or absent tonic.".into());
    }
    Ok(HarmonicMotionAnalysis {
        selected_pair: pairs[from * n + to].pair.clone(),
        selected_correspondences: selected_search.all(),
        atlas: pairs.into_iter().map(|pair| pair.pair).collect(),
        successors,
        path,
        history_quarters: options.history.iter().map(quarters).sum(),
        pair_count: n * n,
        diagnostics,
    })
}

/// Lower the complete authored history through shared neutral rhythmic material
/// and catalog palettes. The existing compiler is the only note emitter.
pub fn realize(options: &HarmonicMotionOptions) -> CoreResult<CompositionPlan> {
    validate(options)?;
    // The minimal conservative common grid includes the exact 9/10 gate and
    // every authored denominator/cardinality; no attack or release is snapped.
    let mut ppq = 1u64;
    for step in &options.history {
        let size = options
            .chords
            .iter()
            .find(|chord| chord.id == step.chord_id)
            .unwrap()
            .pitches_millicents
            .len() as u64;
        let reduced = u64::from(step.duration.denominator)
            / gcd(
                i64::from(step.duration.numerator),
                i64::from(step.duration.denominator),
            ) as u64;
        let denominator = reduced * 10 * if options.arpeggiate { size } else { 1 };
        ppq = ppq
            .checked_mul(denominator / gcd(ppq as i64, denominator as i64) as u64)
            .ok_or_else(|| invalid("Exact harmonic duration grid exceeds its budget."))?;
        if ppq > 1_000_000 {
            return Err(invalid(
                "Exact harmonic duration grid exceeds 1,000,000 PPQ; simplify the supplied rational durations.",
            ));
        }
    }
    let index: BTreeMap<_, _> = options
        .chords
        .iter()
        .map(|chord| (chord.id.as_str(), chord))
        .collect();
    let sizes: BTreeSet<_> = options
        .history
        .iter()
        .map(|step| index[step.chord_id.as_str()].pitches_millicents.len())
        .collect();
    let materials = sizes
        .into_iter()
        .map(|size| {
            let note_span = if options.arpeggiate {
                ppq / size as u64
            } else {
                ppq
            };
            ScoreMaterial {
                id: format!("motion-rhythm-{size}"),
                span: ppq,
                notes: (0..size)
                    .map(|member| ScoreNote {
                        id: format!("member-{member}"),
                        part: "harmony".into(),
                        onset: if options.arpeggiate {
                            member as u64 * note_span
                        } else {
                            0
                        },
                        duration: note_span * 9 / 10,
                        pitch: Pitch { millicents: 0 },
                        velocity: if member == 0 { 88 } else { 78 },
                        release_velocity: 64,
                        pitch_envelope: None,
                        gain_envelope: None,
                        source: None,
                    })
                    .collect(),
            }
        })
        .collect();
    let mut onset = 0;
    let placements = options
        .history
        .iter()
        .map(|step| {
            let chord = index[step.chord_id.as_str()];
            let placement = MaterialPlacement {
                material: format!("motion-rhythm-{}", chord.pitches_millicents.len()),
                onset,
                transpose_millicents: None,
                time_scale: Some(TimeScale {
                    numerator: u64::from(step.duration.numerator),
                    denominator: u64::from(step.duration.denominator),
                }),
                velocity_scale: None,
                part_map: None,
                pitch_bindings: Some(
                    (0..chord.pitches_millicents.len())
                        .map(|tone| PitchBinding::Harmony {
                            harmony: chord.id.clone(),
                            tone,
                            octave: 0,
                            residual_millicents: 0,
                        })
                        .collect(),
                ),
            };
            onset +=
                ppq * u64::from(step.duration.numerator) / u64::from(step.duration.denominator);
            placement
        })
        .collect();
    let micros = (60_000_000. / options.tempo).round() as u32;
    let harmonies = options
        .chords
        .iter()
        .map(|chord| {
            let root = chord.root_millicents.unwrap_or(chord.pitches_millicents[0]);
            CompositionHarmony {
                id: chord.id.clone(),
                root_millicents: root,
                intervals: chord.pitches_millicents.iter().map(|p| p - root).collect(),
            }
        })
        .collect();
    let plan = CompositionPlan {
        context: ScoreContext {
            ppq,
            duration: onset,
            midi_format: None,
            parts: vec![ScorePart {
                id: "harmony".into(),
                name: "Harmonic motion".into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            attachments: vec![ScoreAttachment {
                tick: 0,
                track: 0,
                order: 0,
                bytes: vec![
                    255,
                    81,
                    3,
                    (micros >> 16) as u8,
                    (micros >> 8) as u8,
                    micros as u8,
                ],
            }],
            track_ends: vec![onset],
        },
        materials,
        definitions: None,
        placements,
        harmonies: Some(harmonies),
        pitch_lattices: None,
    };
    compile_composition(&plan, &CompositionLimits::default())?;
    Ok(plan)
}

fn chord(id: &str, name: &str, root: i64, pitches: &[i64]) -> MotionChord {
    MotionChord {
        id: id.into(),
        name: name.into(),
        root_millicents: Some(root * 100_000),
        pitches_millicents: pitches.iter().map(|p| p * 100_000).collect(),
    }
}

fn frame(
    id: &str,
    name: &str,
    tonic: i64,
    collection: &[i64],
    target: &[i64],
    weight: f64,
) -> MotionFrame {
    MotionFrame {
        id: id.into(),
        name: name.into(),
        role: if weight > 0. {
            MotionFrameRole::Global
        } else {
            MotionFrameRole::Alternative
        },
        tonic_millicents: tonic * 100_000,
        collection_offsets_millicents: collection.iter().map(|x| x * 100_000).collect(),
        target_offsets_millicents: target.iter().map(|x| x * 100_000).collect(),
        weight,
    }
}

fn path(ids: &[&str]) -> Vec<MotionStep> {
    ids.iter()
        .map(|id| MotionStep {
            chord_id: (*id).into(),
            duration: MotionDuration {
                numerator: 2,
                denominator: 1,
            },
        })
        .collect()
}

fn options(
    chords: Vec<MotionChord>,
    frames: Vec<MotionFrame>,
    history: &[&str],
    from: &str,
    to: &str,
) -> HarmonicMotionOptions {
    HarmonicMotionOptions {
        period_millicents: Some(1_200_000),
        chords,
        frames,
        history: path(history),
        from_chord_id: from.into(),
        to_chord_id: to.into(),
        weights: MotionWeights {
            motion: 1.,
            unmatched: 1.5,
            common_tones: 0.2,
            collection_distance: 0.8,
            target_distance: 0.4,
            target_approach: 0.6,
            history_distance: 0.2,
            repetition: 0.5,
        },
        tempo: 104.,
        arpeggiate: false,
    }
}

/// Curated starting premises, never recognition rules. Catalogs and all context
/// values can be replaced; named styles do not alter the general computation.
pub fn presets() -> Vec<HarmonicMotionPreset> {
    let major = [0, 2, 4, 5, 7, 9, 11];
    let contexts = vec![
        frame("c-major", "C major center", 60, &major, &[0, 4, 7], 1.),
        frame("f-major", "F major center", 65, &major, &[0, 4, 7], 0.),
        frame(
            "a-aeolian",
            "A Aeolian center",
            57,
            &[0, 2, 3, 5, 7, 8, 10],
            &[0, 3, 7],
            0.,
        ),
        frame(
            "d-dorian",
            "D Dorian center",
            62,
            &[0, 2, 3, 5, 7, 9, 10],
            &[0, 3, 7],
            0.,
        ),
        frame(
            "g-mixolydian",
            "G Mixolydian center",
            55,
            &[0, 2, 4, 5, 7, 9, 10],
            &[0, 4, 7],
            0.,
        ),
    ];
    let diatonic = vec![
        chord("C", "C", 48, &[48, 60, 64, 72]),
        chord("Dm", "Dm", 50, &[50, 57, 65, 69]),
        chord("Em", "Em", 52, &[52, 59, 64, 67]),
        chord("F", "F", 53, &[53, 60, 65, 69]),
        chord("G", "G", 55, &[55, 62, 67, 71]),
        chord("G7", "G7", 55, &[55, 62, 65, 71]),
        chord("Am", "Am", 45, &[45, 60, 64, 69]),
        chord("Bdim", "B diminished", 47, &[47, 59, 62, 65]),
        chord("Bb", "B♭", 46, &[46, 58, 62, 65]),
        chord("Cm", "Cm", 48, &[48, 60, 63, 67]),
        chord("Fm", "Fm", 53, &[53, 60, 65, 68]),
        chord("D", "D", 50, &[50, 57, 62, 66]),
    ];
    let mut result=vec![HarmonicMotionPreset { id:"cadences".into(),name:"Cadences and competing centers".into(),
        description:"An authored four-part passage with authentic, deceptive and plagal alternatives. Reweight C, F, A, D or G frames to hear one voiced route under different relative tonics. Named cadence readings are premises to inspect, not inferred labels.".into(),
        options:options(diatonic.clone(),contexts.clone(),&["C","F","Dm","G7","Am","F","G7","C","F","C"],"G7","C") }];
    let mut modal_frames = contexts.clone();
    for frame in &mut modal_frames {
        frame.weight = if frame.id == "d-dorian" { 1. } else { 0. };
    }
    result.push(HarmonicMotionPreset { id:"modal".into(),name:"Modal centers, same collection".into(),
        description:"D Dorian, C major, A Aeolian and G Mixolydian share the same pitch collection but have different supplied tonics and targets. F major is a contrasting collection. The D-centered vamp has no built-in dominant requirement.".into(),
        options:options(diatonic,modal_frames,&["Dm","G","Dm","C","Dm","G","F","Dm"],"G","Dm") });
    let jazz = vec![
        chord("Cmaj7", "Cmaj7", 48, &[48, 52, 59, 64]),
        chord("C", "C", 48, &[48, 60, 64, 72]),
        chord("Dm7", "Dm7", 50, &[50, 53, 60, 69]),
        chord("G7", "G7", 43, &[43, 53, 59, 62]),
        chord("Db7", "D♭7", 49, &[49, 53, 59, 61]),
        chord("Fmaj7", "Fmaj7", 41, &[41, 52, 57, 60]),
        chord("Am7", "Am7", 45, &[45, 55, 60, 64]),
        chord("E7", "E7", 40, &[40, 56, 62, 64]),
        chord("Bb7", "B♭7", 46, &[46, 56, 62, 65]),
        chord("Ebmaj7", "E♭maj7", 39, &[39, 55, 58, 62]),
        chord("Abmaj7", "A♭maj7", 44, &[44, 55, 60, 63]),
        chord("D7", "D7", 38, &[38, 54, 60, 62]),
    ];
    result.push(HarmonicMotionPreset { id:"jazz".into(),name:"Jazz routes and tritone alternatives".into(),
        description:"Voiced ii–V and tritone-substitution alternatives retain explicit bass and member endpoints. G7 and D♭7 share B/F classes in this example; their minimum member maps and bass routes still differ. No substitution equivalence is assumed.".into(),
        options:options(jazz,contexts.clone(),&["Cmaj7","E7","Am7","Dm7","G7","Cmaj7","Dm7","Db7","Cmaj7","Fmaj7","G7","Cmaj7"],"G7","Cmaj7") });
    let names = [
        "C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B",
    ];
    let mut triads = vec![];
    let mut catalog = vec![];
    for (pc, name) in names.iter().enumerate() {
        for (suffix, label, intervals) in [
            ("major", "", vec![0, 4, 7]),
            ("minor", "m", vec![0, 3, 7]),
            ("dom7", "7", vec![0, 4, 7, 10]),
            ("maj7", "maj7", vec![0, 4, 7, 11]),
        ] {
            let root = 48 + pc as i64;
            let c = chord(
                &format!("{pc}-{suffix}"),
                &format!("{name}{label}"),
                root,
                &intervals.iter().map(|p| root + p).collect::<Vec<_>>(),
            );
            if intervals.len() == 3 {
                triads.push(c.clone());
            }
            catalog.push(c);
        }
    }
    result.push(HarmonicMotionPreset { id:"tonnetz".into(),name:"All 24 major/minor triads · P/L/R".into(),
        description:"All 576 ordered pairs in the complete 12-TET major/minor triad catalog, including identities. Exact P/L/R identities are reported only for eligible triads; supplied root-position registers affect voice movement independently of that adapter.".into(),
        options:options(triads,contexts.clone(),&["0-major","4-minor","4-major","9-minor","9-major","1-minor","1-major","5-minor","5-major","0-major"],"0-major","4-minor") });
    result.push(HarmonicMotionPreset { id:"chromatic-atlas".into(),name:"48-chord chromatic atlas".into(),
        description:"All 2,304 ordered pairs over every 12-TET transposition of major, minor, dominant seventh and major seventh shapes. This is exhaustive for these 48 supplied root-position voicings; it is not every possible voicing or chord.".into(),
        options:options(catalog,contexts.clone(),&["0-maj7","9-minor","2-minor","7-dom7","0-maj7","8-maj7","1-dom7","0-maj7"],"7-dom7","0-maj7") });
    let thirds = vec![
        chord("Bmaj7", "Bmaj7", 47, &[47, 58, 63, 66]),
        chord("D7", "D7", 50, &[50, 54, 60, 66]),
        chord("Gmaj7", "Gmaj7", 43, &[43, 54, 59, 62]),
        chord("Bb7", "B♭7", 46, &[46, 50, 56, 62]),
        chord("Ebmaj7", "E♭maj7", 39, &[39, 50, 55, 58]),
        chord("Fs7", "F♯7", 42, &[42, 46, 52, 58]),
        chord("Am7", "Am7", 45, &[45, 55, 60, 64]),
        chord("Fm7", "Fm7", 41, &[41, 51, 56, 60]),
    ];
    let mut third_frames = vec![
        frame("b", "B target", 47, &major, &[0, 4, 7, 11], 1.),
        frame("g", "G target", 43, &major, &[0, 4, 7, 11], 0.),
        frame("eb", "E♭ target", 39, &major, &[0, 4, 7, 11], 0.),
    ];
    third_frames[1].role = MotionFrameRole::Local;
    third_frames[2].role = MotionFrameRole::Local;
    result.push(HarmonicMotionPreset { id:"third-cycles".into(),name:"Major-third centers · Coltrane-type route".into(),
        description:"An authored B–G–E♭ center cycle with dominant approaches. The exact major-third root step closes in three applications modulo the octave; closure alone does not establish any center. Reweight the independently supplied local targets.".into(),
        options:options(thirds,third_frames,&["Bmaj7","D7","Gmaj7","Bb7","Ebmaj7","Am7","D7","Gmaj7","Fs7","Bmaj7"],"Bmaj7","Gmaj7") });
    for (id, title, divisions, period, shape, scale) in [
        (
            "19edo",
            "19 equal divisions · native approximation",
            19i64,
            1_200_000i64,
            vec![0, 6, 11],
            vec![0, 3, 6, 8, 11, 14, 17],
        ),
        (
            "tritave",
            "13 divisions of a tritave · native approximation",
            13i64,
            1_901_955i64,
            vec![0, 4, 7],
            vec![0, 2, 4, 5, 7, 9, 11],
        ),
    ] {
        let pitch = |degree: i64| (degree as f64 * period as f64 / divisions as f64).round() as i64;
        let chords = (0..divisions)
            .map(|degree| MotionChord {
                id: format!("d{degree}"),
                name: format!("Degree {degree} · {:?}", shape),
                root_millicents: Some(6_000_000 + pitch(degree)),
                pitches_millicents: shape
                    .iter()
                    .map(|step| 6_000_000 + pitch(degree + step))
                    .collect(),
            })
            .collect();
        let tonal = MotionFrame {
            id: "degree-0".into(),
            name: "Declared degree-zero target".into(),
            role: MotionFrameRole::Global,
            tonic_millicents: 6_000_000,
            collection_offsets_millicents: scale.iter().map(|&d| pitch(d)).collect(),
            target_offsets_millicents: shape.iter().map(|&d| pitch(d)).collect(),
            weight: 1.,
        };
        let mut tuning = options(
            chords,
            vec![tonal],
            &["d0", "d4", "d7", "d0", "d2", "d7", "d0"],
            "d7",
            "d0",
        );
        tuning.period_millicents = Some(period);
        tuning.arpeggiate = true;
        result.push(HarmonicMotionPreset { id:id.into(),name:title.into(),description:format!("All {divisions} transpositions of one explicitly supplied degree shape. Division coordinates are rounded to the nearest native millicent (≤0.0005 cents per coordinate); the tritave period itself is approximated by 1,901.955 cents. Computation is exact for these stored integers, not for ideal equal divisions. No 12-TET chord or P/L/R labels transfer."),options:tuning });
    }
    let mut free = options(
        vec![
            MotionChord {
                id: "a".into(),
                name: "Field A".into(),
                root_millicents: None,
                pitches_millicents: vec![4_810_320, 5_312_400, 6_103_200],
            },
            MotionChord {
                id: "b".into(),
                name: "Field B".into(),
                root_millicents: None,
                pitches_millicents: vec![4_830_100, 5_401_700, 6_150_900, 6_811_300],
            },
            MotionChord {
                id: "c".into(),
                name: "Field C".into(),
                root_millicents: None,
                pitches_millicents: vec![4_500_000, 5_312_400, 6_011_800],
            },
            MotionChord {
                id: "d".into(),
                name: "Field D".into(),
                root_millicents: None,
                pitches_millicents: vec![4_810_320, 5_599_800],
            },
        ],
        vec![],
        &["a", "b", "a", "c", "d", "b", "a"],
        "a",
        "b",
    );
    free.period_millicents = None;
    free.arpeggiate = true;
    result.push(HarmonicMotionPreset { id:"unperiodic".into(),name:"Center-free and nonperiodic".into(),
        description:"Arbitrary native pitches, unequal cardinalities, no supplied root, center or repetition period. Absolute member motion and authored history remain defined; tonic and cyclic coordinates remain unknown.".into(),options:free });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_presets_analyze_and_compile() {
        for preset in presets() {
            let analysis =
                analyze(&preset.options).unwrap_or_else(|error| panic!("{}: {error:?}", preset.id));
            assert_eq!(analysis.pair_count, preset.options.chords.len().pow(2));
            assert_eq!(
                analysis.selected_correspondences.len() as u64,
                analysis.selected_pair.optimal_correspondence_count
            );
            let plan =
                realize(&preset.options).unwrap_or_else(|error| panic!("{}: {error:?}", preset.id));
            assert_eq!(plan.placements.len(), preset.options.history.len());
        }
    }
    #[test]
    fn selected_ties_keep_endpoint_identity_and_directions() {
        let mut search = Assignment::new(&[0, 200_000], &[100_000]);
        assert_eq!(search.solve(0), (100_000, 2));
        let all = search.all();
        assert_eq!(all[0].links[0].displacement_millicents, 100_000);
        assert_eq!(all[1].links[0].displacement_millicents, -100_000);
        assert_eq!(search.support(), vec![vec![1], vec![1]]);
    }
    #[test]
    fn eight_member_arpeggio_retains_exact_gate_and_reduced_duration() {
        let mut o = presets().remove(0).options;
        o.chords[0].pitches_millicents = (0..8).map(|i| 6_000_000 + i * 100_000).collect();
        o.history = vec![MotionStep {
            chord_id: "C".into(),
            duration: MotionDuration {
                numerator: 64,
                denominator: 1024,
            },
        }];
        o.arpeggiate = true;
        let plan = realize(&o).unwrap();
        let score = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(score.ppq, 1280);
        assert_eq!(score.notes[0].duration, 9);
        assert_eq!(score.notes[1].onset, 10);
    }
    #[test]
    fn absent_history_retains_unknown_exposure_and_a_silent_plan() {
        let mut o = presets().remove(0).options;
        o.history.clear();
        let a = analyze(&o).unwrap();
        assert_eq!(a.history_quarters, 0.);
        assert!(a.successors.iter().all(|c| {
            c.factors
                .iter()
                .find(|f| f.id == "historyDistance")
                .unwrap()
                .value
                .is_none()
        }));
        let score =
            compile_composition(&realize(&o).unwrap(), &CompositionLimits::default()).unwrap();
        assert!(score.notes.is_empty());
        assert_eq!(score.duration, 0);
    }
}
