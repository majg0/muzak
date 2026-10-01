# Validation record

## Version 20.0 consolidated composition and vocabulary coverage — 2026-10-01

The production vocabulary now uses one evaluated planning abstraction for
source selection, gestures, harmonic routes, counterpoint and ornaments.
Every tool owns an opportunity in its scoped cycle. A base-N digit-sum phase
rotates enclosing cycles too, preventing periodic entrances from aliasing a
fixed subset. Hard feasibility and an explicit maximum increase over the best
musical cost bound every choice. Diagnostics distinguish focus, eligibility,
actual use and deferral. Harmonic cadence contexts and contrapuntal voices
count committed opportunities; repeated inspection does not spend them.

Medium-density development visits inherited replies over successive thoughts.
The source head, prepared destinations, literal recall and native pitch grids
remain protected. Equivalent gesture candidates are deduplicated using their
realized notes. Identity operations and canceled chains do not earn tool
coverage. Uniform duration scaling is available in source time allocation;
fixed-span realization evaluates proportional rhythm without claiming an
inaudible uniform scale.

Harmonic relations and cadence suffixes share native builders. A short
three-window argument can now realize V/V–V–I. Dominant/diminished obligations
must resolve before a language change. Search rejects unsafe clocks and more
than 128 windows before allocation. Contrary counterpoint evaluates actual
opposite motion while fidelity protects the transformed subject's intervals.

Removed the disconnected hook, solo, pitch-selection, motif-memory and
alternate phrase-generation modules and their obsolete-only tests. Shared
periodic-field lookup also fixes next-octave ornament degree labeling. Rhythm
and accompaniment convenience entry points adapt to the production score
instead of retaining alternate catalogues of finished patterns.

Version 20 intentionally changes generated events. The UI archives version 19
recipes before reinterpretation. Pinning follows behavioral verification;
old hashes remain historical version 19 evidence below.

Ornament alternatives are complete figures evaluated before selection. A
candidate must fit its available time, native register and remaining attack
budget; figures are no longer amputated to fit. Explicit slides require an
actual pitch ramp. Native feasibility compares integer millicents, accepting
the same rounded 19/31-EDO source tones used by playback. Returned harmonic
diagnostics are independent copies of the committed route.

Final verification:

- `test-v20-final.log`: **501/501 tests pass**, zero skips; 16.93 seconds.
- `build-v20.log`: TypeScript and Vite production build pass.
- `conformance-v20-final.json` and `browser-conformance-v20.json`: all 16
  reviewed version 20 fixtures agree between Node and the browser.
- `tool-coverage-v20-final.json`: 19 cases, 5120 frames and 814 complete thoughts;
  zero timing, native-grid, provenance or invalid-slide violations. The
  representative 1280-frame composition has 236 complete thoughts and reaches
  all 10 gesture operations through performed transformations and selected
  source lineage, all 10 harmonic techniques, and 141 actual entries of each
  contrapuntal relationship. Across the eligible delivery contexts, all 12
  ornament kinds sound: 648 observed figures, including 17 real slides;
  two incomplete observed groups are excluded. Source lineage and current
  transformations are reported separately. `npm run audit:tools` reproduces
  this audit and exits unsuccessfully for invalid events or provenance.
- `integrated-v20-final.log` / `integrated-composition-audit.json`: six seeded
  singing/exploration narratives retain exact replay and protected destinations.
- `range-v20-final.log` / `range-audit.json`: all 10 checks pass, spanning one
  to 12 simultaneous pitched voices and all six opening kinds. Sparse lead
  rates are 0.463636–0.691489 attacks/quarter; dense rates 2.027778–2.578014.
- `browser-range-v20.json`: all 9 browser audio checks pass. Four matched
  passages have zero clipped/nonfinite samples; peaks 0.0255767–0.1395512.
  Changing ensemble size preserves each foreground exactly. The audio page
  has four rendered audition players; `v20-auditions.png` records the result.
- `examples-v20.log`: refreshed recipes and 16-bar MIDI, 3847 bytes/398 notes,
  event hash `e4d976a2`.

The cleanup separately preserved 432 supplied-score accompaniment events
across native tunings, additive holds and glides. Tests for removed unreachable
generators were retired; live score, budget, replay and native-grid contracts
remain covered. Registered or merely proposed tools do not count as heard.
Tools can remain deferred under restrictive parameters, protected musical
contexts or short horizons. These finite audits establish reachability and
mechanical coherence, not an aesthetic verdict.

## Version 19.0 concise ideas and shared gesture tools — 2026-10-01

Source invention and continuation now use the same composable gesture algebra.
Ten operations cover sequence, inversion, retrograde, fragments, interval and
time scaling, extension, scalar connection, arpeggiation and pedal. Feasible
whole gestures are evaluated for identity, continuity, direction, register,
accent, departure, duration and unsupported repetition. Duration operations
affect source spans; selected rhythm weights place occurrence anchors. The
event diagnostics retain operations, objective costs and actual anchor notes.

The old dense compiler cycled a short contour under a goal envelope. The new
compiler transforms each selected gesture once, then refines its intervals
monotonically. Unsupported repeated pitches become holds. Default heads have
at most one direction reversal; deliberate later transformations and ornaments
retain their broader vocabulary. A source has four or five clauses, but a
sparse thought activates only the head and destination. Ordinary thoughts
target eight to sixteen quarter pulses, with explicitly eligible rare extensions.
These are compositional budgets, not experimentally established memory limits.

`theme-clarity-v19.json` records six seeds across three densities, all using
the same fixed 32-quarter-note occurrence for comparison. Dense direction
reversals fell from the inspected v18 baseline of 299 to **29** (90.3%). Heads
occupy two to four quarter pulses. Ordinary performed developing-solo thoughts
average 8.375–14.375 quarter pulses across this cohort. Refined notes never add
turns beyond the chosen skeleton. After a rejected intermediate implementation
still created 86% adjacent pitch repetitions, explicit repetition ownership and
coalescing reduced that measure to 26%; remaining repeats are source anchors
or declared pedals. These event measurements do not rate perceptual quality.

Shorter thoughts exposed two real timing faults: ornamental opportunities were
starved by a coarser minimum subdivision, and backing held pitches across the
next thought's harmonic boundary. Ornament delivery now admits integral finer
subdivisions that fit its actual gap. Backing attacks and tails follow the
frozen thought origin and endpoint. Structural anchors remain protected.

Some old tests required a long sparse thought, many automatically repeated
phrases, a step of one in every theme, or alternating source contours. Those
requirements conflicted with concise ideas. Tests now inspect active source
membership, complete fingerprints, actual transformed anchors, directed
refinement and cohort vocabulary. The density audition still requires a real
solo and a twelve-player ensemble with unchanged foreground when player count
changes. Its concise sparse threshold is below 0.75 attacks/quarter, and dense
contrast must exceed 3× and 1.5 attacks/quarter, replacing the old below-0.5/5×
requirement tied to long sparse residence. Fast-argument checks use the ordinary
16-quarter horizon and also check a held arrival; flat subjects cannot pass by
manufacturing unowned repeated attacks.

The version changes because these intentional choices change committed events.
Version-18 recipes are archived before reinterpretation; updated fixtures and
examples describe version 19. Legacy compatibility generators are not revived:
the shared melodic vocabulary, harmonic routes, counterpoint, delivery and
orchestration keep their respective responsibilities in the production pipeline.

Final verification on Node 24.14.0 / Windows x64:

- **498/498 tests pass**, no skips (`test-v19-final.log`), including clustered
  onset quantization, long supplied heads, truthful rhythm provenance and
  large available palettes with small active subsets.
- TypeScript and the Vite production build pass (`build-v19.log`).
- All **16 reviewed fixtures match in Node and the browser**
  (`conformance-v19-final.json`, `browser-conformance-v19.json`).
- The integrated six-narrative audit passes with exact replay and every
  declared harmonic destination realized (`integrated-v19.log`).
- The complete range audit passes all ten checks (`range-v19-final.log`,
  `range-audit.json`): sparse lead rates 0.439–0.663 attacks/quarter,
  dense rates 1.980–2.404, and one to twelve simultaneous pitched players.
- Importable examples and the sixteen-bar MIDI were regenerated
  (`examples-v19.log`).

The browser rendered four matched ten-quarter passages at 88 BPM through the
production instrument rack (`browser-range-v19.json`). All nine checks pass,
including zero nonfinite samples, zero clipped samples, matching foreground
across ensemble sizes, and genuine one-voice/twelve-player readings. Spacious
and dense leads measure 0.6/2.5 attacks per quarter. The four audio players
remain available in the audio laboratory; `v19-auditions.png` records them.

Short-horizon harmonic checks also exposed a dormant color path: balanced
thoughts with one to three harmonic windows formerly consumed every window in
opening/cadence rules. They now evaluate functional, common-tone and third-region
alternatives against actual melody fit and the declared preferences. Three-window
routes can retain a complete prepared cadence after a colored opening. Native
replay tests verify every heard source degree and actual planned sonority rather
than requiring an arbitrary quota of ten degrees or eight different chords in
one excerpt. Physical voice ranges, native grids, root movement and sensory
scoring remain checked. The latter measures all five voices, including bass.

The final source review additionally found and fixed colliding rounded head
onsets, insufficient allocation for long supplied heads, and diagnostics that
credited an incompatible shared rhythm. No claim of subjective listening quality
or stylistic imitation follows from these engineering checks.

## Version 18.0 scoped ideas and evaluated orchestration — 2026-10-01

The engine now composes with validated reusable idea sets and DAG scopes,
including shared ancestors and isolated imports. Production thematic arguments
resolve those sets; continuous formal spectra inherit a piece identity and
progressively smaller contributions. Strategy labels describe the field instead
of selecting canned alternation patterns. Source repertoires contain three to
seven themes. Rational rhythmic depth drives exponentially weighted subdivision
choices, with stable landmarks and protected held goals.

Counterpoint evaluates complete source gestures for identity, continuity,
independence, consonance and register, publishing the committed objective values.
Native pitch and overlapping glide trajectories participate in evaluation.
Declarative player policies replace orchestral branches. The shared sounding
score tracks foreground and backing through replacements and scoped rests,
preserves clipped glide clocks, and protects its retained state from caller
mutation.

Verification on Node 24.14.0 / Windows x64:

- Original baseline: **433/433 tests passed** before changes.
- Final suite: **465/465 tests passed**, no skips (`test-v18-final.log`).
- TypeScript and Vite production build passed (`build-v18.log`).
- All **16 pinned version-18 event fixtures match in Node and the browser**
  (`browser-conformance-v18.json`). The version changed deliberately; old
  recipes are preserved for reinterpretation and do not claim old event replay.
- Six integrated singing/exploration narratives across three seeds replayed
  exactly and realized every declared harmonic destination. The integrated
  audit passed (`integrated-composition-audit.json`, `integrated-v18.log`).
  It now checks bounded, moving expression in each narrative and broad contrast
  across the cohort separately; its former mandatory 0.5 intensity span in every
  first journey incorrectly required a climax even in an intentionally quieter
  opening. The revised minimum per-journey span is 0.2; cohort availability is
  greater than 0.7. These are engineering checks, not aesthetic scores.
- Importable examples and the sixteen-bar baseline MIDI were regenerated for
  version 18 (`examples-v18.log`).

Browser production synthesis was rendered through the existing audio laboratory:

