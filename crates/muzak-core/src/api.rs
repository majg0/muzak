use crate::composition;
use crate::harmony;
use crate::structure;
use crate::{boundary, comparison, evaluation, operations as ops};
use crate::{
    error::{CoreError, CoreResult},
    midi,
    model::*,
};
use crate::{harmonic, meter, performance as perf};
use crate::{partition, scene};
use crate::pitch_relations;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "op",
    content = "input",
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CoreRequest {
    GetPatternLabDefaults {},
    GeneratePatternLab { options: crate::pattern_lab::PatternLabOptions },
    GetProgressionDefaults {},
    ConnectProgression {
        options: crate::progression::ProgressionOptions,
        chord_ids: Vec<String>,
        from_index: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        max_intermediates: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        weights: Option<crate::harmonic_connection::ConnectionWeights>,
    },
    AnalyzeHarmonicConnection { options: crate::harmonic_connection::HarmonicConnectionOptions },
    GenerateProgression {
        options: crate::progression::ProgressionOptions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        chord_ids: Option<Vec<String>>,
    },
    AnalyzeHarmonicMotion { options: crate::harmonic_motion::HarmonicMotionOptions },
    RealizeHarmonicMotion { options: crate::harmonic_motion::HarmonicMotionOptions },
    GetLabDefaults {},
    GenerateMelodyLab {
        #[serde(default)]
        #[ts(optional, type = "Partial<import('./MelodyLabOptions').MelodyLabOptions>")]
        options: crate::labs::MelodyLabOptions,
    },
    GenerateRhythmLab {
        #[serde(default)]
        #[ts(optional, type = "Partial<import('./RhythmLabOptions').RhythmLabOptions>")]
        options: crate::labs::RhythmLabOptions,
    },
    GenerateComposition {
        #[serde(default)]
        #[ts(optional, type = "Partial<import('./GeneratorOptions').GeneratorOptions>")]
        options: crate::generator::GeneratorOptions,
    },
    InferPitchRelations {
        material: composition::ScoreMaterial,
        bindings: Vec<composition::PitchBinding>,
        harmonies: Vec<composition::CompositionHarmony>,
        domains: Vec<pitch_relations::PitchRelationDomain>,
        anchor_indices: Vec<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "Partial<import('./PitchRelationOptions').PitchRelationOptions>")]
        options: Option<pitch_relations::PitchRelationOptions>,
    },
    ObservedPitchDomain {
        score: Score,
        id: String,
        period_millicents: i64,
        origin_millicents: i64,
        max_classes: usize,
    },
    ScoreMeter {
        score: Score,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<meter::ScoreMeterOptions>,
    },
    InferGlobalHarmony {
        score: Score,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "Partial<import('./HarmonyOptions').HarmonyOptions>")]
        options: Option<harmony::HarmonyOptions>,
    },
    ChangeSceneHarmony {
        scene: scene::MusicalScene,
        window_id: String,
        root_millicents: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        core_intervals: Option<Vec<i64>>,
    },
    EncodeScore {
        score: Score,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<scene::SceneOptions>,
    },
    DecodeScene {
        scene: scene::MusicalScene,
    },
    SceneFromComposition {
        plan: composition::CompositionPlan,
    },
    TransposeScene {
        scene: scene::MusicalScene,
        scope: scene::SceneEditScope,
        target: String,
        millicents: i64,
    },
    ValidateScore {
        score: Score,
    },
    ValidateNoteTrajectories {
        note: ScoreNote,
    },
    SelectNotes {
        score: Score,
        #[serde(default)]
        selection: ScoreSelection,
    },
    ReadMidi {
        bytes: Vec<u8>,
    },
    WriteMidi {
        file: midi::MidiFile,
    },
    MidiPayload {
        bytes: Vec<u8>,
    },
    MidiMeta {
        kind: u8,
        payload: Vec<u8>,
    },
    ImportMidi {
        bytes: Vec<u8>,
    },
    ExportScoreMidi {
        score: Score,
    },
    CompareScores {
        a: Score,
        b: Score,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<comparison::ScoreComparisonOptions>,
    },
    BoundaryEvidence {
        score: Score,
        selection: boundary::BoundarySelection,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<boundary::BoundaryEvidenceOptions>,
    },
    EvaluateBoundaries {
        estimated: Vec<f64>,
        references: Vec<evaluation::BoundaryReference>,
        options: evaluation::BoundaryOptions,
    },
    EvaluateOccurrences {
        estimated: Vec<evaluation::Occurrence>,
        references: Vec<evaluation::OccurrenceReference>,
    },
    SliceScore {
        score: Score,
        start: u64,
        end: u64,
        options: ops::SliceOptions,
    },
    TransposeScore {
        score: Score,
        millicents: i64,
        #[serde(default)]
        selection: ScoreSelection,
    },
    StretchScore {
        score: Score,
        numerator: u64,
        denominator: u64,
    },
    PitchAt {
        note: ScoreNote,
        offset: f64,
    },
    GainAt {
        note: ScoreNote,
        offset: f64,
    },
    TransposeNote {
        note: ScoreNote,
        millicents: i64,
    },
    CropNoteTrajectories {
        note: ScoreNote,
        offset: u64,
        duration: u64,
    },
    NoteTimes {
        note: ScoreNote,
    },
    CompileComposition {
        plan: composition::CompositionPlan,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        limits: Option<composition::CompositionLimits>,
    },
    CompilePerformance {
        score: Score,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<perf::PerformanceOptions>,
    },
    TempoMap {
        score: Score,
    },
    TickToSeconds {
        tick: f64,
        ppq: u64,
        tempos: Vec<perf::TempoPoint>,
    },
    SecondsToTick {
        seconds: f64,
        ppq: u64,
        tempos: Vec<perf::TempoPoint>,
    },
    InferHarmonicRegions {
        score: Score,
        selection: ScoreSelection,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<harmonic::HarmonicRegionOptions>,
    },
    HarmonicStructureRegions {
        analysis: harmonic::HarmonicRegionAnalysis,
        #[serde(default)]
        namespace: String,
    },
    InferWeightedPartition {
        score: Score,
        selection: ScoreSelection,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(
            optional,
            type = "Partial<Omit<import('./PartitionOptions').PartitionOptions, 'features' | 'noteWeights' | 'content'>> & { features?: Partial<import('./FeatureWeights').FeatureWeights>; noteWeights?: Partial<import('./NoteWeights').NoteWeights>; content?: Partial<import('./ContentProjection').ContentProjection> }"
        )]
        options: Option<partition::PartitionOptions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        harmonic: Option<harmonic::HarmonicRegionAnalysis>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "op", content = "output", rename_all = "camelCase")]
