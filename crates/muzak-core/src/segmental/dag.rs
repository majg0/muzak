//! Small mathematical gate for interval-state DAGs. External edges supply
//! log state sums and their three feature derivatives; the fourth parameter
//! is the cut penalty. Defaults retain the normalized-state control: full
//! boundaries then depend ONLY on graph geometry and the cut prior.
//! Coordinates are cell indices; ticks, PPQ and labels are not inputs.
use crate::error::{CoreError, CoreResult as Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[cfg(test)]
#[path = "state_tests.rs"]
mod state_tests;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edge {
    pub start: usize,
    pub end: usize,
    /// Full unnormalized logsumexp over edge states. Zero is the normalized
    /// state-mass control, not an observation-conditioned segment preference.
    #[serde(default)]
    pub log_weight: f64,
    /// Derivatives of that logsumexp for three fixed physical coefficients.
    #[serde(default)]
    pub log_weight_gradient: [f64; 3],
    /// Log compatible/full state mass ratio, <=0. null rejects the constrained
    /// edge. Negative infinity is accepted by Rust; JSON callers use null.
    pub log_compatibility: Option<f64>,
    /// Derivatives of the TOTAL constrained logsumexp, not of the log ratio.
    #[serde(default)]
    pub constrained_log_weight_gradient: [f64; 3],
    /// Optional best state's unnormalized log potential, not a summed mass.
    /// MAP returns edge indices, so state identity stays with the caller.
    #[serde(default)]
    pub map_log_score: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_cells: usize,
    pub max_edges: usize,
    pub max_span_cells: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_cells: 4096,
            max_edges: 262_144,
            max_span_cells: 64,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub n_cells: usize,
    pub lambda: f64,
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub limits: Limits,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Partition {
    pub log_z: f64,
    pub expected_cuts: f64,
    pub d_log_z_dlambda: f64,
    /// Three state-feature expectations followed by -expectedCuts.
    pub gradient: [f64; 4],
    pub edge_posteriors: Vec<f64>,
    /// Endpoints are certain (1); interior values are cut probabilities.
    pub boundary_posteriors: Vec<f64>,
    /// Each complete path covers every cell exactly once. No renormalization.
    pub cell_coverage: Vec<f64>,
    pub max_coverage_error: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapPath {
    pub edge_indices: Vec<usize>,
    pub log_score: f64,
    pub cuts: usize,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultData {
    pub full: Partition,
    pub constrained: Partition,
    pub loss: f64,
    pub d_loss_dlambda: f64,
    pub gradient: [f64; 4],
    pub map: Option<MapPath>,
}

pub(super) fn error(kind: &'static str, message: &str) -> CoreError {
    CoreError {
        code: kind.into(),
        message: message.into(),
    }
}
pub(super) fn logadd(a: f64, b: f64) -> f64 {
    if a == f64::NEG_INFINITY {
        return b;
    }
    if b == f64::NEG_INFINITY {
        return a;
    }
    let high = a.max(b);
    high + (a.min(b) - high).exp().ln_1p()
}
pub(super) fn finite(value: f64) -> Result<f64> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(error(
            "numerical-error",
            "Finite graph scores overflowed f64 arithmetic.",
        ))
    }
}
fn valid_log_probability(value: Option<f64>) -> bool {
    value.is_none_or(|x| !x.is_nan() && x <= 0.0)
}
fn score(edge: &Edge, lambda: f64, constrained: bool) -> Result<Option<f64>> {
    let value = if constrained {
        match edge.log_compatibility {
            Some(x) if x != f64::NEG_INFINITY => x,
            _ => return Ok(None),
        }
    } else {
        0.0
    };
    finite(edge.log_weight + value - if edge.start == 0 { 0.0 } else { lambda }).map(Some)
}

fn partition(request: &Request, outgoing: &[Vec<usize>], constrained: bool) -> Result<Partition> {
    let n = request.n_cells;
    let mut forward = vec![f64::NEG_INFINITY; n + 1];
    forward[0] = 0.0;
    for start in 0..n {
        if forward[start] == f64::NEG_INFINITY {
            continue;
        }
        for &index in &outgoing[start] {
            let edge = &request.edges[index];
            if let Some(weight) = score(edge, request.lambda, constrained)? {
                let candidate = finite(forward[start] + weight)?;
                forward[edge.end] = finite(logadd(forward[edge.end], candidate))?;
            }
        }
    }
    let log_z = forward[n];
    if log_z == f64::NEG_INFINITY {
        return Err(error(
            if constrained {
                "unreachable-constrained"
            } else {
                "unreachable-full"
            },
            "The supplied graph has no complete path from 0 to nCells.",
        ));
    }
    let mut backward = vec![f64::NEG_INFINITY; n + 1];
    backward[n] = 0.0;
    for start in (0..n).rev() {
        for &index in &outgoing[start] {
            let edge = &request.edges[index];
            if backward[edge.end] == f64::NEG_INFINITY {
                continue;
            }
            if let Some(weight) = score(edge, request.lambda, constrained)? {
                let candidate = finite(weight + backward[edge.end])?;
                backward[start] = finite(logadd(backward[start], candidate))?;
            }
        }
    }
    let mut edge_posteriors = vec![0.0; request.edges.len()];
    let mut boundary_posteriors = vec![0.0; n + 1];
    boundary_posteriors[0] = 1.0;
    boundary_posteriors[n] = 1.0;
    let mut coverage_delta = vec![0.0; n + 1];
    let mut expected_cuts = 0.0;
    let mut gradient = [0.0; 4];
    for (index, edge) in request.edges.iter().enumerate() {
        if forward[edge.start] == f64::NEG_INFINITY || backward[edge.end] == f64::NEG_INFINITY {
            continue;
        }
        let Some(weight) = score(edge, request.lambda, constrained)? else {
            continue;
        };
        let log_p = finite(forward[edge.start] + weight + backward[edge.end] - log_z)?;
        // Only protect against tiny positive log probabilities from roundoff;
        // do not renormalize edge, cell or boundary probabilities.
        if log_p > 1e-8 {
            return Err(error(
                "numerical-error",
                "Forward/backward probability exceeded one.",
            ));
        }
        let p = log_p.min(0.0).exp();
        let features = if constrained {
            edge.constrained_log_weight_gradient
        } else {
            edge.log_weight_gradient
        };
        for i in 0..3 {
            gradient[i] = finite(gradient[i] + p * features[i])?;
        }
        edge_posteriors[index] = p;
        coverage_delta[edge.start] += p;
        coverage_delta[edge.end] -= p;
        if edge.start > 0 {
            expected_cuts += p;
            boundary_posteriors[edge.start] += p;
        }
    }
    let mut cell_coverage = Vec::with_capacity(n);
    let (mut coverage, mut max_coverage_error) = (0.0_f64, 0.0_f64);
    for delta in coverage_delta.iter().take(n) {
        coverage += delta;
        max_coverage_error = max_coverage_error.max((coverage - 1.0).abs());
        cell_coverage.push(coverage);
    }
    if max_coverage_error > 1e-8 {
        return Err(error(
            "numerical-error",
            "Edge posteriors failed complete-path cell coverage.",
        ));
    }
    gradient[3] = -expected_cuts;
    Ok(Partition {
        log_z,
        expected_cuts,
        d_log_z_dlambda: -expected_cuts,
        gradient,
        edge_posteriors,
        boundary_posteriors,
        cell_coverage,
        max_coverage_error,
    })
}

fn map_path(request: &Request, outgoing: &[Vec<usize>]) -> Result<Option<MapPath>> {
    if !request.edges.iter().any(|e| e.map_log_score.is_some()) {
        return Ok(None);
    }
    let mut best = vec![f64::NEG_INFINITY; request.n_cells + 1];
    let mut previous = vec![None; request.n_cells + 1];
    best[0] = 0.0;
    for start in 0..request.n_cells {
        if best[start] == f64::NEG_INFINITY {
            continue;
        }
        for &index in &outgoing[start] {
            let edge = &request.edges[index];
            let Some(state) = edge.map_log_score.filter(|&x| x != f64::NEG_INFINITY) else {
                continue;
            };
            let candidate =
                finite(best[start] + state - if start == 0 { 0.0 } else { request.lambda })?;
            if candidate > best[edge.end] {
                best[edge.end] = candidate;
                previous[edge.end] = Some(index);
            }
        }
    }
    if best[request.n_cells] == f64::NEG_INFINITY {
        return Err(error(
            "unreachable-map",
            "Supplied MAP state scores have no complete path.",
        ));
    }
    let mut end = request.n_cells;
    let mut indices = vec![];
    while end > 0 {
        let index = previous[end].expect("A reachable MAP node has a predecessor");
        indices.push(index);
        end = request.edges[index].start;
    }
    indices.reverse();
    Ok(Some(MapPath {
        cuts: indices.len().saturating_sub(1),
        edge_indices: indices,
        log_score: best[request.n_cells],
    }))
}

pub fn solve(request: &Request) -> Result<ResultData> {
    let l = &request.limits;
    if l.max_cells == 0
        || l.max_cells > 1_000_000
        || l.max_edges == 0
        || l.max_edges > 2_000_000
        || l.max_span_cells == 0
        || l.max_span_cells > 1_000_000
        || !request.lambda.is_finite()
    {
        return Err(error(
            "invalid-input",
            "Invalid finite cut parameter or hard limits.",
        ));
    }
    if request.n_cells > l.max_cells || request.edges.len() > l.max_edges {
        return Err(error(
            "budget-exceeded",
            "Cell/edge admission budget exceeded; graph was not truncated.",
        ));
    }
    let mut intervals = HashSet::with_capacity(request.edges.len());
    // Validate before allocating vertex adjacency arrays.
    for edge in &request.edges {
        if edge.start >= edge.end
            || edge.end > request.n_cells
            || !valid_log_probability(edge.log_compatibility)
            || edge
                .map_log_score
                .is_some_and(|x| x.is_nan() || x == f64::INFINITY)
            || !edge.log_weight.is_finite()
            || edge
                .log_weight_gradient
                .iter()
                .chain(&edge.constrained_log_weight_gradient)
                .any(|x| !x.is_finite())
        {
            return Err(error(
                "invalid-input",
                "Invalid interval, nonpositive compatibility ratio or finite edge score/gradient.",
            ));
        }
        if edge.end - edge.start > l.max_span_cells {
            return Err(error(
                "budget-exceeded",
                "Span-cell budget exceeded; graph was not truncated.",
            ));
        }
        if !intervals.insert((edge.start, edge.end)) {
            return Err(error(
                "invalid-input",
                "Duplicate intervals would add unintended prior mass; aggregate states within one edge.",
            ));
        }
    }
    let mut outgoing = vec![vec![]; request.n_cells + 1];
    for (index, edge) in request.edges.iter().enumerate() {
        outgoing[edge.start].push(index);
    }
    let full = partition(request, &outgoing, false)?;
    let constrained = partition(request, &outgoing, true)?;
    let result = ResultData {
        loss: finite(full.log_z - constrained.log_z)?,
        d_loss_dlambda: constrained.expected_cuts - full.expected_cuts,
        gradient: std::array::from_fn(|i| full.gradient[i] - constrained.gradient[i]),
        map: map_path(request, &outgoing)?,
        full,
        constrained,
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(n: usize, lambda: f64) -> Request {
        let edges = (0..n)
            .flat_map(|a| {
                (a + 1..=n).map(move |b| Edge {
                    start: a,
                    end: b,
                    log_weight: 0.0,
                    log_weight_gradient: [0.0; 3],
                    constrained_log_weight_gradient: [0.0; 3],
                    log_compatibility: if b > a + 1 && (a + b) % 3 == 0 {
                        None
                    } else {
                        Some((0.2 + 0.1 * ((a * 3 + b) % 7) as f64).ln())
                    },
                    map_log_score: Some((0.1 + 0.07 * ((a + b * 3) % 11) as f64).ln()),
                })
            })
            .collect();
        Request {
            n_cells: n,
            lambda,
            edges,
            limits: Limits::default(),
        }
    }
    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-10, "{a} != {b}");
    }

    // Independent recursion enumerates complete paths. It uses ordinary
    // probability products/sums, never the kernel's logadd/DP recurrences.
    fn paths(r: &Request, at: usize, path: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if at == r.n_cells {
            out.push(path.clone());
            return;
        }
        for (i, e) in r.edges.iter().enumerate().filter(|(_, e)| e.start == at) {
            path.push(i);
            paths(r, e.end, path, out);
            path.pop();
        }
    }
    fn oracle(r: &Request, all: &[Vec<usize>], constrained: bool) -> Partition {
        let weights: Vec<_> = all
            .iter()
            .map(|path| {
                (-r.lambda * path.len().saturating_sub(1) as f64).exp()
                    * if constrained {
                        path.iter()
                            .map(|&i| r.edges[i].log_compatibility.map_or(0.0, f64::exp))
                            .product()
                    } else {
                        1.0
                    }
            })
            .collect();
        let z: f64 = weights.iter().sum();
        let mut edge = vec![0.0; r.edges.len()];
        let mut boundary = vec![0.0; r.n_cells + 1];
        let mut coverage = vec![0.0; r.n_cells];
        let mut cuts = 0.0;
        for (path, &weight) in all.iter().zip(&weights) {
            let p = weight / z;
            cuts += p * path.len().saturating_sub(1) as f64;
            boundary[r.n_cells] += p;
            for &i in path {
                edge[i] += p;
                let e = &r.edges[i];
                boundary[e.start] += p;
                for x in &mut coverage[e.start..e.end] {
                    *x += p;
                }
            }
        }
        if r.n_cells == 0 {
            boundary[0] = 1.0;
        }
        Partition {
            log_z: z.ln(),
            expected_cuts: cuts,
            d_log_z_dlambda: -cuts,
            gradient: [0.0, 0.0, 0.0, -cuts],
            edge_posteriors: edge,
            boundary_posteriors: boundary,
            cell_coverage: coverage,
            max_coverage_error: 0.0,
        }
    }
    #[test]
    fn exhaustive_partitions_gradients_posteriors_and_map_match() {
        for n in 1..=7 {
            for lambda in [-2.0, 0.0, 0.7, 3.0] {
                let r = graph(n, lambda);
                let actual = solve(&r).unwrap();
                let mut all = vec![];
                paths(&r, 0, &mut vec![], &mut all);
                assert_eq!(all.len(), 1 << (n - 1));
                for (constrained, actual) in [(false, &actual.full), (true, &actual.constrained)] {
                    let expected = oracle(&r, &all, constrained);
                    close(actual.log_z, expected.log_z);
                    close(actual.d_log_z_dlambda, expected.d_log_z_dlambda);
                    for (a, b) in actual.edge_posteriors.iter().zip(expected.edge_posteriors) {
                        close(*a, b);
                    }
                    for (a, b) in actual
                        .boundary_posteriors
                        .iter()
                        .zip(expected.boundary_posteriors)
                    {
                        close(*a, b);
                    }
                    for (a, b) in actual.cell_coverage.iter().zip(expected.cell_coverage) {
                        close(*a, b);
                        close(*a, 1.0);
                    }
                }
                let mut plus = r.clone();
                plus.lambda += 1e-5;
                let mut minus = r.clone();
                minus.lambda -= 1e-5;
                let numeric = (solve(&plus).unwrap().loss - solve(&minus).unwrap().loss) / 2e-5;
                assert!((numeric - actual.d_loss_dlambda).abs() < 1e-8);
                let map_score = |path: &Vec<usize>| {
                    path.iter()
                        .map(|&i| r.edges[i].map_log_score.unwrap())
                        .sum::<f64>()
                        - lambda * path.len().saturating_sub(1) as f64
                };
                let best = all.iter().map(map_score).fold(f64::NEG_INFINITY, f64::max);
                let map = actual.map.unwrap();
                close(map.log_score, best);
                close(map.log_score, map_score(&map.edge_indices));
                assert!(all.contains(&map.edge_indices));
                assert_eq!(map.cuts, map.edge_indices.len() - 1);
            }
        }
    }
    #[test]
    fn normalized_full_mass_has_closed_form_and_is_compatibility_independent() {
        let mut r = graph(6, 0.4);
        let a = solve(&r).unwrap();
        close(a.full.log_z, 5.0 * (1.0 + (-r.lambda).exp()).ln());
        close(a.full.expected_cuts, 5.0 / (1.0 + r.lambda.exp()));
        for e in &mut r.edges {
            e.log_compatibility = Some(0.0);
        }
        let b = solve(&r).unwrap();
        assert_eq!(a.full, b.full);
        assert_eq!(b.full, b.constrained);
        assert_eq!(b.loss, 0.0);
        assert_eq!(b.d_loss_dlambda, 0.0);
    }
    #[test]
    fn rejected_edges_are_zero_mass_and_unreachable_is_an_error() {
        let mut r = graph(3, 0.2);
        let a = solve(&r).unwrap();
        for (e, p) in r.edges.iter().zip(a.constrained.edge_posteriors) {
            if e.log_compatibility.is_none() {
                assert_eq!(p, 0.0);
            }
        }
        for e in &mut r.edges {
            e.log_compatibility = None;
        }
        assert_eq!(solve(&r).unwrap_err().code, "unreachable-constrained");
        for e in &mut r.edges {
            e.log_compatibility = Some(f64::NEG_INFINITY);
        }
        assert_eq!(solve(&r).unwrap_err().code, "unreachable-constrained");
        r.edges.clear();
        assert_eq!(solve(&r).unwrap_err().code, "unreachable-full");
        let mut r = graph(3, 0.2);
        for e in &mut r.edges {
            e.map_log_score = None;
        }
        assert!(solve(&r).unwrap().map.is_none());
        r.edges[0].map_log_score = Some(-0.2);
        assert_eq!(solve(&r).unwrap_err().code, "unreachable-map");
    }
    #[test]
    fn empty_graph_and_exact_budgets_are_explicit() {
        let r = graph(0, 0.7);
        let value = solve(&r).unwrap();
        assert_eq!(value.loss, 0.0);
        assert_eq!(value.full.boundary_posteriors, [1.0]);
        assert_eq!(value.full.expected_cuts, 0.0);
        let mut r = graph(4, 0.2);
        r.limits = Limits {
            max_cells: 4,
            max_edges: r.edges.len(),
            max_span_cells: 4,
        };
        assert!(solve(&r).is_ok());
        for which in 0..3 {
            let mut b = r.clone();
            match which {
                0 => b.limits.max_cells -= 1,
                1 => b.limits.max_edges -= 1,
                _ => b.limits.max_span_cells -= 1,
            }
            assert_eq!(solve(&b).unwrap_err().code, "budget-exceeded");
        }
    }
    #[test]
    fn invalid_graphs_do_not_add_hidden_prior_mass_or_nonfinite_values() {
        let original = graph(3, 0.2);
        for which in 0..7 {
            let mut r = original.clone();
            match which {
                0 => r.edges.push(r.edges[0].clone()),
                1 => r.edges[0].end = r.edges[0].start,
                2 => r.edges[0].end = r.n_cells + 1,
                3 => r.edges[0].log_compatibility = Some(0.01),
                4 => r.edges[0].log_compatibility = Some(f64::NAN),
                5 => r.edges[0].map_log_score = Some(f64::INFINITY),
                _ => r.lambda = f64::NAN,
            }
            assert_eq!(solve(&r).unwrap_err().code, "invalid-input");
        }
        let mut overflow = graph(4, -f64::MAX);
        overflow.edges.retain(|e| e.end == e.start + 1);
        assert_eq!(solve(&overflow).unwrap_err().code, "numerical-error");
    }
    #[test]
    fn physical_ppq_scale_never_enters_graph_scores() {
        fn from_ticks(ticks: &[u64]) -> Request {
            let mut r = graph(ticks.len() - 1, 0.8);
            // Caller identifies the same intervals on an independently scaled
            // source timeline. The kernel accepts indices, not those ticks.
            for e in &mut r.edges {
                let a = ticks[e.start];
                let b = ticks[e.end];
                e.start = ticks.iter().position(|&t| t == a).unwrap();
                e.end = ticks.iter().position(|&t| t == b).unwrap();
            }
            r
        }
        let ticks = [0, 3, 11, 15, 31];
        let baseline = solve(&from_ticks(&ticks)).unwrap();
        for scale in [2, 7, 480] {
            assert_eq!(
                baseline,
                solve(&from_ticks(&ticks.map(|t| t * scale))).unwrap()
            );
        }
        assert!(
            serde_json::from_str::<Request>(r#"{"nCells":0,"lambda":0,"edges":[],"ppq":480}"#)
                .is_err()
        );
    }
}