| Controlled reading | Lead attacks/beat | Maximum simultaneous pitched voices | Peak | RMS |
| --- | ---: | ---: | ---: | ---: |
| Spacious solo | 0.45 | 1 | 0.0485251 | 0.0227776 |
| Dense solo | 3.925 | 1 | 0.0248752 | 0.0107446 |
| Spacious ensemble | 0.45 | 12 | 0.1530913 | 0.0355905 |
| Dense ensemble | 3.925 | 12 | 0.1316355 | 0.0292455 |

All four readings use the same seed, 88 BPM and forty-quarter-note interval.
Every render had **zero clipped and zero nonfinite samples**. Changing only
ensemble size preserved the complete foreground fingerprint. The full JSON
record is `browser-range-v18.json`; the four listening players were left open.

The complete first Wide narrative for `glass-garden` also supplied separate
calm, rise, crest and retreat excerpts, plus a controlled fixed-envelope
reference (`browser-expression-v18.json`). All ten checks passed, including
genuine directional changes, audible held dynamics, finite unclipped signals,
and identical non-envelope events in the control. Calm/crest RMS measured
0.00802122/0.03491928. The joint excerpt selector avoids consuming a sole
rise/retreat with a greedily selected crest/calm window.

An intermediate parallel suite exposed one wall-clock-sensitive audio timing
failure; the unchanged audio suite passed independently, and the final complete
run passed. None of these measurements constitutes subjective listening or
certifies imitation of the named composers. The orchestra remains synthesized,
and native fields, semantic boundary conditions and search budgets are explicit
constraints. Custom source scopes and player policies are library abstractions;
there is no new visual graph editor or serialized custom-orchestra format.

## Version 17.0 generated idea hierarchy — 2026-10-01

The production source, melody and fill paths now generate relationships instead
of choosing complete templates. `idea-kernel.ts` supplies integer grouping,
metrical strength and bounded refinement between written targets. A generated
hook and destination graph feed one occurrence compiler across density levels.
The identifying opening remains recognizable while ordinary developments can
change continuation order, goal, interval width, duration emphasis and detail.
Explicit fixed-melody and sequence treatments retain their contractual identity.

All **433 tests pass**, along with TypeScript and the production build. All
**16 reviewed Node/browser event fixtures match**. The engine and examples are
versioned `continuum-17.0.0`; earlier recipes are archived before reinterpretation.
Baseline MIDI still exports; native/gliding scores retain exact JSON and WAV
without silently rounding their pitches.

The final four-seed exploration cohort covers 384 committed frames per seed,
with fixed bass mobility/independence .85 and tuning journeys enabled. Complete
JSON-reconstructed frames replay exactly. It contains **71 complete thoughts**,
**178 pairs of recurring sources and zero identical whole-thought copies**.
This does not mean every note is new: the opening fingerprint is deliberately
retained. The independent same-span recurrence test checks 32 seeds × 8 returns
under ordinary defaults, while separate tests verify literal fixed modes.

In the actual emitted score, **1,171 of 1,887 bass attacks use non-root pitch
classes**, with native chord membership, physical bass range and upper-voice
separation covered independently. Structural melody attacks align to an eighth
note at rates of 71.5–80.1% across these contrasting exploration recipes. There
are **48 interior foreground glides** across the cohort, under the existing
Tuning journeys & glides control. Head anchors remain literal. There are three
meter changes across 74 observed sections; meter changes are source transfers,
not an obligation to visit a fixed inventory. A larger conductor audit measured
1,237 changes across 12,240 boundaries, with residences at least four sections.

Generated fill tests inspect actual timing/instrument fingerprints over 24
sources, retained goals, later subdivision buildup, breaths and coordinated
arrivals. Full production tests verify moving bass and surviving reference-drum
strikes in all four tunings. They also preserve the final single application of
shared orchestral gain, including late fills during retreats.

The final compiler stress run covers **1,440 arguments / 70,688 notes** across
12-, 19-, 24- and 31-tone grids, compact and long spans, three density levels,
and open/closed destinations. There are no invalid durations, pitch-range
violations or edges larger than an octave. 5,100 of 5,112 head attacks align to
120 ticks; the exceptions are compressed minimum-length handoffs. A separate
review adds 2,240 compact-plan probes, including extreme open destinations,
without infeasible searches or notes outside the argument.

The browser's finalized melodic audit renders the full opening argument and
isolated foreground. Its full-mix peak is **0.1018**, with no nonfinite or clipped
samples. Native19 ordinary legato reaches the written target immediately; the
explicit glide retains measured motion and arrival. These are waveform and
event measurements, not a subjective listening verdict or an artist-resemblance
claim. The audio players remain available for listening comparisons.

A **35-second live 31-EDO ensemble run** completed using the forced
Firefox-compatible envelope fallback: 26 generated/heard frames, at most 32
notes per frame, 61 simultaneous sources, **zero underruns or late note tasks**.
Maximum measured planning was 21.1ms and scheduling 4.1ms against the 400ms
look-ahead. No audio errors or nonfinite/clipped signal samples were reported.
The check exercises the compatibility path in the in-app Chromium browser;
it is not a claim of testing the user's main Firefox profile directly.

The idea panel uses actual compiler ancestry, phrase applications, interval/rhythm
fingerprints and held destinations. It highlights the current motif and shows
the notated grouping alongside independent reference/hook clocks. Beat markers
wrap across bar boundaries even when a bar straddles two transport commits.
The scored-part indicators clip replaced monophonic tails. Play, continued bar
advance, immediate Next section, and Pause were exercised in the browser.

Evidence: `.audit/idea-hierarchy-v17.json`, `.audit/test-v17-final.log`,
`.audit/conformance-v17.json`, `.audit/browser-conformance-v17.json`, and
`.audit/browser-melodic-intent-v17.json`, and `.audit/live-native-v17.json`.
Explicit native fields, four source
families, finite spectra, finite search budgets and standalone compatibility
adapters remain; this refactor does not claim unlimited musical invention.

## Version 16.0 intentional intervals and flexible form — 2026-10-01

The previous source grammar confined identifying heads to a narrow register and
many continuations to one or two scale degrees. Version16 composes whole interval
gestures, including held field landings, echoes, registral answers and recoveries.
The native performed-line cohort covers thirds through octaves, not just source
metadata. Complexity/familiarity comparisons retain identifying heads while
changing continuation breadth. Full-source register placement preserves every
anchor; an out-of-range ornament is rejected before shortening its owner's gate.
Woodwind doubling now chooses one register for a complete argument. Per-note
octave folding previously could invert an octave leap and make the combined
foreground/double sound stationary. A double that cannot fit the full argument
is omitted; the primary tune is preserved.

All **417 tests pass**, along with TypeScript and the production build. All
**16 reviewed event fixtures match in Node and the in-app browser**. The browser
verification yields every eight generated frames to keep the page responsive.
A production review of 36 recipes found no missing, changed or clipped notes
among 1,968 primary head anchors. Comparing embellishment off/on for 1,152
native thought cases found zero protected identity changes or range violations.
Examples were regenerated for `continuum-16.0.0`. Older recipes remain available
before migration; this changed composer does not reproduce old engine hashes.

The nine-case comparison uses the same three seeds, three study recipes and first
128 committed frames in `.audit/melodic-intent-before-v16.json` and
`.audit/melodic-intent-after-v16.json`. Foreground voice5 is measured separately
from harmony voice3. Intervals above 500c increase from **24/3,527 (0.68%)** to
**150/2,127 (7.05%)**. Median note duration increases in eight cases and remains
unchanged in one; the result does not force large jumps into every tune. These
are equal input/time-window comparisons, not identical passage A/Bs: new form
and thought allocation also change the number and context of attacks. Both
captures verify that their source files stayed unchanged during generation.

Fixed route templates have been replaced with heard-idea lifecycle choices.
Episode budgets and complete-argument allocation vary independently of the old
four/eight/sixteen-bar grids. Fixed-melody repeats still preserve their source;
declarative endings can leave a thought open. The horizon audit covers 48 seeds
and 2,688 sections: **24/2,640 later boundaries are declared cuts (0.91%)**,
1,163 sections prepare a later destination, and the largest sampled non-cut
quarter-note expression change is 0.170. Flowing boundary discontinuity is below
3.63e-7. Home 12-TET time is 59.79%, native 19-EDO 28.70%, 24-EDO 7.47%, 31-EDO 4.04%.
These bounds describe autonomous expression; explicit automation remains final.

The new browser melodic-intent audit renders a complete opening thought as full
mix and isolated foreground, then tests ordinary native19-EDO legato separately
from a written glide. The first 4–27ms after a 681.674Hz target measures 681Hz
(−1.71c), confirming that an ordinary connection no longer silently slides for
24 ticks. The explicit glide's sampled midpoint/arrival errors are 4.46c/0.83c.
Finite-signal and unclipped checks pass. The waveform measurements and symbolic
cohorts test capability and correctness; no subjective listening verdict or
artist resemblance is claimed. Use the lab's audio players to judge phrasing.

A **35-second live 31-EDO ensemble run** passed with the Firefox-compatible
envelope fallback forced on. It selected an observed dense window (10.44 attacks
per beat across the orchestra), reconstructed its lead-in, and planned fresh
frames during playback. Maximum sampled planning time was **9.4ms**, scheduling
2.3ms, with **zero underruns, late note tasks or console errors**. Peak source
count was87. These are JavaScript scheduling measurements, not a hardware-loopback
claim about every possible device glitch. Main-app Play, Next section into5/4,
continued playback and Pause also passed. Reports are in
`.audit/browser-conformance-v16.json`, `.audit/browser-melodic-intent-v16.json`
and `.audit/live-native-v16.json`.

## Version 15.0 melodic development, independent pulse and native journeys — 2026-10-01

The source grammar now supports six contour families. Fast arguments combine
seven related clause operations and several rhythmic families; quotation is
optional and need not occur immediately before an ending. An open handoff is
composed toward its destination throughout the closing phrase. It is not a tonic
approach with its last note changed. Production ornament delivery now admits
eligible held bodies without filling written breaths or altering protected heads,
apices and cadence notes. The independent counterline preserves negative source
degrees' octave relationships.

All **398 tests pass**; TypeScript and the production build pass. Tests cover
source shapes and actual notes, optional recalls, held/burst rhythms, fixed-melody
equality, production ornaments, stable pulse phase, native pitch constraints,
serialized replay, automation, MIDI and transport. All **sixteen reviewed event
fixtures match in Node and the in-app browser**, including ensemble and additive
24/31-EDO. This deliberate engine-version change does not promise old generator
hashes; original older recipes remain available before reinterpretation.

`scripts/audit-horizons.ts` samples 48 seeds and 2,688 sections at full Freedom.
Of 2,640 later boundaries, 30 are declared cuts (**1.14%**). 1,239 sections prepare
a later destination. With 12-TET home and tuning travel enabled, time shares are
63.46% home, **25.77% 19-EDO**, 7.07% 24-EDO and 3.70% 31-EDO. A native visit lasts
three or four contiguous sections. The largest sampled quarter-note change in
energy, intensity, activity, register, idea density or ensemble size is .1962;
flowing boundary discrepancy is below .000001. These describe generated
intentions, not measured perceptual tension. Explicit automation may override
their smoothness. See `horizon-audit.json`.

