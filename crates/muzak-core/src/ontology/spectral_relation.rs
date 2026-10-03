//! Correspondences between pitch selection, tuning and conditioned spectra.
//!
//! Sethares relates scale positions to local minima of a spectrum-dependent
//! dissonance curve. These are explicit design constraints/hypotheses, not a
//! universal consonance label, an inferred optimum, or an audio renderer.
//! Source: https://sethares.engr.wisc.edu/consemi.html

use super::{EntityId, Scalar, spectrum::FrequencyRatio};
use crate::{
    error::{CoreResult, invalid},
    model::MAX_SAFE,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

/// A relation may couple one timbre to itself at different degrees, or several
/// timbres. It owns no copies of the scale, tuning or spectral measurements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectralTuningCorrespondence")]
pub struct SpectralTuningCorrespondence {
    pub scale: EntityId,
    pub tuning: EntityId,
    pub sounds: Vec<CorrespondenceSound>,
    /// The criterion being sought, not a stored claim that it has been achieved.
    pub criterion: SpectralCriterion,
    /// Candidate correspondences, retaining both exact member addresses.
    /// Coincidence is not proof of a local roughness minimum.
    pub partial_pairs: Vec<PartialPair>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyCorrespondenceSound")]
pub struct CorrespondenceSound {
    pub id: String,
    pub timbre: EntityId,
    /// Stable ID of a SpectrumBinding on this timbre. That binding carries the
    /// spectrum and its register, time, excitation, technique and processing stage.
    pub binding: String,
    /// Explicit interpretation of relative/logarithmic partial frequencies at
    /// this sound's endpoints. No transposition behavior is inferred from a
    /// spectrum's measured reference or a shared tuning alone.
    pub frequency_use: SpectrumFrequencyUse,
    /// Additional linear acoustic amplitude multiplier, never MIDI velocity.
    /// Nonnegative: muting retains the constraint, without proving compatibility.
    pub gain: f64,
}

/// Distinguishes a spectral snapshot from a declared transposition premise.
/// Neither choice establishes that a physical timbre is invariant under edits.
/// Absolute-Hz partials retain their supplied frequencies in both cases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectrumFrequencyUse")]
pub enum SpectrumFrequencyUse {
    /// Relative/logarithmic partials use the selected SpectrumBinding context's
    /// reference Hz. The endpoint's tuning degree remains a target association
    /// or constraint; it does not retune this fixed snapshot.
    FixedAtBindingReference,
    /// Relative/logarithmic partials use the frequency of the endpoint's selected
    /// tuning degree and signed period as their target reference. The binding's
    /// original reference Hz remains an observation/design condition. Tracking
    /// that target is an explicit modeling premise, not evidence that this
    /// spectrum describes the physical timbre in a different register.
    RelativeToTuningDegree,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySpectralCriterion")]
pub enum SpectralCriterion {
    PartialAlignment,
    LocalRoughnessMinimum { model: SensoryDissonanceModel },
}

/// Explicitly identifies the author's published computational convention.
/// No dissonance calculation or fitted parameters are implemented by this type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "OntologySensoryDissonanceModel")]
pub enum SensoryDissonanceModel {
    /// https://sethares.engr.wisc.edu/comprog.html
    /// s=.24/(.0207*min(f1,f2)+18.96), x=s*abs(f1-f2);
    /// d=min(a1,a2)*5*(exp(-3.51*x)-exp(-5.75*x)).
    /// Frequencies are Hz and amplitudes are linear, on the same scale.
    /// Absolute register affects the curve; transposition is not an invariance.
    SetharesPublishedCode { pairs: PartialPairPolicy },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyPartialPairPolicy")]
pub enum PartialPairPolicy {
    /// Interactions across sounds, excluding each sound's intrinsic roughness.
    CrossSoundPairs,
    /// Every unordered pair in the combined partial set, including within sounds.
    AllUnorderedPairs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologySpectralEndpoint")]
pub struct SpectralEndpoint {
    pub sound: String,
    /// Zero-based index in the scale's selected degrees, not the whole tuning.
    /// The sound's frequency_use determines whether this is a target association
    /// for a fixed snapshot or the reference used by relative/log partials.
    pub scale_degree: u32,
    /// Signed repetition of the tuning's declared period. It need not be 2:1.
    /// Any mapping without a declared repetition accepts only period zero.
    pub period: i32,
    pub partial: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyPartialPair")]
pub struct PartialPair {
    pub left: SpectralEndpoint,
    pub right: SpectralEndpoint,
}

impl SpectralTuningCorrespondence {
    pub fn validate(&self) -> CoreResult<()> {
        for id in self.references() {
            id.validate()?;
        }
        if self.sounds.is_empty() {
            return Err(invalid("A spectral correspondence needs a sound."));
        }
        let mut sounds = HashSet::new();
        for sound in &self.sounds {
            if sound.id.trim().is_empty()
                || !sounds.insert(sound.id.as_str())
                || sound.binding.trim().is_empty()
                || !sound.gain.is_finite()
                || sound.gain < 0.0
            {
                return Err(invalid(
                    "Spectral sounds need unique IDs, bindings and nonnegative finite acoustic gains.",
                ));
            }
        }
        if matches!(self.criterion, SpectralCriterion::PartialAlignment)
            && self.partial_pairs.is_empty()
        {
            return Err(invalid(
                "An alignment constraint needs an explicit partial pair.",
            ));
        }
        let mut pairs = HashSet::new();
        for pair in &self.partial_pairs {
            for endpoint in [&pair.left, &pair.right] {
                if !sounds.contains(endpoint.sound.as_str()) || endpoint.partial.trim().is_empty() {
                    return Err(invalid(
                        "A spectral endpoint must name a sound and partial.",
                    ));
                }
            }
            if pair.left == pair.right || !pairs.insert(serde_json::to_string(pair)?) {
                return Err(invalid("Spectral pairs must be distinct and nontrivial."));
            }
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<&EntityId> {
        std::iter::once(&self.scale)
            .chain(std::iter::once(&self.tuning))
            .chain(self.sounds.iter().map(|sound| &sound.timbre))
            .collect()
    }
}

/// A shared parameter for coordinated spectral and tuning transformations:
/// `ratio -> ratio^factor`, or `log-frequency interval -> interval * factor`.
/// This preserves ratio coincidences when applied on both sides, not a complete
/// roughness curve or a perceptual judgment. A positive factor permits stretch
/// and compression without reversing the pitch axis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(rename = "OntologyLogFrequencyWarp")]
pub struct LogFrequencyWarp {
    pub factor: Scalar,
}
impl LogFrequencyWarp {
    pub fn validate(&self) -> CoreResult<()> {
        self.factor.validate()?;
        if self.factor.value()? <= 0.0 {
            return Err(invalid("A log-frequency warp needs a positive factor."));
        }
        Ok(())
    }

    /// Numerical acoustic projection; the stored ratio and declared factor
    /// remain authoritative. This does not round a ratio onto native pitch.
    pub fn project_ratio(&self, ratio: &FrequencyRatio) -> CoreResult<f64> {
        self.validate()?;
        let result = (self.factor.value()? * ratio.ln_value()?).exp();
        if !result.is_finite() || result <= 0.0 {
            return Err(invalid("Warped frequency ratio is outside numeric range."));
        }
        Ok(result)
    }

    /// Native intervals are exact integers. Reject a nonintegral result rather
    /// than silently turning exact acoustic relationships into rounded notes.
    pub fn map_native_interval(&self, millicents: i64) -> CoreResult<i64> {
        self.validate()?;
        if millicents.unsigned_abs() > MAX_SAFE {
            return Err(invalid("Unsafe native pitch interval."));
        }
        let Scalar::Exact { value: factor } = &self.factor else {
            return Err(invalid(
                "An approximate warp needs an explicit native rounding decision.",
            ));
        };
        let product = i128::from(millicents) * i128::from(factor.numerator);
        let denominator = i128::from(factor.denominator);
        if product % denominator != 0 {
            return Err(invalid(
                "Warped native interval needs an explicit rounding decision.",
            ));
        }
        let result = product / denominator;
        if result.unsigned_abs() > u128::from(MAX_SAFE) {
            return Err(invalid("Warped native interval is outside exact range."));
        }
        Ok(result as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ratio(n: i64, d: u64) -> FrequencyRatio {
        FrequencyRatio::exact(n, d)
    }
    #[test]
    fn shared_stretch_preserves_a_partial_alignment_but_tuning_only_does_not() {
        // At a 3:2 interval, partial 3 of the lower tone coincides with partial 2
        // of the upper tone. Carry their identities through a common stretch.
        let warp = LogFrequencyWarp {
            factor: Scalar::exact(7, 6),
        };
        let lower = warp.project_ratio(&ratio(3, 1)).unwrap();
        let interval = warp.project_ratio(&ratio(3, 2)).unwrap();
        let upper = interval * warp.project_ratio(&ratio(2, 1)).unwrap();
        assert!((lower - upper).abs() < 1e-12);
        assert!((3.0 - interval * 2.0).abs() > 0.1);
        assert_ne!(warp.project_ratio(&ratio(2, 1)).unwrap(), 2.0);
        // This is an algebraic alignment control, not a consonance score.
    }
    #[test]
    fn identity_and_exact_native_projection_have_explicit_limits() {
        let identity = LogFrequencyWarp {
            factor: Scalar::exact(1, 1),
        };
        assert_eq!(identity.project_ratio(&ratio(3, 2)).unwrap(), 1.5);
        assert_eq!(identity.map_native_interval(-700_001).unwrap(), -700_001);
        let warp = LogFrequencyWarp {
            factor: Scalar::exact(7, 6),
        };
        assert_eq!(warp.map_native_interval(1_200_000).unwrap(), 1_400_000);
        assert!(warp.map_native_interval(1).is_err());
        assert!(warp.map_native_interval(MAX_SAFE as i64).is_err());
        let approximate = LogFrequencyWarp {
            factor: Scalar::approximate(2.1_f64.log2()),
        };
        assert!((approximate.project_ratio(&ratio(2, 1)).unwrap() - 2.1).abs() < 1e-12);
        assert!(approximate.map_native_interval(1_200_000).is_err());
        let json = serde_json::to_string(&warp).unwrap();
        assert_eq!(
            serde_json::from_str::<LogFrequencyWarp>(&json).unwrap(),
            warp
        );
    }
}
