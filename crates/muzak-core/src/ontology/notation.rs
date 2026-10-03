//! Written signs and sung language are distinct from sounding events and techniques.
//! A tie names event identity endpoints; a slur is a phrasing sign, not a duration merge.

use super::{EntityId, ExtensionTerm, Rational};
use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyNotation")]
pub struct Notation {
    pub system: NotationSystem,
    pub marks: Vec<NotationMark>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyNotationSystem")]
pub enum NotationSystem {
    Staff,
    Tablature,
    Percussion,
    LeadSheet,
    Graphic,
    Proportional,
    Solfege,
    Numbered,
    Mensural,
    Neumatic,
    Kievan,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyNotationMark")]
pub enum NotationMark {
    Clef {
        clef: Clef,
    },
    Staff {
        staff: Staff,
    },
    Accidental {
        glyph: AccidentalGlyph,
        role: AccidentalRole,
    },
    Notehead {
        shape: NoteheadShape,
        filled: Option<bool>,
    },
    Stem {
        direction: StemDirection,
    },
    Beam {
        members: Vec<EntityId>,
        level: u8,
        feathering: Option<BeamFeathering>,
    },
    Rest {
        duration: Rational,
        display: RestDisplay,
    },
    AugmentationDots {
        count: u8,
    },
    TupletBracket {
        actual: u32,
        normal: u32,
        members: Vec<EntityId>,
    },
    Tie {
        from: EntityId,
        to: EntityId,
    },
    Slur {
        from: EntityId,
        to: EntityId,
    },
    PhraseMark {
        from: EntityId,
        to: EntityId,
    },
    OctaveLine {
        from: EntityId,
        to: EntityId,
        octaves: i8,
    },
    Barline {
        style: BarlineStyle,
    },
    Navigation {
        navigation: ScoreNavigation,
    },
    FiguredBass {
        figures: Vec<BassFigure>,
    },
    RehearsalMark {
        label: String,
    },
    Cue {
        source: EntityId,
        cue_type: CueKind,
    },
    Editorial {
        editorial_type: EditorialKind,
        text: Option<String>,
        source: Option<EntityId>,
    },
    Mensural {
        mensuration: Option<Mensuration>,
        value: Option<MensuralValue>,
        coloration: Option<NoteColoration>,
    },
    Ligature {
        members: Vec<EntityId>,
        form: LigatureForm,
    },
    Neume {
        shape: NeumeShape,
        members: Vec<EntityId>,
    },
    Kievan {
        value: KievanValue,
    },
    TablaturePosition {
        course: u16,
        fret: Rational,
    },
    Custom {
        term: ExtensionTerm,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyClef")]
pub struct Clef {
    pub sign: ClefSign,
    /// Lines are numbered from the bottom; non-pitched signs need not name a line.
    pub line: Option<u8>,
    pub octave_displacement: i8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyClefSign")]
pub enum ClefSign {
    G,
    F,
    C,
    Percussion,
    Tablature,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyStaff")]
pub struct Staff {
    pub lines: u8,
    pub grouping: Option<StaffGrouping>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyStaffGrouping")]
pub enum StaffGrouping {
    Brace,
    Bracket,
    Line,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyAccidentalGlyph")]
pub enum AccidentalGlyph {
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
    NaturalSharp,
    NaturalFlat,
    Sori,
    Koron,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyAccidentalRole")]
pub enum AccidentalRole {
    Required,
    Cautionary,
    Courtesy,
    Editorial,
    Ficta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyNoteheadShape")]
pub enum NoteheadShape {
    Normal,
    Cross,
    Diamond,
    Triangle,
    Square,
    Slash,
    Circled,
    Cluster,
    ShapeNote { syllable: ShapeNoteSyllable },
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyShapeNoteSyllable")]
pub enum ShapeNoteSyllable {
    Do,
    Re,
    Mi,
    Fa,
    Sol,
    La,
    Ti,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyStemDirection")]
pub enum StemDirection {
    Up,
    Down,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBeamFeathering")]
pub enum BeamFeathering {
    Accelerating,
    Decelerating,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyRestDisplay")]
pub enum RestDisplay {
    DurationValue,
    Measure,
    MultipleMeasures { measures: u32 },
    Invisible,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBarlineStyle")]
pub enum BarlineStyle {
    Regular,
    Double,
    Final,
    Dashed,
    Dotted,
    Tick,
    Short,
    Invisible,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyScoreNavigation")]
pub enum ScoreNavigation {
    Segno,
    Coda,
    Fine,
    RepeatStart,
    RepeatEnd {
        count: Option<u32>,
        start: Option<EntityId>,
    },
    Volta {
        passes: Vec<u32>,
        from: EntityId,
        to: EntityId,
    },
    Jump {
        instruction: JumpInstruction,
        destination: Option<EntityId>,
    },
    Simile {
        unit: SimileUnit,
        source: EntityId,
    },
    Attacca {
        next: Option<EntityId>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyJumpInstruction")]
pub enum JumpInstruction {
    DaCapo,
    DalSegno,
    DaCapoAlFine,
    DalSegnoAlFine,
    DaCapoAlCoda,
    DalSegnoAlCoda,
    ToCoda,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySimileUnit")]
pub enum SimileUnit {
    Beat,
    Measure,
    Measures { count: u32 },
    Passage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBassFigure")]
pub struct BassFigure {
    /// A missing numeral supports an accidental standing alone above the bass.
    pub number: Option<u16>,
    pub alteration: Option<AccidentalGlyph>,
    pub continuation: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyCueKind")]
pub enum CueKind {
    Entrance,
    Ossia,
    Alternative,
    Reference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEditorialKind")]
pub enum EditorialKind {
    Addition,
    Correction,
    UncertainReading,
    Variant,
    SuppliedAccidental,
    Bracket,
    Footnote,
    SourceAttribution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMensuration")]
pub struct Mensuration {
    pub tempus: MensuralDivision,
    pub prolation: MensuralDivision,
    pub modus: Option<MensuralDivision>,
    pub maximodus: Option<MensuralDivision>,
    pub proportion: Option<Rational>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMensuralDivision")]
pub enum MensuralDivision {
    ImperfectBinary,
    PerfectTernary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMensuralValue")]
pub enum MensuralValue {
    Maxima,
    Longa,
    Brevis,
    Semibrevis,
    Minima,
    Semiminima,
    Fusa,
    Semifusa,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyNoteColoration")]
pub enum NoteColoration {
    Black,
    White,
    Red,
    HalfBlack,
    HalfRed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyLigatureForm")]
pub enum LigatureForm {
    Recta,
    Obliqua,
    Bracketed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyNeumeShape")]
pub enum NeumeShape {
    Punctum,
    Virga,
    Podatus,
    Clivis,
    Torculus,
    Porrectus,
    Scandicus,
    Climacus,
    Quilisma,
    Oriscus,
    Pressus,
    Custos,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyKievanValue")]
pub enum KievanValue {
    Reciting,
    Whole,
    Half,
    Quarter,
    Eighth,
}

impl Notation {
    pub fn validate(&self) -> CoreResult<()> {
        if let NotationSystem::Custom { term } = &self.system {
            valid_term(term)?;
        }
        for reference in self.references() {
            valid_id(reference)?;
        }
        for mark in &self.marks {
            match mark {
                NotationMark::Clef { clef } if clef.line == Some(0) => {
                    return Err(invalid("Clef line numbering begins at one"));
                }
                NotationMark::Staff { staff } if staff.lines == 0 => {
                    return Err(invalid("Staff must have at least one line"));
                }
                NotationMark::Accidental { glyph, .. } => valid_accidental(glyph)?,
                NotationMark::Notehead {
                    shape: NoteheadShape::Custom { term },
                    ..
                } => valid_term(term)?,
                NotationMark::Beam { members, level, .. } => {
                    unique_members(members)?;
                    if members.len() < 2 || *level == 0 {
                        return Err(invalid("Beam needs multiple members and a positive level"));
                    }
                }
                NotationMark::Rest { duration, display } => {
                    positive(duration)?;
                    if matches!(display, RestDisplay::MultipleMeasures { measures: 0 }) {
                        return Err(invalid("Multiple-measure rest count must be positive"));
                    }
                }
                NotationMark::AugmentationDots { count: 0 } => {
                    return Err(invalid("Dot count must be positive"));
                }
                NotationMark::TupletBracket {
                    actual,
                    normal,
                    members,
                } => {
                    unique_members(members)?;
                    if *actual == 0 || *normal == 0 || members.is_empty() {
                        return Err(invalid(
                            "Tuplet needs a positive ratio and explicit members",
                        ));
                    }
                }
                NotationMark::Tie { from, to }
                | NotationMark::Slur { from, to }
                | NotationMark::PhraseMark { from, to }
                    if from == to =>
                {
                    return Err(invalid("Notation span endpoints must be distinct"));
                }
                NotationMark::OctaveLine { from, to, octaves } if from == to || *octaves == 0 => {
                    return Err(invalid(
                        "Octave line needs distinct endpoints and a nonzero octave displacement",
                    ));
                }
                NotationMark::Navigation { navigation } => validate_navigation(navigation)?,
                NotationMark::FiguredBass { figures } => {
                    if figures.is_empty() {
                        return Err(invalid("Figured bass needs at least one figure"));
                    }
                    for figure in figures {
                        if figure.number == Some(0)
                            || (figure.number.is_none() && figure.alteration.is_none())
                        {
                            return Err(invalid(
                                "Bass figure needs a positive numeral or accidental",
                            ));
                        }
                        if let Some(alteration) = &figure.alteration {
                            valid_accidental(alteration)?;
                        }
                    }
                }
                NotationMark::RehearsalMark { label } if label.trim().is_empty() => {
                    return Err(invalid("Rehearsal label must not be empty"));
                }
                NotationMark::Mensural {
                    mensuration: Some(mensuration),
                    ..
                } => {
                    if let Some(proportion) = &mensuration.proportion {
                        positive(proportion)?;
                    }
                }
                NotationMark::Ligature { members, .. } => {
                    unique_members(members)?;
                    if members.len() < 2 {
                        return Err(invalid("Ligature needs at least two explicit members"));
                    }
                }
                NotationMark::Neume { shape, members } => {
                    unique_members(members)?;
                    if let NeumeShape::Custom { term } = shape {
                        valid_term(term)?;
                    }
                }
                NotationMark::TablaturePosition { course, fret } => {
                    fret.validate()?;
                    if *course == 0 || fret.numerator < 0 {
                        return Err(invalid(
                            "Tablature needs a positive course and nonnegative rational fret",
                        ));
                    }
                }
                NotationMark::Custom { term } => valid_term(term)?,
                _ => {}
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        let mut refs = Vec::new();
        for mark in &self.marks {
            match mark {
                NotationMark::Beam { members, .. }
                | NotationMark::TupletBracket { members, .. }
                | NotationMark::Ligature { members, .. }
                | NotationMark::Neume { members, .. } => refs.extend(members),
                NotationMark::Tie { from, to }
                | NotationMark::Slur { from, to }
                | NotationMark::PhraseMark { from, to }
                | NotationMark::OctaveLine { from, to, .. } => refs.extend([from, to]),
                NotationMark::Cue { source, .. } => refs.push(source),
                NotationMark::Editorial { source, .. } => refs.extend(source),
                NotationMark::Navigation { navigation } => match navigation {
                    ScoreNavigation::RepeatEnd { start, .. } => refs.extend(start),
                    ScoreNavigation::Volta { from, to, .. } => refs.extend([from, to]),
                    ScoreNavigation::Jump { destination, .. } => refs.extend(destination),
                    ScoreNavigation::Simile { source, .. } => refs.push(source),
                    ScoreNavigation::Attacca { next } => refs.extend(next),
                    _ => {}
                },
                _ => {}
            }
        }
        refs
    }
}

fn validate_navigation(navigation: &ScoreNavigation) -> CoreResult<()> {
    match navigation {
        ScoreNavigation::RepeatEnd { count: Some(0), .. }
        | ScoreNavigation::Simile {
            unit: SimileUnit::Measures { count: 0 },
            ..
        } => Err(invalid("Navigation repeat counts must be positive")),
        ScoreNavigation::Volta { passes, from, to } => {
            if passes.is_empty()
                || passes.contains(&0)
                || from == to
                || passes
                    .iter()
                    .enumerate()
                    .any(|(i, pass)| passes[..i].contains(pass))
            {
                Err(invalid(
                    "Volta needs distinct endpoints and unique positive pass numbers",
                ))
            } else {
                Ok(())
            }
        }
        _ => Ok(()),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyLyrics")]
pub struct Lyrics {
    /// BCP 47 language tag when known; absence does not imply English.
    pub language: Option<String>,
    pub verse: Option<String>,
    pub syllables: Vec<LyricSyllable>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyLyricSyllable")]
pub struct LyricSyllable {
    pub text: String,
    pub position: SyllabicPosition,
    pub stress: Option<SyllabicStress>,
    /// Explicit ordered event correspondence; a melisma can span many events.
    pub events: Vec<EntityId>,
    pub delivery: Option<VocalDelivery>,
    pub elision: Option<LyricElision>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySyllabicPosition")]
pub enum SyllabicPosition {
    Single,
    Begin,
    Middle,
    End,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySyllabicStress")]
pub enum SyllabicStress {
    Unstressed,
    Secondary,
    Primary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVocalDelivery")]
pub enum VocalDelivery {
    Syllabic,
    Melismatic,
    Spoken,
    Sprechgesang,
    Whispered,
    Hummed,
    Vocalise,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyLyricElision")]
pub struct LyricElision {
    /// Additional syllable text sung in the same syllabic position.
    pub following_text: String,
    pub separator: ElisionSeparator,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyElisionSeparator")]
pub enum ElisionSeparator {
    Space,
    Undertie,
    Apostrophe,
}

impl Lyrics {
    pub fn validate(&self) -> CoreResult<()> {
        if self.language.as_ref().is_some_and(|s| s.trim().is_empty())
            || self.verse.as_ref().is_some_and(|s| s.trim().is_empty())
        {
            return Err(invalid("Known lyric language and verse must not be empty"));
        }
        for syllable in &self.syllables {
            if syllable.text.trim().is_empty() {
                return Err(invalid("Lyric syllable text must not be empty"));
            }
            unique_members(&syllable.events)?;
            if syllable
                .elision
                .as_ref()
                .is_some_and(|e| e.following_text.trim().is_empty())
            {
                return Err(invalid("Lyric elision needs following text"));
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        self.syllables
            .iter()
            .flat_map(|s| s.events.iter())
            .collect()
    }
}

fn valid_id(id: &EntityId) -> CoreResult<()> {
    id.validate()
}

fn valid_term(term: &ExtensionTerm) -> CoreResult<()> {
    term.validate()
}

fn valid_accidental(glyph: &AccidentalGlyph) -> CoreResult<()> {
    match glyph {
        AccidentalGlyph::Custom { term } => valid_term(term),
        _ => Ok(()),
    }
}

fn positive(value: &Rational) -> CoreResult<()> {
    value.validate()?;
    if value.numerator <= 0 {
        Err(invalid("Notated duration or proportion must be positive"))
    } else {
        Ok(())
    }
}

fn unique_members(members: &[EntityId]) -> CoreResult<()> {
    for (index, member) in members.iter().enumerate() {
        valid_id(member)?;
        if members[..index].contains(member) {
            return Err(invalid("Duplicate notation event reference"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational_notation_rejects_unsafe_interchange_coordinates() {
        let notation = Notation {
            system: NotationSystem::Tablature,
            marks: vec![NotationMark::TablaturePosition {
                course: 1,
                fret: Rational {
                    numerator: 0,
                    denominator: u64::MAX,
                },
            }],
        };
        assert!(notation.validate().is_err());
    }

    #[test]
    fn navigation_references_and_counts_are_checked() {
        let notation = Notation {
            system: NotationSystem::Staff,
            marks: vec![NotationMark::Navigation {
                navigation: ScoreNavigation::Volta {
                    passes: vec![1, 1],
                    from: EntityId("a".into()),
                    to: EntityId("b".into()),
                },
            }],
        };
        assert_eq!(notation.references().len(), 2);
        assert!(notation.validate().is_err());
    }
}
