use crate::{
    error::{CoreResult, invalid},
    model::*,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct MidiEvent {
    pub tick: u64,
    #[serde(deserialize_with = "deserialize_midi_bytes")]
    pub bytes: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct MidiFile {
    pub format: u8,
    pub ppq: u64,
    pub tracks: Vec<Vec<MidiEvent>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ImportedMidi {
    pub score: Score,
    pub issues: Vec<ScoreIssue>,
}

pub fn deserialize_midi_bytes<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<u8>, D::Error> {
    Vec::<u8>::deserialize(deserializer)
        .map_err(|_| serde::de::Error::custom("Invalid MIDI event byte."))
}

struct Reader<'a> {
    data: &'a [u8],
    position: usize,
}
impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0 }
    }
    fn byte(&mut self) -> CoreResult<u8> {
        let byte = *self
            .data
            .get(self.position)
            .ok_or_else(|| invalid("Truncated MIDI event or chunk."))?;
        self.position += 1;
        Ok(byte)
    }
    fn take(&mut self, length: usize) -> CoreResult<&'a [u8]> {
        let end = self
            .position
            .checked_add(length)
            .filter(|&end| end <= self.data.len())
            .ok_or_else(|| invalid("Truncated MIDI payload or chunk."))?;
        let bytes = &self.data[self.position..end];
        self.position = end;
        Ok(bytes)
    }
    fn uint(&mut self, length: usize) -> CoreResult<u64> {
        Ok(self
            .take(length)?
            .iter()
            .fold(0, |value, &byte| value * 256 + u64::from(byte)))
    }
    fn vlq(&mut self) -> CoreResult<u64> {
        let mut value = 0;
        for _ in 0..4 {
            let byte = self.byte()?;
            value = value * 128 + u64::from(byte & 127);
            if byte < 128 {
                return Ok(value);
            }
        }
        Err(invalid("MIDI variable-length value exceeds four bytes."))
    }
}
struct ParsedEvent {
    bytes: Vec<u8>,
    payload: Vec<u8>,
    running: Option<u8>,
}
fn read_event(reader: &mut Reader, running: Option<u8>) -> CoreResult<ParsedEvent> {
    let start = reader.position;
    let first = reader.byte()?;
    let status = if first < 128 {
        reader.position -= 1;
        running.ok_or_else(|| invalid("MIDI running status has no preceding channel status."))?
    } else {
        first
    };
    if (0x80..=0xef).contains(&status) {
        let length = if status & 0xf0 == 0xc0 || status & 0xf0 == 0xd0 {
            1
        } else {
            2
        };
        let payload = reader.take(length)?.to_vec();
        if payload.iter().any(|&value| value >= 128) {
            return Err(invalid("MIDI channel data must use seven-bit bytes."));
        }
        let mut bytes = vec![status];
        bytes.extend_from_slice(&payload);
        return Ok(ParsedEvent {
            bytes,
            payload,
            running: Some(status),
        });
    }
    if status == 0xff || status == 0xf0 || status == 0xf7 {
        let kind = if status == 0xff {
            Some(reader.byte()?)
        } else {
            None
        };
        if kind.is_some_and(|value| value >= 128) {
            return Err(invalid("MIDI meta-event type must use seven bits."));
        }
        let length = reader.vlq()? as usize;
        let payload = reader.take(length)?.to_vec();
        if kind == Some(0x2f) && !payload.is_empty() {
            return Err(invalid(
                "MIDI end-of-track event must have an empty payload.",
            ));
        }
        return Ok(ParsedEvent {
            bytes: reader.data[start..reader.position].to_vec(),
            payload,
            running: None,
        });
    }
    Err(invalid(format!(
        "Unsupported MIDI file event status 0x{status:x}."
    )))
}
fn checked_event(bytes: &[u8]) -> CoreResult<ParsedEvent> {
    let mut reader = Reader::new(bytes);
    let event = read_event(&mut reader, None)?;
    if reader.position != bytes.len() {
        return Err(invalid("MIDI event contains trailing bytes."));
    }
    Ok(event)
}
pub fn midi_payload(bytes: &[u8]) -> CoreResult<Vec<u8>> {
    Ok(checked_event(bytes)?.payload)
}
fn vlq(mut value: u64) -> CoreResult<Vec<u8>> {
    if value > 0x0fff_ffff {
        return Err(invalid("MIDI delta time exceeds the four-byte VLQ range."));
    }
    let mut bytes = vec![(value % 128) as u8];
    value /= 128;
    while value > 0 {
        bytes.push((value % 128) as u8 | 128);
        value /= 128;
    }
    bytes.reverse();
    Ok(bytes)
}
pub fn midi_meta(kind: u8, payload: &[u8]) -> CoreResult<Vec<u8>> {
    let mut bytes = vec![0xff, kind];
    bytes.extend(vlq(payload.len() as u64)?);
    bytes.extend_from_slice(payload);
    Ok(checked_event(&bytes)?.bytes)
}
pub fn read_midi(bytes: &[u8]) -> CoreResult<MidiFile> {
    let mut reader = Reader::new(bytes);
    if reader.uint(4)? != 0x4d546864 {
        return Err(invalid("Expected a Standard MIDI file (MThd header)."));
    }
    let length = reader.uint(4)? as usize;
    let mut header = Reader::new(reader.take(length)?);
    if header.data.len() < 6 {
        return Err(invalid(
            "MIDI header must contain format, track count and division.",
        ));
    }
    let format = header.uint(2)?;
    if format == 2 {
        return Err(invalid("Type 2 asynchronous MIDI files are not supported."));
    }
    if format > 1 {
        return Err(invalid(format!("Unsupported MIDI format {format}.")));
    }
    let track_count = header.uint(2)?;
    if track_count == 0 || (format == 0 && track_count != 1) {
        return Err(invalid("Invalid MIDI format/track count."));
    }
    let ppq = header.uint(2)?;
    if ppq & 0x8000 != 0 {
        return Err(invalid(
            "SMPTE MIDI timebases are not supported; a PPQ timebase is required.",
        ));
    }
    if ppq == 0 {
        return Err(invalid("MIDI PPQ must be positive."));
    }
    let mut tracks = Vec::new();
    for _ in 0..track_count {
        if reader.uint(4)? != 0x4d54726b {
            return Err(invalid("Expected a MIDI track chunk (MTrk)."));
        }
        let length = reader.uint(4)? as usize;
        let mut data = Reader::new(reader.take(length)?);
        let (mut tick, mut running, mut ended) = (0u64, None, false);
        let mut events = Vec::new();
        while data.position < data.data.len() {
            if ended {
                return Err(invalid("MIDI events appear after end-of-track."));
            }
            tick = tick
                .checked_add(data.vlq()?)
                .filter(|&tick| tick <= MAX_SAFE)
                .ok_or_else(|| invalid("MIDI absolute tick exceeds safe integer precision."))?;
            let event = read_event(&mut data, running)?;
            running = event.running;
            ended = event.bytes.starts_with(&[0xff, 0x2f]);
            events.push(MidiEvent {
                tick,
                bytes: event.bytes,
            });
        }
        if !ended {
            return Err(invalid("MIDI track is missing its end-of-track event."));
        }
        tracks.push(events);
    }
    if reader.position != bytes.len() {
        return Err(invalid("Unexpected data after declared MIDI tracks."));
    }
    Ok(MidiFile {
        format: format as u8,
        ppq,
        tracks,
    })
}
pub fn write_midi(file: &MidiFile) -> CoreResult<Vec<u8>> {
    if file.format > 1 {
        return Err(invalid("Only MIDI formats 0 and 1 are supported."));
    }
    if file.ppq == 0 || file.ppq > 32767 {
        return Err(invalid("MIDI PPQ must be between 1 and 32767."));
    }
    if file.tracks.is_empty()
        || file.tracks.len() > 65535
        || (file.format == 0 && file.tracks.len() != 1)
    {
        return Err(invalid("Invalid MIDI format/track count."));
    }
    let mut output = vec![0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6];
    output.extend(u16::from(file.format).to_be_bytes());
    output.extend((file.tracks.len() as u16).to_be_bytes());
    output.extend((file.ppq as u16).to_be_bytes());
    for track in &file.tracks {
        let (mut previous, mut ended) = (0, false);
        let mut body = Vec::new();
        for event in track {
            if ended {
                return Err(invalid("MIDI events appear after end-of-track."));
            }
            if event.tick > MAX_SAFE || event.tick < previous {
                return Err(invalid(
                    "MIDI events must have ordered nonnegative integer ticks.",
                ));
            }
            let bytes = checked_event(&event.bytes)?.bytes;
            body.extend(vlq(event.tick - previous)?);
            body.extend_from_slice(&bytes);
            previous = event.tick;
            ended = bytes.starts_with(&[0xff, 0x2f]);
        }
        if !ended {
            return Err(invalid("MIDI track is missing its end-of-track event."));
        }
        let size = u32::try_from(body.len())
            .map_err(|_| invalid("MIDI header or chunk length exceeds its field."))?;
        output.extend_from_slice(b"MTrk");
        output.extend(size.to_be_bytes());
        output.extend(body);
    }
    Ok(output)
}
pub fn import_midi(bytes: &[u8]) -> CoreResult<ImportedMidi> {
    let file = read_midi(bytes)?;
    let mut score = Score {
        ppq: file.ppq,
        midi_format: Some(file.format),
        duration: 0,
        parts: vec![],
        notes: vec![],
        attachments: vec![],
        track_ends: vec![],
    };
    let mut issues = Vec::new();
    for (track, events) in file.tracks.iter().enumerate() {
        let name = if let Some(event) = events
            .iter()
            .find(|event| event.bytes.starts_with(&[0xff, 3]))
        {
            String::from_utf8_lossy(&midi_payload(&event.bytes)?)
                .trim_start_matches('\u{feff}')
                .to_string()
        } else {
            format!("Track {}", track + 1)
        };
        let mut parts = HashMap::new();
        let mut active: BTreeMap<(u8, u8), VecDeque<(&MidiEvent, usize)>> = BTreeMap::new();
        let end = events.last().unwrap().tick;
        score.track_ends.push(end);
        score.duration = score.duration.max(end);
        let attach = |event: &MidiEvent, order: usize| ScoreAttachment {
            tick: event.tick,
            bytes: event.bytes.clone(),
            track,
            order: order as u64,
        };
        for (order, event) in events.iter().enumerate() {
            let status = event.bytes[0];
            let command = status & 0xf0;
            if command != 0x80 && command != 0x90 {
                score.attachments.push(attach(event, order));
                continue;
            }
            let (pitch, velocity, channel) = (event.bytes[1], event.bytes[2], status & 15);
            let queue = active.entry((channel, pitch)).or_default();
            if command == 0x90 && velocity > 0 {
                parts.entry(channel).or_insert_with(|| {
                    let part = ScorePart {
                        id: format!("track-{track}-channel-{channel}"),
                        name: name.clone(),
                        track,
                        channel,
                        percussion: channel == 9,
                    };
                    score.parts.push(part.clone());
                    part
                });
                if !queue.is_empty() {
                    issues.push(ScoreIssue {
                        kind: "overlapping-pitch".into(),
                        track: Some(track),
                        tick: Some(event.tick),
                        message: format!(
                            "Overlapping note {pitch} on channel {}; note-offs paired FIFO.",
                            channel + 1
                        ),
                    });
                }
                queue.push_back((event, order));
            } else if let Some((start, on_order)) = queue.pop_front() {
                score.notes.push(ScoreNote {
                    id: format!("note-{track}-{on_order}"),
                    part: parts[&channel].id.clone(),
                    onset: start.tick,
                    duration: event.tick - start.tick,
                    pitch: Pitch {
                        millicents: i64::from(pitch) * 100000,
                    },
                    velocity: start.bytes[2],
                    release_velocity: velocity,
                    pitch_envelope: None,
                    gain_envelope: None,
                    source: Some(NoteSource {
                        on_order: on_order as u64,
                        off_order: order as u64,
                        off_status: status,
                    }),
                });
            } else {
                score.attachments.push(attach(event, order));
                issues.push(ScoreIssue { kind: "unmatched-note-off".into(), track: Some(track), tick: Some(event.tick), message: format!("Note-off for {pitch} on channel {} has no active note; retained as an attachment.", channel + 1) });
            }
        }
        for queue in active.values() {
            for &(event, order) in queue {
                score.attachments.push(attach(event, order));
                issues.push(ScoreIssue { kind: "unclosed-note".into(), track: Some(track), tick: Some(event.tick), message: "Note-on has no corresponding release; retained as an attachment without inventing duration.".into() });
            }
        }
    }
    score
        .notes
        .sort_by(|a, b| a.onset.cmp(&b.onset).then(a.id.cmp(&b.id)));
    score
        .attachments
        .sort_by_key(|event| (event.track, event.tick, event.order));
    validate_score(&score)?;
    Ok(ImportedMidi { score, issues })
}
pub fn export_score_midi(score: &Score) -> CoreResult<Vec<u8>> {
    validate_score(score)?;
    let mut tracks: Vec<Vec<(MidiEvent, u64, u8)>> =
        score.track_ends.iter().map(|_| vec![]).collect();
    let mut endings = HashMap::new();
    for event in &score.attachments {
        if event.bytes.starts_with(&[0xff, 0x2f]) {
            if endings.insert(event.track, event.bytes.clone()).is_some() {
                return Err(invalid("Multiple end-of-track attachments in one track."));
            }
        } else {
            tracks[event.track].push((
                MidiEvent {
                    tick: event.tick,
                    bytes: event.bytes.clone(),
                },
                event.order,
                0,
            ));
        }
    }
    let parts: HashMap<_, _> = score.parts.iter().map(|part| (&part.id, part)).collect();
    for note in &score.notes {
        if note.pitch_envelope.is_some() || note.gain_envelope.is_some() {
            return Err(invalid(format!(
                "Note {}: standard MIDI export cannot preserve native pitch glides or per-note gain trajectories. Keep the native Score instead.",
                note.id
            )));
        }
        let pitch = note.pitch.millicents / 100000;
        if note.pitch.millicents % 100000 != 0 || !(0..=127).contains(&pitch) {
            return Err(invalid(format!(
                "Note {} is not exactly representable as an integer MIDI key; no pitch rounding is performed.",
                note.id
            )));
        }
        let part = parts[&note.part];
        let source = note.source.as_ref();
        let off_command = source.map_or(0x80, |source| source.off_status & 0xf0);
        tracks[part.track].push((
            MidiEvent {
                tick: note.onset,
                bytes: vec![0x90 | part.channel, pitch as u8, note.velocity],
            },
            source.map_or(MAX_SAFE, |source| source.on_order),
            1,
        ));
        tracks[part.track].push((
            MidiEvent {
                tick: note.onset + note.duration,
                bytes: vec![
                    off_command | part.channel,
                    pitch as u8,
                    note.release_velocity,
                ],
            },
            source.map_or(MAX_SAFE, |source| source.off_order),
            if note.duration == 0 { 2 } else { 0 },
        ));
    }
    let mut events = Vec::new();
    for (index, mut track) in tracks.into_iter().enumerate() {
        if track
            .iter()
            .any(|(event, _, _)| event.tick > score.track_ends[index])
        {
            return Err(invalid("A score event exceeds its track ending."));
        }
        track.sort_by_key(|(event, order, phase)| (event.tick, *order, *phase));
        let mut result: Vec<_> = track.into_iter().map(|(event, _, _)| event).collect();
        result.push(MidiEvent {
            tick: score.track_ends[index],
            bytes: endings
                .remove(&index)
                .unwrap_or_else(|| vec![0xff, 0x2f, 0]),
        });
        events.push(result);
    }
    write_midi(&MidiFile {
        format: score
            .midi_format
            .unwrap_or(if events.len() == 1 { 0 } else { 1 }),
        ppq: score.ppq,
        tracks: events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_order_and_empty_notes_round_trip() {
        let file = MidiFile {
            format: 1,
            ppq: 960,
            tracks: vec![vec![
                MidiEvent {
                    tick: 0,
                    bytes: vec![0x90, 60, 90],
                },
                MidiEvent {
                    tick: 0,
                    bytes: vec![0x90, 60, 0],
                },
                MidiEvent {
                    tick: 0,
                    bytes: vec![0x90, 60, 100],
                },
                MidiEvent {
                    tick: 20,
                    bytes: vec![0x80, 60, 42],
                },
                MidiEvent {
                    tick: 50,
                    bytes: vec![0xff, 0x2f, 0],
                },
            ]],
        };
        let bytes = write_midi(&file).unwrap();
        let imported = import_midi(&bytes).unwrap();
        assert_eq!(imported.score.notes.len(), 2);
        assert_eq!(imported.score.notes[0].duration, 0);
        assert_eq!(export_score_midi(&imported.score).unwrap(), bytes);
    }
    #[test]
    fn malformed_and_native_pitch_are_rejected() {
        assert!(read_midi(b"invalid").is_err());
        assert!(midi_payload(&[0x90, 200, 3]).is_err());
        assert!(midi_payload(&[0xff, 0x2f, 1, 0]).is_err());
    }
}
