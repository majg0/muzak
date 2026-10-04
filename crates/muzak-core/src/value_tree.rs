//! Ordered, typed value trees without a clock. Expansion expresses structural
//! parent/child relationships; a separate interpreter can use their leaves as
//! pitch controls, durations, masks, or other compositional values.

use crate::{
    error::{CoreResult, budget, invalid},
    model::MAX_SAFE,
    pattern::{PatternLimits, PatternOperation, PatternTime, PatternValue},
};
use num_rational::BigRational;
use num_traits::{One, Zero};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ValueTree<T> {
    Leaf {
        value: T,
    },
    Sequence {
        items: Vec<ValueTree<T>>,
    },
    Ref {
        id: String,
    },
    Repeat {
        tree: Box<ValueTree<T>>,
        count: u64,
    },
    /// Produce exactly `count` leaves by cycling the complete source tree.
    Cycle {
        tree: Box<ValueTree<T>>,
        count: u64,
    },
    /// Pointwise operation over equally long operands, without broadcasting.
    Combine {
        operation: PatternOperation,
        operands: Vec<ValueTree<T>>,
    },
    /// Select children cyclically by parent leaf ordinal, then combine each
    /// parent value with every leaf of its selected child tree.
    Expand {
        parent: Box<ValueTree<T>>,
        children: Vec<ValueTree<T>>,
        operation: PatternOperation,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    bound(deserialize = "T: Deserialize<'de>")
)]
pub struct ValueTreeProgram<T> {
    #[serde(default)]
    pub definitions: BTreeMap<String, ValueTree<T>>,
    pub tree: ValueTree<T>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedValueTree<T> {
    pub values: Vec<T>,
    pub work: usize,
    /// Cumulative intermediate and returned value materializations.
    pub allocations: usize,
    /// Maximum expanded depth, including references and unused definitions.
    pub height: usize,
}

impl PatternValue for PatternTime {
    fn supports(operation: PatternOperation) -> bool {
        matches!(
            operation,
            PatternOperation::Add | PatternOperation::Multiply
        )
    }

    fn combine(operation: PatternOperation, values: &[&Self]) -> CoreResult<Self> {
        if values.is_empty() || !Self::supports(operation) {
            return Err(invalid(
                "Rational value trees admit nonempty add or multiply operations.",
            ));
        }
        // Check every input even when a zero factor determines the result.
        for value in values {
            value.validate()?;
        }
        if operation == PatternOperation::Multiply
            && values.iter().any(|value| value.numerator == 0)
        {
            return Ok(Self::zero());
        }
        let mut result = match operation {
            PatternOperation::Add => BigRational::zero(),
            PatternOperation::Multiply => BigRational::one(),
            _ => unreachable!(),
        };
        for value in values {
            let operand = value.to_rational()?;
            match operation {
                PatternOperation::Add => result += operand,
                PatternOperation::Multiply => result *= operand,
                _ => unreachable!(),
            }
            // Bound intermediate rational size as well as the returned value.
            Self::from_rational(&result)?;
        }
        Self::from_rational(&result)
    }

    fn validate(&self) -> CoreResult<()> {
        self.to_rational().map(|_| ())
    }
}

struct Evaluation<'a, T> {
    definitions: &'a BTreeMap<String, ValueTree<T>>,
    limits: &'a PatternLimits,
    visiting: BTreeSet<String>,
    work: usize,
    events: usize,
    height: usize,
}

