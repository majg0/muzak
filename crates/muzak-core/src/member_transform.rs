//! Bounded executable alternatives over supplied parent palettes and domains.
//! This enumerates member edits, not parent/context discovery or musical scores.
//! The caller defines the finite palette and offset vocabulary. No tuning,
//! twelve-tone projection, probability, omission, or note ownership lives here.
use crate::{
    composition::{
        CompositionHarmony, PitchAnchor, PitchBinding, PitchLattice, pitch_lattice_degree,
        resolve_material_pitches,
    },
    error::{CoreResult, budget, invalid},
    model::{MAX_SAFE, Pitch, ScoreNote},
};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberTransform {
    Keep,
    Contextual { steps: i64 },
    Chromatic { millicents: i64 },
}

#[derive(Debug, Clone)]
pub struct MemberTransformLimits {
    /// Palette/domain members plus identifier bytes, before cloning contexts.
    pub max_context_members: usize,
    pub max_patterns: usize,
    pub max_candidate_checks: usize,
    pub max_programs: usize,
    /// Stored pattern members, rendered pitches and three program indices.
    pub max_output_members: usize,
}
impl Default for MemberTransformLimits {
    fn default() -> Self {
        Self {
            max_context_members: 4096,
            max_patterns: 4096,
            max_candidate_checks: 500_000,
            max_programs: 500_000,
            max_output_members: 4_000_000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MemberTransformOptions {
    /// Zero, one or two independently edited member slots; never omissions.
    pub max_changed_members: usize,
    /// Sorted distinct nonzero degree offsets. At most 16 total offset choices.
    pub contextual_steps: Vec<i64>,
    /// Sorted distinct nonzero native pitch offsets, with no implied temperament.
    pub chromatic_offsets: Vec<i64>,
    pub limits: MemberTransformLimits,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberPattern {
    pub transforms: Vec<MemberTransform>,
}
impl MemberPattern {
    pub fn uses_domain(&self) -> bool {
        self.transforms
            .iter()
            .any(|x| matches!(x, MemberTransform::Contextual { .. }))
    }
    /// Lower member slots to existing expressions. Actual context values and
    /// coordinate validity are checked by the composition compiler.
    pub fn bindings(&self, parent: &str, domain: Option<&str>) -> CoreResult<Vec<PitchBinding>> {
        self.transforms
            .iter()
            .enumerate()
            .map(|(tone, transform)| {
                Ok(match transform {
                    MemberTransform::Keep | MemberTransform::Chromatic { .. } => {
                        PitchBinding::Harmony {
                            harmony: parent.into(),
                            tone,
                            octave: 0,
                            residual_millicents: match transform {
                                MemberTransform::Chromatic { millicents } => *millicents,
                                _ => 0,
                            },
                        }
                    }
                    MemberTransform::Contextual { steps } => {
                        let anchor = PitchAnchor::Harmony {
                            harmony: parent.into(),
                            tone,
                            octave: 0,
                            residual_millicents: 0,
                        };
                        PitchBinding::LatticePath {
                            lattice: domain
                                .ok_or_else(|| invalid("Missing member-transform domain."))?
                                .into(),
                            from: anchor.clone(),
                            to: anchor,
                            numerator: 0,
                            denominator: 1,
                            degree_offset: *steps,
                            residual_millicents: 0,
                        }
                    }
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct MemberProgram {
    pub parent_index: usize,
    /// None for every domain-free pattern, even when domains were supplied.
    pub domain_index: Option<usize>,
    pub pattern_index: usize,
    /// Exact pitches in member order, retaining multiplicity and register.
    pub pitches: Vec<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct MemberTransformWork {
    pub context_members: usize,
    pub candidate_checks: usize,
    pub off_domain_anchor_rejections: usize,
    pub output_members: usize,
}

#[derive(Debug)]
pub struct MemberTransformInventory {
    pub patterns: Vec<MemberPattern>,
    pub programs: Vec<MemberProgram>,
    pub work: MemberTransformWork,
    parents: Vec<CompositionHarmony>,
    domains: Vec<PitchLattice>,
}
impl MemberTransformInventory {
    /// Existing compiler expressions, bound to the supplied context IDs. A
    /// changed context can be compiled independently; this does not select it.
    pub fn bindings_for(&self, program_index: usize) -> CoreResult<Vec<PitchBinding>> {
        let p = self
            .programs
            .get(program_index)
            .ok_or_else(|| invalid("Unknown member program."))?;
        let pattern = self
            .patterns
            .get(p.pattern_index)
            .ok_or_else(|| invalid("Unknown member pattern."))?;
        let parent = self
            .parents
            .get(p.parent_index)
            .ok_or_else(|| invalid("Unknown member parent."))?;
        let domain = p
            .domain_index
            .map(|i| {
                self.domains
                    .get(i)
                    .ok_or_else(|| invalid("Unknown member domain."))
            })
            .transpose()?;
        pattern.bindings(&parent.id, domain.map(|d| d.id.as_str()))
    }
}

fn charge(total: &mut usize, amount: usize, limit: usize, message: &str) -> CoreResult<()> {
    *total = total
        .checked_add(amount)
        .filter(|x| *x <= limit)
        .ok_or_else(|| budget(message))?;
    Ok(())
}
fn neutral_notes(n: usize) -> Vec<ScoreNote> {
    (0..n)
        .map(|i| ScoreNote {
            id: format!("member-{i}"),
            part: "members".into(),
            onset: 0,
            duration: 1,
            pitch: Pitch { millicents: 0 },
            velocity: 80,
            release_velocity: 64,
            pitch_envelope: None,
            gain_envelope: None,
            source: None,
        })
        .collect()
}

/// Enumerate the complete declared finite grammar or fail the whole call.
/// Palettes are alternatives, so their IDs may name the same parameter slot;
/// exact duplicate contexts are rejected. Distinct context IDs remain distinct
/// editable parameters. A domain-free program is never copied per domain.
///
/// Each palette contains 1..=12 member slots. Off-domain contextual anchors are
/// expected rejections. All other compiler errors, including unsafe native
/// coordinates after an edit, fail rather than silently removing alternatives.
pub fn enumerate_member_transforms(
    parents: &[CompositionHarmony],
    domains: &[PitchLattice],
    options: &MemberTransformOptions,
) -> CoreResult<MemberTransformInventory> {
    let l = &options.limits;
    if options.max_changed_members > 2
        || options
            .contextual_steps
            .len()
            .saturating_add(options.chromatic_offsets.len())
            > 16
        || l.max_context_members == 0
        || l.max_context_members > 65_536
        || l.max_patterns == 0
        || l.max_patterns > 65_536
        || l.max_candidate_checks == 0
        || l.max_candidate_checks > 5_000_000
        || l.max_programs == 0
        || l.max_programs > 1_000_000
        || l.max_output_members == 0
        || l.max_output_members > 16_000_000
    {
        return Err(invalid("Invalid member-transform limits."));
    }
    for offsets in [&options.contextual_steps, &options.chromatic_offsets] {
        if offsets
            .iter()
            .any(|x| *x == 0 || x.unsigned_abs() > MAX_SAFE)
            || offsets.windows(2).any(|w| w[0] >= w[1])
        {
            return Err(invalid(
                "Member offsets must be sorted, distinct, nonzero safe integers.",
            ));
        }
    }
    let mut work = MemberTransformWork::default();
    for (count, bytes) in parents
        .iter()
        .map(|h| (h.intervals.len(), h.id.len()))
        .chain(domains.iter().map(|d| (d.intervals.len(), d.id.len())))
    {
        charge(
            &mut work.context_members,
            count.saturating_add(bytes).saturating_add(1),
            l.max_context_members,
            "Member context budget exceeded.",
        )?;
    }
    let mut parent_keys = HashSet::new();
    for parent in parents {
        if parent.intervals.is_empty()
            || parent.intervals.len() > 12
            || !parent_keys.insert((&parent.id, parent.root_millicents, &parent.intervals))
        {
            return Err(invalid("Invalid or duplicate member parent."));
        }
        resolve_material_pitches(&[], &[], std::slice::from_ref(parent), &[])?;
    }
    let mut domain_keys = HashSet::new();
    for domain in domains {
        if !domain_keys.insert((
            &domain.id,
            domain.origin_millicents,
            domain.period_millicents,
            &domain.intervals,
        )) {
            return Err(invalid("Duplicate member domain."));
        }
        pitch_lattice_degree(domain.origin_millicents, domain)?;
    }
    let edits: Vec<_> = options
        .contextual_steps
        .iter()
        .map(|&steps| MemberTransform::Contextual { steps })
        .chain(
            options
                .chromatic_offsets
                .iter()
                .map(|&millicents| MemberTransform::Chromatic { millicents }),
        )
        .collect();
    let lengths: std::collections::BTreeSet<_> =
        parents.iter().map(|h| h.intervals.len()).collect();
    let mut patterns = Vec::new();
    let mut by_length = BTreeMap::new();
    for n in lengths {
        let mut add = |transforms: Vec<MemberTransform>| -> CoreResult<()> {
            if patterns.len() >= l.max_patterns {
                return Err(budget("Member pattern budget exceeded."));
            }
            charge(
                &mut work.output_members,
                n,
                l.max_output_members,
                "Member output budget exceeded.",
            )?;
            by_length
                .entry(n)
                .or_insert_with(Vec::new)
                .push(patterns.len());
            patterns.push(MemberPattern { transforms });
            Ok(())
        };
        add(vec![MemberTransform::Keep; n])?;
        if options.max_changed_members > 0 {
            for a in 0..n {
                for &edit in &edits {
                    let mut row = vec![MemberTransform::Keep; n];
                    row[a] = edit;
                    add(row)?;
                }
            }
        }
        if options.max_changed_members > 1 {
            for a in 0..n {
                for b in a + 1..n {
                    for &ea in &edits {
                        for &eb in &edits {
                            let mut row = vec![MemberTransform::Keep; n];
                            row[a] = ea;
                            row[b] = eb;
                            add(row)?;
                        }
                    }
                }
            }
        }
    }
    let mut estimated = 0;
    for parent in parents {
        for &pi in &by_length[&parent.intervals.len()] {
            charge(
                &mut estimated,
                if patterns[pi].uses_domain() {
                    domains.len()
                } else {
                    1
                },
                l.max_candidate_checks,
                "Member candidate-check budget exceeded.",
            )?;
        }
    }
    let mut programs = Vec::new();
    for (parent_index, parent) in parents.iter().enumerate() {
        let notes = neutral_notes(parent.intervals.len());
        for &pattern_index in &by_length[&notes.len()] {
            let pattern = &patterns[pattern_index];
            let choices = if pattern.uses_domain() {
                domains.len()
            } else {
                1
            };
            for di in 0..choices {
                work.candidate_checks += 1;
                let domain_index = pattern.uses_domain().then_some(di);
                let domain = domain_index.map(|i| &domains[i]);
                let mut eligible = true;
                if let Some(d) = domain {
                    for (tone, transform) in pattern.transforms.iter().enumerate() {
                        if matches!(transform, MemberTransform::Contextual { .. }) {
                            let pitch = i128::from(parent.root_millicents)
                                + i128::from(parent.intervals[tone]);
                            if pitch.unsigned_abs() > u128::from(MAX_SAFE) {
                                return Err(invalid("Unsafe member anchor coordinate."));
                            }
                            if pitch_lattice_degree(pitch as i64, d)?.is_none() {
                                eligible = false;
                            }
                        }
                    }
                }
                if !eligible {
                    work.off_domain_anchor_rejections += 1;
                    continue;
                }
                let bindings = pattern.bindings(&parent.id, domain.map(|d| d.id.as_str()))?;
                let pitches = resolve_material_pitches(
                    &notes,
                    &bindings,
                    std::slice::from_ref(parent),
                    domain.map_or(&[], std::slice::from_ref),
                )?;
                if programs.len() >= l.max_programs {
                    return Err(budget("Member program budget exceeded."));
                }
                charge(
                    &mut work.output_members,
                    pitches.len() + 3,
                    l.max_output_members,
                    "Member output budget exceeded.",
                )?;
                programs.push(MemberProgram {
                    parent_index,
                    domain_index,
                    pattern_index,
                    pitches,
                });
            }
        }
    }
    debug_assert_eq!(work.candidate_checks, estimated);
    Ok(MemberTransformInventory {
        patterns,
        programs,
        work,
        parents: parents.to_vec(),
        domains: domains.to_vec(),
    })
}

#[cfg(test)]
#[path = "member_transform_tests.rs"]
mod tests;
