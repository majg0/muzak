use super::*;

fn cache() -> Cache {
    let ticks = vec![0, 2, 5, 9];
    let mut prefix = vec![[0.0; 12]; 4];
    for i in 0..3 {
        prefix[i + 1] = prefix[i];
        prefix[i + 1][0] += (ticks[i + 1] - ticks[i]) as f64;
        prefix[i + 1][[4, 5, 7][i]] += (ticks[i + 1] - ticks[i]) as f64;
    }
    Cache {
        ppq: 2,
        ticks,
        support_prefix: prefix,
        quality_probabilities: vec![vec![0.3, 0.7], vec![0.8, 0.2], vec![0.4, 0.6]],
        blocks: vec![Block {
            start: 0,
            end: 3,
            states: vec![
                State {
                    core_mask: 17,
                    quality_index: Some(0),
                    prior_weight: 0.4,
                    operator: Some(7),
                },
                State {
                    core_mask: 17,
                    quality_index: Some(0),
                    prior_weight: 0.4,
                    operator: Some(7),
                },
                State {
                    core_mask: 33,
                    quality_index: Some(1),
                    prior_weight: 0.5,
                    operator: Some(u32::MAX),
                },
                State {
                    core_mask: -1,
                    quality_index: Some(1),
                    prior_weight: 0.3,
                    operator: Some(u32::MAX),
                },
                State {
                    core_mask: -1,
                    quality_index: None,
                    prior_weight: 0.1,
                    operator: None,
                },
                State {
                    core_mask: 0,
                    quality_index: None,
                    prior_weight: 0.1,
                    operator: Some(9),
                },
            ],
        }],
        constraints: vec![None; 3],
        limits: SpanLimits::default(),
    }
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10, "{a} != {b}");
}

// Enumerate concrete path/state assignments directly, without the native span
// scorer, edge posteriors, softmax, or interval difference recurrence.
fn enumerate(
    c: &Cache,
    p: [f64; 4],
    at: usize,
    weight: f64,
    chosen: Vec<(usize, usize, usize)>,
    out: &mut Vec<(f64, Vec<(usize, usize, usize)>)>,
) {
    if at == c.ticks.len() - 1 {
        out.push((weight, chosen));
        return;
    }
    for end in at + 1..c.ticks.len() {
        for (si, state) in c.blocks[0].states.iter().enumerate() {
            let quality = state.quality_index.map_or(1.0, |q| {
                (at..end)
                    .map(|i| c.quality_probabilities[i][q] * (c.ticks[i + 1] - c.ticks[i]) as f64)
                    .sum::<f64>()
                    / (c.ticks[end] - c.ticks[at]) as f64
            });
            let (mut matched, mut extra) = (0.0, 0.0);
            if state.core_mask >= 0 {
                for pc in 0..12 {
                    let exposure =
                        (c.support_prefix[end][pc] - c.support_prefix[at][pc]) / c.ppq as f64;
                    if state.core_mask & (1 << pc) != 0 {
                        matched += exposure;
                    } else {
                        extra += exposure;
                    }
                }
            }
            let cardinality = if state.core_mask < 0 {
                0.0
            } else {
                (state.core_mask as u16).count_ones() as f64
            };
            let factor = quality
                * state.prior_weight
                * (p[0] * matched + p[1] * extra + p[2] * cardinality
                    - if at == 0 { 0.0 } else { p[3] })
                .exp();
            let mut next = chosen.clone();
            next.push((at, end, si));
            enumerate(c, p, end, weight * factor, next, out);
        }
    }
}

#[test]
fn full_joint_marginals_match_all_concrete_paths_and_preserve_aliases_unknown() {
    for p in [[0.0; 4], [0.7, -0.4, -0.2, 0.6]] {
        let c = cache();
        let result = admit(c.clone())
            .unwrap()
            .solve_with_marginals(p, 1000)
            .unwrap();
        let m = result.full_marginals.unwrap();
        assert_eq!(m.operation_ids, [7, 9, u32::MAX]);
        let mut all = vec![];
        enumerate(&c, p, 0, 1.0, vec![], &mut all);
        assert_eq!(all.len(), 294);
        let z: f64 = all.iter().map(|x| x.0).sum();
        close(result.full.log_z, z.ln());
        let b = &m.blocks[0];
        for cell in 0..3 {
            for (j, pair) in b.joint_states.iter().enumerate() {
                let expected = all
                    .iter()
                    .map(|(w, path)| {
                        if path.iter().any(|&(a, b, s)| {
                            a <= cell
                                && cell < b
                                && c.blocks[0].states[s].core_mask == pair.core_mask
                                && c.blocks[0].states[s].operator == pair.operator
                        }) {
                            *w / z
                        } else {
                            0.0
                        }
                    })
                    .sum();
                close(b.joint_probabilities[cell][j], expected);
            }
            let sum_core: f64 = b.core_probabilities[cell].iter().sum();
            close(sum_core, 1.0);
            close(
                m.operation_probabilities[cell].iter().sum::<f64>() + m.untyped_probabilities[cell],
                1.0,
            );
            assert!(m.unknown_probabilities[cell] > m.untyped_probabilities[cell]);
            assert!(b.core_probabilities[cell][b.core_masks.binary_search(&0).unwrap()] > 0.0);
        }
    }
}

