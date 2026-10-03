//! Shared dimensionless arithmetic. Domain types supply units and constraints;
//! an exact fraction is never replaced with its floating-point projection.

use super::Rational;
use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename = "OntologyScalar")]
pub enum Scalar {
    Exact { value: Rational },
    Approximate { value: f64 },
}
impl Scalar {
    pub fn exact(numerator: i64, denominator: u64) -> Self {
        Self::Exact {
            value: Rational {
                numerator,
                denominator,
            },
        }
    }
    pub fn approximate(value: f64) -> Self {
        Self::Approximate { value }
    }
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Exact { value } => value.validate(),
            Self::Approximate { value } if value.is_finite() => Ok(()),
            _ => Err(invalid("An approximate scalar must be finite.")),
        }
    }
    /// Explicit numerical projection. It does not establish equality between
    /// two exact values whose projections happen to coincide.
    pub fn value(&self) -> CoreResult<f64> {
        self.validate()?;
        Ok(match self {
            Self::Exact { value } => value.numerator as f64 / value.denominator as f64,
            Self::Approximate { value } => *value,
        })
    }
    pub fn compare(&self, other: &Self) -> CoreResult<std::cmp::Ordering> {
        self.validate()?;
        other.validate()?;
        match (self, other) {
            (Self::Exact { value: left }, Self::Exact { value: right }) => left.compare(right),
            _ => Ok(self
                .value()?
                .partial_cmp(&other.value()?)
                .expect("validated finite scalars")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_unbounded_coordinates_preserve_declared_precision() {
        for scalar in [
            Scalar::exact(-7, 3),
            Scalar::approximate(4.125),
            Scalar::exact(0, 1),
        ] {
            scalar.validate().unwrap();
            let json = serde_json::to_string(&scalar).unwrap();
            assert_eq!(serde_json::from_str::<Scalar>(&json).unwrap(), scalar);
        }
        assert!(Scalar::approximate(f64::NAN).validate().is_err());
        assert!(Scalar::approximate(f64::INFINITY).validate().is_err());
        assert!(Scalar::exact(1, 0).validate().is_err());
    }
    #[test]
    fn exact_comparison_does_not_collapse_close_coordinates() {
        let left = Scalar::exact(9_007_199_254_740_989, 9_007_199_254_740_990);
        let right = Scalar::exact(9_007_199_254_740_990, 9_007_199_254_740_991);
        assert_eq!(left.value().unwrap(), right.value().unwrap());
        assert_eq!(left.compare(&right).unwrap(), std::cmp::Ordering::Less);
    }
}
