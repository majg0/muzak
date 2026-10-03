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

## Current causal diagnosis

**Selection, not vocabulary, limits the retained surface predictor.** Its 23.75 / 42.75 quarters of core error are all expressible by existing surface or operation candidates. On those 66.5 quarters, the relation marginal puts truth among its maxima on 31.25 quarters, uniquely first on 27.25; the mixture does so on only 2.67. Temporal decoding loses 2.625 of those quarters and frame averaging .0417. Another candidate or decoder sweep does not address arbitration. Seventeen error quarters require reference members absent throughout the annotated span. See [capacity](../../.audit/score/segmental-remaining-gap-capacity.json), [ranking](../../.audit/score/segmental-remaining-gap-ranking.json) and [retained evaluation](../../.audit/score/segmental-surface-evaluation.json).

**Function is not the surface triad's root.** K330 q12–13 `V(64)` names G while realizing C–E–G. All 20.75 functional-root error quarters admit the reference root in teacher candidates, but a correction to its surface-root prior strongly penalizes the desired underlying parent. That root fit failed the fixed training contrast and was rejected before development evaluation. Preserve teacher realization evidence while considering executable parents; do not multiply a transformed parent by its tiny probability as a sounding chord.

**The fixed K280-II contrast requires more than a resolution witness.** Ordinary `I64` at q24–25.5 and cadential `V(64)` at q33–34.5 share the relevant bass, key, surface and next-harmony cues; both satisfy the native resolution witness. Upper A♭ moves to B♭ in the ordinary passage and G in the cadence, while lower accompaniment agrees with restoration in both. Both destinations can belong to the E♭ parent, so unordered pitch-set flow loses the distinction. Exact event addresses, register, duration, preparation and contrary evidence matter; no highest-voice or universal six-four rule follows.

**Stop the two-feature restoration branch.** Corrected branch priors, temporal persistence, mapping-aware direction and predictor-KL regularization still fail this contrast. The final fit scopes direction to the immutable native root/core/window/continuation witness, with no intercept, and reaches **85.94% captured training joint-pair agreement**. It still calls the cadence tonic and was not evaluated on development. Compatible/contrary coefficients are **+.728 / +1.057**: mainly correspondence coverage, preferring contrary motion at equal exposure. Rewriting these as total exposure and directional contrast is an invertible coordinate change, not a fix. Do not change signs or sweep coefficients post hoc. [Frozen result](../../.audit/score/member-resolution-context-training-evaluate.json).

The missing representation is event ownership. Residue matches do not establish which observation instantiates a member, which later event restores it, or whether both share a parent parameter. Geometric successors are hypotheses, not true voices; missing links are unknown rather than contrary. A literal endpoint can support a dependency without belonging to a palette. Root/core supervision permits several incompatible causal parses.

Joint functional-root transitions plus a once-per-run initial factor recover both fixed interpretations under temporal MAP, but remain a weak overall predictor: **71.92% joint agreement on all 252 K280-II quarters**, including 16 uncaptured quarters as errors. The initial factor learns from 97 source-eligible starts in the same four original training works, conditioned on predicted key, with fixed Dirichlet1 and `log(12*p)`; uniform/missing context stays neutral. Marginal decisions still fail the contrast. This proves a narrow contextual capability, not grounds to replace the retained predictor. Rest is evidence, not a phrase label. [Strict comparison](../../.audit/score/root-initial-evaluate.json).

Stop extending this sequence branch until unsupported observations and latent continuity are separated. Its UNKNOWN state can bypass the learned transition cost: a 1/16-quarter frame with only 1% local UNKNOWN mass makes a two-step UNKNOWN bridge beat a direct change by 1.063 log units. This is a model flaw, not a posterior implementation bug; do not tune the frozen UNKNOWN penalty to hide it. The fixed-lattice conditional model is not a normalized continuous-time process.

**A contextual scalar gate also fails to improve development agreement.** Adding 1,024 frozen quality features to the accepted selector logit lowers training core NLL from .53391 to .48585, but loses .25 K330 joint/core quarter and .5 K331 core quarter, with K331 joint unchanged. The prescribed legitimate-seventh reading survives; the implied/replaced-member reading remains wrong. The single 100-iteration fit takes 9.21 seconds and does not reach its gradient tolerance. All source/target replay, zero-correction predictions, function proofs and denominators remain exact. Its full-core generalized-KL prior covers all 32,364 augmented source quarters, retaining UNKNOWN and native mass roundoff. Reject this replacement; another scalar-gate fit is not justified. [Strict comparison](../../.audit/score/segmental-context-evaluation.json), [musical intervals](../../.audit/score/segmental-context-controls.json).

