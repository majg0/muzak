//! Authored-pattern acceptance controls through the sole composition compiler.
//! These establish exact executable structure, not perceptual melody quality.
use crate::{
    composition::{compile_composition, CompositionLimits, CompositionPlan},
    model::Score,
};
use serde_json::{json, Value};
use std::collections::HashSet;

fn time(numerator: u64, denominator: u64) -> Value {
    json!({"numerator": numerator, "denominator": denominator})
}

fn atom(value: impl Into<Value>, numerator: u64, denominator: u64) -> Value {
    json!({"kind":"atom", "value":value.into(), "span":time(numerator, denominator)})
}

fn sequence(items: Vec<Value>) -> Value {
    json!({"kind":"sequence", "items":items})
}

fn numbers(values: &[i64]) -> Value {
    sequence(values.iter().map(|&value| atom(value, 1, 1)).collect())
}

fn gates(values: &[bool]) -> Value {
    sequence(values.iter().map(|&value| atom(value, 1, 1)).collect())
}

fn repeat(pattern: Value, count: u64) -> Value {
    json!({"kind":"repeat", "pattern":pattern, "count":count})
}

fn window(pattern: Value, numerator: u64, denominator: u64) -> Value {
    json!({"kind":"window", "pattern":pattern, "start":time(0, 1), "span":time(numerator, denominator)})
}

fn combine(operation: &str, operands: Vec<Value>) -> Value {
    json!({"kind":"combine", "operation":operation, "operands":operands})
}

fn subdivide(operation: &str, parent: Value, children: Vec<Value>) -> Value {
    json!({"kind":"subdivide", "operation":operation, "parent":parent, "children":children})
}

fn reference(id: &str) -> Value {
    json!({"kind":"ref", "id":id})
}

fn control(pattern: Value, clock: &str) -> Value {
    json!({"pattern":pattern,"clock":clock})
}

fn voice(id: &str, rhythm: Value, degree: Value) -> Value {
    json!({
        "id":id,"part":"p","rhythm":rhythm,
        "pitch":{"anchor":{"kind":"lattice","lattice":"ionian","degree":0},
                 "degree":control(degree,"time")}
    })
}

fn native_voice(id: &str, rhythm: Value, offsets: Value) -> Value {
    json!({
        "id":id,"part":"p","rhythm":rhythm,
        "pitch":{"anchor":{"kind":"native","millicents":6000000},
                 "chromatic":control(offsets,"time")}
    })
}

fn document(voices: Vec<Value>) -> Value {
    json!({
        "context":{"ppq":12,"duration":0,
            "parts":[{"id":"p","name":"Authored parts","track":0,"channel":0,"percussion":false}],
            "trackEnds":[0],"attachments":[]},
        "materials":[],"placements":[],
        "pitchLattices":[{"id":"ionian","originMillicents":6000000,
            "intervals":[0,200000,400000,500000,700000,900000,1100000],"periodMillicents":1200000}],
        "patterns":{"numberDefinitions":{},"gateDefinitions":{},"voices":voices}
    })
}

fn compile(document: &Value) -> Score {
    let plan: CompositionPlan = serde_json::from_value(document.clone()).unwrap();
    // The executable expressions survive a standalone save/load before every assertion.
    let saved = serde_json::to_string(&plan).unwrap();
    let loaded: CompositionPlan = serde_json::from_str(&saved).unwrap();
    compile_composition(&loaded, &CompositionLimits::default()).unwrap()
}

fn pitches(score: &Score) -> Vec<i64> {
    score
        .notes
        .iter()
        .map(|note| note.pitch.millicents)
        .collect()
}

fn assert_time(actual: u64, score: &Score, numerator: u64, denominator: u64) {
    assert_eq!(
        u128::from(actual) * 12 * u128::from(denominator),
        u128::from(numerator) * u128::from(score.ppq),
        "expected {numerator}/{denominator} source ticks, got {actual} at PPQ {}",
        score.ppq
    );
}

