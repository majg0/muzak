//! Bounded inverse proposals for exact, anchored pitch paths. Geometric links
//! are hypotheses, not recovered voices; an observed vocabulary is not a key.
use crate::{
    composition::{
        CompositionHarmony, PitchAnchor, PitchBinding, PitchLattice, ScoreMaterial,
        harmonic_pitch_anchor, pitch_lattice_degree, resolve_material_pitches,
    },
    error::{CoreResult, budget, invalid},
    model::{MAX_SAFE, Pitch, Score, validate_note_trajectories, validate_score},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum PitchDomainSource {
    Supplied,
    ObservedVocabulary,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PitchRelationDomain {
    pub lattice: PitchLattice,
    pub source: PitchDomainSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
pub struct PitchSuccessor {
    pub from: usize,
    pub to: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct PitchRelationOptions {
    pub max_notes: usize,
    pub max_domains: usize,
    pub max_link_comparisons: usize,
    pub max_links: usize,
    pub max_triple_checks: usize,
    pub max_candidate_checks: usize,
    pub max_candidates: usize,
    pub max_candidate_members: usize,
    pub max_gap_ticks: u64,
    /// A declared small-motion prior, not a universal definition of passing.
    pub max_step_millicents: i64,
    pub excluded_note_indices: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub successors: Option<Vec<PitchSuccessor>>,
}
impl Default for PitchRelationOptions {
    fn default() -> Self {
        Self {
            max_notes: 20_000,
            max_domains: 16,
            max_link_comparisons: 500_000,
            max_links: 40_000,
            max_triple_checks: 100_000,
            max_candidate_checks: 100_000,
            max_candidates: 20_000,
            max_candidate_members: 100_000,
            max_gap_ticks: 0,
            max_step_millicents: 200_000,
            excluded_note_indices: vec![],
            successors: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PitchRelationLink {
    pub from: usize,
    pub to: usize,
    pub evidence: String,
    pub unique: bool,
    /// Unique modulo exact direct-binding/trajectory equivalence, not a voice ID.
    pub unique_value: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum PitchRelationKind {
    Passing,
    UpperNeighbor,
    LowerNeighbor,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PitchRelationCandidate {
    pub note_index: usize,
    pub from_indices: Vec<usize>,
    pub to_indices: Vec<usize>,
    pub kind: PitchRelationKind,
    pub domain_id: String,
    pub binding: PitchBinding,
    pub witness_note_ids: Vec<String>,
    pub exact_match: bool,
    pub unique_successors: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PitchRelationWork {
    pub link_comparisons: usize,
    pub triple_checks: usize,
    pub candidate_checks: usize,
    pub candidate_members: usize,
    pub ambiguous_link_notes: usize,
    pub unsupported_notes: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PitchRelationCosts {
    pub original_bindings_json_bytes: usize,
    pub rewritten_bindings_json_bytes: usize,
    pub original_required_lattices_json_bytes: usize,
    pub rewritten_required_lattices_json_bytes: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PitchRelationAnalysis {
    pub parameters: PitchRelationOptions,
    pub domains: Vec<PitchRelationDomain>,
    pub links: Vec<PitchRelationLink>,
    pub candidates: Vec<PitchRelationCandidate>,
    pub selected_candidate_indices: Vec<usize>,
    pub bindings: Vec<PitchBinding>,
    pub work: PitchRelationWork,
    pub costs: PitchRelationCosts,
    pub limitations: Vec<String>,
}

/// One explicit, lossy domain proposal: sorted observed attack residues. Missing
/// degrees stay missing. This neither detects a tonic nor completes a scale.
pub fn propose_observed_pitch_domain(
    score: &Score,
    id: &str,
    period_millicents: i64,
    origin_millicents: i64,
    max_classes: usize,
) -> CoreResult<Option<PitchRelationDomain>> {
    validate_score(score)?;
    if id.is_empty()
        || period_millicents <= 0
        || period_millicents as u64 > MAX_SAFE
        || origin_millicents.unsigned_abs() > MAX_SAFE
        || max_classes == 0
        || max_classes > 4096
    {
        return Err(invalid("Invalid observed pitch-domain parameters."));
    }
    let percussion: HashSet<_> = score
        .parts
        .iter()
        .filter(|p| p.percussion)
        .map(|p| p.id.as_str())
        .collect();
    let mut residues = BTreeSet::new();
    for note in &score.notes {
        if note.duration == 0 || percussion.contains(note.part.as_str()) {
            continue;
        }
        let residue = (i128::from(note.pitch.millicents) - i128::from(origin_millicents))
            .rem_euclid(i128::from(period_millicents)) as i64;
        residues.insert(residue);
        if residues.len() > max_classes {
            return Err(budget("Observed pitch-domain class budget exceeded."));
        }
    }
    let Some(&first) = residues.first() else {
        return Ok(None);
    };
    let origin = i128::from(origin_millicents) + i128::from(first);
    if origin.unsigned_abs() > u128::from(MAX_SAFE) {
        return Err(invalid(
            "Observed pitch-domain origin exceeds safe coordinates.",
        ));
    }
    Ok(Some(PitchRelationDomain {
        lattice: PitchLattice {
            id: id.into(),
            origin_millicents: origin as i64,
            intervals: residues.into_iter().map(|v| v - first).collect(),
            period_millicents,
        },
        source: PitchDomainSource::ObservedVocabulary,
    }))
}

fn charge(value: &mut usize, maximum: usize, message: &str) -> CoreResult<()> {
    *value = value
        .checked_add(1)
        .filter(|&v| v <= maximum)
        .ok_or_else(|| budget(message))?;
    Ok(())
}
fn admit_indices(values: &[usize], count: usize, description: &str) -> CoreResult<HashSet<usize>> {
    let result: HashSet<_> = values.iter().copied().collect();
    if result.len() != values.len() || result.iter().any(|&i| i >= count) {
        return Err(invalid(format!("Invalid or duplicate {description}.")));
    }
    Ok(result)
}
#[derive(Clone, Copy)]
struct Nearest {
    distance: u128,
    tied: bool,
    class: usize,
    value_tied: bool,
}
fn nearest(slot: &mut Option<Nearest>, distance: u128, class: usize) {
    match slot {
        None => {
            *slot = Some(Nearest {
                distance,
                tied: false,
                class,
                value_tied: false,
            })
        }
        Some(old) if distance < old.distance => {
            *slot = Some(Nearest {
                distance,
                tied: false,
                class,
                value_tied: false,
            })
        }
        Some(old) if distance == old.distance => {
            old.tied = true;
            old.value_tied |= class != old.class;
        }
        _ => (),
    }
}

/// All admitted candidates are retained before conservative selection. Multiple
/// domain hypotheses remain alternatives; a complete result is never truncated.
pub fn infer_pitch_relations(
    material: &ScoreMaterial,
    bindings: &[PitchBinding],
    harmonies: &[CompositionHarmony],
    domains: &[PitchRelationDomain],
    anchor_indices: &[usize],
    options: &PitchRelationOptions,
) -> CoreResult<PitchRelationAnalysis> {
    if options.max_notes == 0
        || options.max_notes > 1_000_000
        || options.max_domains == 0
        || options.max_domains > 256
        || options.max_link_comparisons == 0
        || options.max_link_comparisons > 20_000_000
        || options.max_links == 0
        || options.max_links > 1_000_000
        || options.max_triple_checks == 0
        || options.max_triple_checks > 2_000_000
        || options.max_candidate_checks == 0
        || options.max_candidate_checks > 2_000_000
        || options.max_candidates == 0
        || options.max_candidates > 1_000_000
        || options.max_candidate_members == 0
        || options.max_candidate_members > 4_000_000
        || options.max_gap_ticks > MAX_SAFE
        || options.max_step_millicents <= 0
        || options.max_step_millicents.unsigned_abs() > MAX_SAFE
    {
        return Err(invalid("Invalid pitch-relation options."));
    }
    let n = material.notes.len();
    if n > options.max_notes || domains.len() > options.max_domains {
        return Err(budget(
            "Pitch-relation note/domain admission budget exceeded.",
        ));
    }
    if bindings.len() != n {
        return Err(invalid("Pitch-relation binding count differs from notes."));
    }
    let anchors = admit_indices(anchor_indices, n, "pitch-relation anchors")?;
    let excluded = admit_indices(&options.excluded_note_indices, n, "excluded note indices")?;
    if anchors
        .iter()
        .any(|&i| !matches!(&bindings[i], PitchBinding::Harmony { .. }))
    {
        return Err(invalid(
            "Pitch-relation anchors require direct harmonic bindings.",
        ));
    }
    let lattices: Vec<_> = domains.iter().map(|d| d.lattice.clone()).collect();
    let mut domain_ids = HashSet::new();
    for lattice in &lattices {
        if lattice.intervals.len() > 4096 || !domain_ids.insert(lattice.id.as_str()) {
            return Err(invalid("Invalid or duplicate pitch-relation domain."));
        }
        pitch_lattice_degree(lattice.origin_millicents, lattice)?;
    }
    let mut ids = HashSet::new();
    for note in &material.notes {
        if note.id.is_empty()
            || !ids.insert(note.id.as_str())
            || note.onset > MAX_SAFE
            || note.duration > MAX_SAFE
            || note
                .onset
                .checked_add(note.duration)
                .is_none_or(|v| v > MAX_SAFE)
        {
            return Err(invalid("Invalid pitch-relation note identity/time."));
        }
        validate_note_trajectories(note)?;
    }
    let pitches = resolve_material_pitches(&material.notes, bindings, harmonies, &lattices)?;
    // Equality of present pitch is insufficient: equal-valued independent
    // palettes can diverge under edits. Canonicalize only direct expressions.
    let value_anchors: Vec<_> = material
        .notes
        .iter()
        .zip(bindings)
        .map(|(note, binding)| harmonic_pitch_anchor(note.pitch.millicents, binding).ok())
        .collect();
    let mut class_keys = BTreeMap::new();
    let mut classes = Vec::with_capacity(n);
    for (i, note) in material.notes.iter().enumerate() {
        let expression = match (&bindings[i], &value_anchors[i]) {
            (PitchBinding::Literal { .. }, _) => serde_json::to_string(&("literal", pitches[i]))?,
            (PitchBinding::Harmony { .. }, Some(anchor)) => serde_json::to_string(anchor)?,
            // Existing paths and unrepresentable value anchors stay distinct.
            _ => format!("unquotiented-event-{i}"),
        };
        let curve = note.pitch_envelope.as_ref().map(|points| {
            points
                .iter()
                .map(|point| {
                    (
                        point.tick,
                        i128::from(point.pitch.millicents) - i128::from(note.pitch.millicents),
                    )
                })
                .collect::<Vec<_>>()
        });
        let key = serde_json::to_string(&(
            note.onset,
            note.duration,
            curve,
            &note.gain_envelope,
            expression,
        ))?;
        let next = class_keys.len();
        classes.push(*class_keys.entry(key).or_insert(next));
    }
    let eligible: Vec<_> = material
        .notes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            n.duration > 0
                && !excluded.contains(&i)
                && n.pitch_envelope
                    .iter()
                    .flatten()
                    .all(|p| p.pitch == n.pitch)
        })
        .collect();
    let connected = |a: usize, b: usize| {
        let (a, b) = (&material.notes[a], &material.notes[b]);
        a.onset < b.onset
            && a.onset + a.duration <= b.onset
            && b.onset - (a.onset + a.duration) <= options.max_gap_ticks
    };
    let mut work = PitchRelationWork {
        unsupported_notes: eligible.iter().filter(|&&v| !v).count(),
        ..Default::default()
    };
    let mut links = vec![];
    let mut ambiguous = HashSet::new();
    if let Some(edges) = &options.successors {
        if edges.len() > options.max_link_comparisons {
            return Err(budget("Pitch-relation supplied-link budget exceeded."));
        }
        let mut seen = HashSet::new();
        for edge in edges {
            charge(
                &mut work.link_comparisons,
                options.max_link_comparisons,
                "Pitch-relation link budget exceeded.",
            )?;
            if edge.from >= n
                || edge.to >= n
                || !seen.insert((edge.from, edge.to))
                || !connected(edge.from, edge.to)
            {
                return Err(invalid(
                    "Invalid, overlapping or duplicate supplied successor.",
                ));
            }
            if eligible[edge.from] && eligible[edge.to] {
                if links.len() >= options.max_links {
                    return Err(budget("Pitch-relation link storage budget exceeded."));
                }
                links.push(PitchRelationLink {
                    from: edge.from,
                    to: edge.to,
                    evidence: "supplied".into(),
                    unique: true,
                    unique_value: true,
                });
            }
        }
    } else {
        let mut groups: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
        for (i, note) in material.notes.iter().enumerate() {
            // Unsupported observations remain onset barriers and attack-pitch
            // competitors. Only an explicit scope exclusion removes evidence.
            if !excluded.contains(&i) {
                groups.entry(note.onset).or_default().push(i);
            }
        }
        let groups: Vec<_> = groups.into_values().collect();
        for pair in groups.windows(2) {
            let (left, right) = (&pair[0], &pair[1]);
            let mut successors = vec![None; left.len()];
            let mut predecessors = vec![None; right.len()];
            for (a, &i) in left.iter().enumerate() {
                for (b, &j) in right.iter().enumerate() {
                    charge(
                        &mut work.link_comparisons,
                        options.max_link_comparisons,
                        "Pitch-relation link budget exceeded.",
                    )?;
                    if !connected(i, j) {
                        continue;
                    }
                    let distance = (i128::from(pitches[i]) - i128::from(pitches[j])).unsigned_abs();
                    nearest(&mut successors[a], distance, classes[j]);
                    nearest(&mut predecessors[b], distance, classes[i]);
                }
            }
            for (a, &i) in left.iter().enumerate() {
                if successors[a].is_some_and(|v| v.tied) {
                    ambiguous.insert(i);
                }
                for (b, &j) in right.iter().enumerate() {
                    charge(
                        &mut work.link_comparisons,
                        options.max_link_comparisons,
                        "Pitch-relation link budget exceeded.",
                    )?;
                    if predecessors[b].is_some_and(|v| v.tied) {
                        ambiguous.insert(j);
                    }
                    let (Some(next), Some(previous)) = (successors[a], predecessors[b]) else {
                        continue;
                    };
                    if !connected(i, j) {
                        continue;
                    }
                    let distance = (i128::from(pitches[i]) - i128::from(pitches[j])).unsigned_abs();
                    if eligible[i]
                        && eligible[j]
                        && distance == next.distance
                        && distance == previous.distance
                    {
                        if links.len() >= options.max_links {
                            return Err(budget("Pitch-relation link storage budget exceeded."));
                        }
                        links.push(PitchRelationLink {
                            from: i,
                            to: j,
                            evidence: "geometric-reciprocal-nearest".into(),
                            unique: !next.tied && !previous.tied,
                            unique_value: !next.value_tied && !previous.value_tied,
                        });
                    }
                }
            }
        }
    }
    links.sort_by_key(|e| (e.from, e.to));
    let mut incoming = vec![vec![]; n];
    let mut outgoing = vec![vec![]; n];
    for (i, edge) in links.iter().enumerate() {
        incoming[edge.to].push(i);
        outgoing[edge.from].push(i);
    }
    let incoming_unique: Vec<_> = incoming
        .iter()
        .map(|edges| {
            edges.first().is_none_or(|&first| {
                edges
                    .iter()
                    .all(|&i| classes[links[i].from] == classes[links[first].from])
            })
        })
        .collect();
    let outgoing_unique: Vec<_> = outgoing
        .iter()
        .map(|edges| {
            edges.first().is_none_or(|&first| {
                edges
                    .iter()
                    .all(|&i| classes[links[i].to] == classes[links[first].to])
            })
        })
        .collect();
    for edge in &mut links {
        edge.unique &= incoming[edge.to].len() == 1 && outgoing[edge.from].len() == 1;
        edge.unique_value &= incoming_unique[edge.to] && outgoing_unique[edge.from];
    }
    ambiguous.extend((0..n).filter(|&i| incoming[i].len() > 1 || outgoing[i].len() > 1));
    work.ambiguous_link_notes = ambiguous.len();
    let mut candidates = vec![];
    for middle in 0..n {
        if anchors.contains(&middle) || matches!(bindings[middle], PitchBinding::LatticePath { .. })
        {
            continue;
        }
        let mut left_classes: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        let mut right_classes: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for &i in &incoming[middle] {
            left_classes
                .entry(classes[links[i].from])
                .or_default()
                .push(i);
        }
        for &i in &outgoing[middle] {
            right_classes
                .entry(classes[links[i].to])
                .or_default()
                .push(i);
        }
        // Prepare witness classes once; a large class must not be recopied for
        // every opposing class before candidate storage/work bounds apply.
        let prepare = |groups: &BTreeMap<usize, Vec<usize>>, left: bool| {
            groups
                .values()
                .map(|group| {
                    let indices: Vec<_> = group
                        .iter()
                        .map(|&i| if left { links[i].from } else { links[i].to })
                        .filter(|i| anchors.contains(i))
                        .collect();
                    let anchor = indices.first().map(|&i| {
                        if indices.len() == 1 {
                            PitchAnchor::Event { index: i }
                        } else {
                            value_anchors[i]
                                .clone()
                                .expect("Equivalent harmonic class has a value anchor")
                        }
                    });
                    let unique = indices.len() == group.len()
                        && group.iter().all(|&i| links[i].unique_value);
                    (indices, anchor, unique)
                })
                .collect::<Vec<_>>()
        };
        let left_groups = prepare(&left_classes, true);
        let right_groups = prepare(&right_classes, false);
        for (from_indices, from_anchor, left_unique) in &left_groups {
            for (to_indices, to_anchor, right_unique) in &right_groups {
                charge(
                    &mut work.triple_checks,
                    options.max_triple_checks,
                    "Pitch-relation triple budget exceeded.",
                )?;
                let (Some(from_anchor), Some(to_anchor)) = (from_anchor, to_anchor) else {
                    continue;
                };
                let (from, to) = (from_indices[0], to_indices[0]);
                let unique_successors = *left_unique && *right_unique;
                // Admitted anchors are direct harmonic bindings, but their
                // palettes may differ. Context changes do not erase exact
                // geometric succession or the shared-domain pitch path.
                for domain in domains {
                    charge(
                        &mut work.candidate_checks,
                        options.max_candidate_checks,
                        "Pitch-relation candidate-check budget exceeded.",
                    )?;
                    let Some(a) = pitch_lattice_degree(pitches[from], &domain.lattice)? else {
                        continue;
                    };
                    let Some(m) = pitch_lattice_degree(pitches[middle], &domain.lattice)? else {
                        continue;
                    };
                    let Some(b) = pitch_lattice_degree(pitches[to], &domain.lattice)? else {
                        continue;
                    };
                    let before = i128::from(m) - i128::from(a);
                    let after = i128::from(b) - i128::from(m);
                    if (i128::from(pitches[middle]) - i128::from(pitches[from])).unsigned_abs()
                        > options.max_step_millicents as u128
                        || (i128::from(pitches[to]) - i128::from(pitches[middle])).unsigned_abs()
                            > options.max_step_millicents as u128
                    {
                        continue;
                    }
                    let (kind, offset) = if before.abs() == 1 && before == after {
                        (PitchRelationKind::Passing, 0)
                    } else if a == b && before == 1 {
                        (PitchRelationKind::UpperNeighbor, 1)
                    } else if a == b && before == -1 {
                        (PitchRelationKind::LowerNeighbor, -1)
                    } else {
                        continue;
                    };
                    let binding = PitchBinding::LatticePath {
                        lattice: domain.lattice.id.clone(),
                        from: from_anchor.clone(),
                        to: to_anchor.clone(),
                        numerator: 1,
                        denominator: 2,
                        degree_offset: offset,
                        residual_millicents: 0,
                    };
                    // Verify through the compiler on a constant-size subproblem, not a
                    // full-score recompile per proposal. A final joint check follows.
                    let mut probe: Vec<_> = [from, middle, to]
                        .iter()
                        .map(|&i| material.notes[i].clone())
                        .collect();
                    for note in &mut probe {
                        note.pitch = Pitch { millicents: 0 };
                        note.pitch_envelope = None;
                    }
                    let probe_bindings = [
                        PitchBinding::Literal {
                            millicents: pitches[from],
                        },
                        PitchBinding::LatticePath {
                            lattice: domain.lattice.id.clone(),
                            from: PitchAnchor::Event { index: 0 },
                            to: PitchAnchor::Event { index: 2 },
                            numerator: 1,
                            denominator: 2,
                            degree_offset: offset,
                            residual_millicents: 0,
                        },
                        PitchBinding::Literal {
                            millicents: pitches[to],
                        },
                    ];
                    if resolve_material_pitches(
                        &probe,
                        &probe_bindings,
                        &[],
                        std::slice::from_ref(&domain.lattice),
                    )?[1]
                        != pitches[middle]
                    {
                        return Err(invalid(
                            "Pitch-relation candidate failed exact compiler realization.",
                        ));
                    }
                    if candidates.len() >= options.max_candidates {
                        return Err(budget("Pitch-relation candidate storage budget exceeded."));
                    }
                    let members = (from_indices.len() + to_indices.len()) * 2 + 1;
                    work.candidate_members = work
                        .candidate_members
                        .checked_add(members)
                        .filter(|&value| value <= options.max_candidate_members)
                        .ok_or_else(|| {
                            budget("Pitch-relation candidate member budget exceeded.")
                        })?;
                    candidates.push(PitchRelationCandidate {
                        note_index: middle,
                        from_indices: from_indices.clone(),
                        to_indices: to_indices.clone(),
                        kind,
                        domain_id: domain.lattice.id.clone(),
                        binding,
                        witness_note_ids: from_indices
                            .iter()
                            .copied()
                            .chain(std::iter::once(middle))
                            .chain(to_indices.iter().copied())
                            .map(|i| material.notes[i].id.clone())
                            .collect(),
                        exact_match: true,
                        unique_successors,
                    });
                }
            }
        }
    }
    let mut rewritten = bindings.to_vec();
    let mut selected = vec![];
    if domains.len() == 1 {
        let mut by_note: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (i, c) in candidates.iter().enumerate() {
            by_note.entry(c.note_index).or_default().push(i);
        }
        for indices in by_note.values().filter(|v| v.len() == 1) {
            let i = indices[0];
            if candidates[i].unique_successors {
                rewritten[candidates[i].note_index] = candidates[i].binding.clone();
                selected.push(i);
            }
        }
    }
    if resolve_material_pitches(&material.notes, &rewritten, harmonies, &lattices)? != pitches {
        return Err(invalid(
            "Joint pitch-relation rewrite changed observed attacks.",
        ));
    }
    let required_lattice_bytes = |bindings: &[PitchBinding]| -> CoreResult<usize> {
        let used: HashSet<_> = bindings
            .iter()
            .filter_map(|binding| match binding {
                PitchBinding::LatticePath { lattice, .. } => Some(lattice.as_str()),
                _ => None,
            })
            .collect();
        Ok(serde_json::to_vec(
            &lattices
                .iter()
                .filter(|l| used.contains(l.id.as_str()))
                .collect::<Vec<_>>(),
        )?
        .len())
    };
    let costs = PitchRelationCosts {
        original_bindings_json_bytes: serde_json::to_vec(bindings)?.len(),
        rewritten_bindings_json_bytes: serde_json::to_vec(&rewritten)?.len(),
        original_required_lattices_json_bytes: required_lattice_bytes(bindings)?,
        rewritten_required_lattices_json_bytes: required_lattice_bytes(&rewritten)?,
    };
    Ok(PitchRelationAnalysis {parameters:options.clone(),domains:domains.to_vec(),links,candidates,selected_candidate_indices:selected,bindings:rewritten,work,costs,
        limitations:vec![
            "Geometric reciprocal-nearest successors use consecutive observed onset groups within the explicit exclusion scope and declared gap/step bounds; they are not true voice identification. Unsupported observations remain onset barriers and attack-pitch competitors. Unequal direct-binding or trajectory alternatives remain unresolved; routing does not select a voice.".into(),
            "Exact timing, relative native curves and direct pitch-binding expressions define value equivalence, not voice ownership. Duplicate harmonic endpoint classes use shared harmonic value anchors; every endpoint witness and dependent event is retained. Equal current pitches from different palette IDs are not equivalent. Dynamics/routing remain per event.".into(),
            "Only flat-pitch, positive-duration triples with two admitted direct harmonic anchors are admitted. Their palette IDs may differ; each endpoint retains its independent binding, without establishing harmonic function. Middles cannot be anchors: selected rewrites never form relation chains. No domain or multiple domain hypotheses means no automatic rewrite.".into(),
            "Observed vocabulary includes only observed attack residues; it is not inferred key, spelling, or a complete scale. New anchors outside the domain must fail explicitly.".into(),
            "Selection prefers a unique exact zero-residual relation, not byte compression. Original and rewritten binding/shared-lattice array bytes include every required lattice, even preexisting paths; unused domains are excluded. Complete program, source identity and residual costs remain the caller's responsibility.".into(),
        ]})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{PitchEnvelopePoint, ScoreNote, ScorePart};

    fn fixture() -> (
        ScoreMaterial,
        Vec<PitchBinding>,
        Vec<CompositionHarmony>,
        Vec<PitchRelationDomain>,
    ) {
        let material = ScoreMaterial {
            id: "rhythm".into(),
            span: 6,
            notes: (0..3)
                .map(|i| ScoreNote {
                    id: format!("n{i}"),
                    part: "voice".into(),
                    onset: i * 2,
                    duration: 2,
                    pitch: Pitch { millicents: 0 },
                    velocity: 80,
                    release_velocity: 64,
                    pitch_envelope: None,
                    gain_envelope: None,
                    source: None,
                })
                .collect(),
        };
        let bindings = vec![
            PitchBinding::Harmony {
                harmony: "h".into(),
                tone: 1,
                octave: 5,
                residual_millicents: 0,
            },
            PitchBinding::Literal {
                millicents: 6_500_000,
            },
            PitchBinding::Harmony {
                harmony: "h".into(),
                tone: 2,
                octave: 5,
                residual_millicents: 0,
            },
        ];
        let harmonies = vec![CompositionHarmony {
            id: "h".into(),
            root_millicents: 0,
            intervals: vec![0, 400_000, 700_000],
        }];
        let domains = vec![PitchRelationDomain {
            source: PitchDomainSource::Supplied,
            lattice: PitchLattice {
                id: "white".into(),
                origin_millicents: 0,
                period_millicents: 1_200_000,
                intervals: vec![0, 200_000, 400_000, 500_000, 700_000, 900_000, 1_100_000],
            },
        }];
        (material, bindings, harmonies, domains)
    }
    fn infer(
        m: &ScoreMaterial,
        b: &[PitchBinding],
        h: &[CompositionHarmony],
        d: &[PitchRelationDomain],
    ) -> PitchRelationAnalysis {
        infer_pitch_relations(m, b, h, d, &[0, 2], &PitchRelationOptions::default()).unwrap()
    }
    #[test]
    fn passing_rewrite_tracks_changed_anchors_and_reports_growth() {
        let (m, b, mut h, d) = fixture();
        let before = serde_json::to_string(&m).unwrap();
        let found = infer(&m, &b, &h, &d);
        assert_eq!(found.selected_candidate_indices, vec![0]);
        assert_eq!(found.candidates[0].kind, PitchRelationKind::Passing);
        assert_eq!(found.candidates[0].note_index, 1);
        assert!(
            found.costs.rewritten_bindings_json_bytes > found.costs.original_bindings_json_bytes
        );
        h[0].root_millicents = -300_000;
        h[0].intervals = vec![0, 300_000, 700_000];
        assert_eq!(
            resolve_material_pitches(&m.notes, &found.bindings, &h, &[d[0].lattice.clone()])
                .unwrap(),
            vec![6_000_000, 6_200_000, 6_400_000]
        );
        assert_eq!(serde_json::to_string(&m).unwrap(), before);
    }
    #[test]
    fn passing_across_palettes_preserves_observations_and_tracks_independent_edits() {
        let (m, mut b, mut h, d) = fixture();
        let one_palette = infer(&m, &b, &h, &d);
        h.push(CompositionHarmony {
            id: "next".into(),
            root_millicents: 700_000,
            intervals: vec![0, 400_000, 700_000],
        });
        b[2] = PitchBinding::Harmony {
            harmony: "next".into(),
            tone: 0,
            octave: 5,
            residual_millicents: 0,
        };
        let two_palettes = infer(&m, &b, &h, &d);
        assert_eq!(
            two_palettes.selected_candidate_indices,
            one_palette.selected_candidate_indices
        );
        assert_eq!(two_palettes.bindings[1], one_palette.bindings[1]);
        let render = |palettes: &[CompositionHarmony]| {
            resolve_material_pitches(
                &m.notes,
                &two_palettes.bindings,
                palettes,
                &[d[0].lattice.clone()],
            )
        };
        assert_eq!(render(&h).unwrap(), vec![6_400_000, 6_500_000, 6_700_000]);
        h[0].root_millicents = -400_000; // First endpoint E → C, second stays G.
        assert_eq!(render(&h).unwrap(), vec![6_000_000, 6_400_000, 6_700_000]);
        h[1].root_millicents = 400_000; // Independent second endpoint G → E.
        assert_eq!(render(&h).unwrap(), vec![6_000_000, 6_200_000, 6_400_000]);
        h[1].root_millicents = 500_000; // C → F has no integer middle degree.
        let error = render(&h).unwrap_err();
        assert_eq!(error.code, "invalid-input");
        assert!(error.message.contains("exact integer degree"));
    }
    #[test]
    fn neighbor_depends_on_both_return_anchors() {
        let (m, mut b, h, d) = fixture();
        b[2] = b[0].clone();
        let found = infer(&m, &b, &h, &d);
        assert_eq!(found.candidates[0].kind, PitchRelationKind::UpperNeighbor);
        assert!(matches!(
            found.bindings[1],
            PitchBinding::LatticePath {
                from: PitchAnchor::Event { index: 0 },
                to: PitchAnchor::Event { index: 2 },
                degree_offset: 1,
                ..
            }
        ));
    }
    #[test]
    fn competing_domains_and_unknown_domain_keep_original_binding() {
        let (m, b, h, mut d) = fixture();
        let absent = infer(&m, &b, &h, &[]);
        assert!(absent.candidates.is_empty());
        assert_eq!(absent.bindings, b);
        let mut alternate = d[0].clone();
        alternate.lattice.id = "without-A".into();
        alternate.lattice.intervals.retain(|&x| x != 900_000);
        d.push(alternate);
        let found = infer(&m, &b, &h, &d);
        assert_eq!(found.candidates.len(), 2);
        assert!(found.selected_candidate_indices.is_empty());
        assert_eq!(found.bindings, b);
    }
    #[test]
    fn identical_middle_events_retain_multiplicity_without_claiming_voice_identity() {
        let (mut m, mut b, h, d) = fixture();
        let mut duplicate = m.notes[1].clone();
        duplicate.id = "other".into();
        m.notes.push(duplicate);
        b.push(b[1].clone());
        let found = infer(&m, &b, &h, &d);
        assert_eq!(found.candidates.len(), 2);
        assert!(found.candidates.iter().all(|c| c.unique_successors));
        assert_eq!(found.selected_candidate_indices.len(), 2);
        assert!(found.links.iter().all(|l| !l.unique && l.unique_value));
        assert!(found.work.ambiguous_link_notes > 0);
        assert_eq!(
            resolve_material_pitches(&m.notes, &found.bindings, &h, &[d[0].lattice.clone()])
                .unwrap(),
            resolve_material_pitches(&m.notes, &b, &h, &[d[0].lattice.clone()]).unwrap()
        );
    }
    #[test]
    fn duplicated_harmonic_values_use_all_witnesses_and_no_event_representative() {
        let (mut m, mut b, mut h, d) = fixture();
        for i in 0..3 {
            let mut copy = m.notes[i].clone();
            copy.id = format!("copy{i}");
            copy.part = "other routing".into();
            copy.velocity = 45;
            m.notes.push(copy);
            b.push(b[i].clone());
        }
        // A nonzero material base is part of the harmonic value, not erased.
        for note in &mut m.notes {
            note.pitch.millicents = 1_200_000;
        }
        let options = PitchRelationOptions {
            max_candidate_members: 18,
            ..Default::default()
        };
        let found = infer_pitch_relations(&m, &b, &h, &d, &[0, 2, 3, 5], &options).unwrap();
        assert_eq!(found.selected_candidate_indices.len(), 2);
        assert_eq!(found.work.candidate_members, 18);
        for candidate in &found.candidates {
            assert_eq!(candidate.from_indices, vec![0, 3]);
            assert_eq!(candidate.to_indices, vec![2, 5]);
            assert_eq!(candidate.witness_note_ids.len(), 5);
            let PitchBinding::LatticePath { from, to, .. } = &candidate.binding else {
                panic!()
            };
            assert!(matches!(
                from,
                PitchAnchor::Harmony {
                    residual_millicents: 1_200_000,
                    ..
                }
            ));
            assert!(matches!(
                to,
                PitchAnchor::Harmony {
                    residual_millicents: 1_200_000,
                    ..
                }
            ));
        }
        h[0].root_millicents = -300_000;
        h[0].intervals = vec![0, 300_000, 700_000];
        assert_eq!(
            resolve_material_pitches(&m.notes, &found.bindings, &h, &[d[0].lattice.clone()])
                .unwrap(),
            vec![
                7_200_000, 7_400_000, 7_600_000, 7_200_000, 7_400_000, 7_600_000
            ]
        );
        assert_eq!(m.notes[3].velocity, 45);
        h[0].root_millicents = 0;
        h[0].intervals = vec![0, 400_000, 700_000];
        assert_eq!(
            infer_pitch_relations(
                &m,
                &b,
                &h,
                &d,
                &[0, 2, 3, 5],
                &PitchRelationOptions {
                    max_candidate_members: 17,
                    ..Default::default()
                }
            )
            .unwrap_err()
            .code,
            "budget-exceeded"
        );
    }
    #[test]
    fn equal_observations_from_independent_palettes_remain_ambiguous() {
        let (mut m, mut b, mut h, d) = fixture();
        let mut independent = h[0].clone();
        independent.id = "independent".into();
        h.push(independent);
        for i in 0..3 {
            let mut copy = m.notes[i].clone();
            copy.id = format!("copy{i}");
            m.notes.push(copy);
            let mut binding = b[i].clone();
            if let PitchBinding::Harmony { harmony, .. } = &mut binding {
                *harmony = "independent".into();
            }
            b.push(binding);
        }
        let found =
            infer_pitch_relations(&m, &b, &h, &d, &[0, 2, 3, 5], &Default::default()).unwrap();
        assert_eq!(found.candidates.len(), 8);
        assert!(found.selected_candidate_indices.is_empty());
        assert_eq!(found.bindings, b);
        assert!(
            found
                .candidates
                .iter()
                .all(|c| c.from_indices.len() == 1 && c.to_indices.len() == 1)
        );
    }
    #[test]
    fn geometric_links_ignore_routing_and_admit_isolated_melody_above_bass() {
        let (mut m, mut b, h, d) = fixture();
        for i in 0..3 {
            let mut bass = m.notes[i].clone();
            bass.id = format!("bass{i}");
            bass.part = format!("track{i}");
            m.notes[i].part = format!("arbitrary{i}");
            m.notes.push(bass);
            b.push(PitchBinding::Literal {
                millicents: 3_600_000 + i as i64 * 200_000,
            });
        }
        let found = infer(&m, &b, &h, &d);
        assert_eq!(found.selected_candidate_indices.len(), 1);
        assert_eq!(found.candidates[0].note_index, 1);
    }
    #[test]
    fn expressive_pitch_inference_and_noncontiguous_motion_abstain() {
        let (mut m, b, h, d) = fixture();
        m.notes[1].pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: Pitch { millicents: 0 },
            },
            PitchEnvelopePoint {
                tick: 1,
                pitch: Pitch { millicents: 1 },
            },
        ]);
        assert!(infer(&m, &b, &h, &d).selected_candidate_indices.is_empty());
        m.notes[1].pitch_envelope = None;
        m.notes[0].duration = 1;
        assert!(infer(&m, &b, &h, &d).selected_candidate_indices.is_empty());
        let allowed = infer_pitch_relations(
            &m,
            &b,
            &h,
            &d,
            &[0, 2],
            &PitchRelationOptions {
                max_gap_ticks: 1,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(allowed.selected_candidate_indices.len(), 1);
    }
    #[test]
    fn unsupported_attacks_remain_barriers_and_unison_competitors() {
        let (mut m, mut b, h, d) = fixture();
        let mut expressive = m.notes[1].clone();
        expressive.id = "expressive".into();
        expressive.onset = 1;
        expressive.duration = 1;
        expressive.pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: Pitch { millicents: 0 },
            },
            PitchEnvelopePoint {
                tick: 1,
                pitch: Pitch {
                    millicents: 100_000,
                },
            },
        ]);
        m.notes.push(expressive);
        b.push(b[1].clone());
        // A held first anchor still ends at the middle attack; gap=0 alone
        // cannot detect that filtering expressive onsets skipped evidence.
        let barrier = infer(&m, &b, &h, &d);
        assert!(barrier.selected_candidate_indices.is_empty());
        assert!(!barrier.links.iter().any(|l| l.from == 0 && l.to == 1));
        m.notes[3].onset = 2;
        m.notes[3].duration = 2;
        let competitor = infer(&m, &b, &h, &d);
        assert_eq!(competitor.candidates.len(), 1);
        assert!(!competitor.candidates[0].unique_successors);
        assert!(competitor.selected_candidate_indices.is_empty());
        // A caller may explicitly declare an observation outside its scope.
        let scoped = infer_pitch_relations(
            &m,
            &b,
            &h,
            &d,
            &[0, 2],
            &PitchRelationOptions {
                excluded_note_indices: vec![3],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(scoped.selected_candidate_indices.len(), 1);
    }
    #[test]
    fn lattice_costs_include_existing_paths_and_exclude_unused_domains() {
        let (m, mut b, h, mut d) = fixture();
        b[1] = PitchBinding::LatticePath {
            lattice: d[0].lattice.id.clone(),
            from: PitchAnchor::Event { index: 0 },
            to: PitchAnchor::Event { index: 2 },
            numerator: 1,
            denominator: 2,
            degree_offset: 0,
            residual_millicents: 0,
        };
        let mut unused = d[0].clone();
        unused.lattice.id = "unused".into();
        d.push(unused);
        let result = infer(&m, &b, &h, &d);
        assert!(result.selected_candidate_indices.is_empty());
        let expected = serde_json::to_vec(&[&d[0].lattice]).unwrap().len();
        assert_eq!(result.costs.original_required_lattices_json_bytes, expected);
        assert_eq!(
            result.costs.rewritten_required_lattices_json_bytes,
            expected
        );
        assert_eq!(
            result.costs.original_bindings_json_bytes,
            serde_json::to_vec(&b).unwrap().len()
        );
    }
    #[test]
    fn budgets_abort_without_partial_results_and_supplied_edges_validate() {
        let (m, b, h, d) = fixture();
        let exhausted = infer_pitch_relations(
            &m,
            &b,
            &h,
            &d,
            &[0, 2],
            &PitchRelationOptions {
                max_link_comparisons: 3,
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(exhausted.code, "budget-exceeded");
        let malformed = infer_pitch_relations(
            &m,
            &b,
            &h,
            &d,
            &[0, 2],
            &PitchRelationOptions {
                successors: Some(vec![PitchSuccessor { from: 2, to: 0 }]),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(malformed.code, "invalid-input");
        let supplied = infer_pitch_relations(
            &m,
            &b,
            &h,
            &d,
            &[0, 2],
            &PitchRelationOptions {
                successors: Some(vec![
                    PitchSuccessor { from: 0, to: 1 },
                    PitchSuccessor { from: 1, to: 2 },
                ]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(supplied.selected_candidate_indices.len(), 1);
        assert!(supplied.links.iter().all(|l| l.evidence == "supplied"));
    }
    #[test]
    fn observed_vocabulary_does_not_invent_missing_degrees_or_a_tonic() {
        let (mut m, b, h, d) = fixture();
        let pitches = resolve_material_pitches(&m.notes, &b, &h, &[d[0].lattice.clone()]).unwrap();
        for (n, p) in m.notes.iter_mut().zip(pitches) {
            n.pitch.millicents = p;
        }
        let score = Score {
            ppq: 2,
            duration: 6,
            midi_format: None,
            parts: vec![ScorePart {
                id: "voice".into(),
                name: "".into(),
                track: 0,
                channel: 0,
                percussion: false,
            }],
            notes: m.notes,
            attachments: vec![],
            track_ends: vec![6],
        };
        let proposal = propose_observed_pitch_domain(&score, "observed", 1_200_000, 0, 256)
            .unwrap()
            .unwrap();
        assert_eq!(proposal.source, PitchDomainSource::ObservedVocabulary);
        assert_eq!(proposal.lattice.origin_millicents, 400_000);
        assert_eq!(proposal.lattice.intervals, vec![0, 100_000, 300_000]);
        assert_eq!(
            pitch_lattice_degree(6_200_000, &proposal.lattice).unwrap(),
            None
        );
        assert_eq!(
            propose_observed_pitch_domain(&score, "observed", 1_200_000, 0, 2)
                .unwrap_err()
                .code,
            "budget-exceeded"
        );
    }
}