The scalar form has a measured hard limit. Exact rational intersections of every competitor inequality show that even an oracle per-cell mixture weight can make the reference uniquely first on only **33.8125 of the 66.5 error quarters**. Another 31.6875 quarters have contradictory inequalities and one quarter permits ties only, despite every target being present in B/R support. This is local decision capacity, not a predictor or a bound on temporal decoding. [Capacity audit](../../.audit/score/segmental-scalar-capacity.json).

**Raw contextual candidate scoring fails transfer.** A 1,024×13 member potential lowers training NLL to .12808 and raises source-cell training core accuracy from 85.72% to 93.24%, but gains only 2.125 K330 joint quarters while losing 10.5 on K331. On the three reserved adaptation works K279-I/K282-I/K284-I it lowers source-cell core accuracy from 80.41% to 78.77%, with regressions on every work. Reject it without choosing a different model per work. K331 harms include deleting a sounding seventh and overriding correct relation evidence with a different triad. Candidate support and source alignment remain intact. [Strict comparison](../../.audit/score/candidate-context-evaluation.json), [adaptation validation](../../.audit/score/candidate-context-validation-diagnostic.json), [error mechanism](../../.audit/score/candidate-context-regressions-summary.json).

**Semantic coordinates improve adaptation validation.** Project frozen quality features onto all ten contrast directions of the original quality head, then learn 10×13 interval coefficients. Average each interval potential over the **original predicted realized-root distribution**, preserving its UNKNOWN mass; do not use a functional root or a modal/oracle root. This is an expected log potential, not latent-root marginal inference. A fully unknown root contributes no correction. The frozen basis and root features use no labels. One 45-second fit lowers training NLL to .43147; its final gradient is 1.99×10⁻⁷ against a 10⁻⁷ target. Reserved K279-I/K282-I/K284-I source-cell core accuracy improves on every work, jointly **80.41% → 80.86%** (+6.8125 quarters over all 1,540). No Mozart result is implied. These works are absent from the four-work adaptation fit, but teacher-pretraining overlap remains. [Validation](../../.audit/score/semantic-context-validation-diagnostic.json).

Other required counterexamples remain: K330 q238.5–240 D–C–D motion includes a legitimate chordal seventh, so automatic stepwise-tone demotion destroys correct readings. At q14–14.5, `I(#2)` has spelled D♯ resolving to E over C octaves, with G implied; the metric also accepts C–E♭–G. Neither observed membership nor perfect projected agreement proves spelling or role. Exact repeated-neighborhood voting also loses a correct minor seventh when correlated teacher omissions outvote it.

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

1. **Retain the passed inverse dependency gate.** Extend only when new examples require it: exact member proposals already recover direct, event-only and shared-parent alternatives from observations and supplied contexts/correspondence. Preserve all editable aliases, literal residuals and whole-call budgets; use the existing compiler.
2. **Evaluate the frozen semantic scorer on Mozart.** Its 130 coefficients improve all three adaptation-validation works; mathematical, zero-replay and source-support controls pass. Preserve the accepted distribution, strict denominators, decoder and function proofs. Keep the independent seventh and implied-member intervals explicit. Additive member potentials still cannot express every whole-core preference: `φ(M)+φ(m7)=φ(m)+φ(Mm7)` forces an unchanged four-class odds ratio. Generic interval-pair interactions break that limitation without inventing an operation label; they are a capacity finding, not a fitted improvement.
3. **Then test ownership/context together.** Independent endpoint/parent/domain edits and ordinary-I64/V(64), genuine-seventh, implied-member, contrary-motion and crossing/unison controls must separate proposal recall from selection. Keep supplied correspondence distinct from inferred geometry, preserve expression/unrelated events and retain executable-family ambiguity. Authoritative edited programs survive reanalysis.
4. **Keep the accepted predictor.** No further two-feature/sign/prior sweep is justified. Freeze replacements before development comparison and lineage holdout evaluation. Assess complete cost, useful local/shared edits and listening separately; Mozart agreement is neither taste nor the only route to richer Nintendo, jazz or progressive composition.
