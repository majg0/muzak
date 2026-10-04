//! Finite, exact-time patterns of typed values. This layer has no pitch, meter,
//! instrument, or note-emission semantics; composition interprets its values.
//!
//! Sequence concatenates spans, parallel preserves separate emissions, and
//! combine intersects active spans from every operand. Repetition is explicit.
//! Windows clip events and reset their origin without changing the source.

use crate::{
    error::{CoreResult, budget, invalid},
    model::MAX_SAFE,
    value_tree::{EvaluatedValueTree, ValueTreeProgram, evaluate_value_tree},
};
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use ts_rs::TS;

/// A nonnegative rational coordinate in caller-defined units. Spans and stretch
/// factors must be positive. The evaluator reduces all returned coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatternTime {
    pub numerator: u64,
    pub denominator: u64,
}

impl PatternTime {
    pub fn new(numerator: u64, denominator: u64) -> CoreResult<Self> {
        Self {
            numerator,
            denominator,
        }
        .to_rational()
        .and_then(|x| Self::from_rational(&x))
    }

    pub fn integer(value: u64) -> Self {
        Self {
            numerator: value,
            denominator: 1,
        }
    }

    pub fn zero() -> Self {
        Self::integer(0)
    }
    pub fn one() -> Self {
        Self::integer(1)
    }

    pub fn to_rational(&self) -> CoreResult<BigRational> {
        if self.denominator == 0 || self.numerator > MAX_SAFE || self.denominator > MAX_SAFE {
            return Err(invalid(
                "Pattern time needs a nonnegative safe numerator and positive safe denominator.",
            ));
        }
        Ok(BigRational::new(
            BigInt::from(self.numerator),
            BigInt::from(self.denominator),
        ))
    }

    pub fn from_rational(value: &BigRational) -> CoreResult<Self> {
        let numerator = value.numer().to_u64().filter(|x| *x <= MAX_SAFE);
        let denominator = value.denom().to_u64().filter(|x| *x > 0 && *x <= MAX_SAFE);
        match (numerator, denominator) {
            (Some(numerator), Some(denominator)) => Ok(Self {
                numerator,
                denominator,
            }),
            _ => Err(invalid(
                "Pattern time exceeds exact safe rational coordinates.",
            )),
        }
    }

