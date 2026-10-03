use super::*;

fn cache() -> Cache {
    let ticks = vec![0, 2, 5, 8];
    let mut support_prefix = vec![[0.0; 12]; 4];
    for i in 0..3 {
        support_prefix[i + 1] = support_prefix[i];
        for pc in [0, if i == 1 { 5 } else { 4 }] {
            support_prefix[i + 1][pc] += (ticks[i + 1] - ticks[i]) as f64;
        }
    }
    Cache {
        ppq: 2,
        ticks,
        support_prefix,
        quality_probabilities: vec![vec![1.0]; 3],
        blocks: vec![Block {
            start: 0,
            end: 3,
            states: vec![
                State {
                    core_mask: 17,
                    quality_index: Some(0),
                    prior_weight: 1.0 / 3.0,
                    operator: Some(0),
                },
                State {
                    core_mask: 33,
                    quality_index: Some(0),
                    prior_weight: 1.0 / 3.0,
                    operator: Some(1),
                },
                State {
                    core_mask: -1,
                    quality_index: Some(0),
                    prior_weight: 1.0 / 3.0,
                    operator: None,
                },
            ],
        }],
        constraints: vec![
            Some(Constraint {
                operator: Some(0),
                core_mask: 17,
            }),
            None,
            Some(Constraint {
                operator: Some(0),
                core_mask: 17,
            }),
        ],
        limits: SpanLimits::default(),
    }
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-9, "{a} != {b}");
}

#[test]
fn source_forward_expectation_matches_edge_backward_and_all_four_finite_differences() {
    let admitted = admit(cache()).unwrap();
    for parameters in [[0.0; 4], [1.2, -0.7, -0.3, 0.5], [-0.6, 0.2, 0.4, -0.3]] {
        let summary = admitted.solve(parameters, false).unwrap();
        let result = admitted.solve(parameters, true).unwrap();
        assert_eq!(summary.full, result.full);
        assert_eq!(summary.constrained, result.constrained);
        let posterior = result.posteriors.unwrap();
        close(summary.full.log_z, posterior.full.log_z);
        close(summary.constrained.log_z, posterior.constrained.log_z);
        for i in 0..4 {
            close(summary.full.gradient[i], posterior.full.gradient[i]);
            close(
                summary.constrained.gradient[i],
                posterior.constrained.gradient[i],
            );
            let mut a = parameters;
            let mut b = parameters;
            a[i] += 1e-5;
            b[i] -= 1e-5;
            let difference = (admitted.solve(a, false).unwrap().loss
                - admitted.solve(b, false).unwrap().loss)
                / 2e-5;
            assert!((difference - summary.gradient[i]).abs() < 1e-8);
        }
        assert!(
            result
                .map
                .unwrap()
                .iter()
                .all(|s| s.state < 3 && s.block == 0 && s.start < s.end)
        );
    }
}

#[test]
fn source_scale_transposition_and_constraint_changes_do_not_change_full_inference() {
    let original = cache();
    let beta = [0.8, -0.2, -0.1, 0.3];
    let before = admit(original.clone()).unwrap().solve(beta, true).unwrap();
    for scale in [3, 480] {
        let mut c = original.clone();
        c.ppq *= scale;
        for t in &mut c.ticks {
            *t *= scale;
        }
        for x in c.support_prefix.iter_mut().flatten() {
            *x *= scale as f64;
        }
        let changed = admit(c).unwrap().solve(beta, false).unwrap();
        close(before.loss, changed.loss);
        for i in 0..4 {
            close(before.gradient[i], changed.gradient[i]);
        }
    }
    for shift in 0..12 {
        let mut c = original.clone();
        for row in &mut c.support_prefix {
            *row = std::array::from_fn(|pc| row[(pc + 12 - shift) % 12]);
        }
        let rotate = |m: i16| {
            if m < 0 {
                m
            } else {
                (((m as u32) << shift) | ((m as u32) >> (12 - shift))) as i16 & 4095
            }
        };
        for s in &mut c.blocks[0].states {
            s.core_mask = rotate(s.core_mask);
        }
        for c in c.constraints.iter_mut().flatten() {
            c.core_mask = rotate(c.core_mask);
        }
        let changed = admit(c).unwrap().solve(beta, false).unwrap();
        close(before.loss, changed.loss);
        for i in 0..4 {
            close(before.gradient[i], changed.gradient[i]);
        }
    }
    let mut c = original;
    c.constraints.fill(None);
    let changed = admit(c).unwrap().solve(beta, true).unwrap();
    assert_eq!(before.full, changed.full);
    assert_eq!(before.map_log_score, changed.map_log_score);
    close(changed.loss, 0.0);
}

