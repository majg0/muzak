# Musical codec

The domain has one direction in each sense: `Score → MusicalScene → Score`. The scene contains an executable `CompositionPlan`, explicit event identity/performance residuals, and a graph of musical interpretations. Composition is the sole note-emitting algebra.

## Scene and ownership

Observed notes are immutable evidence. Part routing, attack/release coordinates, native pitch/gain curves and MIDI attachments survive reconstruction. Analytical groups may overlap; executable owners partition the notes exactly once. Selected pitch relations close over their anchors into one material, independently of spatial boxes or source parts. Remaining support/complement candidates compete by observed recurrence; unclaimed events use spatial fallback groups. This bounded ownership policy is not an optimal musical parse. BSP nodes no longer wrap independent owners in executable nesting. Shared normalized materials use placements and definitions; a box never implies membership of every enclosed note.

The hierarchy is a candidate explanation with typed relationships, not a claim that music has a unique binary parse. Global harmony, arpeggio support and melodic relations can coexist at different scales. Repeated rhythmic material links occurrences across branches. Scene hierarchy and reusable material dictionary answer different questions; phrases and themes require further evidence.

A chord label does not encode voicing, octave, timing, rhythm, routing or performance. Rhythm materials retain onset/duration, routing and relative expressive curves, with neutral attack pitch. Placement bindings supply a harmonic palette tone plus octave/residual, a literal pitch, or a lattice path between material-event anchors. The compiler resolves attack pitches before nested pitch/time transforms and shifts each native pitch knot by the same attack displacement. Gain and rhythmic shape remain independent. Drum keys and unrepresentable relative curves remain literal.

Bindings use the harmonic context at each attack. A held note may belong analytically to several windows but is emitted once and keeps its attack binding. Changing a later window never silently retriggers it. Preserve lower-level realization and explicit differences until an abstraction reconstructs it. Quantify total program/residual cost instead of claiming compression from prototype counts alone; full scenes also carry inspection evidence and can exceed source size.

## Executable pitch relations

`CompositionPlan.pitchLattices` is a shared dictionary of origins, strictly ordered intervals and positive periods in native millicents. It assumes neither twelve equal divisions nor a major scale. A `latticePath` binding names a lattice, two typed anchors, a rational position, degree offset and exact pitch residual. An anchor references either a material-event index or a direct harmonic value address (palette, tone, octave and residual). Both resolved anchors must lie on that lattice; interpolation must yield an integer degree. Unknown anchors, cycles, unsafe coordinates and off-lattice edits fail explicitly. Resolution is iterative and source-independent; evidence IDs supply no musical values.

The bounded inverse kernel currently proposes zero-residual, adjacent-degree passing and neighbor triples. Endpoints must have direct harmonic bindings; scene admission uses selected chord-core attacks, and their harmonic contexts may differ. Automatic succession uses reciprocal nearest-pitch links between adjacent attack groups with explicit gap/step limits. Coincident attacks may share an endpoint value only when timing, native curves and direct binding expressions agree; equal sounding pitches attached to different palettes remain distinct. Such classes use harmonic value anchors and retain every source witness and emitted event. This does not infer voice identity. Other ties abstain and track names do not establish voices. Supplied successors are a distinct input condition. Nonconstant native pitch curves are preserved but excluded from this narrow inference; they remain observed barriers rather than silently disappearing.

Whole-score encoding proposes one sorted observed pitch vocabulary under a declared period. Missing classes stay missing: this is neither tonic detection nor scale completion. Only unique admitted relations replace bindings. Search and storage budgets produce visible diagnostics and retain the prior exact representation. Dependency edges, overlapping evidence and spatial containment remain separate.

The source-only control in `tests/score-relations.test.ts` infers E–F–G over C and B–C–D over G without supplied domains, anchors or labels. An independently observed A belongs to its vocabulary. Changing the first palette to F produces A–B–C through the inferred relation; the same source with relations disabled produces A–B♭–C. Source serialization/decoding is exact, and rhythm, expression and unrelated later notes remain unchanged. This specified edit demonstrates a capability, not universal reharmonization or improved harmonic-label accuracy. Compiler controls additionally cover arbitrary periods, native curves, shared/local domains and invalid dependencies.

Costs count complete program, identity and velocity-residual JSON bytes. Binding/lattice byte fields are subcosts already included in the program; do not add them twice. Selection currently favors unique admissible relations, not minimum serialized size. Tiny relational programs can cost more than literal ones; compression and general structural recovery remain unproven.