    fn positive(&self) -> CoreResult<BigRational> {
        let value = self.to_rational()?;
        if value.is_zero() {
            return Err(invalid(
                "Pattern spans and stretch factors must be positive.",
            ));
        }
        Ok(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PatternOperation {
    Add,
    Multiply,
    All,
    Any,
    Concat,
}

/// The type supplies its admitted operations. Unrelated domains cannot silently
/// coerce into a scalar, and an unsupported operation fails even when silent.
pub trait PatternValue: Clone {
    fn supports(operation: PatternOperation) -> bool;
    fn combine(operation: PatternOperation, values: &[&Self]) -> CoreResult<Self>;
    fn validate(&self) -> CoreResult<()> {
        Ok(())
    }
    /// Units charged for cloning/combining one value, including container members.
    fn complexity(&self) -> usize {
        1
    }
}

impl PatternValue for i64 {
    fn supports(operation: PatternOperation) -> bool {
        matches!(
            operation,
            PatternOperation::Add | PatternOperation::Multiply
        )
    }

    fn combine(operation: PatternOperation, values: &[&Self]) -> CoreResult<Self> {
        if values.is_empty() || !Self::supports(operation) {
            return Err(invalid(
                "Integer patterns admit nonempty add or multiply operations.",
            ));
        }
        let value = match operation {
            PatternOperation::Add => values
                .iter()
                .fold(BigInt::zero(), |sum, value| sum + BigInt::from(**value)),
            PatternOperation::Multiply => {
                // Nonzero integer factors cannot make an oversized product
                // smaller. Check zero first, then reject before allocating an
                // arbitrarily large BigInt for an obviously unsafe product.
                if values.iter().any(|value| **value == 0) {
                    BigInt::zero()
                } else {
                    let mut product = 1i64;
                    for value in values {
                        product = product
                            .checked_mul(**value)
                            .filter(|value| value.unsigned_abs() <= MAX_SAFE)
                            .ok_or_else(|| {
                                invalid("Pattern integer operation exceeds the exact safe range.")
                            })?;
                    }
                    BigInt::from(product)
                }
            }
            _ => unreachable!(),
        };
        value
            .to_i64()
            .filter(|value| value.unsigned_abs() <= MAX_SAFE)
            .ok_or_else(|| invalid("Pattern integer operation exceeds the exact safe range."))
    }

    fn validate(&self) -> CoreResult<()> {
        if self.unsigned_abs() > MAX_SAFE {
            return Err(invalid("Pattern integer exceeds the exact safe range."));
        }
        Ok(())
    }
}

impl PatternValue for bool {
    fn supports(operation: PatternOperation) -> bool {
        matches!(operation, PatternOperation::All | PatternOperation::Any)
    }

    fn combine(operation: PatternOperation, values: &[&Self]) -> CoreResult<Self> {
        if values.is_empty() {
            return Err(invalid("Boolean pattern operations need an operand."));
        }
        match operation {
            PatternOperation::All => Ok(values.iter().all(|value| **value)),
            PatternOperation::Any => Ok(values.iter().any(|value| **value)),
            _ => Err(invalid("Boolean patterns admit all or any operations.")),
        }
    }
}

/// Members are opaque: concatenation preserves their order and multiplicity.
/// The caller remains responsible for the semantics of the contained type.
impl<T: Clone> PatternValue for Vec<T> {
    fn supports(operation: PatternOperation) -> bool {
        operation == PatternOperation::Concat
    }

    fn combine(operation: PatternOperation, values: &[&Self]) -> CoreResult<Self> {
        if values.is_empty() || !Self::supports(operation) {
            return Err(invalid("Collection patterns admit nonempty concatenation."));
        }
        Ok(values
            .iter()
            .flat_map(|value| value.iter().cloned())
            .collect())
    }

    fn complexity(&self) -> usize {
        self.len().saturating_add(1)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Pattern<T> {
    /// Embed an untimed value tree on ordinal coordinates. Musical controls
    /// select a slot/attack clock; no duration is stored in the source tree.
    Values {
        source: ValueTreeProgram<T>,
    },
    /// Realize a separate duration tree as successive timed cells. Sounding
    /// state can be supplied independently by a voice's sound mask.
    Durations {
        source: ValueTreeProgram<PatternTime>,
        value: T,
    },
    Atom {
        value: T,
        span: PatternTime,
    },
    Rest {
        span: PatternTime,
    },
    Sequence {
        items: Vec<Pattern<T>>,
    },
    Parallel {
        items: Vec<Pattern<T>>,
    },
    Repeat {
        pattern: Box<Pattern<T>>,
        count: u64,
    },
    Stretch {
        pattern: Box<Pattern<T>>,
        factor: PatternTime,
    },
    Window {
        pattern: Box<Pattern<T>>,
        start: PatternTime,
        span: PatternTime,
    },
    Ref {
        id: String,
    },
    Combine {
        operation: PatternOperation,
        operands: Vec<Pattern<T>>,
    },
    /// Fit successive children into complete parent events, cycling the explicit
    /// child schedule. False boolean values are slots; a rest has no event.
    Subdivide {
        parent: Box<Pattern<T>>,
        children: Vec<Pattern<T>>,
        operation: PatternOperation,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct PatternLimits {
    pub max_depth: usize,
    pub max_work: usize,
    /// Cumulative intermediate and final event allocations, not just the result.
    pub max_events: usize,
}

impl Default for PatternLimits {
    fn default() -> Self {
        Self {
            max_depth: 64,
            max_work: 1_000_000,
            max_events: 100_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PatternEvent<T> {
    pub start: PatternTime,
    pub duration: PatternTime,
    pub value: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedPattern<T> {
    pub span: PatternTime,
    pub events: Vec<PatternEvent<T>>,
    pub work: usize,
}

struct Counter<'a> {
    limits: &'a PatternLimits,
    work: usize,
    events: usize,
}

impl Counter<'_> {
    fn tree<T: PatternValue>(
        &mut self,
        source: &ValueTreeProgram<T>,
        depth: usize,
    ) -> CoreResult<EvaluatedValueTree<T>> {
        let remaining = PatternLimits {
            max_depth: self.limits.max_depth.saturating_sub(depth + 1),
            max_work: self.limits.max_work.saturating_sub(self.work),
            max_events: self.limits.max_events.saturating_sub(self.events),
        };
        if remaining.max_depth == 0 || remaining.max_work == 0 || remaining.max_events == 0 {
            return Err(budget("Pattern value-tree budget exceeded."));
        }
        let result = evaluate_value_tree(source, &remaining)?;
        self.spend(result.work)?;
        self.events = self
            .events
            .checked_add(result.allocations)
            .filter(|count| *count <= self.limits.max_events)
            .ok_or_else(|| budget("Pattern event budget exceeded."))?;
        Ok(result)
    }

    fn spend(&mut self, work: usize) -> CoreResult<()> {
        self.work = self
            .work
            .checked_add(work)
            .ok_or_else(|| budget("Pattern work budget exceeded."))?;
        if self.work > self.limits.max_work {
            return Err(budget("Pattern work budget exceeded."));
        }
        Ok(())
    }

    fn emission(&mut self, complexity: usize) -> CoreResult<()> {
        self.spend(complexity)?;
        self.events = self
            .events
            .checked_add(1)
            .ok_or_else(|| budget("Pattern event budget exceeded."))?;
        if self.events > self.limits.max_events {
            return Err(budget("Pattern event budget exceeded."));
        }
        Ok(())
    }
}

struct Prepared<'a, T> {
    span: BigRational,
    height: usize,
    kind: PreparedKind<'a, T>,
}

enum PreparedKind<'a, T> {
    Atom(&'a T),
    Values(Vec<Event<T>>),
    Rest,
    Sequence(Vec<usize>),
    Parallel(Vec<usize>),
    Repeat {
        child: usize,
        count: u64,
    },
    Stretch {
        child: usize,
        factor: BigRational,
    },
    Window {
        child: usize,
        start: BigRational,
    },
    Ref(usize),
    Combine {
        operation: PatternOperation,
        operands: Vec<usize>,
    },
    Subdivide {
        parent: usize,
        children: Vec<usize>,
        operation: PatternOperation,
    },
}

struct Preparation<'a, T> {
    definitions: &'a BTreeMap<String, Pattern<T>>,
    nodes: Vec<Prepared<'a, T>>,
    resolved: BTreeMap<String, usize>,
    visiting: BTreeSet<String>,
}

fn safe_time(value: BigRational) -> CoreResult<BigRational> {
    PatternTime::from_rational(&value)?;
    Ok(value)
}

impl<'a, T: PatternValue> Preparation<'a, T> {
    fn definition(
        &mut self,
        id: &str,
        depth: usize,
        counter: &mut Counter<'_>,
    ) -> CoreResult<usize> {
        if let Some(index) = self.resolved.get(id) {
            return Ok(*index);
        }
        if !self.visiting.insert(id.to_owned()) {
            return Err(invalid(format!("Cyclic pattern reference: {id}.")));
        }
        let pattern = self
            .definitions
            .get(id)
            .ok_or_else(|| invalid(format!("Unknown pattern reference: {id}.")))?;
        let index = self.prepare(pattern, depth, counter)?;
        self.visiting.remove(id);
        self.resolved.insert(id.to_owned(), index);
        Ok(index)
    }

    fn prepare(
        &mut self,
        pattern: &'a Pattern<T>,
        depth: usize,
        counter: &mut Counter<'_>,
    ) -> CoreResult<usize> {
        counter.spend(1)?;
        if depth >= counter.limits.max_depth {
            return Err(budget("Pattern depth budget exceeded."));
        }
        let mut child_indices = Vec::new();
        let mut tree_height = 0;
        let (span, kind) = match pattern {
            Pattern::Values { source } => {
                let result = counter.tree(source, depth)?;
                tree_height = result.height;
                let mut events = Vec::with_capacity(result.values.len());
                for (index, value) in result.values.into_iter().enumerate() {
                    counter.emission(value.complexity())?;
                    events.push(Event {
                        start: BigRational::from_integer(BigInt::from(index)),
                        end: BigRational::from_integer(BigInt::from(index + 1)),
                        value,
                    });
                }
                (
                    safe_time(BigRational::from_integer(BigInt::from(events.len())))?,
                    PreparedKind::Values(events),
                )
            }
            Pattern::Durations { source, value } => {
                value.validate()?;
                counter.spend(value.complexity())?;
                let result = counter.tree(source, depth)?;
                tree_height = result.height;
                let mut events = Vec::with_capacity(result.values.len());
                let mut offset = BigRational::zero();
                for duration in result.values {
                    let end = safe_time(&offset + duration.positive()?)?;
                    counter.emission(value.complexity())?;
                    events.push(Event {
                        start: offset,
                        end: end.clone(),
                        value: value.clone(),
                    });
                    offset = end;
                }
                (offset, PreparedKind::Values(events))
            }
            Pattern::Atom { value, span } => {
                counter.spend(value.complexity())?;
                value.validate()?;
                (span.positive()?, PreparedKind::Atom(value))
            }
            Pattern::Rest { span } => (span.positive()?, PreparedKind::Rest),
            Pattern::Sequence { items } | Pattern::Parallel { items } => {
                if items.is_empty() {
                    return Err(invalid(
                        "Pattern sequence and parallel need at least one item.",
                    ));
                }
                for item in items {
                    child_indices.push(self.prepare(item, depth + 1, counter)?);
                }
                if matches!(pattern, Pattern::Sequence { .. }) {
                    let mut total = BigRational::zero();
                    for index in &child_indices {
                        total = safe_time(total + &self.nodes[*index].span)?;
                    }
                    (total, PreparedKind::Sequence(child_indices.clone()))
                } else {
                    let total = child_indices
                        .iter()
                        .map(|index| &self.nodes[*index].span)
                        .max()
                        .unwrap()
                        .clone();
                    (total, PreparedKind::Parallel(child_indices.clone()))
                }
            }
            Pattern::Repeat { pattern, count } => {
                if *count == 0 || *count > MAX_SAFE {
                    return Err(invalid(
                        "Pattern repeat count must be a positive safe integer.",
                    ));
                }
                let child = self.prepare(pattern, depth + 1, counter)?;
                child_indices.push(child);
                let span = safe_time(&self.nodes[child].span * BigInt::from(*count))?;
                (
                    span,
                    PreparedKind::Repeat {
                        child,
                        count: *count,
                    },
                )
            }
            Pattern::Stretch { pattern, factor } => {
                let factor = factor.positive()?;
                let child = self.prepare(pattern, depth + 1, counter)?;
                child_indices.push(child);
                (
                    safe_time(&self.nodes[child].span * &factor)?,
                    PreparedKind::Stretch { child, factor },
                )
            }
            Pattern::Window {
                pattern,
                start,
                span,
            } => {
                let start = start.to_rational()?;
                let span = span.positive()?;
                safe_time(&start + &span)?;
                let child = self.prepare(pattern, depth + 1, counter)?;
                child_indices.push(child);
                (span, PreparedKind::Window { child, start })
            }
            Pattern::Ref { id } => {
                if id.is_empty() {
                    return Err(invalid("Pattern reference ID cannot be empty."));
                }
                let child = self.definition(id, depth + 1, counter)?;
                child_indices.push(child);
                (self.nodes[child].span.clone(), PreparedKind::Ref(child))
            }
            Pattern::Combine {
                operation,
                operands,
            } => {
                if operands.is_empty() {
                    return Err(invalid("Pattern combine needs at least one operand."));
                }
                if !T::supports(*operation) {
                    return Err(invalid(
                        "Pattern operation is unsupported for this value type.",
                    ));
                }
                for operand in operands {
                    child_indices.push(self.prepare(operand, depth + 1, counter)?);
                }
                let span = child_indices
                    .iter()
                    .map(|index| &self.nodes[*index].span)
                    .max()
                    .unwrap()
                    .clone();
                (
                    span,
                    PreparedKind::Combine {
                        operation: *operation,
                        operands: child_indices.clone(),
                    },
                )
            }
            Pattern::Subdivide {
                parent,
                children,
                operation,
            } => {
                if children.is_empty() {
                    return Err(invalid("Pattern subdivision needs at least one child."));
                }
                if !T::supports(*operation) {
                    return Err(invalid(
                        "Pattern operation is unsupported for this value type.",
                    ));
                }
                let parent = self.prepare(parent, depth + 1, counter)?;
                let mut prepared_children = Vec::with_capacity(children.len());
                for child in children {
                    prepared_children.push(self.prepare(child, depth + 1, counter)?);
                }
                child_indices.push(parent);
                child_indices.extend(prepared_children.iter().copied());
                (
                    self.nodes[parent].span.clone(),
                    PreparedKind::Subdivide {
                        parent,
                        children: prepared_children,
                        operation: *operation,
                    },
                )
            }
        };
        let height = 1 + child_indices
            .iter()
            .map(|index| self.nodes[*index].height)
            .max()
            .unwrap_or(0)
            .max(tree_height);
        if depth + height > counter.limits.max_depth {
            return Err(budget("Pattern depth budget exceeded."));
        }
        let index = self.nodes.len();
        self.nodes.push(Prepared { span, height, kind });
        Ok(index)
    }
}

struct Event<T> {
    start: BigRational,
    end: BigRational,
    value: T,
}

fn order_events<T>(events: &mut [Event<T>], counter: &mut Counter<'_>) -> CoreResult<()> {
    // Charge a conservative comparison allowance before allocating sort scratch
    // storage. Equal-time events retain authored traversal order.
    let passes = events.len().checked_ilog2().unwrap_or(0) as usize + 1;
    let work = events
        .len()
        .checked_mul(passes)
        .ok_or_else(|| budget("Pattern ordering budget exceeded."))?;
    counter.spend(work)?;
    events.sort_by(|left, right| left.start.cmp(&right.start));
    Ok(())
}

fn intersection(
    start: &BigRational,
    end: &BigRational,
    other_start: &BigRational,
    other_end: &BigRational,
) -> Option<(BigRational, BigRational)> {
    let start = start.max(other_start);
    let end = end.min(other_end);
    (start < end).then(|| (start.clone(), end.clone()))
}

fn evaluate_node<T: PatternValue>(
    nodes: &[Prepared<'_, T>],
    index: usize,
    start: &BigRational,
    end: &BigRational,
    counter: &mut Counter<'_>,
) -> CoreResult<Vec<Event<T>>> {
    counter.spend(1)?;
    let node = &nodes[index];
    let Some((start, end)) = intersection(start, end, &BigRational::zero(), &node.span) else {
        return Ok(Vec::new());
    };
    let events = match &node.kind {
        PreparedKind::Values(values) => {
            let mut events = Vec::new();
            for event in values {
                counter.spend(1)?;
                if let Some((lo, hi)) = intersection(&start, &end, &event.start, &event.end) {
                    counter.emission(event.value.complexity())?;
                    events.push(Event {
                        start: lo,
                        end: hi,
                        value: event.value.clone(),
                    });
                }
            }
            events
        }
        PreparedKind::Atom(value) => {
            counter.emission(value.complexity())?;
            vec![Event {
                start,
                end,
                value: (*value).clone(),
            }]
        }
        PreparedKind::Rest => Vec::new(),
        PreparedKind::Sequence(children) => {
            let mut events = Vec::new();
            let mut offset = BigRational::zero();
            for child in children {
                counter.spend(1)?;
                let child_end = &offset + &nodes[*child].span;
                if let Some((lo, hi)) = intersection(&start, &end, &offset, &child_end) {
                    let mut next =
                        evaluate_node(nodes, *child, &(lo - &offset), &(hi - &offset), counter)?;
                    for event in &mut next {
                        counter.spend(1)?;
                        event.start += &offset;
                        event.end += &offset;
                    }
                    events.extend(next);
                }
                offset = child_end;
                if offset >= end {
                    break;
                }
            }
            events
        }
        PreparedKind::Parallel(children) => {
            let mut events = Vec::new();
            for child in children {
                events.extend(evaluate_node(nodes, *child, &start, &end, counter)?);
            }
            events
        }
        PreparedKind::Repeat { child, count } => {
            let child_span = &nodes[*child].span;
            let first = (&start / child_span)
                .to_integer()
                .to_u64()
                .ok_or_else(|| invalid("Pattern repeat coordinate overflow."))?;
            let quotient = &end / child_span;
            let mut last = quotient
                .to_integer()
                .to_u64()
                .ok_or_else(|| invalid("Pattern repeat coordinate overflow."))?;
            if !quotient.is_integer() {
                last += 1;
            }
            let mut events = Vec::new();
            for ordinal in first..last.min(*count) {
                counter.spend(1)?;
                let offset = child_span * BigInt::from(ordinal);
                let mut next = evaluate_node(
                    nodes,
                    *child,
                    &(&start - &offset),
                    &(&end - &offset),
                    counter,
                )?;
                for event in &mut next {
                    counter.spend(1)?;
                    event.start += &offset;
                    event.end += &offset;
                }
                events.extend(next);
            }
            events
        }
        PreparedKind::Stretch { child, factor } => {
            let mut events =
                evaluate_node(nodes, *child, &(&start / factor), &(&end / factor), counter)?;
            for event in &mut events {
                counter.spend(1)?;
                event.start *= factor;
                event.end *= factor;
            }
            events
        }
        PreparedKind::Window {
            child,
            start: offset,
        } => {
            let mut events =
                evaluate_node(nodes, *child, &(&start + offset), &(&end + offset), counter)?;
            for event in &mut events {
                counter.spend(1)?;
                event.start -= offset;
                event.end -= offset;
            }
            events
        }
        PreparedKind::Ref(child) => evaluate_node(nodes, *child, &start, &end, counter)?,
        PreparedKind::Combine {
            operation,
            operands,
        } => {
            let mut inputs = Vec::with_capacity(operands.len());
            for operand in operands {
                inputs.push(evaluate_node(nodes, *operand, &start, &end, counter)?);
            }
            let mut output = Vec::new();
            if inputs.iter().all(|input| !input.is_empty()) {
                // Iterative Cartesian intersection keeps an arbitrarily wide
                // operation off the Rust stack. Overlapping emissions remain
                // distinct choices; equal values are never deduplicated.
                let mut positions = vec![0; inputs.len()];
                let mut bounds = vec![(start, end)];
                let mut values = Vec::with_capacity(inputs.len());
                let mut level = 0;
                loop {
                    counter.spend(1)?;
                    if positions[level] >= inputs[level].len() {
                        positions[level] = 0;
                        if level == 0 {
                            break;
                        }
                        level -= 1;
                        values.pop();
                        bounds.pop();
                        continue;
                    }
                    let event = &inputs[level][positions[level]];
                    positions[level] += 1;
                    let Some((lo, hi)) =
                        intersection(&bounds[level].0, &bounds[level].1, &event.start, &event.end)
                    else {
                        continue;
                    };
                    if level + 1 == inputs.len() {
                        values.push(&event.value);
                        let complexity = values.iter().try_fold(0usize, |sum, value| {
                            sum.checked_add(value.complexity())
                                .ok_or_else(|| budget("Pattern value budget exceeded."))
                        })?;
                        counter.spend(complexity)?;
                        let value = T::combine(*operation, &values)?;
                        value.validate()?;
                        counter.emission(value.complexity())?;
                        output.push(Event {
                            start: lo,
                            end: hi,
                            value,
                        });
                        values.pop();
                    } else {
                        values.push(&event.value);
                        bounds.push((lo, hi));
                        level += 1;
                    }
                }
            }
            output
        }
        PreparedKind::Subdivide {
            parent,
            children,
            operation,
        } => {
            // Parent identities and full durations precede clipping: otherwise a
            // late window would restart the child schedule or change its speed.
            let mut parents = evaluate_node(
                nodes,
                *parent,
                &BigRational::zero(),
                &nodes[*parent].span,
                counter,
            )?;
            order_events(&mut parents, counter)?;
            let mut output = Vec::new();
            for (ordinal, parent) in parents.into_iter().enumerate() {
                counter.spend(1)?;
                let Some((lo, hi)) = intersection(&start, &end, &parent.start, &parent.end) else {
                    continue;
                };
                let child = children[ordinal % children.len()];
                let factor = (&parent.end - &parent.start) / &nodes[child].span;
                let events = evaluate_node(
                    nodes,
                    child,
                    &((&lo - &parent.start) / &factor),
                    &((&hi - &parent.start) / &factor),
                    counter,
                )?;
                for event in events {
                    counter.spend(
                        parent
                            .value
                            .complexity()
                            .saturating_add(event.value.complexity()),
                    )?;
                    let value = T::combine(*operation, &[&parent.value, &event.value])?;
                    value.validate()?;
                    counter.emission(value.complexity())?;
                    output.push(Event {
                        start: &parent.start + event.start * &factor,
                        end: &parent.start + event.end * &factor,
                        value,
                    });
                }
            }
            output
        }
    };
    Ok(events)
}

/// Validate the full supplied program, then evaluate its bounded visible events.
/// Unused definitions and clipped branches still undergo structural validation.
/// A failed validation or budget returns no partial result. Ordered ties retain
/// authored traversal order, including separate equal parallel emissions.
pub fn evaluate_pattern<T: PatternValue>(
    pattern: &Pattern<T>,
    definitions: &BTreeMap<String, Pattern<T>>,
    limits: &PatternLimits,
) -> CoreResult<EvaluatedPattern<T>> {
    if limits.max_depth == 0
        || limits.max_depth > 256
        || limits.max_work == 0
        || limits.max_work > 8_000_000
        || limits.max_events == 0
        || limits.max_events > 1_000_000
    {
        return Err(invalid(
            "Pattern limits require depth 1–256, work 1–8000000, and events 1–1000000.",
        ));
    }
    let mut counter = Counter {
        limits,
        work: 0,
        events: 0,
    };
    let mut preparation = Preparation {
        definitions,
        nodes: Vec::new(),
        resolved: BTreeMap::new(),
        visiting: BTreeSet::new(),
    };
    for id in definitions.keys() {
        if id.is_empty() {
            return Err(invalid("Pattern definition ID cannot be empty."));
        }
        preparation.definition(id, 0, &mut counter)?;
    }
    let root = preparation.prepare(pattern, 0, &mut counter)?;
    let span = preparation.nodes[root].span.clone();
    let mut events = evaluate_node(
        &preparation.nodes,
        root,
        &BigRational::zero(),
        &span,
        &mut counter,
    )?;
    order_events(&mut events, &mut counter)?;
    counter.spend(events.len())?;
    let events = events
        .into_iter()
        .map(|event| {
            Ok(PatternEvent {
                start: PatternTime::from_rational(&event.start)?,
                duration: PatternTime::from_rational(&(event.end - event.start))?,
                value: event.value,
            })
        })
        .collect::<CoreResult<Vec<_>>>()?;
    Ok(EvaluatedPattern {
        span: PatternTime::from_rational(&span)?,
        events,
        work: counter.work,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::value_tree::ValueTree;

    #[test]
    fn untimed_values_and_independent_nested_durations_have_explicit_realization() {
        let pitch = ValueTreeProgram {
            definitions: BTreeMap::new(),
            tree: ValueTree::Sequence {
                items: [0, 2, 1, 3]
                    .into_iter()
                    .map(|value| ValueTree::Leaf { value })
                    .collect(),
            },
        };
        let durations = ValueTreeProgram {
            definitions: BTreeMap::new(),
            tree: ValueTree::Expand {
                parent: Box::new(ValueTree::Sequence {
                    items: [2, 1]
                        .into_iter()
                        .map(|value| ValueTree::Leaf {
                            value: PatternTime::integer(value),
                        })
                        .collect(),
                }),
                children: vec![ValueTree::Sequence {
                    items: [1, 3]
                        .into_iter()
                        .map(|numerator| ValueTree::Leaf {
                            value: PatternTime::new(numerator, 4).unwrap(),
                        })
                        .collect(),
                }],
                operation: PatternOperation::Multiply,
            },
        };
        let indexed = run(&Pattern::Values { source: pitch });
        assert_eq!(indexed.span, PatternTime::integer(4));
        assert_eq!(
            indexed
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            [0, 2, 1, 3]
        );
        let rhythm = Pattern::Durations {
            source: durations,
            value: true,
        };
        let timed = run(&rhythm);
        assert_eq!(timed.span, PatternTime::integer(3));
        assert_eq!(
            timed
                .events
                .iter()
                .map(|event| event.duration.clone())
                .collect::<Vec<_>>(),
            vec![
                PatternTime::new(1, 2).unwrap(),
                PatternTime::new(3, 2).unwrap(),
                PatternTime::new(1, 4).unwrap(),
                PatternTime::new(3, 4).unwrap()
            ]
        );
        // A temporal cut is an explicit operation outside the duration tree.
        let clipped = run(&window(rhythm, 1, 1));
        assert_eq!(clipped.events.len(), 1);
        assert_eq!(clipped.events[0].duration, PatternTime::one());
    }

    #[test]
    fn value_tree_bridges_reject_zero_durations_and_share_enclosing_budgets() {
        let zero = Pattern::Durations {
            source: ValueTreeProgram {
                definitions: BTreeMap::new(),
                tree: ValueTree::Leaf {
                    value: PatternTime::zero(),
                },
            },
            value: true,
        };
        assert!(evaluate_pattern(&zero, &BTreeMap::new(), &PatternLimits::default()).is_err());
        let values = Pattern::Values {
            source: ValueTreeProgram {
                definitions: BTreeMap::new(),
                tree: ValueTree::Repeat {
                    tree: Box::new(ValueTree::Leaf { value: 0i64 }),
                    count: 10,
                },
            },
        };
        assert!(
            evaluate_pattern(
                &values,
                &BTreeMap::new(),
                &PatternLimits {
                    max_events: 15,
                    ..PatternLimits::default()
                }
            )
            .is_err()
        );
        assert!(
            evaluate_pattern(
                &repeat(values, 2),
                &BTreeMap::new(),
                &PatternLimits {
                    max_depth: 3,
                    ..PatternLimits::default()
                }
            )
            .is_err()
        );
    }

    fn atom<T>(value: T, span: u64) -> Pattern<T> {
        Pattern::Atom {
            value,
            span: PatternTime::integer(span),
        }
    }
    fn sequence(values: &[i64]) -> Pattern<i64> {
        Pattern::Sequence {
            items: values.iter().map(|value| atom(*value, 1)).collect(),
        }
    }
    fn run<T: PatternValue>(pattern: &Pattern<T>) -> EvaluatedPattern<T> {
        evaluate_pattern(pattern, &BTreeMap::new(), &PatternLimits::default()).unwrap()
    }
    fn repeat<T>(pattern: Pattern<T>, count: u64) -> Pattern<T> {
        Pattern::Repeat {
            pattern: Box::new(pattern),
            count,
        }
    }
    fn window<T>(pattern: Pattern<T>, start: u64, span: u64) -> Pattern<T> {
        Pattern::Window {
            pattern: Box::new(pattern),
            start: PatternTime::integer(start),
            span: PatternTime::integer(span),
        }
    }

    #[test]
    fn independently_repeated_three_and_four_cycles_meet_at_twelve() {
        let result = run(&Pattern::Combine {
            operation: PatternOperation::Add,
            operands: vec![
                repeat(sequence(&[0, 1, 2]), 4),
                repeat(sequence(&[0, 10, 20, 30]), 3),
            ],
        });
        assert_eq!(result.span, PatternTime::integer(12));
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            vec![0, 11, 22, 30, 1, 12, 20, 31, 2, 10, 21, 32]
        );
    }

    #[test]
    fn outer_shape_inner_motive_and_third_independent_pattern_compose() {
        let outer = Pattern::Sequence {
            items: [0, 1, 2].into_iter().map(|value| atom(value, 3)).collect(),
        };
        let inner = repeat(sequence(&[0, 2, 1]), 3);
        let third = atom(7, 9);
        let result = run(&Pattern::Combine {
            operation: PatternOperation::Add,
            operands: vec![outer, inner, third],
        });
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            [7, 9, 8, 8, 10, 9, 9, 11, 10]
        );
    }

    #[test]
    fn subdivision_fits_motives_to_unequal_parent_durations_and_cycles_schedule() {
        let parent = Pattern::Sequence {
            items: vec![atom(0, 2), atom(1, 1), atom(2, 2)],
        };
        let result = run(&Pattern::Subdivide {
            parent: Box::new(parent),
            children: vec![sequence(&[0, 2, 1]), sequence(&[0, 1])],
            operation: PatternOperation::Add,
        });
        assert_eq!(result.span, PatternTime::integer(5));
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            vec![0, 2, 1, 1, 2, 2, 4, 3]
        );
        assert_eq!(result.events[0].duration, PatternTime::new(2, 3).unwrap());
        assert_eq!(result.events[3].start, PatternTime::integer(2));
        assert_eq!(result.events[3].duration, PatternTime::new(1, 2).unwrap());
        assert_eq!(result.events[5].start, PatternTime::integer(3));
    }

    #[test]
    fn subdivision_gate_keeps_false_slot_and_clipping_does_not_rephase() {
        let parent = Pattern::Sequence {
            items: [true, false, true]
                .into_iter()
                .map(|value| atom(value, 1))
                .collect(),
        };
        let children = vec![
            Pattern::Sequence {
                items: [true, false, false, true]
                    .into_iter()
                    .map(|value| atom(value, 1))
                    .collect(),
            },
            atom(true, 1),
            Pattern::Sequence {
                items: [true, false, true]
                    .into_iter()
                    .map(|value| atom(value, 1))
                    .collect(),
            },
        ];
        let subdivision = Pattern::Subdivide {
            parent: Box::new(parent),
            children,
            operation: PatternOperation::All,
        };
        let complete = run(&subdivision);
        assert_eq!(complete.events.len(), 8);
        assert_eq!(
            complete.events[4],
            PatternEvent {
                start: PatternTime::one(),
                duration: PatternTime::one(),
                value: false
            }
        );
        let clipped = run(&Pattern::Window {
            pattern: Box::new(subdivision),
            start: PatternTime::new(5, 2).unwrap(),
            span: PatternTime::new(1, 2).unwrap(),
        });
        assert_eq!(
            clipped.events,
            vec![
                PatternEvent {
                    start: PatternTime::zero(),
                    duration: PatternTime::new(1, 6).unwrap(),
                    value: false
                },
                PatternEvent {
                    start: PatternTime::new(1, 6).unwrap(),
                    duration: PatternTime::new(1, 3).unwrap(),
                    value: true
                }
            ]
        );
    }

    #[test]
    fn nested_boolean_gate_preserves_parent_slot_and_independent_subdivision() {
        fn bits(values: &[bool]) -> Pattern<bool> {
            Pattern::Stretch {
                pattern: Box::new(Pattern::Sequence {
                    items: values.iter().map(|value| atom(*value, 1)).collect(),
                }),
                factor: PatternTime::new(1, values.len() as u64).unwrap(),
            }
        }
        let parent = Pattern::Sequence {
            items: [true, false, true]
                .into_iter()
                .map(|value| atom(value, 1))
                .collect(),
        };
        let subdivisions = Pattern::Sequence {
            items: vec![
                bits(&[true, false, false, true]),
                bits(&[true, false, false, true]),
                bits(&[true, false, true]),
            ],
        };
        let result = run(&Pattern::Combine {
            operation: PatternOperation::All,
            operands: vec![parent, subdivisions],
        });
        assert_eq!(result.span, PatternTime::integer(3));
        let attacks = result
            .events
            .iter()
            .filter(|event| event.value)
            .map(|event| event.start.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            attacks,
            vec![
                PatternTime::zero(),
                PatternTime::new(3, 4).unwrap(),
                PatternTime::integer(2),
                PatternTime::new(8, 3).unwrap()
            ]
        );
        assert_eq!(result.events.len(), 11);
        assert!(result.events[4..8].iter().all(|event| !event.value));
    }

    #[test]
    fn rational_cycle_clips_at_sixteen_and_restarts_without_phase_carry() {
        let source = Pattern::Atom {
            value: 7,
            span: PatternTime::new(7, 3).unwrap(),
        };
        let result = run(&repeat(window(repeat(source, 7), 0, 16), 2));
        assert_eq!(result.span, PatternTime::integer(32));
        assert_eq!(result.events.len(), 14);
        assert_eq!(result.events[6].start, PatternTime::integer(14));
        assert_eq!(result.events[6].duration, PatternTime::integer(2));
        assert_eq!(result.events[7].start, PatternTime::integer(16));
        assert_eq!(result.events[7].duration, PatternTime::new(7, 3).unwrap());
    }

    #[test]
    fn parallel_and_cartesian_combination_preserve_equal_separate_emissions() {
        let parallel = Pattern::Parallel {
            items: vec![atom(2, 1), atom(2, 1)],
        };
        assert_eq!(run(&parallel).events.len(), 2);
        let result = run(&Pattern::Combine {
            operation: PatternOperation::Add,
            operands: vec![parallel.clone(), parallel, atom(3, 1)],
        });
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            vec![7, 7, 7, 7]
        );
    }

    #[test]
    fn zero_values_are_emissions_and_integer_products_and_boolean_any_are_typed() {
        let repeated_zero = run(&repeat(atom(0, 1), 3));
        assert_eq!(repeated_zero.events.len(), 3);
        assert!(repeated_zero.events.iter().all(|event| event.value == 0));
        let product = run(&Pattern::Combine {
            operation: PatternOperation::Multiply,
            operands: vec![atom(-2, 1), atom(3, 1), atom(4, 1)],
        });
        assert_eq!(product.events[0].value, -24);
        // Zero makes the complete n-ary product exactly zero, even when a
        // left-fold implementation would have overflowed before reaching it.
        let zero_product = run(&Pattern::Combine {
            operation: PatternOperation::Multiply,
            operands: vec![
                atom(MAX_SAFE as i64, 1),
                atom(MAX_SAFE as i64, 1),
                atom(0, 1),
            ],
        });
        assert_eq!(zero_product.events[0].value, 0);
        let either = run(&Pattern::Combine {
            operation: PatternOperation::Any,
            operands: vec![atom(false, 1), atom(true, 1), atom(false, 1)],
        });
        assert!(either.events[0].value);
    }

    #[test]
    fn collection_combination_preserves_member_identity_order_and_multiplicity() {
        #[derive(Debug, Clone, PartialEq, Eq)]
        struct Member {
            identity: &'static str,
            coordinate: i64,
        }
        let member = Member {
            identity: "first",
            coordinate: 0,
        };
        let other = Member {
            identity: "second",
            coordinate: 0,
        };
        let result = run(&Pattern::Combine {
            operation: PatternOperation::Concat,
            operands: vec![
                atom(vec![member.clone()], 1),
                atom(vec![other.clone()], 1),
                atom(vec![member.clone()], 1),
            ],
        });
        assert_eq!(result.events[0].value, vec![member.clone(), other, member]);
    }

    #[test]
    fn references_share_definitions_and_a_definition_edit_changes_each_use() {
        let pattern = Pattern::Sequence {
            items: vec![
                Pattern::Ref {
                    id: "motive".into(),
                },
                Pattern::Ref {
                    id: "motive".into(),
                },
            ],
        };
        let mut definitions = BTreeMap::from([("motive".into(), sequence(&[0, 2, 1]))]);
        let before = evaluate_pattern(&pattern, &definitions, &PatternLimits::default()).unwrap();
        definitions.insert("motive".into(), sequence(&[0, 3, 1]));
        let after = evaluate_pattern(&pattern, &definitions, &PatternLimits::default()).unwrap();
        assert_eq!(
            before
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            vec![0, 2, 1, 0, 2, 1]
        );
        assert_eq!(
            after
                .events
                .iter()
                .map(|event| event.value)
                .collect::<Vec<_>>(),
            vec![0, 3, 1, 0, 3, 1]
        );
    }

    #[test]
    fn clipping_skips_a_huge_fully_hidden_repeat_prefix() {
        let pattern = window(repeat(atom(1, 1), 1_000_000_000), 999_999_999, 1);
        let result = evaluate_pattern(
            &pattern,
            &BTreeMap::new(),
            &PatternLimits {
                max_work: 100,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.events.len(), 1);
        assert_eq!(result.events[0].start, PatternTime::zero());
    }

    #[test]
    fn rests_are_missing_values_not_zero_and_extent_remains_explicit() {
        let pattern = Pattern::Combine {
            operation: PatternOperation::Add,
            operands: vec![
                atom(3, 4),
                Pattern::Sequence {
                    items: vec![
                        Pattern::Rest {
                            span: PatternTime::integer(1),
                        },
                        atom(2, 1),
                    ],
                },
            ],
        };
        let result = run(&pattern);
        assert_eq!(result.span, PatternTime::integer(4));
        assert_eq!(result.events.len(), 1);
        assert_eq!(
            result.events[0],
            PatternEvent {
                start: PatternTime::integer(1),
                duration: PatternTime::integer(1),
                value: 5
            }
        );
        assert!(run(&window(atom(1, 1), 5, 3)).events.is_empty());
    }

    #[test]
    fn exact_rationals_reduce_without_quantization() {
        let pattern = Pattern::Stretch {
            pattern: Box::new(Pattern::Sequence {
                items: vec![
                    Pattern::Atom {
                        value: 1,
                        span: PatternTime::new(1, 3).unwrap(),
                    },
                    Pattern::Atom {
                        value: 2,
                        span: PatternTime::new(1, 7).unwrap(),
                    },
                ],
            }),
            factor: PatternTime::new(3, 2).unwrap(),
        };
        let result = run(&pattern);
        assert_eq!(result.span, PatternTime::new(5, 7).unwrap());
        assert_eq!(result.events[1].start, PatternTime::new(1, 2).unwrap());
        assert_eq!(result.events[1].duration, PatternTime::new(3, 14).unwrap());
    }

    #[test]
    fn invalid_silent_branches_unused_definitions_and_cycles_fail() {
        let silent_unknown = window(
            Pattern::<i64>::Ref {
                id: "missing".into(),
            },
            9,
            1,
        );
        assert!(
            evaluate_pattern(&silent_unknown, &BTreeMap::new(), &PatternLimits::default()).is_err()
        );
        let definitions = BTreeMap::from([(
            "unused".into(),
            Pattern::Ref {
                id: "missing".into(),
            },
        )]);
        assert!(evaluate_pattern(&atom(1, 1), &definitions, &PatternLimits::default()).is_err());
        let definitions = BTreeMap::from([
            ("a".into(), Pattern::Ref { id: "b".into() }),
            ("b".into(), Pattern::Ref { id: "a".into() }),
        ]);
        assert!(evaluate_pattern(&atom(1, 1), &definitions, &PatternLimits::default()).is_err());
        let unsupported = Pattern::<i64>::Combine {
            operation: PatternOperation::Concat,
            operands: vec![Pattern::Rest {
                span: PatternTime::one(),
            }],
        };
        assert!(
            evaluate_pattern(&unsupported, &BTreeMap::new(), &PatternLimits::default()).is_err()
        );
    }

    #[test]
    fn malformed_empty_zero_and_unsafe_programs_fail() {
        let bad = vec![
            Pattern::Sequence { items: vec![] },
            Pattern::Parallel { items: vec![] },
            Pattern::Combine {
                operation: PatternOperation::Add,
                operands: vec![],
            },
            repeat(atom(1, 1), 0),
            atom(1, 0),
            atom(MAX_SAFE as i64 + 1, 1),
            Pattern::Atom {
                value: 1,
                span: PatternTime {
                    numerator: 1,
                    denominator: 0,
                },
            },
            Pattern::Stretch {
                pattern: Box::new(atom(1, 1)),
                factor: PatternTime::zero(),
            },
            Pattern::Sequence {
                items: vec![atom(1, MAX_SAFE), atom(1, 1)],
            },
            Pattern::Combine {
                operation: PatternOperation::Add,
                operands: vec![atom(MAX_SAFE as i64, 1), atom(1, 1)],
            },
        ];
        for pattern in bad {
            assert!(
                evaluate_pattern(&pattern, &BTreeMap::new(), &PatternLimits::default()).is_err(),
                "{pattern:?}"
            );
        }
    }

    #[test]
    fn budgets_fail_explicitly_without_partial_results() {
        for limits in [
            PatternLimits {
                max_work: 5,
                ..Default::default()
            },
            PatternLimits {
                max_events: 2,
                ..Default::default()
            },
            PatternLimits {
                max_depth: 1,
                ..Default::default()
            },
        ] {
            let error =
                evaluate_pattern(&repeat(atom(1, 1), 4), &BTreeMap::new(), &limits).unwrap_err();
            assert_eq!(error.code, "budget-exceeded");
        }
        let pattern = Pattern::Ref { id: "a".into() };
        let definitions = BTreeMap::from([
            ("a".into(), Pattern::Ref { id: "b".into() }),
            ("b".into(), atom(1, 1)),
        ]);
        assert!(
            evaluate_pattern(
                &pattern,
                &definitions,
                &PatternLimits {
                    max_depth: 2,
                    ..Default::default()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn generic_contract_serializes_as_a_typed_expression() {
        let pattern = Pattern::Combine {
            operation: PatternOperation::Add,
            operands: vec![atom(0, 1), atom(2, 1)],
        };
        let json = serde_json::to_value(&pattern).unwrap();
        assert_eq!(json["kind"], "combine");
        assert_eq!(json["operation"], "add");
        let decoded: Pattern<i64> = serde_json::from_value(json).unwrap();
        assert_eq!(run(&pattern), run(&decoded));
        assert!(Pattern::<i64>::decl(&ts_rs::Config::default()).contains("Pattern<T>"));
    }
}