Native continuation search uses the selected grid, explicit native collections,
and physical pitch/range constraints. Standalone smooth continuation moves at
most 189.474/200/193.548 cents in 19/24/31-EDO respectively. Semantic harmonic
destinations can admit a separately measured nearest-feasible larger placement.
Tests also cover every native root, all eight lookahead steps and 1,740
cross-tuning boundary-register projections. `scripts/audit-native-planner.ts`
measures 64 frames per mode and grid, excluding eight warmup frames. With spectral
roughness off/on, free-continuation p95 stays below **4.7 ms** and warm maximum
below **5.15 ms**; destination/hold p95 stays below 1.64 ms. This excludes phrase
planning, synthesis and browser contention. See `native-planner-audit.json`.

The browser's **Render composition studies** uses the same seed `glass-garden`
and 88 BPM for six distinct editable recipes. Ten production Web Audio renders
provide six full mixes and four isolated leads. The selected first arguments are
complete 32–48-beat windows; no favorable later peak replaces the opening.
All ten replay/native-grid/signal checks pass. First-window lead measurements:

| Study | Beats | Attacks | Median onset gap | Range, MIDI equivalent | Full-mix peak | Musical RMS |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Floating lines / 19 | 48 | 10 | 3.5 beats | 65.84–70.89 | .11502 | .02943 |
| Developing solo / 12 | 32 | 18 | 1.5 beats | 66–78 | .09502 | .02586 |
| Interlocking drive / 12 | 32 | 57 | .5 beats | 66–83 | .10499 | .02385 |
| Travelling theme / 12 | 48 | 10 | 3.5 beats | 66–71 | .10717 | .02677 |
| Quarter-tone prism / 24 | 32 | 16 | 1.75 beats | 66–78 | .09815 | .02485 |
| Fine gravity / 31 | 48 | 10 | 3.5 beats | 65.90–70.94 | .11597 | .02930 |

The separate first-four-argument cohort reports five real ornaments in Developing
solo (lower mordent and turn), and zero in the other five selected cohorts. Quiet
windows are not forced to decorate to satisfy a style label. Broader production
tests exercise ornaments across seeds and all tunings. All PCM is finite and
unclipped. These recipes differ in several intentional parameters, so this is a
capability comparison, not a controlled one-variable experiment. Full evidence:
`capability-audit-v15.json`.

Native playback FFT checks measure 818.06834 Hz against 818.07901 expected for
19-EDO, 427.48463 against 427.47405 for 24-EDO, and 411.45824 against 411.45349 for
31-EDO. Errors are respectively −.02259, +.04284 and +.02000 cents. All five
additive partial amplitudes match the shared spectral data. The reference
ensemble can play these same pitch coordinates, but does not claim a matching
roughness model.

`npm run audit:range` passes. `npm run audit:integrated` passes across **918
frames** in three seeds under both Singing themes and Wide exploration. Complete
frame replay and harmonic destinations agree in every case; p95 complete engine
planning is **5.18–6.28 ms**. Full-narrative exploration intensity spans as low as
.0053 and as high as .9910. These are score intentions, not PCM loudness claims.

A 35-second live native **24-EDO ensemble** check starts at the actual first crest
of `open-field-45c0e042ae7643a3` (tick 122,880, 88 BPM), with Firefox-compatible
envelope fallback forced. All eight checks pass: 26 fresh generated/heard frames,
no errors, no late note batches, no late note tasks. Peak live planning is 14.4 ms,
peak scheduling 2.4 ms, peak active sources 66. This tests the fallback code in
the in-app browser, not an actual Firefox browser or device-level audio-dropout
counter. UI playback also continued beyond twelve bars, navigated immediately
into 6/8 without crashing, paused correctly, and displayed native MIDI export as
unsupported while exact JSON stayed available. Record: `.audit/live-native-v15.json`.

Example JSON/MIDI regenerated: 272 notes, 2,864 MIDI bytes, event hash `0ba42c01`.
Primary musician interviews were read and linked in `public/theme-study.html`.
No direct listening assessment or complete reference-track transcription is
claimed. The rendered passages are available for human audition; tests cannot
certify beauty, memorability or resemblance to a named performer.

## Version 14.0 idea density, register and orchestral range — 2026-10-01

The shared composition pipeline now separates authored idea density, ensemble
size, playing activity and intensity. Dense arguments diminish and sequence the
subject, connect it through native-scale movement to a register crest, and retain
a return and ending. Sparse arguments keep complete subjects with sustained
answers. A shared rhythmic score supplies riff identity, bass/kick anchors,
accompaniment accents, complementary backbeats, fills and breaths. Arrangement
selects one to twelve pitched players, derives extensions from existing musical
material, and releases players leaving the roster. Lead instrument changes happen
at thought boundaries. Wide exploration has six opening classes, including
immediate attacks and swarms, with tempo held to the user's control or automation.

All **368 tests pass**, including native 12/19 generation, source identity,
rhythmic cohesion, roster changes, exact replay, current and legacy serialization,
MIDI and timing. TypeScript and the production build pass. All **twelve event
fixtures match between Node and the in-app browser**. This intentional engine
version change invalidates older generator hashes; old JSON is preserved before
explicit reinterpretation and its complete parameter vector gains the two new
defaults. Example JSON and baseline MIDI were regenerated: 357 notes, 3,579 MIDI
bytes, event hash `251e3aa3`.

`npm run audit:range` measures complete first narratives for controlled cases,
plus 24 independently seeded Wide exploration openings. All checks pass. Dense
lead activity is 5.88–7.94 times sparse activity in the paired baseline narratives;
register span grows from 900 to 2,300 cents. Ensemble endpoints produce exactly
one pitched voice without percussion, or up to twelve simultaneous pitched
players. All six opening classes occur in emitted events. Native 19-EDO remains
on its own pitch grid, with the additive reference bed intact. These are score
measurements, not subjective assessments. See `range-audit.json` for intervals,
methods and per-case costs.

`npm run audit:integrated` passes over **877 frames**: three seeds, each under
Singing themes and Wide exploration, through their complete first narratives.
Every case preserves whole-frame replay, valid thematic cores, harmonic
destinations and steady BPM. Mean planning costs are 2.90–3.31 ms per two-beat
frame; p95 is 5.50–6.39 ms on this host. Expression regions are selected by their
actual curves; the audit does not assume a calm-first ordering or require idea
density to equal intensity. See `integrated-composition-audit.json`.

The browser's **Compare idea density × ensemble size** renders four actual
production Web Audio cases with the same seed `range-integration`, 88 BPM,
12-TET and 32-beat window. All nine checks pass:

| Case | Lead attacks | Median onset gap | Lead range (MIDI equivalent) | Max pitched players | PCM peak | Musical RMS |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Spacious solo | 13 | 2.5 beats | 68–77 | 1 | .04530 | .02079 |
| Dense solo | 114 | .25 beats | 68–89 | 1 | .02571 | .01103 |
| Spacious ensemble | 13 | 2.5 beats | 68–77 | 12 | .15204 | .03486 |
| Dense ensemble | 114 | .25 beats | 68–89 | 12 | .12045 | .02938 |

All four 44.1 kHz stereo renders contain finite, unclipped samples. Changing only
ensemble size preserves the lead fingerprint exactly (`04605f8a` sparse,
`f71b92c5` dense). Density is not represented as loudness: short articulations and
different instruments can have lower RMS than sustained notes. Native 19-EDO
synthesis measures 456.35651 Hz against 456.34825 Hz expected (0.03134 cents
error), with all five partial amplitudes matching the shared spectrum. Glides
into 19-EDO and back measure within 0.08 cents at arrival; all **nine instrument
colors** produce nonzero, distinct PCM signatures.

A **35-second live first-crest run** of Wide exploration, seed `velvet-orbit`,
88 BPM, starts at tick 99,840 and performs fresh planning during playback. All
eight checks pass: 26 generated and heard frames, 14 audible bars, zero errors,
late-note tasks and scheduler underruns. Peak source count is 93; maximum
planning is 12.8 ms and scheduling 4 ms. The `cancelAndHoldAtTime` fallback was
forced throughout. This checks the compatibility path in Chromium, not the
user's Firefox profile. Scheduling counters do not measure device-level dropouts.
The main interface also advanced through multiple bars, sought to the next
section while playing, paused and restarted without console errors.

Research and its limits are documented in `public/theme-study.html#range`:
Rudess's own instruction and interviews, Halpern/Nolly interviews, Wildoer's
album-era and drum interviews, Harrison's account of *Fear of a Blank Planet*,
and a visually inspected licensed Dream Theater score sample. These support
explicit compositional hypotheses. No direct listening session, complete album
analysis, or original-track transcription is claimed. Generated audio was
rendered and measured; musical beauty, memorability and stylistic success still
require subjective audition. The browser supplies the comparisons for that.

## Version 13.0 shared composition pipeline — 2026-10-01

Version 13 makes the common composition path mandatory. `ScoreTimeline`
combines form and multidimensional expression, with explicit automation applied
last. `ThemeCore` supplies protected melodic arguments; `HarmonicDirector`
plans their native harmonic destinations before voicing. Thematic delivery,
accompaniment, related answers, groove and prepared transitions share that
plan. Final ensemble dynamics include late counterline and fill events.

Dynamic breadth now controls expression independently of conductor freedom.
Calm, flowing and crest passages change actual onset grammar, gates, density,
register, brightness and attack strength; tempo remains governed by its own
control or automation lane. The additive instrument retains a continuous
five-tone harmonic reference and fixed partial amplitudes instead of adopting
ensemble articulation and gain swells. This is an instrument adapter within
the same composition, not another generator.

Earlier version 2–12 documents are preserved before UI reinterpretation.
Disabled or omitted historical stages now resolve into the shared profile;
version 13 does not promise their older event hashes. The sections below are
historical results for their named engines, not validation of current output.

Final verification: **337 tests**, TypeScript and the production build pass
(278.00 kB JavaScript, 94.26 kB gzip). All twelve deliberately repinned event
fixtures match in Node and the native in-app browser. Legacy omitted/disabled
configuration tests exercise the mandatory profile rather than a second engine.
Example JSON and baseline MIDI were regenerated: 397 notes, 4,027 bytes,
event hash `0e4e4565`.

`npm run audit:integrated` covers the complete first narratives of three seeds
under both Singing themes and Wide exploration: **906 committed frames**.
Every case preserves exact whole-frame serialized replay, supplies a protected
core, realizes its declared harmonic destinations and keeps BPM steady.
Measured mean planning cost is 2.12–2.98 ms per two-beat frame; p95 is
4.16–7.65 ms on this host (a browser live audit was also active). All six
crest passages have at least 1.8 times their calm orchestral onset activity.
The full score measurements are in `integrated-composition-audit.json`.

Additional regressions cover bounded native-scale development versus literal
recall, macro edits waiting for the next argument, fixed-melody/sequence identity,
minor-mode quotations, actual octave register change when entry continuity
permits it, clipping long stored tails before announced transition breaths,
and explicit automation retaining final parameter authority. The UI exposes
only active phrase controls; archived compatibility fields survive an edit.

The final browser expression audition generates the 108-frame `glass-garden`
Wide exploration narrative once (hash `c8a10d98`) and renders calm, rise, crest
and retreat excerpts through production Web Audio. All thirteen checks pass.
Calm has 14 sustained upper notes with changing gain. Crest/calm PCM RMS is
**3.3679×, or 10.5471 dB**; all rendered samples are finite and unclipped.
The same-event fixed-envelope comparison differs by RMS 0.00034625,
demonstrating that the written swells affect the signal. The rise can have
higher RMS than the crest because articulation, note lengths and instrumentation
also affect loudness; score energy is not presented as a loudness measurement.

