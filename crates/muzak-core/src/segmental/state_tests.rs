use super::*;

fn states(e: &Edge) -> Vec<([f64; 3], f64, bool)> {
    (0..4)
        .map(|s| {
            (
                [
                    ((e.start + s) % 3) as f64 * 0.3 * (e.end - e.start) as f64,
                    ((e.end + s * 2) % 4) as f64 * 0.2 * (e.end - e.start) as f64,
                    (s % 2 + 2) as f64,
                ],
                0.25,
                (e.start + e.end + s) % 4 != 0,
            )
        })
        .collect()
}
fn request(parameters: [f64; 4]) -> Request {
    let edges = (0..4)
        .flat_map(|start| {
            (start + 1..=4).map(move |end| Edge {
                start,
                end,
                log_weight: 0.0,
                log_weight_gradient: [0.0; 3],
                log_compatibility: None,
                constrained_log_weight_gradient: [0.0; 3],
                map_log_score: None,
            })
        })
        .map(|mut e| {
            let rows: Vec<_> = states(&e)
                .into_iter()
                .map(|(phi, prior, allowed)| {
                    let weight = prior * (0..3).map(|i| phi[i] * parameters[i]).sum::<f64>().exp();
                    (phi, weight, allowed)
                })
                .collect();
            let full: f64 = rows.iter().map(|r| r.1).sum();
            let compatible: f64 = rows.iter().filter(|r| r.2).map(|r| r.1).sum();
            e.log_weight = full.ln();
            e.log_compatibility = Some((compatible / full).ln());
            e.log_weight_gradient =
                std::array::from_fn(|i| rows.iter().map(|r| r.0[i] * r.1).sum::<f64>() / full);
            e.constrained_log_weight_gradient = std::array::from_fn(|i| {
                rows.iter()
                    .filter(|r| r.2)
                    .map(|r| r.0[i] * r.1)
                    .sum::<f64>()
                    / compatible
            });
            e.map_log_score = Some(
                rows.iter()
                    .map(|r| r.1.ln())
                    .fold(f64::NEG_INFINITY, f64::max),
            );
            e
        })
        .collect();
    Request {
        n_cells: 4,
        lambda: parameters[3],
        edges,
        limits: Limits::default(),
    }
}

// Enumerate every concrete state assignment of every partition. This does not
// use the solver's log-sum recurrence or its supplied derivative arrays.
fn enumerate(
    r: &Request,
    at: usize,
    parameters: [f64; 4],
    weight: f64,
    phi: [f64; 4],
    compatible: bool,
    out: &mut Vec<(f64, [f64; 4], bool)>,
) {
    if at == r.n_cells {
        out.push((weight, phi, compatible));
        return;
    }
    for e in r.edges.iter().filter(|e| e.start == at) {
        for (features, prior, allowed) in states(e) {
            let cut = if at == 0 { 0.0 } else { -1.0 };
            let score =
                (0..3).map(|i| parameters[i] * features[i]).sum::<f64>() + cut * parameters[3];
            let mut sum = phi;
            for i in 0..3 {
                sum[i] += features[i];
            }
            sum[3] += cut;
            enumerate(
                r,
                e.end,
                parameters,
                weight * prior * score.exp(),
                sum,
                compatible && allowed,
                out,
            );
        }
    }
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10, "{a} != {b}");
}

#[test]
fn all_four_unnormalized_gradients_match_enumerated_state_paths() {
    for parameters in [[0.0; 4], [0.7, -0.4, 0.2, 0.6], [-0.2, 0.5, -0.7, -0.3]] {
        let r = request(parameters);
        let result = solve(&r).unwrap();
        let mut all = vec![];
        enumerate(&r, 0, parameters, 1.0, [0.0; 4], true, &mut all);
        assert_eq!(all.len(), 500);
        for (restricted, actual) in [(false, &result.full), (true, &result.constrained)] {
            let admitted: Vec<_> = all.iter().filter(|r| !restricted || r.2).collect();
            let z: f64 = admitted.iter().map(|r| r.0).sum();
            close(actual.log_z, z.ln());
            for i in 0..4 {
                close(
                    actual.gradient[i],
                    admitted.iter().map(|r| r.0 * r.1[i]).sum::<f64>() / z,
                );
            }
        }
        close(
            result.map.unwrap().log_score,
            all.iter()
                .map(|r| r.0.ln())
                .fold(f64::NEG_INFINITY, f64::max),
        );
        for i in 0..4 {
            let mut a = parameters;
            let mut b = parameters;
            a[i] += 1e-5;
            b[i] -= 1e-5;
            let difference =
                (solve(&request(a)).unwrap().loss - solve(&request(b)).unwrap().loss) / 2e-5;
            assert!((difference - result.gradient[i]).abs() < 1e-8);
        }
    }
}