pub enum CoreResponse {
    GetPatternLabDefaults(crate::pattern_lab::PatternLabDefaults),
    GeneratePatternLab(composition::CompositionPlan),
    GetProgressionDefaults(crate::progression::ProgressionDefaults),
    ConnectProgression(crate::progression::ProgressionConnectionResult),
    AnalyzeHarmonicConnection(crate::harmonic_connection::HarmonicConnectionAnalysis),
    GenerateProgression(crate::progression::ProgressionResult),
    AnalyzeHarmonicMotion(crate::harmonic_motion::HarmonicMotionAnalysis),
    RealizeHarmonicMotion(composition::CompositionPlan),
    GetLabDefaults(crate::labs::LabDefaults),
    GenerateMelodyLab(composition::CompositionPlan),
    GenerateRhythmLab(composition::CompositionPlan),
    GenerateComposition(scene::MusicalScene),
    InferPitchRelations(pitch_relations::PitchRelationAnalysis),
    ObservedPitchDomain(Option<pitch_relations::PitchRelationDomain>),
    ScoreMeter(meter::ScoreMeterMap),
    InferGlobalHarmony(harmony::GlobalHarmonyAnalysis),
    ChangeSceneHarmony(scene::MusicalScene),
    EncodeScore(scene::MusicalScene),
    DecodeScene(Score),
    SceneFromComposition(scene::MusicalScene),
    TransposeScene(scene::MusicalScene),
    ValidateScore(()),
    ValidateNoteTrajectories(()),
    SelectNotes(Vec<ScoreNote>),
    ReadMidi(midi::MidiFile),
    WriteMidi(Vec<u8>),
    MidiPayload(Vec<u8>),
    MidiMeta(Vec<u8>),
    ImportMidi(midi::ImportedMidi),
    ExportScoreMidi(Vec<u8>),
    CompareScores(comparison::ScoreComparison),
    BoundaryEvidence(boundary::BoundaryEvidence),
    EvaluateBoundaries(Vec<evaluation::BoundaryEvaluation>),
    EvaluateOccurrences(Vec<evaluation::OccurrenceEvaluation>),
    SliceScore(Score),
    TransposeScore(Score),
    StretchScore(Score),
    PitchAt(f64),
    GainAt(f64),
    TransposeNote(ScoreNote),
    CropNoteTrajectories(ops::CroppedTrajectories),
    NoteTimes(Vec<u64>),
    CompileComposition(Score),
    CompilePerformance(perf::CompiledPerformance),
    TempoMap(Vec<perf::TempoPoint>),
    TickToSeconds(f64),
    SecondsToTick(f64),
    InferHarmonicRegions(harmonic::HarmonicRegionAnalysis),
    HarmonicStructureRegions(Vec<structure::StructureRegionInput>),
    InferWeightedPartition(partition::WeightedPartitionAnalysis),
}
#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum CoreReply {
    Success { response: CoreResponse },
    Failure { error: CoreError },
}