A **35-second live first-crest check** used the saved Singing themes recipe,
88 BPM, seed `hidden-meadow-7d35bd9eb87f9ef9`, from tick 92,160. With
`cancelAndHoldAtTime` deliberately unavailable, all 26 generated frames were
heard, with zero errors, late-note tasks or scheduler underruns. Maximum
planning was 19.8 ms; maximum scheduling was 5 ms; peak source count was 78.
This exercises the compatibility path in the in-app browser, not the user's
Firefox profile or device-level dropout measurement.

The native 19-EDO frequency probe measured 456.35650818 Hz against the requested
456.3482473 Hz (0.03134 cents error), retaining all five shared partial ratios
and amplitudes without semitone rounding. Audio was rendered and measured;
these checks do not constitute a subjective listening assessment. The audit
page provides the passages for listening.

## Version 12.0 theme identity and harmonic direction — 2026-10-01

**330 tests**, TypeScript and the production build pass (331.32 kB JavaScript,
113.27 kB gzip). The original ten pinned event streams are unchanged when the
new optional harmonic language is omitted. Two new 128-frame fixtures are
`d2fd957d` (12-TET ensemble) and `a5ca3c1a` (19-EDO additive). All twelve match
in Node and the native in-app browser. Example recipes were regenerated; the
baseline MIDI remains 228 notes, 1,715 bytes and hash `f2561254`.

The new optional path composes an immutable core before choosing harmonic
destinations and voicings. Period, sentence and arch-reprise arguments preserve
their identifying head, prepare a high point, and give ending notes explicit
roles. Develop, reharmonize and sequence treatments declare which relationships
remain fixed. Tests across 72 seeds cover grammar diversity, protected identities,
prepared apexes and truthful emitted-note metadata. Integration tests verify
unchanged physical melody through three distinct supports for three seeds in
both native pitch spaces, and exact serialized 19-EDO sequence replay.

Functional routes, P/R/L triad relations and third-cycle destinations are bounded
compositional tools, not universal theories. Native 19-EDO uses explicit interval
sets and an unequal 6/6/7-step region cycle. Route tests cover dominant obligations,
actual common tones and prepared authentic, half, plagal and deceptive cadences.
A single-window sentence has no invented cadence label. Upper voices must realize
the declared chord identity; the bass establishes its root. When the normal smooth
motion allowance cannot realize that identity, the smallest feasible larger bound
is used. Ranges, order and distinct voices remain hard constraints.

`npm run audit:harmony` measures six 256-frame cases (three seeds, two tunings).
All 556 declared destinations are realized, with exact whole-frame serialized
replay and native tuning. Each case visits 6–8 roots and contains 55–63 changes
involving multiple upper voices. Mean movement over all upper-voice transitions
is 80.29–100.82 cents; observed maxima are 300–400 cents. Mean planning is
0.93–1.29 ms per frame, p95 2.15–3.40 ms, with a largest initialization-inclusive
sample of 16.53 ms. These are local measurements, not a dropout guarantee.
The six-case lyrical audit also passes, including structural harmony, long notes,
declared destinations and a single foreground melody.

Melodic support now weights actual overlap duration and structural role rather
than counting every pitch once. A targeted held G-sharp / F-sharp-minor case
chooses a voicing without the exposed A neighbor while preserving chord identity
and the three-semitone motion bound. This separate musical support preference is
not sensory roughness and does not claim to eliminate every physical clash when
the prior register and motion constraints make that impossible.

The final browser comparison uses seed `quiet-forest-5571fc048af2a73a`: a complete
eight-bar, 17-note theme through its closed cadence, 24.82 seconds including
release. Both 12-TET ensemble and 19-EDO matched additive produce three distinct
accompaniments, all declared goals realized, with identical melody timing and
physical pitches within each tuning. All eight rendered signals are finite and
unclipped. Baseline melody/mix RMS is 0.01171 / 0.02217–0.02247, maximum peak
0.08698; additive melody/mix RMS is 0.01513 / 0.04130–0.04295, maximum peak
0.17530. The four baseline players remain in the main instrument.

A 35-second native live run of that saved baseline recipe passes all eight
transport checks with `cancelAndHoldAtTime` temporarily absent. It plays 26
generated/heard frames across 12 bars, with sound in all seven five-second bins,
no errors, late note tasks or scheduling deadline misses. Maximum planning is
8.8 ms, scheduling 2.1 ms, pump gap 31.93 ms, and active sources 42. This exercises
the Firefox-compatible fallback in the in-app browser, not the user's Firefox
profile or device-level audio timing. No main-page console errors were observed.

`public/theme-study.html` contains the six requested theme studies, cited evidence,
edition limits, and a generation strategy. Its notation distinguishes implemented
bounded mechanisms from proposals. No claim is made to reproduce the reference
works, to have inspected every complete score, or to establish subjective musical
quality through signal measurements. This pass rendered and measured production
audio; no subjective hearing assessment is claimed.

## Version 11.0 lyrical score — 2026-10-01

**312 tests**, TypeScript and the production build pass (300.64 kB JavaScript, 103.18 kB gzip). Examples include a serialized lyrical score; the original baseline MIDI remains 228 notes, 1,715 bytes and hash `f2561254`.

The new serialized lyrical direction composes a complete melodic sentence before playback: recurring opening, open continuation, answering recall, prepared high point and held cadence. Full thematic arguments span multiple sentences where the form calls for it. Protected melody pitches retain their authored native contour; the harmonic planner anticipates their held tones and final cadence. Four sustained upper voices and a quiet bass change at aligned structural windows, while independent foreground solos, counterlines, groove patterns and fills are excluded from this direction. Explicit strings connect overlapping lead notes while respecting written breaths. Other instruments and matched additive synthesis retain their previous behavior.

All ten pinned Node/browser event streams match. The previous eight hashes are unchanged; the new 128-frame lyrical fixtures are `4ba138ec` (12-TET ensemble) and `d33354f3` (19-EDO additive). `npm run audit:lyrical` records six 256-frame seed/tuning cases with exact serialized replay, structural harmony changes, a single foreground line and true microtonal events. Upper motion is bounded by 200 cents in 12-TET and 189.474 cents in 19-EDO after initialization. Planning averages 2.31–2.92 ms; warm p95 is 3.89–5.41 ms and maximum 5.51–7.46 ms in that run. These timing measurements are machine-dependent, not guarantees against operating-system audio dropouts.

A separate held-harmony audit (`lyrical-support-audit.json`) verifies all six full-theme cadences over tonic bass, four sounding upper voices and bass under every melody attack, no competing foreground line, and distinct pitch collections rather than unison collapse. A targeted physical-neighbor penalty reduces exposed held seconds from 15 to 7 across the three 12-TET themes. This is an arrangement preference in the melodic-support objective, separate from Sethares-style sensory roughness. Some close neighbors deliberately remain. The first glass-garden theme keeps a tonic bass pedal; this direction trades some harmonic exploration for melodic stability.

The production full-theme audition includes every open inner sentence through the first declared closed cadence, plus context. For glass-garden that is a 12-bar, 32.73-second argument with 31 melody notes, 26 lasting at least a beat, 27 connected boundaries, three interior breaths, an 800-cent range and a final F-sharp4. The open first sentence ends on its intended third; that is a continuation, not a failed tonic resolution. The closed compact final sentence holds its tonic for 1.75 beats; the full eight-bar form allows longer cadences. The audit compares each actual native endpoint and duration to its authored intention.

This is a bounded tonal grammar, not a claim of general composition intelligence or reproduction of a named composer. Native audio is rendered and measured; no subjective hearing assessment is claimed.

The final browser full-theme audition passes all eight checks with finite, unclipped PCM. Mix/melody/backing RMS is 0.02770941 / 0.01447782 / 0.02334335, with maximum mix peak 0.09722245. The strings-only mix adjustment improves the melody-to-backing ratio from −8.07 to −4.15 dB without changing any committed note events. Separate stem compression/effects mean these are useful presence measurements, not an exact decomposition of the full mix.

A native 35-second saved-lyrical playback check with `cancelAndHoldAtTime` temporarily absent passes all eight checks: 26 generated/heard frames over 12 bars, no errors, no late tasks and no scheduling deadline misses. Maximum planning is 7.7 ms, scheduling 2 ms, pump gap 31.93 ms, active sources 34, and notes created in one pump six. Main-page Play/Pause and Next section also work without console errors. This is the in-app browser exercising the Firefox-compatible envelope implementation, not a direct test of the user's Firefox profile. The full-theme mix, lead and backing remain available on `/audio-audit.html`.

## Version 10.0 contextual ideas and shared texture — 2026-09-30

`continuum-10.0.0` passes **294 tests**, TypeScript and the production build (285.58 kB JavaScript, 98.19 kB gzip). The examples were regenerated. The baseline MIDI remains 228 notes, 1,715 bytes, with event hash `f2561254`. Version 9 browser recipes are archived before reinterpretation; a version 10 result is not an exact replay of a version 9 composition.

Reusable ideas now separate rhythm, direction, preferred width, melodic function, and explicitly literal notes. A four-note native beam realizes contextual cells; arpeggio relations can release contour direction, while literal heads and quotations remain protected. Tests exercise changing chord contexts, different interval widths with retained rhythm/direction, prepared nonchord connectors, native 19-EDO, and caller-batch independence. Structural and ornament histories are separate. A side-effect-free accompaniment preview plus bounded committed tails supplies per-onset harmonic context, including pitch curves and rests. This follows symbolic sounding notes rather than replacing held accompaniment with an unplayed planner target. It does not model reverberation or the short source-replacement crossfade as extra harmonic voices.

A measured 1,800-cent jump into a literal solo recall exposed the need for an explicit connecting function. The corrected return link releases contour direction only while approaching the known quote register, retains its authored rhythmic space, and leaves the quote unchanged. Three seeds over 320 frames each contain 18 tested recalls, all approached within 100 cents (63.158 cents in 19-EDO). This is a targeted continuity result, not a prohibition on expressive leaps elsewhere.

The ensemble shares one continuous texture policy for pace, subdivision, syncopation, gates, articulation, rhythmic drive and velocity ceiling. Calm changes note timing and sustain instead of only reducing volume. Bass, harmony and percussion quote a common addressed attack grammar at high pace, while independent source lifetimes remain separate. Retreat preparation reads its destination texture, lowers its level and omits rapid late attacks when appropriate. Tests cover rhythmic partition invariance, native ranges, shared rests, final gain ownership, and the additive exception. Existing source/form grammars remain bounded; these changes do not claim an unconstrained universal composition language.

`npm run audit:texture` records three complete default narratives of 124, 116 and 146 frames in `texture-audit.json`. Every frame matches after strict performance-JSON serialization and replay. Planning averaged 4.674 / 3.559 / 3.438 ms per frame in the final run. Calm upper notes are 94–100% sustained with median written gates around four beats; calm melodic gates span 1.08–2.5 beats. Crest bass attacks are 1.68–3.17 per beat versus 0.29–0.35 in calm passages. The narratives contain 11–72 fine-subdivision attacks shared by harmony, bass and drums. Quiet fill velocities peak at 0.105–0.215. None of the three first narratives has a solo interval larger than an octave after the recall fix. Raw symbolic bass gates can overlap at cue interruptions; live and offline ensemble synthesis now replace the prior bass with a 35 ms crossfade. MIDI trims the prior bass at the next attack, retains repeated-note rearticulation, and does not resurrect superseded holds in sliced exports. Additive bass is unchanged.

