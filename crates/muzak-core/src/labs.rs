//! Small, independent experiment generators. Each authors a reusable material
//! and placements in the existing composition algebra; there is no lab decoder.
use crate::{
    composition::{
        CompositionLimits, CompositionPlan, MaterialPlacement, PitchLattice, ScoreMaterial,
        compile_composition, pitch_lattice_pitch,
    },
    error::{CoreResult, invalid},
    model::{MAX_SAFE, Pitch, ScoreAttachment, ScoreContext, ScoreNote, ScorePart},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Exact step length in quarter notes, independent of a meter or cycle length.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct LabStep {
    pub numerator: u16,
    pub denominator: u16,
}

impl Default for LabStep {
    fn default() -> Self {
        Self {
            numerator: 1,
            denominator: 2,
        }
    }
}

impl LabStep {
    fn coordinates(&self) -> CoreResult<(u64, u64)> {
        if !(1..=64).contains(&self.numerator) || !(1..=1024).contains(&self.denominator) {
            return Err(invalid(
                "Lab step needs numerator 1–64 and denominator 1–1024.",
            ));
        }
        // The extra factor preserves a 9/10 gate exactly. PPQ stays within the
        // Standard MIDI limit for every admitted denominator; no step is snapped.
        Ok((
            u64::from(self.denominator) * 10,
            u64::from(self.numerator) * 10,
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct MelodyLabOptions {
    pub seed: u32,
    pub tempo: f64,
    pub notes: u16,
    pub repeats: u16,
    pub max_step: u16,
    pub first_degree: i32,
    pub min_degree: i32,
    pub max_degree: i32,
    pub step: LabStep,
    pub lattice: PitchLattice,
}

impl Default for MelodyLabOptions {
    fn default() -> Self {
        Self {
            seed: 1,
            tempo: 104.,
            notes: 16,
            repeats: 2,
            max_step: 2,
            first_degree: 0,
            min_degree: -3,
            max_degree: 7,
            step: LabStep::default(),
            lattice: PitchLattice {
                id: "melody-domain".into(),
                origin_millicents: 6_200_000,
                intervals: vec![0, 200_000, 300_000, 500_000, 700_000, 900_000, 1_000_000],
                period_millicents: 1_200_000,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct RhythmLabOptions {
    pub tempo: f64,
    pub steps: u16,
    pub pulses: u16,
    /// Positive rotation moves every onset later, wrapping inside the cycle.
    pub rotation: i32,
    pub repeats: u16,
    pub step: LabStep,
    /// A pitched audition voice; this is not a percussion key or drum map.
    pub pitch: Pitch,
}

impl Default for RhythmLabOptions {
    fn default() -> Self {
        Self {
            tempo: 104.,
            steps: 8,
            pulses: 3,
            rotation: 0,
            repeats: 4,
            step: LabStep::default(),
            pitch: Pitch {
                millicents: 6_000_000,
            },
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct LabDefaults {
    pub melody: MelodyLabOptions,
    pub rhythm: RhythmLabOptions,
}

struct Random(u64);

impl Random {
    fn index(&mut self, count: u64) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        (value ^ (value >> 31)) % count
    }
}

fn validate_extent(tempo: f64, steps: u16, repeats: u16) -> CoreResult<()> {
    if !tempo.is_finite()
        || !(20. ..=400.).contains(&tempo)
        || !(1..=128).contains(&steps)
        || !(1..=16).contains(&repeats)
    {
        return Err(invalid(
            "Labs need tempo 20–400, 1–128 steps or notes, and 1–16 repeats.",
        ));
    }
    Ok(())
}

fn note(index: u16, part: &str, onset: u64, step_ticks: u64, pitch: Pitch) -> ScoreNote {
    ScoreNote {
        id: format!("event-{index}"),
        part: part.into(),
        onset,
        duration: step_ticks * 9 / 10,
        pitch,
        velocity: 88,
        release_velocity: 64,
        pitch_envelope: None,
        gain_envelope: None,
        source: None,
    }
}

fn repeated_plan(
    part: &str,
    name: &str,
    tempo: f64,
    ppq: u64,
    span: u64,
    repeats: u16,
    notes: Vec<ScoreNote>,
) -> CoreResult<CompositionPlan> {
    let duration = span * u64::from(repeats);
    let micros = (60_000_000. / tempo).round() as u32;
    let material = format!("{part}-cycle");
    let plan = CompositionPlan {
        context: ScoreContext {
            ppq,
            duration,
            midi_format: None,
            parts: vec![ScorePart {
                id: part.into(),
                name: name.into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            // No meter is inferred from the number of steps in a lab cycle.
            attachments: vec![ScoreAttachment {
                tick: 0,
                track: 0,
                order: 0,
                bytes: vec![
                    255,
                    81,
                    3,
                    (micros >> 16) as u8,
                    (micros >> 8) as u8,
                    micros as u8,
                ],
            }],
            track_ends: vec![duration],
        },
        materials: vec![ScoreMaterial {
            id: material.clone(),
            span,
            notes,
        }],
        definitions: None,
        placements: (0..repeats)
            .map(|repeat| MaterialPlacement {
                material: material.clone(),
                onset: span * u64::from(repeat),
                transpose_millicents: None,
                time_scale: None,
                velocity_scale: None,
                part_map: None,
                pitch_bindings: None,
            })
            .collect(),
        harmonies: None,
        pitch_lattices: None,
    };
    compile_composition(&plan, &CompositionLimits::default())?;
    Ok(plan)
}

/// A bounded seeded walk in any exact native pitch lattice. Pitch choices are
/// authored literals; changing a lattice option regenerates the experiment.
/// Tempo, step duration, repetition and lattice spacing do not consume the RNG.
pub fn generate_melody(options: &MelodyLabOptions) -> CoreResult<CompositionPlan> {
    validate_extent(options.tempo, options.notes, options.repeats)?;
    if options.max_step > 32
        || options.min_degree > options.first_degree
        || options.first_degree > options.max_degree
        || options.lattice.intervals.len() > 256
    {
        return Err(invalid(
            "Melody needs a starting degree within its bounds, max step 0–32, and at most 256 lattice intervals.",
        ));
    }
    options.lattice.validate()?;
    let (ppq, step_ticks) = options.step.coordinates()?;
    let mut random = Random(u64::from(options.seed));
    let mut degree = i64::from(options.first_degree);
    let mut notes = Vec::with_capacity(options.notes as usize);
    for index in 0..options.notes {
        if index > 0 {
            let lower = (degree - i64::from(options.max_step)).max(i64::from(options.min_degree));
            let upper = (degree + i64::from(options.max_step)).min(i64::from(options.max_degree));
            degree = lower + random.index((upper - lower + 1) as u64) as i64;
        }
        let pitch = Pitch {
            millicents: pitch_lattice_pitch(degree, &options.lattice, 0)?,
        };
        notes.push(note(
            index,
            "melody",
            u64::from(index) * step_ticks,
            step_ticks,
            pitch,
        ));
    }
    repeated_plan(
        "melody",
        "Melody study",
        options.tempo,
        ppq,
        u64::from(options.notes) * step_ticks,
        options.repeats,
        notes,
    )
}

/// Distributes pulses as evenly as possible over the cycle's integer steps.
/// Zero pulses is a valid silent material; rotation never changes the cycle span.
pub fn generate_rhythm(options: &RhythmLabOptions) -> CoreResult<CompositionPlan> {
    validate_extent(options.tempo, options.steps, options.repeats)?;
    if options.pulses > options.steps {
        return Err(invalid("Rhythm pulses cannot exceed steps."));
    }
    if options.pitch.millicents.unsigned_abs() > MAX_SAFE {
        return Err(invalid(
            "Rhythm pitch exceeds safe native pitch coordinates.",
        ));
    }
    let (ppq, step_ticks) = options.step.coordinates()?;
    let steps = i64::from(options.steps);
    let rotation = i64::from(options.rotation).rem_euclid(steps);
    let mut notes = Vec::with_capacity(options.pulses as usize);
    for index in 0..options.steps {
        let unrotated = (i64::from(index) - rotation).rem_euclid(steps);
        if unrotated * i64::from(options.pulses) % steps < i64::from(options.pulses) {
            notes.push(note(
                index,
                "rhythm",
                u64::from(index) * step_ticks,
                step_ticks,
                options.pitch,
            ));
        }
    }
    repeated_plan(
        "rhythm",
        "Rhythm study",
        options.tempo,
        ppq,
        u64::from(options.steps) * step_ticks,
        options.repeats,
        notes,
    )
}

#[cfg(test)]
#[path = "labs_tests.rs"]
mod tests;
