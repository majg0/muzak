//! Musical nouns, independent components, and explicit relationships.
//!
//! This is a representation layer, not another composition language or ECS
//! scheduler. Only `composition::compile_composition` emits notes. A technique
//! or glossary term here does not claim playback, inference, or export support.
pub mod instrumentation;
pub mod notation;
pub mod performance;
pub mod pitch;
pub mod rhythm;
pub mod structure;
mod validation;
pub mod vocabulary;

use crate::{
    composition::CompositionPlan,
    error::{CoreResult, invalid},
    model::{MAX_SAFE, Pitch},
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use ts_rs::TS;

/// Identity is independent of content, name, membership and current pitch.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(rename = "OntologyEntityId")]
pub struct EntityId(pub String);

impl EntityId {
    pub fn validate(&self) -> CoreResult<()> {
        nonempty(&self.0, "entity identity")
    }
}

/// An exact signed ratio. Time fields document their unit (normally quarters).
/// Unreduced fractions are preserved; compare their values with `compare`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyRational")]
pub struct Rational {
    pub numerator: i64,
    pub denominator: u64,
}
impl Rational {
    pub fn validate(&self) -> CoreResult<()> {
        if self.denominator == 0
            || self.denominator > MAX_SAFE
            || self.numerator.unsigned_abs() > MAX_SAFE
        {
            return Err(invalid("Invalid exact ontology ratio."));
        }
        Ok(())
    }
    /// Validate before comparing untrusted input. Cross products fit i128.
    pub fn compare(&self, other: &Self) -> CoreResult<std::cmp::Ordering> {
        self.validate()?;
        other.validate()?;
        Ok((i128::from(self.numerator) * i128::from(other.denominator))
            .cmp(&(i128::from(other.numerator) * i128::from(self.denominator))))
    }
}

/// Score-time quarters, independent of tempo and performance seconds.
/// Negative starts allow pickups; a zero duration describes a point annotation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyTimeSpan")]
pub struct TimeSpan {
    pub start: Rational,
    pub duration: Rational,
}
impl TimeSpan {
    pub fn validate(&self) -> CoreResult<()> {
        self.start.validate()?;
        self.duration.validate()?;
        if self.duration.numerator < 0 {
            return Err(invalid("An ontology span cannot have negative duration."));
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}

/// Tradition-specific terms remain qualified, never silently interpreted as
/// Western scale/chord formulas. This is a name, not an opaque executable value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyExtensionTerm")]
pub struct ExtensionTerm {
    pub namespace: String,
    pub term: String,
}
impl ExtensionTerm {
    pub fn validate(&self) -> CoreResult<()> {
        nonempty(&self.namespace, "term namespace")?;
        nonempty(&self.term, "qualified term")
    }
}

/// A named musical practice can organize intonation, characteristic paths,
/// rhythmic cycles and performance practices together. It need not be a scale.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTradition")]
pub struct Tradition {
    pub name: ExtensionTerm,
    pub tuning: Option<EntityId>,
    pub pitch_collections: Vec<EntityId>,
    pub characteristic_paths: Vec<EntityId>,
    pub rhythmic_cycles: Vec<EntityId>,
    pub performance_practices: Vec<EntityId>,
}
impl Tradition {
    pub fn validate(&self) -> CoreResult<()> {
        self.name.validate()?;
        for id in self.references() {
            id.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        self.tuning
            .iter()
            .chain(&self.pitch_collections)
            .chain(&self.characteristic_paths)
            .chain(&self.rhythmic_cycles)
            .chain(&self.performance_practices)
            .collect()
    }
}

fn nonempty(value: &str, what: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        Err(invalid(format!("Missing {what}.")))
    } else {
        Ok(())
    }
}

/// Evidence addresses are provenance only; no component obtains musical values
/// through them. The authoritative score remains in the existing score model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEvidenceReference")]
pub struct EvidenceReference {
    pub source: String,
    pub observation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyProvenance")]
pub enum Provenance {
    Authored,
    Observed {
        evidence: Vec<EvidenceReference>,
    },
    /// Separate entities carry competing interpretations; this is not a claim
    /// that one has been selected, nor a posterior probability.
    Hypothesis {
        revision: u64,
        evidence: Vec<EvidenceReference>,
    },
}
impl Provenance {
    fn validate(&self) -> CoreResult<()> {
        let evidence = match self {
            Self::Authored => return Ok(()),
            Self::Observed { evidence } => {
                if evidence.is_empty() {
                    return Err(invalid("Observed components need provenance."));
                }
                evidence
            }
            Self::Hypothesis { revision, evidence } => {
                if *revision > MAX_SAFE {
                    return Err(invalid("Unsafe interpretation revision."));
                }
                evidence
            }
        };
        for reference in evidence {
            nonempty(&reference.source, "evidence source")?;
            nonempty(&reference.observation, "observation address")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyEvent")]
pub enum Event {
    Note,
    UnpitchedNote,
    Rest,
    GraceNote,
    Cue,
}
impl Event {
    pub fn validate(&self) -> CoreResult<()> {
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologySoundingPitch")]
pub struct SoundingPitch {
    pub value: Pitch,
}
impl SoundingPitch {
    pub fn validate(&self) -> CoreResult<()> {
        if self.value.millicents.unsigned_abs() > MAX_SAFE {
            return Err(invalid("Unsafe native ontology pitch."));
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}

/// Addresses the existing algebra. A binding is inspection/intent metadata,
/// never a second emitter or a promise that its techniques are implemented.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyProgramAddress")]
pub enum ProgramAddress {
    Material {
        id: String,
    },
    MaterialEvent {
        material: String,
        index: usize,
    },
    Definition {
        id: String,
    },
    /// None denotes a top-level placement; Some names a definition's placement.
    Placement {
        definition: Option<String>,
        index: usize,
    },
    Harmony {
        id: String,
    },
    PitchLattice {
        id: String,
    },
    Part {
        id: String,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyProgramBinding")]
pub struct ProgramBinding {
    pub program_revision: u64,
    pub address: ProgramAddress,
}
impl ProgramBinding {
    pub fn validate(&self) -> CoreResult<()> {
        if self.program_revision > MAX_SAFE {
            return Err(invalid("Unsafe program revision."));
        }
        match &self.address {
            ProgramAddress::Material { id }
            | ProgramAddress::Definition { id }
            | ProgramAddress::Harmony { id }
            | ProgramAddress::PitchLattice { id }
            | ProgramAddress::Part { id } => nonempty(id, "program address")?,
            ProgramAddress::MaterialEvent { material, index } => {
                nonempty(material, "material address")?;
                if *index as u128 > u128::from(MAX_SAFE) {
                    return Err(invalid("Unsafe event index."));
                }
            }
            ProgramAddress::Placement { definition, index } => {
                if let Some(id) = definition {
                    nonempty(id, "definition address")?;
                }
                if *index as u128 > u128::from(MAX_SAFE) {
                    return Err(invalid("Unsafe placement index."));
                }
            }
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
    fn exists_in(&self, plan: &CompositionPlan) -> bool {
        match &self.address {
            ProgramAddress::Material { id } => plan.materials.iter().any(|x| &x.id == id),
            ProgramAddress::MaterialEvent { material, index } => plan
                .materials
                .iter()
                .any(|x| &x.id == material && *index < x.notes.len()),
            ProgramAddress::Definition { id } => {
                plan.definitions.iter().flatten().any(|x| &x.id == id)
            }
            ProgramAddress::Placement { definition, index } => match definition {
                None => *index < plan.placements.len(),
                Some(id) => plan
                    .definitions
                    .iter()
                    .flatten()
                    .any(|x| &x.id == id && *index < x.placements.len()),
            },
            ProgramAddress::Harmony { id } => plan.harmonies.iter().flatten().any(|x| &x.id == id),
            ProgramAddress::PitchLattice { id } => {
                plan.pitch_lattices.iter().flatten().any(|x| &x.id == id)
            }
            ProgramAddress::Part { id } => plan.context.parts.iter().any(|x| &x.id == id),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyVocabulary")]
pub struct Vocabulary {
    pub terms: Vec<vocabulary::MusicTerm>,
    pub extensions: Vec<ExtensionTerm>,
}
impl Vocabulary {
    pub fn validate(&self) -> CoreResult<()> {
        if self.terms.is_empty() && self.extensions.is_empty() {
            return Err(invalid("Empty vocabulary component."));
        }
        for term in &self.extensions {
            term.validate()?;
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }
}

// One typed component family per entity. Candidate values with different
// meanings use distinct entities joined by Alternative, not silent overwrites.
macro_rules! components {
    ($($variant:ident($ty:path)),+ $(,)?) => {
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
        #[serde(tag = "kind", content = "value", rename_all = "camelCase")]
        #[ts(rename = "OntologyComponent")]
        pub enum Component { $($variant($ty)),+ }
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[serde(rename_all = "camelCase")]
        #[ts(rename = "OntologyComponentKind")]
        pub enum ComponentKind { $($variant),+ }
        impl Component {
            pub fn kind(&self) -> ComponentKind {
                match self { $(Self::$variant(_) => ComponentKind::$variant),+ }
            }
            pub fn validate(&self) -> CoreResult<()> {
                match self { $(Self::$variant(value) => value.validate()),+ }
            }
            pub fn references(&self) -> Vec<&EntityId> {
                match self { $(Self::$variant(value) => value.references()),+ }
            }
        }
    }
}
components! {
    Event(Event), Pitch(SoundingPitch), Span(TimeSpan), Vocabulary(Vocabulary), ProgramBinding(ProgramBinding), Tradition(Tradition),
    Scale(pitch::Scale), Tuning(pitch::Tuning), Spelling(pitch::Spelling), Interval(pitch::Interval),
    Chord(pitch::Chord), Voicing(pitch::Voicing), Arpeggio(pitch::Arpeggio), HarmonicFunction(pitch::HarmonicFunction), Key(pitch::Key),
    Rhythm(rhythm::Rhythm), Meter(rhythm::Meter), Beat(rhythm::Beat), Subdivision(rhythm::Subdivision),
    Tempo(rhythm::Tempo), Groove(rhythm::Groove), Tuplet(rhythm::Tuplet), DurationNotation(rhythm::DurationNotation),
    Articulation(performance::Articulation), Technique(performance::Technique), Ornament(performance::Ornament),
    PitchGesture(performance::PitchGesture), Dynamics(performance::Dynamics), Expression(performance::Expression),
    Instrument(instrumentation::Instrument), Ensemble(instrumentation::Ensemble), Performer(instrumentation::Performer),
    Timbre(instrumentation::Timbre), Orchestration(instrumentation::Orchestration),
    Voice(structure::Voice), Phrase(structure::Phrase), Motif(structure::Motif), Form(structure::Form),
    Texture(structure::Texture), Transformation(structure::Transformation), Notation(notation::Notation), Lyrics(notation::Lyrics),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyComponentAssertion")]
pub struct ComponentAssertion {
    pub component: Component,
    pub provenance: Provenance,
}
impl ComponentAssertion {
    pub fn authored(component: Component) -> Self {
        Self {
            component,
            provenance: Provenance::Authored,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyEntity")]
pub struct Entity {
    pub id: EntityId,
    pub label: Option<String>,
    pub components: Vec<ComponentAssertion>,
}
impl Entity {
    pub fn has(&self, kind: ComponentKind) -> bool {
        self.components.iter().any(|x| x.component.kind() == kind)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyMembershipRole")]
pub enum MembershipRole {
    Member,
    Core,
    Color,
    Bass,
    Melody,
    Accompaniment,
    Ornament,
    Section,
    Player,
    Part,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyDependencyKind")]
pub enum DependencyKind {
    Pitch,
    Rhythm,
    Duration,
    Dynamics,
    Timbre,
    Preparation,
    Resolution,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyCorrespondenceKind")]
pub enum CorrespondenceKind {
    Repetition,
    Variation,
    Doubling,
    Imitation,
    VoiceLeading,
}

/// Explicit edges may overlap. None grants note-emission ownership.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologyRelation")]
pub enum Relation {
    Membership {
        collection: EntityId,
        member: EntityId,
        role: MembershipRole,
        ordinal: Option<u32>,
    },
    Succession {
        predecessor: EntityId,
        successor: EntityId,
        voice: EntityId,
    },
    Dependency {
        dependent: EntityId,
        anchor: EntityId,
        aspect: DependencyKind,
    },
    Correspondence {
        from: EntityId,
        to: EntityId,
        relationship: CorrespondenceKind,
    },
    Instance {
        definition: EntityId,
        occurrence: EntityId,
    },
    Realization {
        intent: EntityId,
        realization: EntityId,
    },
    Alternative {
        left: EntityId,
        right: EntityId,
        aspect: ComponentKind,
    },
}
impl Relation {
    pub fn references(&self) -> Vec<&EntityId> {
        match self {
            Self::Membership {
                collection, member, ..
            } => vec![collection, member],
            Self::Succession {
                predecessor,
                successor,
                voice,
            } => vec![predecessor, successor, voice],
            Self::Dependency {
                dependent, anchor, ..
            } => vec![dependent, anchor],
            Self::Correspondence { from, to, .. } => vec![from, to],
            Self::Instance {
                definition,
                occurrence,
            } => vec![definition, occurrence],
            Self::Realization {
                intent,
                realization,
            } => vec![intent, realization],
            Self::Alternative { left, right, .. } => vec![left, right],
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyRelationship")]
pub struct Relationship {
    pub relation: Relation,
    pub provenance: Provenance,
}

/// Portable ECS-style data: stable entities, independent typed components and
/// relations. Storage/query strategy can change without changing music types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "MusicOntology")]
pub struct MusicOntology {
    pub schema_version: u32,
    pub revision: u64,
    pub entities: Vec<Entity>,
    pub relationships: Vec<Relationship>,
}
impl Default for MusicOntology {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            entities: vec![],
            relationships: vec![],
        }
    }
}
impl MusicOntology {
    pub fn entities_with(&self, kind: ComponentKind) -> impl Iterator<Item = &Entity> {
        self.entities.iter().filter(move |entity| entity.has(kind))
    }

    /// Validates representational integrity, not musical quality or executable
    /// support. Cross-document evidence remains an uninterpreted source address.
    pub fn validate(&self) -> CoreResult<()> {
        if self.schema_version != 1 || self.revision > MAX_SAFE {
            return Err(invalid("Unsupported ontology version or unsafe revision."));
        }
        let mut entities = HashMap::new();
        for entity in &self.entities {
            entity.id.validate()?;
            if entities.insert(&entity.id, entity).is_some() {
                return Err(invalid("Duplicate ontology entity identity."));
            }
        }
        let reference = |id: &EntityId| -> CoreResult<()> {
            id.validate()?;
            if !entities.contains_key(id) {
                return Err(invalid(format!("Unknown ontology entity {}.", id.0)));
            }
            Ok(())
        };
        for entity in &self.entities {
            if entity.components.is_empty() {
                return Err(invalid("An ontology entity needs a component."));
            }
            let mut kinds = HashSet::new();
            for assertion in &entity.components {
                if !kinds.insert(assertion.component.kind()) {
                    return Err(invalid(
                        "Duplicate component family; represent alternatives explicitly.",
                    ));
                }
                assertion.provenance.validate()?;
                assertion.component.validate()?;
                for id in assertion.component.references() {
                    reference(id)?;
                }
            }
        }
        let mut edges = HashSet::new();
        for relationship in &self.relationships {
            relationship.provenance.validate()?;
            let refs = relationship.relation.references();
            for id in &refs {
                reference(id)?;
            }
            if refs[0] == refs[1] {
                return Err(invalid("A relationship needs distinct endpoints."));
            }
            let key = serde_json::to_string(&relationship.relation)?;
            if !edges.insert(key) {
                return Err(invalid("Duplicate ontology relationship."));
            }
            match &relationship.relation {
                Relation::Succession { voice, .. }
                    if !entities[voice].has(ComponentKind::Voice) =>
                {
                    return Err(invalid(
                        "Succession must name a voice component, not a track or instrument.",
                    ));
                }
                Relation::Alternative {
                    left,
                    right,
                    aspect,
                } if !entities[left].has(*aspect) || !entities[right].has(*aspect) => {
                    return Err(invalid(
                        "Alternative endpoints must both carry the named component.",
                    ));
                }
                _ => {}
            }
        }
        validation::validate_references(self)
    }

    /// Checks optional links against the already authoritative program. It does
    /// not compile ontology declarations, mutate observations, or emit notes.
    pub fn validate_program_bindings(
        &self,
        plan: &CompositionPlan,
        revision: u64,
    ) -> CoreResult<()> {
        self.validate()?;
        for entity in &self.entities {
            for assertion in &entity.components {
                if let Component::ProgramBinding(binding) = &assertion.component {
                    if binding.program_revision != revision || !binding.exists_in(plan) {
                        return Err(invalid("Stale or unresolved ontology program binding."));
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
