//! Exact note-event comparison, independent of inference or codec ownership.
use crate::{
    error::CoreResult,
    model::{Score, ScoreNote, validate_score},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScoreComparisonOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ignore_velocity: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ScoreComparison {
    pub equal: bool,
    pub matched: usize,
    pub similarity: f64,
    pub missing: Vec<ScoreNote>,
    pub extra: Vec<ScoreNote>,
}

fn expression(note: &ScoreNote, time: impl Fn(u64) -> Value) -> Value {
    json!([
        note.pitch_envelope.as_ref().map(|v| v
            .iter()
            .map(|p| json!([time(p.tick), p.pitch.millicents - note.pitch.millicents]))
            .collect::<Vec<_>>()),
        note.gain_envelope.as_ref().map(|v| v
            .iter()
            .map(|p| json!([time(p.tick), p.gain]))
            .collect::<Vec<_>>())
    ])
}
fn fraction(tick: u64, ppq: u64) -> String {
    let (mut a, mut b) = (tick, ppq);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    format!("{}/{}", tick / a, ppq / a)
}
fn comparison_key(score: &Score, note: &ScoreNote, ignore_velocity: bool) -> String {
    let part = score.parts.iter().find(|p| p.id == note.part).unwrap();
    let mut values = vec![
        json!(part.track),
        json!(part.channel),
        json!(part.percussion),
        json!(fraction(note.onset, score.ppq)),
        json!(fraction(note.duration, score.ppq)),
        json!(note.pitch.millicents),
        expression(note, |t| json!(fraction(t, score.ppq))),
    ];
    if !ignore_velocity {
        values.extend([json!(note.velocity), json!(note.release_velocity)]);
    }
    json!(values).to_string()
}
pub fn compare_scores(
    expected: &Score,
    actual: &Score,
    options: &ScoreComparisonOptions,
) -> CoreResult<ScoreComparison> {
    validate_score(expected)?;
    validate_score(actual)?;
    let ignore = options.ignore_velocity.unwrap_or(false);
    let mut buckets = BTreeMap::<String, Vec<ScoreNote>>::new();
    for note in &actual.notes {
        buckets
            .entry(comparison_key(actual, note, ignore))
            .or_default()
            .push(note.clone());
    }
    let mut matched = 0;
    let mut missing = Vec::new();
    for note in &expected.notes {
        if buckets
            .get_mut(&comparison_key(expected, note, ignore))
            .and_then(Vec::pop)
            .is_some()
        {
            matched += 1;
        } else {
            missing.push(note.clone());
        }
    }
    let extra: Vec<_> = buckets.into_values().flatten().collect();
    let total = expected.notes.len() + actual.notes.len();
    Ok(ScoreComparison {
        equal: missing.is_empty() && extra.is_empty(),
        matched,
        similarity: if total > 0 {
            2.0 * matched as f64 / total as f64
        } else {
            1.0
        },
        missing,
        extra,
    })
}
