//! One executable score codec. Analysis memberships may overlap; emission does not.
//! The composition compiler is the only musical realization algebra.
use crate::{
    composition::*,
    error::{CoreResult, budget, invalid},
    harmonic::{self, HarmonicRegionOptions},
    harmony::{self, GlobalHarmonyAnalysis, HarmonyOptions},
    model::*,
    operations::transpose_note,
    partition::{self, PartitionOptions, WeightedNote},
    pitch_relations::PitchRelationOptions,
    scene_relations::{infer_scene_relations, validate_scene_relations, SceneRelationInference},
    structure::{StructureParameter, StructureRegionInput},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use ts_rs::TS;
pub use crate::scene_relations::ScenePitchRelation;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SceneOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Partial<import('./PitchRelationOptions').PitchRelationOptions>")]
    pub relations: Option<PitchRelationOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pitch_period_millicents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_pitch_classes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(
        optional,
        type = "Partial<Omit<import('./PartitionOptions').PartitionOptions, 'features' | 'noteWeights' | 'content'>> & { features?: Partial<import('./FeatureWeights').FeatureWeights>; noteWeights?: Partial<import('./NoteWeights').NoteWeights>; content?: Partial<import('./ContentProjection').ContentProjection> }"
    )]
    pub partition: Option<PartitionOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub support: Option<HarmonicRegionOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Partial<import('./HarmonyOptions').HarmonyOptions>")]
    pub harmony: Option<HarmonyOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_notes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_region_members: Option<usize>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum SceneKind {
    Part,
    Partition,
    ChordSupport,
    Arpeggio,
    Melody,
    Rhythm,
    Harmony,
    Elaboration,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SceneNode {
    pub id: String,
    pub kind: SceneKind,
    pub label: String,
    pub note_ids: Vec<String>,
    pub parent_ids: Vec<String>,
    pub children: Vec<String>,
    pub evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub material_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub placement_path: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SceneIdentity {
    pub emitted_id: String,
    pub id: String,
    pub order: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<NoteSource>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SceneVelocityResidual {
    pub emitted_id: String,
    pub velocity: u8,
    pub release_velocity: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SceneCosts {
    pub source_note_count: usize,
    pub material_note_count: usize,
    pub material_count: usize,
    pub placement_count: usize,
    pub reused_material_count: usize,
    pub literal_material_count: usize,
    pub identity_record_count: usize,
    pub velocity_residual_count: usize,
    pub program_json_bytes: usize,
    pub identity_json_bytes: usize,
    pub residual_json_bytes: usize,
    pub relational_binding_count: usize,
    pub pitch_binding_json_bytes: usize,
    pub pitch_lattice_json_bytes: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SceneIssue {
    pub stage: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub part: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SceneVerification {
    pub exact_notes: bool,
    pub exact_context: bool,
    pub exact_identities: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MusicalScene {
    pub version: u8,
    pub parameters: SceneOptions,
    pub roots: Vec<String>,
    pub nodes: Vec<SceneNode>,
    pub note_weights: Vec<WeightedNote>,
    pub regions: Vec<StructureRegionInput>,
    pub program: CompositionPlan,
    pub identities: Vec<SceneIdentity>,
    pub velocity_residuals: Vec<SceneVelocityResidual>,
    pub costs: SceneCosts,
    pub issues: Vec<SceneIssue>,
    pub limitations: Vec<String>,
    pub verification: SceneVerification,
    #[serde(default)]
    pub pitch_relations: Vec<ScenePitchRelation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub harmony: Option<GlobalHarmonyAnalysis>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum SceneEditScope {
    Material,
    Occurrence,
}

fn placement(material: String, onset: u64) -> MaterialPlacement {
    MaterialPlacement {
        material,
        onset,
        transpose_millicents: None,
        time_scale: None,
        velocity_scale: None,
        part_map: None,
        pitch_bindings: None,
    }
}
fn node(
    id: String,
    kind: SceneKind,
    label: String,
    note_ids: Vec<String>,
    parents: Vec<String>,
    evidence: Vec<String>,
) -> SceneNode {
    SceneNode {
        id,
        kind,
        label,
        note_ids,
        parent_ids: parents,
        children: vec![],
        evidence,
        material_id: None,
        placement_path: None,
    }
}
fn span(start: u64, end: u64) -> u64 {
    end.saturating_sub(start).max(1)
}
fn parameter(key: &str, value: String, display: String, projection: &str) -> StructureParameter {
    StructureParameter {
        key: key.into(),
        value,
        label: None,
        display_value: Some(display),
        projection: Some(projection.into()),
    }
}
fn kind_name(kind: SceneKind) -> String {
    serde_json::to_value(kind).unwrap().as_str().unwrap().into()
}
fn expression_key(note: &ScoreNote) -> String {
    let pitch = note.pitch_envelope.as_ref().map(|points| {
        points
            .iter()
            .map(|p| {
                (
                    p.tick,
                    i128::from(p.pitch.millicents) - i128::from(note.pitch.millicents),
                )
            })
            .collect::<Vec<_>>()
    });
    serde_json::to_string(&(pitch, &note.gain_envelope)).unwrap()
}
struct Owner {
    node: usize,
    notes: Vec<usize>,
    material: usize,
    path: String,
}
struct Encoder<'a> {
    score: &'a Score,
    by_id: HashMap<&'a str, usize>,
    nodes: Vec<SceneNode>,
    regions: Vec<StructureRegionInput>,
    members: usize,
    max_members: usize,
    materials: Vec<ScoreMaterial>,
    dictionary: HashMap<String, usize>,
    owners: Vec<Owner>,
    owned: HashSet<usize>,
    definitions: Vec<CompositionDefinition>,
    pitch_bindings: HashMap<String, PitchBinding>,
}
impl Encoder<'_> {
    fn add_node(
        &mut self,
        value: SceneNode,
        parameters: Vec<StructureParameter>,
    ) -> CoreResult<usize> {
        self.members = self
            .members
            .checked_add(value.note_ids.len())
            .filter(|&n| n <= self.max_members)
            .ok_or_else(|| budget("Scene region-member budget exceeded."))?;
        let index = self.nodes.len();
        self.regions.push(StructureRegionInput {
            id: value.id.clone(),
            label: value.label.clone(),
            kind: kind_name(value.kind),
            note_ids: value.note_ids.clone(),
            parameters,
            parent_ids: Some(value.parent_ids.clone()),
        });
        self.nodes.push(value);
        Ok(index)
    }
    // An owner receives all its explicit events or none. Overlapping alternatives
    // remain analytical nodes; their notes are never emitted a second time.
    fn own(
        &mut self,
        index: usize,
        start: u64,
        end: u64,
        path: String,
    ) -> CoreResult<Option<MaterialPlacement>> {
        let mut notes: Vec<_> = self.nodes[index]
            .note_ids
            .iter()
            .map(|id| {
                self.by_id
                    .get(id.as_str())
                    .copied()
                    .ok_or_else(|| invalid("Scene evidence names a missing note."))
            })
            .collect::<CoreResult<_>>()?;
        if notes.is_empty() || notes.iter().any(|id| self.owned.contains(id)) {
            return Ok(None);
        }
        notes.sort_by(|&a, &b| {
            let (a, b) = (&self.score.notes[a], &self.score.notes[b]);
            a.onset
                .cmp(&b.onset)
                .then(a.duration.cmp(&b.duration))
                .then(expression_key(a).cmp(&expression_key(b)))
                .then(a.pitch.millicents.cmp(&b.pitch.millicents))
                .then(a.velocity.cmp(&b.velocity))
                .then(a.release_velocity.cmp(&b.release_velocity))
        });
        let percussion = self
            .score
            .parts
            .iter()
            .find(|p| p.id == self.score.notes[notes[0]].part)
            .unwrap()
            .percussion;
        let neutral = !percussion
            && notes.iter().all(|&i| {
                std::iter::once(self.score.notes[i].pitch.millicents)
                    .chain(
                        self.score.notes[i]
                            .pitch_envelope
                            .iter()
                            .flatten()
                            .map(|p| p.pitch.millicents),
                    )
                    .all(|p| {
                        (i128::from(p) - i128::from(self.score.notes[i].pitch.millicents))
                            .unsigned_abs()
                            <= u128::from(MAX_SAFE)
                    })
            });
        let mut route_names = BTreeMap::new();
        for &index in &notes {
            let part = &self.score.notes[index].part;
            if !route_names.contains_key(part) {
                route_names.insert(part.clone(), format!("voice-{}", route_names.len()));
            }
        }
        let local_indices: HashMap<_,_> = notes.iter().enumerate().map(|(local,&global)|(global,local)).collect();
        let local: Vec<_> = notes
            .iter()
            .enumerate()
            .map(|(i, &original)| {
                let note = &self.score.notes[original];
                let mut n = transpose_note(note, if neutral { -note.pitch.millicents } else { 0 })?;
                n.id = format!("note-{i}");
                n.part = route_names[&note.part].clone();
                n.source = None;
                n.onset = n
                    .onset
                    .checked_sub(start)
                    .ok_or_else(|| invalid("Owner starts after its note."))?;
                Ok(n)
            })
            .collect::<CoreResult<_>>()?;
        let material_span = if local.iter().all(|n| n.onset == 0 && n.duration == 0) {
            0
        } else {
            span(start, end).max(local.iter().map(|n| n.onset + 1).max().unwrap_or(1))
        };
        let mut key_notes = local.clone();
        for n in &mut key_notes {
            n.velocity = 1;
            n.release_velocity = 0;
        }
        let key = serde_json::to_string(&(percussion, neutral, material_span, key_notes))?;
        let material = if let Some(&material) = self.dictionary.get(&key) {
            material
        } else {
            let material = self.materials.len();
            self.materials.push(ScoreMaterial {
                id: format!("material-{material}"),
                span: material_span,
                notes: local,
            });
            self.dictionary.insert(key, material);
            material
        };
        let mut placed = placement(self.materials[material].id.clone(), start);
        if neutral {
            placed.pitch_bindings = Some(
                notes
                    .iter()
                    .map(|&i| -> CoreResult<_> {
                        let mut binding = self.pitch_bindings
                            .get(&self.score.notes[i].id)
                            .cloned()
                            .unwrap_or(PitchBinding::Literal {
                                millicents: self.score.notes[i].pitch.millicents,
                            });
                        if let PitchBinding::LatticePath { from, to, .. } = &mut binding {
                            for anchor in [from,to] { if let PitchAnchor::Event {index} = anchor {
                                *index = *local_indices.get(index).ok_or_else(|| invalid("Pitch relation anchor is outside its emitting material."))?;
                            }}
                        }
                        Ok(binding)
                    })
                    .collect::<CoreResult<_>>()?,
            );
        }
        placed.part_map = Some(route_names.into_iter().map(|(original, local)|(local,original)).collect());
        self.nodes[index].material_id = Some(self.materials[material].id.clone());
        self.nodes[index].placement_path = Some(path.clone());
        self.regions[index].parameters.push(parameter("material",self.materials[material].id.clone(),self.materials[material].id.clone(),"Local onset/duration and relative native curves form the rhythm material; pitch bindings supply voicing separately. Velocity differences are explicit residuals. Drum keys and unrepresentable relative curves remain literal."));
        self.owned.extend(notes.iter().copied());
        self.owners.push(Owner {
            node: index,
            notes,
            material,
            path,
        });
        Ok(Some(placed))
    }
}

fn harmonic_realization(
    score: &Score,
    analysis: Option<&GlobalHarmonyAnalysis>,
) -> CoreResult<(Vec<CompositionHarmony>, HashMap<String, PitchBinding>)> {
    let mut frames = vec![];
    let mut bindings = HashMap::new();
    let notes: HashMap<_, _> = score.notes.iter().map(|n| (n.id.as_str(), n)).collect();
    for window in analysis.into_iter().flat_map(|a| &a.windows) {
        let Some(hypothesis) = window
            .selected
            .and_then(|index| window.alternatives.get(index))
        else {
            continue;
        };
        let intervals: Vec<_> = hypothesis
            .core_intervals
            .iter()
            .chain(&hypothesis.color_intervals)
            .copied()
            .collect();
        for relation in &window.roles {
            if !matches!(
                relation.role,
                harmony::HarmonyNoteRole::Core | harmony::HarmonyNoteRole::Color
            ) {
                continue;
            }
            let note = notes
                .get(relation.note_id.as_str())
                .ok_or_else(|| invalid("Unknown harmonic member."))?;
            // Sounding memberships can overlap, but each attack chooses one
            // harmonic binding; changing the following chord never retriggers it.
            if note.onset < window.start_tick || note.onset >= window.end_tick {
                continue;
            }
            let Some(tone) = relation
                .interval
                .and_then(|interval| intervals.iter().position(|&x| x == interval))
            else {
                continue;
            };
            let displacement = i128::from(note.pitch.millicents)
                - i128::from(hypothesis.root_millicents)
                - i128::from(intervals[tone]);
            bindings.insert(
                note.id.clone(),
                PitchBinding::Harmony {
                    harmony: window.id.clone(),
                    tone,
                    octave: displacement.div_euclid(1200000) as i64,
                    residual_millicents: displacement.rem_euclid(1200000) as i64,
                },
            );
        }
        frames.push(CompositionHarmony {
            id: window.id.clone(),
            root_millicents: hypothesis.root_millicents,
            intervals,
        });
    }
    Ok((frames, bindings))
}

pub fn encode_score(score: &Score, options: &SceneOptions) -> CoreResult<MusicalScene> {
    validate_score(score)?;
    let max_notes = options.max_notes.unwrap_or(100000);
    let max_members = options.max_region_members.unwrap_or(2000000);
    if max_notes > 1000000
        || max_members > 10000000
        || score.notes.len() > max_notes
        || score.parts.len() > 256
    {
        return Err(budget(
            "Scene source/part/member admission budget exceeded.",
        ));
    }
    let mut issues = vec![];
    let global_harmony =
        match harmony::infer_global_harmony(score, &options.harmony.clone().unwrap_or_default()) {
            Ok(analysis) => Some(analysis),
            Err(error) if error.code == "budget-exceeded" => {
                issues.push(SceneIssue {
                    stage: "global harmony".into(),
                    message: error.message,
                    part: None,
                });
                None
            }
            Err(error) => return Err(error),
        };
    let (harmonies, mut pitch_bindings) = harmonic_realization(score, global_harmony.as_ref())?;
    let relation_options = options.relations.clone().unwrap_or_default();
    let pitch_period = options.pitch_period_millicents.unwrap_or(1_200_000);
    let max_pitch_classes = options.max_pitch_classes.unwrap_or(256);
    let relations = match infer_scene_relations(score, global_harmony.as_ref(), &pitch_bindings,
        &harmonies, pitch_period, max_pitch_classes, &relation_options) {
        Ok(value) => value,
        Err(error) if error.code == "budget-exceeded" => {
            issues.push(SceneIssue { stage: "pitch relations".into(), message: error.message, part: None });
            SceneRelationInference::default()
        }
        Err(error) => return Err(error),
    };
    pitch_bindings.extend(relations.bindings);
    let mut e = Encoder {
        score,
        by_id: score
            .notes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect(),
        nodes: vec![],
        regions: vec![],
        members: 0,
        max_members,
        materials: vec![],
        dictionary: HashMap::new(),
        owners: vec![],
        owned: HashSet::new(),
        definitions: vec![],
        pitch_bindings,
    };
    let mut root_placements = vec![];
    let mut weights = vec![];
    // Dependency closure makes anchors and descendants executable together.
    // This is a compiler locality requirement, independent of spatial boxes.
    for (i, group) in relations.groups.iter().enumerate() {
        let ids: Vec<_> = group.iter().map(|&index|score.notes[index].id.clone()).collect();
        let start = group.iter().map(|&index|score.notes[index].onset).min().unwrap();
        let end = group.iter().map(|&index| { let n=&score.notes[index]; n.onset+n.duration }).max().unwrap();
        let count = group.iter().filter(|&&i|matches!(e.pitch_bindings.get(&score.notes[i].id),Some(PitchBinding::LatticePath {..}))).count();
        let id = format!("elaboration-{i}");
        let index = e.add_node(node(id.clone(), SceneKind::Elaboration,
            format!("Anchored pitch paths · {count}"), ids, vec![], vec![
                "Anchors and dependent attacks share one executable material; source routing remains independent.".into(),
                "Changing harmonic anchors recomputes dependent pitches through an explicit observed vocabulary. This is a geometric hypothesis, not a recovered key or voice.".into(),
            ]), vec![])?;
        if let Some(p) = e.own(index, start, end, root_placements.len().to_string())? {
            root_placements.push(p);
        }
    }
    for (part_index, part) in score.parts.iter().enumerate() {
        let part_id = format!("part-{part_index}");
        let ids: Vec<_> = score
            .notes
            .iter()
            .filter(|n| n.part == part.id)
            .map(|n| n.id.clone())
            .collect();
        let root = e.add_node(
            node(
                part_id.clone(),
                SceneKind::Part,
                if part.name.is_empty() {
                    part.id.clone()
                } else {
                    part.name.clone()
                },
                ids.clone(),
                vec![],
                vec!["Source routing is preserved; a MIDI part is not an inferred voice.".into()],
            ),
            vec![parameter(
                "part",
                part.id.clone(),
                part.name.clone(),
                "Source part identity.",
            )],
        )?;
        let mut placements = vec![];
        let root_path = root_placements.len().to_string();
        let terminal: Vec<_> = ids
            .iter()
            .filter(|id| score.notes[e.by_id[id.as_str()]].onset == score.duration)
            .cloned()
            .collect();
        if !terminal.is_empty() {
            let index=e.add_node(node(format!("{part_id}:terminal"),SceneKind::Partition,"Instantaneous terminal events".into(),terminal,vec![part_id.clone()],vec!["Zero-duration attacks at the exact score ending; no silent tick is invented.".into()]),vec![])?;
            if let Some(p) = e.own(
                index,
                score.duration,
                score.duration,
                format!("{root_path}.0"),
            )? {
                placements.push(p);
            }
        }
        let selection = ScoreSelection {
            parts: Some(vec![part.id.clone()]),
            pitch_range: None,
        };
        let harmonic = match harmonic::infer_harmonic_regions(
            score,
            &selection,
            &options.support.clone().unwrap_or_default(),
        ) {
            Ok(h) => Some(h),
            Err(error) => {
                issues.push(SceneIssue {
                    stage: "harmonic support".into(),
                    message: error.message,
                    part: Some(part.id.clone()),
                });
                None
            }
        };
        if let Some(h) = &harmonic {
            if !h.diagnostics.ambiguous_parts.is_empty() {
                issues.push(SceneIssue{stage:"harmonic ambiguity".into(),message:"Tied leading support families remain unresolved; no tied family is forced into support ownership.".into(),part:Some(part.id.clone())});
            }
            let lowered = harmonic::harmonic_structure_regions(h, &format!("{part_id}:"))?;
            for region in lowered {
                let kind = if region.kind == "repeated support cohort" {
                    if h.cohorts
                        .iter()
                        .find(|c| format!("harmonic:{part_id}:{}", c.id) == region.id)
                        .is_some_and(|c| c.attack_offsets_ticks.iter().any(|&x| x > 0))
                    {
                        SceneKind::Arpeggio
                    } else {
                        SceneKind::ChordSupport
                    }
                } else if region.kind == "support-conditioned complement cell" {
                    SceneKind::Melody
                } else {
                    SceneKind::ChordSupport
                };
                let mut parents = region.parent_ids.unwrap_or_default();
                let context = if kind == SceneKind::Melody {
                    let context = parents.join(", ");
                    parents.clear();
                    Some(context)
                } else {
                    None
                };
                if parents.is_empty() {
                    parents.push(part_id.clone());
                }
                let index=e.add_node(node(region.id,kind,region.label,region.note_ids,parents,vec![if kind==SceneKind::Melody{"Support-conditioned complement, not an independently inferred melody or phrase."}else{"Repeated common-release/attack evidence; chord quality is limited to observed intervals."}.into()]),region.parameters)?;
                if let Some(context) = context {
                    e.nodes[index].evidence.push(format!(
                        "Conditioned by {context}; contextual association is not containment."
                    ));
                }
            }
            // Both families compete by observed recurrence, not by semantic kind.
            // This is a bounded encoding policy, not an optimal musical parse.
            let mut candidates: Vec<_> = h.cohorts.iter().filter(|c| c.selected)
                .map(|c| (format!("harmonic:{part_id}:{}", c.id), c.start_tick, c.end_tick,
                    c.repeated_releases.saturating_mul(c.note_ids.len())))
                .chain(h.melody_cells.iter().map(|c| (format!("harmonic:{part_id}:{}", c.id),
                    c.start_tick, c.end_tick, c.rhythm_occurrences.saturating_mul(c.note_ids.len()))))
                .collect();
            candidates.sort_by(|a,b| b.3.cmp(&a.3).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0)));
            for (id, start, end, _) in candidates {
                if let Some(index) = e.nodes.iter().position(|n| n.id == id) {
                    let path = format!("{root_path}.{}", placements.len());
                    if let Some(p) = e.own(index, start, end, path)? { placements.push(p); }
                }
            }
        }
        let partition = partition::infer_weighted_partition(
            score,
            &selection,
            &options.partition.clone().unwrap_or_default(),
            harmonic.as_ref(),
        );
        match partition {
            Ok(p) => {
                weights.extend(p.notes);
                let mut scene_indices = vec![];
                for (i, n) in p.nodes.iter().enumerate() {
                    let parent = p
                        .nodes
                        .iter()
                        .position(|parent| parent.children.contains(&i))
                        .map(|parent| format!("{part_id}:partition-{parent}"))
                        .unwrap_or(part_id.clone());
                    scene_indices.push(e.add_node(node(format!("{part_id}:partition-{i}"),SceneKind::Partition,format!("Weighted group · {} notes",n.note_ids.len()),n.note_ids.clone(),vec![parent],vec![n.split.as_ref().map(|s|format!("{} split at {}; weighted contrast {}. This is a partition, not a phrase label.",s.axis,s.at,s.score)).unwrap_or_else(||n.stop_reason.clone().unwrap_or_default())]),vec![parameter("content",n.content_address.clone(),"Exact projected content".into(),"Declared partition content projection; identity is not musical similarity.")])?);
                }
                // Spatial leaves provide fallback groups only. They do not wrap
                // independent musical owners in artificial executable nesting.
                for (i, n) in p.nodes.iter().enumerate().filter(|(_,n)| n.children.is_empty()) {
                    let remaining: Vec<_> = n.note_ids.iter()
                        .filter(|id| !e.owned.contains(&e.by_id[id.as_str()])).cloned().collect();
                    if remaining.is_empty() { continue; }
                    let index = if remaining.len() == n.note_ids.len() { scene_indices[i] } else {
                        e.add_node(node(format!("{part_id}:literal-{i}"), SceneKind::Partition,
                            "Unclaimed events".into(), remaining.clone(),
                            vec![e.nodes[scene_indices[i]].id.clone()],
                            vec!["Exact remainder of this spatial group.".into()]), vec![])?
                    };
                    let start = remaining.iter().map(|id| score.notes[e.by_id[id.as_str()]].onset).min().unwrap();
                    let end = remaining.iter().map(|id| {
                        let note = &score.notes[e.by_id[id.as_str()]]; note.onset + note.duration
                    }).max().unwrap();
                    if let Some(p) = e.own(index, start, end, format!("{root_path}.{}", placements.len()))? {
                        placements.push(p);
                    }
                }
            }
            Err(error) => {
                issues.push(SceneIssue {
                    stage: "weighted partition".into(),
                    message: error.message,
                    part: Some(part.id.clone()),
                });
                let remaining: Vec<_> = ids
                    .iter()
                    .filter(|id| !e.owned.contains(&e.by_id[id.as_str()]))
                    .cloned()
                    .collect();
                if !remaining.is_empty() {
                    let index = e.add_node(
                        node(
                            format!("{part_id}:literal"),
                            SceneKind::Partition,
                            "Literal events · partition unavailable".into(),
                            remaining,
                            vec![part_id.clone()],
                            vec![
                                "Budget/unsupported inference does not remove source notes.".into(),
                            ],
                        ),
                        vec![],
                    )?;
                    if let Some(p) = e.own(
                        index,
                        0,
                        score.duration,
                        format!("{root_path}.{}", placements.len()),
                    )? {
                        placements.push(p);
                    }
                }
            }
        }
        if !placements.is_empty() {
            e.definitions.push(CompositionDefinition {
                id: format!("program-{part_id}"),
                span: score.duration.max(1),
                placements,
            });
            root_placements.push(placement(format!("program-{part_id}"), 0));
        }
        let _ = root;
    }
    if e.owned.len() != score.notes.len() {
        return Err(invalid("Scene failed exclusive note ownership."));
    }
    let mut identities = vec![];
    let mut residuals = vec![];
    let mut usage = vec![0usize; e.materials.len()];
    for owner in &e.owners {
        usage[owner.material] += 1;
        let material = &e.materials[owner.material];
        for (index, &source_index) in owner.notes.iter().enumerate() {
            let original = &score.notes[source_index];
            let emitted_id = format!("placement-{}:{}:{index}", owner.path, material.id);
            identities.push(SceneIdentity {
                emitted_id: emitted_id.clone(),
                id: original.id.clone(),
                order: source_index,
                source: original.source.clone(),
            });
            let prototype = &material.notes[index];
            if prototype.velocity != original.velocity
                || prototype.release_velocity != original.release_velocity
            {
                residuals.push(SceneVelocityResidual {
                    emitted_id,
                    velocity: original.velocity,
                    release_velocity: original.release_velocity,
                });
            }
        }
    }
    for (material, count) in usage.iter().enumerate().filter(|(_, count)| **count > 1) {
        let owners: Vec<_> = e
            .owners
            .iter()
            .filter(|o| o.material == material)
            .map(|o| o.node)
            .collect();
        let mut ids: Vec<_> = owners
            .iter()
            .flat_map(|&i| e.nodes[i].note_ids.clone())
            .collect();
        ids.sort();
        ids.dedup();
        let id = format!("reuse-{material}");
        let index=e.add_node(node(id.clone(),SceneKind::Rhythm,format!("Shared rhythm · {count} placements"),ids,vec![],vec!["Rhythm and relative expressive shape recur with independent pitch bindings; thematic function is not established.".into(),"Occurrence boundaries come from support/cohort evidence or weighted partition leaves.".into()]),vec![parameter("material",e.materials[material].id.clone(),e.materials[material].id.clone(),"Executable dictionary identity, with velocity residuals separate.")])?;
        e.nodes[index].material_id = Some(e.materials[material].id.clone());
        e.nodes[index].children = owners.iter().map(|&i| e.nodes[i].id.clone()).collect();
        for i in owners {
            e.nodes[i].parent_ids.push(id.clone());
            e.regions[i].parent_ids = Some(e.nodes[i].parent_ids.clone());
        }
    }
    if let Some(analysis) = &global_harmony {
        for window in &analysis.windows {
            e.add_node(node(window.id.clone(),SceneKind::Harmony,window.label.clone(),window.note_ids.clone(),vec![],vec![
                "Global sounding-note hypothesis across instruments; note attacks and durations are preserved separately.".into(),
                "Core and permitted color are harmonic relations. Color does not establish passing-tone, suspension or compositional intent.".into(),
                "Only attacks inside this window bind to its executable palette; carried-in notes keep their attack context.".into(),
            ]),vec![parameter("window",format!("{}:{}",window.start_tick,window.end_tick),format!("{} quarters",(window.end_tick-window.start_tick) as f64 / score.ppq as f64),"Quantized candidate boundaries are selected jointly; source note timing is never snapped.")])?;
        }
    }
    let node_indices: HashMap<_, _> = e
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.clone(), i))
        .collect();
    let links: Vec<_> = e
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.parent_ids.clone()))
        .collect();
    for (child, parents) in links {
        for parent in parents {
            let Some(&index) = node_indices.get(&parent) else {
                return Err(invalid("Scene has an unknown analytical parent."));
            };
            if !e.nodes[index].children.contains(&child) {
                e.nodes[index].children.push(child.clone());
            }
        }
    }
    let roots = e.nodes.iter().filter(|n|n.parent_ids.is_empty()).map(|n|n.id.clone()).collect();
    let program = CompositionPlan {
        harmonies: Some(harmonies),
        pitch_lattices: Some(relations.lattices),
        context: ScoreContext::from(score),
        materials: e.materials,
        definitions: Some(e.definitions),
        placements: root_placements,
    };
    let bindings: Vec<_> = program.placements.iter()
        .chain(program.definitions.iter().flatten().flat_map(|d|&d.placements))
        .flat_map(|p|p.pitch_bindings.iter().flatten()).collect();
    let costs = SceneCosts {
        source_note_count: score.notes.len(),
        material_note_count: program.materials.iter().map(|m| m.notes.len()).sum(),
        material_count: program.materials.len(),
        placement_count: e.owners.len(),
        reused_material_count: usage.iter().filter(|&&n| n > 1).count(),
        literal_material_count: usage.iter().filter(|&&n| n == 1).count(),
        identity_record_count: identities.len(),
        velocity_residual_count: residuals.len(),
        program_json_bytes: serde_json::to_vec(&program)?.len(),
        identity_json_bytes: serde_json::to_vec(&identities)?.len(),
        residual_json_bytes: serde_json::to_vec(&residuals)?.len(),
        relational_binding_count: bindings.iter().filter(|binding|matches!(binding,PitchBinding::LatticePath {..})).count(),
        pitch_binding_json_bytes: serde_json::to_vec(&bindings)?.len(),
        pitch_lattice_json_bytes: serde_json::to_vec(&program.pitch_lattices)?.len(),
    };
    let mut scene=MusicalScene{version:2,pitch_relations:relations.records,harmony:global_harmony,parameters:SceneOptions{relations:Some(relation_options),pitch_period_millicents:Some(pitch_period),max_pitch_classes:Some(max_pitch_classes),partition:Some(options.partition.clone().unwrap_or_default()),support:Some(options.support.clone().unwrap_or_default()),harmony:Some(options.harmony.clone().unwrap_or_default()),max_notes:Some(max_notes),max_region_members:Some(max_members)},roots,nodes:e.nodes,note_weights:weights,regions:e.regions,program,identities,velocity_residuals:residuals,costs,issues,limitations:vec!["Analytical regions overlap. Only dictionary-owner placements emit notes; every note has one owner.".into(),"Support and melody labels are bounded hypotheses. Weighted groups are not established phrases; exact reuse is not proof of thematic function.".into(),"Rhythm materials have neutral attack pitch and relative native curves. Independent pitch bindings use harmonic core/color palettes when selected, or exact literal residuals otherwise. Drum keys remain literal; velocity changes are explicit residuals.".into(),"Literal prototypes, expression knots, identities and opaque MIDI/context events are retained and charged. This is lossless reconstruction, not a claim of compression or recovered compositional intent.".into()],verification:SceneVerification{exact_notes:false,exact_context:false,exact_identities:false}};
    scene.limitations.extend(relations.limitations);
    let decoded = decode_scene(&scene)?;
    if decoded != *score {
        return Err(invalid("Encoded scene failed exact score reconstruction."));
    }
    scene.verification = SceneVerification {
        exact_notes: true,
        exact_context: true,
        exact_identities: true,
    };
    Ok(scene)
}

