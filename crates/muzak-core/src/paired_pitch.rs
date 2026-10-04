//! Exact shared pitch expressions from two supplied, corresponding realizations.
//! Context IDs are parameter slots supplied by the caller, not inferred harmony.
//! Timing and expression remain observations; only attack-pitch bindings are fit.
use crate::{
    composition::{
        CompositionHarmony, PitchAnchor, PitchBinding, PitchLattice, ScoreMaterial,
        pitch_lattice_degree, pitch_lattice_pitch, resolve_material_pitches,
    },
    error::{CoreResult, budget, invalid},
    model::{MAX_SAFE, validate_note_trajectories},
    operations::transpose_note,
};
use std::collections::{BTreeMap, BTreeSet, HashSet};

pub struct PitchRealization {
    pub material: ScoreMaterial,
    pub harmonies: Vec<CompositionHarmony>,
    pub lattices: Vec<PitchLattice>,
}

#[derive(Debug, Clone)]
pub struct PairedPitchOptions {
    pub max_context_members: usize,
    pub max_candidate_checks: usize,
    pub max_candidates: usize,
}
impl Default for PairedPitchOptions {
    fn default() -> Self {
        Self {
            max_context_members: 512,
            max_candidate_checks: 100_000,
            max_candidates: 4096,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairedPitchCandidate {
    pub binding: PitchBinding,
    /// Event anchors must choose a direct Harmony alternative in the same
    /// program. This is a compatibility constraint, not a voice assignment.
    pub required_direct_events: Vec<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct PairedPitchWork {
    pub candidate_checks: usize,
    pub resolver_checks: usize,
    pub candidates: usize,
}

#[derive(Debug)]
pub struct PairedPitchInference {
    /// Both materials are in correspondence order with neutral attack pitches.
    /// Each keeps its own observed rhythm, routing, dynamics and relative curves.
    pub materials: [ScoreMaterial; 2],
    pub correspondence: Vec<[usize; 2]>,
    /// Complete within the documented finite grammar, or the function fails.
    /// An empty event list means no shared expression was found for that event;
    /// no example-specific literal is inserted to disguise that limitation.
    pub candidates: Vec<Vec<PairedPitchCandidate>>,
    pub parameters: PairedPitchOptions,
    pub work: PairedPitchWork,
}
impl PairedPitchInference {
    /// Select one existing expression per event without adding a new program
    /// language. The result is directly usable as MaterialPlacement bindings.
    pub fn bindings_for(&self, choices: &[usize]) -> CoreResult<Vec<PitchBinding>> {
        if choices.len() != self.candidates.len() {
            return Err(invalid(
                "Paired pitch choice count differs from material events.",
            ));
        }
        let selected = choices
            .iter()
            .enumerate()
            .map(|(event, &choice)| {
                self.candidates[event]
                    .get(choice)
                    .ok_or_else(|| invalid("Unknown paired pitch candidate."))
            })
            .collect::<CoreResult<Vec<_>>>()?;
        for candidate in &selected {
            if candidate.required_direct_events.iter().any(|&event| {
                selected
                    .get(event)
                    .is_none_or(|c| !matches!(c.binding, PitchBinding::Harmony { .. }))
            }) {
                return Err(invalid(
                    "Paired pitch event anchor requires a direct harmonic binding.",
                ));
            }
        }
        Ok(selected.into_iter().map(|c| c.binding.clone()).collect())
    }
}

fn charge(value: &mut usize, limit: usize, message: &str) -> CoreResult<()> {
    *value = value
        .checked_add(1)
        .filter(|&n| n <= limit)
        .ok_or_else(|| budget(message))?;
    Ok(())
}
fn octave(pitch: i64, harmony: &CompositionHarmony, tone: usize) -> Option<i64> {
    // Harmony's existing octave coordinate is explicitly 1,200,000 millicents;
    // the separately supplied lattice may have any valid period.
    let delta = i128::from(pitch)
        - i128::from(harmony.root_millicents)
        - i128::from(harmony.intervals[tone]);
    (delta % 1_200_000 == 0)
        .then_some(delta / 1_200_000)
        .filter(|v| v.unsigned_abs() <= u128::from(MAX_SAFE))
        .map(|v| v as i64)
}
fn path(lattice: &str, from: PitchAnchor, to: PitchAnchor, offset: i64) -> PitchBinding {
    let (numerator, denominator) = if from == to { (0, 1) } else { (1, 2) };
    PitchBinding::LatticePath {
        lattice: lattice.into(),
        from,
        to,
        numerator,
        denominator,
        degree_offset: offset,
        residual_millicents: 0,
    }
}

/// Infer the SAME zero-residual expressions in two supplied contexts. The
/// correspondence must be a bijection over all events (1..=12) in each material.
/// Palette/lattice IDs and palette tone indices already name corresponding
/// parameters; equal numeric values never merge independently editable IDs.
///
/// Finite grammar: common literal; direct harmonic tone/octave; one lattice
/// degree above/below a harmonic value; held-event one-degree neighbor; and
/// exact-touch three-event midpoint passing or returning-neighbor paths.
/// Event endpoints need available direct harmonic expressions in BOTH examples.
/// No chains, fitted pitch residuals, inferred voices or best-parse ranking.
/// Candidates factor by event with explicit direct-endpoint constraints. Every
/// satisfying combination reproduces both attack vectors; expressive data stays
/// in the returned materials. Budget failure returns no partial candidate set.
pub fn infer_paired_pitch(
    examples: &[PitchRealization; 2],
    correspondence: &[[usize; 2]],
    options: &PairedPitchOptions,
) -> CoreResult<PairedPitchInference> {
    if options.max_context_members == 0
        || options.max_context_members > 100_000
        || options.max_candidate_checks == 0
        || options.max_candidate_checks > 2_000_000
        || options.max_candidates == 0
        || options.max_candidates > 100_000
    {
        return Err(invalid("Invalid paired pitch budgets."));
    }
    let n = correspondence.len();
    if n == 0 || n > 12 || examples.iter().any(|e| e.material.notes.len() != n) {
        return Err(invalid(
            "Paired pitch requires 1..=12 fully corresponding events.",
        ));
    }
    let mut members = 0usize;
    for e in examples {
        for count in e
            .harmonies
            .iter()
            .map(|h| h.intervals.len().saturating_add(1))
            .chain(
                e.lattices
                    .iter()
                    .map(|l| l.intervals.len().saturating_add(1)),
            )
            .chain(e.material.notes.iter().map(|note| {
                note.pitch_envelope
                    .as_ref()
                    .map_or(0, Vec::len)
                    .saturating_add(note.gain_envelope.as_ref().map_or(0, Vec::len))
            }))
        {
            members = members
                .checked_add(count)
                .filter(|&v| v <= options.max_context_members)
                .ok_or_else(|| budget("Paired pitch context-member budget exceeded."))?;
        }
        let mut ids = HashSet::new();
        if e.material.id.is_empty() || e.material.span > MAX_SAFE {
            return Err(invalid("Invalid paired pitch material."));
        }
        for note in &e.material.notes {
            if note.id.is_empty()
                || !ids.insert(&note.id)
                || note.part.is_empty()
                || note.velocity == 0
                || note.velocity > 127
                || note.release_velocity > 127
                || note
                    .onset
                    .checked_add(note.duration)
                    .is_none_or(|end| end > MAX_SAFE)
                || (note.onset >= e.material.span
                    && !(e.material.span == 0 && note.onset == 0 && note.duration == 0))
            {
                return Err(invalid("Invalid paired pitch observation."));
            }
            validate_note_trajectories(note)?;
        }
        // Reuse the compiler's palette/lattice and native-coordinate admission.
        resolve_material_pitches(
            &e.material.notes,
            &vec![PitchBinding::Literal { millicents: 0 }; n],
            &e.harmonies,
            &e.lattices,
        )?;
    }
    for side in 0..2 {
        let indices: BTreeSet<_> = correspondence.iter().map(|p| p[side]).collect();
        if indices.len() != n || indices.iter().copied().ne(0..n) {
            return Err(invalid(
                "Paired pitch correspondence must be a complete bijection.",
            ));
        }
    }
    let hs = examples.each_ref().map(|e| {
        e.harmonies
            .iter()
            .map(|h| (h.id.as_str(), h))
            .collect::<BTreeMap<_, _>>()
    });
    let ls = examples.each_ref().map(|e| {
        e.lattices
            .iter()
            .map(|l| (l.id.as_str(), l))
            .collect::<BTreeMap<_, _>>()
    });
    if hs[0].keys().ne(hs[1].keys())
        || ls[0].keys().ne(ls[1].keys())
        || hs[0]
            .iter()
            .any(|(id, h)| h.intervals.len() != hs[1][id].intervals.len())
    {
        return Err(invalid(
            "Paired pitch contexts need matching supplied parameter slots.",
        ));
    }
    let normalized = |side: usize| -> CoreResult<ScoreMaterial> {
        Ok(ScoreMaterial {
            id: examples[side].material.id.clone(),
            span: examples[side].material.span,
            notes: correspondence
                .iter()
                .map(|p| {
                    let note = &examples[side].material.notes[p[side]];
                    transpose_note(note, -note.pitch.millicents)
                })
                .collect::<CoreResult<_>>()?,
        })
    };
    let materials = [normalized(0)?, normalized(1)?];
    let pitches = [0, 1].map(|side| {
        correspondence
            .iter()
            .map(|p| examples[side].material.notes[p[side]].pitch.millicents)
            .collect::<Vec<_>>()
    });
    let literal = pitches.each_ref().map(|p| {
        p.iter()
            .map(|&millicents| PitchBinding::Literal { millicents })
            .collect::<Vec<_>>()
    });
    let mut work = PairedPitchWork::default();
    let mut candidates: Vec<Vec<PairedPitchCandidate>> = vec![vec![]; n];
    let mut keys: Vec<HashSet<String>> = vec![HashSet::new(); n];
    // Each proposed expression is checked with the existing compiler resolver
    // in both contexts; literal probe endpoints merely supply observed attacks.
    let admit = |event: usize,
                 binding: PitchBinding,
                 required: Vec<usize>,
                 candidates: &mut Vec<Vec<PairedPitchCandidate>>,
                 keys: &mut Vec<HashSet<String>>,
                 work: &mut PairedPitchWork|
     -> CoreResult<()> {
        let key = serde_json::to_string(&binding)?;
        if keys[event].contains(&key) {
            return Ok(());
        }
        for side in 0..2 {
            work.resolver_checks += 1;
            let mut probe = literal[side].clone();
            probe[event] = binding.clone();
            let Ok(actual) = resolve_material_pitches(
                &materials[side].notes,
                &probe,
                &examples[side].harmonies,
                &examples[side].lattices,
            ) else {
                return Ok(());
            };
            if actual != pitches[side] {
                return Ok(());
            }
        }
        charge(
            &mut work.candidates,
            options.max_candidates,
            "Paired pitch candidate storage budget exceeded.",
        )?;
        keys[event].insert(key);
        candidates[event].push(PairedPitchCandidate {
            binding,
            required_direct_events: required,
        });
        Ok(())
    };
    let attempt = |work: &mut PairedPitchWork| {
        charge(
            &mut work.candidate_checks,
            options.max_candidate_checks,
            "Paired pitch candidate-check budget exceeded.",
        )
    };
    for event in 0..n {
        attempt(&mut work)?;
        if pitches[0][event] == pitches[1][event] {
            admit(
                event,
                literal[0][event].clone(),
                vec![],
                &mut candidates,
                &mut keys,
                &mut work,
            )?;
        }
        for (&id, h) in &hs[0] {
            for tone in 0..h.intervals.len() {
                attempt(&mut work)?;
                if let Some(octave) = octave(pitches[0][event], h, tone) {
                    admit(
                        event,
                        PitchBinding::Harmony {
                            harmony: id.into(),
                            tone,
                            octave,
                            residual_millicents: 0,
                        },
                        vec![],
                        &mut candidates,
                        &mut keys,
                        &mut work,
                    )?;
                }
                for (&domain, lattice) in &ls[0] {
                    for offset in [-1, 1] {
                        attempt(&mut work)?;
                        let Some(degree) = pitch_lattice_degree(pitches[0][event], lattice)? else {
                            continue;
                        };
                        let Some(anchor_degree) = degree
                            .checked_sub(offset)
                            .filter(|d| d.unsigned_abs() <= MAX_SAFE)
                        else {
                            continue;
                        };
                        let Ok(anchor_pitch) = pitch_lattice_pitch(anchor_degree, lattice, 0)
                        else {
                            continue;
                        };
                        let Some(octave) = octave(anchor_pitch, h, tone) else {
                            continue;
                        };
                        let anchor = PitchAnchor::Harmony {
                            harmony: id.into(),
                            tone,
                            octave,
                            residual_millicents: 0,
                        };
                        admit(
                            event,
                            path(domain, anchor.clone(), anchor, offset),
                            vec![],
                            &mut candidates,
                            &mut keys,
                            &mut work,
                        )?;
                    }
                }
            }
        }
    }
    let direct: Vec<_> = candidates
        .iter()
        .map(|cs| {
            cs.iter()
                .any(|c| matches!(c.binding, PitchBinding::Harmony { .. }))
        })
        .collect();
    for middle in 0..n {
        for from in (0..n).filter(|&a| a != middle && direct[a]) {
            for (&domain, _) in &ls[0] {
                for offset in [-1, 1] {
                    attempt(&mut work)?;
                    let held = (0..2).all(|side| {
                        let (a, m) = (&materials[side].notes[from], &materials[side].notes[middle]);
                        m.duration > 0 && a.onset <= m.onset && a.onset + a.duration > m.onset
                    });
                    if held {
                        let anchor = PitchAnchor::Event { index: from };
                        admit(
                            middle,
                            path(domain, anchor.clone(), anchor, offset),
                            vec![from],
                            &mut candidates,
                            &mut keys,
                            &mut work,
                        )?;
                    }
                }
                for to in (0..n).filter(|&b| b != middle && b != from && direct[b]) {
                    attempt(&mut work)?;
                    let touching = (0..2).all(|side| {
                        let (a, m, b) = (
                            &materials[side].notes[from],
                            &materials[side].notes[middle],
                            &materials[side].notes[to],
                        );
                        a.duration > 0
                            && m.duration > 0
                            && b.duration > 0
                            && a.onset + a.duration == m.onset
                            && m.onset + m.duration == b.onset
                    });
                    if !touching {
                        continue;
                    }
                    let mut offsets = vec![];
                    for side in 0..2 {
                        let lattice = ls[side][domain];
                        let degrees = [
                            pitch_lattice_degree(pitches[side][from], lattice)?,
                            pitch_lattice_degree(pitches[side][middle], lattice)?,
                            pitch_lattice_degree(pitches[side][to], lattice)?,
                        ];
                        let [Some(a), Some(m), Some(b)] = degrees else {
                            break;
                        };
                        let before = i128::from(m) - i128::from(a);
                        let after = i128::from(b) - i128::from(m);
                        let offset = if before.abs() == 1 && before == after {
                            Some(0)
                        } else if a == b && before.abs() == 1 {
                            Some(before as i64)
                        } else {
                            None
                        };
                        let Some(offset) = offset else {
                            break;
                        };
                        offsets.push(offset);
                    }
                    if offsets.len() == 2 && offsets[0] == offsets[1] {
                        admit(
                            middle,
                            path(
                                domain,
                                PitchAnchor::Event { index: from },
                                PitchAnchor::Event { index: to },
                                offsets[0],
                            ),
                            vec![from, to],
                            &mut candidates,
                            &mut keys,
                            &mut work,
                        )?;
                    }
                }
            }
        }
    }
    Ok(PairedPitchInference {
        materials,
        correspondence: correspondence.to_vec(),
        candidates,
        parameters: options.clone(),
        work,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        composition::{CompositionLimits, CompositionPlan, MaterialPlacement, compile_composition},
        model::{
            GainEnvelopePoint, NoteSource, Pitch, PitchEnvelopePoint, Score, ScoreContext,
            ScoreNote, ScorePart,
        },
    };

    fn example(pitches: &[i64], minor: bool) -> PitchRealization {
        PitchRealization {
            material: ScoreMaterial {
                id: "cell".into(),
                span: pitches.len() as u64 * 4 + 4,
                notes: pitches
                    .iter()
                    .enumerate()
                    .map(|(i, &p)| ScoreNote {
                        id: format!("original-{i}"),
                        part: if i == 0 { "low" } else { "high" }.into(),
                        onset: i as u64 * 4,
                        duration: 4,
                        pitch: Pitch {
                            millicents: p * 100_000,
                        },
                        velocity: 70 + i as u8,
                        release_velocity: 51,
                        pitch_envelope: Some(vec![
                            PitchEnvelopePoint {
                                tick: 0,
                                pitch: Pitch {
                                    millicents: p * 100_000,
                                },
                            },
                            PitchEnvelopePoint {
                                tick: 1,
                                pitch: Pitch {
                                    millicents: p * 100_000 + 101,
                                },
                            },
                            PitchEnvelopePoint {
                                tick: 4,
                                pitch: Pitch {
                                    millicents: p * 100_000,
                                },
                            },
                        ]),
                        gain_envelope: Some(vec![
                            GainEnvelopePoint { tick: 0, gain: 0.8 },
                            GainEnvelopePoint { tick: 4, gain: 0.3 },
                        ]),
                        source: Some(NoteSource {
                            on_order: i as u64,
                            off_order: i as u64 + 10,
                            off_status: 128,
                        }),
                    })
                    .collect(),
            },
            harmonies: vec![CompositionHarmony {
                id: "parent".into(),
                root_millicents: 6_000_000,
                intervals: vec![0, if minor { 300_000 } else { 400_000 }, 700_000],
            }],
            lattices: vec![PitchLattice {
                id: "domain".into(),
                origin_millicents: 6_000_000,
                period_millicents: 1_200_000,
                intervals: if minor {
                    vec![0, 200_000, 300_000, 500_000, 700_000, 800_000, 1_000_000]
                } else {
                    vec![0, 200_000, 400_000, 500_000, 700_000, 900_000, 1_100_000]
                },
            }],
        }
    }
    fn correspond(n: usize) -> Vec<[usize; 2]> {
        (0..n).map(|i| [i, i]).collect()
    }
    fn direct(tone: usize) -> PitchBinding {
        PitchBinding::Harmony {
            harmony: "parent".into(),
            tone,
            octave: 0,
            residual_millicents: 0,
        }
    }
    fn next(tone: usize) -> PitchBinding {
        let anchor = PitchAnchor::Harmony {
            harmony: "parent".into(),
            tone,
            octave: 0,
            residual_millicents: 0,
        };
        path("domain", anchor.clone(), anchor, 1)
    }
    fn choices(result: &PairedPitchInference, bindings: &[PitchBinding]) -> Vec<usize> {
        bindings
            .iter()
            .enumerate()
            .map(|(i, b)| {
                result.candidates[i]
                    .iter()
                    .position(|c| &c.binding == b)
                    .unwrap()
            })
            .collect()
    }
    fn plan(
        material: &ScoreMaterial,
        example: &PitchRealization,
        bindings: Vec<PitchBinding>,
    ) -> CompositionPlan {
        let ids: BTreeSet<_> = material.notes.iter().map(|n| n.part.clone()).collect();
        let parts: Vec<_> = ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| ScorePart {
                name: id.clone(),
                id,
                track: i,
                channel: i as u8,
                percussion: false,
            })
            .collect();
        CompositionPlan {
            context: ScoreContext {
                ppq: 4,
                duration: material.span,
                midi_format: Some(1),
                track_ends: vec![material.span; parts.len()],
                parts,
                attachments: vec![],
            },
            materials: vec![material.clone()],
            definitions: None,
            harmonies: Some(example.harmonies.clone()),
            pitch_lattices: Some(example.lattices.clone()),
            patterns: None,
            placements: vec![MaterialPlacement {
                material: material.id.clone(),
                onset: 0,
                transpose_millicents: None,
                time_scale: None,
                velocity_scale: None,
                part_map: None,
                pitch_bindings: Some(bindings),
            }],
        }
    }
    fn compile(plan: &CompositionPlan) -> Score {
        compile_composition(plan, &CompositionLimits::default()).unwrap()
    }
    fn by_event(score: &Score) -> Vec<ScoreNote> {
        let mut notes = score.notes.clone();
        notes.sort_by_key(|n| n.id.rsplit(':').next().unwrap().parse::<usize>().unwrap());
        notes
    }
    fn pitches(score: &Score) -> Vec<i64> {
        by_event(score).iter().map(|n| n.pitch.millicents).collect()
    }
    fn exact_observations(score: &Score, source: &ScoreMaterial, order: &[usize]) {
        for (mut actual, &i) in by_event(score).into_iter().zip(order) {
            // Compiler identities are new. Only identity/provenance is restored;
            // no pitch, expression, routing, duration or velocity is repaired.
            actual.id = source.notes[i].id.clone();
            actual.source = source.notes[i].source.clone();
            assert_eq!(actual, source.notes[i]);
        }
        assert_eq!(score.notes.len(), source.notes.len());
        assert_eq!(score.duration, source.span);
    }
    fn same_expression(before: &Score, after: &Score) {
        assert_eq!(before.parts, after.parts);
        assert_eq!(before.duration, after.duration);
        assert_eq!(before.track_ends, after.track_ends);
        for (a, b) in by_event(before).iter().zip(by_event(after)) {
            assert_eq!(
                transpose_note(&b, a.pitch.millicents - b.pitch.millicents).unwrap(),
                *a
            );
        }
    }

    #[test]
    fn shared_replacement_reconstructs_both_and_compiles_unseen_domain_and_parent() {
        let examples = [example(&[60, 65, 69], false), example(&[60, 65, 68], true)];
        let before = examples
            .each_ref()
            .map(|e| serde_json::to_value(&e.material).unwrap());
        let result =
            infer_paired_pitch(&examples, &correspond(3), &PairedPitchOptions::default()).unwrap();
        let selected = choices(&result, &[direct(0), next(1), next(2)]);
        let bindings = result.bindings_for(&selected).unwrap();
        for side in 0..2 {
            let score = compile(&plan(
                &result.materials[side],
                &examples[side],
                bindings.clone(),
            ));
            exact_observations(&score, &examples[side].material, &[0, 1, 2]);
            assert_eq!(
                serde_json::to_value(&examples[side].material).unwrap(),
                before[side]
            );
        }
        assert!(
            !result.candidates[2]
                .iter()
                .any(|c| matches!(c.binding, PitchBinding::Literal { .. }))
        );
        let mut withheld = plan(&result.materials[0], &examples[0], bindings);
        let baseline = compile(&withheld);
        // No withheld pitch vector is an inference input. The edited domain
        // moves only its next-third degree, defeating literal/transposition copy.
        withheld.pitch_lattices.as_mut().unwrap()[0].intervals[3] = 600_000;
        let lydian = compile(&withheld);
        assert_eq!(pitches(&lydian), [6_000_000, 6_600_000, 6_900_000]);
        same_expression(&baseline, &lydian);
        withheld.pitch_lattices = Some(examples[0].lattices.clone());
        let parent = &mut withheld.harmonies.as_mut().unwrap()[0];
        parent.root_millicents = 6_900_000;
        parent.intervals[1] = 300_000;
        let changed_parent = compile(&withheld);
        assert_eq!(pitches(&changed_parent), [6_900_000, 7_400_000, 7_700_000]);
        same_expression(&baseline, &changed_parent);
    }

    #[test]
    fn event_and_value_anchors_remain_ambiguous_and_diverge_on_local_edit() {
        let mut examples = [example(&[64, 65], false), example(&[63, 65], true)];
        for e in &mut examples {
            e.material.notes[0].duration = 8;
            e.material.notes[0]
                .pitch_envelope
                .as_mut()
                .unwrap()
                .last_mut()
                .unwrap()
                .tick = 8;
            e.material.notes[0]
                .gain_envelope
                .as_mut()
                .unwrap()
                .last_mut()
                .unwrap()
                .tick = 8;
        }
        let result =
            infer_paired_pitch(&examples, &correspond(2), &PairedPitchOptions::default()).unwrap();
        let event = path(
            "domain",
            PitchAnchor::Event { index: 0 },
            PitchAnchor::Event { index: 0 },
            1,
        );
        let event_bindings = result
            .bindings_for(&choices(&result, &[direct(1), event]))
            .unwrap();
        let value_bindings = result
            .bindings_for(&choices(&result, &[direct(1), next(1)]))
            .unwrap();
        for side in 0..2 {
            assert_eq!(
                pitches(&compile(&plan(
                    &result.materials[side],
                    &examples[side],
                    event_bindings.clone()
                ))),
                pitches(&compile(&plan(
                    &result.materials[side],
                    &examples[side],
                    value_bindings.clone()
                )))
            );
        }
        let mut event_plan = plan(&result.materials[0], &examples[0], event_bindings);
        let mut value_plan = plan(&result.materials[0], &examples[0], value_bindings);
        for p in [&mut event_plan, &mut value_plan] {
            p.placements[0].pitch_bindings.as_mut().unwrap()[0] = direct(2);
        }
        assert_eq!(pitches(&compile(&event_plan)), [6_700_000, 6_900_000]);
        assert_eq!(pitches(&compile(&value_plan)), [6_700_000, 6_500_000]);
    }

    #[test]
    fn exact_touch_passing_and_return_paths_require_direct_selected_endpoints() {
        let examples = [example(&[64, 65, 67], false), example(&[63, 65, 67], true)];
        let result =
            infer_paired_pitch(&examples, &correspond(3), &PairedPitchOptions::default()).unwrap();
        let passing = path(
            "domain",
            PitchAnchor::Event { index: 0 },
            PitchAnchor::Event { index: 2 },
            0,
        );
        let bindings = result
            .bindings_for(&choices(&result, &[direct(1), passing, direct(2)]))
            .unwrap();
        for side in 0..2 {
            exact_observations(
                &compile(&plan(
                    &result.materials[side],
                    &examples[side],
                    bindings.clone(),
                )),
                &examples[side].material,
                &[0, 1, 2],
            );
        }
        // A later edit producing a half-degree midpoint rejects rather than rounds.
        let mut edit = plan(&result.materials[0], &examples[0], bindings);
        edit.harmonies.as_mut().unwrap()[0].intervals[2] = 500_000;
        assert!(compile_composition(&edit, &CompositionLimits::default()).is_err());
        let returns = [example(&[64, 65, 64], false), example(&[63, 65, 63], true)];
        let r =
            infer_paired_pitch(&returns, &correspond(3), &PairedPitchOptions::default()).unwrap();
        assert!(r.candidates[1].iter().any(|c| c.binding
            == path(
                "domain",
                PitchAnchor::Event { index: 0 },
                PitchAnchor::Event { index: 2 },
                1
            )));
        // A common literal endpoint is not silently treated as a discovered
        // direct harmonic anchor even when it currently has the same value.
        let repeated = [example(&[60, 62, 64], false), example(&[60, 62, 64], false)];
        let r =
            infer_paired_pitch(&repeated, &correspond(3), &PairedPitchOptions::default()).unwrap();
        // Exhaust the small factorized product independently: every compatible
        // combination compiles both full observations, not merely its child.
        for a in 0..r.candidates[0].len() {
            for b in 0..r.candidates[1].len() {
                for c in 0..r.candidates[2].len() {
                    if let Ok(bindings) = r.bindings_for(&[a, b, c]) {
                        for side in 0..2 {
                            exact_observations(
                                &compile(&plan(
                                    &r.materials[side],
                                    &repeated[side],
                                    bindings.clone(),
                                )),
                                &repeated[side].material,
                                &[0, 1, 2],
                            );
                        }
                    }
                }
            }
        }
        let passing = path(
            "domain",
            PitchAnchor::Event { index: 0 },
            PitchAnchor::Event { index: 2 },
            0,
        );
        let pick = choices(
            &r,
            &[
                PitchBinding::Literal {
                    millicents: 6_000_000,
                },
                passing,
                direct(1),
            ],
        );
        assert!(r.bindings_for(&pick).is_err());
    }

    #[test]
    fn correspondence_not_ids_or_parts_controls_alignment_and_every_emission_survives() {
        let mut examples = [example(&[60, 65, 69], false), example(&[60, 65, 68], true)];
        examples[1].material.notes.reverse();
        for (i, note) in examples[1].material.notes.iter_mut().enumerate() {
            note.id = format!("unrelated-id-{i}");
            note.part = "repartitioned".into();
        }
        let map = [[0, 2], [1, 1], [2, 0]];
        let result = infer_paired_pitch(&examples, &map, &PairedPitchOptions::default()).unwrap();
        let bindings = result
            .bindings_for(&choices(&result, &[direct(0), next(1), next(2)]))
            .unwrap();
        exact_observations(
            &compile(&plan(&result.materials[1], &examples[1], bindings)),
            &examples[1].material,
            &[2, 1, 0],
        );
        assert_eq!(result.correspondence, map);
    }

    #[test]
    fn aliases_stay_distinct_missing_shared_expression_is_not_a_per_example_copy() {
        let mut examples = [example(&[60], false), example(&[60], false)];
        for e in &mut examples {
            let mut alias = e.harmonies[0].clone();
            alias.id = "independent".into();
            e.harmonies.push(alias);
        }
        let r =
            infer_paired_pitch(&examples, &correspond(1), &PairedPitchOptions::default()).unwrap();
        assert_eq!(
            r.candidates[0]
                .iter()
                .filter(|c| matches!(c.binding, PitchBinding::Harmony { .. }))
                .count(),
            2
        );
        let independent = PitchBinding::Harmony {
            harmony: "independent".into(),
            tone: 0,
            octave: 0,
            residual_millicents: 0,
        };
        let mut a = plan(
            &r.materials[0],
            &examples[0],
            r.bindings_for(&choices(&r, &[direct(0)])).unwrap(),
        );
        let mut b = plan(
            &r.materials[0],
            &examples[0],
            r.bindings_for(&choices(&r, &[independent])).unwrap(),
        );
        for p in [&mut a, &mut b] {
            p.harmonies.as_mut().unwrap()[0].root_millicents += 100_000;
        }
        assert_eq!(pitches(&compile(&a)), [6_100_000]);
        assert_eq!(pitches(&compile(&b)), [6_000_000]);
        let absent = [example(&[61], false), example(&[66], true)];
        let r =
            infer_paired_pitch(&absent, &correspond(1), &PairedPitchOptions::default()).unwrap();
        assert!(r.candidates[0].is_empty());
        assert!(r.bindings_for(&[0]).is_err());
    }

    #[test]
    fn invalid_inputs_and_exact_work_storage_bounds_fail_without_partial_results() {
        let examples = [example(&[60, 65, 69], false), example(&[60, 65, 68], true)];
        let defaults = PairedPitchOptions::default();
        let full = infer_paired_pitch(&examples, &correspond(3), &defaults).unwrap();
        let exact = PairedPitchOptions {
            max_candidate_checks: full.work.candidate_checks,
            max_candidates: full.work.candidates,
            ..defaults.clone()
        };
        assert!(infer_paired_pitch(&examples, &correspond(3), &exact).is_ok());
        for options in [
            PairedPitchOptions {
                max_candidate_checks: exact.max_candidate_checks - 1,
                ..exact.clone()
            },
            PairedPitchOptions {
                max_candidates: exact.max_candidates - 1,
                ..exact.clone()
            },
            PairedPitchOptions {
                max_context_members: 1,
                ..exact.clone()
            },
        ] {
            assert!(
                infer_paired_pitch(&examples, &correspond(3), &options)
                    .unwrap_err()
                    .to_string()
                    .contains("budget")
            );
        }
        assert!(infer_paired_pitch(&examples, &[[0, 0], [0, 1], [2, 2]], &defaults).is_err());
        assert!(infer_paired_pitch(&examples, &[[0, 0], [1, 1]], &defaults).is_err());
        assert!(full.bindings_for(&[]).is_err());
        let mut invalid = [example(&[60], false), example(&[60], true)];
        invalid[1].lattices[0].id = "not-corresponding".into();
        assert!(infer_paired_pitch(&invalid, &correspond(1), &defaults).is_err());
        invalid[1].lattices[0].id = "domain".into();
        invalid[1].lattices[0].intervals[1] = 0;
        assert!(infer_paired_pitch(&invalid, &correspond(1), &defaults).is_err());
        invalid[1] = example(&[60], true);
        invalid[0].material.notes[0].pitch.millicents = i64::MIN;
        assert!(infer_paired_pitch(&invalid, &correspond(1), &defaults).is_err());
    }

    #[test]
    fn compiler_tail_and_instant_semantics_survive_while_unsafe_relative_curves_reject() {
        let mut examples = [example(&[60], false), example(&[60], true)];
        for e in &mut examples {
            e.material.span = 2;
        }
        let r =
            infer_paired_pitch(&examples, &correspond(1), &PairedPitchOptions::default()).unwrap();
        let bindings = r.bindings_for(&choices(&r, &[direct(0)])).unwrap();
        let score = compile(&plan(&r.materials[0], &examples[0], bindings));
        assert_eq!(score.duration, 4);
        assert_eq!(score.notes[0].duration, 4);
        for e in &mut examples {
            e.material.span = 0;
            let note = &mut e.material.notes[0];
            note.duration = 0;
            note.pitch_envelope = None;
            note.gain_envelope = None;
        }
        let r =
            infer_paired_pitch(&examples, &correspond(1), &PairedPitchOptions::default()).unwrap();
        let bindings = r.bindings_for(&choices(&r, &[direct(0)])).unwrap();
        let score = compile(&plan(&r.materials[0], &examples[0], bindings));
        assert_eq!(score.notes.len(), 1);
        assert_eq!(score.duration, 0);
        examples[0] = example(&[60], false);
        let note = &mut examples[0].material.notes[0];
        note.pitch.millicents = -(MAX_SAFE as i64);
        note.pitch_envelope = Some(vec![
            PitchEnvelopePoint {
                tick: 0,
                pitch: note.pitch,
            },
            PitchEnvelopePoint {
                tick: 4,
                pitch: Pitch {
                    millicents: MAX_SAFE as i64,
                },
            },
        ]);
        assert!(
            infer_paired_pitch(&examples, &correspond(1), &PairedPitchOptions::default())
                .unwrap_err()
                .to_string()
                .contains("Transposed pitch")
        );
    }
}
