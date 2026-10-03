//! Intent for performance, independent of observed curves and instrument routing.
//!
//! A named marking is not an automatic MIDI transformation. Exact trajectories
//! are separate from techniques and from the relationships of an ornament.

use super::{EntityId, Rational};
use crate::error::{CoreResult, invalid};
use crate::model::MAX_SAFE;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyArticulation")]
pub struct Articulation {
    pub connection: Option<ConnectionArticulation>,
    pub length: Option<LengthArticulation>,
    pub accents: Vec<Accent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyConnectionArticulation")]
pub enum ConnectionArticulation {
    Legato,
    NonLegato,
    Detached,
    Portato,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyLengthArticulation")]
pub enum LengthArticulation {
    Tenuto,
    Staccato,
    Staccatissimo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyAccent")]
pub enum Accent {
    Accent,
    Marcato,
    Sforzando,
    Sforzato,
    Rinforzando,
    Stress,
    Ghost,
}

impl Articulation {
    pub fn validate(&self) -> CoreResult<()> {
        if self.connection.is_none() && self.length.is_none() && self.accents.is_empty() {
            return Err(invalid("An articulation must specify a marking."));
        }
        unique(&self.accents, "articulation accents")
    }
    pub fn references(&self) -> Vec<&EntityId> {
        Vec::new()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTechnique")]
pub struct Technique {
    pub instructions: Vec<TechniqueInstruction>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "family", content = "action", rename_all = "camelCase")]
#[ts(rename = "OntologyTechniqueInstruction")]
pub enum TechniqueInstruction {
    String(StringTechnique),
    Bow(BowTechnique),
    Wind(WindTechnique),
    Vocal(VocalTechnique),
    Percussion(PercussionTechnique),
    Keyboard(KeyboardTechnique),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyStringTechnique")]
pub enum StringTechnique {
    Pluck {
        implement: PluckingImplement,
    },
    HammerOn {
        from: EntityId,
    },
    /// “Hammer-off” is a lexical alias of pull-off, not a second operation.
    PullOff {
        from: EntityId,
    },
    Tap {
        hand: Hand,
    },
    Slide {
        from: EntityId,
        direction: SlideDirection,
    },
    Bend {
        mechanism: BendMechanism,
    },
    Vibrato {
        mechanism: VibratoMechanism,
    },
    Harmonic {
        harmonic: HarmonicTechnique,
    },
    PalmMute,
    LeftHandMute,
    DeadNote,
    Slap,
    Pop,
    SnapPizzicato,
    Rasgueado,
    SweepPicking,
    AlternatePicking,
    EconomyPicking,
    HybridPicking,
    TremoloPicking,
    Fingerstyle,
    Scrape,
    Ebow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPluckingImplement")]
pub enum PluckingImplement {
    Finger,
    Fingernail,
    Plectrum,
    ThumbPick,
    Quill,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyHand")]
pub enum Hand {
    Left,
    Right,
    Both,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySlideDirection")]
pub enum SlideDirection {
    Ascending,
    Descending,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBendMechanism")]
pub enum BendMechanism {
    StringDisplacement,
    VibratoArm,
    Lip,
    Embouchure,
    FingerHole,
    Electronic,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVibratoMechanism")]
pub enum VibratoMechanism {
    Finger,
    Wrist,
    Arm,
    Breath,
    Lip,
    Jaw,
    Diaphragm,
    Electronic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyHarmonicTechnique")]
pub enum HarmonicTechnique {
    Natural {
        partial: Option<u16>,
    },
    Artificial {
        touched_interval_millicents: Option<i64>,
    },
    Pinch,
    Tapped,
    Harp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBowTechnique")]
pub struct BowTechnique {
    pub stroke: BowStroke,
    pub contact: BowContact,
    pub direction: Option<BowDirection>,
    pub mute: Option<bool>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBowStroke")]
pub enum BowStroke {
    Detache,
    Martele,
    Spiccato,
    Sautille,
    Ricochet,
    Jete,
    Loure,
    Legato,
    Tremolo,
    ColLegnoBattuto,
    ColLegnoTratto,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBowContact")]
pub enum BowContact {
    Ordinario,
    SulPonticello,
    SulTasto,
    Flautando,
    Overpressure,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBowDirection")]
pub enum BowDirection {
    UpBow,
    DownBow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyWindTechnique")]
pub enum WindTechnique {
    SingleTonguing,
    DoubleTonguing,
    TripleTonguing,
    FlutterTonguing,
    SlapTonguing,
    BreathAttack,
    AirTone,
    KeyClick,
    Multiphonic,
    Overblowing,
    CircularBreathing,
    Growl,
    SingingWhilePlaying,
    HalfValve,
    Stopped,
    Open,
    Muted,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVocalTechnique")]
pub enum VocalTechnique {
    Syllabic,
    Melismatic,
    Humming,
    Sprechstimme,
    Spoken,
    Whispered,
    Falsetto,
    HeadVoice,
    ChestVoice,
    MixedVoice,
    Belt,
    VocalFry,
    Growl,
    Scream,
    OvertoneSinging,
    Yodel,
    Beatboxing,
    Scat,
    Unvoiced,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPercussionTechnique")]
pub struct PercussionTechnique {
    pub stroke: PercussionStroke,
    pub implement: PercussionImplement,
    pub surface: PercussionSurface,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPercussionStroke")]
pub enum PercussionStroke {
    Single,
    Double,
    Flam,
    Drag,
    Ruff,
    Roll,
    BuzzRoll,
    PressRoll,
    Rimshot,
    CrossStick,
    Choke,
    DeadStroke,
    BrushSweep,
    Scrape,
    Shake,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPercussionImplement")]
pub enum PercussionImplement {
    Stick,
    SoftMallet,
    HardMallet,
    Brush,
    Rods,
    Hand,
    Fingers,
    Beater,
    Bow,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPercussionSurface")]
pub enum PercussionSurface {
    Center,
    Edge,
    Rim,
    Shell,
    Bell,
    Bow,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyKeyboardTechnique")]
pub enum KeyboardTechnique {
    Pedal { pedal: PedalKind, position: f64 },
    FingerSubstitution,
    SilentDepression,
    FingerGlissando,
    PalmGlissando,
    ForearmCluster,
    PluckedString,
    DampedString,
    PreparedString,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPedalKind")]
pub enum PedalKind {
    Sustain,
    Sostenuto,
    UnaCorda,
    Soft,
    Expression,
    Swell,
}

impl Technique {
    pub fn validate(&self) -> CoreResult<()> {
        if self.instructions.is_empty() {
            return Err(invalid("A technique requires an instruction."));
        }
        for action in &self.instructions {
            match action {
                TechniqueInstruction::String(StringTechnique::Harmonic { harmonic }) => {
                    match harmonic {
                        HarmonicTechnique::Natural {
                            partial: Some(partial),
                        } if *partial < 2 => {
                            return Err(invalid(
                                "A natural harmonic partial must be at least two.",
                            ));
                        }
                        HarmonicTechnique::Artificial {
                            touched_interval_millicents: Some(value),
                        } => safe_delta(*value)?,
                        _ => {}
                    }
                }
                TechniqueInstruction::Keyboard(KeyboardTechnique::Pedal { position, .. }) => {
                    unit(*position, "pedal position")?
                }
                _ => {}
            }
        }
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.instructions
            .iter()
            .filter_map(|action| match action {
                TechniqueInstruction::String(
                    StringTechnique::HammerOn { from }
                    | StringTechnique::PullOff { from }
                    | StringTechnique::Slide { from, .. },
                ) => Some(from),
                _ => None,
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOrnament")]
pub struct Ornament {
    pub kind: OrnamentKind,
    pub anchors: OrnamentAnchors,
    pub timing: OrnamentTiming,
    /// Ordered offsets relative to the principal, if specified. They are an
    /// authored pitch pattern, not additional note emissions.
    pub pitch_pattern_millicents: Option<Vec<i64>>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOrnamentKind")]
pub enum OrnamentKind {
    GraceNote,
    Appoggiatura,
    Acciaccatura,
    Trill,
    Mordent,
    InvertedMordent,
    Turn,
    InvertedTurn,
    Schleifer,
    Nachschlag,
    Tremblement,
    PassingTone,
    NeighborTone,
    DoubleNeighbor,
    EscapeTone,
    Cambiata,
    Suspension,
    Retardation,
    Anticipation,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOrnamentAnchors")]
pub struct OrnamentAnchors {
    pub principal: EntityId,
    pub preparation: Option<EntityId>,
    pub resolution: Option<EntityId>,
    pub auxiliary: Vec<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOrnamentTiming")]
pub struct OrnamentTiming {
    pub placement: OrnamentPlacement,
    pub duration: Option<Rational>,
    pub steals_time_from: Option<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyOrnamentPlacement")]
pub enum OrnamentPlacement {
    BeforePrincipal,
    OnPrincipal,
    AfterPrincipal,
    AcrossAnchors,
    Unspecified,
}
impl Ornament {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(duration) = &self.timing.duration {
            positive(duration, "ornament duration")?;
        }
        if let Some(pattern) = &self.pitch_pattern_millicents {
            if pattern.is_empty() {
                return Err(invalid(
                    "A specified ornament pitch pattern cannot be empty.",
                ));
            }
            for pitch in pattern {
                safe_delta(*pitch)?;
            }
        }
        unique(&self.anchors.auxiliary, "ornament auxiliary anchors")?;
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        std::iter::once(&self.anchors.principal)
            .chain(self.anchors.preparation.iter())
            .chain(self.anchors.resolution.iter())
            .chain(self.anchors.auxiliary.iter())
            .chain(self.timing.steals_time_from.iter())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPitchGesture")]
pub struct PitchGesture {
    pub kind: PitchGestureKind,
    pub interpolation: GestureInterpolation,
    /// Exact offsets from the owning entity's start, in quarter-note units.
    pub knots: Vec<PitchGestureKnot>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPitchGestureKind")]
pub enum PitchGestureKind {
    Bend,
    BendRelease,
    Glissando,
    Portamento,
    Vibrato,
    Scoop,
    Fall,
    Doit,
    Smear,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyGestureInterpolation")]
pub enum GestureInterpolation {
    Step,
    Linear,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPitchGestureKnot")]
pub struct PitchGestureKnot {
    pub offset: Rational,
    pub delta_millicents: i64,
}
impl PitchGesture {
    pub fn validate(&self) -> CoreResult<()> {
        ordered_offsets(self.knots.iter().map(|knot| &knot.offset))?;
        for knot in &self.knots {
            safe_delta(knot.delta_millicents)?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        Vec::new()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDynamics")]
pub struct Dynamics {
    pub mark: Option<DynamicMark>,
    pub change: Option<DynamicChange>,
    pub trajectory: Option<DynamicTrajectory>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDynamicMark")]
pub enum DynamicMark {
    Ppppp,
    Pppp,
    Ppp,
    Pp,
    P,
    Mp,
    Mf,
    F,
    Ff,
    Fff,
    Ffff,
    Fffff,
    Fortepiano,
    Sforzando,
    Sforzato,
    Rinforzando,
    Niente,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDynamicChange")]
pub enum DynamicChange {
    Crescendo,
    Decrescendo,
    Diminuendo,
    MessaDiVoce,
    Subito,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDynamicTrajectory")]
pub struct DynamicTrajectory {
    pub unit: DynamicUnit,
    pub interpolation: GestureInterpolation,
    pub points: Vec<DynamicPoint>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDynamicUnit")]
pub enum DynamicUnit {
    NormalizedIntensity,
    LinearGain,
    Decibels,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDynamicPoint")]
pub struct DynamicPoint {
    pub offset: Rational,
    pub value: f64,
}
impl Dynamics {
    pub fn validate(&self) -> CoreResult<()> {
        if self.mark.is_none() && self.change.is_none() && self.trajectory.is_none() {
            return Err(invalid(
                "Dynamics require a marking, change, or trajectory.",
            ));
        }
        if let Some(trajectory) = &self.trajectory {
            ordered_offsets(trajectory.points.iter().map(|point| &point.offset))?;
            for point in &trajectory.points {
                if !point.value.is_finite() {
                    return Err(invalid("Dynamic values must be finite."));
                }
                match trajectory.unit {
                    DynamicUnit::NormalizedIntensity => {
                        unit(point.value, "normalized dynamic intensity")?
                    }
                    DynamicUnit::LinearGain if point.value < 0.0 => {
                        return Err(invalid("Linear gain cannot be negative."));
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        Vec::new()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyExpression")]
pub struct Expression {
    pub characters: Vec<ExpressiveCharacter>,
    pub timing: Vec<TimingInflection>,
    pub connections: Vec<PerformanceConnection>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyExpressiveCharacter")]
pub enum ExpressiveCharacter {
    Cantabile,
    Dolce,
    Espressivo,
    Agitato,
    Animato,
    Appassionato,
    Brillante,
    ConBrio,
    ConFuoco,
    ConMoto,
    Delicato,
    Doloroso,
    Energico,
    Giocoso,
    Grazioso,
    Leggiero,
    Maestoso,
    Misterioso,
    Morendo,
    Pesante,
    Risoluto,
    Scherzando,
    Semplice,
    Sereno,
    Sostenuto,
    Tranquillo,
    Affettuoso,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyTimingInflection")]
pub enum TimingInflection {
    Rubato {
        maximum_displacement: Option<Rational>,
    },
    Fermata {
        additional_duration: Option<Rational>,
    },
    Breath,
    Caesura,
    LaissezVibrer,
    Attacca,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPerformanceConnection")]
pub struct PerformanceConnection {
    pub kind: PerformanceConnectionKind,
    pub members: Vec<EntityId>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPerformanceConnectionKind")]
pub enum PerformanceConnectionKind {
    Slur,
    Tie,
    BreathGroup,
    BowGroup,
}
impl Expression {
    pub fn validate(&self) -> CoreResult<()> {
        if self.characters.is_empty() && self.timing.is_empty() && self.connections.is_empty() {
            return Err(invalid(
                "Expression requires a character, timing instruction, or connection.",
            ));
        }
        unique(&self.characters, "expressive characters")?;
        for timing in &self.timing {
            let value = match timing {
                TimingInflection::Rubato {
                    maximum_displacement,
                } => maximum_displacement,
                TimingInflection::Fermata {
                    additional_duration,
                } => additional_duration,
                _ => continue,
            };
            if let Some(value) = value {
                nonnegative(value, "expressive time")?;
            }
        }
        for connection in &self.connections {
            if connection.members.len() < 2 {
                return Err(invalid(
                    "A performance connection requires at least two members.",
                ));
            }
            unique(&connection.members, "performance connection members")?;
        }
        validate_references(self.references())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.connections
            .iter()
            .flat_map(|connection| &connection.members)
            .collect()
    }
}

fn validate_references(references: Vec<&EntityId>) -> CoreResult<()> {
    if references.iter().any(|id| id.0.trim().is_empty()) {
        return Err(invalid("A performance reference cannot be empty."));
    }
    Ok(())
}
fn unique<T: PartialEq>(values: &[T], label: &str) -> CoreResult<()> {
    if values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
    {
        return Err(invalid(format!("Duplicate {label}.")));
    }
    Ok(())
}
fn unit(value: f64, label: &str) -> CoreResult<()> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(invalid(format!(
            "{label} must be finite and between zero and one."
        )));
    }
    Ok(())
}
fn safe_delta(value: i64) -> CoreResult<()> {
    if value.unsigned_abs() > MAX_SAFE {
        return Err(invalid(
            "Pitch gesture offsets must be safe native millicents.",
        ));
    }
    Ok(())
}
fn nonnegative(value: &Rational, label: &str) -> CoreResult<()> {
    value.validate()?;
    if value.numerator < 0 {
        return Err(invalid(format!("{label} cannot be negative.")));
    }
    Ok(())
}
fn positive(value: &Rational, label: &str) -> CoreResult<()> {
    nonnegative(value, label)?;
    if value.numerator == 0 {
        return Err(invalid(format!("{label} must be positive.")));
    }
    Ok(())
}
fn ordered_offsets<'a>(values: impl Iterator<Item = &'a Rational>) -> CoreResult<()> {
    let mut previous: Option<&Rational> = None;
    for value in values {
        nonnegative(value, "gesture offset")?;
        if let Some(previous) = previous {
            if i128::from(previous.numerator) * i128::from(value.denominator)
                >= i128::from(value.numerator) * i128::from(previous.denominator)
            {
                return Err(invalid("Gesture offsets must be strictly increasing."));
            }
        }
        previous = Some(value);
    }
    if previous.is_none() {
        return Err(invalid("A trajectory needs at least one point."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_gesture_keeps_signed_pitch_and_rejects_equal_rational_offsets() {
        let mut gesture = PitchGesture {
            kind: PitchGestureKind::BendRelease,
            interpolation: GestureInterpolation::Linear,
            knots: vec![
                PitchGestureKnot {
                    offset: Rational {
                        numerator: 0,
                        denominator: 1,
                    },
                    delta_millicents: -12_345,
                },
                PitchGestureKnot {
                    offset: Rational {
                        numerator: 1,
                        denominator: 2,
                    },
                    delta_millicents: 100_001,
                },
            ],
        };
        assert!(gesture.validate().is_ok());
        let json = serde_json::to_string(&gesture).unwrap();
        assert_eq!(
            serde_json::from_str::<PitchGesture>(&json).unwrap(),
            gesture
        );
        gesture.knots.push(PitchGestureKnot {
            offset: Rational {
                numerator: 2,
                denominator: 4,
            },
            delta_millicents: 0,
        });
        assert!(gesture.validate().is_err());
    }
    #[test]
    fn technique_reference_and_unquantified_tenuto_remain_separate() {
        let technique = Technique {
            instructions: vec![TechniqueInstruction::String(StringTechnique::PullOff {
                from: EntityId("prior-note".into()),
            })],
        };
        assert!(technique.validate().is_ok());
        assert_eq!(technique.references(), vec![&EntityId("prior-note".into())]);
        let articulation = Articulation {
            connection: Some(ConnectionArticulation::Legato),
            length: Some(LengthArticulation::Tenuto),
            accents: vec![],
        };
        assert!(articulation.validate().is_ok());
    }
    #[test]
    fn nonfinite_dynamics_fail_before_serialization() {
        let dynamics = Dynamics {
            mark: None,
            change: None,
            trajectory: Some(DynamicTrajectory {
                unit: DynamicUnit::Decibels,
                interpolation: GestureInterpolation::Linear,
                points: vec![DynamicPoint {
                    offset: Rational {
                        numerator: 0,
                        denominator: 1,
                    },
                    value: f64::NAN,
                }],
            }),
        };
        assert!(dynamics.validate().is_err());
    }
}