fn melodic_document() -> Value {
    let outer = sequence(
        [0, 1, 2]
            .into_iter()
            .map(|value| atom(value, 3, 1))
            .collect(),
    );
    let degree = subdivide("add", reference("outer"), vec![reference("inner")]);
    let mut plan = document(vec![voice("line", repeat(atom(true, 1, 1), 9), degree)]);
    plan["patterns"]["numberDefinitions"] = json!({"outer":outer,"inner":numbers(&[0,2,1])});
    plan
}

#[test]
fn authored_outer_and_inner_patterns_regenerate_shared_and_local_edits() {
    let mut plan = melodic_document();
    let mut second = plan["patterns"]["voices"][0].clone();
    second["id"] = json!("second");
    second["onset"] = time(12, 1);
    plan["patterns"]["voices"]
        .as_array_mut()
        .unwrap()
        .push(second);
    let expected = vec![
        6000000, 6400000, 6200000, 6200000, 6500000, 6400000, 6400000, 6700000, 6500000,
    ];
    let original = compile(&plan);
    assert_eq!(
        pitches(&original),
        expected
            .iter()
            .chain(&expected)
            .copied()
            .collect::<Vec<_>>()
    );
    assert_eq!(original.notes.len(), 18);
    assert_time(original.notes[9].onset, &original, 12, 1);

    plan["patterns"]["numberDefinitions"]["inner"]["items"][1]["value"] = json!(3);
    let shared = compile(&plan);
    let edited = vec![
        6000000, 6500000, 6200000, 6200000, 6700000, 6400000, 6400000, 6900000, 6500000,
    ];
    assert_eq!(
        pitches(&shared),
        edited.iter().chain(&edited).copied().collect::<Vec<_>>()
    );
    assert_eq!(
        original
            .notes
            .iter()
            .map(|n| (&n.id, n.onset, n.duration))
            .collect::<Vec<_>>(),
        shared
            .notes
            .iter()
            .map(|n| (&n.id, n.onset, n.duration))
            .collect::<Vec<_>>()
    );

    plan["patterns"]["voices"][1]["pitch"]["chromatic"] = control(atom(12501, 9, 1), "time");
    let local = compile(&plan);
    assert_eq!(&pitches(&local)[..9], edited.as_slice());
    assert_eq!(
        &pitches(&local)[9..],
        edited.iter().map(|pitch| pitch + 12501).collect::<Vec<_>>()
    );
}

#[test]
fn authored_patterns_compose_three_independent_pitch_levels() {
    let mut plan = melodic_document();
    let outer = repeat(reference("outer"), 2);
    let inner = repeat(reference("inner"), 6);
    let phrase = sequence(vec![atom(0, 9, 1), atom(7, 9, 1)]);
    plan["patterns"]["voices"][0]["rhythm"] = repeat(atom(true, 1, 1), 18);
    plan["patterns"]["voices"][0]["pitch"]["degree"] =
        control(combine("add", vec![outer, inner, phrase]), "time");
    let score = compile(&plan);
    assert_eq!(score.notes.len(), 18);
    let first = vec![
        6000000, 6400000, 6200000, 6200000, 6500000, 6400000, 6400000, 6700000, 6500000,
    ];
    assert_eq!(&pitches(&score)[..9], first.as_slice());
    assert_eq!(
        &pitches(&score)[9..],
        first
            .iter()
            .map(|pitch| pitch + 1200000)
            .collect::<Vec<_>>()
    );
}

