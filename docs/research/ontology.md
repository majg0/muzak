# Musical ontology

The current work is the vocabulary and representation foundation for composition. Rust owns the definitions in `crates/muzak-core/src/ontology/`. This step supplies musical nouns, structured parameters and relationships. It does not claim that naming a technique teaches the generator to play it. `CompositionPlan` remains the sole executable algebra, and `compile_composition` remains the sole note emitter.

## Composition of concepts

`MusicOntology` is a portable ECS-style document: stable `EntityId`s, independent typed `Component`s, and explicit `Relation`s. It needs no ECS engine, scheduler, dynamic type registry or new dependency. A note can carry native pitch, exact time, spelling, articulation, physical technique, a pitch gesture and a program address independently. An instrument can carry timbre without becoming a MIDI program. Querying `entities_with(ComponentKind::Technique)` does not assign the entities a new semantic parent.

Each entity has at most one component of each family. A component can contain several compatible instructions: tenuto length, legato connection and an accent can coexist. Competing values use separate entities and an `Alternative` relationship naming the relevant component. This keeps ambiguity explicit without making every property an untyped bag.

Each component assertion and relationship carries its own `Provenance`: authored, observed with source addresses, or hypothesized under a revision. An authored choice is not an inference result. Evidence addresses supply no pitches or durations. The original score and its identity, native pitch/gain curves, event order and routing remain in the existing immutable score representation.

Membership, melodic succession, dependencies, directional correspondence, definition/occurrence and intent/realization are separate relations. Membership can overlap; time bounds never supply members. A phrase, chord and voice can refer to the same event. Equal values do not merge identities, imply voice membership or establish shared parameters. No ontology relation grants emission ownership.

## Domain types

| Domain | Main structures | Independent dimensions |
| --- | --- | --- |
| Identity and evidence | `Entity`, `ComponentAssertion`, `Relationship`, `Provenance`, `EvidenceReference` | Identity, content, interpretation and evidence |
| Native values | Existing `Pitch`, `Rational`, `TimeSpan`, `Event` | Sounding pitch, score-time quarters, event kind; performance seconds are separate |
| Pitch and tuning | `Spelling`, `Interval`, `Scale`, `Mode`, `Tuning`, `Key` | Staff spelling, signed interval, arbitrary periodic lattice, tonic, tuning reference |
| Harmony | `Chord`, `ChordMember`, `HarmonicFunction` | Exact members, core/color, omission, descriptive quality, optional functional reading |
| Realization | `Voicing`, `MemberCorrespondence`, `Arpeggio` | Register, member address, voice assignment, directional correspondence, ordered attacks |
| Rhythm | `Rhythm`, `Beat`, `Subdivision`, `Tuplet`, `Groove`, `DurationNotation` | Attacks/rests, pulse, division, notation, accents and displacement |
| Meter and tempo | `Meter`, `Tempo` | Additive groupings, signature, pulse interpretation, speed and change |
| Performance | `Articulation`, `Technique`, `Ornament`, `PitchGesture`, `Dynamics`, `Expression` | Musical instruction, physical execution, anchored elaboration, trajectory and expression |
| Resources | `Instrument`, `Performer`, `Ensemble`, `Orchestration` | Sound-production family, range, technique, player, allocation and doubling |
| Sound | `Timbre` and its spectral, envelope, synthesis and effect types | Instrument identity, acoustic properties, sound design and processing |
| Structure | `Voice`, `Motif`, `Phrase`, `Form`, `Texture`, `Transformation` | Succession, reuse, boundaries, formal role, counterpoint and declarative transformation |
| Notation | `Notation`, `Lyrics` and their constituent types | Clefs, staff, note values, ties/slurs, navigation, historical notation, syllables and melisma |
| Cultural context | `Tradition`, `ExtensionTerm` | Qualified names, tuning, pitch collections, characteristic paths, rhythmic cycles and practices |
| Existing program | `ProgramBinding`, `ProgramAddress` | Revision-checked material, event, definition, placement, palette, lattice and part addresses |

