//! Musical organization independent of tracks, instruments, emission, and display bounds.
//!
//! These are authored or hypothesized descriptions. Transformation describes intent;
//! it is not another evaluator and does not claim the existing compiler supports it.

use super::pitch::{Interval, PitchRange};
use super::{EntityId, ExtensionTerm, Rational};
use crate::error::{CoreResult, invalid};
use crate::model::{MAX_SAFE, Pitch};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyVoice")]
pub struct Voice {
    /// An explicit musical succession. `None` means succession has not been supplied.
    /// Track order, pitch height, or a shared instrument do not establish this order.
    pub succession: Option<Vec<EntityId>>,
    pub role: Option<VoiceRole>,
    pub tessitura: Option<PitchRange>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyVoiceRole")]
pub enum VoiceRole {
    Principal,
    Countermelody,
    Accompaniment,
    Bass,
    Inner,
    Drone,
    Pedal,
    Ostinato,
    Response,
    Custom { term: ExtensionTerm },
}

impl Voice {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(sequence) = &self.succession {
            unique_members(sequence, "voice succession")?;
        }
        if let Some(range) = &self.tessitura {
            range.validate()?;
        }
        if let Some(VoiceRole::Custom { term }) = &self.role {
            valid_term(term)?;
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        self.succession.iter().flatten().collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMotif")]
pub struct Motif {
    pub kind: MotifKind,
    /// Identity is distinct from a particular set of emitted notes.
    pub identity: MotifIdentity,
    pub dimensions: Vec<MotifDimension>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyMotifKind")]
pub enum MotifKind {
    Cell,
    Motive,
    Riff,
    Lick,
    Theme,
    Subject,
    Countersubject,
    Leitmotif,
    Ostinato,
    Ground,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyMotifIdentity")]
pub enum MotifIdentity {
    Definition,
    Realization {
        definition: EntityId,
        transformations: Vec<EntityId>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMotifDimension")]
pub enum MotifDimension {
    Rhythm,
    Pitch,
    Contour,
    Interval,
    Harmony,
    Timbre,
    Articulation,
    Dynamics,
    Text,
}

impl Motif {
    pub fn validate(&self) -> CoreResult<()> {
        if let MotifKind::Custom { term } = &self.kind {
            valid_term(term)?;
        }
        if self.dimensions.is_empty() {
            return Err(invalid(
                "Motif must identify at least one identity dimension",
            ));
        }
        if self
            .dimensions
            .iter()
            .enumerate()
            .any(|(i, d)| self.dimensions[..i].contains(d))
        {
            return Err(invalid("Motif identity dimensions must not repeat"));
        }
        if let MotifIdentity::Realization {
            definition,
            transformations,
        } = &self.identity
        {
            valid_id(definition)?;
            unique_members(transformations, "motif transformation references")?;
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        match &self.identity {
            MotifIdentity::Definition => vec![],
            MotifIdentity::Realization {
                definition,
                transformations,
            } => std::iter::once(definition).chain(transformations).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPhrase")]
pub struct Phrase {
    pub kind: Option<PhraseKind>,
    pub function: Option<PhraseFunction>,
    pub cadence: Option<Cadence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyPhraseKind")]
pub enum PhraseKind {
    Gesture,
    Subphrase,
    Phrase,
    Period,
    Sentence,
    PhraseGroup,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPhraseFunction")]
pub enum PhraseFunction {
    BasicIdea,
    ContrastingIdea,
    Antecedent,
    Consequent,
    Presentation,
    Continuation,
    Cadential,
    Extension,
    Elision,
    Interpolation,
    Dissolution,
    Call,
    Response,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyCadence")]
pub struct Cadence {
    pub kind: CadenceKind,
    /// The relevant harmonic, melodic, and rhythmic events are explicit references.
    pub witnesses: Vec<EntityId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyCadenceKind")]
pub enum CadenceKind {
    PerfectAuthentic,
    ImperfectAuthentic,
    Half,
    PhrygianHalf,
    Plagal,
    Deceptive,
    Evaded,
    Interrupted,
    Modal,
    Landini,
    Custom { term: ExtensionTerm },
}

impl Phrase {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(PhraseKind::Custom { term }) = &self.kind {
            valid_term(term)?;
        }
        if let Some(cadence) = &self.cadence {
            unique_members(&cadence.witnesses, "cadence witnesses")?;
            if let CadenceKind::Custom { term } = &cadence.kind {
                valid_term(term)?;
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        self.cadence
            .iter()
            .flat_map(|c| c.witnesses.iter())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyForm")]
pub struct Form {
    pub design: Option<FormDesign>,
    /// Ordered sections may have arbitrary durations and overlapping realizations.
    pub sections: Vec<FormSection>,
    pub relationships: Vec<FormRelationship>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyFormDesign")]
pub enum FormDesign {
    Binary,
    RoundedBinary,
    Ternary,
    Rondo,
    Sonata,
    SonataRondo,
    ThemeAndVariations,
    Strophic,
    ThroughComposed,
    VerseChorus,
    Aaba,
    Fugue,
    Canon,
    Passacaglia,
    Chaconne,
    Ritornello,
    Suite,
    Cyclic,
    Open,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyFormSection")]
pub struct FormSection {
    pub section: EntityId,
    pub function: Option<SectionFunction>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySectionFunction")]
pub enum SectionFunction {
    Introduction,
    Exposition,
    Development,
    Recapitulation,
    Transition,
    Retransition,
    Episode,
    Refrain,
    Verse,
    PreChorus,
    Chorus,
    Bridge,
    Breakdown,
    Interlude,
    Solo,
    Cadenza,
    Codetta,
    Coda,
    Outro,
    Movement,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyFormRelationship")]
pub enum FormRelationship {
    Repetition {
        original: EntityId,
        occurrence: EntityId,
    },
    Variation {
        original: EntityId,
        occurrence: EntityId,
        transformations: Vec<EntityId>,
    },
    Contrast {
        first: EntityId,
        second: EntityId,
    },
    Return {
        original: EntityId,
        occurrence: EntityId,
    },
    AntecedentConsequent {
        antecedent: EntityId,
        consequent: EntityId,
    },
    CallResponse {
        call: EntityId,
        response: EntityId,
    },
    Elision {
        ending: EntityId,
        beginning: EntityId,
        shared: Vec<EntityId>,
    },
}

impl FormRelationship {
    fn references(&self) -> Vec<&EntityId> {
        match self {
            Self::Repetition {
                original,
                occurrence,
            }
            | Self::Return {
                original,
                occurrence,
            } => vec![original, occurrence],
            Self::Variation {
                original,
                occurrence,
                transformations,
            } => [original, occurrence]
                .into_iter()
                .chain(transformations)
                .collect(),
            Self::Contrast { first, second } => vec![first, second],
            Self::AntecedentConsequent {
                antecedent,
                consequent,
            } => vec![antecedent, consequent],
            Self::CallResponse { call, response } => vec![call, response],
            Self::Elision {
                ending,
                beginning,
                shared,
            } => [ending, beginning].into_iter().chain(shared).collect(),
        }
    }
}

impl Form {
    pub fn validate(&self) -> CoreResult<()> {
        if let Some(FormDesign::Custom { term }) = &self.design {
            valid_term(term)?;
        }
        for section in &self.sections {
            valid_id(&section.section)?;
            if let Some(SectionFunction::Custom { term }) = &section.function {
                valid_term(term)?;
            }
        }
        for reference in self.references() {
            valid_id(reference)?;
        }
        for relationship in &self.relationships {
            if let FormRelationship::Elision { shared, .. } = relationship {
                if shared.is_empty() {
                    return Err(invalid("An elision must name its shared members"));
                }
                unique_members(shared, "elision members")?;
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        self.sections
            .iter()
            .map(|s| &s.section)
            .chain(
                self.relationships
                    .iter()
                    .flat_map(FormRelationship::references),
            )
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTexture")]
pub struct Texture {
    pub kind: TextureKind,
    pub layers: Vec<TextureLayer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyTextureKind")]
pub enum TextureKind {
    Monophony,
    Homophony,
    Homorhythm,
    Polyphony,
    Heterophony,
    Counterpoint,
    Imitation,
    Canon,
    Antiphony,
    Hocket,
    MelodyAndAccompaniment,
    Drone,
    Micropolyphony,
    Pointillism,
    SoundMass,
    Custom { term: ExtensionTerm },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTextureLayer")]
pub struct TextureLayer {
    pub entity: EntityId,
    pub role: Option<VoiceRole>,
}

impl Texture {
    pub fn validate(&self) -> CoreResult<()> {
        if let TextureKind::Custom { term } = &self.kind {
            valid_term(term)?;
        }
        for layer in &self.layers {
            valid_id(&layer.entity)?;
            if let Some(VoiceRole::Custom { term }) = &layer.role {
                valid_term(term)?;
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        self.layers.iter().map(|layer| &layer.entity).collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTransformation")]
pub struct Transformation {
    pub source: EntityId,
    pub result: EntityId,
    /// Ordered composition of declarative operations. No notes are emitted here.
    pub operations: Vec<TransformationOperation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyTransformationOperation")]
pub enum TransformationOperation {
    Transpose {
        interval: Interval,
    },
    Invert {
        axis: Pitch,
    },
    Retrograde {
        domain: TransformationDomain,
    },
    /// Augmentation is ratio > 1; diminution is 0 < ratio < 1.
    TimeScale {
        ratio: Rational,
    },
    TimeDisplacement {
        offset: Rational,
    },
    Rotation {
        steps: i64,
        domain: TransformationDomain,
    },
    Permutation {
        order: Vec<u32>,
        domain: TransformationDomain,
    },
    Fragmentation {
        retained: Vec<EntityId>,
    },
    Interpolation {
        inserted: Vec<EntityId>,
    },
    Reharmonization {
        harmony: EntityId,
    },
    Reorchestration {
        ensemble: EntityId,
    },
    Embellishment {
        embellishment: EntityId,
    },
    Custom {
        term: ExtensionTerm,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTransformationDomain")]
pub enum TransformationDomain {
    Events,
    Pitch,
    Rhythm,
    Dynamics,
    Articulation,
    Timbre,
}

impl Transformation {
    pub fn validate(&self) -> CoreResult<()> {
        for reference in self.references() {
            valid_id(reference)?;
        }
        if self.source == self.result || self.operations.is_empty() {
            return Err(invalid(
                "Transformation needs distinct source/result and at least one operation",
            ));
        }
        for operation in &self.operations {
            match operation {
                TransformationOperation::Transpose { interval } => interval.validate()?,
                TransformationOperation::Invert { axis } => valid_native(axis.millicents)?,
                TransformationOperation::Rotation { steps, .. } => valid_native(*steps)?,
                TransformationOperation::TimeScale { ratio } => {
                    valid_rational(ratio)?;
                    if ratio.numerator <= 0 {
                        return Err(invalid("Time scale must be positive"));
                    }
                }
                TransformationOperation::TimeDisplacement { offset } => valid_rational(offset)?,
                TransformationOperation::Permutation { order, .. } => {
                    let mut sorted = order.clone();
                    sorted.sort_unstable();
                    if order.is_empty() || sorted.iter().enumerate().any(|(i, p)| *p as usize != i)
                    {
                        return Err(invalid(
                            "Permutation must contain every position exactly once",
                        ));
                    }
                }
                TransformationOperation::Fragmentation { retained } => {
                    unique_members(retained, "retained members")?
                }
                TransformationOperation::Interpolation { inserted } => {
                    unique_members(inserted, "inserted members")?
                }
                TransformationOperation::Custom { term } => valid_term(term)?,
                _ => {}
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        let mut refs = vec![&self.source, &self.result];
        for operation in &self.operations {
            match operation {
                TransformationOperation::Fragmentation { retained } => refs.extend(retained),
                TransformationOperation::Interpolation { inserted } => refs.extend(inserted),
                TransformationOperation::Reharmonization { harmony } => refs.push(harmony),
                TransformationOperation::Reorchestration { ensemble } => refs.push(ensemble),
                TransformationOperation::Embellishment { embellishment } => {
                    refs.push(embellishment)
                }
                _ => {}
            }
        }
        refs
    }
}

fn valid_id(id: &EntityId) -> CoreResult<()> {
    id.validate()
}

fn valid_term(term: &ExtensionTerm) -> CoreResult<()> {
    term.validate()
}

fn valid_rational(value: &Rational) -> CoreResult<()> {
    value.validate()
}

fn valid_native(value: i64) -> CoreResult<()> {
    if value.unsigned_abs() > MAX_SAFE {
        Err(invalid("Unsafe exact musical coordinate"))
    } else {
        Ok(())
    }
}

fn unique_members(members: &[EntityId], label: &str) -> CoreResult<()> {
    for (index, member) in members.iter().enumerate() {
        valid_id(member)?;
        if members[..index].contains(member) {
            return Err(invalid(format!("Duplicate member in {label}")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn succession_is_optional_and_rejects_repeated_event_identity() {
        let mut voice = Voice {
            succession: None,
            role: None,
            tessitura: None,
        };
        assert!(voice.validate().is_ok());
        voice.succession = Some(vec![EntityId("a".into()), EntityId("a".into())]);
        assert!(voice.validate().is_err());
    }

    #[test]
    fn transformation_keeps_all_parameter_references_and_validates_permutation() {
        let mut transformation = Transformation {
            source: EntityId("source".into()),
            result: EntityId("result".into()),
            operations: vec![TransformationOperation::Reharmonization {
                harmony: EntityId("harmony".into()),
            }],
        };
        assert_eq!(transformation.references().len(), 3);
        assert!(transformation.validate().is_ok());
        transformation
            .operations
            .push(TransformationOperation::Permutation {
                order: vec![1, 1],
                domain: TransformationDomain::Pitch,
            });
        assert!(transformation.validate().is_err());
    }
}
