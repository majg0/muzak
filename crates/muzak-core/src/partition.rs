//! Experimental contextual BSP. Declared contrast and cohesion priors guide splits;
//! the resulting groups are hypotheses, not validated phrases or chord functions.
//! Content addresses identify an explicit note projection independently of tree shape.
use crate::{
    error::{CoreResult, budget, invalid},
    harmonic::HarmonicRegionAnalysis,
    model::{Score, ScoreNote, ScoreSelection, select_notes, validate_score},
    structure::{StructureParameter, StructureRegionInput},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct FeatureWeights {
    pub time: f64,
    pub pitch: f64,
    pub velocity: f64,
    pub duration: f64,
    pub rhythm: f64,
    pub support: f64,
    pub support_membership: f64,
}
impl Default for FeatureWeights {
    fn default() -> Self {
        Self {
            time: 1.0,
            pitch: 1.0,
            velocity: 0.25,
            duration: 0.25,
            rhythm: 0.25,
            support: 0.5,
            support_membership: 0.5,
        }
    }
}
impl FeatureWeights {
    fn values(self) -> [f64; 7] {
        [
            self.time,
            self.pitch,
            self.velocity,
            self.duration,
            self.rhythm,
            self.support,
            self.support_membership,
        ]
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteWeights {
    pub velocity: f64,
    pub duration: f64,
    pub rhythm: f64,
    pub support: f64,
    pub support_membership: f64,
}
impl Default for NoteWeights {
    fn default() -> Self {
        Self {
            velocity: 0.25,
            duration: 0.25,
            rhythm: 0.25,
            support: 0.5,
            support_membership: 0.25,
        }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct ContentProjection {
    pub translate_time: bool,
    pub transpose_pitch: bool,
    pub include_routing: bool,
    pub include_velocity: bool,
    pub include_expression: bool,
}
impl Default for ContentProjection {
    fn default() -> Self {
        Self {
            translate_time: true,
            transpose_pitch: true,
            include_routing: true,
            include_velocity: true,
            include_expression: true,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct PartitionOptions {
    pub features: FeatureWeights,
    pub note_weights: NoteWeights,
    pub boundary_weight: f64,
    pub gap_weight: f64,
    pub support_cohesion_weight: f64,
    pub melody_cohesion_weight: f64,
    pub min_gain: f64,
    pub min_leaf_notes: usize,
    pub max_depth: usize,
    pub max_nodes: usize,
    pub max_split_evaluations: usize,
    pub max_affinity_members: usize,
    pub max_affinity_visits: usize,
    pub content: ContentProjection,
}
impl Default for PartitionOptions {
    fn default() -> Self {
        Self {
            features: FeatureWeights::default(),
            note_weights: NoteWeights::default(),
            boundary_weight: 0.25,
            gap_weight: 0.25,
            support_cohesion_weight: 1.0,
            melody_cohesion_weight: 0.5,
            min_gain: 0.35,
            min_leaf_notes: 2,
            max_depth: 6,
            max_nodes: 127,
            max_split_evaluations: 100_000,
            max_affinity_members: 200_000,
            max_affinity_visits: 2_000_000,
            content: ContentProjection::default(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WeightedNote {
    pub note_id: String,
    pub velocity: f64,
    pub duration: f64,
    pub quarter_phase: String,
    pub notated_accent: Option<f64>,
    pub support_membership: Option<bool>,
    pub support_pitch_class: Option<bool>,
    pub bass_relative_millicents: Option<String>,
    pub weight: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PartitionSplit {
    pub axis: String,
    pub at: String,
    pub variance_gain: f64,
    pub boundary_evidence: f64,
    pub normalized_gap: f64,
    pub support_separation: f64,
    pub melody_separation: f64,
    pub separated_support_groups: usize,
    pub separated_melody_groups: usize,
    pub score: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PartitionAffinity {
    pub id: String,
    pub kind: String,
    pub source_id: String,
    pub note_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PartitionNode {
    pub id: String,
    pub depth: usize,
    pub note_ids: Vec<String>,
    pub content_address: String,
    pub tree_address: String,
    pub split: Option<PartitionSplit>,
    pub children: Vec<usize>,
    pub stop_reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WeightedPartitionAnalysis {
    pub parameters: PartitionOptions,
    pub selection: ScoreSelection,
    pub notes: Vec<WeightedNote>,
    pub nodes: Vec<PartitionNode>,
    pub root: Option<usize>,
    pub regions: Vec<StructureRegionInput>,
    pub split_evaluations: usize,
    pub affinities: Vec<PartitionAffinity>,
    pub affinity_members: usize,
    pub affinity_visits: usize,
    pub scope: String,
    pub limitations: Vec<String>,
}

fn hash(value: &serde_json::Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}
fn fraction(mut n: u64, mut d: u64) -> String {
    let (a, b) = (n, d);
    while d != 0 {
        (n, d) = (d, n % d);
    }
    format!("{}/{}", a / n, b / n)
}
fn content_address(score: &Score, notes: &[&ScoreNote], projection: &ContentProjection) -> String {
    let start = if projection.translate_time {
        notes.iter().map(|n| n.onset).min().unwrap_or(0)
    } else {
        0
    };
    let pitch = if projection.transpose_pitch {
        notes.iter().map(|n| n.pitch.millicents).min().unwrap_or(0)
    } else {
        0
    };
    let mut members: Vec<_> = notes
        .iter()
        .map(|n| {
            let part = score.parts.iter().find(|p| p.id == n.part).unwrap();
            json!([
                fraction(n.onset - start, score.ppq),
                fraction(n.duration, score.ppq),
                (n.pitch.millicents as i128 - pitch as i128).to_string(),
                if projection.include_routing {
                    json!([part.track, part.channel, part.percussion])
                } else {
                    json!(null)
                },
                if projection.include_velocity {
                    json!([n.velocity, n.release_velocity])
                } else {
                    json!(null)
                },
                if projection.include_expression {
                    json!([
                        n.pitch_envelope.as_ref().map(|v| v
                            .iter()
                            .map(|p| json!([
                                fraction(p.tick, score.ppq),
                                (p.pitch.millicents as i128 - n.pitch.millicents as i128)
                                    .to_string()
                            ]))
                            .collect::<Vec<_>>()),
                        n.gain_envelope.as_ref().map(|v| v
                            .iter()
                            .map(|p| json!([fraction(p.tick, score.ppq), p.gain]))
                            .collect::<Vec<_>>())
                    ])
                } else {
                    json!(null)
                }
            ])
            .to_string()
        })
        .collect();
    members.sort();
    hash(&json!(["native-note-content/v1", projection, members]))
}
fn notated_accent(meters: &[crate::meter::MeterSegment], ppq: u64, onset: u64) -> Option<f64> {
    let position = crate::meter::metrical_position(meters, ppq, onset)?;
    Some(if position.bar {
        1.0
    } else if position.denominator_beat {
        0.5
    } else {
        0.0
    })
}
#[derive(Clone, Default)]
struct Moments {
    weight: [f64; 7],
    mean: [f64; 7],
    squared_deviation: [f64; 7],
}
impl Moments {
    fn add(&mut self, features: &[Option<f64>; 7], weight: f64) {
        for i in 0..7 {
            if let Some(value) = features[i] {
                let delta = value - self.mean[i];
                self.weight[i] += weight;
                self.mean[i] += delta * weight / self.weight[i];
                self.squared_deviation[i] += weight * delta * (value - self.mean[i]);
            }
        }
    }
    fn subtract(&self, other: &Self) -> Self {
        let mut result = Self::default();
        for i in 0..7 {
            result.weight[i] = (self.weight[i] - other.weight[i]).max(0.0);
            if result.weight[i] > 0.0 {
                let delta = other.mean[i] - self.mean[i];
                result.mean[i] = self.mean[i] - delta * other.weight[i] / result.weight[i];
                result.squared_deviation[i] = (self.squared_deviation[i]
                    - other.squared_deviation[i]
                    - delta * delta * self.weight[i] * other.weight[i] / result.weight[i])
                    .max(0.0);
            }
        }
        result
    }
    fn variance(&self, weights: &[f64; 7]) -> f64 {
        (0..7)
            .map(|i| {
                if self.weight[i] <= 0.0 {
                    0.0
                } else {
                    self.squared_deviation[i].max(0.0) * weights[i]
                }
            })
            .sum()
    }
}

/// Sparse incidence retains each contextual group rather than materializing
/// all note pairs. Musical memberships remain hypotheses supplied by harmony.
fn contextual_affinities(
    score: &Score,
    notes: &[&ScoreNote],
    harmonic: Option<&HarmonicRegionAnalysis>,
    limit: usize,
) -> CoreResult<(Vec<PartitionAffinity>, Vec<Vec<usize>>, usize)> {
    let source: HashMap<_, _> = score
        .notes
        .iter()
        .map(|note| (note.id.as_str(), note))
        .collect();
    let selected: HashMap<_, _> = notes
        .iter()
        .enumerate()
        .map(|(i, note)| (note.id.as_str(), i))
        .collect();
    let parts: HashSet<_> = notes.iter().map(|note| note.part.as_str()).collect();
    let mut groups = Vec::new();
    let mut by_note = vec![Vec::new(); notes.len()];
    let mut seen = HashSet::new();
    let mut count = 0;
    let mut add = |kind: &str, part: &str, source_id: &str, ids: &[String]| -> CoreResult<()> {
        if !parts.contains(part) {
            return Ok(());
        }
        let mut unique = BTreeSet::new();
        for id in ids {
            let note = source
                .get(id.as_str())
                .ok_or_else(|| invalid("Unknown source note in partition affinity."))?;
            if note.part != part || !unique.insert(id.as_str()) {
                return Err(invalid(
                    "Invalid part or repeated note in partition affinity.",
                ));
            }
        }
        let retained: Vec<_> = unique
            .into_iter()
            .filter(|id| selected.contains_key(id))
            .collect();
        if retained.len() < 2 {
            return Ok(());
        }
        let key = (
            kind.to_string(),
            retained.iter().map(|id| selected[id]).collect::<Vec<_>>(),
        );
        if seen.contains(&key) {
            return Ok(());
        }
        if retained.len() > limit - count {
            return Err(budget(
                "Weighted partition affinity-members budget exceeded.",
            ));
        }
        count += retained.len();
        let index = groups.len();
        for id in &retained {
            by_note[selected[id]].push(index);
        }
        groups.push(PartitionAffinity {
            id: serde_json::to_string(&(part, kind, source_id))?,
            kind: kind.into(),
            source_id: source_id.into(),
            note_ids: retained.iter().map(|id| (*id).to_string()).collect(),
        });
        seen.insert(key);
        Ok(())
    };
    if let Some(harmonic) = harmonic {
        for cohort in harmonic.cohorts.iter().filter(|cohort| cohort.selected) {
            add("support-cohort", &cohort.part, &cohort.id, &cohort.note_ids)?;
        }
        for cell in &harmonic.melody_cells {
            add("complement-cell", &cell.part, &cell.id, &cell.note_ids)?;
        }
    }
    Ok((groups, by_note, count))
}

#[derive(Clone, Default)]
struct GroupMass {
    total: f64,
    count: usize,
    left: f64,
    left_count: usize,
}
impl GroupMass {
    // Group-mass-weighted normalized cut: 4 L R / T² in [0,1]. No pairwise
    // similarity graph or transitive membership is inferred from these groups.
    fn cut_mass(&self) -> f64 {
        if self.count < 2 {
            0.0
        } else {
            4.0 * self.left * (self.total - self.left).max(0.0) / self.total
        }
    }
    fn separated(&self) -> bool {
        self.left_count > 0 && self.left_count < self.count
    }
}
fn charge_affinities(visits: &mut usize, count: usize, limit: usize) -> CoreResult<()> {
    if count > limit - *visits {
        return Err(budget(
            "Weighted partition affinity-visits budget exceeded.",
        ));
    }
    *visits += count;
    Ok(())
}
struct CohesionSweep {
    groups: BTreeMap<usize, GroupMass>,
    total: [f64; 2],
    cut: [f64; 2],
    separated: [usize; 2],
}
impl CohesionSweep {
    fn new(groups: &BTreeMap<usize, GroupMass>, affinities: &[PartitionAffinity]) -> Self {
        let mut result = Self {
            groups: groups.clone(),
            total: [0.0; 2],
            cut: [0.0; 2],
            separated: [0; 2],
        };
        for (&index, group) in groups {
            if group.count >= 2 {
                result.total[usize::from(affinities[index].kind != "support-cohort")] +=
                    group.total;
            }
        }
        result
    }
    fn advance(&mut self, group_id: usize, weight: f64, kind: usize) {
        let group = self.groups.get_mut(&group_id).unwrap();
        self.cut[kind] -= group.cut_mass();
        self.separated[kind] -= usize::from(group.separated());
        group.left = (group.left + weight).min(group.total);
        group.left_count += 1;
        self.cut[kind] += group.cut_mass();
        self.separated[kind] += usize::from(group.separated());
    }
    fn separation(&self, kind: usize) -> f64 {
        if self.total[kind] > 0.0 {
            (self.cut[kind] / self.total[kind]).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }
}
struct Builder<'a> {
    score: &'a Score,
    notes: Vec<&'a ScoreNote>,
    cues: Vec<WeightedNote>,
    features: Vec<[Option<f64>; 7]>,
    affinities: Vec<PartitionAffinity>,
    by_note: Vec<Vec<usize>>,
    affinity_visits: usize,
    boundaries: BTreeMap<u64, f64>,
    options: PartitionOptions,
    nodes: Vec<PartitionNode>,
    evaluations: usize,
}
impl Builder<'_> {
    fn build(&mut self, indices: Vec<usize>, depth: usize) -> CoreResult<usize> {
        let index = self.nodes.len();
        let selected: Vec<_> = indices.iter().map(|&i| self.notes[i]).collect();
        let address = content_address(self.score, &selected, &self.options.content);
        let mut ids: Vec<_> = selected.iter().map(|n| n.id.clone()).collect();
        ids.sort();
        let id = format!("partition-{index}");
        self.nodes.push(PartitionNode {
            id,
            depth,
            note_ids: ids,
            content_address: address,
            tree_address: String::new(),
            split: None,
            children: Vec::new(),
            stop_reason: None,
        });
        let reason = if depth >= self.options.max_depth {
            Some("depth budget")
        } else if self.nodes.len() + 2 > self.options.max_nodes {
            Some("node budget")
        } else if indices.len() / 2 < self.options.min_leaf_notes {
            Some("minimum leaf membership")
        } else {
            None
        };
        if let Some(reason) = reason {
            self.nodes[index].stop_reason = Some(reason.into());
            self.finish(index);
            return Ok(index);
        }
        let weights = self.options.features.values();
        let mut total = Moments::default();
        let mut groups = BTreeMap::<usize, GroupMass>::new();
        for &i in &indices {
            total.add(&self.features[i], self.cues[i].weight);
            charge_affinities(
                &mut self.affinity_visits,
                self.by_note[i].len(),
                self.options.max_affinity_visits,
            )?;
            for &group in &self.by_note[i] {
                let mass = groups.entry(group).or_default();
                mass.total += self.cues[i].weight;
                mass.count += 1;
            }
        }
        let parent_variance = total.variance(&weights);
        let mut best: Option<(PartitionSplit, usize, usize)> = None;
        for axis in 0..2 {
            let coordinate = |i: usize| {
                if axis == 0 {
                    self.notes[i].onset as i64
                } else {
                    self.notes[i].pitch.millicents
                }
            };
            let mut sorted = indices.clone();
            sorted.sort_by_key(|&i| (coordinate(i), self.notes[i].id.as_str()));
            let low = coordinate(sorted[0]);
            let high = coordinate(*sorted.last().unwrap());
            let span = (high as i128 - low as i128) as f64;
            if span == 0.0 {
                continue;
            }
            let mut left = Moments::default();
            let mut cohesion = CohesionSweep::new(&groups, &self.affinities);
            for cut in 1..sorted.len() {
                let previous = sorted[cut - 1];
                left.add(&self.features[previous], self.cues[previous].weight);
                charge_affinities(
                    &mut self.affinity_visits,
                    self.by_note[previous].len(),
                    self.options.max_affinity_visits,
                )?;
                for &group in &self.by_note[previous] {
                    cohesion.advance(
                        group,
                        self.cues[previous].weight,
                        usize::from(self.affinities[group].kind != "support-cohort"),
                    );
                }
                let next = sorted[cut];
                if cut < self.options.min_leaf_notes
                    || sorted.len() - cut < self.options.min_leaf_notes
                    || coordinate(previous) == coordinate(next)
                {
                    continue;
                }
                if self.evaluations >= self.options.max_split_evaluations {
                    return Err(budget(
                        "Weighted partition split-evaluations budget exceeded.",
                    ));
                }
                self.evaluations += 1;
                let gain = if parent_variance > f64::EPSILON {
                    ((parent_variance
                        - left.variance(&weights)
                        - total.subtract(&left).variance(&weights))
                        / parent_variance)
                        .clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let boundary = if axis == 0 {
                    self.boundaries
                        .range((self.notes[previous].onset + 1)..=self.notes[next].onset)
                        .map(|(_, v)| *v)
                        .fold(0.0, f64::max)
                } else {
                    0.0
                };
                let gap = (coordinate(next) as i128 - coordinate(previous) as i128) as f64 / span;
                let support_separation = cohesion.separation(0);
                let melody_separation = cohesion.separation(1);
                let score =
                    gain + self.options.boundary_weight * boundary + self.options.gap_weight * gap
                        - self.options.support_cohesion_weight * support_separation
                        - self.options.melody_cohesion_weight * melody_separation;
                if best
                    .as_ref()
                    .is_none_or(|(old, _, _)| score > old.score + 1e-12)
                {
                    best = Some((
                        PartitionSplit {
                            axis: if axis == 0 { "time" } else { "pitch" }.into(),
                            at: coordinate(next).to_string(),
                            variance_gain: gain,
                            boundary_evidence: boundary,
                            normalized_gap: gap,
                            support_separation,
                            melody_separation,
                            separated_support_groups: cohesion.separated[0],
                            separated_melody_groups: cohesion.separated[1],
                            score,
                        },
                        axis,
                        cut,
                    ));
                }
            }
        }
        if let Some((split, axis, cut)) = best.filter(|(s, _, _)| s.score >= self.options.min_gain)
        {
            let coordinate = |i: usize| {
                if axis == 0 {
                    self.notes[i].onset as i64
                } else {
                    self.notes[i].pitch.millicents
                }
            };
            let mut sorted = indices;
            sorted.sort_by_key(|&i| (coordinate(i), self.notes[i].id.as_str()));
            let right = sorted.split_off(cut);
            self.nodes[index].split = Some(split);
            // Reserve both siblings before descending by sharing a subtree node allowance.
            let node_limit = self.options.max_nodes;
            self.options.max_nodes = node_limit - 1;
            let a = self.build(sorted, depth + 1)?;
            self.options.max_nodes = node_limit;
            let b = self.build(right, depth + 1)?;
            self.nodes[index].children = vec![a, b];
        } else {
            self.nodes[index].stop_reason = Some("insufficient weighted contrast".into());
        }
        self.finish(index);
        Ok(index)
    }
    fn finish(&mut self, index: usize) {
        let node = &self.nodes[index];
        let children: Vec<_> = node
            .children
            .iter()
            .map(|&i| self.nodes[i].tree_address.as_str())
            .collect();
        let signature = hash(&json!([
            "weighted-bsp/v1",
            node.content_address,
            node.split,
            children
        ]));
        self.nodes[index].tree_address = signature;
    }
}
pub fn infer_weighted_partition(
    score: &Score,
    selection: &ScoreSelection,
    options: &PartitionOptions,
    harmonic: Option<&HarmonicRegionAnalysis>,
) -> CoreResult<WeightedPartitionAnalysis> {
    validate_score(score)?;
    let weights = options.note_weights;
    let coefficients = [
        options.boundary_weight,
        options.gap_weight,
        options.support_cohesion_weight,
        options.melody_cohesion_weight,
        options.min_gain,
        weights.velocity,
        weights.duration,
        weights.rhythm,
        weights.support,
        weights.support_membership,
    ];
    if coefficients
        .iter()
        .chain(options.features.values().iter())
        .any(|v| !v.is_finite() || *v < 0.0 || *v > 100.0)
        || options.min_leaf_notes == 0
        || options.max_depth > 32
        || options.max_nodes == 0
        || options.max_nodes > 4095
    {
        return Err(invalid("Invalid weighted partition priors or work bounds."));
    }
    let mut notes = select_notes(score, selection)?;
    notes.sort_by(|a, b| {
        a.onset
            .cmp(&b.onset)
            .then(a.pitch.millicents.cmp(&b.pitch.millicents))
            .then(a.id.cmp(&b.id))
    });
    let maximum_duration = notes.iter().map(|n| n.duration).max().unwrap_or(1).max(1) as f64;
    let lowest = notes.iter().map(|n| n.pitch.millicents).min().unwrap_or(0);
    let highest = notes.iter().map(|n| n.pitch.millicents).max().unwrap_or(0);
    let start = notes.first().map_or(0, |n| n.onset);
    let end = notes.last().map_or(start, |n| n.onset);
    let pitch_span = (highest as i128 - lowest as i128).max(1) as f64;
    let time_span = (end - start).max(1) as f64;
    let selected_parts: BTreeSet<_> = notes.iter().map(|n| n.part.as_str()).collect();
    let mut boundaries = BTreeMap::new();
    if let Some(harmonic) = harmonic {
        let mut by_part = BTreeMap::<&str, Vec<_>>::new();
        for run in harmonic
            .harmonic_runs
            .iter()
            .filter(|run| selected_parts.contains(run.part.as_str()))
        {
            by_part.entry(&run.part).or_default().push(run);
        }
        for runs in by_part.values_mut() {
            runs.sort_by_key(|r| r.start_tick);
            for pair in runs.windows(2) {
                let a: BTreeSet<_> = pair[0]
                    .support_pitches
                    .iter()
                    .map(|p| p.rem_euclid(1_200_000))
                    .collect();
                let b: BTreeSet<_> = pair[1]
                    .support_pitches
                    .iter()
                    .map(|p| p.rem_euclid(1_200_000))
                    .collect();
                let union = a.union(&b).count();
                let novelty = if union == 0 {
                    0.0
                } else {
                    1.0 - a.intersection(&b).count() as f64 / union as f64
                };
                boundaries
                    .entry(pair[1].start_tick)
                    .and_modify(|v: &mut f64| *v = (*v).max(novelty))
                    .or_insert(novelty);
            }
        }
    }
    let (meters, _) = crate::meter::meter_segments(score, 20_000)?;
    let mut cues = Vec::new();
    let mut features = Vec::new();
    for note in &notes {
        let context = harmonic.and_then(|h| {
            h.harmonic_runs.iter().find(|r| {
                r.part == note.part && note.onset >= r.start_tick && note.onset < r.end_tick
            })
        });
        let velocity = note.velocity as f64 / 127.0;
        let duration = note.duration as f64 / maximum_duration;
        let rhythm = notated_accent(&meters, score.ppq, note.onset);
        let member = context.map(|r| r.note_ids.contains(&note.id));
        let support = context.map(|r| {
            r.support_pitches
                .iter()
                .any(|p| p.rem_euclid(1_200_000) == note.pitch.millicents.rem_euclid(1_200_000))
        });
        let support_value = support.map(|value| f64::from(value));
        let membership_value = member.map(|value| f64::from(value));
        let weight = 1.0
            + weights.velocity * velocity
            + weights.duration * duration
            + weights.rhythm * rhythm.unwrap_or(0.0)
            + weights.support * support_value.unwrap_or(0.0)
            + weights.support_membership * membership_value.unwrap_or(0.0);
        features.push([
            Some((note.onset - start) as f64 / time_span),
            Some((note.pitch.millicents as i128 - lowest as i128) as f64 / pitch_span),
            Some(velocity),
            Some(duration),
            rhythm,
            support_value,
            membership_value,
        ]);
        cues.push(WeightedNote {
            note_id: note.id.clone(),
            velocity,
            duration,
            quarter_phase: fraction(note.onset % score.ppq, score.ppq),
            notated_accent: rhythm,
            support_membership: member,
            support_pitch_class: support,
            bass_relative_millicents: context
                .map(|r| (note.pitch.millicents as i128 - r.bass_millicents as i128).to_string()),
            weight,
        });
    }
    let (affinities, by_note, affinity_members) =
        contextual_affinities(score, &notes, harmonic, options.max_affinity_members)?;
    let length = notes.len();
    let mut builder = Builder {
        score,
        notes,
        cues,
        features,
        affinities,
        by_note,
        affinity_visits: 0,
        boundaries,
        options: options.clone(),
        nodes: Vec::new(),
        evaluations: 0,
    };
    let root = if length == 0 {
        None
    } else {
        Some(builder.build((0..length).collect(), 0)?)
    };
    let mut parents = BTreeMap::new();
    for node in &builder.nodes {
        for &child in &node.children {
            parents.insert(child, node.id.clone());
        }
    }
    let regions=builder.nodes.iter().enumerate().map(|(i,node)|StructureRegionInput{id:node.id.clone(),label:node.split.as_ref().map_or_else(||format!("Weighted group · {} notes",node.note_ids.len()),|s|format!("{} split · {} notes",s.axis,node.note_ids.len())),kind:"weighted partition proposal".into(),note_ids:node.note_ids.clone(),parent_ids:Some(parents.get(&i).cloned().into_iter().collect()),parameters:vec![StructureParameter{key:"content-address".into(),value:node.content_address.clone(),label:Some("Exact content projection".into()),display_value:Some(node.content_address[..12].into()),projection:Some("SHA-256 of canonical note content under the reported translation, routing, velocity and expression projection. Equal hashes are not perceptual similarity or a decoder.".into())},StructureParameter{key:"partition-depth".into(),value:node.depth.to_string(),label:Some("Partition depth".into()),display_value:Some(node.depth.to_string()),projection:Some("Depth in this weighted contrast proposal; not a primary musical level of detail.".into())}]}).collect();
    Ok(WeightedPartitionAnalysis{parameters:options.clone(),selection:selection.clone(),notes:builder.cues,nodes:builder.nodes,root,regions,split_evaluations:builder.evaluations,affinities:builder.affinities,affinity_members,affinity_visits:builder.affinity_visits,scope:"explicit selected notes; attacks partitioned, held tails may cross split planes".into(),limitations:vec!["Experimental declared priors, not learned probabilities or validated phrase segmentation. Each note has one leaf in this view; independent harmonic and recurrence views can overlap.".into(),"Notated accent uses only explicit MIDI meter changes, with metadata changes as phase origins: bar=1, denominator pulse=.5, other=0. Missing or unsupported meter stays unknown; this cue accepts denominator powers through 1/128. Compound tactus and pickups are not inferred.".into(),"Support membership, pitch-class fit and Jaccard changes describe supplied cohort hypotheses, not confirmed chord roots/functions. Missing meter/support stays unknown and is excluded from that feature’s contrast moments; unknown notes receive no corresponding evidence boost in their scalar weight. Missingness alone cannot supply feature contrast. Repeated support cohorts and support-conditioned complement cells supply separate cohesion penalties, not independently inferred melody voices. For each group the bounded cut fraction is 4LR/T², weighted by its observed note mass; the two group kinds are averaged and weighted separately. These declared priors discourage but do not forbid splitting a group.".into(),"Velocity is MIDI intensity, not calibrated loudness. Content hashes include no note IDs or source ordering; tree addresses additionally include this partition and its split evidence.".into()]})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harmonic::{HarmonicRegionOptions, infer_harmonic_regions};
    use crate::model::{Pitch, ScoreAttachment, ScorePart};

    fn note(id: impl Into<String>, onset: u64, duration: u64, pitch: i64) -> ScoreNote {
        ScoreNote {
            id: id.into(),
            part: "p".into(),
            onset,
            duration,
            pitch: Pitch { millicents: pitch },
            velocity: 80,
            release_velocity: 64,
            pitch_envelope: None,
            gain_envelope: None,
            source: None,
        }
    }
    fn source(notes: Vec<ScoreNote>) -> Score {
        Score {
            ppq: 100,
            duration: 1600,
            midi_format: None,
            parts: vec![ScorePart {
                id: "p".into(),
                name: "Synthetic".into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            notes,
            attachments: vec![],
            track_ends: vec![1600],
        }
    }
    fn arpeggios(change: bool) -> Score {
        source(
            (0..4)
                .flat_map(|i| {
                    [0, 700_000, 1_200_000]
                        .into_iter()
                        .enumerate()
                        .map(move |(j, pitch)| {
                            note(
                                format!("{i}-{j}"),
                                i * 400 + j as u64 * 50,
                                400 - j as u64 * 50,
                                4_800_000 + pitch + if change && i >= 2 { 200_000 } else { 0 },
                            )
                        })
                })
                .collect(),
        )
    }
    fn isolated() -> PartitionOptions {
        PartitionOptions {
            features: FeatureWeights {
                time: 0.0,
                pitch: 0.0,
                velocity: 0.0,
                duration: 0.0,
                rhythm: 0.0,
                support: 0.0,
                support_membership: 0.0,
            },
            note_weights: NoteWeights {
                velocity: 0.0,
                duration: 0.0,
                rhythm: 0.0,
                support: 0.0,
                support_membership: 0.0,
            },
            gap_weight: 0.0,
            boundary_weight: 0.0,
            support_cohesion_weight: 0.0,
            melody_cohesion_weight: 0.0,
            min_gain: 0.1,
            ..PartitionOptions::default()
        }
    }
    fn harmony(score: &Score) -> HarmonicRegionAnalysis {
        infer_harmonic_regions(
            score,
            &ScoreSelection {
                parts: Some(vec!["p".into()]),
                ..ScoreSelection::default()
            },
            &HarmonicRegionOptions::default(),
        )
        .unwrap()
    }
    fn infer(
        score: &Score,
        options: &PartitionOptions,
        harmonic: Option<&HarmonicRegionAnalysis>,
    ) -> WeightedPartitionAnalysis {
        infer_weighted_partition(score, &ScoreSelection::default(), options, harmonic).unwrap()
    }
    fn fragmented(analysis: &WeightedPartitionAnalysis, group: &PartitionAffinity) -> bool {
        analysis
            .nodes
            .iter()
            .filter(|node| {
                node.children.is_empty()
                    && node.note_ids.iter().any(|id| group.note_ids.contains(id))
            })
            .count()
            > 1
    }

    #[test]
    fn reversing_contextual_feature_weights_changes_actual_split() {
        let score = source(
            (0..8)
                .map(|i| {
                    let mut n = note(
                        i.to_string(),
                        i * 100,
                        if i < 2 { 50 } else { 100 },
                        6_000_000,
                    );
                    n.velocity = if i < 4 { 20 } else { 100 };
                    n
                })
                .collect(),
        );
        let mut options = isolated();
        options.max_depth = 1;
        options.features.velocity = 1.0;
        let velocity = infer(&score, &options, None);
        options.features.velocity = 0.0;
        options.features.duration = 1.0;
        let duration = infer(&score, &options, None);
        assert_eq!(velocity.nodes[0].split.as_ref().unwrap().at, "400");
        assert_eq!(duration.nodes[0].split.as_ref().unwrap().at, "200");
        assert_eq!(
            velocity.nodes[0].content_address,
            duration.nodes[0].content_address
        );
        assert_ne!(
            velocity.nodes[0].tree_address,
            duration.nodes[0].tree_address
        );
    }

    #[test]
    fn supported_arpeggios_resist_register_fragmentation_under_explicit_cohesion() {
        let score = arpeggios(false);
        let harmonic = harmony(&score);
        let mut options = isolated();
        options.features.pitch = 1.0;
        let ablated = infer(&score, &options, Some(&harmonic));
        assert_eq!(ablated.affinities.len(), 4);
        assert!(
            ablated
                .affinities
                .iter()
                .any(|group| fragmented(&ablated, group))
        );
        assert!(ablated.nodes[0].split.as_ref().unwrap().support_separation > 0.0);
        options.support_cohesion_weight = 2.0;
        let cohesive = infer(&score, &options, Some(&harmonic));
        assert!(
            cohesive
                .affinities
                .iter()
                .all(|group| !fragmented(&cohesive, group))
        );
        assert_eq!(score, arpeggios(false));
    }

    #[test]
    fn complement_cohesion_has_an_independent_effect_from_support_cohesion() {
        let mut score = arpeggios(false);
        for i in 0..4 {
            for j in 0..3 {
                score.notes.push(note(
                    format!("melody-{i}-{j}"),
                    i * 400 + 150 + j * 50,
                    10,
                    7_200_000 + j as i64 * 200_000,
                ));
            }
        }
        let harmonic = harmony(&score);
        let mut options = isolated();
        options.features.pitch = 1.0;
        options.support_cohesion_weight = 2.0;
        let ablated = infer(&score, &options, Some(&harmonic));
        assert!(
            ablated
                .affinities
                .iter()
                .filter(|g| g.kind == "complement-cell")
                .any(|g| fragmented(&ablated, g))
        );
        options.melody_cohesion_weight = 2.0;
        let cohesive = infer(&score, &options, Some(&harmonic));
        assert!(
            cohesive
                .affinities
                .iter()
                .filter(|g| g.kind == "complement-cell")
                .all(|g| !fragmented(&cohesive, g))
        );
        assert!(
            cohesive.nodes.len() > 1,
            "preserving the complement does not forbid separating it from the support"
        );
    }

    #[test]
    fn harmonic_change_favors_a_boundary_without_fixed_grid_or_note_count() {
        let changed = arpeggios(true);
        let harmonic = harmony(&changed);
        let mut options = isolated();
        options.boundary_weight = 1.0;
        options.support_cohesion_weight = 2.0;
        let result = infer(&changed, &options, Some(&harmonic));
        let split = result.nodes[0].split.as_ref().unwrap();
        assert_eq!(split.at, "800");
        assert_eq!(split.boundary_evidence, 1.0);
        assert_eq!(split.support_separation, 0.0);
        let unchanged = arpeggios(false);
        assert_eq!(
            infer(&unchanged, &options, Some(&harmony(&unchanged)))
                .nodes
                .len(),
            1
        );
        options.boundary_weight = 0.0;
        assert_eq!(infer(&changed, &options, Some(&harmonic)).nodes.len(), 1);
    }

    #[test]
    fn unknown_meter_is_excluded_rather_than_a_false_zero_class() {
        let mut score = source(
            [0, 400, 800, 1200]
                .into_iter()
                .enumerate()
                .map(|(i, tick)| note(i.to_string(), tick, 100, 6_000_000))
                .collect(),
        );
        score.attachments.push(ScoreAttachment {
            tick: 800,
            track: 0,
            order: 0,
            bytes: vec![255, 88, 4, 4, 2, 24, 8],
        });
        let mut options = isolated();
        options.features.rhythm = 1.0;
        let unknown = infer(&score, &options, None);
        assert_eq!(
            unknown
                .notes
                .iter()
                .map(|n| n.notated_accent)
                .collect::<Vec<_>>(),
            vec![None, None, Some(1.0), Some(1.0)]
        );
        assert_eq!(unknown.nodes.len(), 1);
        score.attachments.clear();
        score.attachments.push(ScoreAttachment {
            tick: 0,
            track: 0,
            order: 0,
            bytes: vec![255, 88, 4, 4, 2, 24, 8],
        });
        score.notes[0].onset = 50;
        score.notes[1].onset = 450;
        assert_eq!(
            infer(&score, &options, None).nodes.len(),
            3,
            "known nonaccents do provide contrast against known accents"
        );
    }

    #[test]
    fn constant_known_cues_do_not_gain_numerical_variance_under_unequal_weights() {
        let mut score = source(
            (0..100)
                .map(|i| {
                    let mut n = note(i.to_string(), i * 400, 100, 6_000_000);
                    n.velocity = 1 + (i % 126) as u8;
                    n
                })
                .collect(),
        );
        score.duration = 40_000;
        score.track_ends[0] = score.duration;
        score.attachments.push(ScoreAttachment {
            tick: 20_000,
            track: 0,
            order: 0,
            bytes: vec![255, 88, 4, 4, 2, 24, 8],
        });
        let mut options = isolated();
        options.features.rhythm = 1.0;
        options.note_weights.velocity = 0.731;
        let result = infer(&score, &options, None);
        assert_eq!(
            result
                .notes
                .iter()
                .filter(|n| n.notated_accent.is_some())
                .count(),
            50
        );
        assert_eq!(result.nodes.len(), 1);
    }

    #[test]
    fn unknown_support_is_not_a_false_nonmember_and_duplicate_hypotheses_do_not_reweight() {
        let mut score = arpeggios(false);
        for note in &mut score.notes {
            note.onset += 400;
        }
        score.duration += 400;
        score.track_ends[0] += 400;
        score.notes.extend([
            note("intro-a", 0, 10, 8_000_000),
            note("intro-b", 10, 10, 8_200_000),
        ]);
        let harmonic = harmony(&score);
        let mut options = isolated();
        options.features.support_membership = 1.0;
        let result = infer(&score, &options, Some(&harmonic));
        assert!(result.notes.iter().any(|n| n.support_membership.is_none()));
        assert!(
            result
                .notes
                .iter()
                .any(|n| n.support_membership == Some(true))
        );
        assert_eq!(result.nodes.len(), 1);
        let mut duplicate = harmonic.clone();
        duplicate.cohorts.extend(harmonic.cohorts.clone());
        let other = infer(&score, &options, Some(&duplicate));
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(other).unwrap()
        );
    }

    #[test]
    fn affinity_storage_and_work_limits_reject_without_partial_hierarchy() {
        let score = arpeggios(true);
        let harmonic = harmony(&score);
        let options = PartitionOptions::default();
        let result = infer(&score, &options, Some(&harmonic));
        assert_eq!(result.affinity_members, 12);
        assert!(result.affinity_visits > 0);
        let exact = PartitionOptions {
            max_affinity_members: result.affinity_members,
            max_affinity_visits: result.affinity_visits,
            ..options.clone()
        };
        assert_eq!(
            infer(&score, &exact, Some(&harmonic)).nodes.len(),
            result.nodes.len()
        );
        for (members, visits, message) in [
            (11, result.affinity_visits, "affinity-members"),
            (12, result.affinity_visits - 1, "affinity-visits"),
        ] {
            let bounded = PartitionOptions {
                max_affinity_members: members,
                max_affinity_visits: visits,
                ..options.clone()
            };
            assert!(
                infer_weighted_partition(
                    &score,
                    &ScoreSelection::default(),
                    &bounded,
                    Some(&harmonic)
                )
                .unwrap_err()
                .to_string()
                .contains(message)
            );
        }
        let mut malformed = harmonic.clone();
        malformed
            .cohorts
            .iter_mut()
            .find(|g| g.selected)
            .unwrap()
            .note_ids
            .push("missing".into());
        assert!(
            infer_weighted_partition(
                &score,
                &ScoreSelection::default(),
                &options,
                Some(&malformed)
            )
            .is_err()
        );
    }

    #[test]
    fn unrelated_parts_cannot_supply_cohesion_membership_or_harmonic_change() {
        let mut score = arpeggios(true);
        score.parts.push(ScorePart {
            id: "q".into(),
            name: "Unrelated".into(),
            track: 1,
            channel: 1,
            percussion: false,
        });
        score.track_ends.push(score.duration);
        let other: Vec<_> = score
            .notes
            .iter()
            .map(|n| {
                let mut note = n.clone();
                note.id = format!("q-{}", note.id);
                note.part = "q".into();
                note
            })
            .collect();
        score.notes.extend(other);
        let q = ScoreSelection {
            parts: Some(vec!["q".into()]),
            ..ScoreSelection::default()
        };
        let p = ScoreSelection {
            parts: Some(vec!["p".into()]),
            ..ScoreSelection::default()
        };
        let harmonic =
            infer_harmonic_regions(&score, &q, &HarmonicRegionOptions::default()).unwrap();
        assert!(harmonic.harmonic_runs.len() > 1);
        let options = PartitionOptions::default();
        let before = infer_weighted_partition(&score, &p, &options, None).unwrap();
        let after = infer_weighted_partition(&score, &p, &options, Some(&harmonic)).unwrap();
        assert_eq!(
            serde_json::to_value(before).unwrap(),
            serde_json::to_value(after).unwrap()
        );
    }
}