#[test]
fn authored_signed_degrees_arbitrary_periods_and_native_residuals_stay_exact() {
    let degree = numbers(&[-1, 0, 1, 2, 3, 4, 6]);
    let mut plan = document(vec![voice("line", repeat(atom(true, 1, 1), 7), degree)]);
    plan["pitchLattices"][0] = json!({"id":"ionian","originMillicents":6000000,
        "intervals":[0,200003,450007],"periodMillicents":1000003});
    plan["patterns"]["voices"][0]["pitch"]["chromatic"] = control(atom(12501, 7, 1), "time");
    let original = compile(&plan);
    assert_eq!(
        pitches(&original),
        vec![5462505, 6012501, 6212504, 6462508, 7012504, 7212507, 8012507]
    );
    plan["pitchLattices"][0]["intervals"][1] = json!(210003);
    let changed = compile(&plan);
    assert_eq!(
        pitches(&changed),
        vec![5462505, 6012501, 6222504, 6462508, 7012504, 7222507, 8012507]
    );

    let mut chromatic = document(vec![native_voice(
        "chromatic",
        repeat(atom(true, 1, 1), 4),
        numbers(&[0, -100000, -200000, 25001]),
    )]);
    chromatic["pitchLattices"] = json!([]);
    assert_eq!(
        pitches(&compile(&chromatic)),
        vec![6000000, 5900000, 5800000, 6025001]
    );
}

#[test]
fn authored_pitch_and_rhythm_have_explicit_time_and_attack_clocks() {
    let rhythm = gates(&[true, false, true, true, false, true]);
    let pitch = repeat(numbers(&[0, 1, 2]), 2);
    let mut plan = document(vec![voice("line", rhythm, pitch)]);
    let timed = compile(&plan);
    assert_eq!(pitches(&timed), vec![6000000, 6400000, 6000000, 6400000]);
    for (note, onset) in timed.notes.iter().zip([0, 2, 3, 5]) {
        assert_time(note.onset, &timed, onset, 1);
    }
    plan["patterns"]["voices"][0]["pitch"]["degree"]["clock"] = json!("attack");
    let attacked = compile(&plan);
    assert_eq!(pitches(&attacked), vec![6000000, 6200000, 6400000, 6000000]);
    plan["patterns"]["voices"][0]["rhythm"] = gates(&[true, true, false, true, true, false]);
    let shifted = compile(&plan);
    assert_eq!(pitches(&shifted), pitches(&attacked));
    for (note, onset) in shifted.notes.iter().zip([0, 1, 3, 4]) {
        assert_time(note.onset, &shifted, onset, 1);
    }
}

#[test]
fn authored_duration_slots_sound_masks_and_sounding_attack_clocks_are_independent() {
    let rhythm = sequence(vec![atom(true, 2, 1), atom(true, 1, 1)]);
    let mut part = voice("line", rhythm, numbers(&[0, 1]));
    part["pitch"]["degree"]["clock"] = json!("attack");
    part["sound"] = control(gates(&[false, true]), "slot");
    let mut plan = document(vec![part]);
    let attack = compile(&plan);
    assert_eq!(pitches(&attack), vec![6000000]);
    assert_time(attack.notes[0].onset, &attack, 2, 1);
    assert_time(attack.notes[0].duration, &attack, 1, 1);
    plan["patterns"]["voices"][0]["pitch"]["degree"]["clock"] = json!("slot");
    let slot = compile(&plan);
    assert_eq!(pitches(&slot), vec![6200000]);
    assert_time(slot.notes[0].onset, &slot, 2, 1);

    // A sampled sound mask changes attack eligibility, not an already held note.
    plan["patterns"]["voices"][0]["sound"] = control(gates(&[true, false, true]), "time");
    let held = compile(&plan);
    assert_eq!(pitches(&held), vec![6000000, 6200000]);
    assert_time(held.notes[0].duration, &held, 2, 1);
    assert_time(held.notes[1].onset, &held, 2, 1);

    plan["patterns"]["voices"][0]["sound"]["clock"] = json!("attack");
    let parsed: CompositionPlan = serde_json::from_value(plan).unwrap();
    assert!(compile_composition(&parsed, &CompositionLimits::default()).is_err());
}

#[test]
fn authored_three_and_four_cycles_keep_phase_until_twelve() {
    let a = repeat(numbers(&[0, 100000, 200000]), 5);
    let b = repeat(numbers(&[0, 1000000, 2000000, 3000000]), 4);
    let degree = window(combine("add", vec![a, b]), 13, 1);
    let score = compile(&document(vec![native_voice(
        "line",
        repeat(atom(true, 1, 1), 13),
        degree,
    )]));
    assert_eq!(
        pitches(&score),
        vec![
            6000000, 7100000, 8200000, 9000000, 6100000, 7200000, 8000000, 9100000, 6200000,
            7000000, 8100000, 9200000, 6000000
        ]
    );
    assert!(score.notes[1..12]
        .iter()
        .all(|note| note.pitch.millicents != score.notes[0].pitch.millicents));
}

