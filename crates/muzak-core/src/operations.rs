use crate::{
    error::{CoreResult, invalid},
    model::*,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

fn interpolate(points: &[(u64, f64)], tick: f64) -> f64 {
    if tick <= points[0].0 as f64 {
        return points[0].1;
    }
    for pair in points.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if tick <= b.0 as f64 {
            return a.1 + (b.1 - a.1) * (tick - a.0 as f64) / (b.0 - a.0) as f64;
        }
    }
    points.last().unwrap().1
}
pub fn pitch_at(note: &ScoreNote, offset: f64) -> f64 {
    note.pitch_envelope
        .as_ref()
        .map_or(note.pitch.millicents as f64, |points| {
            interpolate(
                &points
                    .iter()
                    .map(|point| (point.tick, point.pitch.millicents as f64))
                    .collect::<Vec<_>>(),
                offset,
            )
        })
}
pub fn gain_at(note: &ScoreNote, offset: f64) -> f64 {
    note.gain_envelope.as_ref().map_or(1.0, |points| {
        interpolate(
            &points
                .iter()
                .map(|point| (point.tick, point.gain))
                .collect::<Vec<_>>(),
            offset,
        )
    })
}
pub fn transpose_note(note: &ScoreNote, millicents: i64) -> CoreResult<ScoreNote> {
    let mut result = note.clone();
    let shift = |pitch: i64| {
        pitch
            .checked_add(millicents)
            .filter(|pitch| pitch.unsigned_abs() <= MAX_SAFE)
            .ok_or_else(|| invalid("Transposed pitch exceeds safe integer range."))
    };
    result.pitch.millicents = shift(result.pitch.millicents)?;
    for point in result.pitch_envelope.iter_mut().flatten() {
        point.pitch.millicents = shift(point.pitch.millicents)?;
    }
    Ok(result)
}
pub fn map_note_time(
    note: &ScoreNote,
    scale: impl Fn(u64) -> CoreResult<u64>,
) -> CoreResult<ScoreNote> {
    let mut result = note.clone();
    result.onset = scale(result.onset)?;
    result.duration = scale(result.duration)?;
    for point in result.pitch_envelope.iter_mut().flatten() {
        point.tick = scale(point.tick)?;
    }
    for point in result.gain_envelope.iter_mut().flatten() {
        point.tick = scale(point.tick)?;
    }
    Ok(result)
}
pub fn note_times(note: &ScoreNote) -> Vec<u64> {
    let mut result = vec![note.onset, note.duration];
    result.extend(note.pitch_envelope.iter().flatten().map(|point| point.tick));
    result.extend(note.gain_envelope.iter().flatten().map(|point| point.tick));
    result
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CroppedTrajectories {
    pub pitch: Pitch,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pitch_envelope: Option<Vec<PitchEnvelopePoint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub gain_envelope: Option<Vec<GainEnvelopePoint>>,
}
pub fn crop_note_trajectories(
    note: &ScoreNote,
    offset: u64,
    duration: u64,
) -> CoreResult<CroppedTrajectories> {
    let end = offset
        .checked_add(duration)
        .filter(|&end| end <= note.duration)
        .ok_or_else(|| invalid("Invalid trajectory crop."))?;
    let rounded_pitch = |tick: u64| Pitch {
        millicents: (pitch_at(note, tick as f64) + 0.5).floor() as i64,
    };
    let pitch = rounded_pitch(offset);
    let pitch_envelope = note.pitch_envelope.as_ref().map(|points| {
        let mut out = vec![PitchEnvelopePoint { tick: 0, pitch }];
        out.extend(
            points
                .iter()
                .filter(|point| point.tick > offset && point.tick < end)
                .map(|point| PitchEnvelopePoint {
                    tick: point.tick - offset,
                    pitch: point.pitch,
                }),
        );
        if duration > 0 {
            out.push(PitchEnvelopePoint {
                tick: duration,
                pitch: rounded_pitch(end),
            });
        }
        out
    });
    let gain_envelope = note.gain_envelope.as_ref().map(|points| {
        let mut out = vec![GainEnvelopePoint {
            tick: 0,
            gain: gain_at(note, offset as f64),
        }];
        out.extend(
            points
                .iter()
                .filter(|point| point.tick > offset && point.tick < end)
                .map(|point| GainEnvelopePoint {
                    tick: point.tick - offset,
                    gain: point.gain,
                }),
        );
        if duration > 0 {
            out.push(GainEnvelopePoint {
                tick: duration,
                gain: gain_at(note, end as f64),
            });
        }
        out
    });
    Ok(CroppedTrajectories {
        pitch,
        pitch_envelope,
        gain_envelope,
    })
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum SliceBoundary {
    Clip,
    Drop,
    Reject,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SliceOptions {
    pub boundary: SliceBoundary,
    #[serde(default)]
    pub selection: ScoreSelection,
}
pub fn slice_score(
    score: &Score,
    start: u64,
    end: u64,
    options: &SliceOptions,
) -> CoreResult<Score> {
    validate_score(score)?;
    if start >= end || end > score.duration {
        return Err(invalid("Invalid score window."));
    }
    let mut notes = vec![];
    for note in select_notes(score, &options.selection)? {
        let finish = note.onset + note.duration;
        if note.onset >= end
            || if note.duration > 0 {
                finish <= start
            } else {
                note.onset < start
            }
        {
            continue;
        }
        let crosses = note.onset < start || finish > end;
        match (&options.boundary, crosses) {
            (SliceBoundary::Reject, true) => {
                return Err(invalid(format!(
                    "Note {} crosses the slice boundary.",
                    note.id
                )));
            }
            (SliceBoundary::Drop, true) => continue,
            _ => (),
        }
        let begin = note.onset.max(start);
        let finish = finish.min(end);
        let crop = crop_note_trajectories(note, begin - note.onset, finish - begin)?;
        let mut note = note.clone();
        note.onset = begin - start;
        note.duration = finish - begin;
        note.pitch = crop.pitch;
        note.pitch_envelope = crop.pitch_envelope;
        note.gain_envelope = crop.gain_envelope;
        notes.push(note);
    }
    let mut result = score.clone();
    result.duration = end - start;
    result.notes = notes;
    result.attachments = score
        .attachments
        .iter()
        .filter(|event| event.tick >= start && event.tick < end)
        .map(|event| {
            let mut event = event.clone();
            event.tick -= start;
            event
        })
        .collect();
    result.track_ends = score
        .track_ends
        .iter()
        .map(|&tick| tick.min(end).saturating_sub(start))
        .collect();
    validate_score(&result)?;
    Ok(result)
}
pub fn transpose_score(
    score: &Score,
    millicents: i64,
    selection: &ScoreSelection,
) -> CoreResult<Score> {
    validate_score(score)?;
    if millicents.unsigned_abs() > MAX_SAFE {
        return Err(invalid("Transposition must be integer millicents."));
    }
    let selected: HashSet<_> = select_notes(score, selection)?
        .iter()
        .map(|note| note.id.as_str())
        .collect();
    let mut result = score.clone();
    result.notes = score
        .notes
        .iter()
        .map(|note| {
            if selected.contains(note.id.as_str()) {
                transpose_note(note, millicents)
            } else {
                Ok(note.clone())
            }
        })
        .collect::<CoreResult<_>>()?;
    validate_score(&result)?;
    Ok(result)
}
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}
pub fn stretch_score(score: &Score, mut numerator: u64, mut denominator: u64) -> CoreResult<Score> {
    validate_score(score)?;
    if numerator == 0 || denominator == 0 || numerator > MAX_SAFE || denominator > MAX_SAFE {
        return Err(invalid("Stretch ratio must use positive safe integers."));
    }
    let divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    let mut common = gcd(denominator, score.duration);
    for &tick in &score.track_ends {
        common = gcd(common, tick);
    }
    for note in &score.notes {
        for tick in note_times(note) {
            common = gcd(common, tick);
        }
    }
    for event in &score.attachments {
        common = gcd(common, event.tick);
    }
    let exact = |value: u64, n: u64, d: u64| -> CoreResult<u64> {
        let result = u128::from(value) * u128::from(n);
        if result % u128::from(d) != 0 {
            return Err(invalid("Time conversion is not exact."));
        }
        let result = result / u128::from(d);
        if result > u128::from(MAX_SAFE) {
            return Err(invalid("Stretched score exceeds safe integer time."));
        }
        Ok(result as u64)
    };
    let scale = |tick| exact(tick, numerator, common);
    let mut result = score.clone();
    result.ppq = exact(score.ppq, denominator / common, 1)?;
    result.duration = scale(score.duration)?;
    result.track_ends = score
        .track_ends
        .iter()
        .map(|&tick| scale(tick))
        .collect::<CoreResult<_>>()?;
    result.notes = score
        .notes
        .iter()
        .map(|note| map_note_time(note, scale))
        .collect::<CoreResult<_>>()?;
    for event in &mut result.attachments {
        event.tick = scale(event.tick)?;
    }
    validate_score(&result)?;
    Ok(result)
}
