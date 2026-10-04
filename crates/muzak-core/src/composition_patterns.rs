//! Typed pattern values lower into the existing composition leaves. This module
//! never emits a Score; composition remains the sole note-emitting compiler.
use crate::{
    composition::{
        CompositionLimits, CompositionPlan, MaterialPlacement, ScoreMaterial, TimeScale,
        harmony_index, pitch_lattice_degree, pitch_lattice_pitch, resolve_harmonic_pitch,
    },
    error::{CoreResult, invalid},
    model::{MAX_SAFE, Pitch, ScoreNote},
    pattern::{
        EvaluatedPattern, Pattern, PatternLimits, PatternTime, PatternValue, evaluate_pattern,
    },
};
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use ts_rs::TS;

/// Time is in the containing plan's ticks. Attack is an integer ordinal of
/// sounding rhythm events; silent cells advance Time but do not advance Attack.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PatternClock {
    #[default]
    Time,
    /// Ordinal of every rhythmic atom, including false and masked atoms. An
    /// empty Rest span declares no atoms and therefore advances Time only.
    Slot,
    Attack,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PatternControl {
    pub pattern: Pattern<i64>,
    #[serde(default)]
    pub clock: PatternClock,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PatternGateControl {
    pub pattern: Pattern<bool>,
    #[serde(default)]
    pub clock: PatternClock,
}

/// Degree and chromatic coordinates have different units. Degrees are added
/// before lattice mapping; native millicents are added afterward.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PatternPitchAnchor {
    Native {
        millicents: i64,
    },
    Lattice {
        lattice: String,
        degree: i64,
    },
    Harmony {
        harmony: String,
        tone: usize,
        octave: i64,
        residual_millicents: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        lattice: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PatternPitch {
    pub anchor: PatternPitchAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub degree: Option<PatternControl>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chromatic: Option<PatternControl>,
}

/// Articulation can extend beyond a rhythm cell. Clip limits sounding tails to
/// the entire voice window; Allow retains them beyond its nominal end.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PatternTail {
    #[default]
    Clip,
    Allow,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PatternVoice {
    pub id: String,
    pub part: String,
    #[serde(default = "PatternTime::zero")]
    pub onset: PatternTime,
    /// Each true atom attacks and lasts its full span. False atoms are silence.
    /// Thus spans [2,1] contain two held notes, without an implicit rest.
    pub rhythm: Pattern<bool>,
    /// Independent attack mask. It samples Time or Slot once at cell start;
    /// later mask boundaries do not split, retrigger or shorten a held note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sound: Option<PatternGateControl>,
    pub pitch: PatternPitch,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub velocity: Option<PatternControl>,
    /// A dimensionless exact multiplier. Absence means one, not staccato.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_scale: Option<PatternTime>,
    #[serde(default)]
    pub tail: PatternTail,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompositionPatterns {
    #[serde(default)]
    pub number_definitions: BTreeMap<String, Pattern<i64>>,
    #[serde(default)]
    pub gate_definitions: BTreeMap<String, Pattern<bool>>,
    pub voices: Vec<PatternVoice>,
}

struct Limits {
    depth: usize,
    events: usize,
    work: usize,
}
impl Limits {
    fn from_composition(limits: &CompositionLimits) -> CoreResult<Self> {
        let values = [
            limits.max_depth.unwrap_or(32),
            limits.max_expanded_notes.unwrap_or(100_000),
            limits.max_expanded_placements.unwrap_or(100_000),
        ];
        if values.iter().any(|&n| n < 0 || n as u64 >= MAX_SAFE) {
            return Err(invalid("Invalid composition expansion budget."));
        }
        let convert = |n: i64| {
            usize::try_from(n)
                .map_err(|_| invalid("Composition pattern budget exceeds this platform."))
        };
        Ok(Self {
            depth: convert(values[0])?,
            events: convert(values[1])?,
            work: convert(values[2])?,
        })
    }
    fn charge(&mut self, amount: usize) -> CoreResult<()> {
        self.work = self
            .work
            .checked_sub(amount)
            .ok_or_else(|| invalid("Composition pattern work budget exceeded."))?;
        Ok(())
    }
    fn evaluate<T: PatternValue>(
        &mut self,
        pattern: &Pattern<T>,
        definitions: &BTreeMap<String, Pattern<T>>,
    ) -> CoreResult<EvaluatedPattern<T>> {
        let result = evaluate_pattern(
            pattern,
            definitions,
            &PatternLimits {
                max_depth: self.depth,
                max_events: self.events,
                max_work: self.work,
            },
        )?;
        self.charge(result.work)?;
        Ok(result)
    }
}

struct Control<T> {
    clock: PatternClock,
    events: Vec<(BigRational, BigRational, T)>,
}
impl<T: PatternValue + Copy> Control<T> {
    fn evaluate(
        pattern: &Pattern<T>,
        clock: PatternClock,
        definitions: &BTreeMap<String, Pattern<T>>,
        limits: &mut Limits,
    ) -> CoreResult<Self> {
        let value = limits.evaluate(pattern, definitions)?;
        let mut events = Vec::with_capacity(value.events.len());
        for event in value.events {
            let start = event.start.to_rational()?;
            let end = &start + event.duration.to_rational()?;
            if events
                .last()
                .is_some_and(|previous: &(BigRational, BigRational, T)| previous.1 > start)
            {
                return Err(invalid(
                    "A scalar pattern control has overlapping values; combine them explicitly.",
                ));
            }
            events.push((start, end, event.value));
        }
        Ok(Self { clock, events })
    }
    fn sample(
        &self,
        time: &BigRational,
        slot: usize,
        attack: usize,
        limits: &mut Limits,
    ) -> CoreResult<T> {
        limits.charge(1)?;
        let ordinal =
            BigRational::from_integer(BigInt::from(if self.clock == PatternClock::Slot {
                slot
            } else {
                attack
            }));
        let position = match self.clock {
            PatternClock::Time => time,
            PatternClock::Slot | PatternClock::Attack => &ordinal,
        };
        let index = self
            .events
            .partition_point(|(start, _, _)| start <= position);
        self.events
            .get(index.wrapping_sub(1))
            .filter(|(_, end, _)| position < end)
            .map(|(_, _, value)| *value)
            .ok_or_else(|| invalid("Pattern control has no value at a sounding attack."))
    }
}

fn safe_pitch(value: i128) -> CoreResult<i64> {
    if value.unsigned_abs() > u128::from(MAX_SAFE) {
        Err(invalid(
            "Pattern pitch exceeds safe integer native coordinates.",
        ))
    } else {
        Ok(value as i64)
    }
}
fn safe_time(value: BigInt) -> CoreResult<u64> {
    value
        .to_u64()
        .filter(|&value| value <= MAX_SAFE)
        .ok_or_else(|| invalid("Pattern realization exceeds safe integer time."))
}
fn gcd(mut a: BigInt, mut b: BigInt) -> BigInt {
    while !b.is_zero() {
        let remainder = a % &b;
        a = b;
        b = remainder;
    }
    a
}

/// Prepare ordinary composition leaves while retaining the authored program at
/// the caller. Shared definitions are re-evaluated on every edit. The public
/// compiler and authored-scene graph both use this exact lowering function.
///
/// Composition limits also bound patterns: depth limits nesting, expanded-note
/// budget limits intermediate event allocation, and expanded-placement budget
/// is a cumulative pattern-work cap. Final ordinary expansion is checked again.
pub fn lower_composition_patterns(
    plan: &CompositionPlan,
    limits: &CompositionLimits,
) -> CoreResult<CompositionPlan> {
    let Some(patterns) = &plan.patterns else {
        return Ok(plan.clone());
    };
    let mut limits = Limits::from_composition(limits)?;
    let harmonies = harmony_index(plan.harmonies.as_deref().unwrap_or_default())?;
    // Even unused shared definitions must be well formed, bounded and acyclic.
    limits.evaluate(
        &Pattern::Rest {
            span: PatternTime::one(),
        },
        &patterns.number_definitions,
    )?;
    limits.evaluate(
        &Pattern::Rest {
            span: PatternTime::one(),
        },
        &patterns.gate_definitions,
    )?;
    // Do not clone the pattern AST before its bounded evaluator has admitted
    // voice expressions. The lowered plan deliberately owns only ordinary
    // composition fields; authored patterns remain in the caller's plan.
    let mut result = CompositionPlan {
        context: plan.context.clone(),
        materials: plan.materials.clone(),
        definitions: plan.definitions.clone(),
        placements: plan.placements.clone(),
        harmonies: plan.harmonies.clone(),
        pitch_lattices: plan.pitch_lattices.clone(),
        patterns: None,
    };
    let mut ids: HashSet<_> = result
        .materials
        .iter()
        .map(|m| m.id.clone())
        .chain(result.definitions.iter().flatten().map(|d| d.id.clone()))
        .collect();
    let mut voice_ids = HashSet::new();
    let mut emitted = 0usize;
    for voice in &patterns.voices {
        limits.charge(1)?;
        if voice.id.is_empty() || !voice_ids.insert(&voice.id) {
            return Err(invalid("Pattern voice IDs must be nonempty and unique."));
        }
        if !plan.context.parts.iter().any(|part| part.id == voice.part) {
            return Err(invalid("Unknown pattern voice part routing."));
        }
        let rhythm = limits.evaluate(&voice.rhythm, &patterns.gate_definitions)?;
        let span = rhythm.span.to_rational()?;
        if span.is_zero() {
            return Err(invalid("A pattern voice requires positive rhythmic span."));
        }
        let onset = voice.onset.to_rational()?;
        let duration_scale = voice
            .duration_scale
            .as_ref()
            .map(PatternTime::to_rational)
            .transpose()?
            .unwrap_or_else(BigRational::one);
        if duration_scale.is_zero() {
            return Err(invalid("Pattern duration scale must be positive."));
        }
        let mut number = |value: &PatternControl| {
            Control::evaluate(
                &value.pattern,
                value.clock,
                &patterns.number_definitions,
                &mut limits,
            )
        };
        let degree = voice.pitch.degree.as_ref().map(&mut number).transpose()?;
        let chromatic = voice
            .pitch
            .chromatic
            .as_ref()
            .map(&mut number)
            .transpose()?;
        let velocity = voice.velocity.as_ref().map(&mut number).transpose()?;
        let sound = voice
            .sound
            .as_ref()
            .map(|value| {
                if value.clock == PatternClock::Attack {
                    return Err(invalid(
                        "Sound masks use Time or Slot; Attack would depend on the mask itself.",
                    ));
                }
                Control::evaluate(
                    &value.pattern,
                    value.clock,
                    &patterns.gate_definitions,
                    &mut limits,
                )
            })
            .transpose()?;
        let (base, lattice_id, base_degree) = match &voice.pitch.anchor {
            PatternPitchAnchor::Native { millicents } => {
                (safe_pitch(i128::from(*millicents))?, None, None)
            }
            PatternPitchAnchor::Lattice { lattice, degree } => (
                0,
                Some(lattice.as_str()),
                Some(safe_pitch(i128::from(*degree))?),
            ),
            PatternPitchAnchor::Harmony {
                harmony,
                tone,
                octave,
                residual_millicents,
                lattice,
            } => (
                resolve_harmonic_pitch(harmony, *tone, *octave, *residual_millicents, &harmonies)?,
                lattice.as_deref(),
                None,
            ),
        };
        let lattice = lattice_id
            .map(|id| {
                plan.pitch_lattices
                    .iter()
                    .flatten()
                    .find(|lattice| lattice.id == id)
                    .ok_or_else(|| invalid("Unknown pattern pitch lattice."))
            })
            .transpose()?;
        if degree.is_some() && lattice.is_none() {
            return Err(invalid(
                "Degree pattern offsets require an explicit pitch lattice.",
            ));
        }
        let base_degree = if let Some(lattice) = lattice {
            Some(match base_degree {
                Some(degree) => degree,
                None => pitch_lattice_degree(base, lattice)?.ok_or_else(|| {
                    invalid("Pattern harmonic anchor is off its explicit pitch lattice.")
                })?,
            })
        } else {
            None
        };
        let mut notes = Vec::new();
        for (slot, event) in rhythm.events.into_iter().enumerate() {
            if !event.value {
                continue;
            }
            let start = event.start.to_rational()?;
            if sound
                .as_ref()
                .map(|c| c.sample(&start, slot, notes.len(), &mut limits))
                .transpose()?
                == Some(false)
            {
                continue;
            }
            limits.charge(1)?;
            emitted = emitted
                .checked_add(1)
                .ok_or_else(|| invalid("Pattern note count overflow."))?;
            if emitted > limits.events {
                return Err(invalid("Composition expanded note budget exceeded."));
            }
            let duration = event.duration.to_rational()? * &duration_scale;
            let duration = if voice.tail == PatternTail::Clip {
                duration.min(&span - &start)
            } else {
                duration
            };
            let ordinal = notes.len();
            let degree_offset = degree
                .as_ref()
                .map(|c| c.sample(&start, slot, ordinal, &mut limits))
                .transpose()?
                .unwrap_or(0);
            let chromatic_offset = chromatic
                .as_ref()
                .map(|c| c.sample(&start, slot, ordinal, &mut limits))
                .transpose()?
                .unwrap_or(0);
            let pitch = match (lattice, base_degree) {
                (Some(lattice), Some(base_degree)) => pitch_lattice_pitch(
                    safe_pitch(i128::from(base_degree) + i128::from(degree_offset))?,
                    lattice,
                    chromatic_offset,
                )?,
                _ => safe_pitch(i128::from(base) + i128::from(chromatic_offset))?,
            };
            let velocity = velocity
                .as_ref()
                .map(|c| c.sample(&start, slot, ordinal, &mut limits))
                .transpose()?
                .unwrap_or(80);
            if !(1..=127).contains(&velocity) {
                return Err(invalid(
                    "Pattern velocity must be an integer from 1 to 127.",
                ));
            }
            notes.push((&onset + start, duration, pitch, velocity as u8));
        }
        let nominal_end = &onset + span;
        let mut factor = BigInt::one();
        for value in std::iter::once(&nominal_end).chain(
            notes
                .iter()
                .flat_map(|(start, duration, _, _)| [start, duration]),
        ) {
            factor = &factor / gcd(factor.clone(), value.denom().clone()) * value.denom();
            safe_time(BigInt::from(plan.context.ppq) * &factor)?;
        }
        let exact = |value: &BigRational| safe_time(value.numer() * &factor / value.denom());
        let denominator = safe_time(factor.clone())?;
        // Length-prefixed user identity plus collision checking gives distinct,
        // deterministic owner IDs without treating part routing as voice ID.
        let mut material_id = format!("pattern:{}:{}", voice.id.len(), voice.id);
        while !ids.insert(material_id.clone()) {
            material_id.push(':');
        }
        result.materials.push(ScoreMaterial {
            id: material_id.clone(),
            span: exact(&nominal_end)?,
            notes: notes
                .into_iter()
                .enumerate()
                .map(|(index, (start, duration, pitch, velocity))| {
                    Ok(ScoreNote {
                        id: format!("{}:{index}", voice.id),
                        part: voice.part.clone(),
                        onset: exact(&start)?,
                        duration: exact(&duration)?,
                        pitch: Pitch { millicents: pitch },
                        velocity,
                        release_velocity: 64,
                        pitch_envelope: None,
                        gain_envelope: None,
                        source: None,
                    })
                })
                .collect::<CoreResult<_>>()?,
        });
        result.placements.push(MaterialPlacement {
            material: material_id,
            onset: 0,
            time_scale: Some(TimeScale {
                numerator: 1,
                denominator,
            }),
            transpose_millicents: None,
            velocity_scale: None,
            part_map: None,
            pitch_bindings: None,
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composition::compile_composition;
    use serde_json::json;

    #[test]
    fn rejects_deep_voice_expression_before_cloning_its_ast() {
        let mut plan: CompositionPlan = serde_json::from_value(json!({
            "context": {"ppq": 1, "duration": 0, "attachments": [], "trackEnds": [0],
                "parts": [{"id":"p", "name":"", "track":0, "channel":0, "percussion":false}]},
            "materials": [], "placements": [],
            "patterns": {"voices": [{"id":"v", "part":"p",
                "rhythm": {"kind":"atom", "value":true, "span":{"numerator":1,"denominator":1}},
                "pitch": {"anchor":{"kind":"native", "millicents":6000000}}
            }]}
        }))
        .unwrap();
        let mut rhythm = Pattern::Atom {
            value: true,
            span: PatternTime::one(),
        };
        // The bounded evaluator only inspects a few nodes. A recursive clone
        // of this rejected payload would instead exhaust the test's stack.
        for _ in 0..20_000 {
            rhythm = Pattern::Repeat {
                pattern: Box::new(rhythm),
                count: 1,
            };
        }
        plan.patterns.as_mut().unwrap().voices[0].rhythm = rhythm;
        let result = compile_composition(
            &plan,
            &CompositionLimits {
                max_depth: Some(4),
                ..CompositionLimits::default()
            },
        );
        // Dismantle the intentionally hostile input iteratively too; recursive
        // Rust drop is not the operation this compiler regression exercises.
        let voice = plan.patterns.take().unwrap().voices.remove(0);
        let mut rhythm = voice.rhythm;
        while let Pattern::Repeat { pattern, .. } = rhythm {
            rhythm = *pattern;
        }
        assert_eq!(result.unwrap_err().code, "budget-exceeded");
    }
}
