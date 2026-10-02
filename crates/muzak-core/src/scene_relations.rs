//! Whole-score admission and dependency closure for executable pitch relations.
//! The inverse kernel and composition compiler remain the only pitch algorithms.
use crate::{
    composition::{harmonic_pitch_anchor, CompositionHarmony, CompositionPlan, PitchAnchor, PitchBinding, PitchLattice, ScoreMaterial},
    error::{CoreResult, invalid, budget},
    harmony::GlobalHarmonyAnalysis,
    model::Score,
    operations::transpose_note,
    pitch_relations::{infer_pitch_relations, propose_observed_pitch_domain, PitchRelationOptions, PitchRelationKind},
    scene::SceneIdentity,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScenePitchRelation {
    pub id: String,
    pub note_id: String,
    pub from_note_ids: Vec<String>,
    pub to_note_ids: Vec<String>,
    pub lattice: String,
    pub kind: PitchRelationKind,
    pub selected: bool,
    pub evidence: Vec<String>,
}

#[derive(Default)]
pub struct SceneRelationInference {
    pub records: Vec<ScenePitchRelation>,
    pub lattices: Vec<PitchLattice>,
    pub bindings: HashMap<String, PitchBinding>,
    pub groups: Vec<Vec<usize>>,
    pub limitations: Vec<String>,
}

/// Persisted explanatory edges must name the dependency the program executes.
/// Unselected alternatives need not retain an unused domain in the program.
pub fn validate_scene_relations(
    records: &[ScenePitchRelation], plan: &CompositionPlan, identities: &[SceneIdentity],
) -> CoreResult<()> {
    if records.len() > 1000000 { return Err(budget("Scene pitch relation budget exceeded.")); }
    records.iter().try_fold(0usize, |count,r| count.checked_add(r.from_note_ids.len())
        .and_then(|n|n.checked_add(r.to_note_ids.len())).filter(|&n|n <= 10000000))
        .ok_or_else(|| budget("Scene pitch relation witness budget exceeded."))?;
    let by_id: HashMap<_,_> = identities.iter().map(|i|(i.id.as_str(),i.emitted_id.as_str())).collect();
    let definitions: HashMap<_,_> = plan.definitions.iter().flatten().map(|d|(d.id.as_str(),d)).collect();
    let materials: HashMap<_,_> = plan.materials.iter().map(|m|(m.id.as_str(),m)).collect();
    let lattices: HashSet<_> = plan.pitch_lattices.iter().flatten().map(|d|d.id.as_str()).collect();
    let mut owners: HashMap<&str,Vec<(&str,usize)>> = HashMap::new();
    for identity in identities {
        let (prefix,index) = identity.emitted_id.rsplit_once(':')
            .ok_or_else(|| invalid("Invalid scene pitch relation owner."))?;
        owners.entry(prefix).or_default().push((&identity.emitted_id,
            index.parse().map_err(|_| invalid("Invalid scene pitch relation event index."))?));
    }
    let mut executable = HashMap::new();
    let mut event_values = HashMap::new();
    for (prefix,events) in owners {
        let (path, material) = prefix.strip_prefix("placement-").and_then(|s|s.split_once(':'))
            .ok_or_else(|| invalid("Invalid scene pitch relation placement."))?;
        if path.len() > 1400 || path.split('.').count() > 64 {
            return Err(budget("Scene pitch relation placement exceeds depth budget."));
        }
        let mut placements = &plan.placements;
        let mut steps = path.split('.').peekable();
        while let Some(step) = steps.next() {
            let index: usize = step.parse().map_err(|_| invalid("Invalid scene pitch relation placement index."))?;
            let placement = placements.get(index).ok_or_else(|| invalid("Unknown scene pitch relation placement."))?;
            if steps.peek().is_some() {
                placements = &definitions.get(placement.material.as_str())
                    .ok_or_else(|| invalid("Unknown scene pitch relation definition."))?.placements;
                continue;
            }
            if placement.material != material { return Err(invalid("Scene pitch relation owner disagrees with its material.")); }
            let material = materials.get(material).ok_or_else(|| invalid("Unknown scene pitch relation material."))?;
            for &(emitted,index) in &events {
                let note = material.notes.get(index).ok_or_else(|| invalid("Unknown scene pitch relation event."))?;
                let binding = placement.pitch_bindings.as_ref().and_then(|b|b.get(index));
                event_values.insert(emitted,(note,binding));
                if let Some(binding @ PitchBinding::LatticePath {..}) = binding {
                    executable.insert(emitted,binding);
                }
            }
        }
    }
    let mut ids = HashSet::new();
    let mut selected_notes = HashSet::new();
    for record in records {
        if record.id.is_empty() || !ids.insert(record.id.as_str()) || record.lattice.is_empty()
            || std::iter::once(&record.note_id).chain(&record.from_note_ids).chain(&record.to_note_ids)
                .any(|id| !by_id.contains_key(id.as_str()))
            || [&record.from_note_ids,&record.to_note_ids].iter().any(|ids| ids.is_empty()
                || ids.iter().collect::<HashSet<_>>().len() != ids.len() || ids.contains(&record.note_id)) {
            return Err(invalid("Invalid scene pitch relation identity or membership."));
        }
        if !record.selected { continue; }
        if !selected_notes.insert(record.note_id.as_str()) || !lattices.contains(record.lattice.as_str()) {
            return Err(invalid("Selected scene pitch relations need unique dependents and an executable lattice."));
        }
        let emitted = by_id[record.note_id.as_str()];
        let (prefix, _) = emitted.rsplit_once(':')
            .ok_or_else(|| invalid("Invalid scene pitch relation owner."))?;
        let event_index = |id: &str| -> CoreResult<usize> {
            let (owner, event) = by_id[id].rsplit_once(':')
                .ok_or_else(|| invalid("Invalid scene pitch relation event."))?;
            if owner != prefix { return Err(invalid("Scene pitch relation anchors must share their executable owner.")); }
            event.parse().map_err(|_| invalid("Invalid scene pitch relation event index."))
        };
        let Some(PitchBinding::LatticePath {lattice,from,to,numerator,denominator,degree_offset,residual_millicents}) = executable.remove(emitted) else {
            return Err(invalid("Scene pitch relation has no executable binding."));
        };
        let expected_offset = match record.kind {
            PitchRelationKind::Passing => 0, PitchRelationKind::UpperNeighbor => 1, PitchRelationKind::LowerNeighbor => -1,
        };
        if lattice != &record.lattice || *numerator != 1 || *denominator != 2 || *degree_offset != expected_offset || *residual_millicents != 0 {
            return Err(invalid("Scene pitch relation disagrees with its executable binding."));
        }
        for (anchor,witnesses) in [(from,&record.from_note_ids),(to,&record.to_note_ids)] {
            for id in witnesses {
                let index = event_index(id)?;
                match anchor {
                    PitchAnchor::Event {index:expected} if witnesses.len() == 1 && index == *expected => {},
                    PitchAnchor::Harmony {..} => {
                        let (note,binding) = event_values[by_id[id.as_str()]];
                        if binding.map(|b|harmonic_pitch_anchor(note.pitch.millicents,b)).transpose()?.as_ref() != Some(anchor) {
                            return Err(invalid("Scene pitch relation witness disagrees with its shared harmonic value."));
                        }
                    },
                    _ => return Err(invalid("Scene pitch relation anchor membership disagrees with its binding.")),
                }
            }
        }
    }
    if !executable.is_empty() { return Err(invalid("Scene is missing executable pitch relationship metadata.")); }
    Ok(())
}

pub fn infer_scene_relations(
    score: &Score,
    harmony: Option<&GlobalHarmonyAnalysis>,
    harmonic_bindings: &HashMap<String, PitchBinding>,
    harmonies: &[CompositionHarmony],
    period: i64,
    max_classes: usize,
    options: &PitchRelationOptions,
) -> CoreResult<SceneRelationInference> {
    let domains: Vec<_> = propose_observed_pitch_domain(score, "observed-vocabulary", period, 0, max_classes)?
        .into_iter().collect();
    let mut unrepresentable = vec![];
    let material = ScoreMaterial {
        id: "observation-projection".into(),
        span: score.duration,
        notes: score.notes.iter().enumerate().map(|(i,note)| {
            transpose_note(note, -note.pitch.millicents).unwrap_or_else(|_| {
                unrepresentable.push(i); note.clone()
            })
        }).collect(),
    };
    let unrepresentable: HashSet<_> = unrepresentable.into_iter().collect();
    let bindings: Vec<_> = score.notes.iter().enumerate().map(|(i,note)| {
        if unrepresentable.contains(&i) { PitchBinding::Literal { millicents: 0 } }
        else { harmonic_bindings.get(&note.id).cloned()
            .unwrap_or(PitchBinding::Literal { millicents: note.pitch.millicents }) }
    }).collect();
    let by_id: HashMap<_,_> = score.notes.iter().enumerate().map(|(i,n)|(n.id.as_str(), i)).collect();
    let mut anchors = vec![];
    for window in harmony.into_iter().flat_map(|analysis| &analysis.windows) {
        for id in &window.core_note_ids {
            let i = by_id[id.as_str()];
            let note = &score.notes[i];
            if note.onset >= window.start_tick && note.onset < window.end_tick
                && harmonic_bindings.contains_key(id) && !unrepresentable.contains(&i) { anchors.push(i); }
        }
    }
    anchors.sort_unstable(); anchors.dedup();
    let mut parameters = options.clone();
    let percussion: HashSet<_> = score.parts.iter().filter(|p| p.percussion).map(|p|p.id.as_str()).collect();
    parameters.excluded_note_indices.extend(score.notes.iter().enumerate()
        .filter(|(_,n)| percussion.contains(n.part.as_str())).map(|(i,_)|i));
    parameters.excluded_note_indices.sort_unstable(); parameters.excluded_note_indices.dedup();
    let analysis = infer_pitch_relations(&material, &bindings, harmonies, &domains, &anchors, &parameters)?;
    let selected: HashSet<_> = analysis.selected_candidate_indices.iter().copied().collect();
    let links: HashMap<_,_> = analysis.links.iter().map(|edge|((edge.from,edge.to),edge)).collect();
    let mut result = SceneRelationInference { limitations: analysis.limitations, ..Default::default() };
    let mut parents: Vec<_> = (0..score.notes.len()).collect();
    fn root(parents: &mut [usize], mut i: usize) -> usize {
        while parents[i] != i { parents[i] = parents[parents[i]]; i = parents[i]; } i
    }
    let mut members = HashSet::new();
    for (i,candidate) in analysis.candidates.iter().enumerate() {
        let accepted = selected.contains(&i);
        let mut evidence = vec![
            "Exact zero-residual path through the observed pitch vocabulary; this does not establish key or spelling.".into(),
            "Both endpoints are selected chord-core attacks. Their harmonic contexts may differ and remain hypotheses.".into(),
            if accepted { "Unique admitted relation selected for executable editing, not for smaller serialized size." }
                else { "Alternative retained without replacing the current pitch binding." }.into(),
        ];
        if candidate.from_indices.len() > 1 || candidate.to_indices.len() > 1 {
            evidence.push("Coincident anchor witnesses share the same executable harmonic value. All note events remain independent emissions; this equivalence does not identify a voice.".into());
        }
        for pair in candidate.from_indices.iter().map(|&from|(from,candidate.note_index))
            .chain(candidate.to_indices.iter().map(|&to|(candidate.note_index,to))) {
            if let Some(edge) = links.get(&pair) {
                evidence.push(format!("Successor {} → {}: {}.", score.notes[edge.from].id, score.notes[edge.to].id, edge.evidence));
            }
        }
        result.records.push(ScenePitchRelation {
            id: format!("pitch-relation-{i}"),
            note_id: score.notes[candidate.note_index].id.clone(),
            from_note_ids: candidate.from_indices.iter().map(|&i|score.notes[i].id.clone()).collect(),
            to_note_ids: candidate.to_indices.iter().map(|&i|score.notes[i].id.clone()).collect(),
            lattice: candidate.domain_id.clone(),
            kind: candidate.kind,
            selected: accepted,
            evidence,
        });
        if accepted {
            result.bindings.insert(score.notes[candidate.note_index].id.clone(), candidate.binding.clone());
            for index in candidate.from_indices.iter().chain(&candidate.to_indices).copied().chain(std::iter::once(candidate.note_index)) {
                members.insert(index);
                let a = root(&mut parents, candidate.note_index);
                let b = root(&mut parents, index);
                if a != b { parents[b] = a; }
            }
        }
    }
    let mut groups = BTreeMap::<usize,Vec<usize>>::new();
    for index in members { groups.entry(root(&mut parents,index)).or_default().push(index); }
    result.groups = groups.into_values().collect();
    for group in &mut result.groups { group.sort_unstable(); }
    result.groups.sort_by_key(|group| group.iter().map(|&i| score.notes[i].onset).min().unwrap());
    let used: HashSet<_> = result.records.iter().filter(|r|r.selected).map(|r|r.lattice.as_str()).collect();
    result.lattices = domains.into_iter().map(|d|d.lattice).filter(|l|used.contains(l.id.as_str())).collect();
    Ok(result)
}