Names describe supplied structure; they do not override exact data. A scale's descriptive family cannot complete missing degrees or infer a key. Scale material reuses the compiler's `PitchLattice` and its validation, including arbitrary periods. A chord's descriptive quality does not replace its exact members. Diminished/augmented interval quality, chord quality, scale family and rhythmic diminution/augmentation are different types.

`Voice` describes musical continuity, `Instrument` a resource, and a program `Part` address routing. A named top voice has no built-in privilege. `Voicing` preserves member identity and exact register; equal pitch sets cannot replace directional member correspondence. `Arpeggio` names ordered events and chord members, with rhythm independent of the chord.

Articulation does not hard-code a gate ratio: staccato and tenuto preserve intent. Hammer-on and pull-off describe string technique and name the preceding event. Pitch bends and glissandi describe gestures separately from their physical mechanism. Ornament anchors distinguish principal, preparation, resolution and auxiliary events. None of these descriptive relationships is presented as an already executable elaboration.

`Tradition` can connect tuning, melodic paths, pitch material, rhythmic cycles and techniques. Maqam/makam are not reduced to a Western mode enum. Qualified extension terms preserve a cultural or local vocabulary without claiming an implementation for unknown concepts.

## Vocabulary coverage

The finite coverage target is all **354 indexed musical headwords** in the [LilyPond 2.26 Music Glossary](https://lilypond.org/doc/v2.26/Documentation/music-glossary/): 344 general and ten non-Western entries. The independently fetched heading/URL inventory is in `music-vocabulary.json`; the Rust registry and coverage tests are in `ontology/vocabulary.rs`. This target covers the indexed headwords, not every translated table cell, every word in definitions, or every musical culture.

The registry contains **792 canonical concepts** across 39 representation categories, extending those headwords with composition, guitar, orchestration, timbre and production terminology. Each entry has a typed `MusicTerm`, domain, representation category, canonical name, aliases and source links. Categories have exhaustively checked routes to component kinds; provenance lives on assertions. Lookup retains multiple senses rather than choosing by accident: piano can identify an instrument or a dynamic; color can concern harmony or timbre. “Hammer-off” resolves to pull-off. Synonyms do not introduce duplicate musical operations. Historical, editorial and software terms are classified honestly as vocabulary, notation or provenance rather than fabricated performance algorithms.

Inspect the complete catalog with `cargo run -p muzak-core -- --ontology-glossary`. Rust consumers use `vocabulary::glossary()`, `lookup_term()` and `MusicTerm::entry()`.

The registry records names and mappings, not copied glossary definitions. Reference sources guiding the taxonomy include:

- [MusicXML technical indications](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/technical/), [articulations](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/articulations/) and [ornaments](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ornaments/).
- [MusicXML chord kinds](https://www.w3.org/2021/06/musicxml40/musicxml-reference/data-types/kind-value/) and [MEI analysis and harmony](https://music-encoding.org/guidelines/v5/content/analysisharm.html).
- [MIMO instrument classification](https://mimo-international.com/documents/Hornbostel%20Sachs.pdf) and [SFU Handbook of Acoustic Ecology](https://www.sfu.ca/sonic-studio-webdav/handbook/index.html).
- [MaqamWorld](https://www.maqamworld.com/en/maqam.php) for modal practice beyond an ordered scale.

## Validation and boundary

`MusicOntology::validate` checks the version, identities, component uniqueness, exact numeric ranges, domain parameters, evidence and references. Typed links must target the appropriate components; chord/voicing member addresses must exist. Multiple entities may have identical values, and analytical membership may overlap. These checks establish representation integrity, not perceptual truth or musical quality.

`validate_program_bindings` additionally checks program revisions and exact addresses against an existing `CompositionPlan`. A valid binding is an association with that program, not proof that all attached intentions are realized. A stale address fails explicitly. The ontology does not change score decoding, MIDI export or device preparation.

TypeScript declarations are generated from the Rust definitions by the existing schema build. Ontology types use a distinct generated name prefix, preserving the existing boundary contracts. There is no independently maintained TypeScript music model.

The next composition step, when requested, must lower chosen intentions through the existing compiler and demonstrate useful edits in complete passages. Representation coverage, executable coverage, exact reconstruction and good generated music remain separate gates.
