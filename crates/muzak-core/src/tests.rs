use crate::{
    api,
    composition::{CompositionLimits, CompositionPlan, compile_composition},
    model::Score,
};
use serde_json::json;

fn plan() -> CompositionPlan {
    serde_json::from_value(json!({
    "context":{"ppq":12,"duration":0,"parts":[{"id":"p","name":"","track":0,"channel":0,"percussion":false}],"trackEnds":[0],"attachments":[]},
    "materials":[{"id":"leaf","span":12,"notes":[
      {"id":"a","part":"p","onset":0,"duration":4,"pitch":{"millicents":6000000},"velocity":81,"releaseVelocity":42,
       "pitchEnvelope":[{"tick":0,"pitch":{"millicents":6000000}},{"tick":3,"pitch":{"millicents":6012501}}]},
      {"id":"b","part":"p","onset":5,"duration":2,"pitch":{"millicents":6300000},"velocity":78,"releaseVelocity":42},
      {"id":"c","part":"p","onset":9,"duration":5,"pitch":{"millicents":6154321},"velocity":76,"releaseVelocity":42}]}],
    "definitions":[{"id":"half","span":6,"placements":[{"material":"leaf","onset":0,"timeScale":{"numerator":1,"denominator":2},"velocityScale":0.5}]}],
    "placements":[{"material":"half","onset":0,"timeScale":{"numerator":2,"denominator":1},"velocityScale":2},
                  {"material":"half","onset":24,"timeScale":{"numerator":2,"denominator":1},"velocityScale":2,"transposeMillicents":31251}]
})).unwrap()
}

#[test]
fn nested_rationals_cancel_before_integer_emission_and_shared_edits_propagate() {
    let mut plan = plan();
    let source = compile_composition(&plan, &CompositionLimits::default()).unwrap();
    assert_eq!(source.ppq, 12);
    assert_eq!(source.duration, 38);
    assert_eq!(source.notes[0].velocity, 81);
    assert_eq!(source.notes[0].pitch_envelope.as_ref().unwrap()[1].tick, 3);
    assert_eq!(
        source.notes[3].pitch_envelope.as_ref().unwrap()[1]
            .pitch
            .millicents,
        6043752
    );
    plan.materials[0].notes[1].duration = 3;
    let changed = compile_composition(&plan, &CompositionLimits::default()).unwrap();
    assert_eq!(changed.notes.iter().filter(|n| n.duration == 3).count(), 2);
    plan.definitions.as_mut().unwrap()[0].placements[0].material = "half".into();
    assert!(
        compile_composition(&plan, &CompositionLimits::default())
            .unwrap_err()
            .message
            .contains("cycl")
    );
}

#[test]
fn native_json_rejects_fractional_exact_coordinates_and_preserves_microtonal_pitch() {
    let score = compile_composition(&plan(), &CompositionLimits::default()).unwrap();
    let reply =
        api::execute_json(&json!({"op":"validateScore","input":{"score":score}}).to_string());
    assert!(reply.contains("response"));
    let mut invalid = serde_json::to_value(&score).unwrap();
    invalid["notes"][0]["pitch"]["millicents"] = json!(6000000.5);
    assert!(
        api::execute_json(&json!({"op":"validateScore","input":{"score":invalid}}).to_string())
            .contains("invalid-input")
    );
    let roundtrip: Score = serde_json::from_value(serde_json::to_value(score).unwrap()).unwrap();
    assert_eq!(roundtrip.notes[2].pitch.millicents, 6154321);
}

#[test]
fn malformed_external_tempo_maps_return_errors_without_panicking_or_null_numbers() {
    for input in [
        json!({"tick":0,"ppq":12,"tempos":[]}),
        json!({"tick":0,"ppq":0,"tempos":[{"tick":0,"seconds":0,"microseconds":500000}]}),
    ] {
        assert!(
            api::execute_json(&json!({"op":"tickToSeconds","input":input}).to_string())
                .contains("invalid-input")
        );
    }
    assert!(api::execute_json(&json!({"op":"secondsToTick","input":{"seconds":1e308,"ppq":12,"tempos":[{"tick":0,"seconds":0,"microseconds":1}]}}).to_string()).contains("invalid-input"));
}
