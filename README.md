# Continuum

A music generator and codec: **ideas → editable composition program → score**, and **score → inferred relationships + program → score**.

The page is a growing collection of [independent experiment labs](docs/research/labs.md). Harmonic Motion explores every ordered pair in a supplied chord catalog, their relationship to tonal centers and an editable passage. Melody explores a seeded pitch walk; Rhythm distributes pulses across a cycle; Composition retains generation, MIDI import, structural editing and export. The searchable catalog loads one lab at a time. Each lab owns its draft and results, and can opt into the shared piano-roll view and audition controls.

The [typed musical ontology](docs/research/ontology.md) remains the representation foundation: ECS-style entities compose pitch, rhythm, harmony, voice, instrumentation, timbre, performance, form and notation, with explicit relationships and evidence. Its glossary audit covers the complete indexed LilyPond vocabulary plus additional composition and performance terms. Named techniques become audible only when deliberately implemented through the existing compiler.

The Composition lab shows source notes, global chord/color windows, executable pitch dependencies and the decoded result. Harmonic palettes, rhythmic materials and shared pitch lattices have independent bindings. Anchor paths can recompute a passing or neighboring pitch from events or shared harmonic values. Doubled performances can retain separate events while sharing a pitch relationship. Every decoded note has one owner; spatial groups and overlapping interpretations do not emit extra copies.

## Run

Install Node.js 22+, the pinned Rust toolchain with `wasm32-unknown-unknown`, and `wasm-bindgen-cli` 0.2.114.

```sh
npm ci
npm run dev
```

Choose Melody or Rhythm for a small generator experiment, or Composition for a complete passage and MIDI workflow. Inputs and accepted results survive switching labs within this page session; they are not persisted across reloads. Switching stops audio and releases the previous lab's workers and views. Browser sound is an audition instrument, not a finished production.

Choose **Harmonic Motion** for classical and modal cadences, jazz substitutions, triadic transformations, symmetric cycles and arbitrary tuning studies. Compare exact member movement with tonic-relative effects and duration-weighted passage history, inspect every successor, then edit and audition a passage through the same composition compiler. Tonal frames and objective weights are explicit premises. Exhaustiveness covers the declared finite catalog; rankings are editable preferences, not learned probabilities or universal emotional laws. The [harmonic-motion foundation](docs/research/harmonic-motion.md) defines the theory, sources and evaluation boundary.

In Composition, generate a seeded passage, play it, edit its harmonic palettes or shared/local materials, and export MIDI. Tempo, meter, mode, density, variation and color are controllable. Generated phrases retain their authored bindings; edits compile directly and never re-infer away the program.

Open MIDI or choose a local reference to infer a scene from observations. Analysis covers the whole score automatically. Drag/resize the overview window to navigate; seek with the timeline ruler or playhead. Bar lines follow recorded meter changes; missing meter uses marked quarter coordinates. Source observations remain available beside the decoded edited program.

## Code

- `crates/muzak-core/src/ontology/`: composable Rust musical nouns, typed components and relationships, glossary coverage and validation.
- `crates/muzak-core/src/labs.rs`: bounded melody/rhythm experiments producing the existing `CompositionPlan`.
- `crates/muzak-core/src/harmonic_motion.rs`: exhaustive finite chord relations, tonic/context comparisons and passage realization through `CompositionPlan`.
- `crates/muzak-core/src/scene.rs`: encoder, standalone scene decoding and shared/local edits.
- `generator.rs`: seeded themes, melody-aware harmonic routes, voicing and arrangement through the same composition algebra.
- `harmony.rs`, `harmony_context.rs`: global metrical-window hypotheses, separate realized core/color and witnessed functional-root proposals.
- `pitch_relations.rs`, `scene_relations.rs`: bounded anchor-path proposals and executable dependency closure.
- `paired_pitch.rs`: bounded shared-binding candidates across two supplied realizations, retaining ambiguity and edit behavior.
- `member_transform.rs`: bounded contextual/chromatic member programs over supplied palettes and domains; the native research adapter compares exact realizations without a second compiler.
- `segmental.rs`: bounded latent span inference with accumulated source evidence, exact gradients and full core/operation marginals.
- `partition.rs`, `harmonic.rs`: weighted structural proposals and co-release support relationships.
- `composition.rs`: the single exact realization algebra, including shared arbitrary pitch lattices and source-independent anchor paths.
- `model.rs`, `midi.rs`, `meter.rs`, `performance.rs`: observations, interchange, shared metrical geometry and performance preparation.
- `src/labs/`: lazy catalog, session lifecycle, isolated experiment views and optional score preview.
- `src/core/`: generated contracts and owned Wasm worker clients.
- `src/score/`: reusable timeline, codec views, worker lifetime and Web Audio device calls.

```sh
npm test
npm run analyze -- INPUT.mid
npm run analyze -- --corpus
npx tsx scripts/evaluate-patterns.ts --work=beethovenOp2No1Mvt3
npx tsx scripts/evaluate-harmony.ts
npx tsx scripts/research-status.ts
npm run build
```

Build hooks generate the Rust/Wasm bridge and TypeScript contracts incrementally. Independent evaluation uses development data only. The harmony runner compares notation-time Mozart movements with independently supplied chord analyses; its score MIDI appears among local references. Raw references stay in ignored `research/corpus/`; generated reports go in ignored `.audit/`. They are never bundled with the application.

For fast harmony experiments, build `cargo build -p muzak-core --release --bin muzak-core`, then run `npx tsx scripts/evaluate-harmony.ts --native=target/release/muzak-core.exe --options=OPTIONS.json --compact --diagnostics`. One persistent native process serves the full comparison. The separately pinned contextual-model comparator and its training-overlap limits are documented in [primary evidence](docs/research/structure-inference.md).

The first source-only relation control reconstructs exactly and changes E–F–G to A–B–C where palette-only editing yields A–B♭–C. This demonstrates a specified counterfactual, not general voice recovery or improved Mozart harmony accuracy. An observed pitch vocabulary is not a key; unsupported edits fail explicitly. Program, binding and residual byte costs are reported without claiming compression.

Read the [codec contract](docs/research/design.md), [primary evidence](docs/research/structure-inference.md), [current work](docs/research/program.json) and [source registry](docs/research/corpus-candidates.json). Exact reconstruction proves preservation; musical interpretation and useful recomposition require separate evaluation.