All eight pinned browser/Node streams match. The four manual streams and two unphrased autonomous streams are unchanged; phrased ensemble/additive now hash to `a5b92237` / `26b22c48`. The original high-mobility/smoothness acceptance still produces 96 pitch collections in 128 frames, with 49.2-cent mean upper motion and a 200-cent maximum step. Roughness influence, native tuning constraints and microtonal export guards remain covered.

Native production Web Audio passes the controlled articulation check for keys, glass and pluck: identical-pitch/velocity sustained notes have softer attacks and held-body RMS of 0.0163–0.0213, while the detached variants have decayed to roughly 0.000002 at that point. All are finite and unclipped. The final `glass-garden` Wide exploration audition passes 13 checks over four chronological excerpts from the complete 108-frame narrative. Its calm foreground has a one-beat median onset gap, no off-quarter pitched attacks and 100% sustained articulation. At the crest, 52 short connections join harmony, bass and percussion. Calm/rise/crest/retreat PCM RMS is 0.01015983 / 0.02809106 / 0.02625001 / 0.02638776; maximum excerpt peak is 0.17010264. Crest/calm contrast is +8.24 dB, with an audible calm floor. The sampled retreat begins while the ensemble is still active; its mean level is not evidence that every instant has already become quiet. The unchanged-event fixed-envelope reference differs by 0.00030159 RMS.

The native solo audit passes all ten checks. The first solo has 27 notes over 9.205 seconds, eleven continuous joins, and a five-note flight with all four joins connected. Solo/backing RMS is 0.01727582 / 0.01711423 (+0.08 dB), and mix peak is 0.15794714 without nonfinite or clipped samples. Theme, full mix, isolated lead, backing and rhythm players are available on `/audio-audit.html` alongside the expression excerpts.

Live scheduling now admits chronological tasks into a 400 ms window; source graphs are created incrementally. Heavy main-page DOM work is deferred to animation frames, offscreen score/chart rendering is skipped, and form/parameter/texture caches are bounded. A native 35-second first-crest run for Wide exploration `velvet-orbit`, with `cancelAndHoldAtTime` temporarily absent, passes all eight checks: 26 generated/heard frames over 14 bars, zero errors, zero late tasks and zero scheduling misses. Peak planning is 10.2 ms, scheduling 1.5 ms, timer gap 40.6 ms, active sources 67 and notes scheduled in one pump eight. This checks the fallback in the in-app browser, not the user's main Firefox profile or device-level dropouts. Main-page Play, natural section progression, Next section, phrase visibility and Pause also worked; its visible diagnostics reported zero late batches and there were no console errors.

No subjective hearing assessment is claimed. Actual production audio was rendered and measured, and the players are provided for listening. Numerical continuity, louder/softer ranges and rhythmic coordination do not by themselves prove an engaging composition.

## Version 9.0 developed material and orchestral range — 2026-09-30

The engine is `continuum-9.0.0`. `npm run build` and **270 tests** pass; production JavaScript is 263.36 kB (90.96 kB gzip). The version intentionally changes autonomous and phrased compositions. Version 8 recipes remain archived and restoring them is explicitly a new interpretation. Example JSON files were regenerated; the baseline MIDI still contains 228 notes with hash `f2561254`.

The harmonic objective previously competed against independent penalties for the friction, ambiguity, and motion required by its own aggregate target. Autonomous planning now uses compatible component targets and compares actual and desired harmonic tension using the same weights. Rhythm, density, cadence position, and requested energy are not presented as measured harmonic outcomes. The UI exposes requested orchestral energy alongside observations of committed note attacks, active voices, and written velocity; sensory roughness remains separate. The manual planner and its four pinned streams are unchanged.

Wide exploration now derives a correlated, serialized character vector and different phrase/composition settings per seed, with Freedom between .60 and .95 rather than always applying one maximum-freedom recipe. It preserves the chosen tempo, tuning, spectrum, and scoring controls. Source sentences contain 16–28 notes, with related short-cell vocabularies and longer motif arguments. Heard memory learns played chains of up to 24 structural notes. Six ornament types preserve source pitch/onset identity. Prepared transitions recruit independent bass approaches, upper replies, counter pickups, and percussion into shared arrivals. Quiet-end gain shaping now runs once after all these parts have been assembled; review caught and fixed an independent-counter/fill bypass. No master-volume boost was made.

`npm run audit:development` writes `development-audit.json`, covering six Wide exploration recipes and three full-Freedom default recipes through their complete first narratives. All nine match every frame after strict recipe JSON serialization and replay. The Wide cases have harmonic mean absolute error 0.025–0.037; full-Freedom cases have 0.039–0.048. These are errors in the newly declared candidate-controlled harmonic measure and cannot be compared directly with the former aggregate scale.

Across the six Wide cases, peak/calm attack ratios are 1.54–3.15 and written-velocity ratios are 2.32–12.23. Emitted motif groups have median 16–21 structural notes and spans around 9.9–10.9 quarter-note beats; maxima reach 24–30 notes and 12–17 beats. All advertised core cells actually emit. Each complete narrative has 7–11 fills involving at least three actual parts, including 1–5 four-part fills. Planning averages 3.29–4.67 ms per committed frame on this machine. Two first narratives do not repeat a complete phrase-source ID, although their cells and motifs recur; the report records that limitation. Quiet sustained passages can have as many simultaneous voices as peaks, so attack speed and gain are more informative than voice count alone. Different emitted motif fingerprints demonstrate structural variation, not a subjective style-diversity score.

All eight pinned Node/browser streams match. Manual hashes remain `f2561254`, `24265aeb`, `8ff90f42`, and `7502484a`; autonomous ensemble/additive hashes are `cbe2dd14` / `9c590260`; phrased ensemble/additive hashes are `6be178cf` / `4e78722d`. The original high-mobility/smoothness fixture retains 96 pitch collections, 49.2-cent mean upper movement, and a 200-cent maximum step. Native 19-EDO, stable candidate ordering, ranges, rests, source identity, and microtonal export guards remain covered.

The native expression audition now generates the complete first Wide exploration narrative rather than an arbitrary frame limit. For `glass-garden`, that is 108 frames and 2.45 minutes. It selects four chronological eight-frame focus windows with up to two context frames, plus the unchanged-note fixed-envelope reference. All ten checks pass. Calm/rise/crest/retreat PCM RMS is 0.001859 / 0.034346 / 0.037892 / 0.033725 at the same output volume; calm-to-crest is +26.19 dB. All rendered samples are finite and unclipped, with maximum peak 0.195714. The calm focus retains twelve changing held gain curves and four-beat median attack-limited upper gates, compared with 0.356 beats at the crest. Actual observed attack rate rises from 4.47 to 11.53 per beat. All six new ornament types occur in the complete narrative. The fixed-envelope reference preserves all other events and produces a measurable RMS waveform difference of 0.00004224.

A native 35-second live check with `cancelAndHoldAtTime` temporarily removed passes all six checks: seed `lunar-orbit-1bd8c6622bc451e8`, 88 BPM, 26 generated/heard frames, no errors, and sound in every five-second bin. Measured bin RMS spans 0.00318–0.01995 with maximum sampled peak 0.08407. This exercises the fallback in the in-app browser, not the user's main Firefox profile. Main playback advanced from bar 5 through bar 24; Next section reached bar 25 while continuing, and Pause held that position. Two Wide exploration clicks displayed distinct character/settings while retaining 88 BPM. No main-page console errors or horizontal overflow were observed.

The native solo audit also passes all ten checks. Its completed 27-note, 9.205-second solo follows an earlier complete statement, and all eleven connected boundaries, including the four joins of its brief flight, remain continuous. Solo/backing RMS is 0.01856 / 0.02114 over the solo (−1.13 dB); mix peak is 0.17321 without clipped or nonfinite samples. The supporting independent counterline still uses a small opening fragment and a bounded repeating rhythm; expanding foreground material does not claim that every accompaniment pattern is new.

No subjective hearing assessment is claimed. The actual production audio was rendered and measured; comparison players remain on `/audio-audit.html` for listening. These measurements establish larger realized contrast, more developed emitted material, shared fills, and reliable playback, rather than proving that the result feels captivating or overwhelming.

## Version 8.0 melodic direction and expressive contrast — 2026-09-30

`npm run build` and **243 tests** pass for `continuum-8.0.0`. Production JavaScript is 246.66 kB (85.09 kB gzip). Version 7 recipes remain archived and restoring one is explicitly a new interpretation. Example recipes were regenerated; the unchanged baseline MIDI example has 228 notes and event hash `f2561254`.

Solo development now uses a bounded native-pitch realization against the current planned upper voices and bass. Literal theme quotes remain protected; developed strong notes favor guide relationships, large leaps favor contrary recovery, and a prepared approach retains a destination with an open or closed ending. Longer solos return literally to their subject. Four integration tests cover heard repetition in 12-TET/19-EDO, partition-independent realization, harmonic response, cached approaches, and core identity under changed delivery. The original seed themes now use several singable home contour grammars with distinct related replies. Solo synthesis gain is 0.15 instead of 0.18, a 16.7% reduction.

An absolute musical-time contour drives the conductor, melodic intensity/register, and accompaniment. Calm sections keep staggered long holds, while rising activity admits syncopated figures and brief faster flights. Crescendos and retreats span several bars without autonomous BPM drift. Per-note linear gain envelopes are stored in musical ticks, retimed across tempo changes, clipped at rests, and carried through compatible ties. Quiet structural cues punctuate one low upper voice so they do not repeatedly terminate all the sweeps. Already-known transition rests are published early enough to clip long committed holds. Ensemble glides now also connect eligible interior sweeps and solo links; protected theme anchors, deliberate breaths, and the matched additive path remain guarded. Additive synthesis continues to ignore velocity and per-note gain shaping. Standard MIDI retains gates/velocities but does not encode the new held-note gain curves; JSON retains the exact versioned recipe, and microtonal/gliding MIDI remains explicitly unsupported.

All eight pinned event streams match in Node and the native in-app browser. The four manual hashes remain unchanged. The new autonomous hashes are `c2390161` (ensemble) and `865df5aa` (additive), and the 192-frame phrased hashes are `6b8b9834` and `a8f90138`. The original high-mobility/smoothness fixture still produces 96 pitch collections, 49.2-cent mean upper movement, and a 200-cent maximum step.

`npm run audit:expression` checks complete first narratives for three seeds; the detailed symbolic report is `expression-audit.json`.

| Seed | Frames | Calm / peak median attack-limited upper gate, beats | Calm / peak mean written velocity | Interior glides |
| --- | --- | --- | --- | --- |
| glass-garden | 124 | 4.000 / 0.398 | 0.181 / 0.418 | 5 |
| velvet-orbit | 116 | 3.994 / 0.388 | 0.185 / 0.404 | 7 |
| amber-current | 146 | 4.000 / 0.421 | 0.192 / 0.417 | 13 |

Generation averages 3.18–3.75 ms/frame on this machine. All runs retain 88 BPM and valid integer-time events/gain knots. Fifteen heard four-note solo quotations include eight literal interval returns; six of seven solo windows have a return inside the solo, while the shorter first window only states its opening quote. Connected upper movement has a 100-cent 90th percentile and a 200–300-cent maximum. All fourteen nonquote solo anchors are within one native step of the planned harmonic field. Sparse sounding accompaniment is different from that full field: mean distance to a currently sustained guide is 66–109 cents, and an anchor need not double a sounding chord note. These are symbolic relationships, not perceived coherence scores.