Persisted selected relationship records must cover the executable paths exactly. Event anchors require their exact event witness; every shared-value witness must retain the same symbolic harmonic address. Corrupt, missing, duplicated or detached records are rejected. Shared/local placement transforms act after pitch resolution; a local edit of a dependency component moves all of its emitted witnesses and descendants together.

## Global harmony and rhythm

Analyze all instruments jointly on an exact candidate lattice derived from shared Rust meter geometry, with a declared fallback grid when meter is missing. Add exact silence boundaries; never quantize source note events. A bounded variable-span dynamic program retains a state for each endpoint and chord label. Duration, attacks and velocity contribute explicit evidence; part normalization is a parameter and identical part profiles do not gain a duplicate vote. Pitch-class coverage, unexplained/color mass, complexity and metrical change costs are experimental priors calibrated on development examples and generic controls.

Same-label subdivisions incur no chord-change penalty. Semantic label changes require an eligible observed attack/release or an explicit rest/meter edge on the lattice; a bare numerical subdivision cannot invent a change halfway through an unchanged note. This is a declared search restriction, not a perceptual boundary theorem. Forward/backward costs compare complete paths while holding a returned run's internal subdivisions fixed. Keep local fit separate from conditional cost; unavailable costs are null, and neither is a probability. Positive cost margins select a reading; numerical ties stay unresolved. A missing chord member may be supported by surrounding windows without establishing that this is its unique interpretation.

Function and realization have separate coordinates. The bounded context pass can select a unique retained second-inversion realization and propose its bass pitch class as a functional root when the immediate next window supplies the same bass and major-triad resolution. It retains exact note witnesses, timing, the selected realization index and every original hypothesis. Core/color roles and executable palettes stay relative to the realized root. Bass observation explicitly chooses first-sounding or lowest-over-window evidence; the latter supports delayed arpeggios but can mistake a brief low excursion for structural bass. Optional implied resolution names the next selected realization as a dependency and stores only actually observed resolution intervals/note witnesses. These assumptions remain inspectable and do not emit missing notes. The optional prior does not establish a cadence, key, voice leading or general Roman-numeral function. Persisted scenes validate the relation and witness membership without rerunning its inference.

Each window retains alternatives and separate core, permitted-color, residual, unsupported and percussion memberships. A color relation does not identify a passing tone, suspension or extension's harmonic function. Symmetric or incomplete evidence can leave the root unresolved. Rhythm witnesses retain each part's exact attacks, durations and carried-in notes independently from harmonic identity. Exact silence intervals are separate evidence: a duration-weighted bridging cost permits articulation gaps inside a chord without erasing rests. Annotated score alignment evaluates interpretation; it does not establish the composer's private intentions.

Aggregate pitch content can mistake successive triads for their union as a seventh chord. Temporal support must account for musical roles: a pedal bass with a broken upper chord has unequal co-occurrence without implying harmonic change. Require matched-content controls for successive chords, sustained chords, arpeggios, pedal textures and inversions before adopting a temporal penalty. A better search cannot compensate for a scoring rule that prefers the wrong explanation.

## Weights guide the partition

Keep note features and influence separate. A loud note is not automatically a melody or boundary. Meter supplies notated accent only where present; attack velocity is not calibrated loudness. Harmonic support and bass-relative pitch are observed relationships, not guaranteed chord root/function.

Candidate time/register cuts combine weighted feature contrast, gaps and support changes. Group affinities penalize severing supported arpeggio and melodic cohorts. Known-only feature statistics prevent missing meter/support from becoming artificial zero-valued contrasts. Coefficients are explicit experimental priors; ablations must show which grouping decisions they change.

A shared-release support model supplies an initial arpeggio/sonority hypothesis. In the exposed Dire opening it recovers alternating open fifths, repeated upper rhythms and one local pitch change without supplied register boundaries or periods. This is a useful vertical, not general chord/phrase accuracy. The next tests must include inversions, crossing voices, unequal release times, passing tones and conflicting cues.

## Execution and UI

Rust owns score/MIDI, scene encoding, compositional decoding, comparison and performance preparation. Generated TypeScript contracts cross one native/Wasm boundary. TypeScript owns scheduling, device calls and rendering only.

