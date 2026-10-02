//! Independent metrics. Boundary tolerance matching is maximum-cardinality;
//! occurrence matching maximizes exact shared membership and is NOT MIREX.
//! Alternative annotations are evaluated separately, never unioned or selected.
use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;
pub const MAX_OCCURRENCES: usize = 512;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PrecisionRecall {
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BoundaryReference {
    pub id: String,
    pub boundaries: Vec<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BoundaryOptions {
    pub unit: String,
    pub tolerance: f64,
    pub span: [f64; 2],
    pub endpoints: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryMatch {
    pub reference_index: usize,
    pub estimated_index: usize,
    pub reference_time: f64,
    pub estimated_time: f64,
    pub distance: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryEvaluation {
    pub reference_id: String,
    pub metric: String,
    pub options: BoundaryOptions,
    pub reference_count: usize,
    pub estimated_count: usize,
    #[serde(flatten)]
    pub rates: PrecisionRecall,
    pub matches: Vec<BoundaryMatch>,
    pub unmatched_reference_indices: Vec<usize>,
    pub unmatched_estimated_indices: Vec<usize>,
    pub excluded_reference_indices: Vec<usize>,
    pub excluded_estimated_indices: Vec<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Occurrence {
    pub id: String,
    pub members: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct OccurrenceReference {
    pub id: String,
    pub occurrences: Vec<Occurrence>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceMatch {
    pub reference_id: String,
    pub estimated_id: String,
    pub shared_members: usize,
    #[serde(flatten)]
    pub rates: PrecisionRecall,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceEvaluation {
    pub reference_id: String,
    pub metric: String,
    #[serde(flatten)]
    pub rates: PrecisionRecall,
    pub matched_members: usize,
    pub reference_members: usize,
    pub estimated_members: usize,
    pub matches: Vec<OccurrenceMatch>,
    pub unmatched_reference_ids: Vec<String>,
    pub unmatched_estimated_ids: Vec<String>,
}
fn unique_ids<'a>(ids: impl Iterator<Item = &'a str>, label: &str) -> CoreResult<()> {
    let mut seen = HashSet::new();
    for id in ids {
        if id.trim().is_empty() || !seen.insert(id) {
            return Err(invalid(format!("{label} IDs must be nonempty and unique.")));
        }
    }
    Ok(())
}
/// Empty denominators give P=1 / R=1 respectively; one-sided empty F1=0,
/// both-empty F1=1. This is explicit and differs from mir_eval empty conventions.
fn rates(matched: usize, estimated: usize, reference: usize) -> PrecisionRecall {
    let p = if estimated > 0 {
        matched as f64 / estimated as f64
    } else {
        1.
    };
    let r = if reference > 0 {
        matched as f64 / reference as f64
    } else {
        1.
    };
    PrecisionRecall {
        precision: p,
        recall: r,
        f1: if p + r > 0. { 2. * p * r / (p + r) } else { 0. },
    }
}
fn boundaries(
    values: &[f64],
    options: &BoundaryOptions,
) -> CoreResult<(Vec<(f64, usize)>, Vec<usize>)> {
    let mut seen = HashSet::new();
    let mut kept = vec![];
    let mut excluded = vec![];
    for (i, &time) in values.iter().enumerate() {
        if !time.is_finite() || time < options.span[0] || time > options.span[1] {
            return Err(invalid(
                "Boundary times must be finite and inside the explicit span.",
            ));
        }
        if !seen.insert(if time == 0. { 0 } else { time.to_bits() }) {
            return Err(invalid("Duplicate boundary times are not allowed."));
        }
        if options.endpoints == "exclude" && (time == options.span[0] || time == options.span[1]) {
            excluded.push(i);
        } else {
            kept.push((time, i));
        }
    }
    kept.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok((kept, excluded))
}
pub fn evaluate_boundaries(
    estimated: &[f64],
    references: &[BoundaryReference],
    options: &BoundaryOptions,
) -> CoreResult<Vec<BoundaryEvaluation>> {
    if options.unit.trim().is_empty()
        || !options.tolerance.is_finite()
        || options.tolerance < 0.
        || options.span.iter().any(|x| !x.is_finite())
        || options.span[0] > options.span[1]
        || !matches!(options.endpoints.as_str(), "include" | "exclude")
    {
        return Err(invalid(
            "Invalid boundary unit, tolerance, span, or endpoint policy.",
        ));
    }
    unique_ids(references.iter().map(|x| x.id.as_str()), "Reference")?;
    let (prediction, excluded_prediction) = boundaries(estimated, options)?;
    references
        .iter()
        .map(|reference| {
            let (truth, excluded_truth) = boundaries(&reference.boundaries, options)?;
            let mut matches = vec![];
            let (mut i, mut j) = (0, 0);
            while i < truth.len() && j < prediction.len() {
                let (a, b) = (truth[i], prediction[j]);
                let distance = (a.0 - b.0).abs();
                if distance <= options.tolerance {
                    matches.push(BoundaryMatch {
                        reference_index: a.1,
                        estimated_index: b.1,
                        reference_time: a.0,
                        estimated_time: b.0,
                        distance,
                    });
                    i += 1;
                    j += 1;
                } else if a.0 < b.0 {
                    i += 1;
                } else {
                    j += 1;
                }
            }
            let found_truth: HashSet<_> = matches.iter().map(|x| x.reference_index).collect();
            let found_prediction: HashSet<_> = matches.iter().map(|x| x.estimated_index).collect();
            Ok(BoundaryEvaluation {
                reference_id: reference.id.clone(),
                metric: "boundary-tolerance".into(),
                options: options.clone(),
                reference_count: truth.len(),
                estimated_count: prediction.len(),
                rates: rates(matches.len(), prediction.len(), truth.len()),
                matches,
                unmatched_reference_indices: truth
                    .iter()
                    .filter(|x| !found_truth.contains(&x.1))
                    .map(|x| x.1)
                    .collect(),
                unmatched_estimated_indices: prediction
                    .iter()
                    .filter(|x| !found_prediction.contains(&x.1))
                    .map(|x| x.1)
                    .collect(),
                excluded_reference_indices: excluded_truth,
                excluded_estimated_indices: excluded_prediction.clone(),
            })
        })
        .collect()
}
fn occurrences(items: &[Occurrence]) -> CoreResult<Vec<HashSet<&str>>> {
    if items.len() > MAX_OCCURRENCES {
        return Err(invalid(format!(
            "Exact occurrence assignment supports at most {MAX_OCCURRENCES} occurrences per annotation."
        )));
    }
    unique_ids(items.iter().map(|x| x.id.as_str()), "Occurrence")?;
    items
        .iter()
        .map(|item| {
            if item.members.is_empty() || item.members.iter().any(|x| x.trim().is_empty()) {
                return Err(invalid("Each occurrence needs nonempty membership keys."));
            }
            let members: HashSet<_> = item.members.iter().map(String::as_str).collect();
            if members.len() != item.members.len() {
                return Err(invalid(
                    "Duplicate membership keys within an occurrence are not allowed.",
                ));
            }
            Ok(members)
        })
        .collect()
}
/// Hungarian shortest augmenting paths. Integer intersections, zero dummy
/// weights, deterministic iteration tie breaking. Cubic time/quadratic memory.
fn assignment(weights: &[Vec<usize>], columns: usize) -> Vec<(usize, usize)> {
    let rows = weights.len();
    let size = rows.max(columns);
    if rows == 0 || columns == 0 {
        return vec![];
    }
    let mut rp = vec![0i64; size + 1];
    let mut cp = vec![0i64; size + 1];
    let mut row_at = vec![0usize; size + 1];
    let mut previous = vec![0usize; size + 1];
    for row in 1..=size {
        row_at[0] = row;
        let mut distance = vec![i64::MAX / 4; size + 1];
        let mut visited = vec![false; size + 1];
        let mut column = 0;
        loop {
            visited[column] = true;
            let current = row_at[column];
            let mut step = i64::MAX / 4;
            let mut next = 0;
            for candidate in 1..=size {
                if !visited[candidate] {
                    let weight = weights
                        .get(current - 1)
                        .and_then(|x| x.get(candidate - 1))
                        .copied()
                        .unwrap_or(0) as i64;
                    let cost = -weight - rp[current] - cp[candidate];
                    if cost < distance[candidate] {
                        distance[candidate] = cost;
                        previous[candidate] = column;
                    }
                    if distance[candidate] < step {
                        step = distance[candidate];
                        next = candidate;
                    }
                }
            }
            for candidate in 0..=size {
                if visited[candidate] {
                    rp[row_at[candidate]] += step;
                    cp[candidate] -= step;
                } else {
                    distance[candidate] -= step;
                }
            }
            column = next;
            if row_at[column] == 0 {
                break;
            }
        }
        loop {
            let prior = previous[column];
            row_at[column] = row_at[prior];
            column = prior;
            if column == 0 {
                break;
            }
        }
    }
    let mut result = vec![];
    for column in 1..=columns {
        if row_at[column] > 0 {
            let row = row_at[column] - 1;
            if row < rows && weights[row][column - 1] > 0 {
                result.push((row, column - 1));
            }
        }
    }
    result.sort_by_key(|x| x.0);
    result
}
pub fn evaluate_occurrences(
    estimated: &[Occurrence],
    references: &[OccurrenceReference],
) -> CoreResult<Vec<OccurrenceEvaluation>> {
    unique_ids(references.iter().map(|x| x.id.as_str()), "Reference")?;
    let prediction = occurrences(estimated)?;
    let estimated_members = estimated.iter().map(|x| x.members.len()).sum();
    references
        .iter()
        .map(|reference| {
            let truth = occurrences(&reference.occurrences)?;
            let reference_members = reference.occurrences.iter().map(|x| x.members.len()).sum();
            let weights: Vec<Vec<_>> = truth
                .iter()
                .map(|members| {
                    prediction
                        .iter()
                        .map(|other| members.intersection(other).count())
                        .collect()
                })
                .collect();
            let pairs = assignment(&weights, prediction.len());
            let matched_members = pairs.iter().map(|&(r, e)| weights[r][e]).sum();
            let found_truth: HashSet<_> = pairs.iter().map(|x| x.0).collect();
            let found_prediction: HashSet<_> = pairs.iter().map(|x| x.1).collect();
            Ok(OccurrenceEvaluation {
                reference_id: reference.id.clone(),
                metric: "occurrence-membership".into(),
                rates: rates(matched_members, estimated_members, reference_members),
                matched_members,
                reference_members,
                estimated_members,
                matches: pairs
                    .iter()
                    .map(|&(r, e)| OccurrenceMatch {
                        reference_id: reference.occurrences[r].id.clone(),
                        estimated_id: estimated[e].id.clone(),
                        shared_members: weights[r][e],
                        rates: rates(weights[r][e], prediction[e].len(), truth[r].len()),
                    })
                    .collect(),
                unmatched_reference_ids: reference
                    .occurrences
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| !found_truth.contains(i))
                    .map(|(_, x)| x.id.clone())
                    .collect(),
                unmatched_estimated_ids: estimated
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| !found_prediction.contains(i))
                    .map(|(_, x)| x.id.clone())
                    .collect(),
            })
        })
        .collect()
}
