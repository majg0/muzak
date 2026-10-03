# Harmonic motion: relationships in context

Continuum treats a progression as an **editable trajectory of voiced sonorities through explicit contexts**. A useful answer to “what can follow this chord?” includes the actual member motions, the destination's relation to a supplied center, the remembered passage, and the musical convention being invoked. No single distance supplies all of these answers. A geometrically close chord may leave the tonic; a large bass leap may accompany a convincing return; the same sound may support different functions at different structural depths.

This is a foundation and an executable laboratory contract, not a claim to have discovered a universal harmonic law. The shipped lab exhausts a declared finite catalog. Its descriptors do not estimate listener preferences, emotional responses, key probabilities or next-chord probabilities.

## Objects, coordinates and uncertainty

A sonority consists of individually identified sounding members with native pitch and register. Its optional proposed root, chord quality, spelling, bass role and voice correspondence are separate information. Doublings remain separate members. A pitch-class projection can summarize a chord but cannot replace its realization or recover member identity.

The minimal pitch coordinate is an absolute logarithmic value. In native realization this is integer millicents; a difference of 100,000 is 100 cents. A period is optional. For declared positive period `P`, pitch-class distance is `min_k |y - x + kP|`; without one it is ordinary absolute distance. Class equivalence never changes the source pitch. An octave, equal temperament, twelve classes, a major/minor vocabulary and a seven-degree collection are independent conventions, not axioms. Irrational ratios and equal divisions that do not land on integer millicents require an explicitly approximate native realization.

A context frame supplies a center and may also supply a collection and a target sonority. “Center” means a reference against which relations are measured; it need not be a common-practice major/minor tonic. Several frames may coexist: home center, local tonicization, modal final, or intended destination. They remain separately inspectable. In the lab, `global`, `local` and `alternative` are supplied descriptive roles with independent preference weights. They do not establish a hierarchy, posterior probabilities or a unique parse, and there is no per-step inferred modulation schedule. No frame means unknown centricity. A collection alone is not a center: C major and A Aeolian can share pitch classes while implying different returns.

The conceptual context at time `t` is

`K_t = (active frames, heard history, metrical/phrase position, style premises, performance premises)`.

The current lab implements supplied frames and duration-weighted heard history. Structural hierarchy, phrase interpretation, learned style expectations and spectral models are extension points, not hidden default inputs. Listening-time evidence stops before the candidate; a retrospective analysis using future events must declare that additional input.

## A transition has several answers

For voiced sonorities `A` and `B`, retain a relationship vector `R(A, B | K)` with independent coordinates:

| Coordinate | What it answers | What it does not establish |
| --- | --- | --- |
| Member motion | Which source member can continue to which destination, with exact signed/register displacement and entering/leaving members? | The true voices or the intended resolution |
| Common members | Which pitches or declared period classes persist? | Shared parameters, event identity or melodic continuity |
| Root and bass motion | How do supplied roots and observed lowest pitches move separately? | Harmonic function from bass alone |
| Frame relation | How are root, members and destination related to each supplied center/collection/target? | The correct center, mode or structural depth |
| History relation | How much candidate content has been exposed earlier, for how long and how recently? | A trained expectation model or a phrase boundary |
| Convention cues | Does this pair instantiate a precisely scoped transformation or progression pattern? | A full cadence, stylistic suitability or universal effect |
| Performance/spectral relation | How do timing, articulation, register, spectra and level change? | Emotion or harmonic quality from a roughness number |

The last coordinate needs an explicit model and is not currently scored. All reported measurements state their units and missing values. Do not blend unavailable evidence into a numerical zero.