#[test]
fn authored_nested_gates_preserve_parent_spans_and_silent_slots() {
    let outer = gates(&[true, false, true]);
    let four = gates(&[true, false, false, true]);
    let three = gates(&[true, false, true]);
    let nested = subdivide("all", outer, vec![four.clone(), four, three]);
    let rhythm = combine("all", vec![nested, atom(true, 3, 1), atom(true, 3, 1)]);
    let score = compile(&document(vec![native_voice("line", rhythm, atom(0, 3, 1))]));
    assert_eq!(score.notes.len(), 4);
    for (note, (onset, denominator, duration)) in
        score
            .notes
            .iter()
            .zip([(0, 4, 1), (3, 4, 1), (6, 3, 1), (8, 3, 1)])
    {
        assert_time(note.onset, &score, onset, denominator);
        assert_time(note.duration, &score, duration, denominator);
    }
    assert_time(score.duration, &score, 3, 1);
}

#[test]
fn authored_held_durations_differ_from_rest_cells_and_can_be_subdivided() {
    let held = sequence(vec![atom(true, 2, 1), atom(true, 1, 1)]);
    let score = compile(&document(vec![native_voice("line", held, atom(0, 3, 1))]));
    assert_eq!(score.notes.len(), 2);
    assert_time(score.notes[0].onset, &score, 0, 1);
    assert_time(score.notes[0].duration, &score, 2, 1);
    assert_time(score.notes[1].onset, &score, 2, 1);
    assert_time(score.notes[1].duration, &score, 1, 1);
    let rests = compile(&document(vec![native_voice(
        "line",
        gates(&[true, false, true]),
        atom(0, 3, 1),
    )]));
    assert_time(rests.notes[0].duration, &rests, 1, 1);
    assert_time(rests.notes[1].onset, &rests, 2, 1);
    let subdivided = subdivide(
        "all",
        sequence(vec![atom(true, 2, 1), atom(true, 1, 1)]),
        vec![gates(&[true, true]), atom(true, 1, 1)],
    );
    let nested = compile(&document(vec![native_voice(
        "line",
        subdivided,
        atom(0, 3, 1),
    )]));
    assert_eq!(nested.notes.len(), 3);
    for (note, onset) in nested.notes.iter().zip([0, 1, 2]) {
        assert_time(note.onset, &nested, onset, 1);
        assert_time(note.duration, &nested, 1, 1);
    }
    assert_time(nested.duration, &nested, 3, 1);
}

#[test]
fn authored_fractional_period_clips_and_restarts_without_drift() {
    let cycle = repeat(atom(true, 7, 3), 7);
    let rhythm = repeat(window(cycle, 16, 1), 2);
    let score = compile(&document(vec![native_voice(
        "line",
        rhythm,
        atom(0, 32, 1),
    )]));
    assert_eq!(score.notes.len(), 14);
    for phrase in 0..2 {
        for step in 0..7 {
            let note = &score.notes[phrase * 7 + step];
            assert_time(
                note.onset,
                &score,
                (phrase as u64) * 48 + (step as u64) * 7,
                3,
            );
            assert_time(note.duration, &score, if step == 6 { 6 } else { 7 }, 3);
        }
    }
    assert_time(score.duration, &score, 32, 1);
}

