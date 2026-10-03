//! Full (unconditioned) cell distributions. Constraints never select states here.
use super::*;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JointState {
    pub core_mask: i16,
    pub operator: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginalBlock {
    pub start: usize,
    pub end: usize,
    pub core_masks: Vec<i16>,
    pub core_probabilities: Vec<Vec<f64>>,
    pub joint_states: Vec<JointState>,
    pub joint_probabilities: Vec<Vec<f64>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginalDiagnostics {
    /// Conservative count of probability slots, including difference endpoints.
    pub output_slots: usize,
    pub edges: usize,
    pub max_cell_mass_error: f64,
    pub minimum_difference_roundoff: f64,
    pub renormalized: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullMarginals {
    pub ppq: u64,
    pub blocks: Vec<MarginalBlock>,
    /// Sorted opaque IDs, aligned with the columns of operation_probabilities.
    pub operation_ids: Vec<u32>,
    pub operation_probabilities: Vec<Vec<f64>>,
    /// UNKNOWN core -1 is distinct from known empty core 0. A typed state can
    /// have UNKNOWN realization, so this overlaps the operation distribution.
    pub unknown_probabilities: Vec<f64>,
    /// States without an operation, always UNKNOWN by source admission.
    pub untyped_probabilities: Vec<f64>,
    pub boundary_probabilities: Vec<f64>,
    pub diagnostics: MarginalDiagnostics,
}

struct Layout {
    pairs: Vec<JointState>,
    cores: Vec<i16>,
    groups: Vec<usize>,
}

impl Admitted {
    /// Solve and retain full core/operation distributions on exact source cells.
    /// Work is O(edges * states), with interval differences instead of expanding
    /// every edge over every covered cell. Aliases sum; no threshold or
    /// renormalization discards competing interpretations. The caller-supplied
    /// slot budget (1..=50 million; suggested 4 million) is checked before
    /// posterior solving or probability-array allocation.
    pub fn solve_with_marginals(
        &self,
        parameters: [f64; 4],
        max_output_slots: usize,
    ) -> Result<Output> {
        if !(1..=50_000_000).contains(&max_output_slots) {
            return Err(error(
                "invalid-input",
                "Invalid marginal output-slot budget.",
            ));
        }
        let c = &self.cache;
        let n = self.statistics.n_cells;
        let operation_ids: Vec<_> = c
            .blocks
            .iter()
            .flat_map(|b| b.states.iter())
            .filter_map(|s| s.operator)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let mut slots = 0usize;
        let mut charge = |rows: usize, columns: usize| -> Result<()> {
            slots = rows
                .checked_mul(columns)
                .and_then(|v| slots.checked_add(v))
                .filter(|&v| v <= max_output_slots)
                .ok_or_else(|| error("budget-exceeded", "Marginal output-slot budget exceeded."))?;
            Ok(())
        };
        charge(n + 1, operation_ids.len() + 3)?;
        let mut layouts = Vec::with_capacity(c.blocks.len());
        for block in &c.blocks {
            let pairs: Vec<_> = block
                .states
                .iter()
                .map(|s| JointState {
                    core_mask: s.core_mask,
                    operator: s.operator,
                })
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let cores: Vec<_> = pairs
                .iter()
                .map(|p| p.core_mask)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            charge(block.end - block.start + 1, pairs.len() + cores.len())?;
            let groups = block
                .states
                .iter()
                .map(|s| {
                    pairs
                        .binary_search(&JointState {
                            core_mask: s.core_mask,
                            operator: s.operator,
                        })
                        .unwrap()
                })
                .collect();
            layouts.push(Layout {
                pairs,
                cores,
                groups,
            });
        }
        let mut output = self.solve(parameters, true)?;
        let posterior = &output.posteriors.as_ref().unwrap().full;
        let mut differences: Vec<_> = c
            .blocks
            .iter()
            .zip(&layouts)
            .map(|(b, l)| vec![vec![0.0; l.pairs.len()]; b.end - b.start + 1])
            .collect();
        let mut edge_index = 0;
        self.visit_spans(parameters, |span| {
            let edge_mass = posterior.edge_posteriors[edge_index];
            let layout = &layouts[span.block];
            let block = &c.blocks[span.block];
            // Same softmax arithmetic as the shared scorer. Taking the maximum
            // first preserves rare positive state priors without multiplying them.
            let normalizer: f64 = span
                .state_scores
                .iter()
                .map(|score| (score - span.maximum).exp())
                .sum();
            for (i, &score) in span.state_scores.iter().enumerate() {
                let mass = edge_mass * (score - span.maximum).exp() / normalizer;
                let group = layout.groups[i];
                differences[span.block][span.start - block.start][group] += mass;
                differences[span.block][span.end - block.start][group] -= mass;
            }
            edge_index += 1;
            Ok(())
        })?;
        let mut operations = vec![vec![0.0; operation_ids.len()]; n];
        let mut unknown = vec![0.0; n];
        let mut untyped = vec![0.0; n];
        let mut blocks = Vec::with_capacity(c.blocks.len());
        let (mut max_error, mut minimum) = (0.0_f64, 0.0_f64);
        for ((block, layout), mut values) in c.blocks.iter().zip(layouts).zip(differences) {
            values.pop(); // Difference sentinel, not a source cell.
            let mut running = vec![0.0; layout.pairs.len()];
            let mut core_values = vec![vec![0.0; layout.cores.len()]; values.len()];
            for (row, values) in values.iter_mut().enumerate() {
                for (j, value) in values.iter_mut().enumerate() {
                    running[j] += *value;
                    minimum = minimum.min(running[j]);
                    if running[j] < -1e-9 {
                        return Err(error(
                            "numerical-error",
                            "Negative marginal beyond roundoff.",
                        ));
                    }
                    *value = running[j].max(0.0);
                    let pair = layout.pairs[j];
                    core_values[row][layout.cores.binary_search(&pair.core_mask).unwrap()] +=
                        *value;
                    if pair.core_mask == -1 {
                        unknown[block.start + row] += *value;
                    }
                    match pair.operator {
                        Some(op) => {
                            operations[block.start + row]
                                [operation_ids.binary_search(&op).unwrap()] += *value
                        }
                        None => untyped[block.start + row] += *value,
                    }
                }
                let total: f64 = values.iter().sum();
                max_error = max_error.max((total - 1.0).abs());
                if !total.is_finite()
                    || (total - 1.0).abs() > 1e-8
                    || (total - posterior.cell_coverage[block.start + row]).abs() > 1e-8
                {
                    return Err(error(
                        "numerical-error",
                        "Full cell marginal mass not conserved.",
                    ));
                }
            }
            blocks.push(MarginalBlock {
                start: block.start,
                end: block.end,
                core_masks: layout.cores,
                core_probabilities: core_values,
                joint_states: layout.pairs,
                joint_probabilities: values,
            });
        }
        output.full_marginals = Some(FullMarginals {
            ppq: c.ppq,
            blocks,
            operation_ids,
            operation_probabilities: operations,
            unknown_probabilities: unknown,
            untyped_probabilities: untyped,
            boundary_probabilities: posterior.boundary_posteriors.clone(),
            diagnostics: MarginalDiagnostics {
                output_slots: slots,
                edges: edge_index,
                max_cell_mass_error: max_error,
                minimum_difference_roundoff: minimum,
                renormalized: false,
            },
        });
        Ok(output)
    }
}
