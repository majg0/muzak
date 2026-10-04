//! Authored examples of the shared pattern algebra, not another musical engine.
use crate::{
    composition::{
        CompositionHarmony, CompositionLimits, CompositionPlan, PitchLattice, compile_composition,
    },
    composition_patterns::{
        CompositionPatterns, PatternClock, PatternControl, PatternGateControl, PatternPitch,
        PatternPitchAnchor, PatternTail, PatternVoice,
    },
    error::{CoreResult, invalid},
    model::{ScoreAttachment, ScoreContext, ScorePart},
    pattern::{
        Pattern, PatternLimits, PatternOperation, PatternTime, PatternValue, evaluate_pattern,
    },
};
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatternLabOptions {
    pub outer: Vec<i64>,
    pub inner: Vec<i64>,
    pub durations: Vec<PatternTime>,
    pub gates: Vec<bool>,
    pub chromatic_millicents: Vec<i64>,
    pub tempo: f64,
    pub repeats: u16,
}
impl Default for PatternLabOptions {
    fn default() -> Self {
        Self {
            outer: vec![0, 1, 2],
            inner: vec![0, 2, 1],
            durations: vec![PatternTime::one()],
            gates: vec![true],
            chromatic_millicents: vec![0],
            tempo: 104.,
            repeats: 2,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PatternExample {
    pub id: String,
    pub title: String,
    pub description: String,
    pub plan: CompositionPlan,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PatternLabDefaults {
    pub options: PatternLabOptions,
    pub examples: Vec<PatternExample>,
}

fn atom<T>(value: T, span: u64) -> Pattern<T> {
    Pattern::Atom {
        value,
        span: PatternTime::integer(span),
    }
}
fn sequence<T: Clone>(values: &[T], span: u64) -> Pattern<T> {
    Pattern::Sequence {
        items: values
            .iter()
            .map(|value| atom(value.clone(), span))
            .collect(),
    }
}
fn reference<T>(id: &str) -> Pattern<T> {
    Pattern::Ref { id: id.into() }
}
fn repeat<T>(pattern: Pattern<T>, count: u64) -> Pattern<T> {
    Pattern::Repeat {
        pattern: Box::new(pattern),
        count,
    }
}
fn control(pattern: Pattern<i64>, clock: PatternClock) -> PatternControl {
    PatternControl { pattern, clock }
}
fn fill<T: PatternValue>(pattern: Pattern<T>, span: u64) -> CoreResult<Pattern<T>> {
    let evaluated = evaluate_pattern(&pattern, &BTreeMap::new(), &PatternLimits::default())?;
    let period = evaluated.span.to_rational()?;
    if period.is_zero() {
        return Err(invalid("A repeating cycle must have positive duration."));
    }
    let ratio = BigRational::from_integer(BigInt::from(span)) / period;
    let count = ((ratio.numer() + ratio.denom() - BigInt::from(1)) / ratio.denom())
        .to_u64()
        .ok_or_else(|| invalid("Pattern example repeat count exceeds its budget."))?;
    Ok(Pattern::Window {
        pattern: Box::new(repeat(pattern, count)),
        start: PatternTime::zero(),
        span: PatternTime::integer(span),
    })
}
fn voice(id: &str, rhythm: Pattern<bool>, degree: Option<PatternControl>) -> PatternVoice {
    PatternVoice {
        id: id.into(),
        part: "line".into(),
        onset: PatternTime::zero(),
        rhythm,
        pitch: PatternPitch {
            anchor: PatternPitchAnchor::Lattice {
                lattice: "scale".into(),
                degree: 0,
            },
            degree,
            chromatic: None,
        },
        sound: None,
        velocity: None,
        duration_scale: None,
        tail: PatternTail::Clip,
    }
}
fn base(tempo: f64) -> CompositionPlan {
    let micros = (60_000_000. / tempo).round() as u32;
    CompositionPlan {
        context: ScoreContext {
            ppq: 2,
            duration: 0,
            midi_format: None,
            parts: vec![ScorePart {
                id: "line".into(),
                name: "Pattern voices".into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            track_ends: vec![0],
            attachments: vec![ScoreAttachment {
                tick: 0,
                track: 0,
                order: 0,
                bytes: vec![
                    255,
                    81,
                    3,
                    (micros >> 16) as u8,
                    (micros >> 8) as u8,
                    micros as u8,
                ],
            }],
        },
        materials: vec![],
        definitions: None,
        placements: vec![],
        harmonies: None,
        pitch_lattices: Some(vec![PitchLattice {
            id: "scale".into(),
            origin_millicents: 6_000_000,
            intervals: vec![0, 200_000, 400_000, 500_000, 700_000, 900_000, 1_100_000],
            period_millicents: 1_200_000,
        }]),
        patterns: Some(CompositionPatterns::default()),
    }
}

/// A small editor authors the same full program accepted by compileComposition.
/// Each outer degree holds one inner figure. Duration cells advance degree and
/// native-offset patterns by slot, independently of elapsed time and sound masks.
/// The explicit elapsed phrase window restarts every constituent on repeat.
pub fn generate(options: &PatternLabOptions) -> CoreResult<CompositionPlan> {
    if [
        options.outer.len(),
        options.inner.len(),
        options.durations.len(),
        options.gates.len(),
        options.chromatic_millicents.len(),
    ]
    .iter()
    .any(|&n| !(1..=64).contains(&n))
        || !(1..=16).contains(&options.repeats)
        || !options.tempo.is_finite()
        || !(20. ..=400.).contains(&options.tempo)
    {
        return Err(invalid(
            "Pattern editor needs 1–64 values per pattern, 1–16 repeats and tempo 20–400.",
        ));
    }
    let mut plan = base(options.tempo);
    let span = (options.outer.len() * options.inner.len()) as u64;
    let repeats = u64::from(options.repeats);
    let rhythm_cycle = Pattern::Sequence {
        items: options
            .durations
            .iter()
            .map(|duration| Pattern::Atom {
                value: true,
                span: duration.clone(),
            })
            .collect(),
    };
    let rhythm = fill(rhythm_cycle, span)?;
    let slots = evaluate_pattern(&rhythm, &BTreeMap::new(), &PatternLimits::default())?
        .events
        .len() as u64;
    let mask = repeat(fill(sequence(&options.gates, 1), slots)?, repeats);
    // Pitch coordinates count duration cells, not elapsed ticks. Keep shared
    // references executable, extending/cutting their ordinal support to match
    // this phrase before repeating it. Fractions can create more cells than the
    // degree cycle; long durations can create fewer, without skipping degrees.
    let degree_cycle = Pattern::Window {
        pattern: Box::new(repeat(reference("line"), slots.div_ceil(span))),
        start: PatternTime::zero(),
        span: PatternTime::integer(slots),
    };
    let mut line = voice(
        "melody",
        repeat(rhythm, repeats),
        Some(control(repeat(degree_cycle, repeats), PatternClock::Slot)),
    );
    line.sound = Some(PatternGateControl {
        pattern: mask,
        clock: PatternClock::Slot,
    });
    line.pitch.chromatic = Some(control(
        repeat(
            fill(sequence(&options.chromatic_millicents, 1), slots)?,
            repeats,
        ),
        PatternClock::Slot,
    ));
    let patterns = plan.patterns.as_mut().unwrap();
    patterns.number_definitions.insert(
        "A".into(),
        sequence(&options.outer, options.inner.len() as u64),
    );
    patterns
        .number_definitions
        .insert("B".into(), sequence(&options.inner, 1));
    patterns.number_definitions.insert(
        "line".into(),
        Pattern::Subdivide {
            parent: Box::new(reference("A")),
            children: vec![reference("B")],
            operation: PatternOperation::Add,
        },
    );
    patterns.voices.push(line);
    compile_composition(&plan, &CompositionLimits::default())?;
    Ok(plan)
}

fn example(
    id: &str,
    title: &str,
    description: &str,
    plan: CompositionPlan,
) -> CoreResult<PatternExample> {
    compile_composition(&plan, &CompositionLimits::default())?;
    Ok(PatternExample {
        id: id.into(),
        title: title.into(),
        description: description.into(),
        plan,
    })
}
pub fn defaults() -> CoreResult<PatternLabDefaults> {
    let options = PatternLabOptions::default();
    let mut examples = vec![example(
        "nested",
        "Outer A, inner B",
        "Shared A places shared B in C Ionian: C E D · D F E · E G F. Edit either definition and recompile.",
        generate(&options)?,
    )?];
    let mut held = options.clone();
    held.durations = vec![PatternTime::integer(2), PatternTime::one()];
    examples.push(example("duration", "Durations and sound are independent", "Durations 2,1 hold two units then one. The separate sound mask can silence either attack without changing the time partition.", generate(&held)?)?);

    let mut cycles = base(104.);
    let degree = Pattern::Combine {
        operation: PatternOperation::Add,
        operands: vec![
            fill(sequence(&[0, 2, 1], 1), 60)?,
            fill(sequence(&[0, 0, 1, -1], 1), 60)?,
            fill(sequence(&[0, 0, 0, 1, 0], 1), 60)?,
        ],
    };
    cycles.patterns.as_mut().unwrap().voices.push(voice(
        "cycles",
        repeat(atom(true, 1), 60),
        Some(control(degree, PatternClock::Time)),
    ));
    examples.push(example("cycles", "Independent cycles of 3, 4 and 5", "Three degree patterns keep independent phases. The first pair realigns after 12 units; all three after 60. Three operands share one combination operation.", cycles)?);

    let mut subdivision = base(86.);
    let mut line = voice(
        "subdivision",
        Pattern::Subdivide {
            parent: Box::new(sequence(&[true, true, true], 1)),
            children: vec![
                sequence(&[true, true, true, true], 1),
                sequence(&[true, true, true, true], 1),
                sequence(&[true, true, true], 1),
            ],
            operation: PatternOperation::All,
        },
        None,
    );
    line.sound = Some(PatternGateControl {
        pattern: sequence(&[true, false, true], 1),
        clock: PatternClock::Time,
    });
    subdivision.patterns.as_mut().unwrap().voices.push(line);
    examples.push(example("subdivision", "Subdivision with a separate sound mask", "Three equal parent spans contain four, four and three subdivisions. A separate mask silences the middle span; its duration stays intact. Sound and subdivision are independent.", subdivision)?);

    let mut cut = base(104.);
    let fractional = Pattern::Sequence {
        items: vec![
            atom(true, 1),
            Pattern::Atom {
                value: true,
                span: PatternTime {
                    numerator: 4,
                    denominator: 3,
                },
            },
        ],
    };
    let mut line = voice(
        "cut",
        repeat(fill(fractional, 16)?, 2),
        Some(control(
            repeat(fill(sequence(&[0, 2, 1], 1), 16)?, 2),
            PatternClock::Time,
        )),
    );
    line.pitch.chromatic = Some(control(
        repeat(fill(sequence(&[0, 0, 25_000], 1), 16)?, 2),
        PatternClock::Time,
    ));
    cut.patterns.as_mut().unwrap().voices.push(line);
    examples.push(example("window", "7/3 cycle, cut at 16, restart", "A cycle lasting exactly 7/3 units fills a 16-unit window. Its final note clips at the boundary, then both clocks restart. Native offsets include an exact 25-cent color.",cut)?);

    let mut chord = generate(&options)?;
    chord.harmonies = Some(vec![CompositionHarmony {
        id: "chord".into(),
        root_millicents: 6_000_000,
        intervals: vec![0, 400_000, 700_000],
    }]);
    let prototype = chord.patterns.as_ref().unwrap().voices[0].clone();
    chord.patterns.as_mut().unwrap().voices = (0..3)
        .map(|tone| {
            let mut line = prototype.clone();
            line.id = format!("member-{tone}");
            line.pitch.anchor = PatternPitchAnchor::Harmony {
                harmony: "chord".into(),
                tone,
                octave: 0,
                residual_millicents: 0,
                lattice: Some("scale".into()),
            };
            if tone == 1 {
                line.pitch.chromatic = Some(control(
                    repeat(sequence(&[0, 25_000, 0], 3), 2),
                    PatternClock::Time,
                ));
            }
            line
        })
        .collect();
    examples.push(example("voices", "Shared patterns across chord members", "Three authored voices share A and B while retaining distinct palette-member anchors. The middle voice adds a separate microtonal pattern. Solo each line; palette and pattern edits remain executable.",chord)?);
    Ok(PatternLabDefaults { options, examples })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fractional_and_long_cells_advance_degrees_and_restart_at_the_phrase_boundary() {
        let pitches = [60, 64, 62, 62, 65, 64, 64, 67, 65];
        // Hand-counted cells within the editor's nine-unit phrase. The last
        // 2/3 cell is clipped to 1/3, and the last two-unit cell to one unit.
        for (numerator, denominator, cells, last_numerator, last_denominator) in
            [(1, 2, 18, 1, 2), (2, 3, 14, 1, 3), (2, 1, 5, 1, 1)]
        {
            let options = PatternLabOptions {
                durations: vec![PatternTime::new(numerator, denominator).unwrap()],
                ..PatternLabOptions::default()
            };
            let score =
                compile_composition(&generate(&options).unwrap(), &CompositionLimits::default())
                    .unwrap();
            assert_eq!(score.notes.len(), cells * 2);
            for phrase in 0..2 {
                for cell in 0..cells {
                    assert_eq!(
                        score.notes[phrase * cells + cell].pitch.millicents,
                        pitches[cell % pitches.len()] * 100_000
                    );
                }
            }
            assert_eq!(score.notes[cells].onset * 2, 9 * score.ppq);
            assert_eq!(
                score.notes[cells - 1].duration * 2 * last_denominator,
                last_numerator * score.ppq
            );
        }
    }

    #[test]
    fn examples_compile_and_shared_inner_edit_regenerates() {
        let defaults = defaults().unwrap();
        assert_eq!(defaults.examples.len(), 6);
        let mut plan = generate(&defaults.options).unwrap();
        let before = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(
            before
                .notes
                .iter()
                .take(9)
                .map(|note| note.pitch.millicents / 100_000)
                .collect::<Vec<_>>(),
            vec![60, 64, 62, 62, 65, 64, 64, 67, 65]
        );
        plan.patterns
            .as_mut()
            .unwrap()
            .number_definitions
            .insert("B".into(), sequence(&[0, 1, 2], 1));
        let after = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(after.notes[1].pitch.millicents, 6_200_000);
        assert_eq!(after.notes[10].pitch.millicents, 6_200_000);
        assert_eq!(
            before
                .notes
                .iter()
                .map(|n| (n.onset, n.duration))
                .collect::<Vec<_>>(),
            after
                .notes
                .iter()
                .map(|n| (n.onset, n.duration))
                .collect::<Vec<_>>()
        );
    }
}
