use crate::{
    error::{invalid, CoreResult},
    model::*,
    operations::{map_note_time, note_times},
};
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ScoreMaterial {
    pub id: String,
    pub span: u64,
    pub notes: Vec<ScoreNote>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TimeScale {
    pub numerator: u64,
    pub denominator: u64,
}
/// A harmonic palette is independent of attack times, durations and routing.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompositionHarmony {
    pub id: String,
    pub root_millicents: i64,
    pub intervals: Vec<i64>,
}
/// An ordered periodic pitch domain. Intervals begin at zero and increase
/// strictly within the period; neither the period nor the spacing implies 12TET.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PitchLattice {
    pub id: String,
    pub origin_millicents: i64,
    pub intervals: Vec<i64>,
    pub period_millicents: i64,
}
impl PitchLattice {
    fn validate(&self) -> CoreResult<()> {
        if self.id.is_empty()
            || self.origin_millicents.unsigned_abs() > MAX_SAFE
            || self.period_millicents <= 0
            || self.period_millicents as u64 > MAX_SAFE
            || self.intervals.first() != Some(&0)
            || self
                .intervals
                .iter()
                .any(|&x| x < 0 || x >= self.period_millicents)
            || self.intervals.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(invalid("Invalid ordered periodic pitch lattice."));
        }
        Ok(())
    }

    fn degree(&self, pitch: i64) -> CoreResult<Option<i64>> {
        let delta = i128::from(pitch) - i128::from(self.origin_millicents);
        let period = i128::from(self.period_millicents);
        let interval = delta.rem_euclid(period) as i64;
        let Ok(index) = self.intervals.binary_search(&interval) else {
            return Ok(None);
        };
        safe_pitch_coordinate(
            delta.div_euclid(period) * self.intervals.len() as i128 + index as i128,
        )
        .map(Some)
    }

    fn pitch(&self, degree: i64, residual: i64) -> CoreResult<i64> {
        let size = self.intervals.len() as i128;
        let degree = i128::from(degree);
        safe_pitch_coordinate(
            i128::from(self.origin_millicents)
                + degree.div_euclid(size) * i128::from(self.period_millicents)
                + i128::from(self.intervals[degree.rem_euclid(size) as usize])
                + i128::from(residual),
        )
    }
}

fn safe_pitch_coordinate(value: i128) -> CoreResult<i64> {
    if value.unsigned_abs() > u128::from(MAX_SAFE) {
        Err(invalid("Pitch binding coordinate exceeds safe integers."))
    } else {
        Ok(value as i64)
    }
}

/// Exact domain membership; off-lattice pitches are not rounded or respelled.
pub fn pitch_lattice_degree(pitch: i64, lattice: &PitchLattice) -> CoreResult<Option<i64>> {
    lattice.validate()?;
    safe_pitch_coordinate(i128::from(pitch))?;
    lattice.degree(pitch)
}

pub fn pitch_lattice_pitch(degree: i64, lattice: &PitchLattice, residual: i64) -> CoreResult<i64> {
    lattice.validate()?;
    safe_pitch_coordinate(i128::from(degree))?;
    safe_pitch_coordinate(i128::from(residual))?;
    lattice.pitch(degree, residual)
}
/// A full material-space pitch value, not an evidence-note identity. Event
/// anchors introduce dependencies; direct harmonic anchors are parameter leaves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PitchAnchor {
    Event {
        index: usize,
    },
    Harmony {
        harmony: String,
        tone: usize,
        octave: i64,
        residual_millicents: i64,
    },
}
impl PitchAnchor {
    fn resolve(
        &self,
        pitches: &[i64],
        harmonies: &HashMap<&str, &CompositionHarmony>,
    ) -> CoreResult<i64> {
        match self {
            Self::Event { index } => pitches
                .get(*index)
                .copied()
                .ok_or_else(|| invalid("Unknown material pitch anchor.")),
            Self::Harmony {
                harmony,
                tone,
                octave,
                residual_millicents,
            } => resolve_harmonic_pitch(harmony, *tone, *octave, *residual_millicents, harmonies),
        }
    }
}

fn resolve_harmonic_pitch(
    harmony: &str,
    tone: usize,
    octave: i64,
    residual: i64,
    harmonies: &HashMap<&str, &CompositionHarmony>,
) -> CoreResult<i64> {
    if octave.unsigned_abs() > MAX_SAFE || residual.unsigned_abs() > MAX_SAFE {
        return Err(invalid("Pitch binding coordinates exceed safe integers."));
    }
    let frame = harmonies
        .get(harmony)
        .ok_or_else(|| invalid("Unknown harmonic palette."))?;
    let interval = frame
        .intervals
        .get(tone)
        .ok_or_else(|| invalid("Unknown harmonic palette tone."))?;
    safe_pitch_coordinate(
        i128::from(frame.root_millicents)
            + i128::from(*interval)
            + i128::from(octave) * 1_200_000
            + i128::from(residual),
    )
}

