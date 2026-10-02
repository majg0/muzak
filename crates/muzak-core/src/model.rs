use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use ts_rs::TS;

pub const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub struct Pitch {
    pub millicents: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScorePart {
    pub id: String,
    pub name: String,
    pub track: usize,
    pub channel: u8,
    pub percussion: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PitchEnvelopePoint {
    pub tick: u64,
    pub pitch: Pitch,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct GainEnvelopePoint {
    pub tick: u64,
    pub gain: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteSource {
    pub on_order: u64,
    pub off_order: u64,
    pub off_status: u8,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScoreNote {
    pub id: String,
    pub part: String,
    pub onset: u64,
    pub duration: u64,
    pub pitch: Pitch,
    pub velocity: u8,
    pub release_velocity: u8,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "pitch_trajectory"
    )]
    #[ts(optional)]
    pub pitch_envelope: Option<Vec<PitchEnvelopePoint>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "gain_trajectory"
    )]
    #[ts(optional)]
    pub gain_envelope: Option<Vec<GainEnvelopePoint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<NoteSource>,
}
fn pitch_trajectory<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<PitchEnvelopePoint>>, D::Error> {
    Option::<Vec<PitchEnvelopePoint>>::deserialize(deserializer)
        .map_err(|error| serde::de::Error::custom(format!("Invalid pitch trajectory: {error}")))
}
fn gain_trajectory<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<GainEnvelopePoint>>, D::Error> {
    Option::<Vec<GainEnvelopePoint>>::deserialize(deserializer)
        .map_err(|error| serde::de::Error::custom(format!("Invalid gain trajectory: {error}")))
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ScoreAttachment {
    pub tick: u64,
    pub track: usize,
    pub order: u64,
    pub bytes: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub ppq: u64,
    pub duration: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub midi_format: Option<u8>,
    pub parts: Vec<ScorePart>,
    #[serde(default)]
    pub notes: Vec<ScoreNote>,
    pub attachments: Vec<ScoreAttachment>,
    pub track_ends: Vec<u64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScoreContext {
    pub ppq: u64,
    pub duration: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub midi_format: Option<u8>,
    pub parts: Vec<ScorePart>,
    pub attachments: Vec<ScoreAttachment>,
    pub track_ends: Vec<u64>,
}
impl From<&Score> for ScoreContext {
    fn from(score: &Score) -> Self {
        Self {
            ppq: score.ppq,
            duration: score.duration,
            midi_format: score.midi_format,
            parts: score.parts.clone(),
            attachments: score.attachments.clone(),
            track_ends: score.track_ends.clone(),
        }
    }
}
impl ScoreContext {
    pub fn score(&self, notes: Vec<ScoreNote>) -> Score {
        Score {
            ppq: self.ppq,
            duration: self.duration,
            midi_format: self.midi_format,
            parts: self.parts.clone(),
            notes,
            attachments: self.attachments.clone(),
            track_ends: self.track_ends.clone(),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ScoreIssue {
    pub kind: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub track: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tick: Option<u64>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScoreSelection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pitch_range: Option<[i64; 2]>,
}

pub fn validate_note_trajectories(note: &ScoreNote) -> CoreResult<()> {
    let valid_times = |times: Vec<u64>| {
        !times.is_empty()
            && times[0] == 0
            && times.iter().all(|&tick| tick <= note.duration)
            && times.windows(2).all(|pair| pair[0] < pair[1])
    };
    if let Some(points) = &note.pitch_envelope {
        if !valid_times(points.iter().map(|point| point.tick).collect()) {
            return Err(invalid(
                "Invalid note trajectory time; trajectories must start at tick zero.",
            ));
        }
        if points[0].pitch != note.pitch
            || points
                .iter()
                .any(|point| point.pitch.millicents.unsigned_abs() > MAX_SAFE)
        {
            return Err(invalid("Invalid note pitch trajectory or attack pitch."));
        }
    }
    if let Some(points) = &note.gain_envelope {
        if !valid_times(points.iter().map(|point| point.tick).collect()) {
            return Err(invalid(
                "Invalid note trajectory time; trajectories must start at tick zero.",
            ));
        }
        if points
            .iter()
            .any(|point| !point.gain.is_finite() || !(0.0..=1.0).contains(&point.gain))
        {
            return Err(invalid("Invalid note gain trajectory."));
        }
    }
    Ok(())
}
pub fn validate_score(score: &Score) -> CoreResult<()> {
    if score.ppq == 0 || score.ppq > MAX_SAFE || score.duration > MAX_SAFE {
        return Err(invalid("Invalid score timebase or duration."));
    }
    let parts: HashMap<_, _> = score
        .parts
        .iter()
        .map(|part| (part.id.as_str(), part))
        .collect();
    if parts.len() != score.parts.len() {
        return Err(invalid("Score part IDs must be unique."));
    }
    if score
        .parts
        .iter()
        .any(|part| part.track >= score.track_ends.len() || part.channel > 15)
    {
        return Err(invalid("Invalid part routing."));
    }
    let mut ids = HashSet::new();
    for note in &score.notes {
        let Some(part) = parts.get(note.part.as_str()) else {
            return Err(invalid("Invalid note identity or part."));
        };
        if !ids.insert(&note.id) {
            return Err(invalid("Invalid note identity or part."));
        }
        let end = note
            .onset
            .checked_add(note.duration)
            .ok_or_else(|| invalid("Invalid note time or pitch."))?;
        if end > score.duration || note.pitch.millicents.unsigned_abs() > MAX_SAFE {
            return Err(invalid("Invalid note time or pitch."));
        }
        if end > score.track_ends[part.track] {
            return Err(invalid("Note exceeds its track ending."));
        }
        if note.velocity == 0 || note.velocity > 127 || note.release_velocity > 127 {
            return Err(invalid("Invalid note velocity."));
        }
        validate_note_trajectories(note)?;
        if let Some(source) = &note.source {
            if source.on_order > MAX_SAFE
                || source.off_order > MAX_SAFE
                || source.off_order <= source.on_order
                || !(0x80..=0x9f).contains(&source.off_status)
            {
                return Err(invalid(
                    "Invalid source note-event ordering or release status.",
                ));
            }
            if source.off_status & 0xf0 == 0x90 && note.release_velocity != 0 {
                return Err(invalid("A note-on release requires zero release velocity."));
            }
        }
    }
    if score.track_ends.iter().any(|&end| end > score.duration) {
        return Err(invalid("Invalid track ending."));
    }
    for event in &score.attachments {
        if event.tick > score.duration || event.track >= score.track_ends.len() {
            return Err(invalid("Invalid attachment position."));
        }
        if event.order > MAX_SAFE || event.tick > score.track_ends[event.track] {
            return Err(invalid("Invalid attachment order or track ending."));
        }
        crate::midi::midi_payload(&event.bytes)?;
    }
    Ok(())
}
pub fn select_notes<'a>(
    score: &'a Score,
    selection: &ScoreSelection,
) -> CoreResult<Vec<&'a ScoreNote>> {
    if let Some(parts) = &selection.parts {
        if parts
            .iter()
            .any(|id| !score.parts.iter().any(|part| &part.id == id))
        {
            return Err(invalid("Unknown selected part."));
        }
    }
    if let Some([lo, hi]) = selection.pitch_range {
        if lo > hi || lo.unsigned_abs() > MAX_SAFE || hi.unsigned_abs() > MAX_SAFE {
            return Err(invalid("Invalid pitch range."));
        }
    }
    Ok(score
        .notes
        .iter()
        .filter(|note| {
            selection
                .parts
                .as_ref()
                .is_none_or(|parts| parts.contains(&note.part))
                && selection.pitch_range.is_none_or(|[lo, hi]| {
                    note.pitch.millicents >= lo && note.pitch.millicents <= hi
                })
        })
        .collect())
}
