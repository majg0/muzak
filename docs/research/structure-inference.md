# Structural inference: current evidence and next gate

**Recover executable relationships through the existing Rust compiler.** Exact reconstruction and a better chord label are separate achievements. General event ownership, voice recovery, functional interpretation and reusable composition remain unresolved. Architecture lives in [design.md](design.md); current task state lives in [program.json](program.json).

## Retained results and strict contract

Mozart development agreement, K330-I / K331-I:

| Method | Realized core | Joint reference-root/core |
| --- | --- | --- |
| Shipped Rust/Wasm with witnessed resolution context | 68.57% / 60.14% | 63.04% / 55.93% |
| Maintained four-work quality readout + witnessed function spans | 93.81% / 94.14% | 93.03% / 93.75% |
| Same function layer + duration-integrated operations and surface selector, offline | 94.29% / 94.78% | 93.51% / 94.27% |

**100% remains unmet. No designated holdout has been parsed or evaluated.** RNBert's pinned training list includes both development works and K457-I. These results diagnose a teacher with training overlap; they do not establish independent generalization or shipped learned inference. The metric compares functional-root pitch class and realized core, not Roman degree, key, spelling, note roles or the composer's intended analysis.

- Supported denominators stay **19,968 / 39,348 ticks at PPQ 48**, or **416 / 819.75 quarters**. Missing predictions, UNKNOWN, model tails and abstentions remain errors. K331 MusicXML measure 98 has inconsistent backup motion: five reference intervals covering 4.25 quarters remain unsupported, without silent repair.
- Derived scores retain 3,160 / 6,151 notes over 416 / 824 quarters, including grace events and final silence. Model admission excludes zero-duration grace notes and verifies remaining pitch/onset/release/track tuples before the teacher's declared quantization, slicing and deduplication. Native observations never become that projection. K332 training quantization moves 54 notes by at most 1/48 quarter.
- Inputs use score timing, supplied meter and source voice routing. Report pitch/time, meter, voice and spelling conditions separately; this is not raw performed-MIDI accuracy. Performance ticks, unfolded divisions and original measure positions remain distinct.
- Function and surface are complete immutable layers, intersected mechanically. Root comes from function; core/color from surface. Native evidence stays with its original root, realization, source window and continuation. It never becomes proof for changed tones. Unknown root does not discard independently known core.
- Freeze predictions before target-label evaluation. Separate candidate containment, selected accuracy, coverage, ambiguity, useful edits and executable cost. A reference-dependent oracle is not a predictor. Works, movements/variation families, editions and augmentations share lineage splits.