An assignment minimizing total absolute register displacement is a **possible economical correspondence**. The lab first matches the maximum possible number of distinct members, then minimizes the sum of their absolute register displacements over every injective assignment. It reports a representative and exact tie count for every atlas pair, all minimum assignments for the selected pair, unmatched members, and minimum-assignment support counts for target-entry links. A representative does not establish recovered voice identity. The lab currently accepts no authored correspondence constraint. If one is added, actual supplied correspondence must remain distinct from a geometry-derived proposal. A nearest destination tone is particularly weak resolution evidence: B entering any member of C major is different from B ascending to C. Pitch-class distance is an additional projection; it is not substituted for signed/register motion. Geometrical chord spaces motivate this distinction between chords and paths between their realizations. [Tymoczko, “The Geometry of Musical Chords” (2006)](https://www.brainmusic.org/EducationalActivities/Tymoczko_chords2006.pdf).

For unequal cardinalities, account explicitly for entry and exit. They are orchestration changes, not infinitely fast notes or silent hidden doublings. Pairwise minima also need not compose into one continuous voice assignment across a whole passage. A later passage optimizer must solve that separate problem and preserve its competing solutions.

History can retain exposure `E(c) = sum_i duration_i × membership_i(c)`, optionally under a declared recency kernel. Keep accumulated exposure and total duration visible alongside normalized overlap. Two histories with equal normalized distributions can have different exposure; two with equal exposure can have different event order. A histogram therefore provides memory of content, not sequence grammar. Silence does not by itself erase the center or reset history.

The theoretical object “what comes next” is a conditional distribution over complete realizable continuations, given `K`, not merely a root-to-root matrix. A future model must identify its training lineage, listener/style population, inputs and calibration before its outputs can be called probabilities. Short- and long-term learned regularities are a plausible basis for expectation, but evidence from melodic models is not validation of this lab's chord descriptors. [Pearce, “Statistical learning and probabilistic prediction in music cognition” (2018)](https://www.marcus-pearce.com/assets/papers/Pearce2018.pdf).

## Named theories become scoped views

The common foundation is exact realization plus contextual relationships. Each named system selects useful coordinates and admits particular operations; none has to be discarded or promoted into a law for all music.

A substitution states `(original, replacement, preserved relationship, context)`. It may preserve selected melodic endpoints, target function, collection, root, or a phrase role while changing the other coordinates. “Substitute” therefore does not mean that two chords are equal, globally interchangeable, or transitively equivalent through every other substitution. The proof is an admitted edit and its complete downstream realization. A cycle likewise can restore the starting chord without restoring register, voice identity, center history or phrase position.

| View | Representation in the common foundation | Essential qualification |
| --- | --- | --- |
| Classical functional motion | Root/degree and realized chord relative to home/local frames, with directed member resolutions and phrase evidence | V–I content is only a cadence cue; cadence classification also needs position, preparation, bass, melody and convention |
| Modal centricity | A supplied center/final independent of collection and optional dominant function | A mode is not obtained by renaming a major key while keeping all functional assumptions |
| Jazz substitution | Alternative realizations that preserve a declared role or selected member relationships, with bass, melody and extensions exposed | Interchangeability is conditional; equal guide-tone classes do not make every realization equivalent |
| Tonnetz / P, L, R | Relations within a specified triad family; P: C major↔C minor, L: C major↔E minor, R: C major↔A minor | These standard operations are involutions on major/minor triads in their declared domain, not general tonic-directed arrows |
| Equal-division center cycles | Repeated transposition of local frames, with independently composed approaches and resolutions | A cycle describes its route; it does not determine a home center, melody or temporal grammar |
| Xenharmonic systems | Arbitrary native members, optional nonoctave period, independent collections/centers and tuning-specific transformations | “Nearest 12-TET chord” is a lossy diagnostic, never the native object or its automatically inherited function |

In tonal jazz, G7 and D♭7 can provide alternatives before C while changing the root/bass approach. Their common sounding guide-tone classes B/C♭ and F do not erase exchanged third/seventh roles, notation, register or possible destination choices. This is a useful example of simultaneous tonal and member-motion syntax. [McClimon, “Transformations in Tonal Jazz” (2017)](https://www.mtosmt.org/issues/mto.17.23.1/mto.17.23.1.mcclimon.php); [Smither, “Guide-Tone Space” (2019)](https://mtosmt.org/issues/mto.19.25.2/mto.19.25.2.smither.html).

For example, D7→G can be compared with a G-centered target while the passage retains a C home frame. Its local arrival need not assert that the whole passage has modulated. A modal G-major→A-minor return in an A-Aeolian frame can be inspected without fabricating G♯→A leading-tone motion. These are supplied readings to compare and audition, not automatically recovered functional labels.

The standard triadic operations have a finite algebra that can be enumerated exactly. Their compositional order must be explicit. Their Tonnetz paths describe particular transformations, whereas a tonal interpretation additionally names a center and context. [Peck, “A GAP Tutorial for Transformational Music Theory,” §5 (2011)](https://mtosmt.org/issues/mto.11.17.1/mto.11.17.1.peck.html).

Major-third cycles associated with Coltrane can be constructed from equal center spacing plus local dominant or ii–V approaches. Changing the direction, entry point, approach, harmonic rhythm or melody produces different passages while preserving the center-cycle premise. The lab's synthetic cycles are compositional controls, not transcriptions, style models or an algorithm containing a composer's identity. Bleij's analysis compares Coltrane-related sequential gestures with Shorter's changed ordering and interlocking, demonstrating why a root cycle alone is insufficient. [Bleij, “Three Multifaceted Compositions by Wayne Shorter” (2019), §§62–66](https://mtosmt.org/issues/mto.19.25.4/mto.19.25.4.bleij.html).

For a period `P`, an equal `n`-center division has ideal increment `P/n`; closure follows from `n(P/n)=P`. In an equal-step system of `N` classes, repeated integer step `s` closes after `N/gcd(N,s)` steps. This arithmetic generalizes cyclic construction. It proves neither perceptual equivalence of periods nor a favored direction. Native rounding must not silently turn an approximate closure into an exact one.

## Effects require a frame and a comparison

“Arrival,” “departure,” “continuation,” “deflection,” “brightening,” and “tension” name different judgments. Define the measurable component and the contrast before attributing an effect:

- Arrival can have stronger overlap with a declared target, root arrival at a supplied center, or actual directed member resolutions. These can disagree.
- Departure can introduce collection-external content or move away from a target while keeping exceptionally smooth voices.
- Continuation can preserve a common member, prolong an authored harmonic parameter, or repeat a progression schema. Those are different claims.
- Deflection requires an established expectation or authored intended destination. A surprising-looking chord is not sufficient evidence.
- Brightness, roughness, arousal, pleasantness and closure need separate perceptual definitions. A dominant seventh in a blues tonic position is a useful control against “seventh chord equals unresolved dominant.”

Lerdahl and Krumhansl explicitly distinguish surface dissonance, hierarchical stability and directed attraction in their tonal-tension model. That supports retaining multiple levels and components; it does not license applying its common-practice priors unchanged to modal, post-tonal or arbitrary-tuning music. [“Modeling Tonal Tension” (2007)](https://www.fredlerdahl.com/s/Modeling-Tonal-Tension.pdf).

A sensory model additionally needs register, reference frequency, partial frequencies and amplitudes. Changing spectra can change modeled interval roughness while leaving symbolic members and their progression unchanged. This is why pitch relations alone cannot determine xenharmonic consonance or musical value. The current audition voice is not a matched-spectrum experiment. [Sethares, “Relating Tuning and Timbre”](https://sethares.engr.wisc.edu/consemi.html).

## One exhaustive lab, a finite declared universe

Harmonic Motion is one session with a supplied chord catalog, frames, heard history and a passage. The atlas evaluates every ordered catalog pair, including identity: `N` chords produce `N²` transitions. An exhaustive row has exactly `N` destinations. This covers the admitted catalog and configured metrics; it does not cover every voicing, tuning, chord interpretation, rhythm, context or musical language. Catalog size and resource limits are visible, and exceeded limits fail explicitly.

The lab keeps geometric relations, frame relations and history descriptors separate. Select a pair to inspect witnesses; build a passage to hear a sequence; change a frame to compare interpretation under unchanged notes; edit a shared harmonic value to hear dependent occurrences change. Chord naming is display metadata, not inference evidence. Declared centers are compositional premises, not discovered tonic estimates.

### Implemented preference objective

The native contract is [harmonic_motion.rs](../../crates/muzak-core/src/harmonic_motion.rs). It orders every successor by the sum of eight explicit contributions; smaller cost is preferred. Weight signs can reverse a preference. All weights zero leaves all destinations tied. This objective is authored, untrained and uncalibrated; a ranked first choice is not evidence of listener agreement.

Let `D(B, S)` be the mean, over every sounded member of `B`, of its distance to the nearest member of `S`, in cents. Distances use the declared period, or absolute native pitch without one. An empty `S` gives an unavailable value. This directional, many-to-one comparison is independent of the register-sensitive injection used for member motion. `D(B, S)=0` says that every member of `B` is in `S`; it does **not** say that `B` realizes all of `S`.

For each frame, translate its collection and target offsets by its center. A frame-averaged value is `sum(frameWeight × availableValue) / sum(availableFrameWeights)`; zero-weight frames remain visible and have no objective influence. With no positive weight on an available value, the aggregate is unavailable. Frame weights are preferences, not posterior masses.

| Factor | Reported value | Contribution with weight `w` |
| --- | --- | --- |
| Member motion | Mean absolute displacement of a minimum-cost maximum-cardinality register injection, cents | `w × value / 100` |
| Arrivals / departures | Absolute member-count difference | `w × value` |
| Common tones | Multiset intersection count under the declared period, or exact native pitch without one | `−w × value` |
| Collection distance | Frame-averaged `D(destination, collection)`, cents | `w × value / 100` |
| Target distance | Frame-averaged `D(destination, target)`, cents | `w × value / 100` |
| Target approach | Frame-averaged `D(source, target) − D(destination, target)`, cents | `−w × value / 100` |
| History distance | `sum(duration_i × D(destination, pastChord_i)) / sum(duration_i)`, cents | `w × value / 100` |
| Identity exposure | Fraction of history duration using the destination's exact catalog ID | `w × value` |

An unavailable factor remains `null` and contributes zero to this particular objective. That convention is an omitted preference term, not evidence that the measurement is zero. Cost ties use an absolute tolerance of `10^-9`; lexical ID ordering only makes their display deterministic. Total history duration is reported independently of normalized history factors. The implementation uses no recency decay, learned transition counts or confidence derived from exposure. Repeated equal pitches with different IDs are not repeated parameter identity.

Successor comparisons use the selected source and the entire supplied history; the source is not implicitly appended. Each passage-edge comparison instead uses only the history prefix through that edge's source, excluding the destination and all later steps. This separates exploratory continuation from leakage-free prefix inspection.

Admission is finite: 1–64 catalog chords, 1–8 ordered members each, 0–8 frames, and 0–128 history steps. Native coordinates have absolute value at most `10^12` millicents; a supplied period is positive and at most that bound. A frame permits at most 128 collection offsets and 128 target offsets. Frame weights lie in `[0, 100]`, factor weights in `[−100, 100]`, and tempo in `[20, 400]`. Duration numerators are 1–64 and denominators 1–1024, in quarter notes. Realization derives a common exact grid from reduced duration denominators, arpeggio cardinalities and the authored 9/10 gate, rejecting a required PPQ above 1,000,000. Empty history realizes an empty score and leaves history factors unavailable. Inputs retain rational durations; analysis summaries use floating-point cents and quarters. Native-valid timing and pitch still need to pass the separate standard-MIDI loss checks.

Rust owns catalog construction, validation, relationship computation and passage preparation. TypeScript owns controls, views, session state and device calls. Audition uses a `CompositionPlan` compiled by the existing decoder, with shared harmonic palettes and materials; no atlas-only note emitter exists. Separate occurrences retain separate emissions. Standard MIDI export must reject native pitches that it cannot preserve.

Finite controls define the useful contrasts, independent of any held-out repertoire. Named stylistic examples are listening/edit experiments; implementation properties additionally require automated checks:

| Contrast | Required observation |
| --- | --- |
| Same G7→C, center C versus F | Exact notes and pair geometry agree; center-relative interpretation changes |
| C major versus A Aeolian frame over the same collection | Collection fit can agree while center coordinates differ |
| C→Am versus Am→C | Symmetric geometric cost does not force equal directed/frame readings |
| G7→C versus D♭7→C | Common guide-tone classes coexist with different roots, bass motions and member roles |
| P/P, L/L, R/R within the admitted triads | The second operation returns the starting triad; unsupported qualities get no fabricated operation |
| Equal-third cycle, reversed cycle and new entry point | The center route closes arithmetically while the heard trajectory changes |
| Same pitch classes, changed register/inversion | Class overlap stays fixed; signed/register correspondence and bass can change |
| Doubled equal pitches edited independently | Distinct members/emissions remain distinct; alignment ambiguity is reported |
| Same immediate pair, changed duration-weighted prior passage | Pair geometry remains fixed; history exposure changes |
| Unknown center and empty history | Unknown inputs remain unavailable; no artificial tonic or reset is inferred |
| 19 equal divisions, arbitrary nonoctave period, absent period | Native geometry remains meaningful; unsupported 12-TET convention cues remain absent |
| Shared palette edit on a repeated complete passage | Every bound occurrence changes through the compiler; independent rhythm/identity stays intact |

These are implementation and counterfactual gates. They are not independent listener validation. The next substantial advance is a useful passage comparison: hold its musical premise explicit, change one relationship, regenerate its dependents, audition both, and record what listeners judge. Only then consider a learned selection model under a fixed evaluation contract. Never replace this with a larger catalog of untested labels.

All linked primary texts were checked on 2026-10-03. This document's coordinate contract and laboratory design are Continuum's synthesis; citations identify supporting theory and evidence, not validation of the implemented metrics.