A separate read-only overlap check examined 5,520 simultaneous upper-voice pair intervals across these narratives, including pitch trajectories between onsets, gate ends, glide endpoints, and rest boundaries. It found no voice crossings or simultaneous unisons, excluding the brief replacement crossfades and release/effect tails.

The browser solo audition passes all ten checks. The first completed 9.20-second solo has 26 notes in a 16.36-second contextual excerpt; eleven connected boundaries, including all four joins of a five-note flight, pass PCM continuity checks. Solo/backing RMS over the solo is 0.01767/0.01821 (−0.26 dB), compared with the previous recorded version's +2.58 dB. This is a changed composition/arrangement as well as a gain change, not an isolated gain A/B. Mix peak is 0.16923; no nonfinite or clipped samples occur. Three deliberate breaths and the declared orchestral supports are observed.

The new **Hear calm sweeps, rise, crest, and retreat** browser audition generates one 400-frame history and renders four chronological 16.36-second excerpts with lead-in. All eight checks pass. Measured calm/rise/crest/retreat RMS is 0.00680/0.02687/0.02639/0.01674, with peaks below 0.170 and no nonfinite or clipped samples. Twenty calm held notes have changing gain curves. A fifth controlled reference changes only their envelopes to their own mean gain; identical note events produce an RMS waveform difference of 0.000159, demonstrating that the curves reach the actual synthesis. Attack-limited gate statistics conservatively stop at the next same-voice event; equal-pitch ties and release/effect tails are evaluated separately by the audio path.

A 35-second native live check used saved seed `tidal-island-0745a28f5e65a13b` with the native hold method temporarily removed to exercise Firefox-compatible gain scheduling. It generated and heard 26 frames, passed all six checks, and reported no errors. All five-second bins contained signal (RMS 0.0120–0.0203, maximum sampled peak 0.09824). This verifies the fallback in the in-app browser, not the user's main Firefox profile.

Main-app playback advanced through multiple bars. Next section moved from bar 12 to the start of the counterstatement at bar 13 without interrupting transport; Pause then held bar 18. The main browser reported no console errors. The instrument was left paused and both instrument/audition tabs retained.

No subjective hearing or artistic-quality assessment is claimed. Musical event relationships, real browser PCM, replay, and transport behavior are measured; the comparison players are provided for listening. The explicit grammar and finite motif operations remain bounded, and harmonic fit is not a substitute for the listener's judgment of phrasing or appeal.

## Version 7.0 overlapping ideas and prepared arrivals — 2026-09-30

`npm run build` and **210 tests** pass for `continuum-7.0.0`. This version intentionally changes phrased performances. Older recipes remain archived and are explicitly new interpretations when restored. Examples were regenerated; the manual MIDI example remains 228 notes with hash `f2561254`.

Short phrases now contain three to five core notes and explicit subdivision durations, with two to four related appearances forming a motif group. Five-eighth and other odd-length cells retain their lengths across barlines; later appearances can transpose, expand intervals, and change embellishment. The foreground still uses bounded four-, six-, or eight-bar thought windows. An additional counterline, a four-quarter rhythm foundation, and optional five- and seven-eighth rhythm layers have separate phases and source lifetimes. Shared cell cues recruit consistent accompaniment players, with exact common audio onsets and varied velocities. Foreground breaths spare the independent counterline; shared ensemble rests still silence it.

Three new serialized controls expose independent layers, cross-meter cycles, and transition energy. Known section, meter, and committed tempo destinations receive sparse pickups or increasingly dense preparation, a short breath, and an arrival. Tempo itself remains steady unless explicitly automated. Review caught a phantom-fill case where several tempo points fell between frame commits but left the played BPM unchanged; this now produces no tempo preparation. Tests also cover late-known automation, exact live/replay frames, simultaneous destinations, native counterline pitch, partition-independent clocks, stable shared-cell membership, MIDI channel separation, and the Firefox envelope fallback.

All eight pinned Node/browser event streams agree. Manual and unphrased autonomous hashes are unchanged; the two new 192-frame phrased hashes are `f218e822` (ensemble) and `27e7928c` (matched additive). The original harmonic acceptance run still produces 96 distinct pitch collections, mean upper movement 49.2 cents, and no upper step above 200 cents. The matched 19-EDO roughness comparison remains bounded at 189.474 cents per upper step.

`audit:layers` generates the first complete route for three seeds. Every reported short phrase emitted its planned core notes; cross-bar counts use the section's actual bar origin rather than a global 4/4 assumption.

| Seed | Frames | Short phrases / crossing bars | Lead + at least two explicit support parts | Independent notes / during foreground breaths | Scoped-rest violations |
| --- | --- | --- | --- | --- | --- |
| glass-garden | 124 | 51 / 32 | 84 shared attacks | 84 / 11 | 0 |
| velvet-orbit | 116 | 55 / 28 | 105 shared attacks | 98 / 19 | 0 |
| amber-current | 146 | 65 / 37 | 108 shared attacks | 81 / 6 | 0 |

Those runs averaged 3.02–3.61 ms per frame on this machine. Counterline and rhythm sources span section boundaries and change on their own clocks. The six-cycle phrasing audit retains an archive of at most 18 ideas, discovers 22–25 heard descendants, includes 17–21 solo passages per seed, and reports zero ensemble-pause violations. The slower composition audit preserves repeated core fingerprints with distinct realizations, longer solos, and open inner endings. These measurements establish actual event relationships, not an artistic quality score.

The new native Web Audio comparison renders three 61.364-second treatments of `glass-garden`, with density and rhythmic complexity fixed at 80%. A favors bar-related cells with sparse preparation. B enables independent layers. C preserves B's structural melody and counterline exactly while increasing transition energy from 15% to 95%; both have core hash `738cb68f`. B/C contain 31 independent counter notes, including seven overlapping foreground breaths, and 34 cell attacks shared across at least three parts. Their completed cells include 3/8, 5/8, 7/8, and 9/8 lengths. The first arrival has two preparation attacks in B versus nineteen in C; across three arrivals there are four versus fifty-two. The final shared break trims preparation in both treatments, while all three arrivals remain present. Gesture names describe planned preparation; actual counts are measured after rest clipping and ensemble merging. All eight comparison checks pass, with finite unclipped samples, peaks 0.177–0.187, and RMS 0.02490–0.02655. The original 30-second excerpt was too short to exhibit an independent note during an explicit foreground breath; the longer comparison exposes the interaction without changing generation to force it.

The native solo audition passes all ten checks. Its 9.205-second, 22-note solo quotes an earlier complete theme; all nine connected boundaries and four joins in its five-note flight remain continuous. Three deliberate gaps contain no overlapping solo source events. Solo level is +2.58 dB over its independently rendered backing during the solo span; mixed peak is 0.14656 without non-finite or clipped samples.

A **35-second live native browser check** temporarily removed `cancelAndHoldAtTime`, using saved seed `open-horizon-a40db70866699180` at 88 BPM. All six checks pass: 26 frames generated and heard, continuously advancing clocks, a running context, and no errors. Each five-second bin contains sound, with RMS 0.0100–0.0198 and maximum sampled peak 0.07324. This exercises the missing-capability path in the in-app browser, not the user's main Firefox profile. Main-app Play, live Next section, Pause, and exact Restart were exercised; the new controls and independent-cycle display were inspected with no horizontal overflow or console errors.

No subjective listening assessment is claimed. The minute-long A/B/C players on `/audio-audit.html` provide a direct audition of bar-related versus independent phrasing and sparse versus intense preparation. The grammar remains finite, and larger foreground thoughts still use aligned planning windows; this version separates clocks and improves controlled development rather than claiming unrestricted composition.

## Version 6.0 hierarchical composition and ensemble expression — 2026-09-30

`npm run build` and **184 tests** pass. The engine is `continuum-6.0.0`; this intentionally changes phrased music. Old performance recipes remain archived and are explicitly new interpretations if restored. Example JSON files were regenerated. The manual MIDI example remains 228 notes with hash `f2561254`.

The phrase planner now separates persistent motif/phrase sources from occurrence-specific delivery. Four-note motifs assemble into four-, six-, or eight-bar thoughts. Longer thoughts add related material instead of stretching the same short array. Eligible slow themes/reprises can occupy 24 or 32 bars, with repeated phrase statements and an eventual closed cadence. Open inner endings preserve continuity across the conductor's four-bar navigation windows. Section envelopes continue across these musical phrase boundaries. Six validated, serialized controls govern development, thematic repetition, embellishment, togetherness, accent contrast, and dynamic breadth.

Review exposed and fixed two kinds of accidental stretching: longer melodic phrases retained a fixed sixteen-note core, and longer solos retained a fixed twenty-something-note gesture chain. In a controlled 10/26/42-beat solo comparison, the new planner supplies 23/40/62 notes; the longest held note is 1.33/2.34/2.34 beats and the brief run remains at most 1.5 beats. Open solo endings no longer force a final harmonic landing. Memory learns heard core material rather than treating each ornament as a new theme; core register fitting and harmonic targets are also independent of delivery-only embellishment.

End-to-end tests compare two actual complete theme performances with delivery controls disabled/enabled. They retain the same core source IDs, physical pitches, and onset ticks, while ornamentation, velocities, and accompaniment change. A separate long-theme test verifies repeated eight-bar statements with identical core pitch-class/rhythm relationships, different realizations, and open/open/closed cadences. Ensemble tests cover exact offbeat support, independent grooves away from cues, written rests, native 19-EDO templates, bounded support, and the fixed-amplitude additive exception. New composition controls also survive performance JSON, URL state, and deterministic replay after live edits.

All eight pinned event hashes agree in Node and the native browser. The four manual and two unphrased autonomous fixtures are unchanged. The new 192-frame phrased hashes are `0e0d0f2e` (ensemble) and `9c025f0b` (matched additive).

The three-seed `audit:composition` run, at slow form pace with maximal source repetition, generated 240–262 frames per movement in 2.80–3.15 ms/frame. Like-context repeated groups each have exactly one core pitch-class/rhythm fingerprint and two or three distinct performances. The runs have seven or eight open inner endings, two or three eight-bar solo plans, and 106–114 actual cue attacks shared by the lead and at least two other parts. Mean anchor velocities are 0.632–0.721 versus ornament means 0.420–0.472, with zero violations of planned pauses. These are causal structure and signal-design checks, not scores for musical quality.

The six-cycle phrasing audit covered 758–856 frames and 63–68 musical phrases per seed, averaging 2.83–2.97 ms/frame during concurrent verification. It discovered 20–24 heard descendants while retaining the 18-idea archive bound, included all four foreground roles and 17–21 solo passages, and reported zero pause violations. The original high-mobility/smoothness acceptance run still measures 49.2 cents mean upper movement, no upper step over 200 cents, and 96 distinct pitch collections in 128 frames.

The new native Web Audio composition audition renders the same complete 21.82-second opening theme twice. Both have the same 32 structural melody notes. The embellished version adds five ornaments and 26 explicit support notes; all nine structural cue attacks span at least three parts, compared with eight in the restrained rendering. Mean anchor/ornament velocities are 0.842/0.416. Mix peaks are 0.134/0.167 and RMS values 0.0220/0.0292, with no non-finite or clipped samples. All six comparison checks pass. This is a bundled delivery comparison, not an isolated test of one scoring term.

