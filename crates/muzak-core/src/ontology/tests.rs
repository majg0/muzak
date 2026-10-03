use super::*;
use crate::generator::{GeneratorOptions, generate_plan};
use performance::{
    Articulation, ConnectionArticulation, LengthArticulation, StringTechnique, Technique,
    TechniqueInstruction,
};
use structure::{Phrase, PhraseKind, Voice};

fn id(value: &str) -> EntityId {
    EntityId(value.into())
}
fn entity(name: &str, components: Vec<Component>) -> Entity {
    Entity {
        id: id(name),
        label: None,
        components: components
            .into_iter()
            .map(ComponentAssertion::authored)
            .collect(),
    }
}
fn relation(relation: Relation) -> Relationship {
    Relationship {
        relation,
        provenance: Provenance::Authored,
    }
}
fn phrase(name: &str) -> Entity {
    entity(
        name,
        vec![Component::Phrase(Phrase {
            kind: Some(PhraseKind::Phrase),
            function: None,
            cadence: None,
        })],
    )
}
fn example() -> MusicOntology {
    let note = |name| {
        entity(
            name,
            vec![
                Component::Event(Event::Note),
                Component::Pitch(SoundingPitch {
                    value: Pitch {
                        millicents: 6_012_345,
                    },
                }),
                Component::Span(TimeSpan {
                    start: Rational {
                        numerator: -1,
                        denominator: 3,
                    },
                    duration: Rational {
                        numerator: 2,
                        denominator: 7,
                    },
                }),
            ],
        )
    };
    let mut dependent = note("dependent");
    dependent.components.extend([
        ComponentAssertion::authored(Component::Technique(Technique {
            instructions: vec![TechniqueInstruction::String(StringTechnique::HammerOn {
                from: id("anchor"),
            })],
        })),
        ComponentAssertion::authored(Component::Articulation(Articulation {
            connection: Some(ConnectionArticulation::Legato),
            length: Some(LengthArticulation::Tenuto),
            accents: vec![],
        })),
    ]);
    MusicOntology {
        entities: vec![
            note("anchor"),
            dependent,
            phrase("phrase"),
            phrase("overlapping-phrase"),
            entity(
                "voice",
                vec![Component::Voice(Voice {
                    succession: Some(vec![id("anchor"), id("dependent")]),
                    role: None,
                    tessitura: None,
                })],
            ),
        ],
        relationships: vec![
            relation(Relation::Membership {
                collection: id("phrase"),
                member: id("anchor"),
                role: MembershipRole::Melody,
                ordinal: Some(0),
            }),
            relation(Relation::Membership {
                collection: id("overlapping-phrase"),
                member: id("anchor"),
                role: MembershipRole::Member,
                ordinal: None,
            }),
            relation(Relation::Succession {
                predecessor: id("anchor"),
                successor: id("dependent"),
                voice: id("voice"),
            }),
            relation(Relation::Dependency {
                dependent: id("dependent"),
                anchor: id("anchor"),
                aspect: DependencyKind::Pitch,
            }),
        ],
        ..Default::default()
    }
}

#[test]
fn components_compose_and_overlapping_membership_keeps_distinct_identity() {
    let document = example();
    document.validate().unwrap();
    let serialized = serde_json::to_string(&document).unwrap();
    let mut decoded: MusicOntology = serde_json::from_str(&serialized).unwrap();
    assert_eq!(decoded, document);
    assert_eq!(decoded.entities_with(ComponentKind::Event).count(), 2);
    assert_eq!(decoded.entities_with(ComponentKind::Phrase).count(), 2);
    // Coincident equal pitches remain separate entities and component values.
    if let Component::Pitch(pitch) = &mut decoded.entities[1].components[1].component {
        pitch.value.millicents += 700_001;
    } else {
        panic!("Expected independent pitch component");
    }
    assert_eq!(decoded.entities[0], document.entities[0]);
    assert_ne!(decoded.entities[1], document.entities[1]);
    decoded.validate().unwrap();
}