A fresh score starts one complete-source scene job. Replacement terminates old work. The UI contains import/reference, independent playback, overview/timeline, a scene navigator and selected evidence. A seek ruler and draggable playhead control transport; overview and roll gestures control only the viewport. Bar/beat markers come from the same Rust meter parser as analysis, including signature changes and exact fractional spacing. Unknown/conflicting signatures use explicit quarter coordinates. Initial downbeats and numbering remain assumptions when MIDI supplies no pickup information. Source and decoded views use the same coordinates. Selection/filtering is inspection, not a new inference run. Budget/unsupported diagnostics remain visible; no silently truncated input.

## Next inference boundary

The anchored-pitch vertical passes a narrow exact reconstruction and counterfactual gate. The native contextual-root model reaches 63.04% / 55.93% Mozart K330-I/K331-I joint reference-root pitch-class/core agreement; this is development calibration, with no evaluation of Roman degree, key or spelling. Compare learned contextual proposals under the same strict metric and executable representation. Do not introduce a second DSL, decoder or generic graph framework.

Separate immutable observations from revisioned hypotheses. Functional root/key, realized sonority, optional spelling, voice succession and preparation/resolution are different relationships. Latent anchors must carry their own musical values; emitted descendants cannot retrieve values from evidence IDs. A passing note may depend on two anchors, so semantic dependencies need not form a tree. Classical harmonic function remains optional for other musical languages.

Compare executable explanations under explicit library, program/parameter and residual costs, against literal copying and current palette bindings. Count melody bindings even when their rhythm material is shared. Keep executable cost, inspection payload and total scene size distinct. A compiler-valid program can still be a poor musical explanation; test independent relationships and changed-anchor behavior separately. Search scores are not probabilities, and candidate exhaustion is not evidence against an unexamined interpretation.

Keep `model.rs`, exact MIDI/native performance, meter, worker boundaries, exclusive emission and the existing compiler. Replace the current unique-relation/recurrence ownership policy with explicit comparison among executable explanations when the evidence supports it. Retain useful co-release witnesses and test whether BSP fallback/proposals add value. Replace flat root/template ranking only after strict comparison; preserve useful exact lattice, silence, budget and diagnostic mechanics without retaining two disagreeing harmony engines.

Start with bounded unlearned search and tiny exhaustive controls to separate proposal recall from ranking. A learned model may subsequently propose relations and parameters through the same contract. Offline research/training adapters are separate from the Rust production domain; adopt a production model only after its accuracy, lineage, runtime and exported implementation are demonstrated. Quantized model inputs never replace exact source events.

The UI exposes the selected relation's anchors, dependent notes, lattice premise and evidence. Thin connectors use explicit relation IDs; palette edits recompile and re-encode the changed score. Literal residuals remain visible. Rectangles are views of memberships, never their source. Playback and viewport navigation remain independent of whole-score inference.

Editing currently replaces observations with the compiled score and runs inference again. This can lose the edited relationship even when realization is correct: shifting the Dire q50–52 palette up two semitones yields C♯–D–C♯ in both leads, but the new harmonic reading no longer admits that dependency. Preserve the authoritative edited program separately from refreshed analytical hypotheses before treating reanalysis as a composition workflow. Do not force the inverse scorer to rediscover an authored decision or report consistency as independent accuracy.

## Acceptance gates

1. Exact notes, expression, identity and decoded MIDI events survive standalone scene serialization/decoding.
2. Emission ownership is exhaustive/exclusive; analytical overlap remains intact.
3. Shared material edits affect all its placements; a local edit affects one occurrence.
4. Contextual evidence changes grouping and relationship selection in controlled counterexamples, while unknown/unrelated evidence cannot manufacture a change. No particular partition algorithm is required.
5. Independent occurrence/boundary annotations measure interpretation separately from reconstruction. Keep annotators and tune-family splits separate; report oracle choices as such.
6. Listening and useful recomposition establish musical value. Correct reconstruction and richer labels alone do not.

## Scope

Raw MIDI lacks reliable spelling, voice identity and recording alignment. Score-derived Mozart references provide exact notation-time alignment; their paired expressive performance MIDIs require the supplied note alignment, not raw beat comparison. Chord function, perceptually convincing phrases/themes and autonomous long-form composition remain evaluation targets. Current scene types describe supported hypotheses and executable ownership, with residuals where understanding is incomplete.

Primary evidence is summarized in [structure-inference.md](structure-inference.md). [program.json](program.json) records the current capability boundary and active/next work; source identity lives in [corpus-candidates.json](corpus-candidates.json).
