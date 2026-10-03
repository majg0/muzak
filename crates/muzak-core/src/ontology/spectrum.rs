//! A spectrum describes sinusoidal partials, independently of the instrument or
//! synthesis method that produced them. It is one aspect of a timbre, not a
//! timbre identity, perceived pitch, or a claim about musical consonance.

use super::{EntityId, Rational, Scalar};
use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

/// Preserve exact ratios when known; measured or irrational values remain
/// explicitly approximate. Neither representation assumes octave equivalence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(rename = "OntologyFrequencyRatio")]
pub struct FrequencyRatio(pub Scalar);
impl FrequencyRatio {
    pub fn exact(numerator: i64, denominator: u64) -> Self {
        Self(Scalar::Exact {
            value: Rational {
                numerator,
                denominator,
            },
        })
    }

    pub fn approximate(value: f64) -> Self {
        Self(Scalar::Approximate { value })
    }

    pub fn validate(&self) -> CoreResult<()> {
        positive(self.0.value()?, "frequency ratio")
    }

    /// Explicit floating-point projection for acoustic calculations. The stored
    /// exact ratio remains authoritative; this projection is not exact equality.
    pub fn value(&self) -> CoreResult<f64> {
        self.validate()?;
        self.0.value()
    }

    /// Rational pairs compare by exact cross products. A comparison involving a
    /// measured/approximate ratio uses its explicitly approximate projection.
    pub fn compare(&self, other: &Self) -> CoreResult<std::cmp::Ordering> {
        self.validate()?;
        other.validate()?;
        self.0.compare(&other.0)
    }