The [registry](corpus-candidates.json) pins sources, assignments, licenses and hashes. [Batik](https://github.com/huispaty/batik_plays_mozart) is CC BY-NC-SA 4.0; public-domain compositions do not make acquired files unrestricted. K457-I remains unopened. Git and ignored manifests retain history.

## Constraints that inform the codec

**Use the comparator as a diagnostic, not the product.** Its remaining 66.5 core-error quarters have candidate support, but that does not establish an executable interpretation. Contextual calibration improved training without reliable Mozart transfer; the last 130-parameter model improved three reserved adaptation works but lost 1.125 / 3 joint quarters on K330 / K331. It is rejected. Keep the retained result and strict contract; further calibration is deferred. [Retained evaluation](../../.audit/score/segmental-surface-evaluation.json), [last comparison](../../.audit/score/semantic-context-development-evaluation.json).

**Function, surface and note dependencies have different meanings.** K330 `V(64)` names G while realizing C–E–G. In the fixed K280 contrast, a resolution witness occurs in both ordinary and cadential six-fours. Unordered pitch-class flow cannot identify which event resolves to which anchor. A literal future endpoint can support a dependency without sharing its inferred harmonic parent. Equal rendered cores do not identify a unique program; edit them to distinguish their behavior.

**Motion alone does not establish non-chord status.** K330 q238.5–240 includes a legitimate seventh in stepwise motion. At q14–14.5, spelled D♯ resolves to E over C octaves with G implied; the projected core metric also accepts C–E♭–G. Neither perfect projected agreement nor observed membership recovers spelling, voice, role or structural depth.

**Repeats are evidence, not votes for truth.** Exact disjoint metrical repeats cover 53.5 of the retained 66.5 core-error quarters; only seven have an already-correct selected peer. That is a copying diagnostic, not a bound on posterior pooling. Some exact eight-measure contexts have different annotated cores. Repeated incorrect predictions cannot establish a shared musical interpretation. [Source-only recurrence](../../.audit/score/recurrence-metrical-source.json), [retrospective capacity](../../.audit/score/recurrence-metrical-capacity.json).

**The Dire opening separates invariance from harmonic change.** In the pinned fan MIDI, the first 48 quarters contain six repeated upper six-event rhythms and twelve lower four-quarter support cohorts per doubled part. Lower G/F changes leave the upper pitches unchanged; the E♭ occurrence changes only B to B♭. Extra lower reattacks and simultaneous upper attacks must survive. A chord-root transpose is contradicted by the observations. Event-addressed octave sharing is a candidate, not a uniquely established intention. [Exact source audit](../../.audit/score/docks-opening-source-audit.json).

**Missing evidence must not reset harmonic context.** The rejected root-transition prototype let UNKNOWN provide a cheap route between costly known states. Unsupported observations and latent continuity need separate semantics. Scalar expert mixtures also have measured ranking limits, and additive member potentials cannot represent every whole-core interaction; neither fact justifies another fit without an executable structural test.

## Verified executable boundaries

| Boundary | Verified behavior | Limit |
| --- | --- | --- |
| [Pitch relations](../../crates/muzak-core/src/pitch_relations.rs), [scene controls](../../tests/score-relations.test.ts) | Bounded passing/neighbor proposals, exact reconstruction, ambiguity and track-repartition controls. Source E–F–G/C and B–C–D/G infer paths; changing the first palette to F yields A–B–C versus disabled A–B♭–C. | No general correspondence or domain discovery. Chordal middles and additional release-adjacent links can remain unselected alternatives. |
| [Paired inverse](../../crates/muzak-core/src/paired_pitch.rs) | Same zero-residual expressions reconstruct two supplied realizations and execute a withheld domain edit. Direct-anchor constraints and editable aliases remain explicit. | Supplied correspondence/context; no unique rule. Event endpoints currently require harmonic bindings, excluding future literal-endpoint inference. |
| [Member transforms](../../crates/muzak-core/src/member_transform.rs) | Caller-supplied palettes/lattices and finite contextual/chromatic changes lower to existing bindings, preserving member order, register and edit-distinct programs. Arbitrary periods and complete budgets are tested. | No member-to-event ownership. Standard qualities and twelve-tone projection belong to research callers. |
| [Segmental kernel](../../crates/muzak-core/src/segmental.rs) | Duration-integrated support, full/constrained partitions, four gradients, MAP and core/operation marginals match exhaustive oracles. UNKNOWN, aliases, PPQ invariance and typed/core-only intersections survive. | Candidate preparation and trained models remain offline research. |
| [Event/member inverse gate](../../.audit/score/member-event-inverse-gate-manifest.json) | From eight observed notes plus supplied palette/domain/correspondence, 52 bounded checks recover seven exact programs across literal, direct-member, event-only and shared-parent families. Independent endpoint/parent/domain edits distinguish them; expression and unrelated events survive. | No authored initial bindings, but correspondence/context are supplied. Unknown or wrong links preserve direct alternatives and invent no event address. No selection, compression or automatic ownership claim. |

Lattice paths use explicit event or harmonic-value anchors, rational degree positions and native residuals. Cycles, fractional degrees and off-domain edits fail; no snapping or evidence-ID lookup invents values. Equal sounding pitches never merge independently editable addresses. Every observation is emitted once.

The 128,316-program research catalog uses keep/contextual ±1/chromatic ±1 semitone, at most two changed members, over 36 domains. It retains 15,852 exact ordered mappings and parameter-distinct aliases. Reference-core-supplied parent capacity is 100% of captured training duration, but fixed surface-B support limits joint containment to 30,714 / 31,326 augmented quarters; 966 further supported quarters lack captures. Capacity is not accuracy.

Do not reward syntax duplication. Explicit KEEP/edit/alternate-parent branches preserve identity mass; mapping log-mean-exp stays inside its original group. For local joint-label 0–1 loss, sum group posterior by **joint(root,core)**; report group-MAP separately. Never combine independent root/core winners or imply a label pair identifies one program. UNKNOWN-top is a conservative abstention rule.

The duration model integrates support over quarters; priors/cardinality/cuts apply per segment. Mean occupancy discarded duration; normalized state mass made boundaries topology-only. The fixed fit passes nine musical and five exact/edit program controls. Adding 4,015 augmented quarters of core-only constraints leaves agreement unchanged. Missing supervision is unconstrained, not negative.

Small relational programs exceed literal byte cost. Count all bindings/domains/residuals without double-counting. Exact edits do not prove compression, taste or autonomous interpretation.

## Maintained reproduction

[Source manifest](../../scripts/research/rnbert-sources.json) pins code/checkpoints, MIT declarations, translation and overlap. Torch stays isolated. Explicit quality overrides Roman-rendering defaults; absent secondary-key mode uses the author's declared interpretation. Unsupported retained labels preserve UNKNOWN. Discarded special rows and anonymous auxiliary channels are not decoded evidence.

The retained adaptation freezes the pretrained quality-specific dense/tanh features and fits only a zero-initialized final-map correction. Training: **K280-II, K332-I, K333-I, K283-III**, 2,691 supported quarters, twelve source transpositions, duration-weighted exact-core marginal loss, 200 Adam steps, learning rate .001, summed L2 .01. Degree/inversion/key/function remain fixed. K283 contributes six performed `I(64)` quarters from only two folded neighborhoods; transposition does not add functional contexts. The admitted seven-work pool is not the selected four-work fit.

Packaged teacher targets omit minor sevenths retained by the earlier harmony table; the missing historical converter prevents an annotator-disagreement claim. The readout cannot create missing classes. Capture/prediction read no target references; unchanged controls reproduce prior output.

Use the repository and an isolated Linux/WSL Python 3.12 environment. Setup emits pinned requirements; install the manifest's Torch 2.6.0 CUDA wheel first:

```sh
npx tsx scripts/compare-rnbert.ts --prepare
python scripts/research/rnbert.py setup --device cuda
python -m pip install -r .audit/contextual/rnbert/requirements.txt
python -m pip install --no-deps -e .audit/contextual/rnbert/musicbert_hf
python scripts/research/rnbert.py self-test
cargo build -p muzak-core --example harmony-context
npx tsx scripts/compare-rnbert.ts --prepare-training --profile quality
python scripts/research/rnbert.py capture --admission .audit/contextual/rnbert/training-admission-quality.json --profile training --shifts 0 1 2 3 4 5 6 7 8 9 10 11
python scripts/research/rnbert.py capture --admission .audit/contextual/rnbert/admission.json --profile development
python scripts/research/rnbert.py fit-quality --captures .audit/contextual/rnbert/capture-training/manifest.json --admission .audit/contextual/rnbert/training-admission-quality.json --works kv280_2 kv332_1 kv333_1 kv283_3 --profile quality
python scripts/research/rnbert.py decode --captures .audit/contextual/rnbert/capture-development/manifest.json --model .audit/contextual/rnbert/readout-quality/manifest.json --profile quality
npx tsx scripts/compare-rnbert.ts --evaluate --profile quality-original --surface-profile quality-quality --context target/debug/examples/harmony-context.exe --context-options scripts/research/rnbert-context.json --hold-silent-gaps --function-spans
```

Use the platform suffix and fresh profiles for changed inputs. Manifests bind edition/events, frames, runtime and readouts; incompatible inputs reject. The evaluator checks identity/PPQ/hashes before context/references. Pure [readout](../../scripts/research/rnbert_readout.py) and [decoder](../../scripts/research/rnbert_decode.py) controls need no corpus/model downloads.

Silent-gap hold extends only verified pitched silence and recomputes context. Function spans require original numeric inversion and exact source witnesses, preserve native proofs, and add .75 K331 quarter. Omitting `--function-spans` retains the separate 93.03% / 93.66% control. Lowest-window bass and implied resolution are comparator conditions, not shipped-default changes.

Build the native operation bridge with `cargo build -p muzak-core --example segmental-inference`. Pure [segmental_fit.py](../../scripts/research/segmental_fit.py) and [surface_fit.py](../../scripts/research/surface_fit.py) contain calibration math without a second musical scorer. The **93.51% / 94.27%** selector remains a frozen offline pipeline, not the CLI result above. Its [evaluation](../../.audit/score/segmental-surface-evaluation.json), SHA-256 `5068099c3c8393bdb63169d8aa6bfe10782472301eb38ea095a4f57d60f41762`, pins the full chain. Historical validations are not tests rerun by this document edit.

## Primary research and limits

| Primary source | Consequence for this work |
| --- | --- |
| [DCML changes](https://dcmlab.github.io/standards/build/html/reference/reference.html#suspensions-and-retardations), [detail levels](https://dcmlab.github.io/standards/build/html/tutorial/detail.html), [Mozart corpus](https://doi.org/10.5334/tismir.63) | Replacements differ from inversion; coherent layers can imply absent tones. Consensus labels are a target, not unique inverse truth. |
| [Rohrmeier](https://musicweb.ucsd.edu/~sdubnov/Mu270d/Harmony/Rohrmeier2011.pdf), [Caplin](https://williamcaplin.com/download/caplin-classical-cadence.pdf) | Harmonic derivation/counterpoint and cadential content/formal closure differ. No universal six-four or top-voice rule follows. |
| [Semi-CRF harmony](https://arxiv.org/abs/1810.10002), [ChordGNN](https://arxiv.org/abs/2307.03544), [Cluster and Separate](https://arxiv.org/abs/2407.21030) | Segment/transition and successor evidence retain context. Engraving groups are not harmonic function; quantized observations are not the exact source. |
| [Proto-voices](https://archives.ismir.net/ismir2021/paper/000023.pdf), [code](https://github.com/DCMLab/protovoices-haskell) | Shared/two-anchor elaboration and spreading are relevant; combinatorial inverse derivations require bounded proposals. |
| [RNBert](https://github.com/malcolmsailor/musicbert_hf), [AnalysisGNN](https://arxiv.org/abs/2509.06654) | Useful contextual priors, not complete codecs. AnalysisGNN's notation-tier root result is 88.23% / 90.65%, below the retained layer; dictionary drift, weight-license uncertainty and an untrained pitch-set head prevent adoption. No inspected checkpoint is clean on these Mozart works. |
| [Uehara & Tojo](https://www.apsipa.org/proceedings/2025/papers/APSIPA2025_P319.pdf) | Harmony-derived chord/non-chord labels are not independent ornament truth. Non-chord F1 falls from 87.04% chorales to 66.13% WTC. |
| [Decomposer](https://arxiv.org/abs/2607.01849), [BACHI](https://arxiv.org/abs/2510.06528) | Program supervision and explicit boundaries are useful ideas. Inspected serialization/label/timing projections violate this exact target; neither replaces the codec. |

[TAVERN](https://github.com/jcdevaney/TAVERN) and [CASD](https://github.com/chordify/CASD) retain multiple readings; parts and harmony-derived roles are not independent ornament labels. Preserve registry JKUPDD/MTC splits and edition/work lineages. Phrase work needs independent [repetition](https://brianmcfee.net/papers/ismir2014_spectral.pdf) and [hierarchical evaluation](https://brianmcfee.net/papers/frontiers2017_evaluating.pdf).

## Next decisive work

1. Keep generation, audition, structural editing and MIDI export usable. The authored generator and inverse codec share one Rust compiler; sequential edits preserve the program and immutable source.
2. Recover a complete Dire passage as shared rhythm, melody relationships and independently varying harmony. Jointly compare candidate boundaries and bindings; preserve doubled emissions, reattacks, conflicting evidence and editable alternatives.
3. Demonstrate a meaningful structural edit against independent expectations, including an unrelated-voice negative control and a literal reconstruction ablation. Show the parameters and resulting note changes in the existing timeline.
4. Assess musical listening, complete program/residual cost and transfer separately. Use Mozart labels when a structural change needs that diagnostic, not as an indefinite substitute for good composition.
