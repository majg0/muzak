//! Exact temporal vocabulary, independent from pitch, performance and meter inference.
//! Components describe authored or interpreted structure; this module is not a scheduler.
use super::{EntityId, Rational, TimeSpan};
use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

fn positive(value: &Rational) -> CoreResult<()> {
    value.validate()?;
    if value.numerator <= 0 {
        return Err(invalid("Temporal units must be positive."));
    }
    Ok(())
}
fn nonnegative(value: &Rational) -> CoreResult<()> {
    value.validate()?;
    if value.numerator < 0 {
        return Err(invalid("Rhythmic coordinates must be nonnegative."));
    }
    Ok(())
}
fn less(a: &Rational, b: &Rational) -> bool {
    i128::from(a.numerator) * i128::from(b.denominator)
        < i128::from(b.numerator) * i128::from(a.denominator)
}
fn strength_valid(value: Option<f64>) -> CoreResult<()> {
    if value.is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value)) {
        return Err(invalid(
            "Accent strength must be finite and between zero and one.",
        ));
    }
    Ok(())
}
fn grouping_valid(grouping: &[u32], total: u32) -> CoreResult<()> {
    if grouping.contains(&0)
        || (!grouping.is_empty()
            && grouping.iter().map(|&count| u64::from(count)).sum::<u64>() != u64::from(total))
    {
        return Err(invalid(
            "Subdivision groups must be positive and cover the subdivision count.",
        ));
    }
    Ok(())
}

