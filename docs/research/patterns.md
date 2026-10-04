# Executable patterns and voices

A degree tree specifies values and their relationships, with no duration on its
leaves or branches. A duration tree independently specifies positive rational
values. A voice binds their successive leaves to produce timed notes. Sound/rest
is a third, independent choice: numeric zero is an ordinary value, never a rest
instruction. Durations `[2,1]` occupy three units whether either step is sounding
or muted.

`ValueTree<T>` expresses finite ordered values; `Pattern<T>` expresses values
placed in exact rational time or explicit control coordinates. Both use the
`PatternValue` operation contract. Integers admit addition/multiplication,
booleans conjunction/disjunction, rational values addition/multiplication, and
collections concatenation. Unsupported operations fail explicitly. Collection
members are opaque typed values; their identity, ordering and multiplicity
survive. These structures lower through the existing composition compiler;
they do not introduce another note decoder.

## Untimed value trees

`ValueTreeProgram<T>` retains a tree and its typed shared definitions. The tree
has no time partition. Sequence order is an ordinal relationship, not an
assumption that each value lasts one musical unit.

| Operation | Meaning |
| --- | --- |
| `leaf(value)` | One typed value, with no duration. |
| `sequence(items)` | Concatenate any number of child trees in order. |
| `ref(id)` | Use a shared typed definition. Editing it changes every reference. |
| `repeat(tree, count)` | Repeat a finite tree an explicit number of times. |
| `cycle(tree, count)` | Take exactly `count` leaves, cycling or cutting the tree as needed. |
| `combine(operation, operands)` | Combine any number of equally long trees point by point. Unequal lengths require an explicit cycle or other edit. |
| `expand(parent, children, operation)` | For each parent leaf, combine its value with every leaf of the selected child tree. Cycle the child schedule by parent ordinal. |

For A = `[0,1,2]` and B = `[0,2,1]`,
`expand(ref(A), [ref(B)], add)` gives `[0,2,1, 1,3,2, 2,4,3]`.
Mapping these once through C Ionian gives `C E D | D F E | E G F`.
Neither A nor B needs a duration. Expansion can nest at any admitted depth,
and each parent can select a different child tree. Shared references keep
these relationships editable without flattening them into literal notes.

Duration values can use the same tree operations, shared definitions and
independent cycles. A tree of nine degrees and a duration tree `[2,1]` can each
cycle to nine leaves: the duration sequence becomes `[2,1,2,1,2,1,2,1,2]`,
occupying fourteen units. Changing it to `[1/2]` keeps all nine degrees and
occupies nine halves. Changing the degree tree leaves these durations intact.

Two explicit adapters connect untimed trees to the timed pattern algebra:

- `values(source)` assigns successive leaves to ordinal control coordinates.
  A voice's `slot` or `attack` clock can consume them independently of time.
- `durations(source, value)` sums positive rational leaves to make consecutive
  timed cells, each carrying `value`. A separate sound mask decides which cells
  sound. Invalid duration values fail when used by this adapter.

Each adapter carries its own `ValueTreeProgram`, including all definitions;
degree, duration and mask trees do not need matching shapes or shared clocks.
The simple editor uses explicit leaf counts to bound each phrase. An advanced
program may instead choose another clock or an explicit time window.

## Explicit timed operations

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

Timed subdivision intentionally assigns space to its parents and fits children
inside that space. Untimed expansion intentionally assigns no such durations.
Use subdivision when proportional timing is part of the relationship, and
expansion when the relationship concerns successive values alone.

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
| Shared outer A / inner B, with more than two levels | Untimed expansion, references and variadic addition; shared and local edit controls |
| Independent pitch, duration and sound/rest patterns | Separate typed value trees; explicit adapters and time/slot/attack clocks |
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

The Patterns & voices lab presents connected, recursive degree and duration
trees. Selecting a node exposes its value, operation and structural edits:
add, remove, reorder, or wrap in another level. Shared-reference nodes display
their definitions; edits keep the references shared. The same generic editor
handles sound masks and native offsets. No outer/inner level count is imposed;
the existing evaluator depth and work budgets still bound compilation. The
visual editor changes the typed program without evaluating music in TypeScript.
Its complete JSON program
editor and worked examples use generated Rust contracts. All examples can be
auditioned and exported, with individual voice audition for multi-voice programs.
Solo audition retains the selected voice's timing and nominal extent; a shorter
voice in an advanced program can omit trailing silence supplied by other voices.
The visual editor uses eighth-note duration units. Its independent value trees
cycle to the explicit number of steps per phrase, including muted steps.
Fractional notes advance to the next degree; long notes hold their value.
The phrase's elapsed duration is the sum of its duration leaves: changing pitch
shape never changes that sum, and no duration is implicitly clipped. All
constituent trees restart at the phrase boundary. The full algebra specifies
other clocks and time boundaries explicitly. Exact native playback and strict MIDI
export remain separate capabilities; unsupported MIDI pitch loss is rejected.

Representation coverage and changed-parameter tests establish executable
relationships. Perceptual quality, inferred melodic hierarchy and discovery of
these programs from arbitrary music remain separate research tasks.