impl<T: PatternValue> Evaluation<'_, T> {
    fn spend(&mut self, amount: usize) -> CoreResult<()> {
        self.work = self
            .work
            .checked_add(amount)
            .filter(|work| *work <= self.limits.max_work)
            .ok_or_else(|| budget("Value tree work budget exceeded."))?;
        Ok(())
    }

    fn emit(&mut self, complexity: usize) -> CoreResult<()> {
        self.spend(complexity.max(1))?;
        self.events = self
            .events
            .checked_add(1)
            .filter(|events| *events <= self.limits.max_events)
            .ok_or_else(|| budget("Value tree event budget exceeded."))?;
        Ok(())
    }

    fn clone_value(&mut self, value: &T) -> CoreResult<T> {
        self.emit(value.complexity())?;
        Ok(value.clone())
    }

    fn combine(&mut self, operation: PatternOperation, operands: &[&T]) -> CoreResult<T> {
        // Charge inputs before the trait implementation can allocate its result
        // (notably concatenated collections), then charge the resulting value.
        for value in operands {
            self.spend(value.complexity().max(1))?;
        }
        let value = T::combine(operation, operands)?;
        self.emit(value.complexity())?;
        value.validate()?;
        Ok(value)
    }

    fn definition(&mut self, id: &str, depth: usize) -> CoreResult<Vec<T>> {
        if id.is_empty() {
            return Err(invalid("Value tree reference ID cannot be empty."));
        }
        let tree = self
            .definitions
            .get(id)
            .ok_or_else(|| invalid(format!("Unknown value tree reference: {id}.")))?;
        if !self.visiting.insert(id.to_owned()) {
            return Err(invalid(format!("Cyclic value tree reference: {id}.")));
        }
        let result = self.evaluate(tree, depth);
        self.visiting.remove(id);
        result
    }

    fn evaluate(&mut self, node: &ValueTree<T>, depth: usize) -> CoreResult<Vec<T>> {
        self.spend(1)?;
        if depth >= self.limits.max_depth {
            return Err(budget("Value tree depth budget exceeded."));
        }
        self.height = self.height.max(depth + 1);
        match node {
            ValueTree::Leaf { value } => {
                self.spend(value.complexity().max(1))?;
                value.validate()?;
                Ok(vec![self.clone_value(value)?])
            }
            ValueTree::Sequence { items } => {
                if items.is_empty() {
                    return Err(invalid("Value tree sequence needs at least one item."));
                }
                let mut values = Vec::new();
                for item in items {
                    values.extend(self.evaluate(item, depth + 1)?);
                }
                Ok(values)
            }
            ValueTree::Ref { id } => self.definition(id, depth + 1),
            ValueTree::Repeat { tree, count } | ValueTree::Cycle { tree, count } => {
                if *count == 0 || *count > MAX_SAFE {
                    return Err(invalid(
                        "Value tree repeat and cycle counts must be positive safe integers.",
                    ));
                }
                let source = self.evaluate(tree, depth + 1)?;
                let count = usize::try_from(*count)
                    .map_err(|_| budget("Value tree count exceeds the event budget."))?;
                let total = if matches!(node, ValueTree::Repeat { .. }) {
                    source
                        .len()
                        .checked_mul(count)
                        .filter(|total| u64::try_from(*total).is_ok_and(|total| total <= MAX_SAFE))
                        .ok_or_else(|| budget("Value tree count exceeds the exact safe range."))?
                } else {
                    count
                };
                self.repeated_values(&source, total)
            }
            ValueTree::Combine {
                operation,
                operands,
            } => {
                if operands.is_empty() || !T::supports(*operation) {
                    return Err(invalid(
                        "Value tree combine needs operands and a supported operation.",
                    ));
                }
                let mut evaluated = Vec::new();
                for operand in operands {
                    evaluated.push(self.evaluate(operand, depth + 1)?);
                }
                let length = evaluated[0].len();
                if evaluated.iter().any(|values| values.len() != length) {
                    return Err(invalid(
                        "Value tree combine operands must have equal leaf counts.",
                    ));
                }
                let mut result = Vec::new();
                for index in 0..length {
                    self.spend(evaluated.len())?;
                    let values: Vec<_> = evaluated.iter().map(|values| &values[index]).collect();
                    result.push(self.combine(*operation, &values)?);
                }
                Ok(result)
            }
            ValueTree::Expand {
                parent,
                children,
                operation,
            } => {
                if children.is_empty() || !T::supports(*operation) {
                    return Err(invalid(
                        "Value tree expansion needs children and a supported operation.",
                    ));
                }
                let parent = self.evaluate(parent, depth + 1)?;
                let mut evaluated = Vec::new();
                // Validate/evaluate even child alternatives not selected by a
                // short parent; unreachable malformed branches are still errors.
                for child in children {
                    evaluated.push(self.evaluate(child, depth + 1)?);
                }
                let mut result = Vec::new();
                for (ordinal, parent) in parent.iter().enumerate() {
                    for child in &evaluated[ordinal % evaluated.len()] {
                        result.push(self.combine(*operation, &[parent, child])?);
                    }
                }
                Ok(result)
            }
        }
    }

    fn repeated_values(&mut self, source: &[T], count: usize) -> CoreResult<Vec<T>> {
        if count > self.limits.max_events.saturating_sub(self.events) {
            return Err(budget("Value tree event budget exceeded."));
        }
        let mut result = Vec::new();
        for index in 0..count {
            result.push(self.clone_value(&source[index % source.len()])?);
        }
        Ok(result)
    }
}