The native solo audition renders an earlier complete theme and the first completed solo with surrounding context, plus isolated solo, backing, and rhythm stems. For `glass-garden`, the 9.20-second solo contains 22 notes within a 16.36-second excerpt. All nine connected note boundaries and all four joins within its five-note run pass waveform continuity checks. Three deliberate breaths have no overlapping source events. Solo RMS is 0.02901 versus backing 0.02147 (+2.61 dB); mix peak is 0.14140 with no non-finite or clipped samples. Declared solo entrance, arrival, and landing cues have actual support from three or four parts. All ten checks pass.

A **35-second live browser run** temporarily removed native `cancelAndHoldAtTime` and exercised the compatibility path using saved seed `bright-tide-f765d2db18eecb3a` at 88 BPM. It generated and heard 26 frames, maintained a running context, and passed all six clock/signal/error checks. Every five-second bin contained sound, with RMS 0.0267–0.0358 and maximum sampled peak 0.1631; no errors occurred. This simulates the missing API in the in-app browser, not a direct test of the user's main Firefox profile. Main-app controls were also exercised: all six composition settings are exposed; changing and applying embellishment succeeded and its original value was restored. Live playback continued through multiple sections, Next moved from bar 28 to the full theme at bar 29, and Pause held the position at bar 32. No browser console errors were reported.

No subjective listening assessment is claimed. Actual browser synthesis, waveform measurements, musical event relationships, deterministic replay, and transport behavior were evaluated. The restrained/embellished theme and theme/solo stem players are available on `/audio-audit.html` for judging recognition, coherence, orchestral balance, and appeal by ear. Formal grammar and available motif functions remain bounded; this iteration adds controlled development and realization rather than claiming unrestricted composition.

## Version 5.0 composition, motif families, and developed solos — 2026-09-30

`npm run build` and **165 tests** pass. The production entry is 194.10 kB of JavaScript (67.05 kB gzip). The engine version is `continuum-5.0.0`: older autonomous performances are explicitly new interpretations. Existing saved recipes remain available. The four manual conformance streams are unchanged, including the 228-note MIDI example; example JSON files were regenerated.

The fixed section cycle is replaced by six causal narrative grammars with optional openings, contrasting statements, departures, delayed homecomings, and longer 8/12/16-bar statements that develop within the section. Four related motif families share a seed fingerprint but have distinct questions and answers. A family must actually emit its entire question and answer before it can supply a solo. Heard descendants retain their family, and four anchors plus fourteen descendants bound the archive. High variation preserves the identifying head. The form and harmony share stable tonal regions, and important foreground notes contribute to a separate melodic-support objective. This is a musical preference, not spectral roughness.

Twenty conductor tests cover causal family order, different routes, distant lookup, contiguous sections, exact bar inverses, stable BPM, and isolated native-tuning journeys. Review found and removed an optional duplicate A reply in one grammar. Solo tests cover four different musical arguments, literal opening quotations, contrary-step recovery after leaps, distinct connected scale steps, held arrivals, breathing gaps, tuning precision, bounded register, and deterministic variation. Integration tests verify native harmonic targets and complete emitted exposition; one test exposed a fragment mutation that could erase its identifying head, which is now protected.

All eight pinned Node/browser event fixtures agree. Autonomous hashes are `85aef455` / `f42d4485`, and phrased hashes are `5ad278d3` / `92f1b3f2`. The manual hashes remain `f2561254`, `24265aeb`, `8ff90f42`, and `7502484a`.

Three six-cycle phrasing audits generated 758–856 frames and 98–107 phrases per seed, averaging 2.70–3.75 ms/frame during concurrent verification. Each sounded all four lead roles, developed 20–31 heard descendants over time, and kept its archive at or below 18. The runs contained 20–24 complete solo passages, 27–32 rhythm relays, and 23–24 ensemble pauses with zero overlapping events. First solos arrive after their themes at 51.6–114.4 seconds for these seeds. These counts establish structured variety and constraints, not musical quality. The original high-mobility/smoothness acceptance run still has mean upper movement 49.2 cents, every upper step within 200 cents, and 96 distinct pitch collections over 128 frames.

The native Web Audio solo audit renders the first complete solo with one bar of context on either side and a separate earlier theme from the same family. For `glass-garden`, the 16.36-second excerpt contains a 20-note, 9.20-second solo quoting theme A, then sequencing, extending, running, holding an arrival, and landing. It begins at 91.02 seconds of the composition. All ten measured connected joins passed continuity checks, including all four joins of the five-note run. Both deliberate breaths contain no overlapping source events and retain natural effect tails. Solo RMS is 0.02392 versus backing RMS 0.01309 (+5.23 dB); the mix peak is 0.12344 with no non-finite or clipped samples. All nine audit checks pass. The audit page supplies theme, full mix, isolated solo, accompaniment, and rhythm players.

A separate **35-second live browser check** deliberately removed `AudioParam.cancelAndHoldAtTime`, exercising the Firefox-compatible path with the saved wide-exploration recipe `misty-signal-5507b3c23bc4e15a`. All six checks passed: 26 generated and heard frames, a continuously advancing clock, running context, finite unclipped output, and no errors. Every five-second bin contained sound (RMS 0.00755–0.02171; maximum sampled peak 0.08717). This checks the missing capability in the in-app browser, not the user's main Firefox profile. Main-app Play, live Next section, and Pause were also exercised; the jump reached the full theme at bar 5 and continued normally at 88 BPM with no console errors.

No subjective listening assessment is claimed. Event relationships, native synthesized signal, live scheduling, UI state, and replay were evaluated. The rendered theme/solo comparison is available for judging recognition, coherence, and musical appeal by ear.

## Version 4.2 playback compatibility and variation — 2026-09-30

`npm run build` and **146 tests** pass. The production entry is 179.63 kB of JavaScript (61.81 kB gzip).

The user supplied a reproducible Firefox-profile exception: `cancelAndHoldAtTime is not a function` at the second beat. Scheduling called the unsupported method and error cleanup called it again, hiding the initial failure. A capability-checked automation adapter now reconstructs future held values for the rack's set, linear, exponential and target curves. Error cleanup preserves the primary exception. Numeric regressions cover future holds, repeated shared-snare holds, glides, output fades, several live frames, pause/resume and shutdown with the native method removed. Browser-driven context interruptions also freeze the existing queue and expose a resumable state.

The native Web Audio compatibility audit temporarily removed `AudioParam.cancelAndHoldAtTime` and ran for **35 seconds** using seed `velvet-current-e50fff995341df8b`, at 82 BPM with wide exploration. It generated 24 frames, remained in a running context, advanced from tick 0 past 22,824, and reported no errors. All seven five-second bins contained audio: RMS 0.00850–0.02395, maximum sampled peak 0.09252. All completion, progress, signal and error checks passed. This reproduces the missing capability in the in-app browser; it is not a direct retest of the user's main Firefox profile.

Variation now includes procedural metrical cells (93 distinct rhythms across 128 seeds), six solo contours and six solo rhythm families, register/articulation changes, phrase transformations, correlated seed character, five-color instrument palettes and independent groove assignments. Tests verify that low variation retains identity while high variation explores at least nine distinct solo phrases out of ten. Across 40 seeds, five major macro ranges span over 25 percentage points at full Freedom, over six times their low-Freedom ranges. Clear home/return profiles, pulse, native tuning, deterministic ordering and planned rests remain constrained.

All eight Node/browser event fixtures agree in engine `continuum-4.2.0`. The four manual streams remain unchanged. Autonomous hashes are `38116eab` / `8f5a8ee4`; phrased hashes are `8163d0e1` / `e6bb8301`. Examples were regenerated. The baseline harmonic acceptance audit still measures mean upper movement of 49.2 cents and 96 distinct pitch collections over 128 frames. Three six-cycle phrasing audits averaged 2.66–2.83 ms/frame, with bounded archives, independent rhythm relays, recurring ideas, and zero violations of composed rests. Tempo remains exactly the selected BPM unless explicitly automated.

Browser checks verified a fresh seed on plain reload, an unchanged seed with that option disabled, restore from Recent performances, shared-seed precedence over fresh-on-reload, and Wide exploration retaining BPM while clearing automation. Switching from a shared bookmark recipe clears the old URL position. Old recipes are archived before replacement; old engine versions are explicitly reinterpreted rather than labeled exact replay.

These are event, transport and rendered-signal observations. No new subjective listening assessment is claimed. The live audit and section/solo audio players remain available for listening and comparing musical coherence.

## Version 4.1 consolidation — 2026-09-30

`npm run build` and **120 tests** pass. The production entry compiles to 165.95 kB of JavaScript (57.51 kB gzip). Examples were regenerated for the new engine version; the manual MIDI fixture still contains 228 notes and retains event hash `f2561254`.

The conductor now holds the selected BPM exactly unless explicit tempo automation changes it. Section profiles hold until the final true bar. Tests check containment, contiguous boundaries and bar inverses across 2,304 sections, including layout wraps; no structural lookup gaps or overlaps were found.

Transport checks cover speaker-clock notifications, late planning, pause/resume, rapid stop/restart, stale async resumes, reentrant callbacks, and scheduler exceptions. Navigation reconstructs separately and buffers the destination phrase. The browser was exercised with repeated live jumps to bars 13 and 17, followed by a paused jump to bar 21: section, phrase and transport state agreed, tempo remained 82, and no console errors occurred. The original reported crash was not reproduced; the identified scheduler failure paths are now guarded and tested. Rendered previews are stopped when live navigation starts. A failed transport must reconstruct before playback resumes or parameter recording is allowed.

All eight pinned event streams match between Node and the browser. The four manual fixtures are unchanged. Updated autonomous hashes are `cd7a1845` (ensemble) and `e5b26bd9` (additive); phrased hashes are `8793f67a` and `42ed83f3`. Engine version is `continuum-4.1.0`, so old autonomous/phrased performances are new interpretations. The user's seed, four automation lanes, phrase configuration and bookmarks were preserved; Export exposes the original version 4.0 recipe.

Three six-cycle phrase audits measured first solos after 14.0–24.9 seconds, average passage length 2.62 bars, 57–70% theme onsets off the quarter pulse, 16–17 discovered descendants and 33–48 returns. Archives remained bounded at 18, with zero notes overlapping declared rests. Planning averaged 2.30–2.43 ms/frame. The baseline high-mobility audit retained mean upper motion 49.2 cents, every upper step within 200 cents, and 96 distinct pitch collections over 128 frames.

The final native Web Audio solo audit rendered 65.45 seconds of `glass-garden`. Its first solo contains 28 notes over 7.159 seconds, beginning at 24.886 seconds. Isolated solo RMS was 0.022772 versus accompaniment 0.012514, a 5.20 dB difference; all 25 connected note joins retained measurable PCM continuity. The full mix had peak 0.111755, no non-finite samples and no clipping. These stem measurements describe presence and articulation, not perceived musical quality.

The final same-seed phrasing on/off audit also passes every check. Phrasing-on has 514 events, including 88 solo notes, versus 543 events without phrasing. Its 100 ms RMS dynamic range is 21.64 dB versus 11.14 dB. A 1.364-second ensemble rest has no overlapping events and measures 48.34 dB below the unphrased passage in its late half; natural effect tails remain. Thus foreground solos and stronger percussion have not removed the intended spaces.

The first percussion revision failed the unchanged hat-audibility check. The final revision gives noise percussion its own bounded spectral path into the existing compressor, with a short snare body. At equal velocity 0.5, measured 3–65 ms attack RMS is 0.007764 for kick, 0.001695 for snare and 0.000930 for hat; all checks pass. The kick result is unchanged. Snare/hat attacks are stronger without increasing the master or kick. Tests ensure both snare components obey composed rests and clean up safely.

