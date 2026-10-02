# Continuum

A musical codec: **score → musical relationships + composition program → score**.

The workspace shows source notes, global chord/color windows, executable pitch dependencies and the decoded result. Harmonic palettes, rhythmic materials and shared pitch lattices have independent bindings. Anchor paths can recompute a passing or neighboring pitch from events or shared harmonic values. Doubled performances can retain separate events while sharing a pitch relationship. Every decoded note has one owner; spatial groups and overlapping interpretations do not emit extra copies.

## Run

Install Node.js 22+, the pinned Rust toolchain with `wasm32-unknown-unknown`, and `wasm-bindgen-cli` 0.2.114.

```sh
npm ci
npm run dev
```

Open MIDI or choose a local reference. Analysis covers the whole score automatically. Drag/resize the overview window to navigate; seek with the timeline ruler or playhead. Bar lines follow recorded meter changes; missing meter uses marked quarter coordinates. Select nodes to inspect memberships, anchors and dependent notes. Edit a harmonic root and its core intervals, or transpose one occurrence/shared material, then inspect the re-encoded score. Browser sound is an audition instrument, not a recording reconstruction.

## Code

- `crates/muzak-core/src/scene.rs`: encoder, standalone scene decoding and shared/local edits.
- `harmony.rs`, `harmony_context.rs`: global metrical-window hypotheses, separate realized core/color and witnessed functional-root proposals.
- `pitch_relations.rs`, `scene_relations.rs`: bounded anchor-path proposals and executable dependency closure.
- `partition.rs`, `harmonic.rs`: weighted structural proposals and co-release support relationships.
- `composition.rs`: the single exact realization algebra, including shared arbitrary pitch lattices and source-independent anchor paths.
- `model.rs`, `midi.rs`, `meter.rs`, `performance.rs`: observations, interchange, shared metrical geometry and performance preparation.
- `src/core/`: generated contracts and Wasm transport.
- `src/score/`: view state, worker lifetime, navigator and Web Audio device calls.

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