/// Convert an additive harmonic binding into a direct full-pitch anchor.
/// Frame/tone existence is checked when the anchor is resolved with a plan.
pub fn harmonic_pitch_anchor(
    base_millicents: i64,
    binding: &PitchBinding,
) -> CoreResult<PitchAnchor> {
    safe_pitch_coordinate(i128::from(base_millicents))?;
    let PitchBinding::Harmony {
        harmony,
        tone,
        octave,
        residual_millicents,
    } = binding
    else {
        return Err(invalid(
            "A direct harmonic anchor requires a harmonic binding.",
        ));
    };
    safe_pitch_coordinate(i128::from(*octave))?;
    safe_pitch_coordinate(i128::from(*residual_millicents))?;
    Ok(PitchAnchor::Harmony {
        harmony: harmony.clone(),
        tone: *tone,
        octave: *octave,
        residual_millicents: safe_pitch_coordinate(
            i128::from(base_millicents) + i128::from(*residual_millicents),
        )?,
    })
}
/// Additive pitch input to a material event. Neutral-pitch rhythmic materials
/// can reuse the same timing with different literal or chord-relative voicings.
/// Lattice paths instead specify the final material attack, converted to an
/// additive offset by the compiler so its relative native curve is preserved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PitchBinding {
    Literal {
        millicents: i64,
    },
    Harmony {
        harmony: String,
        tone: usize,
        octave: i64,
        residual_millicents: i64,
    },
    LatticePath {
        lattice: String,
        from: PitchAnchor,
        to: PitchAnchor,
        numerator: u64,
        denominator: u64,
        degree_offset: i64,
        residual_millicents: i64,
    },
}
impl PitchBinding {
    fn resolve(&self, harmonies: &HashMap<&str, &CompositionHarmony>) -> CoreResult<BigInt> {
        let value = match self {
            Self::Literal { millicents } => BigInt::from(*millicents),
            Self::Harmony {
                harmony,
                tone,
                octave,
                residual_millicents,
            } => BigInt::from(resolve_harmonic_pitch(
                harmony,
                *tone,
                *octave,
                *residual_millicents,
                harmonies,
            )?),
            Self::LatticePath { .. } => {
                return Err(invalid("A lattice path requires material anchors."))
            }
        };
        if value.to_i64().is_none_or(|x| x.unsigned_abs() > MAX_SAFE) {
            return Err(invalid("Pitch binding exceeds safe integer pitch."));
        }
        Ok(value)
    }
}

fn harmony_index(frames: &[CompositionHarmony]) -> CoreResult<HashMap<&str, &CompositionHarmony>> {
    let mut result = HashMap::new();
    for frame in frames {
        if frame.id.is_empty()
            || frame.intervals.is_empty()
            || frame.root_millicents.unsigned_abs() > MAX_SAFE
            || frame.intervals.iter().any(|x| x.unsigned_abs() > MAX_SAFE)
            || result.insert(frame.id.as_str(), frame).is_some()
        {
            return Err(invalid("Invalid or duplicate harmonic palette."));
        }
    }
    Ok(result)
}

fn lattice_index(lattices: &[PitchLattice]) -> CoreResult<HashMap<&str, &PitchLattice>> {
    let mut result = HashMap::new();
    for lattice in lattices {
        lattice.validate()?;
        if result.insert(lattice.id.as_str(), lattice).is_some() {
            return Err(invalid("Duplicate pitch lattice ID."));
        }
    }
    Ok(result)
}

/// Resolve full material attack pitches, before placement transposition. Only
/// supplied events, palettes and lattices are read; event IDs are not consulted.
/// Graph work/storage is linear in input events and its at-most-two anchor edges
/// per event. There is no recursive traversal or pitch-distance enumeration.
pub fn resolve_material_pitches(
    notes: &[ScoreNote],
    bindings: &[PitchBinding],
    harmonies: &[CompositionHarmony],
    lattices: &[PitchLattice],
) -> CoreResult<Vec<i64>> {
    resolve_material_pitches_indexed(
        notes,
        bindings,
        &harmony_index(harmonies)?,
        &lattice_index(lattices)?,
    )
}

