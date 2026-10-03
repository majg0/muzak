//! Pitch vocabulary. Names describe exact content; they do not generate it.
//! Function, spelling, chord membership and voice correspondence are independent.
use super::spectrum::{FrequencyRatio, project_log_frequency, validate_log_basis};
use super::{EntityId, Rational, Scalar};
use crate::composition::PitchLattice;
use crate::error::{CoreResult, invalid};
use crate::model::{MAX_SAFE, Pitch};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use ts_rs::TS;

fn pitch_valid(pitch: Pitch) -> CoreResult<()> {
    if pitch.millicents.unsigned_abs() > MAX_SAFE {
        return Err(invalid("Ontology pitch exceeds exact interchange range."));
    }
    Ok(())
}

/// The same native register interval describes an instrument's playable range,
/// a voice's tessitura, or a requested register; its use supplies the meaning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyPitchRange")]
pub struct PitchRange {
    pub low: Pitch,
    pub high: Pitch,
}
impl PitchRange {
    pub fn validate(&self) -> CoreResult<()> {
        pitch_valid(self.low)?;
        pitch_valid(self.high)?;
        if self.low.millicents > self.high.millicents {
            return Err(invalid("The low pitch must not exceed the high pitch."));
        }
        Ok(())
    }
}
fn name_valid(name: &str) -> CoreResult<()> {
    if name.trim().is_empty() {
        return Err(invalid("Pitch member names must be nonempty."));
    }
    Ok(())
}