pub fn change_scene_harmony(
    scene: &MusicalScene,
    window_id: &str,
    root_millicents: i64,
    core_intervals: Option<&[i64]>,
) -> CoreResult<Score> {
    decode_scene(scene)?;
    let window = scene
        .harmony
        .as_ref()
        .and_then(|a| a.windows.iter().find(|w| w.id == window_id))
        .ok_or_else(|| invalid("Unknown scene harmony window."))?;
    let hypothesis = window
        .selected
        .and_then(|i| window.alternatives.get(i))
        .ok_or_else(|| invalid("Ambiguous harmony has no selected executable palette."))?;
    let mut edited = scene.clone();
    let frame = edited
        .program
        .harmonies
        .iter_mut()
        .flatten()
        .find(|h| h.id == window_id)
        .ok_or_else(|| invalid("Missing executable harmonic palette."))?;
    frame.root_millicents = root_millicents;
    if let Some(core) = core_intervals {
        if core.len() != hypothesis.core_intervals.len() {
            return Err(invalid(
                "Changing harmonic cardinality requires explicit reassignment of tone bindings.",
            ));
        }
        let target = frame.intervals.get_mut(..core.len()).ok_or_else(|| {
            invalid("Executable harmonic palette does not contain the selected chord core.")
        })?;
        target.copy_from_slice(core);
    }
    decode_scene(&edited)
}

