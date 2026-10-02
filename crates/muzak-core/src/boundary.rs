//! Refined LBDM local cues, with explicit monophony, endpoint and normalization
//! conventions. No inferred phrase labels or joint weights.
use crate::{
    error::{CoreResult, invalid},
    model::*,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundarySelection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pitch_range: Option<[i64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note_ids: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryCaps {
    pub pitch_millicents: f64,
    pub ioi_quarters: f64,
    pub rest_quarters: f64,
}
impl Default for BoundaryCaps {
    fn default() -> Self {
        Self {
            pitch_millicents: 1200000.,
            ioi_quarters: 4.,
            rest_quarters: 4.,
        }
    }
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryCapOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pitch_millicents: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ioi_quarters: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rest_quarters: Option<f64>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct BoundaryEvidenceOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub caps: Option<BoundaryCapOptions>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryCue {
    pub interval: f64,
    pub capped: bool,
    pub change_before: Option<f64>,
    pub change_after: Option<f64>,
    pub strength: f64,
    pub normalized: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BoundaryWitnesses {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before: Option<String>,
    pub left: String,
    pub right: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub after: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryRaw {
    pub pitch_millicents: u64,
    pub ioi_ticks: u64,
    pub rest_ticks: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryGap {
    pub tick: u64,
    pub left_offset_tick: u64,
    pub witnesses: BoundaryWitnesses,
    pub raw: BoundaryRaw,
    pub pitch: BoundaryCue,
    pub ioi: BoundaryCue,
    pub rest: BoundaryCue,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryIssue {
    pub kind: String,
    pub note_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BoundaryParameters {
    pub caps: BoundaryCaps,
    pub normalization: String,
    pub endpoints: String,
    pub stream: String,
    pub pitch: String,
    pub time: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryEvidence {
    pub status: String,
    pub note_ids: Vec<String>,
    pub issues: Vec<BoundaryIssue>,
    pub parameters: BoundaryParameters,
    pub gaps: Vec<BoundaryGap>,
}

fn profile(values: &[f64], cap: f64) -> Vec<BoundaryCue> {
    let inputs: Vec<_> = values.iter().map(|x| x.min(cap)).collect();
    let change = |a: f64, b: f64| {
        if a + b == 0. {
            0.
        } else {
            (a - b).abs() / (a + b)
        }
    };
    let mut maximum: f64 = 0.;
    let mut result: Vec<_> = inputs
        .iter()
        .enumerate()
        .map(|(i, &interval)| {
            let before = if i > 0 {
                Some(change(inputs[i - 1], interval))
            } else {
                None
            };
            let after = inputs.get(i + 1).map(|&x| change(interval, x));
            let strength = interval * (before.unwrap_or(0.) + after.unwrap_or(0.));
            maximum = maximum.max(strength);
            BoundaryCue {
                interval,
                capped: interval != values[i],
                change_before: before,
                change_after: after,
                strength,
                normalized: 0.,
            }
        })
        .collect();
    if maximum > 0. {
        for item in &mut result {
            item.normalized = item.strength / maximum;
        }
    }
    result
}
pub fn boundary_evidence(
    score: &Score,
    selection: &BoundarySelection,
    options: &BoundaryEvidenceOptions,
) -> CoreResult<BoundaryEvidence> {
    validate_score(score)?;
    if selection.parts.is_none() && selection.pitch_range.is_none() && selection.note_ids.is_none()
    {
        return Err(invalid("Specify an explicit boundary note selection."));
    }
    let ids = selection
        .note_ids
        .as_ref()
        .map(|x| x.iter().collect::<HashSet<_>>());
    if let Some(ids) = &ids {
        let available: HashSet<_> = score.notes.iter().map(|x| &x.id).collect();
        if ids.is_empty()
            || ids.len() != selection.note_ids.as_ref().unwrap().len()
            || ids.iter().any(|id| !available.contains(*id))
        {
            return Err(invalid(
                "Boundary note IDs must be nonempty, unique and present in the score.",
            ));
        }
    }
    let mut notes = select_notes(
        score,
        &ScoreSelection {
            parts: selection.parts.clone(),
            pitch_range: selection.pitch_range,
        },
    )?;
    notes.retain(|note| ids.as_ref().is_none_or(|set| set.contains(&note.id)));
    notes.sort_by(|a, b| a.onset.cmp(&b.onset).then(a.id.cmp(&b.id)));
    let defaults = BoundaryCaps::default();
    let caps = options
        .caps
        .as_ref()
        .map(|x| BoundaryCaps {
            pitch_millicents: x.pitch_millicents.unwrap_or(defaults.pitch_millicents),
            ioi_quarters: x.ioi_quarters.unwrap_or(defaults.ioi_quarters),
            rest_quarters: x.rest_quarters.unwrap_or(defaults.rest_quarters),
        })
        .unwrap_or(defaults);
    if [caps.pitch_millicents, caps.ioi_quarters, caps.rest_quarters]
        .iter()
        .any(|x| !x.is_finite() || *x <= 0.)
    {
        return Err(invalid(
            "Boundary interval caps must be finite and positive.",
        ));
    }
    let mut result = BoundaryEvidence {
        status: "supported".into(),
        note_ids: notes.iter().map(|x| x.id.clone()).collect(),
        issues: vec![],
        gaps: vec![],
        parameters: BoundaryParameters {
            caps,
            normalization: "divide-by-profile-maximum".into(),
            endpoints: "missing-neighbor-contributes-zero".into(),
            stream: "strict-key-down-monophony".into(),
            pitch: "note-attack".into(),
            time: "score-quarters".into(),
        },
    };
    if notes.is_empty() {
        result.issues.push(BoundaryIssue {
            kind: "empty-selection".into(),
            note_ids: vec![],
        });
    }
    let percussion: HashSet<_> = score
        .parts
        .iter()
        .filter(|x| x.percussion)
        .map(|x| &x.id)
        .collect();
    let drums: Vec<_> = notes
        .iter()
        .filter(|x| percussion.contains(&x.part))
        .map(|x| x.id.clone())
        .collect();
    if !drums.is_empty() {
        result.issues.push(BoundaryIssue {
            kind: "percussion".into(),
            note_ids: drums,
        });
    }
    let mut active: Option<&ScoreNote> = None;
    for (i, &note) in notes.iter().enumerate() {
        if i > 0 && notes[i - 1].onset == note.onset {
            result.issues.push(BoundaryIssue {
                kind: "simultaneous-attacks".into(),
                note_ids: vec![notes[i - 1].id.clone(), note.id.clone()],
            });
        }
        if active.is_some_and(|x| x.onset + x.duration <= note.onset) {
            active = None;
        }
        if let Some(other) = active {
            if other.onset != note.onset {
                result.issues.push(BoundaryIssue {
                    kind: "overlapping-notes".into(),
                    note_ids: vec![other.id.clone(), note.id.clone()],
                });
            }
        }
        if note.duration > 0
            && active.is_none_or(|x| note.onset + note.duration > x.onset + x.duration)
        {
            active = Some(note);
        }
    }
    if !result.issues.is_empty() {
        result.status = "unsupported".into();
        return Ok(result);
    }
    let raw: Vec<_> = notes
        .windows(2)
        .map(|pair| {
            let [left, right] = [pair[0], pair[1]];
            let distance = right.pitch.millicents.abs_diff(left.pitch.millicents);
            if distance > MAX_SAFE {
                return Err(invalid(
                    "Boundary pitch interval exceeds safe integer coordinates.",
                ));
            }
            Ok(BoundaryRaw {
                pitch_millicents: distance,
                ioi_ticks: right.onset - left.onset,
                rest_ticks: right.onset - left.onset - left.duration,
            })
        })
        .collect::<CoreResult<_>>()?;
    let pitch = profile(
        &raw.iter()
            .map(|x| x.pitch_millicents as f64)
            .collect::<Vec<_>>(),
        result.parameters.caps.pitch_millicents,
    );
    let ioi = profile(
        &raw.iter()
            .map(|x| x.ioi_ticks as f64 / score.ppq as f64)
            .collect::<Vec<_>>(),
        result.parameters.caps.ioi_quarters,
    );
    let rest = profile(
        &raw.iter()
            .map(|x| x.rest_ticks as f64 / score.ppq as f64)
            .collect::<Vec<_>>(),
        result.parameters.caps.rest_quarters,
    );
    result.gaps = raw
        .into_iter()
        .enumerate()
        .map(|(i, raw)| BoundaryGap {
            tick: notes[i + 1].onset,
            left_offset_tick: notes[i].onset + notes[i].duration,
            witnesses: BoundaryWitnesses {
                before: if i > 0 {
                    Some(notes[i - 1].id.clone())
                } else {
                    None
                },
                left: notes[i].id.clone(),
                right: notes[i + 1].id.clone(),
                after: notes.get(i + 2).map(|x| x.id.clone()),
            },
            raw,
            pitch: pitch[i].clone(),
            ioi: ioi[i].clone(),
            rest: rest[i].clone(),
        })
        .collect();
    Ok(result)
}
