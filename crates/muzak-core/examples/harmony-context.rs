//! Offline context adapter for observed bass and explicit model dependencies.
//! No key inference, reference labels or product API.
//! Input and output use native millicents for every pitch class.
use muzak_core::{
    error::{CoreResult, invalid},
    harmony::HarmonyWindow,
    harmony_context::{HarmonyContextOptions, HarmonyContextProposal, contextual_harmonic_roots},
    model::Score,
};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Request {
    score: Score,
    windows: Vec<HarmonyWindow>,
    #[serde(default)]
    options: HarmonyContextOptions,
    /// Absence disables the tonic gate. A null entry represents an unknown
    /// predicted tonic and rejects that window's proposal, never guessing a key.
    predicted_tonic_pitch_classes: Option<Vec<Option<i64>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    parameters: HarmonyContextOptions,
    tonic_filter: bool,
    proposed_count: usize,
    tonic_rejected_count: usize,
    proposals: Vec<HarmonyContextProposal>,
}

fn apply(request: Request) -> CoreResult<Response> {
    if let Some(tonics) = &request.predicted_tonic_pitch_classes {
        if tonics.len() != request.windows.len()
            || tonics
                .iter()
                .flatten()
                .any(|&p| !(0..1_200_000).contains(&p))
        {
            return Err(invalid(
                "Predicted tonic pitch classes must match the window count and be null or integer millicents in [0, 1200000).",
            ));
        }
    }
    let mut proposals =
        contextual_harmonic_roots(&request.score, &request.windows, &request.options)?;
    let proposed_count = proposals.len();
    if let Some(tonics) = &request.predicted_tonic_pitch_classes {
        proposals.retain(|p| {
            let h = &request.windows[p.window_index].alternatives
                [p.functional_root.realization_alternative_index];
            tonics[p.window_index] == Some(h.root_millicents)
        });
    }
    Ok(Response {
        parameters: request.options,
        tonic_filter: request.predicted_tonic_pitch_classes.is_some(),
        proposed_count,
        tonic_rejected_count: proposed_count - proposals.len(),
        proposals,
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
    let mut input = String::new();
    io::stdin()
        .take(MAX_INPUT_BYTES + 1)
        .read_to_string(&mut input)?;
    if input.len() as u64 > MAX_INPUT_BYTES {
        return Err(invalid("Context adapter input exceeds 64 MiB.").into());
    }
    let output = apply(serde_json::from_str(&input)?)?;
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> Value {
        let notes: Vec<_> = [55, 60, 64, 55, 59, 62]
            .iter()
            .enumerate()
            .map(|(i, pitch)| {
                json!({"id":format!("n{i}"),"part":"p","onset":if i<3{0}else{4},
                    "duration":4,"pitch":{"millicents":pitch*100_000},"velocity":80,"releaseVelocity":64})
            })
            .collect();
        let windows: Vec<_> = (0..2).map(|i| json!({
            "id":format!("w{i}"),"startTick":4*i,"endTick":4*i+4,"label":"uncomputed","rest":false,
            "noteIds":[],"coreNoteIds":[],"colorNoteIds":[],"residualNoteIds":[],
            "unsupportedNoteIds":[],"percussionNoteIds":[],"selected":0,"ambiguityGap":null,
            "localAmbiguityGap":null,"roles":[],"rhythms":[],"alternatives":[{
                "rootMillicents":if i==0{0}else{700_000},"templateId":"major","label":"major",
                "coreIntervals":[0,400_000,700_000],"colorIntervals":[],"score":0,
                "coreCoverage":0,"coreMassFraction":0,"contextualCost":null
            }]
        })).collect();
        json!({"score":{"ppq":4,"duration":8,"parts":[{"id":"p","name":"","track":0,"channel":0,"percussion":false}],
            "notes":notes,"attachments":[],"trackEnds":[8]},"windows":windows})
    }

    #[test]
    fn tonic_gate_only_filters_existing_observation_proposals() {
        let mut input = fixture();
        let unfiltered = apply(serde_json::from_value(input.clone()).unwrap()).unwrap();
        assert_eq!(unfiltered.proposed_count, 1);
        assert!(!unfiltered.tonic_filter);
        input["predictedTonicPitchClasses"] = json!([0, 0]);
        let accepted = apply(serde_json::from_value(input.clone()).unwrap()).unwrap();
        assert_eq!(accepted.proposals.len(), 1);
        assert_eq!(
            accepted.proposals[0].functional_root.root_millicents,
            700_000
        );
        // The gate compares realized C root to predicted C tonic, not proposed G.
        input["predictedTonicPitchClasses"] = json!([700_000, 700_000]);
        let rejected = apply(serde_json::from_value(input.clone()).unwrap()).unwrap();
        assert!(rejected.proposals.is_empty());
        assert_eq!(rejected.tonic_rejected_count, 1);
        input["predictedTonicPitchClasses"] = json!([null, 0]);
        assert!(
            apply(serde_json::from_value(input).unwrap())
                .unwrap()
                .proposals
                .is_empty()
        );
    }

    #[test]
    fn rejects_mismatched_or_invalid_tonics_and_reference_fields() {
        for values in [json!([]), json!([0]), json!([-1, 0]), json!([1_200_000, 0])] {
            let mut input = fixture();
            input["predictedTonicPitchClasses"] = values;
            assert!(apply(serde_json::from_value(input).unwrap()).is_err());
        }
        let mut input = fixture();
        input["predictedTonicPitchClasses"] = json!([0.5, 0]);
        assert!(serde_json::from_value::<Request>(input).is_err());
        let mut input = fixture();
        input["references"] = json!([]);
        assert!(serde_json::from_value::<Request>(input).is_err());
    }
}