#[cfg(test)]
mod functional_root_validation_tests {
    use super::*;
    use crate::harmony_context::{HarmonyContextOptions, HarmonyFunctionalRoot, HarmonyResolutionEvidence};
    use serde_json::json;

    #[test]
    fn persisted_functional_root_checks_exact_witnesses_without_replaying_inference() {
        let notes = [55,60,64,55,59,62].iter().enumerate().map(|(i,p)|json!({
            "id":format!("n{i}"),"part":"p","onset":if i<3{0}else{4},"duration":4,
            "pitch":{"millicents":p*100_000},"velocity":80,"releaseVelocity":64
        })).collect::<Vec<_>>();
        let score: Score = serde_json::from_value(json!({
            "ppq":4,"duration":8,"parts":[{"id":"p","name":"","track":0,"channel":0,"percussion":false}],
            "notes":notes,"attachments":[],"trackEnds":[8]
        })).unwrap();
        let mut scene = encode_score(&score, &SceneOptions {
            harmony: Some(HarmonyOptions { boundary_cost: 0.0, weak_boundary_cost: 0.0,
                max_span_steps: 1, context: None, ..Default::default() }), ..Default::default()
        }).unwrap();
        let windows = &mut scene.harmony.as_mut().unwrap().windows;
        assert_eq!(windows.len(), 2);
        assert_eq!((windows[0].start_tick, windows[0].end_tick), (0, 4));
        let selected = windows[0].selected.unwrap();
        windows[0].functional_root = Some(HarmonyFunctionalRoot {
            root_millicents: 700_000, realization_alternative_index: selected,
            evidence: HarmonyResolutionEvidence {
                next_window_index: 1, bass_millicents: 700_000,
                current_bass_tick: 0, next_bass_tick: 4,
                current_bass_note_ids: vec!["n0".into()], next_bass_note_ids: vec!["n3".into()],
                resolution_note_ids: vec!["n3".into(),"n4".into(),"n5".into()],
                observed_resolution_intervals: vec![0,400_000,700_000], resolution_end_tick: 8,
                resolution_alternative_index: None,
            },
        });
        // The stored evidence remains structurally valid even when later model
        // parameters would admit a different evidence horizon. Decode is not inference.
        scene.harmony.as_mut().unwrap().parameters.context = Some(HarmonyContextOptions {
            max_resolution_ticks: Some(1), ..Default::default()
        });
        assert_eq!(decode_scene(&scene).unwrap(), score);
        let original = serde_json::to_value(&scene).unwrap();
        for (suffix, value) in [
            ("rootMillicents", json!(1_200_000)),
            ("realizationAlternativeIndex", json!(selected + 1)),
            ("evidence/nextWindowIndex", json!(0)),
            ("evidence/bassMillicents", json!(0)),
            ("evidence/currentBassTick", json!(4)),
            ("evidence/nextBassTick", json!(8)),
            ("evidence/resolutionEndTick", json!(4)),
            ("evidence/resolutionEndTick", json!(9)),
            ("evidence/currentBassNoteIds", json!(["n3"])),
            ("evidence/nextBassNoteIds", json!(["n0"])),
            ("evidence/resolutionNoteIds", json!(["n0"])),
            ("evidence/resolutionNoteIds", json!(["absent"])),
            ("evidence/nextBassNoteIds", json!(["n3","n3"])),
            ("evidence/currentBassNoteIds", json!([])),
            ("evidence/observedResolutionIntervals", json!([0,1_200_000])),
            ("evidence/observedResolutionIntervals", json!([700_000,0])),
        ] {
            let mut invalid = original.clone();
            *invalid.pointer_mut(&format!("/harmony/windows/0/functionalRoot/{suffix}")).unwrap() = value;
            let invalid: MusicalScene = serde_json::from_value(invalid).unwrap();
            let error = decode_scene(&invalid).expect_err(suffix);
            assert!(error.message.contains("Functional") || error.message.contains("functional"), "{suffix}: {}", error.message);
        }
        let mut implied = original.clone();
        let evidence = implied.pointer_mut("/harmony/windows/0/functionalRoot/evidence").unwrap();
        evidence["resolutionAlternativeIndex"] = json!(scene.harmony.as_ref().unwrap().windows[1].selected.unwrap());
        evidence["observedResolutionIntervals"] = json!([0,700_000]);
        evidence["resolutionNoteIds"] = json!(["n3","n5"]);
        assert_eq!(decode_scene(&serde_json::from_value(implied.clone()).unwrap()).unwrap(), score);
        for (path, value) in [
            ("/harmony/windows/0/functionalRoot/evidence/resolutionAlternativeIndex", json!(999)),
            ("/harmony/windows/1/selected", json!(null)),
            ("/harmony/windows/0/functionalRoot/evidence/resolutionAlternativeIndex", json!(null)),
        ] {
            let mut invalid = implied.clone();
            *invalid.pointer_mut(path).unwrap() = value;
            assert!(decode_scene(&serde_json::from_value(invalid).unwrap()).is_err(), "{path}");
        }
    }
}

