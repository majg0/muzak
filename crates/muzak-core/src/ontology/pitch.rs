//! Pitch vocabulary. Names describe exact content; they do not generate it.
//! Function, spelling, chord membership and voice correspondence are independent.
use super::{EntityId, Rational};
use crate::composition::PitchLattice;
use crate::error::{CoreResult, invalid};
use crate::model::{MAX_SAFE, Pitch};
use serde::{Deserialize, Serialize};
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
fn positive_ratio(value: &Rational) -> CoreResult<()> {
    value.validate()?;
    if value.numerator <= 0 {
        return Err(invalid("Tuning ratios must be positive."));
    }
    Ok(())
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

/// An ordered pitch collection reuses the composition compiler's domain definition.
/// Classification never changes the lattice, fills missing degrees or implies a key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyScale")]
pub struct Scale {
    pub lattice: PitchLattice,
    pub family: ScaleFamily,
    pub mode: Option<Mode>,
    pub usage: ScaleUsage,
    /// Optional degree spellings in the same order as the lattice's intervals.
    pub spellings: Vec<Spelling>,
    pub tuning: Option<EntityId>,
}
impl Scale {
    pub fn validate(&self) -> CoreResult<()> {
        self.lattice.validate()?;
        if !self.spellings.is_empty() && self.spellings.len() != self.lattice.intervals.len() {
            return Err(invalid(
                "Scale spellings must cover every degree or remain absent.",
            ));
        }
        for spelling in &self.spellings {
            spelling.validate()?;
        }
        if let Some(mode) = &self.mode {
            mode.validate()?;
            if mode.tonic_degree as usize >= self.lattice.intervals.len() {
                return Err(invalid("Mode tonic is outside its pitch collection."));
            }
        }
        if let Some(tuning) = &self.tuning {
            tuning.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.tuning.iter().collect()
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
    pub reference_pitch: Pitch,
    pub reference_frequency_hz: f64,
    pub mapping: TuningMapping,
    pub temperament: Option<Temperament>,
}
impl Tuning {
    pub fn validate(&self) -> CoreResult<()> {
        pitch_valid(self.reference_pitch)?;
        if !self.reference_frequency_hz.is_finite() || self.reference_frequency_hz <= 0.0 {
            return Err(invalid(
                "Tuning reference frequency must be finite and positive.",
            ));
        }
        match &self.mapping {
            TuningMapping::EqualDivision { period, divisions } => {
                period.validate()?;
                if period.millicents <= 0 || *divisions == 0 {
                    return Err(invalid(
                        "Equal division requires a positive period and division count.",
                    ));
                }
            }
            TuningMapping::FrequencyRatios {
                period_ratio,
                degrees,
            } => {
                positive_ratio(period_ratio)?;
                if period_ratio.numerator as u64 <= period_ratio.denominator || degrees.is_empty() {
                    return Err(invalid(
                        "Ratio tuning requires a period greater than one and explicit degrees.",
                    ));
                }
                for degree in degrees {
                    positive_ratio(degree)?;
                }
                for pair in degrees.windows(2) {
                    if i128::from(pair[0].numerator) * i128::from(pair[1].denominator)
                        >= i128::from(pair[1].numerator) * i128::from(pair[0].denominator)
                    {
                        return Err(invalid("Tuning ratios must be strictly ascending."));
                    }
                }
                if degrees[0].numerator as u64 != degrees[0].denominator
                    || degrees.iter().any(|degree| {
                        i128::from(degree.numerator) * i128::from(period_ratio.denominator)
                            >= i128::from(period_ratio.numerator) * i128::from(degree.denominator)
                    })
                {
                    return Err(invalid(
                        "Ratio degrees must begin at unison and stay below their period.",
                    ));
                }
            }
            TuningMapping::ExplicitFrequencies { pitches } => {
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
    EqualDivision {
        period: Interval,
        divisions: u32,
    },
    FrequencyRatios {
        period_ratio: Rational,
        degrees: Vec<Rational>,
    },
    ExplicitFrequencies {
        pitches: Vec<TunedPitch>,
    },
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

    #[test]
    fn a_scale_retains_an_arbitrary_period_without_diatonic_completion() {
        let scale = Scale {
            lattice: PitchLattice {
                id: "tritave".into(),
                origin_millicents: 6_000_000,
                intervals: vec![0, 317_000, 811_000],
                period_millicents: 1_901_955,
            },
            family: ScaleFamily::NonOctave,
            mode: Some(Mode {
                name: ModeName::Unnamed,
                tonic_degree: 2,
            }),
            usage: ScaleUsage::Contextual,
            spellings: vec![],
            tuning: None,
        };
        scale.validate().unwrap();
        let round_trip: Scale =
            serde_json::from_str(&serde_json::to_string(&scale).unwrap()).unwrap();
        assert_eq!(round_trip, scale);
        assert_eq!(round_trip.lattice.intervals.len(), 3);
        let mut invalid = scale;
        invalid.mode.as_mut().unwrap().tonic_degree = 3;
        assert!(invalid.validate().is_err());
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
