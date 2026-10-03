use super::*;

fn fixture() -> Cache {
    let ticks = vec![0, 2, 5, 9];
    let mut support = vec![[0.0; 12]; 4];
    for i in 0..3 {
        support[i + 1] = support[i];
        for pc in [0, [4, 5, 4][i]] {
            support[i + 1][pc] += (ticks[i + 1] - ticks[i]) as f64;
        }
    }
    Cache {
        ppq: 2,
        ticks,
        support_prefix: support,
        quality_probabilities: vec![vec![1.0]; 3],
        blocks: vec![Block {
            start: 0,
            end: 3,
            states: vec![
                State {
                    core_mask: 17,
                    operator: Some(7),
                    quality_index: Some(0),
                    prior_weight: 0.2,
                },
                State {
                    core_mask: 17,
                    operator: Some(7),
                    quality_index: Some(0),
                    prior_weight: 0.2,
                },
                State {
                    core_mask: 17,
                    operator: Some(u32::MAX),
                    quality_index: Some(0),
                    prior_weight: 0.2,
                },
                State {
                    core_mask: 33,
                    operator: Some(7),
                    quality_index: Some(0),
                    prior_weight: 0.2,
                },
                State {
                    core_mask: -1,
                    operator: None,
                    quality_index: Some(0),
                    prior_weight: 0.2,
                },
            ],
        }],
        constraints: vec![None; 3],
        limits: SpanLimits::default(),
    }
}
fn label(core_mask: i16, operator: Option<u32>) -> Option<Constraint> {
    Some(Constraint {
        core_mask,
        operator,
    })
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10, "{a} != {b}");
}

// Every concrete state assignment of every temporal partition. Compatibility
// is checked against EACH cell directly, not through the implementation's
// intersection or wildcard matcher. Features are recomputed from source sums.
fn paths(
    c: &Cache,
    p: [f64; 4],
    at: usize,
    w: f64,
    features: [f64; 4],
    valid: bool,
    out: &mut Vec<(f64, [f64; 4], bool)>,
) {
    if at == 3 {
        out.push((w, features, valid));
        return;
    }
    for end in at + 1..=3 {
        for state in &c.blocks[0].states {
            let mut phi = [0.0; 4];
            if state.core_mask >= 0 {
                for pc in 0..12 {
                    let exposure =
                        (c.support_prefix[end][pc] - c.support_prefix[at][pc]) / c.ppq as f64;
                    if state.core_mask & (1 << pc) != 0 {
                        phi[0] += exposure;
                    } else {
                        phi[1] += exposure;
                    }
                }
                phi[2] = (state.core_mask as u16).count_ones() as f64;
            }
            phi[3] = if at == 0 { 0.0 } else { -1.0 };
            let compatible = (at..end).all(|i| match c.constraints[i] {
                None => true,
                Some(label) => {
                    label.core_mask == state.core_mask
                        && match label.operator {
                            None => true,
                            Some(op) => state.operator == Some(op),
                        }
                }
            });
            let score: f64 = (0..4).map(|j| phi[j] * p[j]).sum();
            paths(
                c,
                p,
                end,
                w * state.prior_weight * score.exp(),
                std::array::from_fn(|i| features[i] + phi[i]),
                valid && compatible,
                out,
            );
        }
    }
}