pub fn decode_scene(scene: &MusicalScene) -> CoreResult<Score> {
    if scene.version != 2 || scene.identities.len() > 1000000 {
        return Err(invalid("Unsupported scene version or identity budget."));
    }
    validate_scene_graph(scene)?;
    let mut score = compile_composition(
        &scene.program,
        &CompositionLimits {
            max_depth: Some(64),
            max_expanded_notes: Some(1000000),
            max_expanded_placements: Some(2000000),
        },
    )?;
    let mut identities = HashMap::new();
    let mut ids = HashSet::new();
    let mut orders = HashSet::new();
    for identity in &scene.identities {
        if identities
            .insert(identity.emitted_id.as_str(), identity)
            .is_some()
            || !ids.insert(&identity.id)
            || !orders.insert(identity.order)
            || identity.order >= scene.identities.len()
        {
            return Err(invalid("Invalid scene identity ownership."));
        }
    }
    let mut residuals = HashMap::new();
    for residual in &scene.velocity_residuals {
        if residuals
            .insert(residual.emitted_id.as_str(), residual)
            .is_some()
            || !identities.contains_key(residual.emitted_id.as_str())
        {
            return Err(invalid("Invalid scene velocity residual ownership."));
        }
    }
    let mut restored = vec![];
    for mut note in score.notes {
        let identity = identities
            .remove(note.id.as_str())
            .ok_or_else(|| invalid("Scene emitted a note without identity ownership."))?;
        if let Some(residual) = residuals.remove(note.id.as_str()) {
            note.velocity = residual.velocity;
            note.release_velocity = residual.release_velocity;
        }
        note.id = identity.id.clone();
        note.source = identity.source.clone();
        restored.push((identity.order, note));
    }
    if !identities.is_empty() || !residuals.is_empty() {
        return Err(invalid("Unused scene identity or residual records."));
    }
    restored.sort_by_key(|(order, _)| *order);
    score.notes = restored.into_iter().map(|(_, note)| note).collect();
    // Group spans are analytical supports, not new silent-score endings. The
    // context owns original silence; edited sounding tails may extend it.
    let factor = score.ppq / scene.program.context.ppq;
    score.duration = scene
        .program
        .context
        .duration
        .checked_mul(factor)
        .filter(|&x| x <= MAX_SAFE)
        .ok_or_else(|| invalid("Scene context refinement exceeds exact time."))?;
    score.track_ends = scene
        .program
        .context
        .track_ends
        .iter()
        .map(|&end| {
            end.checked_mul(factor)
                .filter(|&x| x <= MAX_SAFE)
                .ok_or_else(|| invalid("Scene context refinement exceeds exact time."))
        })
        .collect::<CoreResult<_>>()?;
    let parts: HashMap<_, _> = score
        .parts
        .iter()
        .map(|p| (p.id.as_str(), p.track))
        .collect();
    for note in &score.notes {
        let end = note.onset + note.duration;
        score.duration = score.duration.max(end);
        let track = parts[note.part.as_str()];
        score.track_ends[track] = score.track_ends[track].max(end);
    }
    validate_score(&score)?;
    Ok(score)
}

