//! Seeded phrase composition through the same program algebra used by the codec.
use crate::{composition::*, error::{invalid, CoreResult}, model::*};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
pub enum GeneratorMode { Major, Minor, #[default] Dorian, Lydian }
impl GeneratorMode {
    fn intervals(self) -> [i64; 7] {
        match self {
            Self::Major => [0,2,4,5,7,9,11], Self::Minor => [0,2,3,5,7,8,10],
            Self::Dorian => [0,2,3,5,7,9,10], Self::Lydian => [0,2,4,6,7,9,11],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneratorOptions {
    pub seed: u32,
    pub tempo: f64,
    pub phrases: u32,
    pub bars_per_phrase: u32,
    pub beats_per_bar: u32,
    pub density: f64,
    pub variation: f64,
    pub color: f64,
    pub tonic: u8,
    pub mode: GeneratorMode,
}
impl Default for GeneratorOptions {
    fn default() -> Self { Self { seed: 1, tempo: 104., phrases: 4, bars_per_phrase: 4,
        beats_per_bar: 4, density: 0.6, variation: 0.35, color: 0.6, tonic: 2, mode: GeneratorMode::Dorian } }
}

struct Random(u64);
impl Random {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut x = self.0;
        x = (x ^ (x >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((x ^ (x >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }
    fn index(&mut self, n: usize) -> usize { (self.next() * n as f64) as usize }
}
fn place(material: String, onset: u64, bindings: Vec<PitchBinding>) -> MaterialPlacement {
    MaterialPlacement { material, onset, transpose_millicents: None, time_scale: None,
        velocity_scale: None, part_map: None, pitch_bindings: (!bindings.is_empty()).then_some(bindings) }
}
fn note(id: String, part: &str, onset: u64, duration: u64, velocity: u8) -> ScoreNote {
    ScoreNote { id, part: part.into(), onset, duration, pitch: Pitch { millicents: 0 },
        velocity, release_velocity: 64, pitch_envelope: None, gain_envelope: None, source: None }
}
fn degree_pitch(degree: i64, options: &GeneratorOptions) -> i64 {
    (i64::from(options.tonic) + 12 * degree.div_euclid(7) + options.mode.intervals()[degree.rem_euclid(7) as usize]) * 100_000
}
fn harmonic_binding(pitch: i64, frame: &CompositionHarmony) -> PitchBinding {
    frame.intervals.iter().enumerate().find_map(|(tone, interval)| {
        let delta = pitch - frame.root_millicents - interval;
        (delta.rem_euclid(1_200_000) == 0).then(|| PitchBinding::Harmony {
            harmony: frame.id.clone(), tone, octave: delta.div_euclid(1_200_000), residual_millicents: 0 })
    }).unwrap_or(PitchBinding::Literal { millicents: pitch })
}
fn voicing(frame: &CompositionHarmony, previous: &[i64], melody_floor: i64) -> Vec<i64> {
    let mut best = (f64::INFINITY, Vec::new());
    for inversion in 0..frame.intervals.len() {
        for bottom in 47..=64 {
            let mut values = Vec::new();
            for voice in 0..frame.intervals.len() {
                let tone = (voice + inversion) % frame.intervals.len();
                let pc = (frame.root_millicents + frame.intervals[tone]).div_euclid(100_000).rem_euclid(12);
                let floor = values.last().map_or(bottom, |p| p + 1);
                values.push(floor + (pc - floor).rem_euclid(12));
            }
            let movement: f64 = values.iter().enumerate().map(|(i,p)| (*p - previous.get(i).copied().unwrap_or(54 + 4*i as i64)).abs() as f64).sum();
            let center = values.iter().sum::<i64>() as f64 / values.len() as f64;
            let crowding = (values.last().unwrap() + 3 - melody_floor).max(0) as f64;
            let score = movement + 0.35 * (center - 58.).abs() + 4. * crowding;
            if score < best.0 { best = (score, values); }
        }
    }
    best.1.into_iter().map(|p| p * 100_000).collect()
}
fn intern(materials: &mut Vec<ScoreMaterial>, dictionary: &mut HashMap<String,String>, part: &str,
    span: u64, notes: Vec<ScoreNote>) -> CoreResult<String> {
    let key = serde_json::to_string(&(span, &notes))?;
    if let Some(id) = dictionary.get(&key) { return Ok(id.clone()); }
    let id = format!("{part}-rhythm-{}", materials.len());
    materials.push(ScoreMaterial { id: id.clone(), span, notes }); dictionary.insert(key, id.clone()); Ok(id)
}

/// The seed owns the theme and harmonic route. Density changes its arrangement,
/// not those decisions. Non-chord melody anchors remain independent literals;
/// selected passing events depend on actual neighboring events in the material.
pub fn generate_plan(options: &GeneratorOptions) -> CoreResult<CompositionPlan> {
    if !(40. ..=240.).contains(&options.tempo) || !(1..=16).contains(&options.phrases)
        || !(2..=8).contains(&options.bars_per_phrase) || !(2..=9).contains(&options.beats_per_bar)
        || options.tonic > 11 || [options.density,options.variation,options.color].iter().any(|v| !v.is_finite() || !(0. ..=1.).contains(v)) {
        return Err(invalid("Generator needs tempo 40–240, 1–16 phrases, 2–8 bars per phrase, 2–9 beats, tonic 0–11, and controls between zero and one."));
    }
    let ppq = 480;
    let bar_ticks = ppq * u64::from(options.beats_per_bar);
    let phrase_ticks = bar_ticks * u64::from(options.bars_per_phrase);
    let duration = phrase_ticks * u64::from(options.phrases);
    let mut random = Random(u64::from(options.seed));
    // The identifying head has a small leap and a stepwise recovery. Subsequent
    // bars develop this contour; phrase returns keep its first half unchanged.
    let head = random.index(4) as i64;
    let direction = if random.next() < 0.5 { 1 } else { -1 };
    let fingerprint = [head, head + 2*direction, head + direction, head + 3*direction];
    let anchors = options.beats_per_bar.max(3).min(5) as usize;
    let onsets: Vec<u64> = (0..anchors).map(|i| (i as u64 * options.beats_per_bar as u64 * 2 / anchors as u64) * ppq / 2).collect();
    let mut theme = Vec::new();
    for bar in 0..options.bars_per_phrase {
        let shift = if bar == 0 { 0 } else { random.index(5) as i64 - 2 };
        theme.push((0..anchors).map(|i| (fingerprint[i % fingerprint.len()] + shift).clamp(-2,9)).collect::<Vec<_>>());
    }
    let mut materials = Vec::new(); let mut dictionary = HashMap::new();
    let mut harmonies = Vec::new(); let mut definitions = Vec::new(); let mut placements = Vec::new();
    let mut previous_voicing = Vec::new(); let mut previous_root = 0i64;
    for phrase in 0..options.phrases {
        let contrast = phrase % 4 == 2;
        // Alternate an open modal destination and a tonic answer. The complete
        // form always closes; modal v is not mislabeled an authentic dominant.
        let destination = if phrase + 1 == options.phrases || phrase % 2 == 1 { 0 } else { 4 };
        let mut phrase_placements = Vec::new();
        for bar in 0..options.bars_per_phrase {
            let cadence = bar + 1 == options.bars_per_phrase;
            let mut degrees = theme[bar as usize].clone();
            if contrast { for degree in &mut degrees { *degree = 4 - *degree; } }
            if phrase > 0 && bar >= options.bars_per_phrase / 2 && !cadence {
                for degree in degrees.iter_mut().skip(1) { if random.next() < options.variation { *degree += if random.next() < 0.5 { -1 } else { 1 }; } }
            }
            if cadence { // A real breath and shared melody/bass destination.
                for (i,degree) in degrees.iter_mut().enumerate() { *degree = destination + if i + 1 == anchors { 0 } else { 2 * (anchors - i - 1) as i64 % 7 }; }
            }
            let seventh = random.next() < options.color;
            let count = if seventh { 4 } else { 3 };
            let root = if cadence { destination } else {
                let mut winner = (f64::NEG_INFINITY, 0);
                for root in 0..7i64 {
                    let tones: Vec<_> = (0..count).map(|i| (root + 2*i as i64).rem_euclid(7)).collect();
                    let melody: f64 = degrees.iter().enumerate().map(|(i,d)| if tones.contains(&d.rem_euclid(7)) { if i == 0 { 2.5 } else { 1. } } else { 0. }).sum();
                    let approach = if bar + 2 == options.bars_per_phrase && root == (destination + 4) % 7 { 1.5 } else { 0. };
                    let common = (0..3).filter(|i| tones.contains(&(previous_root + 2*i).rem_euclid(7))).count() as f64;
                    let score = melody + 0.22 * common + approach - if root == previous_root { 0.6 } else { 0. } + random.next() * 0.65;
                    if score > winner.0 { winner = (score,root); }
                }
                winner.1
            };
            let root_pitch = degree_pitch(root, options);
            let frame = CompositionHarmony { id: format!("harmony-{phrase}-{bar}"), root_millicents: root_pitch.rem_euclid(1_200_000),
                intervals: (0..count).map(|i| degree_pitch(root + 2*i as i64, options) - root_pitch).collect() };
            previous_root = root;
            let pitches: Vec<_> = degrees.iter().map(|d| degree_pitch(35 + d, options)).collect();
            let mut melody_notes = Vec::new(); let mut bindings = Vec::new();
            // Add anchors first so dependencies have stable addresses regardless
            // of how many ornamental events the density control admits.
            for i in 0..anchors {
                let end = onsets.get(i+1).copied().unwrap_or(bar_ticks);
                let length = end - onsets[i];
                melody_notes.push(note(format!("anchor-{i}"), "melody", onsets[i], if cadence && i+1==anchors { length/2 } else { length*9/10 }, if i==0 { 91 } else { 78 + (i%3) as u8*3 }));
                bindings.push(harmonic_binding(pitches[i], &frame));
            }
            for i in 0..anchors-1 {
                let distance = degrees[i+1]-degrees[i];
                let eligible = distance.abs()==2 && onsets[i+1]-onsets[i] >= ppq;
                // A deterministic local threshold leaves route/theme RNG alone.
                let threshold = ((i*3 + bar as usize*5 + options.seed as usize%7)%7) as f64 / 7.;
                if eligible && threshold < options.density {
                    let at = (onsets[i]+onsets[i+1])/2;
                    melody_notes[i].duration = at-onsets[i];
                    melody_notes.push(note(format!("passing-{i}"), "melody", at, (onsets[i+1]-at)*9/10, 69));
                    bindings.push(PitchBinding::LatticePath { lattice: "mode".into(), from: PitchAnchor::Event {index:i}, to: PitchAnchor::Event {index:i+1},
                        numerator:1, denominator:2, degree_offset:0, residual_millicents:0 });
                }
            }
            let melody = intern(&mut materials,&mut dictionary,"melody",bar_ticks,melody_notes)?;
            phrase_placements.push(place(melody,u64::from(bar)*bar_ticks,bindings));
            let voices = voicing(&frame,&previous_voicing,pitches.iter().min().unwrap()/100_000); previous_voicing = voices.iter().map(|p| p/100_000).collect();
            let attacks = if options.density > 0.5 && !cadence { 2 } else { 1 };
            let mut notes = Vec::new(); let mut bindings = Vec::new();
            for attack in 0..attacks {
                let start = attack * bar_ticks/attacks;
                for (i,&pitch) in voices.iter().enumerate() {
                    let spread = if options.density > 0.25 { i as u64 * ppq/8 } else { 0 };
                    notes.push(note(format!("chord-{attack}-{i}"),"harmony",start+spread,(bar_ticks/attacks-spread)*4/5,59+(i%2) as u8*4));
                    bindings.push(harmonic_binding(pitch,&frame));
                }
            }
            let accompaniment = intern(&mut materials,&mut dictionary,"harmony",bar_ticks,notes)?;
            phrase_placements.push(place(accompaniment,u64::from(bar)*bar_ticks,bindings));
            let bass_pitch = frame.root_millicents + 3_600_000;
            let bass_end = if cadence { onsets[anchors-1] + (bar_ticks-onsets[anchors-1])/2 } else { bar_ticks*4/5 };
            let mut notes = vec![note("root".into(),"bass",0,bass_end,77)];
            let mut bindings = vec![harmonic_binding(bass_pitch,&frame)];
            if options.density > 0.75 && !cadence {
                notes[0].duration=bar_ticks*3/5;
                notes.push(note("pickup".into(),"bass",bar_ticks-ppq/2,ppq*2/5,65));
                bindings.push(PitchBinding::Harmony {harmony:frame.id.clone(),tone:2,octave:3,residual_millicents:0});
            }
            let bass=intern(&mut materials,&mut dictionary,"bass",bar_ticks,notes)?;
            phrase_placements.push(place(bass,u64::from(bar)*bar_ticks,bindings));
            harmonies.push(frame);
        }
        let id=format!("phrase-{}-{}",phrase+1,if contrast {"contrast"} else if phrase==0 {"statement"} else {"return"});
        definitions.push(CompositionDefinition {id:id.clone(),span:phrase_ticks,placements:phrase_placements});
        placements.push(place(id,u64::from(phrase)*phrase_ticks,vec![]));
    }
    let micros=(60_000_000./options.tempo).round() as u32;
    let context=ScoreContext {ppq,duration,midi_format:None,track_ends:vec![duration;3],
        parts:[("melody","Melody"),("harmony","Harmony"),("bass","Bass")].into_iter().enumerate().map(|(i,(id,name))|ScorePart {id:id.into(),name:name.into(),track:i,channel:i as u8,percussion:false}).collect(),
        attachments:vec![ScoreAttachment {tick:0,track:0,order:0,bytes:vec![255,81,3,(micros>>16) as u8,(micros>>8) as u8,micros as u8]},
            ScoreAttachment {tick:0,track:0,order:1,bytes:vec![255,88,4,options.beats_per_bar as u8,2,24,8]}]};
    let plan=CompositionPlan {context,materials,definitions:Some(definitions),placements,harmonies:Some(harmonies),
        pitch_lattices:Some(vec![PitchLattice {id:"mode".into(),origin_millicents:i64::from(options.tonic)*100_000,
            period_millicents:1_200_000,intervals:options.mode.intervals().into_iter().map(|p|p*100_000).collect()}])};
    compile_composition(&plan,&CompositionLimits::default())?;
    Ok(plan)
}

#[cfg(test)]
#[path = "generator_tests.rs"]
mod tests;