#[test]
fn marginals_ignore_constraints_and_exact_budget_rejects_before_solving() {
    let c = cache();
    let a = admit(c.clone())
        .unwrap()
        .solve_with_marginals([0.3, -0.2, 0.1, 0.4], 1000)
        .unwrap();
    let m = a.full_marginals.unwrap();
    let exact = m.diagnostics.output_slots;
    assert!(
        admit(c.clone())
            .unwrap()
            .solve_with_marginals([0.0; 4], exact)
            .is_ok()
    );
    assert_eq!(
        admit(c.clone())
            .unwrap()
            .solve_with_marginals([0.0; 4], exact - 1)
            .unwrap_err()
            .code,
        "budget-exceeded"
    );
    assert_eq!(
        admit(c.clone())
            .unwrap()
            .solve_with_marginals([0.0; 4], 0)
            .unwrap_err()
            .code,
        "invalid-input"
    );
    let mut restricted = c;
    restricted.constraints[1] = Some(Constraint {
        core_mask: 17,
        operator: 7,
    });
    let b = admit(restricted)
        .unwrap()
        .solve_with_marginals([0.3, -0.2, 0.1, 0.4], exact)
        .unwrap();
    assert!(b.loss > a.loss);
    assert_eq!(
        serde_json::to_value(m).unwrap(),
        serde_json::to_value(b.full_marginals.unwrap()).unwrap()
    );
}

#[test]
fn ppq_rebase_and_pitch_rotation_preserve_full_marginal_evidence() {
    let c = cache();
    let p = [0.3, -0.2, 0.1, 0.4];
    let a = admit(c.clone())
        .unwrap()
        .solve_with_marginals(p, 1000)
        .unwrap()
        .full_marginals
        .unwrap();
    let mut d = c;
    d.ppq *= 3;
    for t in &mut d.ticks {
        *t *= 3;
    }
    for row in &mut d.support_prefix {
        for x in row.iter_mut() {
            *x *= 3.0;
        }
        row.rotate_right(2);
    }
    for state in &mut d.blocks[0].states {
        if state.core_mask >= 0 {
            let m = state.core_mask as u16;
            state.core_mask = (((m << 2) | (m >> 10)) & 4095) as i16;
        }
    }
    let b = admit(d)
        .unwrap()
        .solve_with_marginals(p, 1000)
        .unwrap()
        .full_marginals
        .unwrap();
    for (x, y) in a
        .operation_probabilities
        .iter()
        .flatten()
        .zip(b.operation_probabilities.iter().flatten())
    {
        close(*x, *y);
    }
    for (j, s) in a.blocks[0].joint_states.iter().enumerate() {
        let mask = if s.core_mask < 0 {
            -1
        } else {
            let m = s.core_mask as u16;
            (((m << 2) | (m >> 10)) & 4095) as i16
        };
        let k = b.blocks[0]
            .joint_states
            .iter()
            .position(|t| t.core_mask == mask && t.operator == s.operator)
            .unwrap();
        for cell in 0..3 {
            close(
                a.blocks[0].joint_probabilities[cell][j],
                b.blocks[0].joint_probabilities[cell][k],
            );
        }
    }
}

#[test]
fn single_cell_rare_prior_and_empty_source_remain_explicit() {
    let mut c = cache();
    c.ticks.truncate(2);
    c.support_prefix.truncate(2);
    c.quality_probabilities = vec![vec![1e-300, 1.0]];
    c.constraints = vec![None];
    c.blocks[0].end = 1;
    c.blocks[0].states = vec![
        State {
            core_mask: 17,
            quality_index: Some(0),
            prior_weight: 1.0,
            operator: Some(u32::MAX),
        },
        State {
            core_mask: -1,
            quality_index: Some(1),
            prior_weight: 1.0,
            operator: None,
        },
    ];
    let m = admit(c)
        .unwrap()
        .solve_with_marginals([0.0; 4], 100)
        .unwrap()
        .full_marginals
        .unwrap();
    let mass = m.operation_probabilities[0][0];
    assert!(mass > 0.0);
    assert!((mass / 1e-300 - 1.0).abs() < 1e-12);
    let empty = Cache {
        ppq: 1,
        ticks: vec![0],
        support_prefix: vec![[0.0; 12]],
        quality_probabilities: vec![],
        blocks: vec![],
        constraints: vec![],
        limits: SpanLimits::default(),
    };
    let result = admit(empty)
        .unwrap()
        .solve_with_marginals([0.0; 4], 3)
        .unwrap();
    assert_eq!(result.full.log_z, 0.0);
    assert!(result.full_marginals.unwrap().blocks.is_empty());
}