#[test]
fn every_partial_intersection_matches_independent_concrete_state_paths() {
    let choices = [
        None,
        label(17, None),
        label(17, Some(7)),
        label(17, Some(u32::MAX)),
        label(33, None),
        label(33, Some(u32::MAX)),
    ];
    for p in [[0.0; 4], [0.8, -0.4, -0.2, 0.7]] {
        let baseline = admit(fixture()).unwrap().solve(p, true).unwrap();
        for a in choices {
            for b in choices {
                for d in choices {
                    let mut c = fixture();
                    c.constraints = vec![a, b, d];
                    let mut all = vec![];
                    paths(&c, p, 0, 1.0, [0.0; 4], true, &mut all);
                    assert_eq!(all.len(), 180);
                    let allowed: Vec<_> = all.iter().filter(|v| v.2).collect();
                    let result = admit(c).unwrap().solve(p, true);
                    if allowed.is_empty() {
                        assert_eq!(result.unwrap_err().code, "unreachable-constrained");
                        continue;
                    }
                    let result = result.unwrap();
                    let z: f64 = allowed.iter().map(|v| v.0).sum();
                    close(result.constrained.log_z, z.ln());
                    for i in 0..4 {
                        close(
                            result.constrained.gradient[i],
                            allowed.iter().map(|v| v.0 * v.1[i]).sum::<f64>() / z,
                        );
                        close(
                            result.constrained.gradient[i],
                            result.posteriors.as_ref().unwrap().constrained.gradient[i],
                        );
                    }
                    assert_eq!(result.full, baseline.full);
                    assert_eq!(
                        result.posteriors.unwrap().full,
                        baseline.posteriors.as_ref().unwrap().full
                    );
                    assert_eq!(
                        serde_json::to_value(result.map).unwrap(),
                        serde_json::to_value(&baseline.map).unwrap()
                    );
                }
            }
        }
    }
}

#[test]
fn partial_loss_gradients_and_full_marginals_are_consistent() {
    for labels in [
        vec![label(17, None), None, label(17, Some(7))],
        vec![label(17, Some(7)), label(17, None), None],
        vec![label(17, None), label(33, None), label(17, Some(u32::MAX))],
        vec![
            label(17, Some(7)),
            label(17, None),
            label(17, Some(u32::MAX)),
        ],
    ] {
        let p = [0.8, -0.4, -0.2, 0.7];
        let mut c = fixture();
        c.constraints = labels;
        let source = admit(c).unwrap();
        let result = source.solve_with_marginals(p, 1000).unwrap();
        assert_eq!(
            source.solve(p, false).unwrap().constrained,
            result.constrained
        );
        for i in 0..4 {
            let mut a = p;
            let mut b = p;
            a[i] += 1e-5;
            b[i] -= 1e-5;
            let fd = (source.solve(a, false).unwrap().loss - source.solve(b, false).unwrap().loss)
                / 2e-5;
            assert!((fd - result.gradient[i]).abs() < 1e-8);
        }
        let baseline = admit(fixture())
            .unwrap()
            .solve_with_marginals(p, 1000)
            .unwrap();
        assert_eq!(
            serde_json::to_value(result.full_marginals).unwrap(),
            serde_json::to_value(baseline.full_marginals).unwrap()
        );
    }
}

#[test]
fn nullable_wire_is_core_only_and_wildcards_never_erase_typed_constraints() {
    let absent: Constraint = serde_json::from_str(r#"{"coreMask":17}"#).unwrap();
    let null: Constraint = serde_json::from_str(r#"{"coreMask":17,"operator":null}"#).unwrap();
    let typed: Constraint = serde_json::from_str(r#"{"coreMask":17,"operator":7}"#).unwrap();
    assert_eq!(absent, null);
    assert_eq!(typed.operator, Some(7));
    assert_eq!(null.intersection(typed), Some(typed));
    assert_eq!(typed.intersection(null), Some(typed));
    assert!(
        typed
            .intersection(Constraint {
                core_mask: 17,
                operator: Some(8)
            })
            .is_none()
    );
    assert!(
        null.intersection(Constraint {
            core_mask: 33,
            operator: None
        })
        .is_none()
    );
    let mut c = fixture();
    c.ticks.truncate(2);
    c.support_prefix.truncate(2);
    c.quality_probabilities.truncate(1);
    c.blocks[0].end = 1;
    c.constraints = vec![Some(null)];
    close(
        admit(c.clone())
            .unwrap()
            .solve([0.0; 4], false)
            .unwrap()
            .constrained
            .log_z,
        0.6_f64.ln(),
    );
    c.constraints[0] = Some(typed);
    close(
        admit(c.clone())
            .unwrap()
            .solve([0.0; 4], false)
            .unwrap()
            .constrained
            .log_z,
        0.4_f64.ln(),
    );
    c.constraints[0] = None;
    close(
        admit(c.clone())
            .unwrap()
            .solve([0.0; 4], false)
            .unwrap()
            .constrained
            .log_z,
        0.0,
    );
    c.constraints[0] = label(-1, None);
    assert_eq!(admit(c).err().unwrap().code, "invalid-input");
}