/// Neutral-pitch rhythmic material. Coincident attacks remain separate events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyRhythm")]
pub struct Rhythm {
    pub events: Vec<RhythmEvent>,
    pub cycle: Option<Rational>,
    pub meter: Option<EntityId>,
    pub groove: Option<EntityId>,
    pub traits: Vec<RhythmicTrait>,
}
impl Rhythm {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(cycle) = &self.cycle {
            positive(cycle)?;
        }
        if let Some(meter) = &self.meter {
            meter.validate()?;
        }
        if let Some(groove) = &self.groove {
            groove.validate()?;
        }
        let mut seen = HashSet::new();
        for event in &self.events {
            if event.id.trim().is_empty() || !seen.insert(&event.id) {
                return Err(invalid("Rhythm event IDs must be nonempty and unique."));
            }
            event.span.validate()?;
            strength_valid(event.accent)?;
            if let Some(cycle) = &self.cycle {
                nonnegative(&event.span.start)?;
                if !less(&event.span.start, cycle) {
                    return Err(invalid(
                        "A cyclic rhythm's event onsets must fall within its cycle.",
                    ));
                }
            }
            if let Some(notation) = &event.notation {
                notation.validate()?;
            }
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.meter
            .iter()
            .chain(self.groove.iter())
            .chain(
                self.events
                    .iter()
                    .filter_map(|event| event.notation.as_ref())
                    .filter_map(|notation| notation.tuplet.as_ref()),
            )
            .collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyRhythmEvent")]
pub struct RhythmEvent {
    pub id: String,
    pub span: TimeSpan,
    pub kind: RhythmEventKind,
    pub accent: Option<f64>,
    pub notation: Option<DurationNotation>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyRhythmEventKind")]
pub enum RhythmEventKind {
    Attack,
    Rest,
    Continuation,
    GraceAttack,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyRhythmicTrait")]
pub enum RhythmicTrait {
    Regular,
    Irregular,
    Syncopated,
    Offbeat,
    Backbeat,
    Hemiola,
    CrossRhythm,
    Polyrhythm,
    Polymeter,
    Isorhythm,
    Ostinato,
    Additive,
    Divisive,
    Augmentation,
    Diminution,
    Displacement,
    PhaseShift,
    Euclidean,
    FreeRhythm,
    NonRetrogradable,
    Tala,
    Clave,
}

/// Notated grouping is explicit and does not claim perceived tactus or pickup position.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMeter")]
pub struct Meter {
    pub organization: MeterOrganization,
    pub tactus: Option<Rational>,
    pub pickup: Option<Rational>,
}
impl Meter {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(tactus) = &self.tactus {
            positive(tactus)?;
        }
        if let Some(pickup) = &self.pickup {
            positive(pickup)?;
        }
        match &self.organization {
            MeterOrganization::Measured { signature } => signature.validate()?,
            MeterOrganization::Alternating { signatures } => {
                if signatures.len() < 2 {
                    return Err(invalid(
                        "Alternating meter needs at least two explicit signatures.",
                    ));
                }
                for signature in signatures {
                    signature.validate()?;
                }
            }
            MeterOrganization::Polymetric { layers } => {
                if layers.len() < 2 {
                    return Err(invalid("Polymeter requires at least two metric layers."));
                }
                let mut seen = HashSet::new();
                for layer in layers {
                    layer.validate()?;
                    if !seen.insert(&layer.0) {
                        return Err(invalid("Polymetric layers must be distinct entities."));
                    }
                }
            }
            MeterOrganization::Unmetered | MeterOrganization::Unknown => {}
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        match &self.organization {
            MeterOrganization::Polymetric { layers } => layers.iter().collect(),
            _ => vec![],
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyMeterOrganization")]
pub enum MeterOrganization {
    Measured { signature: MeterSignature },
    Alternating { signatures: Vec<MeterSignature> },
    Polymetric { layers: Vec<EntityId> },
    Unmetered,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMeterSignature")]
pub struct MeterSignature {
    /// Additive numerator groups: [2, 2, 3] over denominator 8 describes (2+2+3)/8.
    pub groups: Vec<u32>,
    /// Exact note-value denominator; not restricted to binary denominators.
    pub denominator: u32,
    pub classification: MeterClass,
}
impl MeterSignature {
    pub fn validate(&self) -> CoreResult<()> {
        if self.groups.is_empty() || self.groups.contains(&0) || self.denominator == 0 {
            return Err(invalid("Meter groups and denominator must be positive."));
        }
        if self
            .groups
            .iter()
            .try_fold(0_u32, |sum, group| sum.checked_add(*group))
            .is_none()
        {
            return Err(invalid(
                "Meter numerator exceeds the supported count range.",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMeterClass")]
pub enum MeterClass {
    SimpleDuple,
    SimpleTriple,
    SimpleQuadruple,
    CompoundDuple,
    CompoundTriple,
    CompoundQuadruple,
    Additive,
    Asymmetric,
    Mixed,
    Unclassified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBeat")]
pub struct Beat {
    pub unit: Rational,
    pub position: Option<Rational>,
    pub role: BeatRole,
    pub strength: Option<f64>,
    pub meter: Option<EntityId>,
}
impl Beat {
    pub fn validate(&self) -> CoreResult<()> {
        positive(&self.unit)?;
        if let Some(position) = &self.position {
            position.validate()?;
        }
        strength_valid(self.strength)?;
        if let Some(meter) = &self.meter {
            meter.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.meter.iter().collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyBeatRole")]
pub enum BeatRole {
    Downbeat,
    Upbeat,
    Backbeat,
    Offbeat,
    Tactus,
    Subordinate,
    Unspecified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySubdivision")]
pub struct Subdivision {
    pub parent_beat: Option<EntityId>,
    pub unit: Rational,
    pub count: u32,
    pub grouping: Vec<u32>,
}
impl Subdivision {
    pub fn validate(&self) -> CoreResult<()> {
        positive(&self.unit)?;
        if self.count == 0 {
            return Err(invalid("Subdivision count must be positive."));
        }
        grouping_valid(&self.grouping, self.count)?;
        if let Some(beat) = &self.parent_beat {
            beat.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.parent_beat.iter().collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTempo")]
pub struct Tempo {
    pub beat_unit: Rational,
    pub beats_per_minute: Option<f64>,
    pub marking: Option<TempoMark>,
    pub modification: Option<TempoModification>,
}
impl Tempo {
    pub fn validate(&self) -> CoreResult<()> {
        positive(&self.beat_unit)?;
        if self.beats_per_minute.is_none() && self.marking.is_none() && self.modification.is_none()
        {
            return Err(invalid(
                "Tempo requires a numeric value, marking or modification.",
            ));
        }
        if self
            .beats_per_minute
            .is_some_and(|value| !value.is_finite() || value <= 0.0)
        {
            return Err(invalid("Tempo must be finite and positive."));
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTempoMark")]
pub enum TempoMark {
    Larghissimo,
    Grave,
    Largo,
    Lento,
    Larghetto,
    Adagio,
    Adagietto,
    Andante,
    Andantino,
    Moderato,
    Allegretto,
    Allegro,
    Vivace,
    Vivacissimo,
    Allegrissimo,
    Presto,
    Prestissimo,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTempoModification")]
pub enum TempoModification {
    Accelerando,
    Ritardando,
    Rallentando,
    Ritenuto,
    Stringendo,
    Allargando,
    Rubato,
    ATempo,
    TempoPrimo,
    TempoGiusto,
    DoppioMovimento,
    MenoMosso,
    PiuMosso,
    Largamente,
    AgogicAccent,
}

/// Performance deviations from exact nominal positions; no quantization is implied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyGroove")]
pub struct Groove {
    pub cycle: Rational,
    pub feel: GrooveFeel,
    pub placements: Vec<GroovePlacement>,
}
impl Groove {
    pub fn validate(&self) -> CoreResult<()> {
        positive(&self.cycle)?;
        for placement in &self.placements {
            nonnegative(&placement.nominal)?;
            placement.offset.validate()?;
            if !less(&placement.nominal, &self.cycle) {
                return Err(invalid("Groove positions must be inside the cycle."));
            }
            if let Some(scale) = &placement.duration_scale {
                positive(scale)?;
            }
            if placement
                .gain_scale
                .is_some_and(|value| !value.is_finite() || value < 0.0)
            {
                return Err(invalid(
                    "Groove gain scales must be finite and nonnegative.",
                ));
            }
        }
        if self
            .placements
            .windows(2)
            .any(|pair| !less(&pair[0].nominal, &pair[1].nominal))
        {
            return Err(invalid(
                "Groove positions must be strictly ordered and unique.",
            ));
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyGrooveFeel")]
pub enum GrooveFeel {
    Straight,
    Swing,
    Shuffle,
    LaidBack,
    Pushed,
    Unequal,
    Rubato,
    Unspecified,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyGroovePlacement")]
pub struct GroovePlacement {
    pub nominal: Rational,
    pub offset: Rational,
    pub duration_scale: Option<Rational>,
    pub gain_scale: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTuplet")]
pub struct Tuplet {
    pub actual_notes: u32,
    pub normal_notes: u32,
    pub base_unit: NoteValue,
    pub parent: Option<EntityId>,
}
impl Tuplet {
    pub fn validate(&self) -> CoreResult<()> {
        if self.actual_notes == 0 || self.normal_notes == 0 {
            return Err(invalid("Tuplet counts must both be positive."));
        }
        self.base_unit.validate()?;
        if let Some(parent) = &self.parent {
            parent.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.parent.iter().collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDurationNotation")]
pub struct DurationNotation {
    pub base: NoteValue,
    pub dots: u8,
    pub tuplet: Option<EntityId>,
}
impl DurationNotation {
    pub fn validate(&self) -> CoreResult<()> {
        self.base.validate()?;
        // Dotted-duration numerator 2^(dots+1)-1 must stay in the exact JS integer range.
        if self.dots > 52 {
            return Err(invalid("Dotted duration exceeds exact interchange range."));
        }
        if let Some(tuplet) = &self.tuplet {
            tuplet.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.tuplet.iter().collect()
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyNoteValue")]
pub enum NoteValue {
    Maxima,
    Longa,
    Breve,
    Whole,
    Half,
    Quarter,
    Eighth,
    Sixteenth,
    ThirtySecond,
    SixtyFourth,
    HundredTwentyEighth,
    TwoHundredFiftySixth,
    Custom { whole_notes: Rational },
}
impl NoteValue {
    fn validate(&self) -> CoreResult<()> {
        if let Self::Custom { whole_notes } = self {
            positive(whole_notes)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ratio(numerator: i64, denominator: u64) -> Rational {
        Rational {
            numerator,
            denominator,
        }
    }

    #[test]
    fn additive_meter_and_unknown_tactus_survive_serialization() {
        let meter = Meter {
            organization: MeterOrganization::Measured {
                signature: MeterSignature {
                    groups: vec![2, 2, 3],
                    denominator: 8,
                    classification: MeterClass::Additive,
                },
            },
            tactus: None,
            pickup: None,
        };
        meter.validate().unwrap();
        let round_trip: Meter =
            serde_json::from_str(&serde_json::to_string(&meter).unwrap()).unwrap();
        assert_eq!(round_trip, meter);
        assert!(round_trip.tactus.is_none());
    }

    #[test]
    fn groove_validation_compares_noncanonical_rational_positions_exactly() {
        let mut groove = Groove {
            cycle: ratio(1, 1),
            feel: GrooveFeel::Swing,
            placements: vec![
                GroovePlacement {
                    nominal: ratio(0, 1),
                    offset: ratio(0, 1),
                    duration_scale: None,
                    gain_scale: None,
                },
                GroovePlacement {
                    nominal: ratio(1, 2),
                    offset: ratio(1, 6),
                    duration_scale: None,
                    gain_scale: None,
                },
            ],
        };
        groove.validate().unwrap();
        groove.placements.push(GroovePlacement {
            nominal: ratio(2, 4),
            offset: ratio(0, 1),
            duration_scale: None,
            gain_scale: None,
        });
        assert!(groove.validate().is_err());
    }

    #[test]
    fn tempo_labels_do_not_invent_a_numeric_performance_tempo() {
        let tempo = Tempo {
            beat_unit: ratio(1, 1),
            beats_per_minute: None,
            marking: Some(TempoMark::Andante),
            modification: None,
        };
        tempo.validate().unwrap();
        let round_trip: Tempo =
            serde_json::from_str(&serde_json::to_string(&tempo).unwrap()).unwrap();
        assert!(round_trip.beats_per_minute.is_none());
        let mut invalid = tempo;
        invalid.beats_per_minute = Some(f64::NAN);
        assert!(invalid.validate().is_err());
    }
}