pub fn dispatch(request: CoreRequest) -> CoreResult<CoreResponse> {
    Ok(match request {
        CoreRequest::GetPatternLabDefaults {} => CoreResponse::GetPatternLabDefaults(crate::pattern_lab::defaults()?),
        CoreRequest::GeneratePatternLab { options } => CoreResponse::GeneratePatternLab(crate::pattern_lab::generate(&options)?),
        CoreRequest::GetProgressionDefaults {} => CoreResponse::GetProgressionDefaults(crate::progression::defaults()),
        CoreRequest::ConnectProgression { options, chord_ids, from_index, max_intermediates, weights } => CoreResponse::ConnectProgression(crate::progression::connect(&options, &chord_ids, from_index, max_intermediates.unwrap_or(3), weights.as_ref())?),
        CoreRequest::AnalyzeHarmonicConnection { options } => CoreResponse::AnalyzeHarmonicConnection(crate::harmonic_connection::analyze(&options)?),
        CoreRequest::GenerateProgression { options, chord_ids } => CoreResponse::GenerateProgression(crate::progression::generate(&options, chord_ids.as_deref())?),
        CoreRequest::AnalyzeHarmonicMotion { options } => CoreResponse::AnalyzeHarmonicMotion(crate::harmonic_motion::analyze(&options)?),
        CoreRequest::RealizeHarmonicMotion { options } => CoreResponse::RealizeHarmonicMotion(crate::harmonic_motion::realize(&options)?),
        CoreRequest::GetLabDefaults {} => CoreResponse::GetLabDefaults(crate::labs::LabDefaults::default()),
        CoreRequest::GenerateMelodyLab { options } => CoreResponse::GenerateMelodyLab(crate::labs::generate_melody(&options)?),
        CoreRequest::GenerateRhythmLab { options } => CoreResponse::GenerateRhythmLab(crate::labs::generate_rhythm(&options)?),
        CoreRequest::GenerateComposition { options } => CoreResponse::GenerateComposition(
            scene::scene_from_program(&crate::generator::generate_plan(&options)?)?
        ),
        CoreRequest::InferPitchRelations { material, bindings, harmonies, domains, anchor_indices, options } =>
            CoreResponse::InferPitchRelations(pitch_relations::infer_pitch_relations(
                &material, &bindings, &harmonies, &domains, &anchor_indices, &options.unwrap_or_default())?),
        CoreRequest::ObservedPitchDomain { score, id, period_millicents, origin_millicents, max_classes } =>
            CoreResponse::ObservedPitchDomain(pitch_relations::propose_observed_pitch_domain(
                &score, &id, period_millicents, origin_millicents, max_classes)?),
        CoreRequest::ScoreMeter { score, options } => {
            CoreResponse::ScoreMeter(meter::score_meter(&score, &options.unwrap_or_default())?)
        }
        CoreRequest::InferGlobalHarmony { score, options } => CoreResponse::InferGlobalHarmony(
            harmony::infer_global_harmony(&score, &options.unwrap_or_default())?,
        ),
        CoreRequest::ChangeSceneHarmony {
            scene,
            window_id,
            root_millicents,
            core_intervals,
        } => CoreResponse::ChangeSceneHarmony(scene::change_scene_harmony(
            &scene,
            &window_id,
            root_millicents,
            core_intervals.as_deref(),
        )?),
        CoreRequest::EncodeScore { score, options } => {
            CoreResponse::EncodeScore(scene::encode_score(&score, &options.unwrap_or_default())?)
        }
        CoreRequest::DecodeScene { scene } => {
            CoreResponse::DecodeScene(scene::decode_scene(&scene)?)
        }
        CoreRequest::SceneFromComposition { plan } => {
            CoreResponse::SceneFromComposition(scene::scene_from_program(&plan)?)
        }
        CoreRequest::TransposeScene {
            scene,
            scope,
            target,
            millicents,
        } => CoreResponse::TransposeScene(scene::transpose_scene(
            &scene, scope, &target, millicents,
        )?),
        CoreRequest::ValidateScore { score } => {
            validate_score(&score)?;
            CoreResponse::ValidateScore(())
        }
        CoreRequest::ValidateNoteTrajectories { note } => {
            validate_note_trajectories(&note)?;
            CoreResponse::ValidateNoteTrajectories(())
        }
        CoreRequest::SelectNotes { score, selection } => {
            validate_score(&score)?;
            CoreResponse::SelectNotes(
                select_notes(&score, &selection)?
                    .into_iter()
                    .cloned()
                    .collect(),
            )
        }
        CoreRequest::ReadMidi { bytes } => CoreResponse::ReadMidi(midi::read_midi(&bytes)?),
        CoreRequest::WriteMidi { file } => CoreResponse::WriteMidi(midi::write_midi(&file)?),
        CoreRequest::MidiPayload { bytes } => {
            CoreResponse::MidiPayload(midi::midi_payload(&bytes)?)
        }
        CoreRequest::MidiMeta { kind, payload } => {
            CoreResponse::MidiMeta(midi::midi_meta(kind, &payload)?)
        }
        CoreRequest::ImportMidi { bytes } => CoreResponse::ImportMidi(midi::import_midi(&bytes)?),
        CoreRequest::ExportScoreMidi { score } => {
            CoreResponse::ExportScoreMidi(midi::export_score_midi(&score)?)
        }
        CoreRequest::CompareScores { a, b, options } => CoreResponse::CompareScores(
            comparison::compare_scores(&a, &b, &options.unwrap_or_default())?,
        ),
        CoreRequest::BoundaryEvidence {
            score,
            selection,
            options,
        } => CoreResponse::BoundaryEvidence(boundary::boundary_evidence(
            &score,
            &selection,
            &options.unwrap_or_default(),
        )?),
        CoreRequest::EvaluateBoundaries {
            estimated,
            references,
            options,
        } => CoreResponse::EvaluateBoundaries(evaluation::evaluate_boundaries(
            &estimated,
            &references,
            &options,
        )?),
        CoreRequest::EvaluateOccurrences {
            estimated,
            references,
        } => CoreResponse::EvaluateOccurrences(evaluation::evaluate_occurrences(
            &estimated,
            &references,
        )?),
        CoreRequest::SliceScore {
            score,
            start,
            end,
            options,
        } => CoreResponse::SliceScore(ops::slice_score(&score, start, end, &options)?),
        CoreRequest::TransposeScore {
            score,
            millicents,
            selection,
        } => CoreResponse::TransposeScore(ops::transpose_score(&score, millicents, &selection)?),
        CoreRequest::StretchScore {
            score,
            numerator,
            denominator,
        } => CoreResponse::StretchScore(ops::stretch_score(&score, numerator, denominator)?),
        CoreRequest::PitchAt { note, offset } => {
            validate_note_trajectories(&note)?;
            CoreResponse::PitchAt(ops::pitch_at(&note, offset))
        }
        CoreRequest::GainAt { note, offset } => {
            validate_note_trajectories(&note)?;
            CoreResponse::GainAt(ops::gain_at(&note, offset))
        }
        CoreRequest::TransposeNote { note, millicents } => {
            CoreResponse::TransposeNote(ops::transpose_note(&note, millicents)?)
        }
        CoreRequest::CropNoteTrajectories {
            note,
            offset,
            duration,
        } => {
            validate_note_trajectories(&note)?;
            CoreResponse::CropNoteTrajectories(ops::crop_note_trajectories(
                &note, offset, duration,
            )?)
        }
        CoreRequest::NoteTimes { note } => CoreResponse::NoteTimes(ops::note_times(&note)),
        CoreRequest::CompileComposition { plan, limits } => CoreResponse::CompileComposition(
            composition::compile_composition(&plan, &limits.unwrap_or_default())?,
        ),
        CoreRequest::CompilePerformance { score, options } => CoreResponse::CompilePerformance(
            perf::compile_performance(&score, &options.unwrap_or_default())?,
        ),
        CoreRequest::TempoMap { score } => CoreResponse::TempoMap(perf::tempo_map(&score)?),
        CoreRequest::TickToSeconds { tick, ppq, tempos } => {
            perf::validate_tempo_points(ppq, &tempos)?;
            if !tick.is_finite() || tick < 0.0 || tick > MAX_SAFE as f64 {
                return Err(crate::error::invalid("Invalid continuous tick position."));
            }
            CoreResponse::TickToSeconds(perf::tick_to_seconds(tick, ppq, &tempos))
        }
        CoreRequest::SecondsToTick {
            seconds,
            ppq,
            tempos,
        } => {
            perf::validate_tempo_points(ppq, &tempos)?;
            let tick = perf::seconds_to_tick(seconds, ppq, &tempos);
            if !seconds.is_finite() || seconds < 0.0 || !tick.is_finite() || tick > MAX_SAFE as f64
            {
                return Err(crate::error::invalid("Invalid continuous tempo position."));
            }
            CoreResponse::SecondsToTick(tick)
        }
        CoreRequest::InferHarmonicRegions {
            score,
            selection,
            options,
        } => CoreResponse::InferHarmonicRegions(harmonic::infer_harmonic_regions(
            &score,
            &selection,
            &options.unwrap_or_default(),
        )?),
        CoreRequest::HarmonicStructureRegions {
            analysis,
            namespace,
        } => CoreResponse::HarmonicStructureRegions(harmonic::harmonic_structure_regions(
            &analysis, &namespace,
        )?),
        CoreRequest::InferWeightedPartition {
            score,
            selection,
            options,
            harmonic,
        } => CoreResponse::InferWeightedPartition(partition::infer_weighted_partition(
            &score,
            &selection,
            &options.unwrap_or_default(),
            harmonic.as_ref(),
        )?),
    })
}
pub fn execute_json(input: &str) -> String {
    let result = serde_json::from_str(input)
        .map_err(CoreError::from)
        .and_then(dispatch);
    let reply = match result {
        Ok(response) => CoreReply::Success { response },
        Err(error) => CoreReply::Failure { error },
    };
    serde_json::to_string(&reply).expect("Core replies contain only finite JSON values")
}
