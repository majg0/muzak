//! A finite twelve-tone adapter over the general connection kernel. The original
//! generated sequence remains the authored anchor sequence. Inserted sonorities
//! are audition alternatives, never retroactively inferred passing harmonies.
use super::*;
use crate::harmonic_connection::{HarmonicConnectionAnalysis, HarmonicConnectionOptions};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionConnectionStep {
    pub chord: ProgressionChord,
    pub voiced_name: String,
    pub voiced_midi: Vec<i32>,
    pub voiced_tone_names: Vec<String>,
    /// None identifies a searched surface insertion, not an original anchor.
    pub anchor_index: Option<usize>,
    pub duration: MotionDuration,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionConnectionPreview {
    pub intermediate_count: u8,
    pub steps: Vec<ProgressionConnectionStep>,
    pub plan: CompositionPlan,
    pub motion_options: HarmonicMotionOptions,
    pub explanation: String,
    pub lines: crate::harmonic_lines::HarmonicLinesAnalysis,
    pub line_plans: Vec<CompositionPlan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionConnectionResult {
    pub from_index: usize,
    pub anchor_chord_ids: Vec<String>,
    pub analysis: HarmonicConnectionAnalysis,
    pub previews: Vec<ProgressionConnectionPreview>,
}

pub fn connect(
    options: &ProgressionOptions,
    chord_ids: &[String],
    from_index: usize,
    max_intermediates: u8,
    supplied_weights: Option<&ConnectionWeights>,
) -> CoreResult<ProgressionConnectionResult> {
    if from_index >= usize::from(options.length).saturating_sub(1) || max_intermediates > 3 {
        return Err(invalid(
            "Choose an adjacent progression edge and zero to three intermediate chords.",
        ));
    }
    // Validation of the original sequence includes all of its authored directed
    // dependencies. Surface insertions do not rewrite or claim to recover them.
    let source = generate(options, Some(chord_ids))?;
    let from = &source.steps[from_index];
    let to = &source.steps[from_index + 1];
    let weights = supplied_weights
        .cloned()
        .unwrap_or_else(harmonic_connection::default_weights);
    let mut states = vec![
        motion_chord(&from.chord, &from.voiced_midi, "fixed-source".into()),
        motion_chord(&to.chord, &to.voiced_midi, "fixed-destination".into()),
    ];
    let mut definitions = BTreeMap::<String, (ProgressionChord, Vec<i32>)>::new();
    let mut inventory = catalog::connection_chords(&source.catalog);
    inventory.extend(
        source
            .catalog
            .chords
            .iter()
            .filter(|chord| chord.operator == "diatonic" && chord.intervals.len() == 4)
            .cloned(),
    );
    // Exactly 48 rooted triads and seven collection sevenths. Each contributes
    // up to two endpoint-ranked bass alternatives. Candidate retention uses the
    // default movement weights; custom search weights rescore that fixed set.
    // This is
    // an explicit bounded proposal region, not exhaustive voicing discovery.
    for chord in inventory {
        for (index, pitches) in voicing::connection_candidates(
            chord.root_pitch_class,
            &chord.intervals,
            &from.voiced_midi,
            &to.voiced_midi,
        )
        .into_iter()
        .take(2)
        .enumerate()
        {
            let lower = from.voiced_midi.len().min(to.voiced_midi.len());
            let upper = from.voiced_midi.len().max(to.voiced_midi.len());
            if !(lower..=upper).contains(&pitches.len()) {
                return Err(invalid(
                    "A connection proposal changed cardinality outside its endpoint range.",
                ));
            }
            let id = format!("candidate-{}-{index}", chord.id);
            states.push(motion_chord(&chord, &pitches, id.clone()));
            definitions.insert(id, (chord.clone(), pitches));
        }
    }
    let analysis = harmonic_connection::analyze(&HarmonicConnectionOptions {
        chords: states,
        from_chord_id: "fixed-source".into(),
        to_chord_id: "fixed-destination".into(),
        intermediate_chord_ids: Some(definitions.keys().cloned().collect()),
        period_millicents: Some(1_200_000),
        context: Some(connection_context(&source.catalog)),
        geometry: ConnectionGeometry::Registered,
        weights: weights.clone(),
        source_duration: MotionDuration {
            numerator: 4,
            denominator: 1,
        },
        destination_duration: MotionDuration {
            numerator: 4,
            denominator: 1,
        },
        max_intermediates,
    })?;
    let mut previews = Vec::new();
    for route in &analysis.routes {
        let mut motion_options = source.motion_options.clone();
        motion_options.history.clear();
        let mut steps = Vec::new();
        for anchor in &source.steps {
            let duration = MotionDuration {
                numerator: 4,
                denominator: if anchor.index == from_index {
                    u16::from(route.intermediate_count) + 1
                } else {
                    1
                },
            };
            motion_options.history.push(MotionStep {
                chord_id: format!("progression-{}", anchor.index),
                duration: duration.clone(),
            });
            steps.push(ProgressionConnectionStep {
                chord: anchor.chord.clone(),
                voiced_name: anchor.voiced_name.clone(),
                voiced_midi: anchor.voiced_midi.clone(),
                voiced_tone_names: anchor.voiced_tone_names.clone(),
                anchor_index: Some(anchor.index),
                duration,
            });
            if anchor.index == from_index {
                for (insertion, id) in route
                    .chord_ids
                    .iter()
                    .skip(1)
                    .take(usize::from(route.intermediate_count))
                    .enumerate()
                {
                    let (chord, pitches) = definitions.get(id).ok_or_else(|| {
                        invalid("Connection route referenced an unadmitted surface chord.")
                    })?;
                    let realization_id = format!("inserted-{insertion}");
                    let duration = MotionDuration {
                        numerator: 4,
                        denominator: u16::from(route.intermediate_count) + 1,
                    };
                    motion_options.chords.push(motion_chord(
                        chord,
                        pitches,
                        realization_id.clone(),
                    ));
                    motion_options.history.push(MotionStep {
                        chord_id: realization_id,
                        duration: duration.clone(),
                    });
                    steps.push(ProgressionConnectionStep {
                        chord: chord.clone(),
                        voiced_name: voiced_name(chord, pitches),
                        voiced_midi: pitches.clone(),
                        voiced_tone_names: voiced_names(chord, pitches),
                        anchor_index: None,
                        duration,
                    });
                }
            }
        }
        let plan = harmonic_motion::realize(&motion_options)?;
        let lines = crate::harmonic_lines::analyze_with_continuity(
            &motion_options.chords,
            &motion_options.history,
            &weights,
            options.line_continuity,
        )?;
        let line_plans = solo_line_plans(&plan, &lines)?;
        previews.push(ProgressionConnectionPreview {
            intermediate_count: route.intermediate_count, steps, plan, motion_options, lines, line_plans,
            explanation: format!("{} authored surface insertion(s) share the source chord's four-quarter bar. The destination and every later anchor keep their original onset; all anchors keep their exact pitches. Original directed relationships still describe the anchor sequence. The inserted chords are searched audition choices, not inferred passing chords. Optimality is confined to 48 rooted triads, seven native sevenths and up to two endpoint-conditioned bass alternatives per chord, retained using default movement weights. Intermediate note counts stay within the two endpoint counts, so equal-cardinality endpoints cannot become cheaper by dropping voices. Custom weights rescore this fixed finite set. Connection search minimizes the declared adjacent-edge and duration costs; whole-line contours are reported and auditionable, but are not an additional globally optimized counterpoint objective in this route search.", route.intermediate_count),
        });
    }
    Ok(ProgressionConnectionResult {
        from_index,
        anchor_chord_ids: chord_ids.to_vec(),
        analysis,
        previews,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composition::{CompositionLimits, compile_composition};

    #[test]
    fn connections_preserve_anchor_notes_and_destination_time_through_one_compiler() {
        let options = ProgressionOptions {
            length: 4,
            ..catalog::default_options()
        };
        let ids = ["scale-0-3", "dominant-4", "scale-4-3", "scale-0-3"].map(String::from);
        let original = generate(&options, Some(&ids)).unwrap();
        let connected = connect(&options, &ids, 1, 3, None).unwrap();
        assert_eq!(connected.analysis.state_count, 112);
        assert_eq!(connected.previews.len(), 4);
        for preview in connected.previews {
            let score = compile_composition(&preview.plan, &CompositionLimits::default()).unwrap();
            assert_eq!(score.duration, score.ppq * 16);
            for step in &preview.steps {
                if let Some(index) = step.anchor_index {
                    assert_eq!(step.voiced_midi, original.steps[index].voiced_midi);
                    let mut emitted = score
                        .notes
                        .iter()
                        .filter(|note| note.onset == index as u64 * score.ppq * 4)
                        .map(|note| note.pitch.millicents)
                        .collect::<Vec<_>>();
                    emitted.sort_unstable();
                    assert_eq!(
                        emitted,
                        step.voiced_midi
                            .iter()
                            .map(|&pitch| i64::from(pitch) * 100_000)
                            .collect::<Vec<_>>()
                    );
                } else {
                    assert!(step.chord.resolution_degree.is_none());
                    assert_eq!(step.voiced_midi.len(), original.steps[1].voiced_midi.len());
                }
            }
            assert_eq!(
                preview
                    .steps
                    .iter()
                    .filter(|step| step.anchor_index.is_none())
                    .count(),
                usize::from(preview.intermediate_count)
            );
            if preview.intermediate_count == 0 {
                assert_eq!(
                    serde_json::to_value(&preview.plan).unwrap(),
                    serde_json::to_value(&original.plan).unwrap()
                );
            }
        }
        assert!(connect(&options, &ids, usize::MAX, 3, None).is_err());
        assert!(connect(&options, &ids, 1, 4, None).is_err());
    }
}
