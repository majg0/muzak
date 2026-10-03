use super::*;
use crate::{
    api::{CoreRequest, CoreResponse, dispatch},
    composition::pitch_lattice_degree,
    midi,
    model::Score,
};

fn rendered(plan: &CompositionPlan) -> Score {
    compile_composition(plan, &CompositionLimits::default()).unwrap()
}

#[test]
fn melody_seed_defines_degrees_independently_of_timing_and_lattice_spacing() {
    let original = MelodyLabOptions::default();
    let plan = generate_melody(&original).unwrap();
    assert_eq!(
        serde_json::to_value(&plan).unwrap(),
        serde_json::to_value(generate_melody(&original).unwrap()).unwrap()
    );
    let other = MelodyLabOptions {
        tempo: 83.,
        repeats: 3,
        step: LabStep {
            numerator: 3,
            denominator: 7,
        },
        lattice: PitchLattice {
            id: "unequal-non-octave".into(),
            origin_millicents: 6_912_345,
            intervals: vec![0, 173_219, 600_345],
            period_millicents: 1_901_955,
        },
        ..original.clone()
    };
    let changed = generate_melody(&other).unwrap();
    let degrees = |p: &CompositionPlan, options: &MelodyLabOptions| {
        p.materials[0]
            .notes
            .iter()
            .map(|note| {
                pitch_lattice_degree(note.pitch.millicents, &options.lattice)
                    .unwrap()
                    .unwrap()
            })
            .collect::<Vec<_>>()
    };
    let before = degrees(&plan, &original);
    assert_eq!(before, degrees(&changed, &other));
    assert!(before.iter().all(|degree| {
        (i64::from(original.min_degree)..=i64::from(original.max_degree)).contains(degree)
    }));
    assert!(
        before
            .windows(2)
            .all(|pair| (pair[1] - pair[0]).unsigned_abs() <= u64::from(original.max_step))
    );
    assert_ne!(
        before,
        degrees(
            &generate_melody(&MelodyLabOptions {
                seed: 19,
                ..original.clone()
            })
            .unwrap(),
            &original
        )
    );
    assert_eq!(
        changed.materials[0].notes[1].onset * 7,
        changed.context.ppq * 3
    );
    let score = rendered(&changed);
    assert_eq!(score.notes.len(), usize::from(other.notes * other.repeats));
    assert_eq!(
        score.duration * 7,
        score.ppq * 3 * u64::from(other.notes * other.repeats)
    );
    assert!(
        score
            .attachments
            .iter()
            .all(|attachment| !attachment.bytes.starts_with(&[255, 88]))
    );
}

#[test]
fn melody_repeats_share_material_and_local_edits_still_use_the_existing_compiler() {
    let mut plan = generate_melody(&MelodyLabOptions::default()).unwrap();
    assert_eq!(plan.materials.len(), 1);
    let before = rendered(&plan);
    let span = plan.materials[0].span;
    plan.materials[0].notes[0].pitch.millicents += 100_000;
    plan.placements[1].transpose_millicents = Some(700_000);
    let after = rendered(&plan);
    for (a, b) in before.notes.iter().zip(&after.notes) {
        let shared = if a.onset % span == 0 { 100_000 } else { 0 };
        let local = if a.onset >= span { 700_000 } else { 0 };
        assert_eq!(b.pitch.millicents, a.pitch.millicents + shared + local);
        assert_eq!((a.onset, a.duration), (b.onset, b.duration));
    }
    let mono = generate_melody(&MelodyLabOptions {
        max_step: 0,
        ..Default::default()
    })
    .unwrap();
    assert!(
        mono.materials[0]
            .notes
            .windows(2)
            .all(|pair| pair[0].pitch == pair[1].pitch)
    );
}