Browser preview handoff was also exercised: a playing rendered section displayed “PREVIEW PLAYING · LIVE POSITION HELD”; pressing Next stopped that media element and began the correct live section at bar 13. The instrument is left paused at the first theme, with a rendered section available for audition.

These are computational and rendered-signal observations. Subjective listening was not available to the agent; isolated solo, backing and rhythm auditions are provided for evaluating musical coherence and balance. The references guide compositional choices rather than assert imitation of a performer.

## Earlier version 4.0 phrase composition — 2026-09-30

`npm run build` and **98 tests** pass for `continuum-4.0.0`. New coverage includes deterministic phrase plans and complete replay after live edits; validated probability densities and matched samplers; native tuning, phrase ranges and frozen intentions; three scopes of planned silence; idea discovery, role exchange, age-aware returns, and bounded memory; tempo-safe source releases; and separate solo/counter MIDI tracks. The original six manual/autonomous event fixtures are unchanged when the phrase layer is disabled.

Node and the browser agree on all **eight** pinned event fixtures. The two new 192-frame `glass-garden` fixtures are `fd617c47` (phrased ensemble) and `693815c5` (phrased matched additive).

`npm run audit:phrasing` generated six cycles for each of three seeds. The runs covered 492–544 frames and 65–72 phrases, with 21–24 learned descendants, 34–49 recalls/anchor returns, 19–20 rhythm relays, and all four lead roles. The archive never exceeded 18 ideas. Every one of the 15–19 ensemble pauses per run had zero overlapping stored note events. Planning averaged 2.34–3.14 ms/frame in the concurrent verification run on this development machine.

The final browser audit rendered the actual production synthesizer with phrase composition enabled and disabled for `glass-garden`, Fluid Fusion, default sound and conductor, 48 frames / 63.396 musical seconds. Both versions contained finite, unclipped audio. The enabled passage had 558 events, including 17 solo notes and 21 counterline notes; its event hash was `28480c62`. The disabled passage had 543 events and hash `1f105bf4`.

The enabled mix peaked at 0.11609, versus 0.13037 disabled. The ratio of the 95th to 10th percentile of 100 ms RMS windows was 11.622 dB enabled and 9.936 dB disabled. This is a specific measured contrast, not a claim that louder contrast always improves music.

Nineteen rests were measured across lead, accompaniment, and ensemble scopes. All were clear of overlapping affected note events. In the 1.177-second ensemble break, late-rest RMS was 0.000317 with phrasing versus 0.025509 in the same musical interval without it, a reduction of 38.11 dB. Scoped stems preserve the actual effect tails; the audit deliberately does not equate a composed pause with exact digital zero. All seven signal/rest audit checks passed. Both complete audio players remain available from `/audio-audit.html` using **Audition phrasing on / off and measure pauses**.

The browser interface was exercised for phrase activation, visible plans/envelopes, preserved seed settings and bookmark recovery, theme playback, and the 19-EDO development transition. The phrase panel updates remembered idea roles and appearances while the audio clock advances. Direct subjective hearing remains unavailable to the agent; these are event, interface, and rendered-signal checks. The original musical references are compositional inspiration, not a claim to reproduce an artist's work or guarantee indefinite novelty.

## Version 3 autonomous composition — 2026-09-30

`npm run build` and **74 tests** pass for `continuum-3.0.0`. New tests cover actual subdivision grids, independent groove/theme identities, literal hook repetition and bounded transformations, consonant home landings, mixed-meter coordinates, glides into and out of native tunings, instrument changes, and exact replay after live overrides. High rhythmic predictability preserves literal grooves; lower predictability enables bounded bar-addressed pickups, and metric stability changes pulse-versus-offbeat accents. The previous four manual event fixtures remain unchanged.

Browser and Node agree on all six pinned event fixtures. The two new 128-frame `glass-garden` fixtures are `c0e3cfc5` (autonomous ensemble) and `bf9a2cb5` (autonomous additive). The four older fixtures below also pass under the manual path in version 3.

The actual production synthesizer rendered a complete 80.134-second form for `velvet-orbit`, using default macro parameters, autonomous freedom 0.85 and form pace 1. This produced 59 frames / 747 events, hash `413af59c`, with four meters, three groove identities, two themes, five instrument colors and two five-voice tuning transitions. Browser planning averaged 2.06 ms per frame. All samples were finite; peak amplitude was 0.1499 with no clipping. Section RMS ranged from 0.01315 (breakdown) to 0.02588 (return).

In that form, the tension macro ranged from 0.078 to 0.848, dynamics from 0.217 to 0.931, and tempo from 63.99 to 115.60 BPM. The conventional dissonance heuristic averaged 0.102 in the main theme, 0.428 at the climax and 0.118 on return. These are model diagnostics, not a claim that a numeric difference guarantees better music. The separate actual-tension diagnostic remains lower than its target in the exploratory peaks; the planner is not asserted to hit every requested tension value.

Native browser PCM analysis verified a 440 Hz → 589.11775 Hz (19-EDO) → 440 Hz glide journey across tempo changes. Measured destination errors were -0.07964 and +0.05159 cents. All five ensemble timbres rendered distinct PCM signatures with finite, unclipped energy. The matched additive instrument deliberately retains one spectrum; ensemble colors are separate from its controlled sensory model. Roughness during a glide describes the settled destination sonority, not an integrated time-varying roughness curve.

The browser interface was checked for the conductor layout, ensemble selection, paused section navigation and live transport. **Next section** reached the theme at bar 5 without playing the preceding section. MIDI tests verify meter, section and program metadata, and explicit rejection of glide/tuning-travel material. Such performances retain exact JSON and section WAV export.

These checks measured real generated events and rendered audio. Direct subjective hearing remains unavailable to the agent. The section players and full-form browser audit are provided for actual listening judgment.

## Earlier version 2 baseline record

Checked on 2026-09-30 for engine `continuum-2.0.0`. These results describe the tested fixtures and browser session, not every possible performance.

## Automated checks

`npm test` completed with **48 passing tests and no failures**. The suite includes:

- Golden event streams and independent random domains; range, voice-crossing, and integer-time constraints in both tuning engines.
- Small upper-voice motion with changing harmonic collections; motif transformations, recurrence, and bounded memory.
- Exact live-versus-replay frames in 12-TET and 19-EDO after interrupting a smooth ramp and adding a later transition. Tests preserve earlier parameter values and the planner's knowledge of future automation.
- Serialized sound configuration, Unicode sharing, unsupported-version rejection, and malformed-input handling.
- Sensory roughness behavior, spectrum-dependent interval ranking, future roughness trajectories, and an inactive roughness objective for the ensemble.
- MIDI track structure, tempo maps, interval clipping, note ordering, overlapping-note merging, and rejection of fractional/19-EDO pitches.
- Audio-duration integration across accelerating and slowing tempo boundaries, including sources already scheduled on the live audio clock.

## Browser and Node event conformance

The browser reproduced all four committed Node fixtures for seed `glass-garden`, 32 frames, default macro parameters, and engine `continuum-2.0.0`.

| Fixture | Pinned Node hash | Browser hash | Result |
| --- | --- | --- | --- |
| 12-TET ensemble | `f2561254` | `f2561254` | Pass |
| 12-TET additive, harmonic spectrum, weight 1 | `24265aeb` | `24265aeb` | Pass |
| 19-EDO additive, harmonic spectrum, weight 1 | `8ff90f42` | `8ff90f42` | Pass |
| 19-EDO additive, stretched spectrum, weight 1 | `7502484a` | `7502484a` | Pass |

The reference runtime was Node 24.14.0, V8 13.6.233.17-node.41, Windows x64. The audit compares musical events, including absolute pitches, timing, durations, and velocities; it does not compare rendered sample buffers. `src/conformance.ts` contains the fixed expected hashes. `npx tsx scripts/print-conformance.ts` reports current results without rewriting them.

This is positive evidence for the tested browser and fixtures. It is not a proof of universal equivalence across all inputs and browser engines.

## Rendered audio measurements

The browser rendered three contrasting baseline presets—Fluid Fusion, Chromatic Drift, and Dense Harmonic Motion—for 16 frames each at 44.1 kHz through the production synthesis rack. All samples were finite, the output was audible and unclipped, and effect tails decayed. Representative RMS was about 0.03 and peak amplitude about 0.13.

The same three passages were also rendered with native 19-EDO and the stretched additive spectrum. Finite-sample, clipping, and tail-decay checks passed; representative RMS was approximately 0.0359 and peak amplitude approximately 0.165.

A separate frequency/spectrum check measured a native 19-EDO additive tone:

| Measurement | Result |
| --- | --- |
| Intended fundamental | 568.01316076 Hz |
| Measured fundamental | 568.0190419 Hz |
| Frequency error | 0.0179249 cents |
| Nearest 12-TET pitch | 554.36526195 Hz |
| Intended relative partial amplitudes | 1, 0.5, 0.3, 0.18, 0.1 |
| Measured relative partial amplitudes | 1, 0.50000002, 0.30000003, 0.18000002, 0.10000002 |

These measurements verify that playback preserves a non-12-TET frequency and the modeled partial amplitudes in this fixture. They do not rate musical quality, and they do not imply sample-identical Web Audio output across browsers.

The final browser render also verified notes crossing a 40→180 BPM boundary and a 180→40 BPM boundary. Integrated durations were 0.99305556 and 1.26041667 seconds respectively. RMS immediately before note-off was 0.01681 and 0.01691; both renders were silent after release. This exercises native oscillator rescheduling, including extending an already scheduled source.

## Musical continuity and planning cost

The 128-frame high-mobility acceptance fixture produced 96 distinct pitch collections, a mean upper-voice step of 49.2 cents, and six motif recalls. All upper steps were at most 200 cents. Its mean harmonic-distance heuristic was 0.635, compared with 0.188 for the same seed with low mobility. This establishes the requested movement relationship numerically, not its artistic success.

The 64-frame native 19-EDO comparisons kept every upper step at or below 189.474 cents. Increasing roughness weight from 0 to 3 reduced mean target error from 0.172 to 0.086 with the harmonic spectrum, and from 0.172 to 0.116 with the stretched spectrum. Both retained at least 63 distinct collections. The test suite also demonstrates that the two spectra reverse the roughness ranking of a chosen pair of 19-EDO intervals.

The final Node benchmark averaged 1.3–2.1 ms per frame for 19-EDO and 1.8–2.7 ms for additive 12-TET, versus 1.7–2.1 ms for the baseline preset fixtures. Search has an eight-frame horizon and fixed candidate/beam limits. These are timings on the development machine, not guarantees for every device. Run `npm run audit:music` to reproduce the comparisons.

## Interaction and export checks

Live playback advanced to bar 9. Pause, recorded slider changes, bookmarking, a full-preset transition, and the A/B comparison interface were exercised in the browser. The comparison renders the same seed and parameter history with the roughness term off and on, and exposes both audio players and WAV links.

The MIDI encoder is covered by binary-format tests, and the supplied `examples/fluid-fusion.mid` is generated directly by that encoder. Completion of a browser-triggered download was not observed in the embedded browser session; this record does not claim it was.

Direct subjective hearing was unavailable to the agent. Signal analysis and working playback controls are not a substitute for listening. No claim is made that the agent auditioned these passages or established their artistic quality. Use the live instrument, browser audit players, and A/B render to make that judgment.
