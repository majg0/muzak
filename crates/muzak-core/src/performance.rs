use crate::{
    error::{CoreResult, invalid},
    midi::midi_payload,
    model::*,
    operations::{gain_at, pitch_at},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use ts_rs::TS;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TempoPoint {
    pub tick: u64,
    pub seconds: f64,
    pub microseconds: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AutomationPoint {
    pub seconds: f64,
    pub value: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PerformedNote {
    pub note: ScoreNote,
    pub start: f64,
    pub end: f64,
    pub percussion: bool,
    pub pitch: Vec<AutomationPoint>,
    pub note_gain: Vec<AutomationPoint>,
    pub gain: Vec<AutomationPoint>,
    pub bend: Vec<AutomationPoint>,
    pub pan: Vec<AutomationPoint>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompiledPerformance {
    pub notes: Vec<PerformedNote>,
    pub duration: f64,
    pub warnings: Vec<String>,
    pub from_tick: f64,
    pub to_tick: f64,
    pub tempos: Vec<TempoPoint>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from_tick: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub to_tick: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parts: Option<Vec<String>>,
}
fn ordered(score: &Score) -> Vec<&ScoreAttachment> {
    let mut events: Vec<_> = score.attachments.iter().collect();
    events.sort_by_key(|e| (e.tick, e.track, e.order));
    events
}
pub fn tempo_map(score: &Score) -> CoreResult<Vec<TempoPoint>> {
    validate_score(score)?;
    let mut out = vec![TempoPoint {
        tick: 0,
        seconds: 0.0,
        microseconds: 500000,
    }];
    for event in ordered(score) {
        if !event.bytes.starts_with(&[255, 81]) {
            continue;
        }
        let data = midi_payload(&event.bytes)?;
        if data.len() != 3 {
            return Err(invalid("Tempo metadata must contain three bytes."));
        }
        let microseconds =
            u32::from(data[0]) * 65536 + u32::from(data[1]) * 256 + u32::from(data[2]);
        if microseconds == 0 {
            return Err(invalid("Tempo must be positive."));
        }
        let previous = out.last().unwrap();
        let point = TempoPoint {
            tick: event.tick,
            seconds: previous.seconds
                + (event.tick - previous.tick) as f64 / score.ppq as f64
                    * f64::from(previous.microseconds)
                    / 1e6,
            microseconds,
        };
        if point.tick == previous.tick {
            *out.last_mut().unwrap() = point;
        } else {
            out.push(point);
        }
    }
    Ok(out)
}
/// Public wire callers may supply maps, unlike the already validated internal
/// performance path. Reject malformed maps before indexed interpolation.
pub fn validate_tempo_points(ppq: u64, tempos: &[TempoPoint]) -> CoreResult<()> {
    if ppq == 0
        || ppq > MAX_SAFE
        || tempos
            .first()
            .is_none_or(|p| p.tick != 0 || p.seconds != 0.0)
        || tempos.iter().any(|p| {
            p.tick > MAX_SAFE || !p.seconds.is_finite() || p.seconds < 0.0 || p.microseconds == 0
        })
        || tempos
            .windows(2)
            .any(|p| p[0].tick >= p[1].tick || p[0].seconds >= p[1].seconds)
    {
        return Err(invalid("Invalid tempo map or timebase."));
    }
    Ok(())
}
pub fn tick_to_seconds(tick: f64, ppq: u64, tempos: &[TempoPoint]) -> f64 {
    let i = tempos
        .partition_point(|p| p.tick as f64 <= tick)
        .saturating_sub(1);
    let p = &tempos[i];
    p.seconds + (tick - p.tick as f64) / ppq as f64 * f64::from(p.microseconds) / 1e6
}
pub fn seconds_to_tick(seconds: f64, ppq: u64, tempos: &[TempoPoint]) -> f64 {
    let i = tempos
        .partition_point(|p| p.seconds <= seconds)
        .saturating_sub(1);
    let p = &tempos[i];
    p.tick as f64 + (seconds - p.seconds) * 1e6 / f64::from(p.microseconds) * ppq as f64
}
#[derive(Clone)]
struct ChannelPoint {
    tick: u64,
    track: i64,
    order: i64,
    gain: f64,
    pan: f64,
    bend: f64,
    pedal: bool,
}
struct State {
    volume: u8,
    expression: u8,
    pan: u8,
    wheel: u16,
    range: u8,
    cents: u8,
    rpn_high: u8,
    rpn_low: u8,
    rpn_selected: bool,
    pedal: bool,
}
fn before(points: &[ChannelPoint], tick: f64, track: i64, order: i64) -> usize {
    points
        .partition_point(|p| {
            (p.tick as f64) < tick
                || p.tick as f64 == tick
                    && (p.track < track || p.track == track && p.order <= order)
        })
        .saturating_sub(1)
}
pub fn compile_performance(
    score: &Score,
    options: &PerformanceOptions,
) -> CoreResult<CompiledPerformance> {
    validate_score(score)?;
    let (from_tick, to_tick) = (
        options.from_tick.unwrap_or(0.0),
        options.to_tick.unwrap_or(score.duration as f64),
    );
    if !from_tick.is_finite()
        || !to_tick.is_finite()
        || from_tick < 0.0
        || to_tick < from_tick
        || to_tick > score.duration as f64
    {
        return Err(invalid("Invalid audition interval."));
    }
    let tempos = tempo_map(score)?;
    let origin = tick_to_seconds(from_tick, score.ppq, &tempos);
    let seconds = |tick| tick_to_seconds(tick, score.ppq, &tempos) - origin;
    let mut channels = vec![
        vec![ChannelPoint {
            tick: 0,
            track: -1,
            order: -1,
            gain: 1.0,
            pan: 0.0,
            bend: 0.0,
            pedal: false
        }];
        16
    ];
    let mut states: Vec<_> = (0..16)
        .map(|_| State {
            volume: 127,
            expression: 127,
            pan: 64,
            wheel: 8192,
            range: 2,
            cents: 0,
            rpn_high: 127,
            rpn_low: 127,
            rpn_selected: true,
            pedal: false,
        })
        .collect();
    let mut unsupported = BTreeSet::new();
    let (mut has_bend, mut has_program, mut has_opaque, mut has_pressure) =
        (false, false, false, false);
    for event in ordered(score) {
        let status = event.bytes[0];
        let kind = status & 240;
        let channel = (status & 15) as usize;
        if status == 240 || status == 247 || status == 255 && event.bytes.get(1) == Some(&33) {
            has_opaque = true;
        }
        if kind == 192 {
            has_program = true;
        }
        if kind == 160 || kind == 208 {
            has_pressure = true;
        }
        if kind != 176 && kind != 224 {
            continue;
        }
        let (a, b) = (event.bytes[1], event.bytes[2]);
        let s = &mut states[channel];
        if kind == 224 {
            s.wheel = u16::from(a) + u16::from(b) * 128;
            has_bend = true;
        } else {
            match a {
                7 => s.volume = b,
                11 => s.expression = b,
                10 => s.pan = b,
                64 => s.pedal = b >= 64,
                101 => {
                    s.rpn_high = b;
                    s.rpn_selected = true;
                }
                100 => {
                    s.rpn_low = b;
                    s.rpn_selected = true;
                }
                98 | 99 => {
                    s.rpn_selected = false;
                    unsupported.insert(a);
                    continue;
                }
                6 => {
                    if s.rpn_selected && s.rpn_high == 0 && s.rpn_low == 0 {
                        s.range = b;
                    } else {
                        unsupported.insert(a);
                    }
                }
                38 => {
                    if s.rpn_selected && s.rpn_high == 0 && s.rpn_low == 0 {
                        s.cents = b;
                    } else {
                        unsupported.insert(a);
                    }
                }
                _ => {
                    unsupported.insert(a);
                    continue;
                }
            }
        }
        channels[channel].push(ChannelPoint {
            tick: event.tick,
            track: event.track as i64,
            order: event.order as i64,
            gain: f64::from(s.volume) / 127.0 * f64::from(s.expression) / 127.0,
            pan: (f64::from(s.pan) - 64.0) / 64.0,
            bend: (f64::from(s.wheel) - 8192.0) / 8192.0
                * (f64::from(s.range) + f64::from(s.cents) / 100.0),
            pedal: s.pedal,
        });
    }
    let parts: HashMap<_, _> = score.parts.iter().map(|p| (&p.id, p)).collect();
    let mut notes = vec![];
    for note in &score.notes {
        if options
            .parts
            .as_ref()
            .is_some_and(|parts| !parts.contains(&note.part))
        {
            continue;
        }
        let part = parts[&note.part];
        let points = &channels[part.channel as usize];
        let key_end = note.onset + note.duration;
        let mut release = key_end;
        let at_release = before(
            points,
            key_end as f64,
            part.track as i64,
            note.source
                .as_ref()
                .map_or(i64::MAX, |s| s.off_order as i64),
        );
        if points[at_release].pedal && !part.percussion {
            release = points
                .iter()
                .skip(at_release + 1)
                .find(|p| !p.pedal)
                .map_or(score.duration, |p| p.tick);
        }
        let start = from_tick.max(note.onset as f64);
        let end = to_tick.min(release as f64);
        if end <= start || note.onset as f64 >= to_tick {
            continue;
        }
        let initial = if start == note.onset as f64 {
            before(
                points,
                start,
                part.track as i64,
                note.source.as_ref().map_or(i64::MAX, |s| s.on_order as i64),
            )
        } else {
            before(points, start, i64::MAX, i64::MAX)
        };
        let automation = |sample: fn(&ChannelPoint) -> f64| {
            let mut out = vec![AutomationPoint {
                seconds: seconds(start),
                value: sample(&points[initial]),
            }];
            for point in points
                .iter()
                .skip(initial + 1)
                .take_while(|p| (p.tick as f64) < end)
            {
                let value = sample(point);
                if value != out.last().unwrap().value {
                    out.push(AutomationPoint {
                        seconds: seconds(point.tick as f64),
                        value,
                    });
                }
            }
            out
        };
        let trajectory = |knots: Option<Vec<u64>>, sample: fn(&ScoreNote, f64) -> f64| {
            let mut ticks = vec![start, end];
            if let Some(knots) = knots {
                for tick in knots {
                    let tick = (note.onset + tick) as f64;
                    if tick > start && tick < end {
                        ticks.push(tick);
                    }
                }
                for tempo in &tempos {
                    let tick = tempo.tick as f64;
                    if tick > start && tick < end {
                        ticks.push(tick);
                    }
                }
            }
            ticks.sort_by(f64::total_cmp);
            ticks.dedup();
            ticks
                .into_iter()
                .map(|tick| AutomationPoint {
                    seconds: seconds(tick),
                    value: sample(note, tick - note.onset as f64),
                })
                .collect()
        };
        notes.push(PerformedNote {
            note: note.clone(),
            start: seconds(start),
            end: seconds(end),
            percussion: part.percussion,
            pitch: trajectory(
                note.pitch_envelope
                    .as_ref()
                    .map(|points| points.iter().map(|p| p.tick).collect()),
                pitch_at,
            ),
            note_gain: trajectory(
                note.gain_envelope
                    .as_ref()
                    .map(|points| points.iter().map(|p| p.tick).collect()),
                gain_at,
            ),
            gain: automation(|p| p.gain),
            bend: automation(|p| p.bend),
            pan: automation(|p| p.pan),
        });
    }
    notes.sort_by(|a, b| a.start.total_cmp(&b.start).then(a.note.id.cmp(&b.note.id)));
    let mut warnings = vec![
        "Audition uses a simple synthesized tone; it does not reproduce the source instruments."
            .into(),
    ];
    if has_program {
        warnings.push("Program changes are preserved in MIDI export; audition uses one tone per pitched part.".into());
    }
    if !unsupported.is_empty() {
        warnings.push(format!(
            "Audition ignores controllers {}; export retains them.",
            unsupported
                .iter()
                .map(u8::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if has_bend {
        warnings.push("Pitch bend uses MIDI RPN 0 sensitivity, or the standard ±2-semitone default when unspecified.".into());
    }
    if has_opaque {
        warnings.push(
            "SysEx and MIDI port routing are retained but not interpreted for audition.".into(),
        );
    }
    if has_pressure {
        warnings.push("Aftertouch is retained but not interpreted for audition.".into());
    }
    Ok(CompiledPerformance {
        notes,
        duration: seconds(to_tick),
        warnings,
        from_tick,
        to_tick,
        tempos,
    })
}