fn validate_scene_graph(scene: &MusicalScene) -> CoreResult<()> {
    validate_scene_relations(&scene.pitch_relations, &scene.program, &scene.identities)?;
    if scene.nodes.len() > 100000 || scene.regions.len() != scene.nodes.len() {
        return Err(invalid("Invalid scene analytical graph size."));
    }
    let known: HashSet<_> = scene.identities.iter().map(|i| i.id.as_str()).collect();
    let indices: HashMap<_, _> = scene
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    if indices.len() != scene.nodes.len() {
        return Err(invalid("Scene node IDs must be unique."));
    }
    let edge_count = scene
        .nodes
        .iter()
        .try_fold(0usize, |total, n| {
            total
                .checked_add(n.parent_ids.len())
                .and_then(|x| x.checked_add(n.children.len()))
        })
        .filter(|&n| n <= 2000000)
        .ok_or_else(|| budget("Scene relationship budget exceeded."))?;
    let _ = edge_count;
    let parent_sets: Vec<HashSet<&str>> = scene
        .nodes
        .iter()
        .map(|n| n.parent_ids.iter().map(String::as_str).collect())
        .collect();
    let child_sets: Vec<HashSet<&str>> = scene
        .nodes
        .iter()
        .map(|n| n.children.iter().map(String::as_str).collect())
        .collect();
    let mut emission_sets: HashMap<&str, HashSet<&str>> = HashMap::new();
    for identity in &scene.identities {
        if let Some((prefix, _)) = identity.emitted_id.rsplit_once(':') {
            emission_sets
                .entry(prefix)
                .or_default()
                .insert(identity.id.as_str());
        }
    }
    let membership_sets: Vec<HashSet<&str>> = scene
        .nodes
        .iter()
        .map(|n| n.note_ids.iter().map(String::as_str).collect())
        .collect();
    let mut owners = HashSet::new();
    let mut memberships = 0usize;
    let mut degrees = vec![0usize; scene.nodes.len()];
    for (i, n) in scene.nodes.iter().enumerate() {
        memberships = memberships
            .checked_add(n.note_ids.len())
            .filter(|&v| v <= 10000000)
            .ok_or_else(|| budget("Scene graph member budget exceeded."))?;
        if n.id.is_empty()
            || n.note_ids.iter().collect::<HashSet<_>>().len() != n.note_ids.len()
            || n.note_ids.iter().any(|id| !known.contains(id.as_str()))
        {
            return Err(invalid("Invalid scene note membership."));
        }
        if parent_sets[i].len() != n.parent_ids.len() || child_sets[i].len() != n.children.len() {
            return Err(invalid("Duplicate scene graph relationship."));
        }
        degrees[i] = n.parent_ids.len();
        for parent in &n.parent_ids {
            let parent = indices
                .get(parent.as_str())
                .ok_or_else(|| invalid("Unknown scene parent."))?;
            if !child_sets[*parent].contains(n.id.as_str()) {
                return Err(invalid("Scene parent/child links must agree."));
            }
            if !membership_sets[i].is_subset(&membership_sets[*parent]) {
                return Err(invalid(
                    "Scene child membership must be contained by its parent.",
                ));
            }
        }
        for child in &n.children {
            let child = indices
                .get(child.as_str())
                .ok_or_else(|| invalid("Unknown scene child."))?;
            if !parent_sets[*child].contains(n.id.as_str()) {
                return Err(invalid("Scene child/parent links must agree."));
            }
        }
        if let Some(path) = &n.placement_path {
            let material = n
                .material_id
                .as_ref()
                .ok_or_else(|| invalid("An emitting scene node needs a material."))?;
            let prefix = format!("placement-{path}:{material}");
            if !owners.insert(prefix.clone()) {
                return Err(invalid("Duplicate scene emitting owner."));
            }
            let expected = n.note_ids.iter().map(String::as_str).collect();
            if emission_sets.get(prefix.as_str()) != Some(&expected) {
                return Err(invalid(
                    "Scene owner membership disagrees with emitted identities.",
                ));
            }
        }
        if n.kind == SceneKind::Rhythm {
            let mut union = HashSet::new();
            for child in &n.children {
                let child = &scene.nodes[indices[child.as_str()]];
                if child.material_id != n.material_id || child.placement_path.is_none() {
                    return Err(invalid(
                        "Scene rhythm must reference occurrences of its material.",
                    ));
                }
                union.extend(child.note_ids.iter().map(String::as_str));
            }
            if union != n.note_ids.iter().map(String::as_str).collect() {
                return Err(invalid(
                    "Scene rhythm membership disagrees with its occurrences.",
                ));
            }
        }
    }
    if owners.len() != emission_sets.len()
        || emission_sets.keys().any(|prefix| !owners.contains(*prefix))
    {
        return Err(invalid(
            "Scene emitting owners must cover the program identities exactly.",
        ));
    }
    let mut harmonic_ids = HashSet::new();
    let mut previous_end = 0;
    let windows = scene.harmony.as_ref().map(|analysis| analysis.windows.as_slice()).unwrap_or_default();
    let mut resolution_members = 0usize;
    for (window_index, window) in windows.iter().enumerate() {
        let node = indices
            .get(window.id.as_str())
            .map(|&i| &scene.nodes[i])
            .ok_or_else(|| invalid("Unknown scene harmony node."))?;
        let instantaneous = scene.program.context.duration == 0
            && window.start_tick == 0
            && window.end_tick == 0
            && window.rest
            && window.selected.is_none()
            && scene.harmony.as_ref().is_some_and(|a| a.windows.len() == 1);
        if !harmonic_ids.insert(window.id.as_str())
            || node.kind != SceneKind::Harmony
            || node.note_ids != window.note_ids
            || window.start_tick < previous_end
            || (window.end_tick <= window.start_tick && !instantaneous)
            || window.end_tick > scene.program.context.duration
            || window
                .selected
                .is_some_and(|i| i >= window.alternatives.len())
        {
            return Err(invalid(
                "Scene harmony windows disagree with graph or time bounds.",
            ));
        }
        previous_end = window.end_tick;
        let members: HashSet<_> = window.note_ids.iter().map(String::as_str).collect();
        if let Some(functional) = &window.functional_root {
            let evidence = &functional.evidence;
            let next = windows.get(window_index + 1)
                .ok_or_else(|| invalid("Functional harmony needs an adjacent resolution window."))?;
            if !(0..1_200_000).contains(&functional.root_millicents)
                || evidence.bass_millicents != functional.root_millicents
                || window.selected != Some(functional.realization_alternative_index)
                || evidence.next_window_index != window_index + 1
                || window.rest || next.rest
                || next.start_tick < window.end_tick
                || !(window.start_tick..window.end_tick).contains(&evidence.current_bass_tick)
                || !(next.start_tick..next.end_tick).contains(&evidence.next_bass_tick)
                || evidence.resolution_end_tick <= evidence.next_bass_tick
                || evidence.resolution_end_tick > next.end_tick
            {
                return Err(invalid("Invalid functional harmony root, realization or resolution bounds."));
            }
            for count in [evidence.current_bass_note_ids.len(), evidence.next_bass_note_ids.len(),
                evidence.resolution_note_ids.len(), evidence.observed_resolution_intervals.len()] {
                resolution_members = resolution_members.checked_add(count).filter(|&n| n <= 10_000_000)
                    .ok_or_else(|| budget("Functional harmony witness budget exceeded."))?;
            }
            let next_members: HashSet<_> = next.note_ids.iter().map(String::as_str).collect();
            if let Some(index) = evidence.resolution_alternative_index {
                if next.selected != Some(index) || !next.alternatives.get(index).is_some_and(|h| {
                    h.root_millicents == functional.root_millicents
                        && [0, 400_000, 700_000].iter().all(|p| h.core_intervals.contains(p))
                }) {
                    return Err(invalid("Functional harmony implied tones require the next selected major realization."));
                }
            } else if evidence.observed_resolution_intervals != [0, 400_000, 700_000] {
                return Err(invalid("Functional harmony needs observed resolution tones or an explicit realization dependency."));
            }
            let exact_members = |ids: &[String], allowed: &HashSet<&str>| {
                !ids.is_empty() && ids.len() <= allowed.len()
                    && ids.iter().map(String::as_str).collect::<HashSet<_>>().len() == ids.len()
                    && ids.iter().all(|id| allowed.contains(id.as_str()))
            };
            if !exact_members(&evidence.current_bass_note_ids, &members)
                || !exact_members(&evidence.next_bass_note_ids, &next_members)
                || !exact_members(&evidence.resolution_note_ids, &next_members)
                || evidence.observed_resolution_intervals.is_empty()
                || evidence.observed_resolution_intervals.iter().any(|p| !(0..1_200_000).contains(p))
                || evidence.observed_resolution_intervals.windows(2).any(|p| p[0] >= p[1])
            {
                return Err(invalid("Functional harmony witnesses must belong to their exact windows."));
            }
        }
        let roles: HashSet<_> = window.roles.iter().map(|r| r.note_id.as_str()).collect();
        if roles.len() != window.roles.len() || roles != members {
            return Err(invalid(
                "Scene harmonic roles must cover exact window members.",
            ));
        }
        for (role, ids) in [
            (harmony::HarmonyNoteRole::Core, &window.core_note_ids),
            (harmony::HarmonyNoteRole::Color, &window.color_note_ids),
            (
                harmony::HarmonyNoteRole::Residual,
                &window.residual_note_ids,
            ),
            (
                harmony::HarmonyNoteRole::Unsupported,
                &window.unsupported_note_ids,
            ),
            (
                harmony::HarmonyNoteRole::Percussion,
                &window.percussion_note_ids,
            ),
        ] {
            let expected: HashSet<_> = window
                .roles
                .iter()
                .filter(|r| r.role == role)
                .map(|r| r.note_id.as_str())
                .collect();
            let actual: HashSet<_> = ids.iter().map(String::as_str).collect();
            if actual.len() != ids.len() || actual != expected {
                return Err(invalid("Scene harmonic role memberships disagree."));
            }
        }
    }
    if harmonic_ids.len()
        != scene
            .nodes
            .iter()
            .filter(|n| n.kind == SceneKind::Harmony)
            .count()
    {
        return Err(invalid("Scene harmony nodes need explicit windows."));
    }
    let roots: HashSet<_> = scene.roots.iter().map(String::as_str).collect();
    if roots.len() != scene.roots.len()
        || roots
            != scene
                .nodes
                .iter()
                .filter(|n| n.parent_ids.is_empty())
                .map(|n| n.id.as_str())
                .collect()
    {
        return Err(invalid("Scene roots must match its parentless nodes."));
    }
    let mut ready: Vec<_> = degrees
        .iter()
        .enumerate()
        .filter(|(_, d)| **d == 0)
        .map(|(i, _)| i)
        .collect();
    let mut visited = 0;
    while let Some(i) = ready.pop() {
        visited += 1;
        for child in &scene.nodes[i].children {
            let next = indices[child.as_str()];
            degrees[next] -= 1;
            if degrees[next] == 0 {
                ready.push(next);
            }
        }
    }
    if visited != scene.nodes.len() {
        return Err(invalid("Scene analytical graph contains a cycle."));
    }
    let mut regions = HashSet::new();
    for region in &scene.regions {
        let n = indices
            .get(region.id.as_str())
            .ok_or_else(|| invalid("Unknown scene region."))?;
        let n = &scene.nodes[*n];
        if !regions.insert(region.id.as_str())
            || region.note_ids != n.note_ids
            || region.parent_ids.as_deref().unwrap_or_default() != n.parent_ids
            || region.kind != kind_name(n.kind)
        {
            return Err(invalid(
                "Scene region disagrees with analytical membership or relationships.",
            ));
        }
    }
    let mut weighted = HashSet::new();
    for weight in &scene.note_weights {
        if !known.contains(weight.note_id.as_str())
            || !weighted.insert(weight.note_id.as_str())
            || !weight.weight.is_finite()
            || weight.weight <= 0.0
        {
            return Err(invalid("Invalid scene note weight evidence."));
        }
    }
    Ok(())
}