fn resolve_material_pitches_indexed(
    notes: &[ScoreNote],
    bindings: &[PitchBinding],
    harmonies: &HashMap<&str, &CompositionHarmony>,
    lattices: &HashMap<&str, &PitchLattice>,
) -> CoreResult<Vec<i64>> {
    if bindings.len() != notes.len() {
        return Err(invalid("Pitch binding count must match rhythmic events."));
    }
    let mut pending = vec![0usize; notes.len()];
    let mut dependents = vec![Vec::new(); notes.len()];
    for (index, (note, binding)) in notes.iter().zip(bindings).enumerate() {
        safe_pitch_coordinate(i128::from(note.pitch.millicents))?;
        if let PitchBinding::LatticePath {
            lattice,
            from,
            to,
            numerator,
            denominator,
            degree_offset,
            residual_millicents,
        } = binding
        {
            if !lattices.contains_key(lattice.as_str()) {
                return Err(invalid("Unknown pitch lattice."));
            }
            for anchor in [from, to] {
                if let PitchAnchor::Event { index } = anchor {
                    if *index >= notes.len() {
                        return Err(invalid("Unknown material pitch anchor."));
                    }
                }
            }
            if *denominator == 0
                || *denominator > MAX_SAFE
                || numerator > denominator
                || degree_offset.unsigned_abs() > MAX_SAFE
                || residual_millicents.unsigned_abs() > MAX_SAFE
            {
                return Err(invalid("Invalid lattice path coordinate."));
            }
            for anchor in [Some(from), (from != to).then_some(to)]
                .into_iter()
                .flatten()
            {
                if let PitchAnchor::Event { index: parent } = anchor {
                    dependents[*parent].push(index);
                    pending[index] += 1;
                }
            }
        }
    }
    let mut ready: Vec<usize> = pending
        .iter()
        .enumerate()
        .filter_map(|(i, &n)| (n == 0).then_some(i))
        .collect();
    let mut pitches = vec![0i64; notes.len()];
    let mut resolved = 0;
    while let Some(index) = ready.pop() {
        pitches[index] = match &bindings[index] {
            PitchBinding::LatticePath {
                lattice,
                from,
                to,
                numerator,
                denominator,
                degree_offset,
                residual_millicents,
            } => {
                let lattice = lattices[lattice.as_str()];
                let degree = |pitch| {
                    lattice.degree(pitch)?.ok_or_else(|| {
                        invalid("Pitch anchor does not belong exactly to its lattice.")
                    })
                };
                let start = i128::from(degree(from.resolve(&pitches, harmonies)?)?);
                let end = i128::from(degree(to.resolve(&pitches, harmonies)?)?);
                let offset = (end - start) * i128::from(*numerator);
                let denominator = i128::from(*denominator);
                if offset % denominator != 0 {
                    return Err(invalid(
                        "Lattice path requires an exact integer degree; no rounding is applied.",
                    ));
                }
                let target = safe_pitch_coordinate(
                    start + offset / denominator + i128::from(*degree_offset),
                )?;
                lattice.pitch(target, *residual_millicents)?
            }
            binding => {
                let offset = binding.resolve(harmonies)?.to_i64().unwrap();
                safe_pitch_coordinate(
                    i128::from(notes[index].pitch.millicents) + i128::from(offset),
                )?
            }
        };
        resolved += 1;
        for &child in &dependents[index] {
            pending[child] -= 1;
            if pending[child] == 0 {
                ready.push(child);
            }
        }
    }
    if resolved != notes.len() {
        return Err(invalid("Material pitch dependency cycle."));
    }
    Ok(pitches)
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPlacement {
    pub material: String,
    pub onset: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transpose_millicents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub time_scale: Option<TimeScale>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub velocity_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub part_map: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pitch_bindings: Option<Vec<PitchBinding>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CompositionDefinition {
    pub id: String,
    pub span: u64,
    pub placements: Vec<MaterialPlacement>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CompositionPlan {
    pub context: ScoreContext,
    pub materials: Vec<ScoreMaterial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub definitions: Option<Vec<CompositionDefinition>>,
    pub placements: Vec<MaterialPlacement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub harmonies: Option<Vec<CompositionHarmony>>,
    #[serde(
        default,
        rename = "pitchLattices",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional, rename = "pitchLattices")]
    pub pitch_lattices: Option<Vec<PitchLattice>>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompositionLimits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_depth: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_expanded_notes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_expanded_placements: Option<i64>,
}
#[derive(Clone, Copy)]
enum Node<'a> {
    Material(&'a ScoreMaterial),
    Definition(&'a CompositionDefinition),
}
impl Node<'_> {
    fn span(self) -> u64 {
        match self {
            Self::Material(m) => m.span,
            Self::Definition(d) => d.span,
        }
    }
}
#[derive(Clone)]
struct Transform {
    offset: BigRational,
    scale: BigRational,
    pitch: BigInt,
    velocity: f64,
    routing: BTreeMap<String, String>,
}
fn safe(value: &BigInt) -> CoreResult<u64> {
    value
        .to_u64()
        .filter(|&value| value <= MAX_SAFE)
        .ok_or_else(|| invalid("Composition exceeds safe integer musical time."))
}
fn rational(value: u64) -> BigRational {
    BigRational::from_integer(BigInt::from(value))
}
fn gcd(mut a: BigInt, mut b: BigInt) -> BigInt {
    while !b.is_zero() {
        let next = &a % &b;
        a = b;
        b = next;
    }
    a
}

pub fn compile_composition(
    plan: &CompositionPlan,
    limits: &CompositionLimits,
) -> CoreResult<Score> {
    validate_score(&plan.context.score(vec![]))?;
    let harmonies = harmony_index(plan.harmonies.as_deref().unwrap_or_default())?;
    let lattices = lattice_index(plan.pitch_lattices.as_deref().unwrap_or_default())?;
    let [max_depth, max_notes, max_placements] = [
        limits.max_depth.unwrap_or(32),
        limits.max_expanded_notes.unwrap_or(100000),
        limits.max_expanded_placements.unwrap_or(100000),
    ];
    if [max_depth, max_notes, max_placements]
        .iter()
        .any(|&value| value < 0 || value as u64 >= MAX_SAFE)
    {
        return Err(invalid("Invalid composition expansion budget."));
    }
    let (max_depth, max_notes, max_placements) =
        (max_depth as u64, max_notes as u64, max_placements as u64);
    let mut nodes = BTreeMap::<String, Node>::new();
    for material in &plan.materials {
        if nodes
            .insert(material.id.clone(), Node::Material(material))
            .is_some()
        {
            return Err(invalid("Material and definition IDs must be unique."));
        }
    }
    for definition in plan.definitions.iter().flatten() {
        if nodes
            .insert(definition.id.clone(), Node::Definition(definition))
            .is_some()
        {
            return Err(invalid("Material and definition IDs must be unique."));
        }
    }
    for (id, node) in &nodes {
        let instantaneous = matches!(node,Node::Material(m) if m.span==0 && !m.notes.is_empty() && m.notes.iter().all(|n|n.onset==0 && n.duration==0));
        if id.is_empty() || node.span() == 0 && !instantaneous || node.span() > MAX_SAFE {
            return Err(invalid(
                "Material or definition needs a positive integer span.",
            ));
        }
    }
    for material in &plan.materials {
        let mut ids = HashSet::new();
        for note in &material.notes {
            if !ids.insert(&note.id) {
                return Err(invalid("Material note IDs must be unique."));
            }
            if (note.onset >= material.span
                && !(material.span == 0 && note.onset == 0 && note.duration == 0))
                || note.duration > MAX_SAFE
            {
                return Err(invalid(
                    "Material onset must lie within its span; note duration must be nonnegative.",
                ));
            }
            if note.pitch.millicents.unsigned_abs() > MAX_SAFE
                || note.velocity == 0
                || note.velocity > 127
                || note.release_velocity > 127
            {
                return Err(invalid("Invalid material pitch or velocity."));
            }
            validate_note_trajectories(note)?;
        }
    }
    let validate_placement = |p: &MaterialPlacement, span: Option<u64>| -> CoreResult<()> {
        if !nodes.contains_key(&p.material) {
            return Err(invalid(format!(
                "Unknown material or definition: {}",
                p.material
            )));
        }
        let invalid_scale = p.time_scale.as_ref().is_some_and(|s| {
            s.numerator == 0
                || s.denominator == 0
                || s.numerator > MAX_SAFE
                || s.denominator > MAX_SAFE
        });
        let velocity = p.velocity_scale.unwrap_or(1.0);
        if invalid_scale
            || p.onset > MAX_SAFE
            || p.transpose_millicents.unwrap_or(0).unsigned_abs() > MAX_SAFE
            || !velocity.is_finite()
            || velocity <= 0.0
        {
            return Err(invalid("Invalid material placement transform."));
        }
        if span
            .is_some_and(|span| p.onset > span || p.onset == span && nodes[&p.material].span() != 0)
        {
            return Err(invalid(
                "Definition placement onset must lie within its nominal span.",
            ));
        }
        if p.part_map
            .iter()
            .flat_map(|m| m.iter())
            .any(|(from, to)| from.is_empty() || to.is_empty())
        {
            return Err(invalid("Invalid placement part routing."));
        }
        if let Some(bindings) = &p.pitch_bindings {
            let Node::Material(material) = nodes[&p.material] else {
                return Err(invalid(
                    "Pitch bindings belong to material leaves, not definitions.",
                ));
            };
            resolve_material_pitches_indexed(&material.notes, bindings, &harmonies, &lattices)?;
        }
        Ok(())
    };
    for p in &plan.placements {
        validate_placement(p, None)?;
    }
    for d in plan.definitions.iter().flatten() {
        for p in &d.placements {
            validate_placement(p, Some(d.span))?;
        }
    }
    let mut pending = HashMap::new();
    let mut parents = HashMap::<String, HashSet<String>>::new();
    for (id, node) in &nodes {
        let children: HashSet<String> = match node {
            Node::Material(_) => HashSet::new(),
            Node::Definition(d) => d.placements.iter().map(|p| p.material.clone()).collect(),
        };
        pending.insert(id.clone(), children.len());
        for child in children {
            parents.entry(child).or_default().insert(id.clone());
        }
    }
    let mut ready: Vec<_> = nodes
        .keys()
        .filter(|id| pending[*id] == 0)
        .cloned()
        .collect();
    let mut counts = HashMap::<String, (u64, u64, u64)>::new();
    let capped = |a: u64, b: u64, cap: u64| a.saturating_add(b).min(cap + 1);
    while let Some(id) = ready.pop() {
        let node = nodes[&id];
        let (mut depth, mut notes, mut placements) = (0, 0, 1);
        match node {
            Node::Material(m) => notes = (m.notes.len() as u64).min(max_notes + 1),
            Node::Definition(d) => {
                depth = 1;
                for child in &d.placements {
                    let c = counts[&child.material];
                    depth = depth.max(c.0 + 1);
                    notes = capped(notes, c.1, max_notes);
                    placements = capped(placements, c.2, max_placements);
                }
            }
        }
        if depth > max_depth {
            return Err(invalid("Composition definition depth budget exceeded."));
        }
        counts.insert(id.clone(), (depth, notes, placements));
        for parent in parents.get(&id).into_iter().flatten() {
            let remaining = pending.get_mut(parent).unwrap();
            *remaining -= 1;
            if *remaining == 0 {
                ready.push(parent.clone());
            }
        }
    }
    if counts.len() != nodes.len() {
        return Err(invalid("Composition definition cycle."));
    }
    let (mut count_notes, mut count_placements) = (0, 0);
    for p in &plan.placements {
        let c = counts[&p.material];
        count_notes = capped(count_notes, c.1, max_notes);
        count_placements = capped(count_placements, c.2, max_placements);
    }
    if count_notes > max_notes {
        return Err(invalid("Composition expanded note budget exceeded."));
    }
    if count_placements > max_placements {
        return Err(invalid("Composition expanded placement budget exceeded."));
    }
    let identity = Transform {
        offset: BigRational::zero(),
        scale: BigRational::one(),
        pitch: BigInt::zero(),
        velocity: 1.0,
        routing: BTreeMap::new(),
    };
    let mut stack: Vec<_> = plan
        .placements
        .iter()
        .enumerate()
        .map(|(i, p)| (p, identity.clone(), i.to_string()))
        .rev()
        .collect();
    let mut leaves = vec![];
    let (mut factor, mut nominal_end) = (BigInt::one(), rational(plan.context.duration));
    let observe = |value: &BigRational, factor: &mut BigInt| -> CoreResult<()> {
        *factor = &*factor / gcd(factor.clone(), value.denom().clone()) * value.denom();
        safe(&(BigInt::from(plan.context.ppq) * &*factor))?;
        Ok(())
    };
    while let Some((placement, parent, path)) = stack.pop() {
        let node = nodes[&placement.material];
        let scale = placement
            .time_scale
            .as_ref()
            .map_or_else(BigRational::one, |s| {
                BigRational::new(BigInt::from(s.numerator), BigInt::from(s.denominator))
            });
        let mut routing = parent.routing.clone();
        for (from, to) in placement.part_map.iter().flat_map(|map| map.iter()) {
            routing.insert(from.clone(), parent.routing.get(to).unwrap_or(to).clone());
        }
        let transform = Transform {
            offset: &parent.offset + rational(placement.onset) * &parent.scale,
            scale: &parent.scale * scale,
            pitch: &parent.pitch + BigInt::from(placement.transpose_millicents.unwrap_or(0)),
            velocity: parent.velocity * placement.velocity_scale.unwrap_or(1.0),
            routing,
        };
        if !transform.velocity.is_finite() || transform.velocity <= 0.0 {
            return Err(invalid(
                "Composed velocity multiplier exceeds finite numeric range.",
            ));
        }
        let end = &transform.offset + rational(node.span()) * &transform.scale;
        observe(&transform.offset, &mut factor)?;
        observe(&end, &mut factor)?;
        nominal_end = nominal_end.max(end);
        match node {
            Node::Definition(d) => {
                for (i, p) in d.placements.iter().enumerate().rev() {
                    stack.push((p, transform.clone(), format!("{path}.{i}")));
                }
            }
            Node::Material(m) => {
                for note in &m.notes {
                    observe(
                        &(&transform.offset + rational(note.onset) * &transform.scale),
                        &mut factor,
                    )?;
                    for tick in note_times(note).into_iter().skip(1) {
                        observe(&(rational(tick) * &transform.scale), &mut factor)?;
                    }
                }
                leaves.push((m, transform, path, &placement.pitch_bindings));
            }
        }
    }
    let exact = |value: BigRational| -> CoreResult<u64> {
        let n = value.numer() * &factor;
        if &n % value.denom() != BigInt::zero() {
            return Err(invalid("Composition time scaling lost exactness."));
        }
        safe(&(n / value.denom()))
    };
    let mut result = plan.context.score(vec![]);
    result.ppq = safe(&(BigInt::from(result.ppq) * &factor))?;
    result.duration = exact(nominal_end)?;
    result.track_ends = result
        .track_ends
        .iter()
        .map(|&tick| safe(&(BigInt::from(tick) * &factor)))
        .collect::<CoreResult<_>>()?;
    for event in &mut result.attachments {
        event.tick = safe(&(BigInt::from(event.tick) * &factor))?;
    }
    for (material, transform, path, bindings) in leaves {
        let pitches = bindings
            .as_ref()
            .map(|bindings| {
                resolve_material_pitches_indexed(&material.notes, bindings, &harmonies, &lattices)
            })
            .transpose()?;
        for (index, note) in material.notes.iter().enumerate() {
            let binding = pitches.as_ref().map_or_else(BigInt::zero, |pitches| {
                BigInt::from(pitches[index]) - BigInt::from(note.pitch.millicents)
            });
            let mut original = note.clone();
            original.onset = 0;
            let mut output =
                map_note_time(&original, |tick| exact(rational(tick) * &transform.scale))?;
            let pitch = |value: i64| -> CoreResult<i64> {
                let value = BigInt::from(value) + &transform.pitch + &binding;
                value
                    .to_i64()
                    .filter(|value| value.unsigned_abs() <= MAX_SAFE)
                    .ok_or_else(|| invalid("Composition exceeds safe integer pitch."))
            };
            output.pitch.millicents = pitch(output.pitch.millicents)?;
            for point in output.pitch_envelope.iter_mut().flatten() {
                point.pitch.millicents = pitch(point.pitch.millicents)?;
            }
            output.id = format!("placement-{path}:{}:{index}", material.id);
            output.source = None;
            output.part = transform
                .routing
                .get(&note.part)
                .unwrap_or(&note.part)
                .clone();
            output.onset = exact(&transform.offset + rational(note.onset) * &transform.scale)?;
            output.velocity = (f64::from(note.velocity) * transform.velocity + 0.5)
                .floor()
                .clamp(1.0, 127.0) as u8;
            result.notes.push(output);
        }
    }
    let parts: HashMap<_, _> = result
        .parts
        .iter()
        .map(|p| (p.id.clone(), p.track))
        .collect();
    for note in &result.notes {
        let track = *parts
            .get(&note.part)
            .ok_or_else(|| invalid(format!("Unknown composed part: {}", note.part)))?;
        let end = safe(&(BigInt::from(note.onset) + BigInt::from(note.duration)))?;
        result.duration = result.duration.max(end);
        result.track_ends[track] = result.track_ends[track].max(end);
    }
    if let Some(ending) = result.track_ends.first_mut() {
        *ending = (*ending).max(result.duration);
    }
    result.notes.sort_by(|a, b| {
        a.onset
            .cmp(&b.onset)
            .then(a.part.cmp(&b.part))
            .then(a.pitch.millicents.cmp(&b.pitch.millicents))
            .then(a.id.cmp(&b.id))
    });
    validate_score(&result)?;
    Ok(result)
}

pub fn demonstration_plan() -> CompositionPlan {
    let (ppq, duration) = (480, 32 * 480);
    let lower = [48, 55, 52, 57, 48, 55, 59, 52];
    let upper = [
        [72, 76, 74, 71],
        [76, 79, 74, 72],
        [74, 77, 81, 76],
        [79, 76, 74, 72],
    ];
    let note =
        |id: String, part: &str, onset: u64, duration: u64, pitch: i64, velocity: u8| ScoreNote {
            id,
            part: part.into(),
            onset,
            duration,
            pitch: Pitch {
                millicents: pitch * 100000,
            },
            velocity,
            release_velocity: 64,
            pitch_envelope: None,
            gain_envelope: None,
            source: None,
        };
    let mut materials = vec![ScoreMaterial {
        id: "lower-cell".into(),
        span: 8 * ppq,
        notes: lower
            .into_iter()
            .enumerate()
            .map(|(i, p)| note(format!("lower-{i}"), "lower", i as u64 * ppq, 360, p, 84))
            .collect(),
    }];
    for (cycle, line) in upper.iter().enumerate() {
        materials.push(ScoreMaterial {
            id: format!("upper-{cycle}"),
            span: 8 * ppq,
            notes: line
                .iter()
                .enumerate()
                .map(|(i, &p)| {
                    note(
                        format!("upper-{i}"),
                        "upper",
                        (i as u64 * 2) * ppq + ppq / 2,
                        600,
                        p,
                        78 + i as u8 * 3,
                    )
                })
                .collect(),
        });
    }
    let place = |material: String, onset| MaterialPlacement {
        material,
        onset,
        transpose_millicents: None,
        time_scale: None,
        velocity_scale: None,
        part_map: None,
        pitch_bindings: None,
    };
    CompositionPlan {
        harmonies: None,
        pitch_lattices: None,
        context: ScoreContext {
            ppq,
            duration,
            midi_format: None,
            parts: vec![
                ScorePart {
                    id: "lower".into(),
                    name: "Recurring lower line".into(),
                    track: 0,
                    channel: 0,
                    percussion: false,
                },
                ScorePart {
                    id: "upper".into(),
                    name: "Changing upper line".into(),
                    track: 1,
                    channel: 1,
                    percussion: false,
                },
            ],
            attachments: vec![ScoreAttachment {
                tick: 0,
                track: 0,
                order: 0,
                bytes: vec![255, 81, 3, 7, 161, 32],
            }],
            track_ends: vec![duration, duration],
        },
        materials,
        definitions: Some(vec![
            CompositionDefinition {
                id: "lower-line".into(),
                span: duration,
                placements: (0..4)
                    .map(|i| place("lower-cell".into(), i * 8 * ppq))
                    .collect(),
            },
            CompositionDefinition {
                id: "upper-line".into(),
                span: duration,
                placements: (0..4)
                    .map(|i| place(format!("upper-{i}"), i * 8 * ppq))
                    .collect(),
            },
            CompositionDefinition {
                id: "two-line-study".into(),
                span: duration,
                placements: vec![place("lower-line".into(), 0), place("upper-line".into(), 0)],
            },
        ]),
        placements: vec![place("two-line-study".into(), 0)],
    }
}

#[cfg(test)]
mod pitch_binding_tests {
    use super::*;

    fn domain() -> PitchLattice {
        PitchLattice {
            id: "diatonic".into(),
            origin_millicents: 6_000_000,
            intervals: vec![0, 200_000, 400_000, 500_000, 700_000, 900_000, 1_100_000],
            period_millicents: 1_200_000,
        }
    }
    fn note(index: usize) -> ScoreNote {
        ScoreNote {
            id: format!("event-{index}"),
            part: "p".into(),
            onset: index as u64 * 3,
            duration: 2,
            pitch: Pitch { millicents: 0 },
            velocity: 83,
            release_velocity: 29,
            pitch_envelope: None,
            gain_envelope: None,
            source: None,
        }
    }
    fn literal(pitch: i64) -> PitchBinding {
        PitchBinding::Literal { millicents: pitch }
    }
    fn path(from: usize, to: usize, offset: i64) -> PitchBinding {
        PitchBinding::LatticePath {
            lattice: "diatonic".into(),
            from: PitchAnchor::Event { index: from },
            to: PitchAnchor::Event { index: to },
            numerator: 1,
            denominator: 2,
            degree_offset: offset,
            residual_millicents: 0,
        }
    }
    fn plan() -> CompositionPlan {
        let mut n = note(1);
        // Non-neutral attack and nonuniform curve verify offset conversion.
        n.pitch.millicents = 101;
        n.pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: Pitch { millicents: 101 },
            },
            PitchEnvelopePoint {
                tick: 1,
                pitch: Pitch { millicents: 10_108 },
            },
            PitchEnvelopePoint {
                tick: 2,
                pitch: Pitch { millicents: -2_002 },
            },
        ]);
        n.gain_envelope = Some(vec![
            GainEnvelopePoint { tick: 0, gain: 0.7 },
            GainEnvelopePoint { tick: 2, gain: 0.2 },
        ]);
        CompositionPlan {
            context: ScoreContext {
                ppq: 12,
                duration: 12,
                midi_format: None,
                parts: vec![ScorePart {
                    id: "p".into(),
                    name: "Part".into(),
                    track: 0,
                    channel: 0,
                    percussion: false,
                }],
                attachments: vec![],
                track_ends: vec![12],
            },
            materials: vec![ScoreMaterial {
                id: "m".into(),
                span: 12,
                notes: vec![note(0), n, note(2)],
            }],
            definitions: None,
            placements: vec![MaterialPlacement {
                material: "m".into(),
                onset: 0,
                transpose_millicents: None,
                time_scale: None,
                velocity_scale: None,
                part_map: None,
                pitch_bindings: Some(vec![literal(6_400_000), path(0, 2, 0), literal(6_700_000)]),
            }],
            harmonies: None,
            pitch_lattices: Some(vec![domain()]),
        }
    }

    #[test]
    fn anchored_path_changes_descendants_without_replacing_expression_or_rhythm() {
        let mut plan = plan();
        let original_plan = serde_json::to_value(&plan).unwrap();
        let source = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(
            source
                .notes
                .iter()
                .map(|n| n.pitch.millicents)
                .collect::<Vec<_>>(),
            [6_400_000, 6_500_000, 6_700_000]
        );
        assert_eq!(serde_json::to_value(&plan).unwrap(), original_plan);
        let bindings = plan.placements[0].pitch_bindings.as_mut().unwrap();
        bindings[0] = literal(6_000_000);
        bindings[2] = literal(6_400_000);
        let changed = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(
            changed
                .notes
                .iter()
                .map(|n| n.pitch.millicents)
                .collect::<Vec<_>>(),
            [6_000_000, 6_200_000, 6_400_000]
        );
        let middle = &changed.notes[1];
        assert_eq!(
            middle
                .pitch_envelope
                .as_ref()
                .unwrap()
                .iter()
                .map(|p| p.pitch.millicents)
                .collect::<Vec<_>>(),
            [6_200_000, 6_210_007, 6_197_897]
        );
        assert_eq!(middle.gain_envelope, source.notes[1].gain_envelope);
        assert_eq!(
            (
                middle.onset,
                middle.duration,
                middle.velocity,
                middle.release_velocity
            ),
            (3, 2, 83, 29)
        );
        let recovered: CompositionPlan =
            serde_json::from_value(serde_json::to_value(&plan).unwrap()).unwrap();
        assert_eq!(
            compile_composition(&recovered, &CompositionLimits::default()).unwrap(),
            changed
        );
    }

    #[test]
    fn harmonic_anchors_local_bindings_and_outer_transforms_compose() {
        let mut plan = plan();
        plan.harmonies = Some(vec![CompositionHarmony {
            id: "h".into(),
            root_millicents: 6_000_000,
            intervals: vec![400_000, 700_000],
        }]);
        let bindings = plan.placements[0].pitch_bindings.as_mut().unwrap();
        bindings[0] = PitchBinding::Harmony {
            harmony: "h".into(),
            tone: 0,
            octave: 0,
            residual_millicents: 0,
        };
        bindings[2] = PitchBinding::Harmony {
            harmony: "h".into(),
            tone: 1,
            octave: 0,
            residual_millicents: 0,
        };
        if let PitchBinding::LatticePath {
            residual_millicents,
            ..
        } = &mut bindings[1]
        {
            *residual_millicents = 37;
        }
        let mut second = plan.placements[0].clone();
        second.onset = 12;
        second.transpose_millicents = Some(19_123);
        second.time_scale = Some(TimeScale {
            numerator: 1,
            denominator: 2,
        });
        second.pitch_bindings = Some(vec![literal(6_000_000), path(0, 2, 0), literal(6_400_000)]);
        plan.placements.push(second);
        let score = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(score.ppq, 24);
        assert_eq!(score.notes[1].pitch.millicents, 6_500_037);
        assert_eq!(score.notes[4].pitch.millicents, 6_219_123);
        assert_eq!((score.notes[4].onset, score.notes[4].duration), (27, 2));
        assert_eq!(
            score.notes[4].pitch_envelope.as_ref().unwrap()[1]
                .pitch
                .millicents,
            6_229_130
        );
    }

    fn harmonic_anchor(id: &str, tone: usize) -> PitchAnchor {
        PitchAnchor::Harmony {
            harmony: id.into(),
            tone,
            octave: 0,
            residual_millicents: 0,
        }
    }

    fn value_path(from: PitchAnchor, to: PitchAnchor) -> PitchBinding {
        PitchBinding::LatticePath {
            lattice: "diatonic".into(),
            from,
            to,
            numerator: 1,
            denominator: 2,
            degree_offset: 0,
            residual_millicents: 0,
        }
    }

    #[test]
    fn value_anchors_need_no_emitted_anchor_notes_and_follow_shared_palette_edits() {
        let mut plan = plan();
        // Only the dependent event is emitted; the two anchor values are fully
        // specified parameters, not chosen witnesses or source-note lookups.
        plan.materials[0].notes = vec![plan.materials[0].notes[1].clone()];
        plan.placements[0].pitch_bindings = Some(vec![value_path(
            harmonic_anchor("shared", 0),
            harmonic_anchor("shared", 1),
        )]);
        plan.harmonies = Some(vec![CompositionHarmony {
            id: "shared".into(),
            root_millicents: 6_000_000,
            intervals: vec![400_000, 700_000],
        }]);
        let mut second = plan.placements[0].clone();
        second.onset = 12;
        second.transpose_millicents = Some(37);
        second.time_scale = Some(TimeScale {
            numerator: 1,
            denominator: 2,
        });
        plan.placements.push(second);
        let snapshot = serde_json::to_value(&plan).unwrap();
        let source = compile_composition(&plan, &CompositionLimits::default()).unwrap();
        assert_eq!(
            source
                .notes
                .iter()
                .map(|n| n.pitch.millicents)
                .collect::<Vec<_>>(),
            [6_500_000, 6_500_037]
        );
        assert_eq!(serde_json::to_value(&plan).unwrap(), snapshot);
        plan.harmonies.as_mut().unwrap()[0].intervals = vec![0, 400_000];
        let recovered: CompositionPlan =
            serde_json::from_value(serde_json::to_value(&plan).unwrap()).unwrap();
        let changed = compile_composition(&recovered, &CompositionLimits::default()).unwrap();
        assert_eq!(
            changed
                .notes
                .iter()
                .map(|n| n.pitch.millicents)
                .collect::<Vec<_>>(),
            [6_200_000, 6_200_037]
        );
        for (old, new) in source.notes.iter().zip(&changed.notes) {
            assert_eq!(
                (
                    old.onset,
                    old.duration,
                    old.velocity,
                    old.release_velocity,
                    &old.gain_envelope
                ),
                (
                    new.onset,
                    new.duration,
                    new.velocity,
                    new.release_velocity,
                    &new.gain_envelope
                )
            );
            let curve = |n: &ScoreNote| {
                n.pitch_envelope
                    .as_ref()
                    .unwrap()
                    .iter()
                    .map(|p| (p.tick, p.pitch.millicents - n.pitch.millicents))
                    .collect::<Vec<_>>()
            };
            assert_eq!(curve(old), curve(new));
        }
    }

    #[test]
    fn independent_value_palettes_and_event_anchors_keep_distinct_dependencies() {
        let notes = vec![note(0), note(1), note(2)];
        let mut frames = vec![
            CompositionHarmony {
                id: "left".into(),
                root_millicents: 6_000_000,
                intervals: vec![400_000],
            },
            CompositionHarmony {
                id: "right".into(),
                root_millicents: 6_000_000,
                intervals: vec![700_000],
            },
        ];
        let binding = value_path(harmonic_anchor("left", 0), harmonic_anchor("right", 0));
        let bindings = vec![literal(6_400_000), binding, literal(6_700_000)];
        let resolve = |bindings: &[PitchBinding], frames: &[CompositionHarmony]| {
            resolve_material_pitches(&notes, bindings, frames, &[domain()]).unwrap()
        };
        assert_eq!(
            resolve(&bindings, &frames),
            [6_400_000, 6_500_000, 6_700_000]
        );
        frames[0].intervals[0] = 0;
        assert_eq!(
            resolve(&bindings, &frames),
            [6_400_000, 6_400_000, 6_700_000]
        );
        frames[1].intervals[0] = 400_000;
        assert_eq!(
            resolve(&bindings, &frames),
            [6_400_000, 6_200_000, 6_700_000]
        );
        let mixed = vec![
            literal(6_000_000),
            value_path(PitchAnchor::Event { index: 0 }, harmonic_anchor("right", 0)),
            literal(6_700_000),
        ];
        assert_eq!(resolve(&mixed, &frames), [6_000_000, 6_200_000, 6_700_000]);

        let additive = PitchBinding::Harmony {
            harmony: "right".into(),
            tone: 0,
            octave: 0,
            residual_millicents: -101,
        };
        let value = harmonic_pitch_anchor(101, &additive).unwrap();
        assert_eq!(value, harmonic_anchor("right", 0));
        let mut nonneutral = notes.clone();
        nonneutral[0].pitch.millicents = 101;
        let equivalent = vec![
            additive,
            value_path(PitchAnchor::Event { index: 0 }, value),
            literal(6_700_000),
        ];
        assert_eq!(
            resolve_material_pitches(&nonneutral, &equivalent, &frames, &[domain()]).unwrap(),
            [6_400_000, 6_400_000, 6_700_000]
        );
    }

    #[test]
    fn value_anchors_reject_unknown_parameters_and_unsafe_coordinates() {
        let notes = vec![note(0)];
        let frame = CompositionHarmony {
            id: "h".into(),
            root_millicents: 6_000_000,
            intervals: vec![0, 400_000],
        };
        let check = |from: PitchAnchor, to: PitchAnchor| {
            resolve_material_pitches(
                &notes,
                &[value_path(from, to)],
                &[frame.clone()],
                &[domain()],
            )
            .unwrap_err()
            .message
        };
        assert!(
            check(harmonic_anchor("missing", 0), harmonic_anchor("h", 1))
                .contains("Unknown harmonic")
        );
        assert!(check(harmonic_anchor("h", 2), harmonic_anchor("h", 1)).contains("tone"));
        let mut off_lattice = harmonic_anchor("h", 0);
        if let PitchAnchor::Harmony {
            residual_millicents,
            ..
        } = &mut off_lattice
        {
            *residual_millicents = 1;
        }
        assert!(check(off_lattice, harmonic_anchor("h", 1)).contains("exactly"));
        let mut unsafe_anchor = harmonic_anchor("h", 0);
        if let PitchAnchor::Harmony { octave, .. } = &mut unsafe_anchor {
            *octave = MAX_SAFE as i64;
        }
        assert!(check(unsafe_anchor, harmonic_anchor("h", 1)).contains("safe"));
        assert!(check(PitchAnchor::Event { index: 0 }, harmonic_anchor("h", 1)).contains("cycle"));
        let binding = value_path(harmonic_anchor("h", 0), harmonic_anchor("h", 1));
        let mut invalid_frame = frame.clone();
        invalid_frame.intervals.clear();
        assert!(resolve_material_pitches(
            &notes,
            &[binding.clone()],
            &[invalid_frame],
            &[domain()]
        )
        .unwrap_err()
        .message
        .contains("Invalid"));
        let mut unsafe_frame = frame.clone();
        unsafe_frame.root_millicents = MAX_SAFE as i64 + 1;
        assert!(
            resolve_material_pitches(&notes, &[binding.clone()], &[unsafe_frame], &[domain()])
                .unwrap_err()
                .message
                .contains("Invalid")
        );
        assert!(resolve_material_pitches(&notes, &[binding], &[frame], &[])
            .unwrap_err()
            .message
            .contains("Unknown pitch lattice"));
        assert!(harmonic_pitch_anchor(0, &literal(0)).is_err());
        assert!(harmonic_pitch_anchor(
            MAX_SAFE as i64,
            &PitchBinding::Harmony {
                harmony: "h".into(),
                tone: 0,
                octave: 0,
                residual_millicents: 1,
            }
        )
        .is_err());
    }

    #[test]
    fn lattice_is_nonuniform_native_and_handles_negative_degrees() {
        let mut lattice = PitchLattice {
            id: "diatonic".into(),
            origin_millicents: 17,
            intervals: vec![0, 123, 456],
            period_millicents: 1_001,
        };
        for degree in -15..=15 {
            let pitch = pitch_lattice_pitch(degree, &lattice, 0).unwrap();
            assert_eq!(pitch_lattice_degree(pitch, &lattice).unwrap(), Some(degree));
        }
        assert_eq!(pitch_lattice_degree(18, &lattice).unwrap(), None);
        let notes = vec![note(0), note(1), note(2)];
        let bindings = vec![literal(17), path(0, 2, 0), literal(473)];
        assert_eq!(
            resolve_material_pitches(&notes, &bindings, &[], &[lattice.clone()]).unwrap(),
            [17, 140, 473]
        );
        lattice.intervals[1] = 170;
        assert_eq!(
            resolve_material_pitches(&notes, &bindings, &[], &[lattice.clone()]).unwrap(),
            [17, 187, 473]
        );
        let neighbor = vec![literal(17), path(0, 2, -1), literal(17)];
        assert_eq!(
            resolve_material_pitches(&notes, &neighbor, &[], &[lattice]).unwrap()[1],
            -528
        );
    }

    #[test]
    fn dependency_graph_rejects_cycles_missing_anchors_and_nonintegral_paths() {
        let notes = vec![note(0), note(1), note(2)];
        let check = |bindings: Vec<PitchBinding>| {
            resolve_material_pitches(&notes, &bindings, &[], &[domain()])
                .unwrap_err()
                .message
        };
        assert!(check(vec![path(1, 1, 0), path(0, 0, 0), literal(6_400_000)]).contains("cycle"));
        assert!(
            check(vec![literal(6_000_000), path(1, 2, 0), literal(6_400_000)]).contains("cycle")
        );
        assert!(
            check(vec![literal(6_000_000), path(0, 3, 0), literal(6_400_000)]).contains("Unknown")
        );
        assert!(
            check(vec![literal(6_000_000), path(0, 2, 0), literal(6_200_000)])
                .contains("integer degree")
        );
        assert!(
            check(vec![literal(6_000_001), path(0, 2, 0), literal(6_400_000)]).contains("exactly")
        );
    }

    #[test]
    fn lattice_validation_and_safe_coordinates_are_explicit() {
        let mut lattice = domain();
        for intervals in [vec![], vec![1], vec![0, 0], vec![0, -1], vec![0, 1_200_000]] {
            lattice.intervals = intervals;
            assert!(pitch_lattice_degree(6_000_000, &lattice).is_err());
        }
        let lattice = PitchLattice {
            id: "x".into(),
            origin_millicents: -(MAX_SAFE as i64),
            intervals: vec![0],
            period_millicents: 1,
        };
        assert!(pitch_lattice_degree(MAX_SAFE as i64, &lattice).is_err());
        assert!(pitch_lattice_pitch(MAX_SAFE as i64, &domain(), 0).is_err());
        let mut plan = plan();
        if let PitchBinding::LatticePath { denominator, .. } =
            &mut plan.placements[0].pitch_bindings.as_mut().unwrap()[1]
        {
            *denominator = 0;
        }
        assert!(compile_composition(&plan, &CompositionLimits::default())
            .unwrap_err()
            .message
            .contains("coordinate"));
        plan.pitch_lattices.as_mut().unwrap().push(domain());
        assert!(compile_composition(&plan, &CompositionLimits::default())
            .unwrap_err()
            .message
            .contains("Duplicate"));
    }

    #[test]
    fn dependency_chain_is_iterative_and_independent_of_source_ids() {
        let count = 5_000;
        let mut notes: Vec<_> = (0..count).map(note).collect();
        for note in &mut notes {
            note.id = "not-an-anchor".into();
        }
        let lattice = PitchLattice {
            id: "diatonic".into(),
            origin_millicents: 0,
            intervals: vec![0],
            period_millicents: 1,
        };
        let mut bindings = vec![literal(0)];
        bindings.extend((1..count).map(|i| path(i - 1, i - 1, 1)));
        let pitches = resolve_material_pitches(&notes, &bindings, &[], &[lattice]).unwrap();
        assert_eq!(pitches[count - 1], (count - 1) as i64);
    }
}
