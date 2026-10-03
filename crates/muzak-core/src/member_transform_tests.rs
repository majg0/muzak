use super::*;

fn options() -> MemberTransformOptions {
    MemberTransformOptions {
        max_changed_members: 2,
        contextual_steps: vec![-1, 1],
        chromatic_offsets: vec![-100_000, 100_000],
        limits: Default::default(),
    }
}
fn parent() -> CompositionHarmony {
    CompositionHarmony {
        id: "parent".into(),
        root_millicents: 0,
        intervals: vec![0, 400_000, 700_000],
    }
}
fn domain() -> PitchLattice {
    PitchLattice {
        id: "domain".into(),
        origin_millicents: 0,
        period_millicents: 1_200_000,
        intervals: vec![0, 200_000, 400_000, 500_000, 700_000, 900_000, 1_100_000],
    }
}
fn find(out: &MemberTransformInventory, edits: &[(usize, MemberTransform)]) -> usize {
    out.programs
        .iter()
        .position(|p| {
            out.patterns[p.pattern_index]
                .transforms
                .iter()
                .enumerate()
                .all(|(i, t)| {
                    *t == edits
                        .iter()
                        .find(|(j, _)| *j == i)
                        .map(|(_, t)| *t)
                        .unwrap_or(MemberTransform::Keep)
                })
        })
        .unwrap()
}

#[test]
fn complete_patterns_and_domain_free_choices() {
    let mut h4 = parent();
    h4.intervals.push(1_000_000);
    let out = enumerate_member_transforms(&[parent(), h4], &[domain()], &options()).unwrap();
    assert_eq!(out.patterns.len(), 174);
    let free = out
        .programs
        .iter()
        .filter(|p| p.domain_index.is_none())
        .count();
    assert_eq!(free, 19 + 33);
    let mut other = domain();
    other.intervals[3] = 600_000;
    let two = enumerate_member_transforms(&[parent()], &[domain(), other], &options()).unwrap();
    assert_eq!(
        two.programs
            .iter()
            .filter(|p| p.domain_index.is_none())
            .count(),
        19
    );
    let unknown = enumerate_member_transforms(&[parent()], &[], &options()).unwrap();
    assert_eq!(unknown.programs.len(), 19);
    assert!(unknown.programs.iter().all(|p| p.domain_index.is_none()));
}

#[test]
fn equal_present_values_keep_distinct_edit_semantics() {
    let out = enumerate_member_transforms(&[parent()], &[domain()], &options()).unwrap();
    let step = find(&out, &[(1, MemberTransform::Contextual { steps: 1 })]);
    let fixed = find(
        &out,
        &[(
            1,
            MemberTransform::Chromatic {
                millicents: 100_000,
            },
        )],
    );
    assert_eq!(out.programs[step].pitches, out.programs[fixed].pitches);
    let notes = neutral_notes(3);
    let mut lydian = domain();
    lydian.intervals[3] = 600_000;
    let render = |index, h, d| {
        resolve_material_pitches(&notes, &out.bindings_for(index).unwrap(), &[h], &[d]).unwrap()
    };
    assert_eq!(render(step, parent(), lydian.clone())[1], 600_000);
    assert_eq!(render(fixed, parent(), lydian)[1], 500_000);
    let mut f = parent();
    f.root_millicents = 500_000;
    assert_eq!(render(step, f.clone(), domain())[1], 1_100_000);
    assert_eq!(render(fixed, f, domain())[1], 1_000_000);
}

#[test]
fn arbitrary_period_offsets_origin_and_independent_context_ids() {
    let h = CompositionHarmony {
        id: "native-parent".into(),
        root_millicents: 101,
        intervals: vec![0, 151, 500],
    };
    let d = PitchLattice {
        id: "native-domain".into(),
        origin_millicents: 101,
        period_millicents: 997,
        intervals: vec![0, 151, 500, 800],
    };
    let o = MemberTransformOptions {
        chromatic_offsets: vec![-13, 13],
        ..options()
    };
    let out = enumerate_member_transforms(&[h.clone()], &[d.clone()], &o).unwrap();
    let i = find(
        &out,
        &[
            (0, MemberTransform::Contextual { steps: -1 }),
            (2, MemberTransform::Chromatic { millicents: 13 }),
        ],
    );
    assert_eq!(out.programs[i].pitches, vec![-96, 252, 614]);
    assert_eq!(
        resolve_material_pitches(
            &neutral_notes(3),
            &out.bindings_for(i).unwrap(),
            &[h.clone()],
            &[d.clone()]
        )
        .unwrap(),
        out.programs[i].pitches
    );
    let mut shifted = h.clone();
    shifted.root_millicents += 17;
    let mut shifted_domain = d.clone();
    shifted_domain.origin_millicents += 17;
    assert_eq!(
        resolve_material_pitches(
            &neutral_notes(3),
            &out.bindings_for(i).unwrap(),
            &[shifted],
            &[shifted_domain]
        )
        .unwrap(),
        vec![-79, 269, 631]
    );
    let mut independent = h.clone();
    independent.id = "other-parent".into();
    let both = enumerate_member_transforms(&[h.clone(), independent], &[d.clone()], &o).unwrap();
    assert_eq!(both.programs.len(), out.programs.len() * 2);
    assert!(enumerate_member_transforms(&[h.clone(), h], &[d.clone()], &o).is_err());
    assert!(enumerate_member_transforms(&[parent()], &[d.clone(), d], &o).is_err());
}

