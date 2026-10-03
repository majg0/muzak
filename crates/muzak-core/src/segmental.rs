//! Bounded latent-state segmentation over caller-supplied source boundaries.
//! Matched/extraneous evidence is accumulated in quarter-note units. The
//! quality prior, core cardinality and cut remain once per segment. This does
//! not add any new ordering or arpeggio feature to the source observations.
//! Constraints affect only the compatible partition, never full inference.
//! Pitch-class masks are a supplied 12-TET projection; -1 retains UNKNOWN.
use crate::{error::CoreResult as Result, model::MAX_SAFE};
pub use dag::Partition;
use dag::{Edge, Limits, Request, error, finite, logadd, solve};
pub use marginals::{FullMarginals, JointState, MarginalBlock, MarginalDiagnostics};
use serde::{Deserialize, Serialize};

#[path = "segmental/dag.rs"]
mod dag;
#[cfg(test)]
#[path = "segmental/marginal_tests.rs"]
mod marginal_tests;
#[path = "segmental/marginals.rs"]
mod marginals;
#[cfg(test)]
#[path = "segmental/partial_tests.rs"]
mod partial_tests;
#[cfg(test)]
#[path = "segmental/span_tests.rs"]
mod span_tests;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub core_mask: i16,
    pub quality_index: Option<usize>,
    pub prior_weight: f64,
    /// Opaque caller-defined identity; no ordering or musical meaning is inferred.
    pub operator: Option<u32>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Block {
    pub start: usize,
    pub end: usize,
    pub states: Vec<State>,
}
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// A known realized core, optionally constrained to one opaque operation.
/// JSON null/missing `operator` sums all matching-core operations. In contrast,
/// a null entry in Cache.constraints provides no supervision at that cell.
pub struct Constraint {
    pub operator: Option<u32>,
    pub core_mask: i16,
}
impl Constraint {
    fn intersection(self, other: Self) -> Option<Self> {
        if self.core_mask != other.core_mask
            || matches!((self.operator, other.operator), (Some(a), Some(b)) if a != b)
        {
            None
        } else {
            Some(Self {
                core_mask: self.core_mask,
                operator: self.operator.or(other.operator),
            })
        }
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct SpanLimits {
    pub max_cells: usize,
    pub max_edges: usize,
    pub max_span_cells: usize,
    pub max_derivation_visits: usize,
}
impl Default for SpanLimits {
    fn default() -> Self {
        Self {
            max_cells: 8192,
            max_edges: 600_000,
            max_span_cells: 64,
            max_derivation_visits: 80_000_000,
        }
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cache {
    pub ppq: u64,
    pub ticks: Vec<u64>,
    pub support_prefix: Vec<[f64; 12]>,
    /// Per-cell probabilities avoid subtracting long prefixes and losing rare
    /// but positive classes. Short duration sums restart at each span start.
    pub quality_probabilities: Vec<Vec<f64>>,
    pub blocks: Vec<Block>,
    /// Half-open cell supervision. A span must satisfy every covered known
    /// core/operator; compatible wildcards intersect rather than overwrite.
    /// This never changes the full partition, MAP or full state marginals.
    pub constraints: Vec<Option<Constraint>>,
    #[serde(default)]
    pub limits: SpanLimits,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub n_cells: usize,
    pub quality_columns: usize,
    pub edges: usize,
    pub derivation_visits: usize,
}
pub struct Admitted {
    cache: Cache,
    pub statistics: Statistics,
}

pub fn admit(cache: Cache) -> Result<Admitted> {
    if cache.ppq == 0 || cache.ppq > MAX_SAFE {
        return Err(error(
            "invalid-input",
            "PPQ must be a positive safe integer.",
        ));
    }
    let l = &cache.limits;
    if l.max_cells == 0
        || l.max_cells > 1_000_000
        || l.max_edges == 0
        || l.max_edges > 2_000_000
        || l.max_span_cells == 0
        || l.max_span_cells > 1_000_000
        || l.max_derivation_visits == 0
        || l.max_derivation_visits > 1_000_000_000
    {
        return Err(error("invalid-input", "Invalid span-cache limits."));
    }
    let n = cache
        .ticks
        .len()
        .checked_sub(1)
        .ok_or_else(|| error("invalid-input", "Missing source boundaries."))?;
    if n > l.max_cells {
        return Err(error("budget-exceeded", "Source-cell budget exceeded."));
    }
    if cache.ticks.iter().any(|&x| x > MAX_SAFE)
        || cache.ticks.windows(2).any(|p| p[0] >= p[1])
        || cache.support_prefix.len() != n + 1
        || cache.quality_probabilities.len() != n
        || cache.constraints.len() != n
    {
        return Err(error(
            "invalid-input",
            "Invalid exact source boundaries/prefix dimensions.",
        ));
    }
    let q = cache.quality_probabilities.first().map_or(0, Vec::len);
    if q > 64
        || cache
            .quality_probabilities
            .iter()
            .any(|row| row.len() != q || row.iter().any(|x| !x.is_finite() || *x < 0.0 || *x > 1.0))
    {
        return Err(error(
            "invalid-input",
            "Invalid quality probability matrix.",
        ));
    }
    if cache
        .support_prefix
        .iter()
        .flatten()
        .any(|x| !x.is_finite() || *x < 0.0)
        || cache
            .support_prefix
            .windows(2)
            .zip(cache.ticks.windows(2))
            .any(|(v, t)| {
                (0..12).any(|pc| v[1][pc] < v[0][pc] || v[1][pc] - v[0][pc] > (t[1] - t[0]) as f64)
            })
    {
        return Err(error(
            "invalid-input",
            "Source union-support integrals exceed cell duration.",
        ));
    }
    if cache
        .constraints
        .iter()
        .flatten()
        .any(|c| !(0..=4095).contains(&c.core_mask))
    {
        return Err(error(
            "invalid-input",
            "Invalid compatible-state constraint.",
        ));
    }
    let (mut end, mut edges, mut visits) = (0usize, 0usize, 0usize);
    for block in &cache.blocks {
        if block.start != end
            || block.end <= block.start
            || block.end > n
            || block.states.is_empty()
            || block.states.len() > 4096
        {
            return Err(error(
                "invalid-input",
                "Geometry blocks must partition all cells and contain bounded states.",
            ));
        }
        let mut by_quality = vec![0.0; q];
        let mut constant = 0.0;
        for state in &block.states {
            if !(-1..=4095).contains(&state.core_mask)
                || !state.prior_weight.is_finite()
                || state.prior_weight <= 0.0
                || state.prior_weight > 1.0
                || state.operator.is_none() && state.core_mask != -1
            {
                return Err(error(
                    "invalid-input",
                    "Invalid compiled state or prior weight.",
                ));
            }
            match state.quality_index {
                Some(i) if i < q => by_quality[i] += state.prior_weight,
                None => constant += state.prior_weight,
                _ => {
                    return Err(error(
                        "invalid-input",
                        "State quality index is out of range.",
                    ));
                }
            }
        }
        for row in &cache.quality_probabilities[block.start..block.end] {
            let total = constant + row.iter().zip(&by_quality).map(|(p, w)| p * w).sum::<f64>();
            if (total - 1.0).abs() > 1e-8 {
                return Err(error(
                    "invalid-input",
                    "Unmodified full state priors must sum to one, including UNKNOWN.",
                ));
            }
        }
        for start in block.start..block.end {
            let count = (block.end - start).min(l.max_span_cells);
            edges = edges
                .checked_add(count)
                .filter(|&v| v <= l.max_edges)
                .ok_or_else(|| {
                    error(
                        "budget-exceeded",
                        "Candidate edge budget exceeded before scoring.",
                    )
                })?;
            visits = count
                .checked_mul(block.states.len())
                .and_then(|v| visits.checked_add(v))
                .filter(|&v| v <= l.max_derivation_visits)
                .ok_or_else(|| {
                    error(
                        "budget-exceeded",
                        "Latent derivation budget exceeded before scoring.",
                    )
                })?;
        }
        end = block.end;
    }
    if end != n {
        return Err(error(
            "invalid-input",
            "Geometry blocks do not cover the source.",
        ));
    }
    Ok(Admitted {
        cache,
        statistics: Statistics {
            n_cells: n,
            quality_columns: q,
            edges,
            derivation_visits: visits,
        },
    })
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub log_z: f64,
    pub gradient: [f64; 4],
    pub expected_cuts: f64,
}
struct Forward {
    log: Vec<f64>,
    mean: Vec<[f64; 4]>,
}
impl Forward {
    fn new(n: usize) -> Self {
        let mut log = vec![f64::NEG_INFINITY; n + 1];
        log[0] = 0.0;
        Self {
            log,
            mean: vec![[0.0; 4]; n + 1],
        }
    }
    fn add(&mut self, start: usize, end: usize, score: f64, gradient: [f64; 4]) -> Result<()> {
        if self.log[start] == f64::NEG_INFINITY {
            return Ok(());
        }
        let next = finite(self.log[start] + score)?;
        let combined = finite(logadd(self.log[end], next))?;
        let a = (self.log[end] - combined).exp();
        let b = (next - combined).exp();
        for i in 0..4 {
            self.mean[end][i] =
                finite(a * self.mean[end][i] + b * (self.mean[start][i] + gradient[i]))?;
        }
        self.log[end] = combined;
        Ok(())
    }
    fn finish(self, kind: &'static str) -> Result<Summary> {
        let n = self.log.len() - 1;
        if self.log[n] == f64::NEG_INFINITY {
            return Err(error(kind, "No complete compatible source path."));
        }
        Ok(Summary {
            log_z: self.log[n],
            gradient: self.mean[n],
            expected_cuts: -self.mean[n][3],
        })
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChosenSpan {
    pub start: usize,
    pub end: usize,
    pub block: usize,
    pub state: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanPosteriors {
    pub full: Partition,
    pub constrained: Partition,
    pub edge_intervals: Vec<[usize; 2]>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub full: Summary,
    pub constrained: Summary,
    pub loss: f64,
    pub gradient: [f64; 4],
    pub statistics: Statistics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map: Option<Vec<ChosenSpan>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_log_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub posteriors: Option<SpanPosteriors>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_marginals: Option<FullMarginals>,
}

struct ScoredSpan<'a> {
    start: usize,
    end: usize,
    block: usize,
    best: usize,
    log_weight: f64,
    log_compatible: Option<f64>,
    mean: [f64; 3],
    cmean: [f64; 3],
    maximum: f64,
    state_scores: &'a [f64],
}

impl Admitted {
    // One scorer shared by expectation, MAP and full state marginals. No state
    // tensor is retained per edge; all consumers see the same finite scores.
    fn visit_spans(
        &self,
        parameters: [f64; 4],
        mut visit: impl FnMut(ScoredSpan<'_>) -> Result<()>,
    ) -> Result<()> {
        if parameters.iter().any(|x| !x.is_finite()) {
            return Err(error("invalid-input", "Parameters must be finite."));
        }
        let c = &self.cache;
        for (block_index, block) in c.blocks.iter().enumerate() {
            let mut masks: Vec<i16> = block.states.iter().map(|s| s.core_mask).collect();
            masks.sort();
            masks.dedup();
            let mask_indices: Vec<_> = block
                .states
                .iter()
                .map(|s| masks.binary_search(&s.core_mask).unwrap())
                .collect();
            let mut phi = vec![[0.0; 3]; masks.len()];
            let mut state_scores = vec![f64::NEG_INFINITY; block.states.len()];
            let mut admitted = vec![false; block.states.len()];
            for start in block.start..block.end {
                let mut quality_sum = vec![0.0; self.statistics.quality_columns];
                let mut wanted: Option<Constraint> = None;
                let mut conflict = false;
                for end in start + 1..=block.end.min(start + c.limits.max_span_cells) {
                    let cell = end - 1;
                    let cell_duration = (c.ticks[end] - c.ticks[cell]) as f64;
                    for (sum, &p) in quality_sum.iter_mut().zip(&c.quality_probabilities[cell]) {
                        *sum += cell_duration * p;
                    }
                    if let Some(label) = c.constraints[cell] {
                        if let Some(previous) = wanted {
                            match previous.intersection(label) {
                                Some(merged) => wanted = Some(merged),
                                None => conflict = true,
                            }
                        } else {
                            wanted = Some(label);
                        }
                    }
                    let duration = (c.ticks[end] - c.ticks[start]) as f64;
                    let exposure: [f64; 12] = std::array::from_fn(|pc| {
                        (c.support_prefix[end][pc] - c.support_prefix[start][pc]) / c.ppq as f64
                    });
                    let total: f64 = exposure.iter().sum();
                    for (i, &mask) in masks.iter().enumerate() {
                        if mask < 0 {
                            phi[i] = [0.0; 3];
                            continue;
                        }
                        let matched: f64 = (0..12)
                            .filter(|pc| mask & (1 << pc) != 0)
                            .map(|pc| exposure[pc])
                            .sum();
                        phi[i] = [
                            matched,
                            (total - matched).max(0.0),
                            (mask as u16).count_ones() as f64,
                        ];
                    }
                    let (mut maximum, mut compatible_maximum) =
                        (f64::NEG_INFINITY, f64::NEG_INFINITY);
                    let mut best = 0;
                    for (i, state) in block.states.iter().enumerate() {
                        let quality = state
                            .quality_index
                            .map_or(1.0, |q| quality_sum[q] / duration);
                        // Take logs BEFORE multiplying prior factors, so a
                        // positive rare state cannot underflow into rejection.
                        let score = if quality == 0.0 {
                            f64::NEG_INFINITY
                        } else {
                            finite(
                                quality.ln()
                                    + state.prior_weight.ln()
                                    + (0..3)
                                        .map(|j| parameters[j] * phi[mask_indices[i]][j])
                                        .sum::<f64>(),
                            )?
                        };
                        state_scores[i] = score;
                        admitted[i] = !conflict
                            && wanted.is_none_or(|label| {
                                state.core_mask == label.core_mask
                                    && label.operator.is_none_or(|op| state.operator == Some(op))
                            });
                        if score > maximum {
                            maximum = score;
                            best = i;
                        }
                        if admitted[i] {
                            compatible_maximum = compatible_maximum.max(score);
                        }
                    }
                    if maximum == f64::NEG_INFINITY {
                        return Err(error(
                            "numerical-error",
                            "Positive normalized priors vanished.",
                        ));
                    }
                    let (mut z, mut cz) = (0.0, 0.0);
                    let (mut mean, mut cmean) = ([0.0; 3], [0.0; 3]);
                    for (i, &score) in state_scores.iter().enumerate() {
                        if score == f64::NEG_INFINITY {
                            continue;
                        }
                        let w = (score - maximum).exp();
                        z += w;
                        for j in 0..3 {
                            mean[j] += w * phi[mask_indices[i]][j];
                        }
                        if admitted[i] {
                            let w = (score - compatible_maximum).exp();
                            cz += w;
                            for j in 0..3 {
                                cmean[j] += w * phi[mask_indices[i]][j];
                            }
                        }
                    }
                    let log_weight = finite(maximum + z.ln())?;
                    for x in &mut mean {
                        *x /= z;
                    }
                    let log_compatible = if compatible_maximum == f64::NEG_INFINITY {
                        None
                    } else {
                        for x in &mut cmean {
                            *x /= cz;
                        }
                        Some(finite(compatible_maximum + cz.ln())?)
                    };
                    visit(ScoredSpan {
                        start,
                        end,
                        block: block_index,
                        best,
                        log_weight,
                        log_compatible,
                        mean,
                        cmean,
                        maximum,
                        state_scores: &state_scores,
                    })?;
                }
            }
        }
        Ok(())
    }
    pub fn solve(&self, parameters: [f64; 4], posteriors: bool) -> Result<Output> {
        if parameters.iter().any(|x| !x.is_finite()) {
            return Err(error("invalid-input", "Parameters must be finite."));
        }
        let c = &self.cache;
        let n = self.statistics.n_cells;
        let mut full = Forward::new(n);
        let mut constrained = Forward::new(n);
        let mut edges = if posteriors {
            Vec::with_capacity(self.statistics.edges)
        } else {
            vec![]
        };
        let mut choices = if posteriors {
            Vec::with_capacity(self.statistics.edges)
        } else {
            vec![]
        };
        self.visit_spans(parameters, |span| {
            let ScoredSpan {
                start,
                end,
                block,
                best,
                log_weight,
                log_compatible,
                mean,
                cmean,
                maximum,
                ..
            } = span;
            let cut = if start == 0 { 0.0 } else { -1.0 };
            full.add(
                start,
                end,
                finite(log_weight + cut * parameters[3])?,
                [mean[0], mean[1], mean[2], cut],
            )?;
            if let Some(value) = log_compatible {
                constrained.add(
                    start,
                    end,
                    finite(value + cut * parameters[3])?,
                    [cmean[0], cmean[1], cmean[2], cut],
                )?;
            }
            if posteriors {
                let ratio = log_compatible.map(|value| value - log_weight);
                if ratio.is_some_and(|x| x > 1e-8) {
                    return Err(error(
                        "numerical-error",
                        "Compatible mass exceeds full mass.",
                    ));
                }
                edges.push(Edge {
                    start,
                    end,
                    log_weight,
                    log_weight_gradient: mean,
                    log_compatibility: ratio.map(|x| x.min(0.0)),
                    constrained_log_weight_gradient: cmean,
                    map_log_score: Some(maximum),
                });
                choices.push((block, best));
            }
            Ok(())
        })?;
        let full = full.finish("unreachable-full")?;
        let constrained = constrained.finish("unreachable-constrained")?;
        let mut output = Output {
            loss: finite(full.log_z - constrained.log_z)?,
            gradient: std::array::from_fn(|i| full.gradient[i] - constrained.gradient[i]),
            full,
            constrained,
            statistics: self.statistics.clone(),
            map: None,
            map_log_score: None,
            posteriors: None,
            full_marginals: None,
        };
        if posteriors {
            let request = Request {
                n_cells: n,
                lambda: parameters[3],
                edges,
                limits: Limits {
                    max_cells: c.limits.max_cells,
                    max_edges: c.limits.max_edges,
                    max_span_cells: c.limits.max_span_cells,
                },
            };
            let result = solve(&request)?;
            if let Some(map) = result.map {
                output.map_log_score = Some(map.log_score);
                output.map = Some(
                    map.edge_indices
                        .iter()
                        .map(|&i| ChosenSpan {
                            start: request.edges[i].start,
                            end: request.edges[i].end,
                            block: choices[i].0,
                            state: choices[i].1,
                        })
                        .collect(),
                );
            }
            output.posteriors = Some(SpanPosteriors {
                full: result.full,
                constrained: result.constrained,
                edge_intervals: request.edges.iter().map(|e| [e.start, e.end]).collect(),
            });
        }
        Ok(output)
    }
}