    /// A stable logarithmic projection, including exact ratios close enough to
    /// unity that their direct f64 quotients can round to one.
    pub fn ln_value(&self) -> CoreResult<f64> {
        self.validate()?;
        Ok(match &self.0 {
            Scalar::Exact { value } => {
                let numerator = value.numerator as f64;
                let denominator = value.denominator as f64;
                let difference = i128::from(value.numerator) - i128::from(value.denominator);
                if difference.unsigned_abs() * 2 <= u128::from(value.denominator) {
                    (difference as f64 / denominator).ln_1p()
                } else {
                    numerator.ln() - denominator.ln()
                }
            }
            Scalar::Approximate { value } => value.ln(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySpectralFrequency")]
pub enum SpectralFrequency {
    /// Relative to the binding's reference frequency. A unison partial need not
    /// exist, and the reference need not be a perceived or physical fundamental.
    Relative { ratio: FrequencyRatio },
    /// Relative logarithmic coordinate, preserving expressions such as 2^(7/12)
    /// without replacing their exact inputs with an approximate ratio.
    Logarithmic {
        basis: FrequencyRatio,
        coordinate: Scalar,
    },
    /// Literal Hz in this spectral snapshot. Changing the reference does not
    /// retune it; no tracking or transposition behavior is inferred.
    Absolute { frequency_hz: f64 },
}
impl SpectralFrequency {
    pub fn validate(&self) -> CoreResult<()> {
        match self {
            Self::Relative { ratio } => ratio.validate(),
            Self::Logarithmic { basis, coordinate } => {
                validate_log_basis(basis)?;
                coordinate.validate()
            }
            Self::Absolute { frequency_hz } => positive(*frequency_hz, "partial frequency"),
        }
    }

    /// Resolve one frequency numerically without synthesizing or evaluating it.
    /// Overflow and underflow to zero are explicit errors, never silent losses.
    pub fn hertz(&self, reference_hz: f64) -> CoreResult<f64> {
        positive(reference_hz, "spectrum reference frequency")?;
        self.validate()?;
        let frequency_hz = match self {
            Self::Relative { ratio } => reference_hz * ratio.value()?,
            Self::Logarithmic { basis, coordinate } => {
                project_log_frequency(reference_hz, basis, coordinate.value()?)?
            }
            Self::Absolute { frequency_hz } => *frequency_hz,
        };
        positive(frequency_hz, "resolved partial frequency")?;
        Ok(frequency_hz)
    }
}

pub(crate) fn validate_log_basis(basis: &FrequencyRatio) -> CoreResult<()> {
    if basis.compare(&FrequencyRatio::exact(1, 1))? == std::cmp::Ordering::Equal {
        return Err(invalid("A logarithmic frequency basis cannot equal one."));
    }
    Ok(())
}

/// Shared numerical projection for tuning and spectral coordinates. Work in the
/// log domain so a representable result does not fail on an intermediate power.
pub(crate) fn project_log_frequency(
    reference_hz: f64,
    basis: &FrequencyRatio,
    coordinate: f64,
) -> CoreResult<f64> {
    positive(reference_hz, "reference frequency")?;
    validate_log_basis(basis)?;
    finite(coordinate, "logarithmic coordinate")?;
    let frequency_hz = if coordinate == 0.0 {
        reference_hz
    } else {
        coordinate
            .mul_add(basis.ln_value()?, reference_hz.ln())
            .exp()
    };
    positive(frequency_hz, "projected frequency")?;
    Ok(frequency_hz)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectralPartial")]
pub struct SpectralPartial {
    /// Stable member identity, independent of order and current frequency.
    pub id: String,
    pub frequency: SpectralFrequency,
    /// Nonnegative linear amplitude in the spectrum's common amplitude scale.
    /// This is neither power, perceived loudness, nor performer excitation.
    pub amplitude: f64,
    /// Phase in cycles when known. Unknown phase is not an assumed zero phase.
    pub phase_cycles: Option<f64>,
}
impl SpectralPartial {
    pub fn validate(&self) -> CoreResult<()> {
        if self.id.trim().is_empty() {
            return Err(invalid("A spectral partial needs a stable identity."));
        }
        self.frequency.validate()?;
        nonnegative(self.amplitude, "partial amplitude")?;
        if let Some(phase) = self.phase_cycles {
            finite(phase, "partial phase")?;
        }
        Ok(())
    }
}

/// A finite sinusoidal-partial description. Partials may be inharmonic, omit
/// a fundamental, or coincide in frequency while retaining distinct identities.
/// This representation alone does not describe broadband noise or transients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologySpectrum")]
pub struct Spectrum {
    /// Member order and identity survive serialization; validation never sorts,
    /// merges coincident frequencies, normalizes amplitude, or invents partials.
    pub partials: Vec<SpectralPartial>,
}
impl Spectrum {
    pub fn validate(&self) -> CoreResult<()> {
        if self.partials.is_empty() {
            return Err(invalid("A spectrum needs at least one partial."));
        }
        let mut ids = HashSet::new();
        for partial in &self.partials {
            partial.validate()?;
            if !ids.insert(&partial.id) {
                return Err(invalid("Duplicate spectral partial identity."));
            }
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        vec![]
    }

    pub fn partial(&self, id: &str) -> Option<&SpectralPartial> {
        self.partials.iter().find(|partial| partial.id == id)
    }
}

/// Associates a reusable spectrum with the conditions under which it describes
/// a timbre. Equal spectra do not establish timbre identity or parameter sharing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologySpectrumBinding")]
pub struct SpectrumBinding {
    /// Stable identity within a timbre, independent of vector position or context.
    pub id: String,
    pub spectrum: EntityId,
    pub context: SpectrumContext,
}
impl SpectrumBinding {
    pub fn validate(&self) -> CoreResult<()> {
        if self.id.trim().is_empty() {
            return Err(invalid("A spectrum binding needs a stable identity."));
        }
        self.spectrum.validate()?;
        self.context.validate()
    }

    pub fn references(&self) -> Vec<&EntityId> {
        std::iter::once(&self.spectrum)
            .chain(self.context.references())
            .collect()
    }
}

/// Conditions of an authored or measured spectrum. Missing controls or elapsed
/// time remain unknown; they neither mean zero nor promise invariance to edits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectrumContext")]
pub struct SpectrumContext {
    /// Scale reference for relative partials; no fundamental is implied.
    pub reference_frequency_hz: f64,
    /// Nonnegative seconds since the sound's onset, when known.
    pub elapsed_seconds: Option<f64>,
    /// Normalized performer control in [0, 1], independent of spectral amplitude.
    pub excitation: Option<f64>,
    pub technique: Option<EntityId>,
    pub stage: SpectrumStage,
}
impl SpectrumContext {
    pub fn validate(&self) -> CoreResult<()> {
        positive(self.reference_frequency_hz, "spectrum reference frequency")?;
        if let Some(elapsed_seconds) = self.elapsed_seconds {
            nonnegative(elapsed_seconds, "spectrum elapsed time")?;
        }
        if let Some(excitation) = self.excitation {
            finite(excitation, "spectrum excitation")?;
            if !(0.0..=1.0).contains(&excitation) {
                return Err(invalid("Spectrum excitation must be between zero and one."));
            }
        }
        for id in self.references() {
            id.validate()?;
        }
        Ok(())
    }

    pub fn references(&self) -> Vec<&EntityId> {
        self.technique.iter().collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectrumStage")]
pub enum SpectrumStage {
    BeforeEffects,
    AfterEffects,
    Unspecified,
}

fn finite(value: f64, label: &str) -> CoreResult<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(invalid(format!("{label} must be finite.")))
    }
}

fn positive(value: f64, label: &str) -> CoreResult<()> {
    finite(value, label)?;
    if value <= 0.0 {
        Err(invalid(format!("{label} must be positive.")))
    } else {
        Ok(())
    }
}

fn nonnegative(value: f64, label: &str) -> CoreResult<()> {
    finite(value, label)?;
    if value < 0.0 {
        Err(invalid(format!("{label} cannot be negative.")))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logarithmic_partials_keep_exact_coordinates_and_independent_reference() {
        let frequency = SpectralFrequency::Logarithmic {
            basis: FrequencyRatio::exact(2, 1),
            coordinate: Scalar::exact(7, 12),
        };
        let expected = 440.0 * 2.0_f64.powf(7.0 / 12.0);
        assert!((frequency.hertz(440.0).unwrap() - expected).abs() < 1e-10);
        assert!((frequency.hertz(432.0).unwrap() / expected - 432.0 / 440.0).abs() < 1e-12);
        assert_eq!(
            serde_json::from_str::<SpectralFrequency>(&serde_json::to_string(&frequency).unwrap())
                .unwrap(),
            frequency
        );
        for coordinate in [-1.5, 0.0, 2.25] {
            let frequency = SpectralFrequency::Logarithmic {
                basis: FrequencyRatio::exact(3, 1),
                coordinate: Scalar::approximate(coordinate),
            };
            assert!(
                (frequency.hertz(100.0).unwrap() - 100.0 * 3.0_f64.powf(coordinate)).abs() < 1e-10
            );
        }
        let frequency = SpectralFrequency::Logarithmic {
            basis: FrequencyRatio::exact(2, 1),
            coordinate: Scalar::exact(1024, 1),
        };
        assert!((frequency.hertz(2.0_f64.powi(-1022)).unwrap() - 4.0).abs() < 1e-10);
        assert!(frequency.hertz(2.0).is_err());
        for basis in [0.0, 1.0, -2.0, f64::NAN, f64::INFINITY] {
            assert!(
                SpectralFrequency::Logarithmic {
                    basis: FrequencyRatio::approximate(basis),
                    coordinate: Scalar::exact(0, 1),
                }
                .validate()
                .is_err()
            );
        }
    }

    #[test]
    fn spectrum_preserves_inharmonic_coincident_and_missing_fundamental_partials() {
        let mut spectrum = Spectrum {
            partials: vec![
                SpectralPartial {
                    id: "higher".into(),
                    frequency: SpectralFrequency::Relative {
                        ratio: FrequencyRatio::approximate(3.17),
                    },
                    amplitude: 0.5,
                    phase_cycles: None,
                },
                SpectralPartial {
                    id: "lower".into(),
                    frequency: SpectralFrequency::Relative {
                        ratio: FrequencyRatio::exact(3, 2),
                    },
                    amplitude: 0.0,
                    phase_cycles: Some(-0.25),
                },
                SpectralPartial {
                    id: "coincident".into(),
                    frequency: SpectralFrequency::Absolute {
                        frequency_hz: 300.0,
                    },
                    amplitude: 1.0,
                    phase_cycles: Some(0.25),
                },
            ],
        };
        spectrum.validate().unwrap();
        assert_eq!(spectrum.partials[1].frequency.hertz(200.0).unwrap(), 300.0);
        assert_eq!(spectrum.partials[2].frequency.hertz(400.0).unwrap(), 300.0);
        assert_eq!(
            serde_json::from_str::<Spectrum>(&serde_json::to_string(&spectrum).unwrap()).unwrap(),
            spectrum
        );
        spectrum.partials[1].frequency = SpectralFrequency::Relative {
            ratio: FrequencyRatio::exact(7, 4),
        };
        assert_eq!(spectrum.partials[1].frequency.hertz(200.0).unwrap(), 350.0);
        assert_eq!(spectrum.partials[2].frequency.hertz(200.0).unwrap(), 300.0);
        spectrum.partials[2].id = spectrum.partials[1].id.clone();
        assert!(spectrum.validate().is_err());
    }

    #[test]
    fn ratio_projection_rejects_invalid_and_unrepresentable_frequencies() {
        for value in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(FrequencyRatio::approximate(value).value().is_err());
        }
        for (numerator, denominator) in [(0, 1), (-1, 1), (1, 0), (1, crate::model::MAX_SAFE + 1)] {
            assert!(
                FrequencyRatio::exact(numerator, denominator)
                    .value()
                    .is_err()
            );
        }
        let frequency = SpectralFrequency::Relative {
            ratio: FrequencyRatio::approximate(f64::MAX),
        };
        assert!(frequency.hertz(2.0).is_err());
        let frequency = SpectralFrequency::Relative {
            ratio: FrequencyRatio::approximate(f64::from_bits(1)),
        };
        assert!(frequency.hertz(0.1).is_err());
    }

    #[test]
    fn frequency_ratio_preserves_scalar_storage_and_exact_comparison() {
        let ratio = FrequencyRatio::exact(6, 4);
        assert_eq!(
            ratio.compare(&FrequencyRatio::exact(3, 2)).unwrap(),
            std::cmp::Ordering::Equal
        );
        let json = serde_json::to_value(&ratio).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "exact",
                "value": {"numerator": 6, "denominator": 4},
            })
        );
        assert_eq!(
            serde_json::from_value::<FrequencyRatio>(json).unwrap(),
            ratio
        );
        assert!(ratio.compare(&FrequencyRatio::exact(-3, 2)).is_err());
    }

    #[test]
    fn spectral_context_preserves_unknowns_and_rejects_invalid_controls() {
        let mut context = SpectrumContext {
            reference_frequency_hz: 220.0,
            elapsed_seconds: None,
            excitation: None,
            technique: Some(EntityId("bowed".into())),
            stage: SpectrumStage::Unspecified,
        };
        context.validate().unwrap();
        assert_eq!(context.references(), vec![&EntityId("bowed".into())]);
        let json = serde_json::to_value(&context).unwrap();
        assert!(json["elapsedSeconds"].is_null());
        assert!(json["excitation"].is_null());
        context.excitation = Some(1.1);
        assert!(context.validate().is_err());
        context.excitation = Some(0.0);
        context.elapsed_seconds = Some(-0.1);
        assert!(context.validate().is_err());
        context.elapsed_seconds = Some(0.0);
        context.reference_frequency_hz = f64::NAN;
        assert!(context.validate().is_err());
    }
}