#[test]
fn rare_positive_prior_survives_later_cells_and_constrained_logsum_scaling() {
    let c = Cache {
        ppq: 1,
        ticks: vec![0, 1, 2],
        support_prefix: vec![[0.0; 12]; 3],
        quality_probabilities: vec![vec![0.0, 1.0], vec![1.0, 1e-300]],
        blocks: vec![Block {
            start: 0,
            end: 2,
            states: vec![
                State {
                    core_mask: 1,
                    quality_index: Some(0),
                    prior_weight: 1.0,
                    operator: Some(0),
                },
                State {
                    core_mask: 2,
                    quality_index: Some(1),
                    prior_weight: 1.0,
                    operator: Some(1),
                },
            ],
        }],
        constraints: vec![
            Some(Constraint {
                operator: Some(1),
                core_mask: 2
            });
            2
        ],
        limits: SpanLimits {
            max_span_cells: 1,
            ..SpanLimits::default()
        },
    };
    let result = admit(c).unwrap().solve([0.0; 4], true).unwrap();
    close(result.loss, -(1e-300_f64).ln());
    assert!(result.gradient.iter().all(|x| x.is_finite()));
    assert!(
        result
            .posteriors
            .unwrap()
            .constrained
            .cell_coverage
            .iter()
            .all(|x| (*x - 1.0).abs() < 1e-10)
    );
}

#[test]
fn source_budgets_invalid_priors_and_unreachable_constraints_fail_closed() {
    let c = cache();
    let a = admit(c.clone()).unwrap();
    let mut exact = c.clone();
    exact.limits.max_edges = a.statistics.edges;
    exact.limits.max_derivation_visits = a.statistics.derivation_visits;
    assert!(admit(exact.clone()).is_ok());
    exact.limits.max_derivation_visits -= 1;
    assert_eq!(admit(exact).err().unwrap().code, "budget-exceeded");
    let mut invalid = c.clone();
    invalid.ppq = 0;
    assert_eq!(admit(invalid).err().unwrap().code, "invalid-input");
    let mut invalid = c.clone();
    invalid.ppq = 9_007_199_254_740_992;
    assert_eq!(admit(invalid).err().unwrap().code, "invalid-input");
    let mut invalid = c.clone();
    invalid.blocks[0].states[0].prior_weight += 0.1;
    assert_eq!(admit(invalid).err().unwrap().code, "invalid-input");
    let mut invalid = c.clone();
    invalid.blocks[0].end -= 1;
    assert_eq!(admit(invalid).err().unwrap().code, "invalid-input");
    let mut invalid = c.clone();
    invalid.support_prefix[1][0] = 3.0;
    assert_eq!(admit(invalid).err().unwrap().code, "invalid-input");
    let mut impossible = c;
    impossible.constraints[0] = Some(Constraint {
        operator: Some(3),
        core_mask: 4095,
    });
    assert_eq!(
        admit(impossible)
            .unwrap()
            .solve([0.0; 4], false)
            .unwrap_err()
            .code,
        "unreachable-constrained"
    );
}

#[test]
fn real_duration_stretch_scales_exposure_but_not_segment_cardinality_or_prior() {
    let make = |duration, ppq| {
        let mut final_support = [0.0; 12];
        final_support[0] = duration as f64;
        final_support[4] = duration as f64 / 2.0;
        final_support[5] = duration as f64 / 4.0;
        Cache {
            ppq,
            ticks: vec![0, duration],
            support_prefix: vec![[0.0; 12], final_support],
            quality_probabilities: vec![vec![1.0]],
            blocks: vec![Block {
                start: 0,
                end: 1,
                states: vec![State {
                    core_mask: 17,
                    quality_index: Some(0),
                    prior_weight: 1.0,
                    operator: Some(0),
                }],
            }],
            constraints: vec![None],
            limits: SpanLimits::default(),
        }
    };
    let theta = [0.7, -0.3, -0.2, 0.4];
    let source = admit(make(12, 4)).unwrap().solve(theta, true).unwrap();
    close(source.full.gradient[0], 4.5);
    close(source.full.gradient[1], 0.75);
    close(source.full.gradient[2], 2.0);
    close(source.full.gradient[3], 0.0);
    let stretched = admit(make(24, 4)).unwrap().solve(theta, false).unwrap();
    close(stretched.full.gradient[0], 9.0);
    close(stretched.full.gradient[1], 1.5);
    close(stretched.full.gradient[2], 2.0);
    close(
        stretched.full.log_z - source.full.log_z,
        theta[0] * 4.5 + theta[1] * 0.75,
    );
    let rebased = admit(make(36, 12)).unwrap().solve(theta, false).unwrap();
    assert_eq!(source.full, rebased.full);
}

#[test]
fn fixed_core_exposure_is_additive_across_partitions_cardinality_is_not() {
    let mut source = cache();
    source.constraints.fill(None);
    source.blocks[0].states = vec![State {
        core_mask: 17,
        quality_index: Some(0),
        prior_weight: 1.0,
        operator: Some(0),
    }];
    for theta in [[0.0; 4], [0.8, -0.3, -0.5, 1.2]] {
        let result = admit(source.clone()).unwrap().solve(theta, true).unwrap();
        // Eight ticks of C and five of E, divided by PPQ2; three of F outside.
        close(result.full.gradient[0], 6.5);
        close(result.full.gradient[1], 1.5);
        close(
            result.full.gradient[2],
            2.0 * (1.0 + result.full.expected_cuts),
        );
        let posterior = result.posteriors.unwrap();
        for i in 0..4 {
            close(result.full.gradient[i], posterior.full.gradient[i]);
        }
    }
}