#[test]
fn authored_crossing_and_coincident_lines_keep_separate_emissions_and_edits() {
    let a = native_voice(
        "ascending",
        repeat(atom(true, 1, 1), 3),
        numbers(&[0, 200000, 400000]),
    );
    let mut b = native_voice(
        "descending",
        repeat(atom(true, 1, 1), 3),
        numbers(&[0, -200000, -400000]),
    );
    b["pitch"]["anchor"]["millicents"] = json!(6400000);
    let mut plan = document(vec![a, b]);
    let score = compile(&plan);
    assert_eq!(score.notes.len(), 6);
    assert_eq!(
        score
            .notes
            .iter()
            .map(|note| &note.id)
            .collect::<HashSet<_>>()
            .len(),
        6
    );
    let middle: Vec<_> = score
        .notes
        .iter()
        .filter(|note| note.onset * 12 == score.ppq)
        .collect();
    assert_eq!(middle.len(), 2);
    assert!(middle.iter().all(|note| note.pitch.millicents == 6200000));
    plan["patterns"]["voices"][1]["pitch"]["chromatic"]["pattern"]["items"][1]["value"] =
        json!(-100000);
    let edited = compile(&plan);
    let mut middle: Vec<_> = edited
        .notes
        .iter()
        .filter(|note| note.onset * 12 == edited.ppq)
        .map(|note| note.pitch.millicents)
        .collect();
    middle.sort();
    assert_eq!(middle, vec![6200000, 6300000]);
    assert_eq!(
        edited
            .notes
            .iter()
            .map(|note| &note.id)
            .collect::<HashSet<_>>(),
        score.notes.iter().map(|note| &note.id).collect()
    );
}

#[test]
fn authored_harmony_members_and_velocity_use_shared_patterns_without_merging_voices() {
    let mut voices = vec![];
    for (id, tone) in [("root", 0), ("third", 1), ("fifth", 2)] {
        let mut part = native_voice(id, repeat(atom(true, 1, 1), 3), reference("bend"));
        part["pitch"]["anchor"] = json!({"kind":"harmony", "harmony":"chord", "tone":tone,
            "octave":0, "residualMillicents":0});
        part["velocity"] = control(reference("accent"), "attack");
        voices.push(part);
    }
    let mut plan = document(voices);
    plan["harmonies"] =
        json!([{"id":"chord","rootMillicents":6000000,"intervals":[0,400000,700000]}]);
    plan["patterns"]["numberDefinitions"] =
        json!({"bend":numbers(&[0,12501,-25001]),"accent":numbers(&[90,60,75])});
    let original = compile(&plan);
    assert_eq!(original.notes.len(), 9);
    for (step, (offset, velocity)) in [(0, 90), (12501, 60), (-25001, 75)].into_iter().enumerate() {
        let notes: Vec<_> = original
            .notes
            .iter()
            .filter(|note| note.onset * 12 == (step as u64) * original.ppq)
            .collect();
        assert_eq!(notes.len(), 3);
        let mut values: Vec<_> = notes.iter().map(|note| note.pitch.millicents).collect();
        values.sort();
        assert_eq!(
            values,
            vec![6000000 + offset, 6400000 + offset, 6700000 + offset]
        );
        assert!(notes.iter().all(|note| note.velocity == velocity));
    }
    plan["harmonies"][0]["intervals"][1] = json!(300000);
    let edited = compile(&plan);
    assert_eq!(
        edited
            .notes
            .iter()
            .filter(|note| note.pitch.millicents == 6300000)
            .count(),
        1
    );
    assert_eq!(
        edited
            .notes
            .iter()
            .filter(|note| note.pitch.millicents == 6400000)
            .count(),
        0
    );
    assert_eq!(
        edited
            .notes
            .iter()
            .map(|note| (&note.id, note.onset, note.duration, note.velocity))
            .collect::<Vec<_>>(),
        original
            .notes
            .iter()
            .map(|note| (&note.id, note.onset, note.duration, note.velocity))
            .collect::<Vec<_>>()
    );
}