#[test]
fn exact_budgets_and_invalid_context_fail_whole_call() {
    let out = enumerate_member_transforms(&[parent()], &[domain()], &options()).unwrap();
    let mut o = options();
    o.limits.max_context_members = out.work.context_members;
    o.limits.max_patterns = out.patterns.len();
    o.limits.max_candidate_checks = out.work.candidate_checks;
    o.limits.max_programs = out.programs.len();
    o.limits.max_output_members = out.work.output_members;
    enumerate_member_transforms(&[parent()], &[domain()], &o).unwrap();
    for which in 0..5 {
        let mut less = o.clone();
        match which {
            0 => less.limits.max_context_members -= 1,
            1 => less.limits.max_patterns -= 1,
            2 => less.limits.max_candidate_checks -= 1,
            3 => less.limits.max_programs -= 1,
            _ => less.limits.max_output_members -= 1,
        }
        assert_eq!(
            enumerate_member_transforms(&[parent()], &[domain()], &less)
                .unwrap_err()
                .code,
            "budget-exceeded"
        );
    }
    let mut malformed = domain();
    malformed.intervals[0] = 1;
    assert!(enumerate_member_transforms(&[parent()], &[malformed], &options()).is_err());
    let mut unsafe_parent = parent();
    unsafe_parent.root_millicents = MAX_SAFE as i64;
    assert!(enumerate_member_transforms(&[unsafe_parent], &[], &options()).is_err());
    let mut malformed = options();
    malformed.contextual_steps = vec![1, 1];
    assert!(enumerate_member_transforms(&[parent()], &[], &malformed).is_err());
    malformed = options();
    malformed.limits.max_patterns = 0;
    assert!(enumerate_member_transforms(&[parent()], &[], &malformed).is_err());
}

#[test]
fn root_and_seventh_edits_preserve_event_curves_and_routing() {
    use crate::composition::{CompositionPlan, compile_composition};
    use serde_json::json;
    let mut h = parent();
    h.intervals = vec![0, 300_000, 700_000, 1_000_000];
    let out = enumerate_member_transforms(&[h.clone()], &[domain()], &options()).unwrap();
    let i = find(
        &out,
        &[
            (0, MemberTransform::Contextual { steps: 1 }),
            (
                3,
                MemberTransform::Chromatic {
                    millicents: 100_000,
                },
            ),
        ],
    );
    assert_eq!(
        out.programs[i].pitches,
        vec![200_000, 300_000, 700_000, 1_100_000]
    );
    let mut events = neutral_notes(4);
    for (i, n) in events.iter_mut().enumerate() {
        n.onset = i as u64;
        n.duration = 4;
        n.velocity = 70 + i as u8;
        n.pitch_envelope=Some(serde_json::from_value(json!([{"tick":0,"pitch":{"millicents":0}},{"tick":2,"pitch":{"millicents":101}},{"tick":4,"pitch":{"millicents":0}}])).unwrap());
        n.gain_envelope = Some(
            serde_json::from_value(json!([{"tick":0,"gain":0.8},{"tick":4,"gain":0.5}])).unwrap(),
        );
    }
    let plan:CompositionPlan=serde_json::from_value(json!({"context":{"ppq":4,"duration":7,"midiFormat":1,"trackEnds":[7],"parts":[{"id":"members","name":"Control","track":0,"channel":0,"percussion":false}],"attachments":[]},
        "materials":[{"id":"m","span":7,"notes":events}],"harmonies":[h],"pitchLattices":[domain()],
        "placements":[{"material":"m","onset":0,"pitchBindings":out.bindings_for(i).unwrap()}]})).unwrap();
    let score = compile_composition(&plan, &Default::default()).unwrap();
    assert_eq!(score.notes.len(), events.len());
    for (n, expected) in score.notes.iter().zip(&events) {
        let mut neutral = n.clone();
        neutral.id = expected.id.clone();
        let offset = n.pitch.millicents;
        neutral.pitch.millicents -= offset;
        for knot in neutral.pitch_envelope.as_mut().unwrap() {
            knot.pitch.millicents -= offset;
        }
        assert_eq!(&neutral, expected);
    }
}
