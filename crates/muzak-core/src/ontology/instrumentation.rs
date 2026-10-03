//! Physical instruments, people, ensemble membership, sound design and routing
//! are independent coordinates. A General MIDI patch never defines an instrument.

use super::{EntityId, Rational, pitch::PitchRange};
use crate::error::{CoreResult, invalid};
use crate::model::{MAX_SAFE, Pitch};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrument")]
pub struct Instrument {
    pub name: String,
    pub families: Vec<InstrumentFamily>,
    pub sound_production: Vec<SoundProduction>,
    pub capabilities: InstrumentCapabilities,
    pub range: Option<PitchRange>,
    pub tessitura: Option<PitchRange>,
    pub transposition: InstrumentTransposition,
    pub tuning: Option<InstrumentTuning>,
    pub catalogue: Option<InstrumentCatalogueEntry>,
    pub default_timbre: Option<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentFamily")]
pub enum InstrumentFamily {
    Strings,
    Woodwind,
    Brass,
    Percussion,
    Keyboard,
    Voice,
    Electronic,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySoundProduction")]
pub enum SoundProduction {
    Idiophone,
    Membranophone,
    Chordophone,
    Aerophone,
    Electrophone,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentCapabilities")]
pub struct InstrumentCapabilities {
    pub polyphony: Polyphony,
    pub pitch_control: PitchControl,
    pub excitation: Vec<Excitation>,
    /// Unknown is distinct from false for instruments not yet characterized.
    pub can_sustain: Option<bool>,
    pub can_change_pitch_during_sustain: Option<bool>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename = "OntologyPolyphony")]
pub enum Polyphony {
    Monophonic,
    Bounded { voices: u16 },
    Unbounded,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPitchControl")]
pub enum PitchControl {
    Continuous,
    FixedPitches,
    Fretted,
    Valved,
    Keyed,
    Unpitched,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyExcitation")]
pub enum Excitation {
    Bowed,
    Plucked,
    Struck,
    Scraped,
    Shaken,
    Blown,
    Reeded,
    LipVibrated,
    VocalFold,
    Electronic,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentTransposition")]
pub struct InstrumentTransposition {
    pub sounding_minus_written_millicents: i64,
    /// Spelling displacement is independent of acoustic displacement.
    pub diatonic_steps: Option<i32>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentTuning")]
pub struct InstrumentTuning {
    pub reference: Option<TuningReference>,
    pub courses: Vec<StringCourse>,
    pub fret_offsets_millicents: Option<Vec<i64>>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTuningReference")]
pub struct TuningReference {
    pub pitch: Pitch,
    pub frequency_hz: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyStringCourse")]
pub struct StringCourse {
    pub number: u16,
    /// A doubled course preserves the pitch of each physical string.
    pub open_pitches: Vec<Pitch>,
    pub capo_fret: Option<u16>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentCatalogueEntry")]
pub struct InstrumentCatalogueEntry {
    pub system: String,
    pub identifier: String,
}
impl Instrument {
    pub fn validate(&self) -> CoreResult<()> {
        nonempty(&self.name, "instrument name")?;
        unique(&self.families, "instrument families")?;
        unique(&self.sound_production, "sound production classes")?;
        unique(
            &self.capabilities.excitation,
            "instrument excitation methods",
        )?;
        if let Polyphony::Bounded { voices: 0 } = self.capabilities.polyphony {
            return Err(invalid("Bounded polyphony must permit at least one voice."));
        }
        if let Some(range) = &self.range {
            range.validate()?;
        }
        if let Some(tessitura) = &self.tessitura {
            tessitura.validate()?;
            if let Some(range) = &self.range {
                if tessitura.low.millicents < range.low.millicents
                    || tessitura.high.millicents > range.high.millicents
                {
                    return Err(invalid(
                        "Instrument tessitura must lie within its playable range.",
                    ));
                }
            }
        }
        safe_pitch(self.transposition.sounding_minus_written_millicents)?;
        if let Some(tuning) = &self.tuning {
            tuning.validate()?;
        }
        if let Some(entry) = &self.catalogue {
            nonempty(&entry.system, "instrument catalogue system")?;
            nonempty(&entry.identifier, "instrument catalogue identifier")?;
        }
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.default_timbre.iter().collect()
    }
}
impl InstrumentTuning {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(reference) = &self.reference {
            safe_pitch(reference.pitch.millicents)?;
            positive(reference.frequency_hz, "tuning frequency")?;
        }
        let mut numbers = Vec::new();
        for course in &self.courses {
            if course.number == 0 || numbers.contains(&course.number) {
                return Err(invalid(
                    "String course numbers must be positive and unique.",
                ));
            }
            numbers.push(course.number);
            if course.open_pitches.is_empty() {
                return Err(invalid("A string course must contain at least one string."));
            }
            for pitch in &course.open_pitches {
                safe_pitch(pitch.millicents)?;
            }
        }
        if let Some(frets) = &self.fret_offsets_millicents {
            if frets.is_empty() || frets[0] != 0 || frets.windows(2).any(|pair| pair[0] >= pair[1])
            {
                return Err(invalid(
                    "A fret table must start at zero and increase strictly.",
                ));
            }
            for fret in frets {
                safe_pitch(*fret)?;
            }
            for course in &self.courses {
                if course
                    .capo_fret
                    .is_some_and(|fret| usize::from(fret) >= frets.len())
                {
                    return Err(invalid(
                        "A capo fret must exist in the specified fret table.",
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEnsemble")]
pub struct Ensemble {
    pub name: String,
    pub kind: EnsembleKind,
    pub sections: Vec<EnsembleSection>,
    pub conductor: Option<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEnsembleKind")]
pub enum EnsembleKind {
    Solo,
    Duo,
    Trio,
    Quartet,
    Quintet,
    Sextet,
    Septet,
    Octet,
    Nonet,
    ChamberEnsemble,
    Orchestra,
    ChamberOrchestra,
    StringOrchestra,
    WindEnsemble,
    BrassBand,
    MarchingBand,
    BigBand,
    JazzCombo,
    RockBand,
    Choir,
    VocalEnsemble,
    PercussionEnsemble,
    ElectronicEnsemble,
    Gamelan,
    MixedEnsemble,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEnsembleSection")]
pub struct EnsembleSection {
    pub name: String,
    pub role: EnsembleSectionRole,
    pub performers: Vec<EntityId>,
    pub instruments: Vec<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEnsembleSectionRole")]
pub enum EnsembleSectionRole {
    Strings,
    Woodwind,
    Brass,
    Percussion,
    RhythmSection,
    Keyboards,
    Vocals,
    Electronics,
    Soloists,
    Mixed,
}
impl Ensemble {
    pub fn validate(&self) -> CoreResult<()> {
        nonempty(&self.name, "ensemble name")?;
        for section in &self.sections {
            nonempty(&section.name, "ensemble section name")?;
            unique(&section.performers, "section performers")?;
            unique(&section.instruments, "section instruments")?;
            if section.performers.is_empty() && section.instruments.is_empty() {
                return Err(invalid(
                    "An ensemble section must identify performers or instruments.",
                ));
            }
        }
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.conductor
            .iter()
            .chain(
                self.sections
                    .iter()
                    .flat_map(|section| section.performers.iter().chain(&section.instruments)),
            )
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPerformer")]
pub struct Performer {
    pub name: String,
    pub kind: PerformerKind,
    pub instruments: Vec<EntityId>,
    pub roles: Vec<PerformerRole>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPerformerKind")]
pub enum PerformerKind {
    Human,
    Virtual,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPerformerRole")]
pub enum PerformerRole {
    Instrumentalist,
    Singer,
    Conductor,
    Soloist,
    SectionPlayer,
    Accompanist,
    Improviser,
    Operator,
}
impl Performer {
    pub fn validate(&self) -> CoreResult<()> {
        nonempty(&self.name, "performer name")?;
        unique(&self.instruments, "performer instruments")?;
        unique(&self.roles, "performer roles")?;
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.instruments.iter().collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTimbre")]
pub struct Timbre {
    pub name: String,
    pub descriptors: Vec<TimbreDescriptor>,
    pub source: SoundSource,
    pub envelope: Option<AmplitudeEnvelope>,
    /// Ordered signal-processing intent; no audio renderer is implied.
    pub effects: Vec<AudioEffect>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTimbreDescriptor")]
pub struct TimbreDescriptor {
    pub axis: TimbreAxis,
    pub amount: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTimbreAxis")]
pub enum TimbreAxis {
    Brightness,
    Warmth,
    Roughness,
    Breathiness,
    Noisiness,
    Harmonicity,
    AttackSharpness,
    Resonance,
    SpectralDensity,
    Fullness,
    Metallicness,
    Nasality,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySoundSource")]
pub enum SoundSource {
    Acoustic {
        instrument: EntityId,
    },
    Sample {
        asset: String,
        root_pitch: Option<Pitch>,
    },
    Synthesizer {
        synthesis: Synthesis,
    },
    Noise {
        color: NoiseColor,
    },
    Layered {
        layers: Vec<TimbreLayer>,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTimbreLayer")]
pub struct TimbreLayer {
    pub timbre: EntityId,
    pub gain: f64,
    pub detune_millicents: i64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyNoiseColor")]
pub enum NoiseColor {
    White,
    Pink,
    Brown,
    Blue,
    Violet,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySynthesis")]
pub enum Synthesis {
    Additive {
        partials: Vec<SpectralPartial>,
    },
    Subtractive {
        oscillators: Vec<Oscillator>,
        filter: Filter,
    },
    FrequencyModulation {
        operators: Vec<Oscillator>,
        connections: Vec<ModulationConnection>,
    },
    Wavetable {
        asset: String,
        position: f64,
    },
    Granular {
        asset: String,
        grain_seconds: f64,
        grains_per_second: f64,
    },
    PhysicalModel {
        model: PhysicalModelKind,
        damping: f64,
        excitation: Excitation,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectralPartial")]
pub struct SpectralPartial {
    pub frequency_ratio: f64,
    pub amplitude: f64,
    pub phase_cycles: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOscillator")]
pub struct Oscillator {
    pub waveform: Waveform,
    pub frequency_ratio: f64,
    pub detune_millicents: i64,
    pub amplitude: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyWaveform")]
pub enum Waveform {
    Sine,
    Triangle,
    Sawtooth,
    Square,
    Pulse,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyModulationConnection")]
pub struct ModulationConnection {
    pub source_operator: u16,
    pub target_operator: u16,
    pub index: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPhysicalModelKind")]
pub enum PhysicalModelKind {
    String,
    Reed,
    Lip,
    Pipe,
    Membrane,
    Plate,
    Bar,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyAmplitudeEnvelope")]
pub struct AmplitudeEnvelope {
    pub attack_seconds: f64,
    pub decay_seconds: f64,
    pub sustain_gain: f64,
    pub release_seconds: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyAudioEffect")]
pub enum AudioEffect {
    Equalizer {
        bands: Vec<EqualizerBand>,
    },
    Filter {
        filter: Filter,
    },
    Distortion {
        drive_db: f64,
        mix: f64,
    },
    Overdrive {
        drive_db: f64,
        mix: f64,
    },
    Compression {
        threshold_db: f64,
        ratio: f64,
        attack_seconds: f64,
        release_seconds: f64,
    },
    Delay {
        time: Rational,
        feedback: f64,
        mix: f64,
    },
    Reverb {
        decay_seconds: f64,
        pre_delay_seconds: f64,
        mix: f64,
    },
    Chorus {
        rate_hz: f64,
        depth: f64,
        mix: f64,
    },
    Flanger {
        rate_hz: f64,
        depth: f64,
        feedback: f64,
        mix: f64,
    },
    Phaser {
        rate_hz: f64,
        depth: f64,
        mix: f64,
    },
    Tremolo {
        rate_hz: f64,
        depth: f64,
    },
    RingModulation {
        frequency_hz: f64,
        mix: f64,
    },
    PitchShift {
        millicents: i64,
    },
    BitCrush {
        bits: u8,
        sample_rate_hz: f64,
    },
    Pan {
        position: f64,
    },
    Gain {
        decibels: f64,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEqualizerBand")]
pub struct EqualizerBand {
    pub frequency_hz: f64,
    pub gain_db: f64,
    pub q: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyFilter")]
pub struct Filter {
    pub kind: FilterKind,
    pub cutoff_hz: f64,
    pub resonance_q: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyFilterKind")]
pub enum FilterKind {
    LowPass,
    HighPass,
    BandPass,
    BandStop,
    LowShelf,
    HighShelf,
    AllPass,
    Comb,
}
impl Timbre {
    pub fn validate(&self) -> CoreResult<()> {
        nonempty(&self.name, "timbre name")?;
        let mut axes = Vec::new();
        for descriptor in &self.descriptors {
            unit(descriptor.amount, "timbre descriptor amount")?;
            if axes.contains(&&descriptor.axis) {
                return Err(invalid("A timbre descriptor axis cannot occur twice."));
            }
            axes.push(&descriptor.axis);
        }
        match &self.source {
            SoundSource::Acoustic { .. } | SoundSource::Noise { .. } => {}
            SoundSource::Sample { asset, root_pitch } => {
                nonempty(asset, "sample asset")?;
                if let Some(pitch) = root_pitch {
                    safe_pitch(pitch.millicents)?;
                }
            }
            SoundSource::Synthesizer { synthesis } => synthesis.validate()?,
            SoundSource::Layered { layers } => {
                if layers.is_empty() {
                    return Err(invalid("A layered timbre needs at least one layer."));
                }
                for layer in layers {
                    nonnegative(layer.gain, "timbre layer gain")?;
                    safe_pitch(layer.detune_millicents)?;
                }
            }
        }
        if let Some(envelope) = &self.envelope {
            nonnegative(envelope.attack_seconds, "envelope attack")?;
            nonnegative(envelope.decay_seconds, "envelope decay")?;
            unit(envelope.sustain_gain, "envelope sustain")?;
            nonnegative(envelope.release_seconds, "envelope release")?;
        }
        for effect in &self.effects {
            effect.validate()?;
        }
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        match &self.source {
            SoundSource::Acoustic { instrument } => vec![instrument],
            SoundSource::Layered { layers } => layers.iter().map(|layer| &layer.timbre).collect(),
            _ => Vec::new(),
        }
    }
}
impl Synthesis {
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Additive { partials } => {
                if partials.is_empty() {
                    return Err(invalid("Additive synthesis needs at least one partial."));
                }
                for partial in partials {
                    positive(partial.frequency_ratio, "partial frequency ratio")?;
                    nonnegative(partial.amplitude, "partial amplitude")?;
                    finite(partial.phase_cycles, "partial phase")?;
                }
            }
            Self::Subtractive {
                oscillators,
                filter,
            } => {
                validate_oscillators(oscillators)?;
                filter.validate()?;
            }
            Self::FrequencyModulation {
                operators,
                connections,
            } => {
                validate_oscillators(operators)?;
                for connection in connections {
                    if usize::from(connection.source_operator) >= operators.len()
                        || usize::from(connection.target_operator) >= operators.len()
                    {
                        return Err(invalid("FM connection references an absent operator."));
                    }
                    nonnegative(connection.index, "FM modulation index")?;
                }
            }
            Self::Wavetable { asset, position } => {
                nonempty(asset, "wavetable asset")?;
                unit(*position, "wavetable position")?;
            }
            Self::Granular {
                asset,
                grain_seconds,
                grains_per_second,
            } => {
                nonempty(asset, "granular asset")?;
                positive(*grain_seconds, "grain duration")?;
                positive(*grains_per_second, "grain density")?;
            }
            Self::PhysicalModel { damping, .. } => unit(*damping, "physical model damping")?,
        }
        Ok(())
    }
}
impl Filter {
    pub fn validate(&self) -> CoreResult<()> {
        positive(self.cutoff_hz, "filter cutoff")?;
        positive(self.resonance_q, "filter resonance Q")
    }
}
impl AudioEffect {
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Equalizer { bands } => {
                if bands.is_empty() {
                    return Err(invalid("An equalizer needs at least one band."));
                }
                for band in bands {
                    positive(band.frequency_hz, "EQ frequency")?;
                    finite(band.gain_db, "EQ gain")?;
                    positive(band.q, "EQ Q")?;
                }
            }
            Self::Filter { filter } => filter.validate()?,
            Self::Distortion { drive_db, mix } | Self::Overdrive { drive_db, mix } => {
                finite(*drive_db, "drive")?;
                unit(*mix, "effect mix")?;
            }
            Self::Compression {
                threshold_db,
                ratio,
                attack_seconds,
                release_seconds,
            } => {
                finite(*threshold_db, "compression threshold")?;
                finite(*ratio, "compression ratio")?;
                if *ratio < 1.0 {
                    return Err(invalid("Compression ratio must be at least one."));
                }
                nonnegative(*attack_seconds, "compressor attack")?;
                nonnegative(*release_seconds, "compressor release")?;
            }
            Self::Delay {
                time,
                feedback,
                mix,
            } => {
                time.validate()?;
                if time.numerator <= 0 {
                    return Err(invalid("Delay time must be positive."));
                }
                unit(*feedback, "delay feedback")?;
                unit(*mix, "effect mix")?;
            }
            Self::Reverb {
                decay_seconds,
                pre_delay_seconds,
                mix,
            } => {
                positive(*decay_seconds, "reverb decay")?;
                nonnegative(*pre_delay_seconds, "reverb pre-delay")?;
                unit(*mix, "effect mix")?;
            }
            Self::Chorus {
                rate_hz,
                depth,
                mix,
            }
            | Self::Phaser {
                rate_hz,
                depth,
                mix,
            } => {
                nonnegative(*rate_hz, "modulation rate")?;
                unit(*depth, "modulation depth")?;
                unit(*mix, "effect mix")?;
            }
            Self::Flanger {
                rate_hz,
                depth,
                feedback,
                mix,
            } => {
                nonnegative(*rate_hz, "modulation rate")?;
                unit(*depth, "modulation depth")?;
                bipolar(*feedback, "flanger feedback")?;
                unit(*mix, "effect mix")?;
            }
            Self::Tremolo { rate_hz, depth } => {
                nonnegative(*rate_hz, "tremolo rate")?;
                unit(*depth, "tremolo depth")?;
            }
            Self::RingModulation { frequency_hz, mix } => {
                nonnegative(*frequency_hz, "ring modulation frequency")?;
                unit(*mix, "effect mix")?;
            }
            Self::PitchShift { millicents } => safe_pitch(*millicents)?,
            Self::BitCrush {
                bits,
                sample_rate_hz,
            } => {
                if *bits == 0 || *bits > 32 {
                    return Err(invalid("Bit depth must be between one and 32."));
                }
                positive(*sample_rate_hz, "bit crusher sample rate")?;
            }
            Self::Pan { position } => bipolar(*position, "pan position")?,
            Self::Gain { decibels } => finite(*decibels, "gain")?,
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOrchestration")]
pub struct Orchestration {
    pub assignments: Vec<InstrumentAssignment>,
    pub doublings: Vec<InstrumentDoubling>,
    pub distributions: Vec<SectionDistribution>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentAssignment")]
pub struct InstrumentAssignment {
    pub voice: EntityId,
    pub instrument: EntityId,
    pub performers: Vec<EntityId>,
    pub timbre: Option<EntityId>,
    pub routing: Option<OutputRouting>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInstrumentDoubling")]
pub struct InstrumentDoubling {
    pub source_voice: EntityId,
    pub target_voice: EntityId,
    pub interval_millicents: i64,
    /// Sharing is an explicit premise, not inferred from equal sounding notes.
    pub shared_parameters: Vec<DoubledParameter>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDoubledParameter")]
pub enum DoubledParameter {
    Rhythm,
    PitchContour,
    Dynamics,
    Articulation,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySectionDistribution")]
pub struct SectionDistribution {
    pub mode: SectionDistributionMode,
    pub voices: Vec<EntityId>,
    pub performers: Vec<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySectionDistributionMode")]
pub enum SectionDistributionMode {
    Unison,
    Divisi,
    Solo,
    Tutti,
    Antiphonal,
    Hocket,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "protocol",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyOutputRouting")]
pub enum OutputRouting {
    Midi {
        endpoint: String,
        channel: u8,
        patch: Option<MidiPatch>,
    },
    Audio {
        endpoint: String,
        bus: String,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMidiPatch")]
pub struct MidiPatch {
    /// Patch identity is zero-based and independent of the physical taxonomy.
    pub program: u8,
    pub bank_msb: Option<u8>,
    pub bank_lsb: Option<u8>,
    pub standard: MidiPatchStandard,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMidiPatchStandard")]
pub enum MidiPatchStandard {
    GeneralMidi1,
    GeneralMidi2,
    DeviceSpecific,
}
impl Orchestration {
    pub fn validate(&self) -> CoreResult<()> {
        if self.assignments.is_empty() && self.doublings.is_empty() && self.distributions.is_empty()
        {
            return Err(invalid(
                "Orchestration requires an assignment, doubling, or section distribution.",
            ));
        }
        for assignment in &self.assignments {
            unique(&assignment.performers, "assigned performers")?;
            if let Some(routing) = &assignment.routing {
                routing.validate()?;
            }
        }
        for doubling in &self.doublings {
            if doubling.source_voice == doubling.target_voice {
                return Err(invalid("Instrument doubling must connect distinct voices."));
            }
            safe_pitch(doubling.interval_millicents)?;
            unique(&doubling.shared_parameters, "doubling parameters")?;
        }
        for distribution in &self.distributions {
            if distribution.voices.is_empty() || distribution.performers.is_empty() {
                return Err(invalid(
                    "A section distribution must name voices and performers.",
                ));
            }
            unique(&distribution.voices, "distributed voices")?;
            unique(&distribution.performers, "distributed performers")?;
        }
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        let mut references = Vec::new();
        for assignment in &self.assignments {
            references.push(&assignment.voice);
            references.push(&assignment.instrument);
            references.extend(&assignment.performers);
            references.extend(assignment.timbre.iter());
        }
        for doubling in &self.doublings {
            references.push(&doubling.source_voice);
            references.push(&doubling.target_voice);
        }
        for distribution in &self.distributions {
            references.extend(&distribution.voices);
            references.extend(&distribution.performers);
        }
        references
    }
}
impl OutputRouting {
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Midi {
                endpoint,
                channel,
                patch,
            } => {
                nonempty(endpoint, "MIDI endpoint")?;
                if *channel > 15 {
                    return Err(invalid(
                        "MIDI channels are zero-based values from zero through 15.",
                    ));
                }
                if let Some(patch) = patch {
                    if patch.program > 127
                        || patch.bank_msb.is_some_and(|bank| bank > 127)
                        || patch.bank_lsb.is_some_and(|bank| bank > 127)
                    {
                        return Err(invalid(
                            "MIDI program and bank values must be seven-bit values.",
                        ));
                    }
                }
            }
            Self::Audio { endpoint, bus } => {
                nonempty(endpoint, "audio endpoint")?;
                nonempty(bus, "audio bus")?;
            }
        }
        Ok(())
    }
}

fn validate_oscillators(oscillators: &[Oscillator]) -> CoreResult<()> {
    if oscillators.is_empty() {
        return Err(invalid("Synthesis needs at least one oscillator."));
    }
    for oscillator in oscillators {
        positive(oscillator.frequency_ratio, "oscillator frequency ratio")?;
        safe_pitch(oscillator.detune_millicents)?;
        nonnegative(oscillator.amplitude, "oscillator amplitude")?;
    }
    Ok(())
}
fn nonempty(value: &str, label: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        Err(invalid(format!("{label} cannot be empty.")))
    } else {
        Ok(())
    }
}
fn validate_references(references: Vec<&EntityId>) -> CoreResult<()> {
    for id in references {
        nonempty(&id.0, "instrumentation reference")?;
    }
    Ok(())
}
fn unique<T: PartialEq>(values: &[T], label: &str) -> CoreResult<()> {
    if values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
    {
        Err(invalid(format!("Duplicate {label}.")))
    } else {
        Ok(())
    }
}
fn safe_pitch(value: i64) -> CoreResult<()> {
    if value.unsigned_abs() > MAX_SAFE {
        Err(invalid("Pitch values must be safe native millicents."))
    } else {
        Ok(())
    }
}
fn finite(value: f64, label: &str) -> CoreResult<()> {
    if !value.is_finite() {
        Err(invalid(format!("{label} must be finite.")))
    } else {
        Ok(())
    }
}
fn nonnegative(value: f64, label: &str) -> CoreResult<()> {
    finite(value, label)?;
    if value < 0.0 {
        Err(invalid(format!("{label} cannot be negative.")))
    } else {
        Ok(())
    }
}
fn positive(value: f64, label: &str) -> CoreResult<()> {
    finite(value, label)?;
    if value <= 0.0 {
        Err(invalid(format!("{label} must be positive.")))
    } else {
        Ok(())
    }
}
fn unit(value: f64, label: &str) -> CoreResult<()> {
    finite(value, label)?;
    if !(0.0..=1.0).contains(&value) {
        Err(invalid(format!("{label} must be between zero and one.")))
    } else {
        Ok(())
    }
}
fn bipolar(value: f64, label: &str) -> CoreResult<()> {
    finite(value, label)?;
    if !(-1.0..=1.0).contains(&value) {
        Err(invalid(format!(
            "{label} must be between minus one and one."
        )))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn course_tuning_preserves_doubled_strings_and_validates_capo() {
        let mut tuning = InstrumentTuning {
            reference: None,
            courses: vec![StringCourse {
                number: 1,
                open_pitches: vec![
                    Pitch {
                        millicents: 4_000_000,
                    },
                    Pitch {
                        millicents: 5_200_000,
                    },
                ],
                capo_fret: Some(1),
            }],
            fret_offsets_millicents: Some(vec![0, 100_000, 200_000]),
        };
        assert!(tuning.validate().is_ok());
        tuning.courses[0].capo_fret = Some(3);
        assert!(tuning.validate().is_err());
    }
    #[test]
    fn timbre_layers_keep_distinct_entity_addresses() {
        let timbre = Timbre {
            name: "Layer".into(),
            descriptors: vec![],
            source: SoundSource::Layered {
                layers: vec![
                    TimbreLayer {
                        timbre: EntityId("clean".into()),
                        gain: 0.4,
                        detune_millicents: 0,
                    },
                    TimbreLayer {
                        timbre: EntityId("driven".into()),
                        gain: 0.4,
                        detune_millicents: 0,
                    },
                ],
            },
            envelope: None,
            effects: vec![],
        };
        assert!(timbre.validate().is_ok());
        assert_eq!(timbre.references().len(), 2);
        let json = serde_json::to_string(&timbre).unwrap();
        assert_eq!(serde_json::from_str::<Timbre>(&json).unwrap(), timbre);
    }
    #[test]
    fn synthesis_and_effects_reject_missing_operators_and_nonfinite_values() {
        let synthesis = Synthesis::FrequencyModulation {
            operators: vec![Oscillator {
                waveform: Waveform::Sine,
                frequency_ratio: 1.0,
                detune_millicents: 0,
                amplitude: 1.0,
            }],
            connections: vec![ModulationConnection {
                source_operator: 1,
                target_operator: 0,
                index: 2.0,
            }],
        };
        assert!(synthesis.validate().is_err());
        assert!(
            AudioEffect::Gain {
                decibels: f64::INFINITY
            }
            .validate()
            .is_err()
        );
        assert!(
            OutputRouting::Midi {
                endpoint: "synth".into(),
                channel: 16,
                patch: None
            }
            .validate()
            .is_err()
        );
    }
}
