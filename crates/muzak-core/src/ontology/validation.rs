//! Cross-entity integrity for the portable component document.
//!
//! Local component validators check their values. Here an entity address must
//! also resolve to the kind of musical object its field names, and a member
//! address must resolve to the exact member rather than merely its container.

use super::{
    Component, ComponentKind, Entity, EntityId, MusicOntology, Relation,
    instrumentation::SoundSource,
    notation::NotationMark,
    pitch::Voicing,
    rhythm::MeterOrganization,
    structure::{FormRelationship, MotifIdentity, TransformationOperation},
};
use crate::error::{CoreResult, invalid};
use std::collections::HashMap;

type Entities<'a> = HashMap<&'a EntityId, &'a Entity>;

fn entity<'a>(entities: &Entities<'a>, id: &EntityId) -> CoreResult<&'a Entity> {
    entities
        .get(id)
        .copied()
        .ok_or_else(|| invalid(format!("Unknown ontology entity {}.", id.0)))
}

fn require(
    entities: &Entities<'_>,
    id: &EntityId,
    kind: ComponentKind,
    field: &str,
) -> CoreResult<()> {
    require_any(entities, id, &[kind], field)
}

fn require_any(
    entities: &Entities<'_>,
    id: &EntityId,
    kinds: &[ComponentKind],
    field: &str,
) -> CoreResult<()> {
    let target = entity(entities, id)?;
    if !kinds.iter().any(|kind| target.has(*kind)) {
        return Err(invalid(format!(
            "{field} points to {}, which lacks the required {kinds:?} component.",
            id.0
        )));
    }
    Ok(())
}

fn validate_voicing(entities: &Entities<'_>, voicing: &Voicing) -> CoreResult<()> {
    let chord = if let Some(id) = &voicing.chord {
        require(entities, id, ComponentKind::Chord, "Voicing chord")?;
        entity(entities, id)?
            .components
            .iter()
            .find_map(|assertion| match &assertion.component {
                Component::Chord(chord) => Some(chord),
                _ => None,
            })
    } else {
        None
    };
    for member in &voicing.members {
        if let Some(voice) = &member.voice {
            require(entities, voice, ComponentKind::Voice, "Voiced member voice")?;
        }
        if let Some(id) = &member.chord_member {
            if !chord.is_some_and(|chord| chord.members.iter().any(|member| &member.id == id)) {
                return Err(invalid(format!(
                    "Voiced member {} names an unknown chord member {id}.",
                    member.id
                )));
            }
        }
    }
    for correspondence in &voicing.correspondences {
        let address = &correspondence.to;
        require(
            entities,
            &address.voicing,
            ComponentKind::Voicing,
            "Voice-leading destination",
        )?;
        let found = entity(entities, &address.voicing)?
            .components
            .iter()
            .any(|assertion| match &assertion.component {
                Component::Voicing(voicing) => voicing
                    .members
                    .iter()
                    .any(|member| member.id == address.member),
                _ => false,
            });
        if !found {
            return Err(invalid(format!(
                "Voice-leading destination {} has no member {}.",
                address.voicing.0, address.member
            )));
        }
    }
    Ok(())
}

/// Only recursively defined content must be acyclic. Descriptive references,
/// such as an instrument and its default acoustic timbre, may be reciprocal.
fn validate_containment(document: &MusicOntology, kind: ComponentKind) -> CoreResult<()> {
    let indices: HashMap<_, _> = document
        .entities
        .iter()
        .enumerate()
        .map(|(index, entity)| (&entity.id, index))
        .collect();
    let mut children = vec![Vec::new(); document.entities.len()];
    let mut incoming = vec![0_usize; document.entities.len()];
    for (index, owner) in document.entities.iter().enumerate() {
        for assertion in &owner.components {
            let targets: Vec<&EntityId> = match (&assertion.component, kind) {
                (Component::Tuplet(tuplet), ComponentKind::Tuplet) => {
                    tuplet.parent.iter().collect()
                }
                (Component::Meter(meter), ComponentKind::Meter) => match &meter.organization {
                    MeterOrganization::Polymetric { layers } => layers.iter().collect(),
                    _ => vec![],
                },
                (Component::Timbre(timbre), ComponentKind::Timbre) => match &timbre.source {
                    SoundSource::Layered { layers } => {
                        layers.iter().map(|layer| &layer.timbre).collect()
                    }
                    _ => vec![],
                },
                _ => vec![],
            };
            for target in targets {
                let target_index = *indices
                    .get(target)
                    .ok_or_else(|| invalid("Unknown containment target."))?;
                children[index].push(target_index);
                incoming[target_index] += 1;
            }
        }
    }
    // Kahn's traversal uses bounded heap storage even for deeply nested input.
    let mut ready: Vec<_> = incoming
        .iter()
        .enumerate()
        .filter_map(|(index, count)| (*count == 0).then_some(index))
        .collect();
    let mut visited = 0;
    while let Some(index) = ready.pop() {
        visited += 1;
        for child in &children[index] {
            incoming[*child] -= 1;
            if incoming[*child] == 0 {
                ready.push(*child);
            }
        }
    }
    if visited != document.entities.len() {
        return Err(invalid(format!(
            "Recursive {kind:?} containment has a cycle."
        )));
    }
    Ok(())
}

