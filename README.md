# Continuum

[Play Continuum](https://majg0.github.io/muzak/) · [Audio verification](https://majg0.github.io/muzak/audio-audit.html)

A browser instrument that composes from a seed, parameter trajectories and musical time. Themes, harmonic destinations, orchestral delivery and long-form expression share one deterministic composition plan. Four upper voices and an independent bass realize the harmony; a protected melodic argument, related answers, drums and prepared transitions give that plan a performance.

The current engine is `continuum-20.0.0`. Every `MusicEngine` uses this pipeline, including minimal library inputs and recipes containing older disabled flags. Freedom and expressive breadth change the interpretation; they do not switch composition modules on and off. Earlier engine versions are new interpretations when migrated, not exact replays. The original recipe is retained; only a complete valid older macro vector receives missing macro defaults.

## Run and verify

Use Node.js 22 or later and a modern browser with Web Audio.

```sh
npm ci
npm run dev
```

Open the Vite address, normally `http://127.0.0.1:5173`, and press **Play** to enable audio. Space toggles playback when focus is outside a control.

```sh
npm test
npx tsx scripts/audit-idea-hierarchy.ts # Recurrence, actual bass movement, pulses, inner glides and replay
npx tsx scripts/audit-melodic-intent.ts # Actual melodic intervals, held targets and source articulation
npx tsx scripts/audit-horizons.ts # Multi-section preparation, envelope rates and native residence shares
npm run audit:range       # Actual density, register, player-count, opening and replay comparisons
npm run audit:integrated  # Shared themes, harmonic realization, expression and replay
npm run audit:tools       # Heard vocabulary, deferred techniques and complete realized decisions
npm run audit:harmony     # Native destinations, core identity, actual voice movement
npx tsx scripts/print-conformance.ts  # Compare with reviewed, pinned event fixtures
npm run examples          # Regenerate example recipes and a 16-bar MIDI excerpt
npm run build
npx vite preview --host 127.0.0.1
```

The page `audio-audit.html` provides actual synthesized passages, signal reports and audio players in development and on the deployed site. The main instrument also offers rendered theme, section and A/B comparisons. See [AUDIO.md](AUDIO.md) for what those comparisons measure and [VALIDATION.md](VALIDATION.md) for recorded runs. Numeric checks cannot decide whether a piece is beautiful.

Composition, synthesis, persistence and export run in the browser without a backend or generation service. Installation needs npm access; the built application needs an HTTP server. There is no service-worker offline cache.

## Deployment

Push to `main` to publish to [GitHub Pages](https://majg0.github.io/muzak/). The [deployment workflow](.github/workflows/pages.yml) installs locked dependencies, runs the tests, builds both the instrument and audio verification page, and deploys `dist`. It derives the asset base path from GitHub Pages, so repository paths and custom domains use the same build configuration. A failed test or build prevents deployment. The workflow can also be run manually from the repository's Actions tab.

To preview the repository path locally:

```sh
npm run build -- --base=/muzak/
npx vite preview --host 127.0.0.1 --base=/muzak/
```

Open the preview server's `/muzak/` path. Generated audit reports remain local; the audit scripts, reviewed fixtures and example recipes are versioned.

## One composition, several dimensions of expression

Reusable ideas, scope, selection, realization and instrumentation have separate responsibilities. `IdeaGraph<T>` validates a DAG of scopes and reusable sets. Parents share sources by identity; a diamond contributes its shared ancestor once. An isolated scope can retain its structural parent while importing only its own sets. Theme questions and answers share their identifying head, and the occurrence compiler resolves the selected scope before writing notes. The conductor generates three to seven source families per seed; custom theme identities no longer silently become theme A. Heard variation memory remains bounded to eighteen entries including those sources.

Source invention and later development use the same `Gesture` algebra: transposition, inversion, retrograde, fragmentation, interval expansion/contraction, temporal augmentation/diminution, extension, scalar connection, arpeggiation and pedal. Operations compose in order and retain source identity. Whole candidates compete on recognizable intervals and rhythm, continuity, destination, register, reversals, accents, development and the parent's duration budget. Every tool is available; a thought uses only the feasible tools that serve its argument. Harmony, contrapuntal response, instrumental assignment and ornamentation remain specialized stages of the shared score, rather than competing legacy melody generators.

Default sources contain one short head and three or four related replies. A thought activates a subset of that vocabulary: a spacious statement and destination, an ordinary statement/recall/answer, or the fuller active route. The head takes at most four quarter pulses. Ordinary thoughts target eight to sixteen quarter pulses, with a rare explicitly eligible extension; durations follow source groups rather than growing automatically when density drops. This is a compositional budget, not a claim that all listeners or all hierarchy levels have a fixed memory capacity.

Version 20 shares one planned selector across thematic development, source selection, harmony, counterpoint and ornamentation. A stable musical scope and committed occurrence assign every vocabulary member an opportunity per cycle. Complete alternatives still have to satisfy their native constraints and fit the explicit cost allowance above the best musical candidate. Diagnostics distinguish the intended focus, eligible tools, actual uses and deferred tools. This prevents cheap local winners from monopolizing a fixed eligible vocabulary while retaining literal recall, protected arrivals and explicit language choices. Lookahead, repeated queries and cache eviction cannot consume opportunities. Changing feasibility can defer a tool across cycles; coverage is measured from heard decisions rather than promised for every short passage.

Medium-density development can visit all inherited replies over successive thoughts without reciting them all at once. Duration scaling operates where it changes the source's allocated time; fixed-span realization uses proportional rhythm and does not credit inaudible uniform scaling. Disconnected hook, solo, motif-memory and alternate phrase generators have been removed. Standalone percussion calls adapt to the same `RhythmicScore` as the live engine, and ornament generation and delivery share one periodic pitch-field lookup.

Each continuation is transformed once into a written skeleton. Its rhythm places the anchors, and hierarchical subdivisions connect them in one direction. Added density cannot loop the source contour; unsupported repeated pitches coalesce into holds unless a chosen pedal owns the repetition. Diagnostics expose actual transformation operations, costs, candidate counts and heard skeleton anchors. Full literal recall remains available, and source pitches remain fixed under explicit reharmonization or sequencing.

The formal spectra have a shared piece identity and successively finer idea sets. Contributions decrease exponentially with depth. Energy, activity, thematic density, ensemble size and register remain separate axes; candidate destinations are evaluated against continuity and formal function. The old five strategy labels describe the resulting field rather than choosing alternating preset sequences. Six explicit opening gestures and semantic arrival/withdrawal constraints remain authored boundary conditions. Prepared motion normally connects destinations; declared cuts preserve sudden contrast.

`subdivideBetweenTargets` traverses a stable tree of gaps between protected targets. Candidate rates decrease as `exp(-hierarchyDecay × metricDepth)`, modified by syncopation, gap size and direction. Rational depth recognizes tuplets as well as binary subdivisions. Increasing the attack budget preserves existing landmarks, and held source goals retain their residence. The candidate frontier and attack budget are bounded: this is an addressed, evaluated search, not exhaustive enumeration of every possible rhythm.

Counterpoint evaluates complete subjects for thematic identity, continuity, independent motion, overlapping consonance and register, including actual held/gliding pitches. Candidate imitation and contrary development compete before a cycle is committed. `SoundingScore` supplies the shared evidence of what remains sounding after replacements and rests. Committed counterpoint diagnostics expose the objectives and candidate count. `ArrangementPlan` then composes player policies for source, role, instrument, register, gain and rhythmic delivery; adding a player does not require another instrument-specific realization branch. Its default realizes the twelve-player ensemble, with protected source contours and native pitches.

These dimensions support combinations of memorable themes, color harmony, flowing lines, independent voices and asymmetric drive without artist-specific generators. They do not certify an imitation of any composer or guarantee aesthetic quality. The named composition studies and rendered audio comparisons remain listening tools.

**Idea density** changes the authored argument: spacious subjects and held answers, connected singing themes, or related clauses combining sequence, inversion, fragmentation, arpeggiation, scalar connection, quotation and sustain. Sources can ascend, descend, terrace, orbit, alternate or remain level. Their identifying gestures can use thirds, fourths, fifths, sixths, sevenths and octaves as well as steps. A leap reaches a declared field destination, receives time and emphasis, and can recover, echo or continue into another register. **Interval complexity** broadens continuation transfers; **Melodic familiarity** restrains them without rewriting the identifying head. Each occurrence is frozen before it sounds. Economical ornaments remain a separate delivery layer and cannot move the protected melody into another octave.

Ordinary legato preserves oscillator continuity but reaches the written native pitch at its onset. Only explicitly written glides slide. Phrase arrivals, repeated landmarks, ongoing connections and cadential releases have different accent/envelope treatment; an identical swell is no longer applied to every held note. The audio laboratory's **Hear melodic gestures and verify legato** action provides full-mix and isolated-lead playback plus measured native pitch probes.

**Composition studies** offers six editable starting points in the same engine: Floating lines, Developing solo, Interlocking drive, Travelling theme, Quarter-tone prism and Fine gravity. They retain the seed and tempo, clear automation, and save the previous performance. The audio laboratory renders their complete first thematic arguments as full mixes, with isolated leads for the first four studies, and reports later argument development separately. These are capability demonstrations, not certified artist imitations. See the [source-based study](public/theme-study.html#living-lines).

**Musical horizons** now work at different scales: eight-step voice planning, complete melodic arguments, independent rhythm epochs, and two-to-four-section preparation/arrival/settling. Open endings can pass a theme onward; settled destinations can close it. Flowing intensity, activity, register and ensemble envelopes are continuous at section boundaries and rate-tested within them. Rare declared cuts can still surprise. Explicit automation remains authoritative and can intentionally override that smoothness.

**Ensemble size** is independent of density and volume. Its endpoints range from one exposed melodic line without drums to twelve pitched players: bass, four harmonic voices, foreground, related counterline, lower strings, woodwind thematic doubling, brass, upper strings and a shared-pulse keyboard figure. These are lightweight synthesized colors, not sampled orchestral sections. Player entrances and exits are quantized to two-beat transport commits; known exits clip stored note tails, and newly recorded exits release earlier audio. Larger arrangements derive their pitches and accents from existing musical material. The matched additive experiment retains its five-tone reference bed instead of this orchestral expansion.

The two controls retain their initial preferences even under autonomy, with exact zero/one endpoints. Expressive trajectories vary intermediate settings; explicit automation has final authority. The new flute, brass and synth-lead spectra join strings, reed, keys, pluck, glass and round colors. The lead chooses an appropriate family for a whole thought, not a new patch on every note.

At high Freedom, sections can use broad waves, contrasting blocks, surges/releases, terraces or exposed-versus-ensemble spotlights. Six opening gestures include immediate attack, a dense swarm, sustained driving repetition, a solo entrance, open space and a broad slow ensemble. A theme can be stated at full force; a compulsory slow introduction is no longer imposed. Declared cuts can be abrupt, while flowing boundaries retain continuous envelopes.

The production `RhythmicScore` derives a reusable onset/rest subject from the theme. A shared integer subdivision kernel generates the source grouping, strong attacks, held goals and admitted detail. Bass, kick and comping speak shared accents; snare and cymbals interpret half/full/double-time feel. A phase-stable reference pulse continues through asymmetric cells and meter changes. Riff and response layers enter and retire independently. Their answers and boundary fills refine spaces between source landmarks under an attack budget, without selecting a finished fill pattern. Tempo stays under user/automation control.

**Native tuning** supports 12-TET, 19-, 24- and 31-EDO. Wide exploration enables longer tuning residences, favoring 19-EDO among the native destinations. The home tuning is preserved. Each native planner operates on its own degrees with shared physical-cent constraints; its scale and triad preferences are explicitly declared. 24-EDO uses experimental wide/narrow thirds, rather than pretending that the 12-TET theory works modulo24. Ensemble colors play native pitches directly; the matched five-partial additive instrument alone enables the spectral roughness objective. Standard MIDI stays baseline-only; exact native performance JSON and rendered WAV preserve tuning.

The four-way **idea density × ensemble size** audition on `/audio-audit.html` uses the same seed, tempo and score interval. It provides actual browser-rendered audio for spacious/dense solo and ensemble readings, along with finite-signal, clipping, density, register and thematic-identity checks. The [new reference study](public/theme-study.html#range) distinguishes primary musician testimony, published score observations and implementation inferences. No direct audition or full transcription of the cited albums is claimed.

The conductor selects the next episode from the ideas already heard, their age, recent exposure and unresolved development. It can extend a statement, answer it, introduce another family, depart, rest or recall older material. Journeys have five to twelve episodes; neither a climax nor a closing return is compulsory, and an idea can continue through a journey boundary. A theme appears before its return, and resolved development cannot justify a later supposedly unfinished arrival. Bounded 128-section cache blocks retain fixed aggregate geometry for fast distant seeking, while composing fresh episode order and duration assignments. Meter, timbre and tuning journeys can change; BPM remains fixed unless the user edits or automates tempo.

A `ThemeCore` starts with a generated accent cell and a bounded search for an identifying interval gesture. Related goal paths build a source graph; a single occurrence compiler allocates its time, connects destinations and spends a density budget on subdivisions. It replaces the former three grammar templates and separate slow/fast melody generators. A familiar opening fingerprint can return while goal order, interval width, temporal emphasis and connecting material develop. Literal recall is less frequent; explicit fixed-melody treatments still preserve the complete source. A source-aware thought allocator permits unequal argument lengths across barlines. Source IDs identify reusable material; occurrence IDs identify performances. The memory shelf contains material that has actually sounded.

The harmonic director plans destinations against the complete authored melody before the local voice planner chooses registers. Available relations include functional preparation, common-tone P/R/L transformations, and third-cycle regions with dominant preparations. Authentic, half, plagal and deceptive cadences use explicit preparations and arrivals; a single structural window does not claim a cadence it cannot prepare. Held melodic targets are weighted by actual overlap and structural importance. Physical close-neighbor penalties help the chosen voicing leave room for sustained melody.

Harmonic root identity is separate from upper-voice placement. A structural bass attack establishes the root, while weaker bass attacks traverse actual chord members in the native grid, with group-aware register movement and root approaches. They respect the physical bass range and upper-voice gap. Local search can move all four upper voices together, preserving native ranges and order. High smoothness normally admits up to 300 cents in 12-TET or five 19-EDO steps; if a complete in-range destination requires more, the minimum necessary larger bound is admitted. Diagnostics distinguish planned identity from actual root and chord-tone agreement.

The harmonic treatments declare what remains fixed:

- **Keep the head:** develop a permitted continuation while retaining the identifying subject.
- **Keep the melody:** preserve the authored pitches and rhythm while changing harmonic support.
- **Keep intervals & rhythm:** move the whole argument through a shared planned region.

Expressive delivery can add small native-scale links in suitable continuations. It preserves the head, prepared high point and cadence. The counterline quotes thematic material on its own clock and leaves calm passages open; it does not introduce an unrelated melody vocabulary. Shared cues, pulse figures and fills coordinate the backing without requiring every part to double every lead attack.

**Freedom** controls the conductor's macro variation. **Dynamic range** controls the shared expressive reading independently: low Freedom does not suppress the composition's crescendos and retreats. Long intensity arcs, shorter phrase breaths, register direction and accents are related but distinct. They affect actual pacing, density, brightness, gates and attack strength. Calm accompaniment holds the current destination, moderate passages use connected movement, and crests develop the shared pulse across parts. Held tones end at harmonic changes. The quiet dynamic floor remains audible; the final gain and velocity ceiling also apply to late counterline and fill events.

Meter now derives from a source cell's span and grouping. A residence carries that pulse through at least four whole sections; another theme can converse over it without forcing a new time signature. A transfer of pulse requires the arriving argument to adopt the new source. Source-owned duration pools preserve bounded navigation and transport alignment. The source repertoire is generated, while native fields, instrument spectra and physical ranges remain explicit bounded choices. Standalone compatibility adapters remain available.

The [theme study](public/theme-study.html), served at `/theme-study.html`, preserves the research and listening references behind the thematic and harmonic tools. These are original bounded generators, not transcriptions or artist imitation models.

## Controls, playback and saving

- **Play / Pause / Exact replay:** Pause preserves the audio-clock position, including held sound. Exact replay rebuilds the recipe from its beginning. A composed breath keeps musical time moving; it is different from pausing transport.
- **Seeds:** Enter, copy or randomize a seed. **New seed on reload** is enabled by default: settings and automation stay, while the previous recipe and bookmarks enter **Recent performances**. Shared links retain their encoded seed. Turn this setting off to retain the current seed on reload.
- **Sound worlds and macros:** Presets provide starting vectors for 26 musical controls. **Reset A** captures a morph origin; the morph slider moves toward another preset. Tempo morphing is logarithmic. Lyrical and Wide exploration recipes are contrasting settings of the same composer.
- **Wide exploration:** Creates a fresh, serialized character with correlated macro and composition settings, preserving BPM and sound configuration. It archives the current recipe and clears its automation so the new form can develop. A normal seed change preserves automation.
- **Form and expression:** Freedom, Form pace and Tuning journeys & glides shape the interpretation. **Apply & restart** rebuilds the same seed. **Next section** seeks immediately; otherwise sections complete naturally. The expression display shows intended energy, activity, register, sustain, accents and texture, with recent scored ranges. These are score intentions, not measured audio loudness.
- **Theme, development & expression:** Inspect the hook's interval/rhythm fingerprint, related motif destinations and source-phrase applications. The live idea map highlights the current motif. **Find the pulse** shows metrical grouping beside independent reference and hook clocks, plus the scored parts at the playhead. Cycle displays show phase and planned participation, not continuous sound. Transition labels say **Planned** because shared breaks can shorten their preparation. Composition settings rebuild the plan when applied.
- **Harmonic direction:** Harmonic pace, departure/surprise, arrival strength, strategy and treatment shape the destination plan. **Render theme comparison** provides the same core alone and with different harmonic readings; its report checks retained melody identity and distinct resulting accompaniments.
- **Automation:** Schedule a single control or full preset transition over true musical bars, using linear, smooth or step interpolation. Live sliders and morphs record edits at the next uncommitted boundary. Already scheduled audio can take a short time to reflect an edit. Clear timeline restarts without its lanes; Restore timeline offers one in-memory undo.
- **Bookmarks:** Save an interesting tick, reconstruct to it, or copy its performance link. Distant positions require generating prior history. A bookmark is not an audio clip or instant engine snapshot.
- **Persistence:** Save custom presets locally; export performance JSON for the full durable recipe. Recent history holds at most ten recipes within a bounded storage budget. Clearing browser storage removes local sessions and presets.
- **Sharing:** A performance URL encodes the recipe in its fragment. Recipients need the application hosted somewhere accessible. Long recordings may exceed practical URL limits; use JSON instead.
- **Exports:** MIDI selection follows actual bars and includes independent parts, velocities, tempo and meter changes. Standard MIDI requires 12-TET with tuning journeys disabled and rejects fractional pitches or explicit glides instead of rounding them. Held gain envelopes are not MIDI controllers. Use JSON for exact reconstruction and rendered WAV for the synthesized result.

Before first playback, macro edits define the starting character. During playback, recorded parameter lanes take precedence over both conductor and expression mappings until another point changes them. Clear the timeline to restore automatic control of those parameters. Configuration changes restart rather than silently rewriting an already authored theme.

The [examples](examples) directory contains importable recipes and a MIDI excerpt. Older disabled flags in a recipe no longer select a separate unphrased engine. Regenerate examples with the current version when comparing output.

## Tuning and the additive exception

Pitch events use integer thousandths of a cent. The 12-TET planner works in integer MIDI-note coordinates and converts explicitly; the native planner works in degrees of its selected 19-, 24- or 31-EDO grid. Native pitches are never rounded to semitones for synthesis. Declared native triads, fifths and common-tone transformations are limited compositional analogues; region cycles are explicitly chosen for each space, rather than reusing a twelve-entry tonal table modulo another number.

Warm ensemble realizes changing instrument colors, velocity, held gain curves and articulation in all four tunings. Matched additive uses the exact five-partial spectrum evaluated by sensory roughness. Applying home tuning or spectrum settings restarts the performance; prepared autonomous tuning journeys preserve the continuing composition.

The additive instrument is a deliberate **instrument-adapter exception**, not a second composition pipeline. It holds four harmonic voices plus the root bass through each harmonic window, preserving the five-tone reference sonority and the exact configured partial amplitudes. It omits extra pitched coordination/counterline attacks and bypasses ensemble velocity scaling, gain swells and spectral effects. Thematic melody, harmonic development, explicit rests and tuning journeys still exist. Percussion and foreground melody are outside the static harmonic-bed roughness model.

Sensory roughness uses the same five partial ratios and amplitudes as additive synthesis at actual frequencies. Warm ensemble does not claim that spectral match, so its roughness contribution is inactive. Roughness is distinct from functional expectation, harmonic tension and orchestral activity. Its `raw / (raw + 5)` display scale is an engineering convention, not a probability or aesthetic verdict. During glides, diagnostics describe the destination sonority rather than integrating the moving spectrum.

## Architecture and exact replay

`new MusicEngine(config).step()` commits a frame without the DOM or audio system. Musical time is integer ticks at 480 PPQ, with 960 ticks per planning frame. Audio seconds are derived separately from tempo.

| Module | Responsibility |
| --- | --- |
| `composition-profile.ts` | Normalize every recipe into one mandatory runtime composition profile |
| `engine/score-timeline.ts` | Combine form, expression and parameter trajectories; apply explicit automation last |
| `engine/idea-graph.ts`, `idea-kernel.ts` | Validated shared/isolated source scopes, evaluated choices, multiscale spectra and exponential rhythmic refinement |
| `engine/idea-selection.ts`, `idea-tools.ts` | Scoped vocabulary opportunities, explicit cost bounds, composed gesture operations and truthful coverage |
| `engine/composition-expression.ts`, `expression.ts`, `texture.ts` | Continuous multidimensional expression, macro mapping and shared attack policy |
| `conductor.ts` | Causal narrative routes, true meter/bar lookup, recurring families and tuning journeys |
| `engine/theme-core.ts`, `theme-realization.ts`, `phrase.ts` | Authored source arguments, protected delivery, actual hierarchy, rests and heard memory |
| `engine/harmonic-director.ts`, `harmonic-tools.ts` | Melody-aware destination routes, cadences, native transformations and realization diagnostics |
| `engine/planner.ts`, `analysis.ts`, `edo19.ts` | Native constrained voicing candidates and receding-horizon search |
| `engine/accompaniment.ts`, `groove.ts`, `counterpoint.ts` | Delivery of the current harmony, rhythmic identities and thematic answers |
| `engine/ensemble.ts`, `transitions.ts`, `ensemble-fill.ts` | Shared attacks, known preparations, rest constraints and final orchestral dynamics |
| `engine/arrangement.ts`, `sounding-harmony.ts` | Declarative physical player policies and shared sustained-note evidence |
| `engine/random.ts` | Stateless addressed randomness with independent decision domains |
| `pitch.ts`, `spectrum.ts`, `roughness.ts` | Fixed-point pitches, explicit tuning adapters and matched spectral model |
| `parameters.ts`, `serialization.ts`, `sessions.ts` | Macro vectors, automation, validation, sharing and preserved history |
| `audio.ts`, `note-expression.ts`, `midi.ts` | Audio-clock scheduling, synthesis, expressive envelopes, offline rendering and MIDI |
| `conformance.ts` | Pinned event fixtures shared by Node and browser audits |

Exact replay requires the same engine version, seed, starting vector, resolved conductor/composition/harmony settings, sound, weights, automation and **automation knowledge revisions**. A future transition added during playback must not become visible to earlier planning steps on replay. Revisions record when complete trajectory snapshots became known. Interrupted ramps retain their original endpoint; direct modification of an earlier point could otherwise change the past. Use `recordLiveParameters` and `scheduleParameterTransition` to record edits.

`resolveCompositionProfile` is the compatibility boundary: form, ThemeCore, harmonic direction and phrase delivery are always present. `conductor.enabled: false` maps to zero macro freedom. Old `phrasing.enabled` and `character` fields do not remove stages or choose alternate composers. Nested settings remain serializable, including compatibility fields; effective generation follows the shared pipeline described above.

The melody controls apply when the next thematic argument is authored. Recurrence favors literal returns; familiarity preserves the remembered steps and contour; transformation permits bounded continuation edits, register motion and decorative links. The identifying head, prepared high point and cadential approach remain protected. Explicit fixed-melody and sequence treatments preserve their declared relationships. Counterlines recall the same source mode, including minor themes, on their independent clocks.

The UI recognizes earlier version 2–19 recipes in sessions, imports, shared links and Recent performances. It preserves their original JSON before reinterpreting settings under version 20 and reports that change. **Export → Download original … recipe** retains the original document. If preserving the backup fails, the original session is not overwritten. Strict library parsing still rejects a mismatched engine version; the UI migration is explicit. New seed on reload can then start a fresh seed while keeping the prior recipe recoverable.

Version 13 intentionally changes formerly separate streams. Omission of a new setting does not promise a pre-v13 event hash. Import sizes, point counts, history and retained UI frames are bounded; old moments can be regenerated, but an indefinitely growing manual recording is not unlimited storage.

## What validation establishes

Tests check reproducible events, native ranges, protected source identity, chord/root realization, meaningful recurrence, actual rest clipping, uninterrupted expression across boundaries, tempo precedence, single final gain application, additive reference coverage, live-edit knowledge replay and export encoding. Signal audits examine rendered finite samples, clipping, levels, pitch spectra, timing and tails. Neither category establishes subjective quality.

Conformance compares committed events with reviewed Node-generated constants; the audit does not calculate its expected answer from the runtime being tested. Historical fixture names may describe their original input recipes, but all now enter the same composition pipeline. A passing browser report establishes agreement for those cases. Floating-point sensory calculations and differing Web Audio implementations prevent finite fixtures from proving every possible runtime or waveform identical.

[VALIDATION.md](VALIDATION.md) keeps actual measurements and historical version results separate from these implementation descriptions.