/// An exact signed interval, optionally accompanied by a notational reading.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyInterval")]
pub struct Interval {
    pub millicents: i64,
    pub notation: Option<IntervalNotation>,
}
impl Interval {
    pub fn validate(&self) -> CoreResult<()> {
        pitch_valid(Pitch {
            millicents: self.millicents,
        })?;
        if let Some(notation) = &self.notation {
            match notation.quality {
                IntervalQuality::Augmented { multiplicity: 0 }
                | IntervalQuality::Diminished { multiplicity: 0 } => {
                    return Err(invalid(
                        "An augmented or diminished interval needs a positive multiplicity.",
                    ));
                }
                _ => {}
            }
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyIntervalNotation")]
pub struct IntervalNotation {
    /// Signed staff steps: unison = 0, ascending second = 1, descending octave = -7.
    pub diatonic_steps: i32,
    pub quality: IntervalQuality,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyIntervalQuality")]
pub enum IntervalQuality {
    Perfect,
    Major,
    Minor,
    Neutral,
    Augmented { multiplicity: u8 },
    Diminished { multiplicity: u8 },
    Unclassified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpelling")]
pub struct Spelling {
    pub letter: PitchLetter,
    pub accidental: Accidental,
    /// Scientific pitch-notation octave; absent when only a pitch class is spelled.
    pub octave: Option<i32>,
}
impl Spelling {
    pub fn validate(&self) -> CoreResult<()> {
        if let Accidental::Custom { alteration, glyph } = &self.accidental {
            alteration.validate()?;
            name_valid(glyph)?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPitchLetter")]
pub enum PitchLetter {
    C,
    D,
    E,
    F,
    G,
    A,
    B,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyAccidental")]
pub enum Accidental {
    Natural,
    Sharp,
    Flat,
    DoubleSharp,
    DoubleFlat,
    TripleSharp,
    TripleFlat,
    QuarterSharp,
    QuarterFlat,
    ThreeQuarterSharp,
    ThreeQuarterFlat,
    Custom { alteration: Interval, glyph: String },
}

/// An ordered pitch collection, independent of its classification and melodic use.
/// A collection can reuse the compiler's native lattice, select exact tuning degrees,
/// or retain finite pitches without inventing a period or missing members.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyScale")]
pub struct Scale {
    pub pitches: ScalePitches,
    pub family: ScaleFamily,
    pub mode: Option<Mode>,
    pub usage: ScaleUsage,
    /// Optional spellings in the selected collection's order, not the tuning's order.
    pub spellings: Vec<Spelling>,
}
impl Scale {
    pub fn validate(&self) -> CoreResult<()> {
        self.pitches.validate()?;
        if !self.spellings.is_empty() && self.spellings.len() != self.member_count() {
            return Err(invalid(
                "Scale spellings must cover every degree or remain absent.",
            ));
        }
        for spelling in &self.spellings {
            spelling.validate()?;
        }
        if let Some(mode) = &self.mode {
            mode.validate()?;
            if mode.tonic_degree as usize >= self.member_count() {
                return Err(invalid("Mode tonic is outside its pitch collection."));
            }
        }
        Ok(())
    }
    pub fn member_count(&self) -> usize {
        self.pitches.member_count()
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.pitches.references()
    }
}

/// Values and degree selections are explicit alternatives, not parallel descriptions
/// that silently acquire a correspondence from equal cardinality or current pitch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyScalePitches")]
pub enum ScalePitches {
    /// Reuses the sole composition compiler's exact periodic domain.
    Native { lattice: PitchLattice },
    /// Zero-based tuning degree indices in explicitly chosen collection order.
    /// Indices are unique; neither sorting nor a chromatic-to-degree map is inferred.
    /// Document validation checks these indices against the referenced tuning.
    TuningDegrees { tuning: EntityId, degrees: Vec<u32> },
    /// A finite ordered collection of unique native pitches, without a period.
    /// Order is retained; ascending/descending/contextual use is declared separately.
    Explicit { pitches: Vec<Pitch> },
}
impl ScalePitches {
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Native { lattice } => lattice.validate(),
            Self::TuningDegrees { tuning, degrees } => {
                tuning.validate()?;
                let mut seen = HashSet::new();
                if degrees.is_empty() || degrees.iter().any(|degree| !seen.insert(*degree)) {
                    return Err(invalid("Scale tuning degrees must be nonempty and unique."));
                }
                Ok(())
            }
            Self::Explicit { pitches } => {
                if pitches.is_empty() {
                    return Err(invalid("An explicit scale requires pitches."));
                }
                let mut seen = HashSet::new();
                for pitch in pitches {
                    pitch_valid(*pitch)?;
                    if !seen.insert(pitch.millicents) {
                        return Err(invalid("Explicit scale pitches must be unique."));
                    }
                }
                Ok(())
            }
        }
    }
    pub fn member_count(&self) -> usize {
        match self {
            Self::Native { lattice } => lattice.intervals.len(),
            Self::TuningDegrees { degrees, .. } => degrees.len(),
            Self::Explicit { pitches } => pitches.len(),
        }
    }
    pub fn references(&self) -> Vec<&EntityId> {
        match self {
            Self::TuningDegrees { tuning, .. } => vec![tuning],
            Self::Native { .. } | Self::Explicit { .. } => vec![],
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyScaleFamily")]
pub enum ScaleFamily {
    Diatonic,
    MelodicMinor,
    HarmonicMinor,
    HarmonicMajor,
    DoubleHarmonic,
    Pentatonic,
    Hexatonic,
    Heptatonic,
    Octatonic,
    WholeTone,
    Chromatic,
    Blues,
    Bebop,
    Diminished,
    Augmented,
    Acoustic,
    Overtone,
    Symmetric,
    NonOctave,
    ObservedVocabulary,
    Unclassified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyScaleUsage")]
pub enum ScaleUsage {
    Ascending,
    Descending,
    Bidirectional,
    Contextual,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMode")]
pub struct Mode {
    pub name: ModeName,
    /// Zero-based degree in the owning exact collection, not a transposition operation.
    pub tonic_degree: u32,
}
impl Mode {
    pub fn validate(&self) -> CoreResult<()> {
        if let ModeName::Named { name } = &self.name {
            name_valid(name)?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyModeName")]
pub enum ModeName {
    Ionian,
    Dorian,
    Phrygian,
    Lydian,
    Mixolydian,
    Aeolian,
    Locrian,
    Major,
    NaturalMinor,
    HarmonicMinor,
    MelodicMinor,
    HarmonicMajor,
    DorianFlatSecond,
    LydianAugmented,
    LydianDominant,
    MixolydianFlatSixth,
    LocrianNaturalSecond,
    Altered,
    PhrygianDominant,
    UkrainianDorian,
    HungarianMinor,
    DoubleHarmonicMajor,
    NeapolitanMajor,
    NeapolitanMinor,
    MajorPentatonic,
    MinorPentatonic,
    MajorBlues,
    MinorBlues,
    WholeTone,
    WholeHalfDiminished,
    HalfWholeDiminished,
    Augmented,
    Chromatic,
    Hirajoshi,
    InSen,
    Iwato,
    Yo,
    Persian,
    MessiaenModeOne,
    MessiaenModeTwo,
    MessiaenModeThree,
    MessiaenModeFour,
    MessiaenModeFive,
    MessiaenModeSix,
    MessiaenModeSeven,
    Named { name: String },
    Unnamed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTuning")]
pub struct Tuning {
    /// Optional native calibration for the reference frequency. This does not
    /// assert that any degree has that pitch or create a native pitch mapping.
    pub reference_pitch: Option<Pitch>,
    /// Independent acoustic reference, not necessarily a degree or fundamental.
    pub reference_frequency_hz: f64,
    pub mapping: TuningMapping,
    pub temperament: Option<Temperament>,
}
impl Tuning {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(reference_pitch) = self.reference_pitch {
            pitch_valid(reference_pitch)?;
        }
        if !self.reference_frequency_hz.is_finite() || self.reference_frequency_hz <= 0.0 {
            return Err(invalid(
                "Tuning reference frequency must be finite and positive.",
            ));
        }
        self.mapping.validate()
    }
    /// Number of declared degree identities. Coordinates may coincide or span
    /// several repetitions; neither sorting nor reduction by a period is implied.
    pub fn degree_count(&self) -> usize {
        match &self.mapping {
            TuningMapping::Logarithmic { degrees, .. } => degrees.len(),
            TuningMapping::FrequencyRatios { degrees, .. } => degrees.len(),
            TuningMapping::ExplicitFrequencies { pitches } => pitches.len(),
        }
    }
    pub fn is_periodic(&self) -> bool {
        match &self.mapping {
            TuningMapping::Logarithmic { period, .. } => period.is_some(),
            TuningMapping::FrequencyRatios { period_ratio, .. } => period_ratio.is_some(),
            TuningMapping::ExplicitFrequencies { .. } => false,
        }
    }
    /// Approximate acoustic projection of a degree and a declared repetition.
    /// Stored exact coordinates remain unchanged. This does not round to native
    /// note pitches, construct a spectrum, or synthesize a sound.
    pub fn project_frequency(&self, degree: usize, period: i32) -> CoreResult<f64> {
        self.validate()?;
        if period != 0 && !self.is_periodic() {
            return Err(invalid("A finite tuning has no nonzero period address."));
        }
        let missing_degree = || invalid("Tuning degree is outside its declared collection.");
        let frequency_hz = match &self.mapping {
            TuningMapping::Logarithmic {
                basis,
                degrees,
                period: repetition,
            } => {
                let coordinate = degrees.get(degree).ok_or_else(missing_degree)?.value()?;
                let exponent = match repetition {
                    Some(repetition) => f64::from(period).mul_add(repetition.value()?, coordinate),
                    None => coordinate,
                };
                project_log_frequency(self.reference_frequency_hz, basis, exponent)?
            }
            TuningMapping::FrequencyRatios {
                period_ratio,
                degrees,
            } => {
                let ratio_log = degrees.get(degree).ok_or_else(missing_degree)?.ln_value()?;
                let displacement = match period_ratio {
                    Some(repetition) => {
                        f64::from(period).mul_add(repetition.ln_value()?, ratio_log)
                    }
                    None => ratio_log,
                };
                if displacement == 0.0 {
                    self.reference_frequency_hz
                } else {
                    (self.reference_frequency_hz.ln() + displacement).exp()
                }
            }
            TuningMapping::ExplicitFrequencies { pitches } => {
                pitches.get(degree).ok_or_else(missing_degree)?.frequency_hz
            }
        };
        if !frequency_hz.is_finite() || frequency_hz <= 0.0 {
            return Err(invalid(
                "Tuning frequency projection overflowed or underflowed.",
            ));
        }
        Ok(frequency_hz)
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyTuningMapping")]
pub enum TuningMapping {
    /// f = reference_frequency_hz * basis^(coordinate + period_index * period).
    /// The positive non-unit basis, ordered coordinate vector and optional
    /// positive repetition are independent. Coordinates can be negative, exceed
    /// one, repeat, or appear in any order. There is no implicit modulo operation.
    Logarithmic {
        basis: FrequencyRatio,
        degrees: Vec<Scalar>,
        period: Option<Scalar>,
    },
    /// f = reference_frequency_hz * degree_ratio * period_ratio^period_index.
    /// Ratios preserve explicit order and identity, including equal values.
    /// No unison, ascending order, period range, or native coordinates are implied.
    FrequencyRatios {
        period_ratio: Option<FrequencyRatio>,
        degrees: Vec<FrequencyRatio>,
    },
    /// Finite, potentially aperiodic mapping. Degree indices refer to this exact
    /// table order; the reference pair does not add an unlisted table entry.
    ExplicitFrequencies { pitches: Vec<TunedPitch> },
}
impl TuningMapping {
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Logarithmic {
                basis,
                degrees,
                period,
            } => {
                validate_log_basis(basis)?;
                if degrees.is_empty() {
                    return Err(invalid("A logarithmic tuning requires coordinates."));
                }
                for degree in degrees {
                    degree.validate()?;
                }
                if let Some(period) = period {
                    period.validate()?;
                    let zero = Scalar::Exact {
                        value: Rational {
                            numerator: 0,
                            denominator: 1,
                        },
                    };
                    if period.compare(&zero)? != Ordering::Greater {
                        return Err(invalid("A logarithmic repetition period must be positive."));
                    }
                }
            }
            Self::FrequencyRatios {
                period_ratio,
                degrees,
            } => {
                if degrees.is_empty() {
                    return Err(invalid("A ratio tuning requires degree ratios."));
                }
                for degree in degrees {
                    degree.validate()?;
                }
                if let Some(period_ratio) = period_ratio {
                    period_ratio.validate()?;
                    if period_ratio.compare(&FrequencyRatio::exact(1, 1))? == Ordering::Equal {
                        return Err(invalid("A tuning repetition ratio cannot equal one."));
                    }
                }
            }
            Self::ExplicitFrequencies { pitches } => {
                if pitches.is_empty() {
                    return Err(invalid("An explicit tuning requires pitches."));
                }
                let mut seen = HashSet::new();
                for entry in pitches {
                    pitch_valid(entry.pitch)?;
                    if !seen.insert(entry.pitch.millicents)
                        || !entry.frequency_hz.is_finite()
                        || entry.frequency_hz <= 0.0
                    {
                        return Err(invalid(
                            "Explicit tuning pitches must be unique with finite positive frequencies.",
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// Convenience constructor using the same logarithmic representation:
    /// coordinates k/divisions and repetition one in the requested basis.
    /// The u16 count bounds this helper's allocation, not the representable
    /// cardinality of a directly declared logarithmic tuning.
    pub fn equal_division(basis: FrequencyRatio, divisions: u16) -> CoreResult<Self> {
        basis.validate()?;
        if basis.compare(&FrequencyRatio::exact(1, 1))? == Ordering::Equal || divisions == 0 {
            return Err(invalid(
                "Equal division requires a non-unit basis and positive count.",
            ));
        }
        let mut degrees = Vec::new();
        degrees
            .try_reserve_exact(divisions as usize)
            .map_err(|_| invalid("Equal-division coordinate allocation failed."))?;
        for numerator in 0..divisions {
            degrees.push(Scalar::Exact {
                value: Rational {
                    numerator: i64::from(numerator),
                    denominator: u64::from(divisions),
                },
            });
        }
        let mapping = Self::Logarithmic {
            basis,
            degrees,
            period: Some(Scalar::Exact {
                value: Rational {
                    numerator: 1,
                    denominator: 1,
                },
            }),
        };
        mapping.validate()?;
        Ok(mapping)
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTunedPitch")]
pub struct TunedPitch {
    pub pitch: Pitch,
    pub frequency_hz: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTemperament")]
pub enum Temperament {
    Equal,
    Just,
    Pythagorean,
    Meantone,
    QuarterCommaMeantone,
    Well,
    Werckmeister,
    Kirnberger,
    Vallotti,
    Young,
    Stretched,
    Adaptive,
    Unspecified,
}

/// A pitch collection with explicit member roles. Function lives in its own entity.
/// The reference fixes register even when the root interpretation is unknown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyChord")]
pub struct Chord {
    pub reference: Pitch,
    pub root: Option<Interval>,
    pub quality: ChordQuality,
    pub members: Vec<ChordMember>,
    pub functions: Vec<EntityId>,
}
impl Chord {
    pub fn validate(&self) -> CoreResult<()> {
        pitch_valid(self.reference)?;
        if let Some(root) = &self.root {
            root.validate()?;
            let absolute = i128::from(self.reference.millicents) + i128::from(root.millicents);
            if absolute.unsigned_abs() > u128::from(MAX_SAFE) {
                return Err(invalid("Chord root exceeds exact interchange range."));
            }
        }
        if self.members.is_empty() {
            return Err(invalid("A chord requires explicit member content."));
        }
        let mut seen = HashSet::new();
        for member in &self.members {
            name_valid(&member.id)?;
            if !seen.insert(&member.id) {
                return Err(invalid("Chord member IDs must be unique."));
            }
            member.interval.validate()?;
            let realized =
                i128::from(self.reference.millicents) + i128::from(member.interval.millicents);
            if realized.unsigned_abs() > u128::from(MAX_SAFE) {
                return Err(invalid("Chord member exceeds exact interchange range."));
            }
            if let Some(degree) = &member.degree {
                if degree.number == 0 {
                    return Err(invalid("Chord degree numbers begin at one."));
                }
                degree.alteration.validate()?;
            }
        }
        for function in &self.functions {
            function.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.functions.iter().collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyChordMember")]
pub struct ChordMember {
    pub id: String,
    /// Relative to Chord.reference, retaining signed register rather than pitch class.
    pub interval: Interval,
    pub degree: Option<ChordDegree>,
    pub role: ChordMemberRole,
    pub presence: MemberPresence,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyChordDegree")]
pub struct ChordDegree {
    pub number: u16,
    pub alteration: Interval,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyChordMemberRole")]
pub enum ChordMemberRole {
    Core,
    Color { color: HarmonicColor },
    Unexplained,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMemberPresence")]
pub enum MemberPresence {
    Present,
    Omitted,
    Implied,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyHarmonicColor")]
pub enum HarmonicColor {
    AddedTone,
    Extension,
    Alteration,
    Suspension,
    Appoggiatura,
    Pedal,
    Cluster,
    UpperStructure,
    BlueNote,
    MicrotonalInflection,
    Unclassified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyChordQuality")]
pub enum ChordQuality {
    Major,
    Minor,
    Diminished,
    Augmented,
    SuspendedSecond,
    SuspendedFourth,
    Power,
    DominantSeventh,
    MajorSeventh,
    MinorSeventh,
    MinorMajorSeventh,
    HalfDiminishedSeventh,
    DiminishedSeventh,
    AugmentedMajorSeventh,
    AugmentedSeventh,
    MajorSixth,
    MinorSixth,
    SixthNinth,
    Ninth,
    Eleventh,
    Thirteenth,
    AddedNinth,
    Quartal,
    Quintal,
    Secundal,
    Cluster,
    Polychord,
    Microtonal,
    Unclassified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicing")]
pub struct Voicing {
    pub chord: Option<EntityId>,
    pub members: Vec<VoicedMember>,
    pub disposition: VoicingDisposition,
    /// Explicit member ID; neither list order nor highest/lowest pitch implies a voice.
    pub bass_member: Option<String>,
    pub correspondences: Vec<MemberCorrespondence>,
}
impl Voicing {
    pub fn validate(&self) -> CoreResult<()> {
        if self.members.is_empty() {
            return Err(invalid("A voicing requires explicit members."));
        }
        if let VoicingInversion::Inverted { bass_degree } = &self.disposition.inversion {
            if bass_degree.number == 0 {
                return Err(invalid("An inversion's bass degree begins at one."));
            }
            bass_degree.alteration.validate()?;
        }
        if self.disposition.inversion == VoicingInversion::RootPosition
            && self.disposition.root_presence == RootPresence::Rootless
        {
            return Err(invalid("A rootless voicing cannot be in root position."));
        }
        if let Some(chord) = &self.chord {
            chord.validate()?;
        }
        let mut seen = HashSet::new();
        for member in &self.members {
            name_valid(&member.id)?;
            if !seen.insert(&member.id) {
                return Err(invalid("Voicing member IDs must be unique."));
            }
            pitch_valid(member.pitch)?;
            if let Some(voice) = &member.voice {
                voice.validate()?;
            }
            if let Some(chord_member) = &member.chord_member {
                name_valid(chord_member)?;
                if self.chord.is_none() {
                    return Err(invalid("A chord-member address requires a chord entity."));
                }
            }
        }
        if self
            .bass_member
            .as_ref()
            .is_some_and(|member| !seen.contains(member))
        {
            return Err(invalid("The declared bass must be a voicing member."));
        }
        for correspondence in &self.correspondences {
            if !seen.contains(&correspondence.from_member) {
                return Err(invalid(
                    "Voice correspondence must begin at an exact voicing member.",
                ));
            }
            correspondence.to.voicing.validate()?;
            name_valid(&correspondence.to.member)?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.chord
            .iter()
            .chain(
                self.members
                    .iter()
                    .filter_map(|member| member.voice.as_ref()),
            )
            .chain(self.correspondences.iter().map(|link| &link.to.voicing))
            .collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicedMember")]
pub struct VoicedMember {
    pub id: String,
    pub pitch: Pitch,
    pub chord_member: Option<String>,
    pub voice: Option<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicingDisposition")]
pub struct VoicingDisposition {
    pub spacing: VoicingSpacing,
    pub drop: VoicingDrop,
    pub inversion: VoicingInversion,
    pub root_presence: RootPresence,
    pub density: VoicingDensity,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicingSpacing")]
pub enum VoicingSpacing {
    Close,
    Open,
    Spread,
    Cluster,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicingDrop")]
pub enum VoicingDrop {
    None,
    DropTwo,
    DropThree,
    DropTwoAndFour,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyVoicingInversion")]
pub enum VoicingInversion {
    RootPosition,
    Inverted { bass_degree: ChordDegree },
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyRootPresence")]
pub enum RootPresence {
    Present,
    Rootless,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicingDensity")]
pub enum VoicingDensity {
    Full,
    Shell,
    Partial,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMemberCorrespondence")]
pub struct MemberCorrespondence {
    pub from_member: String,
    pub to: VoicedMemberAddress,
    pub relation: VoiceLeadingRelation,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoicedMemberAddress")]
pub struct VoicedMemberAddress {
    pub voicing: EntityId,
    pub member: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoiceLeadingRelation")]
pub enum VoiceLeadingRelation {
    Continuation,
    CommonTone,
    Resolution,
    Preparation,
    Suspension,
    Retardation,
    Anticipation,
    Passing,
    Neighbor,
    RegisterTransfer,
    Unclassified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyKey")]
pub struct Key {
    pub tonic: Pitch,
    pub spelling: Option<Spelling>,
    pub scale: Option<EntityId>,
    pub modality: KeyModality,
    pub signature: Vec<KeyAccidental>,
}
impl Key {
    pub fn validate(&self) -> CoreResult<()> {
        pitch_valid(self.tonic)?;
        if let Some(spelling) = &self.spelling {
            spelling.validate()?;
        }
        if let Some(scale) = &self.scale {
            scale.validate()?;
        }
        if let KeyModality::Modal {
            mode: ModeName::Named { name },
        } = &self.modality
        {
            name_valid(name)?;
        }
        let mut seen = HashSet::new();
        for entry in &self.signature {
            if !seen.insert(std::mem::discriminant(&entry.letter)) {
                return Err(invalid(
                    "A key signature cannot assign a pitch letter twice.",
                ));
            }
            Spelling {
                letter: entry.letter.clone(),
                accidental: entry.accidental.clone(),
                octave: None,
            }
            .validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.scale.iter().collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyKeyAccidental")]
pub struct KeyAccidental {
    pub letter: PitchLetter,
    pub accidental: Accidental,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyKeyModality")]
pub enum KeyModality {
    Major,
    Minor,
    Modal { mode: ModeName },
    Mixed,
    Unspecified,
}

/// A contextual harmonic reading, separate from a realized chord's root and colors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyHarmonicFunction")]
pub struct HarmonicFunction {
    pub key: Option<EntityId>,
    pub degree: Option<ScaleDegree>,
    pub role: FunctionRole,
    pub structural_layer: HarmonicLayer,
    pub tonicization: Option<ScaleDegree>,
    pub bass_degree: Option<ScaleDegree>,
}
impl HarmonicFunction {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(key) = &self.key {
            key.validate()?;
        }
        for degree in [&self.degree, &self.tonicization, &self.bass_degree]
            .into_iter()
            .flatten()
        {
            if degree.number == 0 {
                return Err(invalid("Functional scale degrees begin at one."));
            }
            degree.alteration.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.key.iter().collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyScaleDegree")]
pub struct ScaleDegree {
    pub number: u16,
    pub alteration: Interval,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyFunctionRole")]
pub enum FunctionRole {
    Tonic,
    Supertonic,
    Mediant,
    Subdominant,
    Dominant,
    Submediant,
    LeadingTone,
    Predominant,
    Prolongation,
    SecondaryDominant,
    SecondaryLeadingTone,
    Borrowed,
    ModalMixture,
    Neapolitan,
    AugmentedSixth,
    CadentialSixFour,
    ChromaticMediant,
    TritoneSubstitution,
    BackdoorDominant,
    Pedal,
    Nonfunctional,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyHarmonicLayer")]
pub enum HarmonicLayer {
    Background,
    Middleground,
    Surface,
    Event,
    Unspecified,
}

/// Ordered chord-member attacks; durations and timing belong to the referenced events
/// or rhythmic material, so an arpeggio can share either harmony or rhythm independently.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyArpeggio")]
pub struct Arpeggio {
    pub chord: EntityId,
    pub attacks: Vec<ArpeggioAttack>,
    pub rhythm: Option<EntityId>,
    pub direction: ArpeggioDirection,
}
impl Arpeggio {
    pub fn validate(&self) -> CoreResult<()> {
        self.chord.validate()?;
        if self.attacks.is_empty() {
            return Err(invalid("An arpeggio requires explicit member attacks."));
        }
        let mut seen = HashSet::new();
        for attack in &self.attacks {
            name_valid(&attack.member)?;
            attack.event.validate()?;
            if !seen.insert(&attack.event.0) {
                return Err(invalid("Arpeggio attacks must address distinct events."));
            }
        }
        if let Some(rhythm) = &self.rhythm {
            rhythm.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        std::iter::once(&self.chord)
            .chain(self.rhythm.iter())
            .chain(self.attacks.iter().map(|attack| &attack.event))
            .collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyArpeggioAttack")]
pub struct ArpeggioAttack {
    pub member: String,
    pub event: EntityId,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyArpeggioDirection")]
pub enum ArpeggioDirection {
    Ascending,
    Descending,
    Alternating,
    Patterned,
    Unspecified,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interval(value: i64) -> Interval {
        Interval {
            millicents: value,
            notation: None,
        }
    }

    fn ratio(numerator: i64, denominator: u64) -> FrequencyRatio {
        FrequencyRatio::exact(numerator, denominator)
    }

    fn scalar(numerator: i64, denominator: u64) -> Scalar {
        Scalar::Exact {
            value: Rational {
                numerator,
                denominator,
            },
        }
    }

    fn tuning(mapping: TuningMapping) -> Tuning {
        Tuning {
            reference_pitch: None,
            reference_frequency_hz: 440.0,
            mapping,
            temperament: None,
        }
    }

    fn assert_frequency(tuning: &Tuning, degree: usize, period: i32, expected: f64) {
        let actual = tuning.project_frequency(degree, period).unwrap();
        assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
    }

    #[test]
    fn a_scale_retains_an_arbitrary_period_without_diatonic_completion() {
        let scale = Scale {
            pitches: ScalePitches::Native {
                lattice: PitchLattice {
                    id: "tritave".into(),
                    origin_millicents: 6_000_000,
                    intervals: vec![0, 317_000, 811_000],
                    period_millicents: 1_901_955,
                },
            },
            family: ScaleFamily::NonOctave,
            mode: Some(Mode {
                name: ModeName::Unnamed,
                tonic_degree: 2,
            }),
            usage: ScaleUsage::Contextual,
            spellings: vec![],
        };
        scale.validate().unwrap();
        let round_trip: Scale =
            serde_json::from_str(&serde_json::to_string(&scale).unwrap()).unwrap();
        assert_eq!(round_trip, scale);
        assert_eq!(round_trip.member_count(), 3);
        let mut invalid = scale;
        invalid.mode.as_mut().unwrap().tonic_degree = 3;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn a_tuned_scale_selects_degrees_and_indexes_its_own_mode() {
        let scale = Scale {
            pitches: ScalePitches::TuningDegrees {
                tuning: EntityId("thirteen-tritave-degrees".into()),
                degrees: vec![12, 0, 7],
            },
            family: ScaleFamily::NonOctave,
            mode: Some(Mode {
                name: ModeName::Unnamed,
                tonic_degree: 1,
            }),
            usage: ScaleUsage::Contextual,
            spellings: vec![],
        };
        scale.validate().unwrap();
        assert_eq!(scale.member_count(), 3);
        assert_eq!(scale.references()[0].0, "thirteen-tritave-degrees");
        let round_trip: Scale =
            serde_json::from_str(&serde_json::to_string(&scale).unwrap()).unwrap();
        assert_eq!(round_trip, scale);
        let mut invalid = scale.clone();
        invalid.mode.as_mut().unwrap().tonic_degree = 7;
        assert!(invalid.validate().is_err());
        invalid.mode = None;
        invalid.pitches = ScalePitches::TuningDegrees {
            tuning: EntityId("thirteen-tritave-degrees".into()),
            degrees: vec![0, 7, 0],
        };
        assert!(invalid.validate().is_err());
        invalid.pitches = ScalePitches::TuningDegrees {
            tuning: EntityId("thirteen-tritave-degrees".into()),
            degrees: vec![],
        };
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn finite_scale_preserves_order_and_exact_pitches_without_a_period() {
        let mut scale = Scale {
            pitches: ScalePitches::Explicit {
                pitches: vec![
                    Pitch {
                        millicents: 6_712_419,
                    },
                    Pitch {
                        millicents: 6_000_000,
                    },
                    Pitch {
                        millicents: 5_481_977,
                    },
                ],
            },
            family: ScaleFamily::Unclassified,
            mode: None,
            usage: ScaleUsage::Descending,
            spellings: vec![],
        };
        scale.validate().unwrap();
        assert!(scale.references().is_empty());
        let serialized = serde_json::to_value(&scale).unwrap();
        assert_eq!(serialized["pitches"]["kind"], "explicit");
        assert_eq!(serialized["pitches"]["pitches"][0]["millicents"], 6_712_419);
        assert!(serialized["pitches"].get("period").is_none());
        let round_trip: Scale = serde_json::from_value(serialized).unwrap();
        assert_eq!(round_trip, scale);
        scale.pitches = ScalePitches::Explicit {
            pitches: vec![Pitch { millicents: 0 }, Pitch { millicents: 0 }],
        };
        assert!(scale.validate().is_err());
        scale.pitches = ScalePitches::Explicit { pitches: vec![] };
        assert!(scale.validate().is_err());
        scale.pitches = ScalePitches::Explicit {
            pitches: vec![Pitch {
                millicents: MAX_SAFE as i64 + 1,
            }],
        };
        assert!(scale.validate().is_err());
    }

    #[test]
    fn equal_division_uses_the_same_log_vector_with_independent_basis_and_reference() {
        let mut tuning = tuning(TuningMapping::equal_division(ratio(2, 1), 12).unwrap());
        tuning.validate().unwrap();
        assert_eq!(tuning.degree_count(), 12);
        assert!(tuning.is_periodic());
        let TuningMapping::Logarithmic {
            degrees, period, ..
        } = &tuning.mapping
        else {
            panic!("Equal division must construct a logarithmic vector.");
        };
        assert_eq!(*degrees, (0..12).map(|i| scalar(i, 12)).collect::<Vec<_>>());
        assert_eq!(*period, Some(scalar(1, 1)));
        let original_degrees = degrees.clone();
        assert_frequency(&tuning, 0, 0, 440.0);
        assert_frequency(&tuning, 6, 0, 440.0 * 2.0_f64.sqrt());
        assert_frequency(&tuning, 0, 1, 880.0);

        if let TuningMapping::Logarithmic { basis, .. } = &mut tuning.mapping {
            *basis = ratio(3, 1);
        }
        assert_frequency(&tuning, 6, 0, 440.0 * 3.0_f64.sqrt());
        assert_frequency(&tuning, 0, 1, 1320.0);
        tuning.reference_frequency_hz = 432.0;
        assert_frequency(&tuning, 0, 0, 432.0);
        assert_frequency(&tuning, 6, 0, 432.0 * 3.0_f64.sqrt());
        let TuningMapping::Logarithmic { basis, degrees, .. } = &tuning.mapping else {
            unreachable!();
        };
        assert_eq!(*basis, ratio(3, 1));
        assert_eq!(*degrees, original_degrees);
    }

    #[test]
    fn logarithmic_coordinates_keep_negative_extended_and_coincident_identities() {
        let mut tuning = tuning(TuningMapping::Logarithmic {
            basis: ratio(2, 1),
            degrees: vec![scalar(3, 2), scalar(-1, 4), scalar(1, 2), scalar(1, 2)],
            period: Some(scalar(3, 4)),
        });
        tuning.validate().unwrap();
        assert_eq!(tuning.degree_count(), 4);
        assert_frequency(&tuning, 0, 0, 440.0 * 2.0_f64.powf(1.5));
        assert_frequency(&tuning, 1, 0, 440.0 * 2.0_f64.powf(-0.25));
        assert_frequency(&tuning, 0, -2, 440.0);
        assert_eq!(
            tuning.project_frequency(2, 0).unwrap(),
            tuning.project_frequency(3, 0).unwrap()
        );
        if let TuningMapping::Logarithmic { degrees, .. } = &mut tuning.mapping {
            degrees[2] = scalar(1, 4);
        }
        assert_frequency(&tuning, 2, 0, 440.0 * 2.0_f64.powf(0.25));
        assert_frequency(&tuning, 3, 0, 440.0 * 2.0_f64.powf(0.5));
        let round_trip: Tuning =
            serde_json::from_str(&serde_json::to_string(&tuning).unwrap()).unwrap();
        assert_eq!(round_trip, tuning);
    }

    #[test]
    fn aperiodic_tunings_reject_invented_repetitions() {
        let mut tuning = tuning(TuningMapping::Logarithmic {
            basis: ratio(1, 2),
            degrees: vec![scalar(-2, 1), scalar(3, 1)],
            period: None,
        });
        tuning.validate().unwrap();
        assert!(!tuning.is_periodic());
        assert_frequency(&tuning, 0, 0, 1760.0);
        assert_frequency(&tuning, 1, 0, 55.0);
        assert!(tuning.project_frequency(0, 1).is_err());
        assert!(tuning.project_frequency(0, -1).is_err());
        assert!(tuning.project_frequency(2, 0).is_err());
        tuning.mapping = TuningMapping::ExplicitFrequencies {
            pitches: vec![TunedPitch {
                pitch: Pitch {
                    millicents: 6_712_419,
                },
                frequency_hz: 397.123,
            }],
        };
        tuning.validate().unwrap();
        assert!(!tuning.is_periodic());
        assert_eq!(tuning.degree_count(), 1);
        assert_frequency(&tuning, 0, 0, 397.123);
        tuning.reference_frequency_hz = 432.0;
        assert_frequency(&tuning, 0, 0, 397.123);
        assert!(tuning.project_frequency(0, 1).is_err());
    }

    #[test]
    fn ratio_coordinates_keep_order_repeats_and_approximate_values_without_a_unison() {
        let mut tuning = tuning(TuningMapping::FrequencyRatios {
            period_ratio: None,
            degrees: vec![
                ratio(7, 4),
                FrequencyRatio::approximate(std::f64::consts::SQRT_2),
                ratio(7, 4),
                ratio(1, 2),
            ],
        });
        tuning.validate().unwrap();
        assert!(!tuning.is_periodic());
        assert_eq!(tuning.degree_count(), 4);
        assert_frequency(&tuning, 0, 0, 770.0);
        assert_frequency(&tuning, 3, 0, 220.0);
        assert!(tuning.project_frequency(0, 1).is_err());
        let serialized = serde_json::to_value(&tuning).unwrap();
        assert!(serialized["mapping"]["periodRatio"].is_null());
        assert_eq!(serialized["mapping"]["degrees"][0]["kind"], "exact");
        assert_eq!(serialized["mapping"]["degrees"][1]["kind"], "approximate");
        let round_trip: Tuning = serde_json::from_value(serialized).unwrap();
        assert_eq!(round_trip, tuning);
        if let TuningMapping::FrequencyRatios { period_ratio, .. } = &mut tuning.mapping {
            *period_ratio = Some(ratio(1, 2));
        }
        assert!(tuning.is_periodic());
        assert_frequency(&tuning, 0, 1, 385.0);
        assert_frequency(&tuning, 0, -1, 1540.0);
    }

    #[test]
    fn tuning_validation_rejects_invalid_bases_coordinates_and_periods() {
        assert!(TuningMapping::equal_division(ratio(2, 1), 0).is_err());
        for basis in [
            ratio(0, 1),
            ratio(-2, 1),
            ratio(1, 1),
            FrequencyRatio::approximate(f64::INFINITY),
        ] {
            assert!(TuningMapping::equal_division(basis, 12).is_err());
        }
        for degrees in [vec![], vec![Scalar::Approximate { value: f64::NAN }]] {
            assert!(
                TuningMapping::Logarithmic {
                    basis: ratio(2, 1),
                    degrees,
                    period: None,
                }
                .validate()
                .is_err()
            );
        }
        for period in [
            scalar(0, 1),
            scalar(-1, 1),
            Scalar::Approximate {
                value: f64::INFINITY,
            },
        ] {
            assert!(
                TuningMapping::Logarithmic {
                    basis: ratio(2, 1),
                    degrees: vec![scalar(0, 1)],
                    period: Some(period),
                }
                .validate()
                .is_err()
            );
        }
        for period_ratio in [
            ratio(0, 1),
            ratio(1, 1),
            FrequencyRatio::approximate(f64::NAN),
        ] {
            assert!(
                TuningMapping::FrequencyRatios {
                    period_ratio: Some(period_ratio),
                    degrees: vec![ratio(1, 1)],
                }
                .validate()
                .is_err()
            );
        }
        for degrees in [
            vec![],
            vec![ratio(0, 1)],
            vec![FrequencyRatio::approximate(f64::NAN)],
        ] {
            assert!(
                TuningMapping::FrequencyRatios {
                    period_ratio: None,
                    degrees,
                }
                .validate()
                .is_err()
            );
        }
        let mapping = TuningMapping::equal_division(ratio(2, 1), 12).unwrap();
        for reference_frequency_hz in [0.0, -440.0, f64::NAN, f64::INFINITY] {
            let mut invalid = tuning(mapping.clone());
            invalid.reference_frequency_hz = reference_frequency_hz;
            assert!(invalid.validate().is_err());
        }
    }

    #[test]
    fn frequency_projection_reports_overflow_and_underflow_without_native_rounding() {
        let tuning = tuning(TuningMapping::Logarithmic {
            basis: ratio(2, 1),
            degrees: vec![scalar(3000, 1), scalar(-3000, 1)],
            period: None,
        });
        tuning.validate().unwrap();
        assert!(tuning.project_frequency(0, 0).is_err());
        assert!(tuning.project_frequency(1, 0).is_err());
    }

    #[test]
    fn frequency_projection_avoids_intermediate_overflow_and_near_unison_rounding() {
        let mut tuning = tuning(TuningMapping::Logarithmic {
            basis: ratio(MAX_SAFE as i64, MAX_SAFE - 1),
            degrees: vec![scalar(MAX_SAFE as i64 - 1, 1)],
            period: None,
        });
        tuning.reference_frequency_hz = 1.0;
        assert_frequency(&tuning, 0, 0, std::f64::consts::E);
        tuning.mapping = TuningMapping::Logarithmic {
            basis: ratio(10, 1),
            degrees: vec![scalar(400, 1)],
            period: None,
        };
        tuning.reference_frequency_hz = 1e-300;
        let actual = tuning.project_frequency(0, 0).unwrap();
        assert!((actual / 1e100 - 1.0).abs() < 1e-12);
        tuning.mapping = TuningMapping::FrequencyRatios {
            period_ratio: Some(FrequencyRatio::approximate(1e-300)),
            degrees: vec![FrequencyRatio::approximate(1e300)],
        };
        tuning.reference_frequency_hz = 1e300;
        let actual = tuning.project_frequency(0, 1).unwrap();
        assert!((actual / 1e300 - 1.0).abs() < 1e-12);
    }

    #[test]
    fn exact_coordinate_identity_survives_equal_floating_projections() {
        let lower = ratio(MAX_SAFE as i64 - 1, MAX_SAFE - 2);
        let upper = ratio(MAX_SAFE as i64 - 2, MAX_SAFE - 3);
        assert_eq!(lower.value().unwrap(), upper.value().unwrap());
        let tuning = tuning(TuningMapping::FrequencyRatios {
            period_ratio: Some(ratio(2, 1)),
            degrees: vec![upper, lower],
        });
        tuning.validate().unwrap();
        let round_trip: Tuning =
            serde_json::from_str(&serde_json::to_string(&tuning).unwrap()).unwrap();
        assert_eq!(round_trip, tuning);
        let TuningMapping::FrequencyRatios { degrees, .. } = &round_trip.mapping else {
            unreachable!();
        };
        assert_eq!(degrees[0].compare(&degrees[1]).unwrap(), Ordering::Greater);
        assert_eq!(round_trip.degree_count(), 2);
    }

    #[test]
    fn equal_pitches_keep_distinct_members_and_directional_correspondence() {
        let voicing = Voicing {
            chord: None,
            members: vec![
                VoicedMember {
                    id: "a".into(),
                    pitch: Pitch {
                        millicents: 6_000_000,
                    },
                    chord_member: None,
                    voice: None,
                },
                VoicedMember {
                    id: "b".into(),
                    pitch: Pitch {
                        millicents: 6_000_000,
                    },
                    chord_member: None,
                    voice: None,
                },
            ],
            disposition: VoicingDisposition {
                spacing: VoicingSpacing::Unspecified,
                drop: VoicingDrop::Unspecified,
                inversion: VoicingInversion::Unspecified,
                root_presence: RootPresence::Unspecified,
                density: VoicingDensity::Unspecified,
            },
            bass_member: None,
            correspondences: vec![MemberCorrespondence {
                from_member: "a".into(),
                to: VoicedMemberAddress {
                    voicing: EntityId("next".into()),
                    member: "resolved-a".into(),
                },
                relation: VoiceLeadingRelation::Resolution,
            }],
        };
        voicing.validate().unwrap();
        let round_trip: Voicing =
            serde_json::from_str(&serde_json::to_string(&voicing).unwrap()).unwrap();
        assert_eq!(round_trip, voicing);
        assert_eq!(round_trip.members.len(), 2);
        assert_eq!(round_trip.correspondences[0].from_member, "a");
        let mut invalid = voicing;
        invalid.correspondences[0].from_member = "missing".into();
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn diminished_interval_keeps_signed_register_separate_from_quality() {
        let mut descending = interval(-1_300_000);
        descending.notation = Some(IntervalNotation {
            diatonic_steps: -9,
            quality: IntervalQuality::Diminished { multiplicity: 1 },
        });
        descending.validate().unwrap();
        let data = serde_json::to_value(&descending).unwrap();
        assert_eq!(data["millicents"], -1_300_000);
        assert_eq!(data["notation"]["quality"]["kind"], "diminished");
    }
}