/// Called after component values and entity existence have been checked.
pub(super) fn validate_references(document: &MusicOntology) -> CoreResult<()> {
    let entities: Entities<'_> = document
        .entities
        .iter()
        .map(|entity| (&entity.id, entity))
        .collect();
    for owner in &document.entities {
        for assertion in &owner.components {
            match &assertion.component {
                Component::Tradition(tradition) => {
                    if let Some(tuning) = &tradition.tuning {
                        require(&entities, tuning, ComponentKind::Tuning, "Tradition tuning")?;
                    }
                    for collection in &tradition.pitch_collections {
                        require(
                            &entities,
                            collection,
                            ComponentKind::Scale,
                            "Tradition pitch collection",
                        )?;
                    }
                    for path in &tradition.characteristic_paths {
                        require_any(
                            &entities,
                            path,
                            &[
                                ComponentKind::Voice,
                                ComponentKind::Motif,
                                ComponentKind::Phrase,
                            ],
                            "Tradition characteristic path",
                        )?;
                    }
                    for cycle in &tradition.rhythmic_cycles {
                        require(
                            &entities,
                            cycle,
                            ComponentKind::Rhythm,
                            "Tradition rhythmic cycle",
                        )?;
                    }
                    for practice in &tradition.performance_practices {
                        require_any(
                            &entities,
                            practice,
                            &[
                                ComponentKind::Technique,
                                ComponentKind::Ornament,
                                ComponentKind::Expression,
                            ],
                            "Tradition performance practice",
                        )?;
                    }
                }
                Component::Scale(scale) => {
                    if let Some(tuning) = &scale.tuning {
                        require(&entities, tuning, ComponentKind::Tuning, "Scale tuning")?;
                    }
                }
                Component::Chord(chord) => {
                    for function in &chord.functions {
                        require(
                            &entities,
                            function,
                            ComponentKind::HarmonicFunction,
                            "Chord function",
                        )?;
                    }
                }
                Component::Voicing(voicing) => validate_voicing(&entities, voicing)?,
                Component::Arpeggio(arpeggio) => {
                    require(
                        &entities,
                        &arpeggio.chord,
                        ComponentKind::Chord,
                        "Arpeggio chord",
                    )?;
                    let chord = entity(&entities, &arpeggio.chord)?
                        .components
                        .iter()
                        .find_map(|assertion| match &assertion.component {
                            Component::Chord(chord) => Some(chord),
                            _ => None,
                        });
                    for attack in &arpeggio.attacks {
                        require(
                            &entities,
                            &attack.event,
                            ComponentKind::Event,
                            "Arpeggio attack",
                        )?;
                        if !chord.is_some_and(|chord| {
                            chord
                                .members
                                .iter()
                                .any(|member| member.id == attack.member)
                        }) {
                            return Err(invalid(format!(
                                "Arpeggio names unknown chord member {}.",
                                attack.member
                            )));
                        }
                    }
                    if let Some(rhythm) = &arpeggio.rhythm {
                        require(&entities, rhythm, ComponentKind::Rhythm, "Arpeggio rhythm")?;
                    }
                }
                Component::Key(key) => {
                    if let Some(scale) = &key.scale {
                        require(&entities, scale, ComponentKind::Scale, "Key scale")?;
                    }
                }
                Component::HarmonicFunction(function) => {
                    if let Some(key) = &function.key {
                        require(&entities, key, ComponentKind::Key, "Harmonic function key")?;
                    }
                }
                Component::Rhythm(rhythm) => {
                    if let Some(meter) = &rhythm.meter {
                        require(&entities, meter, ComponentKind::Meter, "Rhythm meter")?;
                    }
                    if let Some(groove) = &rhythm.groove {
                        require(&entities, groove, ComponentKind::Groove, "Rhythm groove")?;
                    }
                    for tuplet in rhythm
                        .events
                        .iter()
                        .filter_map(|event| event.notation.as_ref())
                        .filter_map(|notation| notation.tuplet.as_ref())
                    {
                        require(
                            &entities,
                            tuplet,
                            ComponentKind::Tuplet,
                            "Rhythm event tuplet",
                        )?;
                    }
                }
                Component::Meter(meter) => {
                    if let MeterOrganization::Polymetric { layers } = &meter.organization {
                        for layer in layers {
                            require(&entities, layer, ComponentKind::Meter, "Polymetric layer")?;
                        }
                    }
                }
                Component::Beat(beat) => {
                    if let Some(meter) = &beat.meter {
                        require(&entities, meter, ComponentKind::Meter, "Beat meter")?;
                    }
                }
                Component::Subdivision(subdivision) => {
                    if let Some(beat) = &subdivision.parent_beat {
                        require(
                            &entities,
                            beat,
                            ComponentKind::Beat,
                            "Subdivision parent beat",
                        )?;
                    }
                }
                Component::Tuplet(tuplet) => {
                    if let Some(parent) = &tuplet.parent {
                        require(
                            &entities,
                            parent,
                            ComponentKind::Tuplet,
                            "Nested tuplet parent",
                        )?;
                    }
                }
                Component::DurationNotation(notation) => {
                    if let Some(tuplet) = &notation.tuplet {
                        require(
                            &entities,
                            tuplet,
                            ComponentKind::Tuplet,
                            "Notated duration tuplet",
                        )?;
                    }
                }
                Component::Technique(technique) => {
                    for event in technique.references() {
                        require(
                            &entities,
                            event,
                            ComponentKind::Event,
                            "Technique source event",
                        )?;
                    }
                }
                Component::Ornament(ornament) => {
                    for event in ornament.references() {
                        require(
                            &entities,
                            event,
                            ComponentKind::Event,
                            "Ornament event anchor",
                        )?;
                    }
                }
                Component::Expression(expression) => {
                    for event in expression.references() {
                        require(
                            &entities,
                            event,
                            ComponentKind::Event,
                            "Performance connection member",
                        )?;
                    }
                }
                Component::Instrument(instrument) => {
                    if let Some(timbre) = &instrument.default_timbre {
                        require(
                            &entities,
                            timbre,
                            ComponentKind::Timbre,
                            "Instrument default timbre",
                        )?;
                    }
                }
                Component::Ensemble(ensemble) => {
                    if let Some(conductor) = &ensemble.conductor {
                        require(
                            &entities,
                            conductor,
                            ComponentKind::Performer,
                            "Ensemble conductor",
                        )?;
                    }
                    for section in &ensemble.sections {
                        for performer in &section.performers {
                            require(
                                &entities,
                                performer,
                                ComponentKind::Performer,
                                "Ensemble section performer",
                            )?;
                        }
                        for instrument in &section.instruments {
                            require(
                                &entities,
                                instrument,
                                ComponentKind::Instrument,
                                "Ensemble section instrument",
                            )?;
                        }
                    }
                }
                Component::Performer(performer) => {
                    for instrument in &performer.instruments {
                        require(
                            &entities,
                            instrument,
                            ComponentKind::Instrument,
                            "Performer instrument",
                        )?;
                    }
                }
                Component::Timbre(timbre) => match &timbre.source {
                    SoundSource::Acoustic { instrument } => require(
                        &entities,
                        instrument,
                        ComponentKind::Instrument,
                        "Acoustic timbre instrument",
                    )?,
                    SoundSource::Layered { layers } => {
                        for layer in layers {
                            require(
                                &entities,
                                &layer.timbre,
                                ComponentKind::Timbre,
                                "Timbre layer",
                            )?;
                        }
                    }
                    _ => {}
                },
                Component::Orchestration(orchestration) => {
                    for assignment in &orchestration.assignments {
                        require(
                            &entities,
                            &assignment.voice,
                            ComponentKind::Voice,
                            "Orchestration voice",
                        )?;
                        require(
                            &entities,
                            &assignment.instrument,
                            ComponentKind::Instrument,
                            "Orchestration instrument",
                        )?;
                        for performer in &assignment.performers {
                            require(
                                &entities,
                                performer,
                                ComponentKind::Performer,
                                "Orchestration performer",
                            )?;
                        }
                        if let Some(timbre) = &assignment.timbre {
                            require(
                                &entities,
                                timbre,
                                ComponentKind::Timbre,
                                "Orchestration timbre",
                            )?;
                        }
                    }
                    for doubling in &orchestration.doublings {
                        require(
                            &entities,
                            &doubling.source_voice,
                            ComponentKind::Voice,
                            "Doubling source voice",
                        )?;
                        require(
                            &entities,
                            &doubling.target_voice,
                            ComponentKind::Voice,
                            "Doubling target voice",
                        )?;
                    }
                    for distribution in &orchestration.distributions {
                        for voice in &distribution.voices {
                            require(
                                &entities,
                                voice,
                                ComponentKind::Voice,
                                "Section distribution voice",
                            )?;
                        }
                        for performer in &distribution.performers {
                            require(
                                &entities,
                                performer,
                                ComponentKind::Performer,
                                "Section distribution performer",
                            )?;
                        }
                    }
                }
                Component::Voice(voice) => {
                    for event in voice.succession.iter().flatten() {
                        require(&entities, event, ComponentKind::Event, "Voice succession")?;
                    }
                }
                Component::Motif(motif) => {
                    if let MotifIdentity::Realization {
                        definition,
                        transformations,
                    } = &motif.identity
                    {
                        require(
                            &entities,
                            definition,
                            ComponentKind::Motif,
                            "Motif definition",
                        )?;
                        for transformation in transformations {
                            require(
                                &entities,
                                transformation,
                                ComponentKind::Transformation,
                                "Motif transformation",
                            )?;
                        }
                    }
                }
                Component::Form(form) => {
                    for relationship in &form.relationships {
                        if let FormRelationship::Variation {
                            transformations, ..
                        } = relationship
                        {
                            for transformation in transformations {
                                require(
                                    &entities,
                                    transformation,
                                    ComponentKind::Transformation,
                                    "Form variation transformation",
                                )?;
                            }
                        }
                    }
                }
                Component::Transformation(transformation) => {
                    for operation in &transformation.operations {
                        match operation {
                            TransformationOperation::Reharmonization { harmony } => require_any(
                                &entities,
                                harmony,
                                &[ComponentKind::Chord, ComponentKind::HarmonicFunction],
                                "Reharmonization harmony",
                            )?,
                            TransformationOperation::Reorchestration { ensemble } => require(
                                &entities,
                                ensemble,
                                ComponentKind::Ensemble,
                                "Reorchestration ensemble",
                            )?,
                            TransformationOperation::Embellishment { embellishment } => require(
                                &entities,
                                embellishment,
                                ComponentKind::Ornament,
                                "Transformation embellishment",
                            )?,
                            _ => {}
                        }
                    }
                }
                Component::Notation(notation) => {
                    for mark in &notation.marks {
                        match mark {
                            NotationMark::Beam { members, .. }
                            | NotationMark::TupletBracket { members, .. }
                            | NotationMark::Ligature { members, .. }
                            | NotationMark::Neume { members, .. } => {
                                for member in members {
                                    require(
                                        &entities,
                                        member,
                                        ComponentKind::Event,
                                        "Notation member",
                                    )?;
                                }
                            }
                            NotationMark::Tie { from, to }
                            | NotationMark::Slur { from, to }
                            | NotationMark::PhraseMark { from, to }
                            | NotationMark::OctaveLine { from, to, .. } => {
                                require(
                                    &entities,
                                    from,
                                    ComponentKind::Event,
                                    "Notation start event",
                                )?;
                                require(&entities, to, ComponentKind::Event, "Notation end event")?;
                            }
                            _ => {}
                        }
                    }
                }
                Component::Lyrics(lyrics) => {
                    for event in lyrics
                        .syllables
                        .iter()
                        .flat_map(|syllable| &syllable.events)
                    {
                        require(
                            &entities,
                            event,
                            ComponentKind::Event,
                            "Lyric syllable event",
                        )?;
                    }
                }
                _ => {}
            }
        }
    }
    for relationship in &document.relationships {
        if let Relation::Succession {
            predecessor,
            successor,
            voice,
        } = &relationship.relation
        {
            require(
                &entities,
                predecessor,
                ComponentKind::Event,
                "Succession predecessor",
            )?;
            require(
                &entities,
                successor,
                ComponentKind::Event,
                "Succession successor",
            )?;
            require(&entities, voice, ComponentKind::Voice, "Succession voice")?;
            let sequence = entity(&entities, voice)?
                .components
                .iter()
                .find_map(|assertion| match &assertion.component {
                    Component::Voice(voice) => voice.succession.as_ref(),
                    _ => None,
                });
            if sequence.is_some_and(|sequence| {
                !sequence
                    .windows(2)
                    .any(|pair| &pair[0] == predecessor && &pair[1] == successor)
            }) {
                return Err(invalid(
                    "Succession relation conflicts with its voice's supplied event order.",
                ));
            }
        }
    }
    for kind in [
        ComponentKind::Tuplet,
        ComponentKind::Meter,
        ComponentKind::Timbre,
    ] {
        validate_containment(document, kind)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model::Pitch,
        ontology::{
            ComponentAssertion, Event,
            instrumentation::{Instrument, NoiseColor, Timbre, TimbreLayer},
            pitch::{
                Chord, ChordMember, ChordMemberRole, ChordQuality, Interval, MemberCorrespondence,
                MemberPresence, RootPresence, VoiceLeadingRelation, VoicedMember,
                VoicedMemberAddress, VoicingDensity, VoicingDisposition, VoicingDrop,
                VoicingInversion, VoicingSpacing,
            },
            rhythm::{Meter, NoteValue, Tuplet},
            structure::Voice,
        },
    };

    fn id(value: &str) -> EntityId {
        EntityId(value.into())
    }

    fn with_component(name: &str, component: Component) -> Entity {
        Entity {
            id: id(name),
            label: None,
            components: vec![ComponentAssertion::authored(component)],
        }
    }

    fn voicing(chord: Option<&str>, member: &str) -> Voicing {
        Voicing {
            chord: chord.map(id),
            members: vec![VoicedMember {
                id: member.into(),
                pitch: Pitch {
                    millicents: 6_000_000,
                },
                chord_member: None,
                voice: None,
            }],
            disposition: VoicingDisposition {
                spacing: VoicingSpacing::Unspecified,
                drop: VoicingDrop::Unspecified,
                inversion: VoicingInversion::Unspecified,
                root_presence: RootPresence::Unspecified,
                density: VoicingDensity::Unspecified,
            },
            bass_member: None,
            correspondences: vec![],
        }
    }

    #[test]
    fn a_resolved_entity_is_not_automatically_a_chord() {
        let document = MusicOntology {
            entities: vec![
                with_component(
                    "voice",
                    Component::Voice(Voice {
                        succession: None,
                        role: None,
                        tessitura: None,
                    }),
                ),
                with_component(
                    "voicing",
                    Component::Voicing(voicing(Some("voice"), "first")),
                ),
            ],
            ..MusicOntology::default()
        };
        assert!(validate_references(&document).is_err());
    }

    #[test]
    fn chord_member_addresses_resolve_to_exact_members() {
        let mut voiced = voicing(Some("chord"), "first");
        voiced.members[0].chord_member = Some("missing-third".into());
        let mut document = MusicOntology {
            entities: vec![
                with_component(
                    "chord",
                    Component::Chord(Chord {
                        reference: Pitch {
                            millicents: 6_000_000,
                        },
                        root: None,
                        quality: ChordQuality::Unclassified,
                        members: vec![ChordMember {
                            id: "root".into(),
                            interval: Interval {
                                millicents: 0,
                                notation: None,
                            },
                            degree: None,
                            role: ChordMemberRole::Core,
                            presence: MemberPresence::Present,
                        }],
                        functions: vec![],
                    }),
                ),
                with_component("voicing", Component::Voicing(voiced)),
            ],
            ..MusicOntology::default()
        };
        assert!(validate_references(&document).is_err());
        if let Component::Voicing(voicing) = &mut document.entities[1].components[0].component {
            voicing.members[0].chord_member = Some("root".into());
        }
        assert!(validate_references(&document).is_ok());
    }

    #[test]
    fn correspondence_cannot_silently_resolve_to_another_equal_pitch() {
        let mut source = voicing(None, "source-member");
        source.correspondences.push(MemberCorrespondence {
            from_member: "source-member".into(),
            to: VoicedMemberAddress {
                voicing: id("destination"),
                member: "missing-member".into(),
            },
            relation: VoiceLeadingRelation::Resolution,
        });
        let mut document = MusicOntology {
            entities: vec![
                with_component("source", Component::Voicing(source)),
                with_component(
                    "destination",
                    Component::Voicing(voicing(None, "exact-member")),
                ),
            ],
            ..MusicOntology::default()
        };
        assert!(validate_references(&document).is_err());
        if let Component::Voicing(voicing) = &mut document.entities[0].components[0].component {
            voicing.correspondences[0].to.member = "exact-member".into();
        }
        assert!(validate_references(&document).is_ok());
    }

    #[test]
    fn voice_succession_requires_event_entities() {
        let mut document = MusicOntology {
            entities: vec![
                with_component(
                    "voice",
                    Component::Voice(Voice {
                        succession: Some(vec![id("member")]),
                        role: None,
                        tessitura: None,
                    }),
                ),
                with_component(
                    "member",
                    Component::Voice(Voice {
                        succession: None,
                        role: None,
                        tessitura: None,
                    }),
                ),
            ],
            ..MusicOntology::default()
        };
        assert!(validate_references(&document).is_err());
        document.entities[1] = with_component("member", Component::Event(Event::Note));
        assert!(validate_references(&document).is_ok());
    }

    #[test]
    fn containment_cycles_fail_independently_in_each_recursive_family() {
        let component = |kind, target: Option<&str>| match kind {
            ComponentKind::Tuplet => Component::Tuplet(Tuplet {
                actual_notes: 3,
                normal_notes: 2,
                base_unit: NoteValue::Eighth,
                parent: target.map(id),
            }),
            ComponentKind::Meter => Component::Meter(Meter {
                organization: target.map_or(MeterOrganization::Unknown, |target| {
                    MeterOrganization::Polymetric {
                        layers: vec![id(target), id("leaf")],
                    }
                }),
                tactus: None,
                pickup: None,
            }),
            ComponentKind::Timbre => Component::Timbre(Timbre {
                name: "timbre".into(),
                descriptors: vec![],
                source: target.map_or(
                    SoundSource::Noise {
                        color: NoiseColor::White,
                    },
                    |target| SoundSource::Layered {
                        layers: vec![TimbreLayer {
                            timbre: id(target),
                            gain: 1.0,
                            detune_millicents: 0,
                        }],
                    },
                ),
                envelope: None,
                effects: vec![],
            }),
            _ => unreachable!(),
        };
        for kind in [
            ComponentKind::Tuplet,
            ComponentKind::Meter,
            ComponentKind::Timbre,
        ] {
            let mut document = MusicOntology {
                entities: vec![
                    with_component("a", component(kind, Some("b"))),
                    with_component("b", component(kind, Some("a"))),
                    with_component("leaf", component(kind, None)),
                ],
                ..MusicOntology::default()
            };
            assert!(document.validate().is_err(), "{kind:?} cycle must fail");
            document.entities[1] = with_component("b", component(kind, None));
            document.validate().unwrap();
        }
    }

    #[test]
    fn instrument_and_its_default_acoustic_timbre_may_reference_each_other() {
        let instrument: Instrument = serde_json::from_value(serde_json::json!({
            "name": "violin", "families": ["strings"], "soundProduction": ["chordophone"],
            "capabilities": {
                "polyphony": {"kind": "unknown"}, "pitchControl": "continuous", "excitation": ["bowed"],
                "canSustain": true, "canChangePitchDuringSustain": true
            },
            "range": null, "tessitura": null,
            "transposition": {"soundingMinusWrittenMillicents": 0, "diatonicSteps": 0},
            "tuning": null, "catalogue": null, "defaultTimbre": "bowed-violin"
        })).unwrap();
        let document = MusicOntology {
            entities: vec![
                with_component("violin", Component::Instrument(instrument)),
                with_component(
                    "bowed-violin",
                    Component::Timbre(Timbre {
                        name: "bowed violin".into(),
                        descriptors: vec![],
                        source: SoundSource::Acoustic {
                            instrument: id("violin"),
                        },
                        envelope: None,
                        effects: vec![],
                    }),
                ),
            ],
            ..MusicOntology::default()
        };
        document.validate().unwrap();
    }
}
