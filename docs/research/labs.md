# Experiment labs

The page has one catalog and one active experiment. Each lab owns its purpose, controls, draft and accepted output; adding a tool does not add another branch to a shared workbench. A lab may show a score, a spectrum, a table or another view. The host has no score contract.

## Boundaries

| Responsibility | Owner |
| --- | --- |
| Discovery, groups, search and lazy module imports | `src/labs/catalog.ts` |
| Navigation and page layout | `src/labs/shell.ts` |
| One active mount, loading/failure states, retained sessions | `src/labs/host.ts` |
| Per-activation abort signal, Rust worker and resource cleanup | `src/labs/scope.ts` |
| Private draft and accepted result | Each module's `createSession()` closure |
| Shared generator-form interaction | `src/labs/shared/generator-study.ts` |
| Optional transport, audition and MIDI download | `src/labs/shared/score-preview.ts` |
| Score rendering, navigation, selection and seek gestures | `src/score/timeline.ts` |
| Musical defaults, generation, validation and compilation | Rust, through generated API contracts |

The catalog contains metadata, not mounted views. The host lazily imports the selected module and creates a session once. Every activation gets fresh DOM and a new scoped core client. Navigation aborts listeners, disposes views and audio, terminates that worker and rejects its pending requests. Import/mount revision checks prevent an old completion from replacing the active lab. Register cleanup immediately with `context.onDispose`, before awaiting anything; registration after disposal releases the resource immediately.

Sessions retain plain data across navigation, not active workers, DOM or audio. Melody/Rhythm retain raw form drafts and their last accepted plan, score and meter. Failed or superseded generation leaves the accepted output intact. Composition snapshots its source, accepted edited scene, controls and view; restoration hydrates the codec controller without inferring away authored edits. Pending generation/edits are cancelled, not silently accepted. This retention lasts only until page reload. Durable storage is not part of this contract, and no existing browser storage is erased.

## Optional timeline

`mountScoreTimeline` takes a host and optional callbacks for note selection, viewport changes, seek gestures and play/pause. The caller supplies `Score` and the Rust `ScoreMeterMap`, then may supply identified highlights, bounded regions and note-to-note links. Native pitch curves and exact source timing are rendered unchanged. The timeline owns its navigator, resize observer, animation frame and pointer listeners, and releases them on disposal.

The view has no scene, classifier, generator, worker or audio dependency. Composition prepares its own harmony band and overlay data. Generator labs opt into `mountScorePreview`, which composes this same view with `ScorePlayer` and the caller's scoped Rust client. Other labs can import neither component. Overview/roll gestures navigate; the ruler/playhead seeks. A timeline viewport never changes playback position implicitly.

## First experiments

Melody is a bounded seeded walk over a supplied native `PitchLattice`; its small UI exposes seed, note count, maximum degree step, tempo and repetition. Rhythm spreads a chosen count of pulses over integer steps, with signed rotation, rational step duration and repetition. Zero pulses is explicit silence. The API also accepts arbitrary supported native pitch/lattice inputs. The UI does not invent musical defaults or run another music algorithm.

Both Rust experiments return `CompositionPlan`: one reusable material and repeated placements, compiled by the existing `compile_composition`. These are small architecture exercises, not claims of new long-form musical quality or complete ontology lowering. No meter is inferred from the number of steps. MIDI export retains the existing strict loss checks.

## Adding an experiment

1. Add a cohesive module exporting `createSession(): LabSession`. Keep its typed draft and output in that closure. Implement `mount(container, context)`, use `context.signal` for listeners/fetches, and register every acquired resource with `context.onDispose`.
2. Add one catalog entry with a stable route ID, title, description, group, search tags and `load: () => import('./your-lab')`. No shell changes are needed.
3. If it produces music, put defaults, validation and musical transformations in Rust and expose generated contracts. Use `context.call` for asynchronous operations; guard awaited completions against disposal and superseding input. Produce the existing composition algebra when notes are the output.
4. Import the timeline or score preview only if the experiment needs it. Scope new styles to that experiment; never import another lab's view or mutate its session. Share a component only when multiple callers have a concrete common responsibility.
5. Test its musical properties and failure boundaries. Host/core lifecycle tests separately cover stale imports, cancelled mounts, isolated workers, retained sessions and failures that do not disable sibling labs.

The catalog and TypeScript interfaces are the extension mechanism. There is no dynamic plugin engine, generic parameter graph, universal result schema or second musical decoder.