/// Local occurrence edits and shared dictionary edits use the same compiler.
/// Returns new observations: callers re-encode rather than retain stale analysis.
pub fn transpose_scene(
    scene: &MusicalScene,
    scope: SceneEditScope,
    target: &str,
    millicents: i64,
) -> CoreResult<Score> {
    if millicents.unsigned_abs() > MAX_SAFE {
        return Err(invalid("Invalid scene transposition."));
    }
    let mut edited = scene.clone();
    match scope {
        SceneEditScope::Material => {
            if !edited.program.materials.iter().any(|m|m.id == target) {
                return Err(invalid("Unknown scene material."));
            }
            // A shared material shift is a placement transform. Changing its
            // pitch-domain inputs instead could invalidate an exact relation.
            for placement in edited.program.placements.iter_mut().chain(
                edited.program.definitions.iter_mut().flatten().flat_map(|d|&mut d.placements)
            ).filter(|p|p.material == target) {
                placement.transpose_millicents = Some(placement.transpose_millicents.unwrap_or(0)
                    .checked_add(millicents).filter(|x|x.unsigned_abs() <= MAX_SAFE)
                    .ok_or_else(|| invalid("Scene transposition exceeds exact pitch."))?);
            }
        }
        SceneEditScope::Occurrence => {
            if target.len() > 1400 || target.split('.').count() > 64 {
                return Err(budget("Scene occurrence path exceeds depth budget."));
            }
            let path: Vec<usize> = target
                .split('.')
                .map(|v| {
                    v.parse()
                        .map_err(|_| invalid("Invalid scene occurrence path."))
                })
                .collect::<CoreResult<_>>()?;
            if path.is_empty() {
                return Err(invalid("Invalid scene occurrence path."));
            }
            fn apply(
                placements: &mut [MaterialPlacement],
                definitions: &mut Vec<CompositionDefinition>,
                path: &[usize],
                millicents: i64,
            ) -> CoreResult<()> {
                let p = placements
                    .get_mut(path[0])
                    .ok_or_else(|| invalid("Unknown scene occurrence."))?;
                if path.len() == 1 {
                    p.transpose_millicents = Some(
                        p.transpose_millicents
                            .unwrap_or(0)
                            .checked_add(millicents)
                            .filter(|x| x.unsigned_abs() <= MAX_SAFE)
                            .ok_or_else(|| invalid("Scene transposition exceeds exact pitch."))?,
                    );
                    return Ok(());
                }
                let mut definition = definitions
                    .iter()
                    .find(|d| d.id == p.material)
                    .cloned()
                    .ok_or_else(|| invalid("Scene occurrence path enters a literal material."))?;
                apply(
                    &mut definition.placements,
                    definitions,
                    &path[1..],
                    millicents,
                )?;
                let mut id = format!("scene-edit-{}", definitions.len());
                while definitions.iter().any(|d| d.id == id) {
                    id.push('_');
                }
                definition.id = id.clone();
                definitions.push(definition);
                p.material = id;
                Ok(())
            }
            apply(
                &mut edited.program.placements,
                edited.program.definitions.get_or_insert_with(Vec::new),
                &path,
                millicents,
            )?;
        }
    }
    decode_scene(&edited)
}