/// Evaluate an untimed tree under the same resource contract as timed patterns.
/// Every definition is validated, including unused definitions. All intermediate
/// materialized values count against the event budget; reference expansion is
/// explicit work rather than an uncharged cache or an implicit infinite stream.
pub fn evaluate_value_tree<T: PatternValue>(
    program: &ValueTreeProgram<T>,
    limits: &PatternLimits,
) -> CoreResult<EvaluatedValueTree<T>> {
    if limits.max_depth == 0
        || limits.max_depth > 256
        || limits.max_work == 0
        || limits.max_work > 8_000_000
        || limits.max_events == 0
        || limits.max_events > 1_000_000
    {
        return Err(invalid("Value tree limits exceed supported bounds."));
    }
    let mut evaluation = Evaluation {
        definitions: &program.definitions,
        limits,
        visiting: BTreeSet::new(),
        work: 0,
        events: 0,
        height: 0,
    };
    for id in program.definitions.keys() {
        evaluation.definition(id, 0)?;
    }
    let values = evaluation.evaluate(&program.tree, 0)?;
    Ok(EvaluatedValueTree {
        values,
        work: evaluation.work,
        allocations: evaluation.events,
        height: evaluation.height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf<T>(value: T) -> ValueTree<T> {
        ValueTree::Leaf { value }
    }

    fn sequence<T>(values: impl IntoIterator<Item = T>) -> ValueTree<T> {
        ValueTree::Sequence {
            items: values.into_iter().map(leaf).collect(),
        }
    }

    fn run<T: PatternValue>(tree: ValueTree<T>) -> CoreResult<EvaluatedValueTree<T>> {
        evaluate_value_tree(
            &ValueTreeProgram {
                definitions: BTreeMap::new(),
                tree,
            },
            &PatternLimits::default(),
        )
    }

    #[test]
    fn shared_outer_and_inner_degrees_form_an_untimed_tree() {
        let mut program = ValueTreeProgram {
            definitions: BTreeMap::from([
                ("A".into(), sequence([0i64, 1, 2])),
                ("B".into(), sequence([0i64, 2, 1])),
            ]),
            tree: ValueTree::Expand {
                parent: Box::new(ValueTree::Ref { id: "A".into() }),
                children: vec![ValueTree::Ref { id: "B".into() }],
                operation: PatternOperation::Add,
            },
        };
        let original = evaluate_value_tree(&program, &PatternLimits::default()).unwrap();
        assert_eq!(original.values, [0, 2, 1, 1, 3, 2, 2, 4, 3]);
        assert_eq!(original.height, 4);
        assert!(original.allocations > original.values.len());
        program.definitions.insert("B".into(), sequence([0, 1]));
        assert_eq!(
            evaluate_value_tree(&program, &PatternLimits::default())
                .unwrap()
                .values,
            [0, 1, 1, 2, 2, 3]
        );
        let json = serde_json::to_string(&program).unwrap();
        assert!(!json.contains("span"));
        assert!(!json.contains("duration"));
        let restored: ValueTreeProgram<i64> = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, program);
    }

    #[test]
    fn expansion_accepts_different_child_lengths_and_multiple_levels() {
        let inner = ValueTree::Expand {
            parent: Box::new(sequence([0i64, 10, 20])),
            children: vec![sequence([0, 1]), sequence([2, 3, 4])],
            operation: PatternOperation::Add,
        };
        assert_eq!(
            run(inner.clone()).unwrap().values,
            [0, 1, 12, 13, 14, 20, 21]
        );
        let nested = ValueTree::Expand {
            parent: Box::new(sequence([0i64, 100])),
            children: vec![inner],
            operation: PatternOperation::Add,
        };
        assert_eq!(
            run(nested).unwrap().values,
            [0, 1, 12, 13, 14, 20, 21, 100, 101, 112, 113, 114, 120, 121]
        );
        assert_eq!(
            run(ValueTree::Combine {
                operation: PatternOperation::Add,
                operands: vec![sequence([0i64, 1]), sequence([2, 3]), sequence([4, 5])],
            })
            .unwrap()
            .values,
            [6, 9]
        );
    }

    #[test]
    fn repeat_and_cycle_have_explicit_distinct_leaf_counts() {
        assert_eq!(
            run(ValueTree::Repeat {
                tree: Box::new(sequence([1i64, 2, 3])),
                count: 2,
            })
            .unwrap()
            .values,
            [1, 2, 3, 1, 2, 3]
        );
        assert_eq!(
            run(ValueTree::Cycle {
                tree: Box::new(sequence([1i64, 2, 3])),
                count: 4,
            })
            .unwrap()
            .values,
            [1, 2, 3, 1]
        );
        assert_eq!(
            run(ValueTree::Cycle {
                tree: Box::new(sequence([1i64, 2, 3])),
                count: 1,
            })
            .unwrap()
            .values,
            [1]
        );
    }

    #[test]
    fn rational_values_form_duration_trees_without_implied_time() {
        let half = PatternTime::new(1, 2).unwrap();
        let third = PatternTime::new(1, 3).unwrap();
        let result = run(ValueTree::Expand {
            parent: Box::new(sequence([PatternTime::integer(2), PatternTime::one()])),
            children: vec![sequence([half, third])],
            operation: PatternOperation::Multiply,
        })
        .unwrap();
        assert_eq!(
            result.values,
            [
                PatternTime::one(),
                PatternTime::new(2, 3).unwrap(),
                PatternTime::new(1, 2).unwrap(),
                PatternTime::new(1, 3).unwrap(),
            ]
        );
        assert_eq!(
            run(leaf(PatternTime::zero())).unwrap().values,
            [PatternTime::zero()]
        );
        assert!(
            run(leaf(PatternTime {
                numerator: 1,
                denominator: 0
            }))
            .is_err()
        );
    }

    #[test]
    fn other_domains_use_their_own_operations() {
        assert_eq!(
            run(ValueTree::Combine {
                operation: PatternOperation::All,
                operands: vec![sequence([true, false]), sequence([false, true])],
            })
            .unwrap()
            .values,
            [false, false]
        );
        assert_eq!(
            run(ValueTree::Combine {
                operation: PatternOperation::Concat,
                operands: vec![leaf(vec![1i64, 3]), leaf(vec![5])],
            })
            .unwrap()
            .values,
            [vec![1, 3, 5]]
        );
        assert!(
            run(ValueTree::Combine {
                operation: PatternOperation::Add,
                operands: vec![leaf(true)],
            })
            .is_err()
        );
        assert!(
            run(ValueTree::Combine {
                operation: PatternOperation::Add,
                operands: vec![sequence([0i64]), sequence([1, 2])],
            })
            .is_err()
        );
    }

    #[test]
    fn invalid_unused_definitions_and_unselected_children_fail() {
        let program = ValueTreeProgram {
            definitions: BTreeMap::from([
                ("unused".into(), ValueTree::Ref { id: "other".into() }),
                (
                    "other".into(),
                    ValueTree::Ref {
                        id: "unused".into(),
                    },
                ),
            ]),
            tree: leaf(0i64),
        };
        let error = evaluate_value_tree(&program, &PatternLimits::default()).unwrap_err();
        assert!(error.message.contains("Cyclic"));
        assert!(
            run(ValueTree::Expand {
                parent: Box::new(leaf(0i64)),
                children: vec![
                    leaf(1),
                    ValueTree::Ref {
                        id: "missing".into()
                    }
                ],
                operation: PatternOperation::Add,
            })
            .is_err()
        );
        assert!(
            run(ValueTree::Cycle {
                tree: Box::new(sequence([0i64, i64::MAX])),
                count: 1,
            })
            .is_err()
        );
    }

    #[test]
    fn cumulative_events_depth_and_generic_value_complexity_are_bounded() {
        let limits = PatternLimits {
            max_events: 5,
            ..PatternLimits::default()
        };
        let tree = ValueTree::Repeat {
            tree: Box::new(sequence([0i64, 1])),
            count: 2,
        };
        let program = ValueTreeProgram {
            definitions: BTreeMap::new(),
            tree,
        };
        // Four returned values plus two source values exceed the allowance.
        assert_eq!(
            evaluate_value_tree(&program, &limits).unwrap_err().code,
            "budget-exceeded"
        );
        let definitions = BTreeMap::from([
            ("a".into(), ValueTree::Ref { id: "b".into() }),
            ("b".into(), leaf(0i64)),
        ]);
        let program = ValueTreeProgram {
            definitions,
            tree: ValueTree::Ref { id: "a".into() },
        };
        let limits = PatternLimits {
            max_depth: 2,
            ..PatternLimits::default()
        };
        assert_eq!(
            evaluate_value_tree(&program, &limits).unwrap_err().code,
            "budget-exceeded"
        );
        let program = ValueTreeProgram {
            definitions: BTreeMap::new(),
            tree: leaf(vec![0i64; 32]),
        };
        let limits = PatternLimits {
            max_work: 16,
            ..PatternLimits::default()
        };
        assert_eq!(
            evaluate_value_tree(&program, &limits).unwrap_err().code,
            "budget-exceeded"
        );
        let huge = ValueTree::Repeat {
            tree: Box::new(leaf(0i64)),
            count: MAX_SAFE,
        };
        assert_eq!(run(huge).unwrap_err().code, "budget-exceeded");
    }
}