#[test]
fn rhythm_counts_spacing_rotation_and_silence_remain_exact() {
    for steps in 1..=32 {
        for pulses in 0..=steps {
            let options = RhythmLabOptions {
                steps,
                pulses,
                repeats: 1,
                rotation: -37,
                ..Default::default()
            };
            let plan = generate_rhythm(&options).unwrap();
            let events = &plan.materials[0].notes;
            assert_eq!(events.len(), usize::from(pulses));
            if pulses > 0 {
                let span = plan.materials[0].span;
                let gaps = events
                    .iter()
                    .enumerate()
                    .map(|(index, event)| {
                        events
                            .get(index + 1)
                            .map_or(events[0].onset + span, |next| next.onset)
                            - event.onset
                    })
                    .collect::<Vec<_>>();
                let step_ticks = options.step.coordinates().unwrap().1;
                assert!((gaps.iter().max().unwrap() - gaps.iter().min().unwrap()) <= step_ticks);
            }
        }
    }
    let base = RhythmLabOptions::default();
    let plan = generate_rhythm(&base).unwrap();
    let rotated = generate_rhythm(&RhythmLabOptions {
        rotation: 1,
        ..base.clone()
    })
    .unwrap();
    assert_eq!(
        plan.materials[0]
            .notes
            .iter()
            .map(|n| n.onset)
            .collect::<Vec<_>>(),
        vec![0, 30, 60]
    );
    assert_eq!(
        rotated.materials[0]
            .notes
            .iter()
            .map(|n| n.onset)
            .collect::<Vec<_>>(),
        vec![10, 40, 70]
    );
    let silence = rendered(&generate_rhythm(&RhythmLabOptions { pulses: 0, ..base }).unwrap());
    assert!(silence.notes.is_empty());
    assert_eq!(silence.duration, 320);
}

#[test]
fn defaults_and_partial_requests_cross_the_api_and_export_without_loss() {
    let response = dispatch(
        serde_json::from_str::<CoreRequest>(r#"{"op":"getLabDefaults","input":{}}"#).unwrap(),
    )
    .unwrap();
    let CoreResponse::GetLabDefaults(defaults) = response else {
        panic!("wrong default response")
    };
    assert_eq!(defaults.melody.seed, 1);
    for request in [
        r#"{"op":"generateMelodyLab","input":{"options":{"seed":17}}}"#,
        r#"{"op":"generateRhythmLab","input":{"options":{"steps":13,"pulses":5,"step":{"numerator":3,"denominator":7}}}}"#,
    ] {
        let result = dispatch(serde_json::from_str::<CoreRequest>(request).unwrap()).unwrap();
        let plan = match result {
            CoreResponse::GenerateMelodyLab(plan) | CoreResponse::GenerateRhythmLab(plan) => plan,
            _ => panic!("wrong generator response"),
        };
        let score = rendered(&plan);
        let midi = midi::export_score_midi(&score).unwrap();
        let imported = midi::import_midi(&midi).unwrap().score;
        assert_eq!(score.ppq, imported.ppq);
        assert_eq!(score.duration, imported.duration);
        let notes = |s: &Score| {
            s.notes
                .iter()
                .map(|n| (n.onset, n.duration, n.pitch, n.velocity))
                .collect::<Vec<_>>()
        };
        assert_eq!(notes(&score), notes(&imported));
    }
}

#[test]
fn malformed_and_unbounded_experiments_fail_instead_of_clamping() {
    for options in [
        MelodyLabOptions {
            tempo: f64::NAN,
            ..Default::default()
        },
        MelodyLabOptions {
            notes: 129,
            ..Default::default()
        },
        MelodyLabOptions {
            repeats: 0,
            ..Default::default()
        },
        MelodyLabOptions {
            max_step: 33,
            ..Default::default()
        },
        MelodyLabOptions {
            first_degree: 10,
            ..Default::default()
        },
        MelodyLabOptions {
            step: LabStep {
                numerator: 1,
                denominator: 0,
            },
            ..Default::default()
        },
        MelodyLabOptions {
            lattice: PitchLattice {
                id: "bad".into(),
                origin_millicents: 0,
                intervals: vec![0, 20, 10],
                period_millicents: 30,
            },
            ..Default::default()
        },
    ] {
        assert!(generate_melody(&options).is_err());
    }
    for options in [
        RhythmLabOptions {
            steps: 0,
            ..Default::default()
        },
        RhythmLabOptions {
            pulses: 9,
            ..Default::default()
        },
        RhythmLabOptions {
            repeats: 17,
            ..Default::default()
        },
        RhythmLabOptions {
            tempo: f64::INFINITY,
            ..Default::default()
        },
        RhythmLabOptions {
            pulses: 0,
            pitch: Pitch {
                millicents: i64::MAX,
            },
            ..Default::default()
        },
    ] {
        assert!(generate_rhythm(&options).is_err());
    }
}
