# Executable patterns and voices

A pattern is a finite arrangement of typed values over exact rational time. Its
time partition, values and musical interpretation are distinct. Numeric zero is
an ordinary value. A two-unit cell followed by a one-unit cell occupies three
units; an independent boolean mask decides which cells sound. Silence preserves
time and does not imply a pitch, a subdivision, or a weak observation.

`pattern.rs` provides `Pattern<T>` and the `PatternValue` trait. The same
traversal, reference validation, rational geometry and bounded evaluation work
for integer coordinates, boolean masks and ordered collections. Integers admit
addition/multiplication, booleans conjunction/disjunction, and collections
concatenation. Unsupported operations fail explicitly. Collection members are
opaque typed values; their identity, ordering and multiplicity survive. New
payloads implement a concrete operation contract; no dynamic universal parameter
graph or second score decoder is introduced.

## Composition operations

| Operation | Meaning |
| --- | --- |
| `atom(value, span)` | One value occupies an exact positive span. Zero is a valid integer value. |
| `rest(span)` | An empty span, with no value or invented subdivision cells. |
| `sequence(items)` | Concatenate any number of child spans. |
| `parallel(items)` | Place children at the same origin; preserve separate overlapping events. |
| `repeat(pattern, count)` | Repeat a finite cycle with an explicit positive count. |
| `stretch(pattern, factor)` | Scale all time coordinates by an exact positive rational. |
| `window(pattern, start, span)` | Take a finite interval, clip events at its edges and move its origin to zero. Repeating the window explicitly restarts it. |
| `ref(id)` | Use a shared typed definition. Editing it changes every reference. |
| `combine(operation, operands)` | Combine any number of active values on their time intersections. Each operand retains its own phase and span. |
| `subdivide(parent, children, operation)` | Fit a child into each complete parent event, then combine their values. Cycle the supplied child schedule by parent-event ordinal. |

`parallel` retains separate emissions. `combine` uses the Cartesian combinations
of overlapping operands; it does not silently zip or broadcast named members.
Scalar musical controls must have exactly one value when sampled. An ambiguous
overlap must be combined explicitly. A missing value is an error when needed,
never an implicit zero. Separate definitions have separate typed namespaces.

In subdivision, a two-unit parent provides twice the space of a one-unit parent.
Four children inside one parent and three inside another both fill their own
parent span. A false boolean parent is still an explicit cell; `rest` has no
cell to subdivide. Clipping a subdivided pattern preserves the original child
schedule and phase rather than fitting the surviving fragment again.

For A = [0,1,2] and B = [0,2,1], give each A cell three units and each B cell one.
`subdivide(ref(A), [ref(B)], add)` yields degrees
`[0,2,1, 1,3,2, 2,4,3]`. Mapping these once through C Ionian gives
`C E D | D F E | E G F`. The operation nests to any admitted depth; there is no
special outer/inner pair limit. Rhythm can use another independent pattern.

## Musical interpretation through the existing compiler

`CompositionPlan.patterns` retains number definitions, gate definitions and
authored voices. `composition_patterns.rs` lowers them to ordinary materials and
placements whenever the existing composition compiler runs. The saved plan
retains its relationships; lowered notes are temporary compiler data. The same
compiler remains responsible for final note emission, routing, exact PPQ,
performance validation and export restrictions.

Each `PatternVoice` has an explicit identity and a separate output part. Its
rhythm contains timed cells; its optional sound mask is independently sampled at
cell attacks. Mask changes inside a held note do not split or retrigger it.
The default note duration is its complete cell span, with no hidden staccato
factor. An optional rational duration multiplier controls articulation; `clip`
limits tails to the entire voice window and `allow` permits overlap beyond it.

Controls name their clock:

- `time`: exact elapsed local time, including silence.
- `slot`: ordinal of declared rhythmic cells, including false or masked cells.
- `attack`: ordinal of sounding attacks after masking.

An empty `rest` span advances time but has no invented slot count. Sound masks
use time or slot clocks; an attack-clock sound mask is rejected because its own
output would determine whether its clock advances. Every cycle is explicit;
controls never wrap automatically when their support ends.

Pitch has three parts: an anchor, an optional degree pattern, and an optional
native offset pattern. Anchors can name a literal native pitch, a lattice degree,
or a particular harmonic palette member. All degree contributions are combined
before one lattice lookup. Native millicents are added afterward. Signed degrees
retain register beyond either end of a period. Lattices need not be octave based,
equally spaced or twelve-tone. A declared chromatic lattice supplies chromatic
steps; exact native offsets also permit off-scale and microtonal interiors.
An off-lattice harmonic anchor cannot silently acquire a degree coordinate.

Velocity can use the same integer pattern structure on an independent clock.
Chord members can be separate named voices sharing patterns and harmonic
parameters. Equal pitches do not merge emissions; crossing does not exchange
identities. This extends the voice foundation with authored melodic programs.
It does not infer voice identity, outer structural salience or a strong-melody
quality score from the resulting notes.

Authored scenes retain the original pattern plan while their ownership graph
describes its compiled placements. Palette edits and voice transpositions
recompile the relationships. Transposition is an independent native offset;
it does not rewrite shared degree definitions. Changing event counts requires
rebuilding the authored scene's identity/ownership view from the edited plan.

## Coverage and boundaries

| Musical requirement | Executable control |
| --- | --- |
| Shared outer A / inner B, with more than two levels | Nested subdivision, references and variadic addition; shared and local edit controls |
| Independent pitch, duration and sound/rest patterns | Separate controls and declared time/slot/attack clocks |
| Durations (2,1), with or without silence | Full-span cells plus an independent mask; no numerical rest convention |
| Three- and four-unit cycles | Explicit repetitions align at 12; adding a five-unit cycle aligns all at 60 |
| A 7/3 cycle within 16 units | Exact rational repeat, clipping window, then explicit restart |
| Unequal subdivisions and suppressed parents | Four-way and three-way children fill equal parent spans; mask retains silent time |
| Overlapping voices and tails | Parallel events, distinct authored IDs and explicit tail policy |
| Scale, chromatic and microtonal motion | One lattice map followed by native offsets, tested with nonoctave periods |
| Generalization to chords and other values | Generic collection concatenation; harmonic member voices; independent velocity controls |
| Durable executable edits | Plan serialization followed by changed-definition, changed-palette and local-offset recompilation |

Malformed references, definition cycles, unsafe coordinates, invalid operations,
missing sampled values and work/depth/event exhaustion fail explicitly. No
partial result is returned. Windows can skip fully hidden repeats; subdividing
a very large parent still pays for the parent events needed to preserve its
schedule. These are finite bounded programs, not infinite lazy streams.

The Patterns & voices lab exposes A, B and durations first, with independent
sound masks and native offsets available separately. Its complete JSON program
editor and worked examples use generated Rust contracts. All examples can be
auditioned and exported, with individual voice audition for multi-voice programs.
Solo audition retains the selected voice's timing and nominal extent; a shorter
voice in an advanced program can omit trailing silence supplied by other voices.
The simple editor uses eighth-note units, samples pitch by time and restarts all
constituent patterns at its authored phrase boundary. The full algebra specifies
other clocks and boundaries explicitly. Exact native playback and strict MIDI
export remain separate capabilities; unsupported MIDI pitch loss is rejected.

Representation coverage and changed-parameter tests establish executable
relationships. Perceptual quality, inferred melodic hierarchy and discovery of
these programs from arbitrary music remain separate research tasks.