#[test]
fn malformed_identity_components_and_references_fail() {
    let mut document = example();
    document.entities.push(document.entities[0].clone());
    assert!(document.validate().is_err());
    let mut document = example();
    let duplicate = document.entities[0].components[0].clone();
    document.entities[0].components.push(duplicate);
    assert!(document.validate().is_err());
    let mut document = example();
    document.entities.remove(0);
    assert!(document.validate().is_err());
    let mut document = example();
    document
        .relationships
        .push(document.relationships[0].clone());
    assert!(document.validate().is_err());
    let mut document = example();
    document.relationships.push(relation(Relation::Alternative {
        left: id("anchor"),
        right: id("phrase"),
        aspect: ComponentKind::Chord,
    }));
    assert!(document.validate().is_err());
}

#[test]
fn exact_units_and_evidence_are_validated_without_guessing() {
    assert_eq!(
        Rational {
            numerator: 1,
            denominator: 3
        }
        .compare(&Rational {
            numerator: 2,
            denominator: 6
        })
        .unwrap(),
        std::cmp::Ordering::Equal
    );
    assert!(
        Rational {
            numerator: 1,
            denominator: 0
        }
        .validate()
        .is_err()
    );
    assert!(
        Rational {
            numerator: i64::MIN,
            denominator: 1
        }
        .validate()
        .is_err()
    );
    let mut document = example();
    document.entities[0].components[0].provenance = Provenance::Observed { evidence: vec![] };
    assert!(document.validate().is_err());
    document.entities[0].components[0].provenance = Provenance::Observed {
        evidence: vec![EvidenceReference {
            source: "score-sha256:example".into(),
            observation: "note-7".into(),
        }],
    };
    document.entities[1].components[0].provenance = Provenance::Hypothesis {
        revision: 3,
        evidence: vec![],
    };
    document.validate().unwrap();
    // Unsupported evidence is unknown, not a fabricated confidence or zero.
    assert!(
        matches!(document.entities[1].components[0].provenance, Provenance::Hypothesis { ref evidence, .. } if evidence.is_empty())
    );
}

#[test]
fn program_links_use_existing_addresses_and_reject_stale_revisions() {
    let plan = generate_plan(&GeneratorOptions::default()).unwrap();
    let material = &plan.materials[0];
    let addresses = vec![
        ProgramAddress::Material {
            id: material.id.clone(),
        },
        ProgramAddress::MaterialEvent {
            material: material.id.clone(),
            index: 0,
        },
        ProgramAddress::Placement {
            definition: None,
            index: 0,
        },
        ProgramAddress::Definition {
            id: plan.definitions.as_ref().unwrap()[0].id.clone(),
        },
        ProgramAddress::Placement {
            definition: Some(plan.definitions.as_ref().unwrap()[0].id.clone()),
            index: 0,
        },
        ProgramAddress::Harmony {
            id: plan.harmonies.as_ref().unwrap()[0].id.clone(),
        },
        ProgramAddress::PitchLattice {
            id: plan.pitch_lattices.as_ref().unwrap()[0].id.clone(),
        },
        ProgramAddress::Part {
            id: plan.context.parts[0].id.clone(),
        },
    ];
    let mut document = MusicOntology {
        entities: addresses
            .into_iter()
            .enumerate()
            .map(|(i, address)| {
                entity(
                    &format!("address-{i}"),
                    vec![Component::ProgramBinding(ProgramBinding {
                        program_revision: 8,
                        address,
                    })],
                )
            })
            .collect(),
        ..Default::default()
    };
    document.validate_program_bindings(&plan, 8).unwrap();
    assert!(document.validate_program_bindings(&plan, 9).is_err());
    document.entities.push(entity(
        "bad",
        vec![Component::ProgramBinding(ProgramBinding {
            program_revision: 8,
            address: ProgramAddress::MaterialEvent {
                material: material.id.clone(),
                index: material.notes.len(),
            },
        })],
    ));
    assert!(document.validate_program_bindings(&plan, 8).is_err());
}