#[test]
fn authored_parallel_rhythms_keep_overlapping_notes_and_explicit_tail_policy() {
    let rhythm = json!({"kind":"parallel","items":[atom(true,2,1),
        sequence(vec![json!({"kind":"rest","span":time(1,1)}),atom(true,2,1)])]});
    let mut part = native_voice("overlap", rhythm, numbers(&[0, 100000]));
    part["pitch"]["chromatic"]["clock"] = json!("attack");
    let mut plan = document(vec![part]);
    let overlapping = compile(&plan);
    assert_eq!(pitches(&overlapping), vec![6000000, 6100000]);
    assert_time(overlapping.notes[0].onset, &overlapping, 0, 1);
    assert_time(overlapping.notes[0].duration, &overlapping, 2, 1);
    assert_time(overlapping.notes[1].onset, &overlapping, 1, 1);
    assert_time(overlapping.notes[1].duration, &overlapping, 2, 1);
    plan["patterns"]["voices"][0]["durationScale"] = time(2, 1);
    let clipped = compile(&plan);
    assert_time(clipped.notes[0].duration, &clipped, 3, 1);
    assert_time(clipped.notes[1].duration, &clipped, 2, 1);
    assert_time(clipped.duration, &clipped, 3, 1);
    plan["patterns"]["voices"][0]["tail"] = json!("allow");
    let allowed = compile(&plan);
    assert_time(allowed.notes[0].duration, &allowed, 4, 1);
    assert_time(allowed.notes[1].duration, &allowed, 4, 1);
    assert_time(allowed.duration, &allowed, 5, 1);
}

#[test]
fn authored_invalid_references_cycles_and_expansion_limits_fail_explicitly() {
    let mut plan = melodic_document();
    plan["patterns"]["numberDefinitions"]["inner"] = reference("missing");
    let parsed: CompositionPlan = serde_json::from_value(plan.clone()).unwrap();
    assert_eq!(
        compile_composition(&parsed, &CompositionLimits::default())
            .unwrap_err()
            .code,
        "invalid-input"
    );
    plan["patterns"]["numberDefinitions"]["inner"] = reference("outer");
    plan["patterns"]["numberDefinitions"]["outer"] = reference("inner");
    let parsed: CompositionPlan = serde_json::from_value(plan).unwrap();
    assert_eq!(
        compile_composition(&parsed, &CompositionLimits::default())
            .unwrap_err()
            .code,
        "invalid-input"
    );
    let parsed: CompositionPlan = serde_json::from_value(melodic_document()).unwrap();
    let limits = CompositionLimits {
        max_expanded_notes: Some(8),
        ..CompositionLimits::default()
    };
    assert!(compile_composition(&parsed, &limits).is_err());
    let limits = CompositionLimits {
        max_expanded_placements: Some(2),
        ..CompositionLimits::default()
    };
    assert!(compile_composition(&parsed, &limits).is_err());
    let limits = CompositionLimits {
        max_depth: Some(0),
        ..CompositionLimits::default()
    };
    assert!(compile_composition(&parsed, &limits).is_err());
    let mut malformed = melodic_document();
    malformed["patterns"]["voices"][0]["rhythm"] = repeat(atom(true, 1, 1), 0);
    let parsed: CompositionPlan = serde_json::from_value(malformed).unwrap();
    assert_eq!(
        compile_composition(&parsed, &CompositionLimits::default())
            .unwrap_err()
            .code,
        "invalid-input"
    );

    for malformed_control in [
        // A missing value is unknown, never an implicit zero or held value.
        numbers(&[0]),
        // Concurrent scalar values need an explicit combination operation.
        json!({"kind":"parallel","items":[atom(0,9,1),atom(1,9,1)]}),
        atom(0, 1, 0),
        atom(9_007_199_254_740_992_i64, 9, 1),
    ] {
        let mut malformed = melodic_document();
        malformed["patterns"]["voices"][0]["pitch"]["degree"] = control(malformed_control, "time");
        let parsed: CompositionPlan = serde_json::from_value(malformed).unwrap();
        assert!(compile_composition(&parsed, &CompositionLimits::default()).is_err());
    }
    let mut unused = melodic_document();
    unused["patterns"]["numberDefinitions"]["unused"] = reference("missing");
    let parsed: CompositionPlan = serde_json::from_value(unused).unwrap();
    assert!(compile_composition(&parsed, &CompositionLimits::default()).is_err());
}
