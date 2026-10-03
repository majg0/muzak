use super::*;
use crate::scene::{change_scene_harmony, decode_scene, scene_from_program, SceneOrigin};
use std::collections::BTreeMap;

fn rendered(plan: &CompositionPlan) -> Score {
    compile_composition(plan, &CompositionLimits::default()).unwrap()
}

// Authored IDs identify anchors independently of the emitted event order or
// density-dependent material interning. Duration is articulation, not onset.
fn anchors(plan: &CompositionPlan) -> BTreeMap<(usize, u64, String), (u64, i64)> {
    let mut result = BTreeMap::new();
    for (phrase, definition) in plan.definitions.as_ref().unwrap().iter().enumerate() {
        for placement in &definition.placements {
            let material = plan.materials.iter().find(|m| m.id == placement.material).unwrap();
            if !material.notes.iter().any(|n| n.id.starts_with("anchor-")) { continue; }
            let pitches = resolve_material_pitches(&material.notes, placement.pitch_bindings.as_ref().unwrap(),
                plan.harmonies.as_ref().unwrap(), plan.pitch_lattices.as_ref().unwrap()).unwrap();
            for (index, note) in material.notes.iter().enumerate().filter(|(_, n)| n.id.starts_with("anchor-")) {
                result.insert((phrase, placement.onset, note.id.clone()), (note.onset, pitches[index]));
            }
        }
    }
    result
}

#[test]
fn seed_and_density_preserve_theme_and_route_while_arranging_its_attacks() {
    let mut seed_renderings = vec![];
    for seed in [1, 19, 41] {
        for beats in [3, 5] {
            let low = GeneratorOptions { seed, beats_per_bar: beats, phrases: 2, bars_per_phrase: 3,
                density: 0., ..Default::default() };
            let high = GeneratorOptions { density: 1., ..low.clone() };
            let a = generate_plan(&low).unwrap();
            let b = generate_plan(&high).unwrap();
            assert_eq!(serde_json::to_value(&a).unwrap(), serde_json::to_value(generate_plan(&low).unwrap()).unwrap());
            assert_eq!(serde_json::to_value(&a.harmonies).unwrap(), serde_json::to_value(&b.harmonies).unwrap());
            assert_eq!(anchors(&a), anchors(&b));
            assert!(rendered(&b).notes.len() > rendered(&a).notes.len());
            assert!(b.definitions.as_ref().unwrap().iter().flat_map(|d| &d.placements)
                .flat_map(|p| p.pitch_bindings.iter().flatten()).any(|b| matches!(b, PitchBinding::LatticePath { .. })));
            if beats == 3 { seed_renderings.push(anchors(&a)); }
        }
    }
    assert!(seed_renderings.windows(2).all(|pair| pair[0] != pair[1]));
}

#[test]
fn mode_meter_and_phrase_ending_are_audible_program_choices() {
    for (beats, mode, expected_intervals) in [
        (3, GeneratorMode::Major, [0,2,4,5,7,9,11]),
        (5, GeneratorMode::Minor, [0,2,3,5,7,8,10]),
    ] {
        let options = GeneratorOptions { seed: 19, phrases: 2, bars_per_phrase: 3,
            beats_per_bar: beats, mode, density: 1., tonic: 0, ..Default::default() };
        let plan = generate_plan(&options).unwrap();
        let score = rendered(&plan);
        assert_eq!(plan.pitch_lattices.as_ref().unwrap()[0].intervals, expected_intervals.map(|p| p*100_000));
        let bar = score.ppq * u64::from(beats);
        let phrase = bar * u64::from(options.bars_per_phrase);
        assert_eq!(score.duration, phrase * u64::from(options.phrases));
        assert!(score.attachments.iter().any(|a| a.bytes == [255,88,4,beats as u8,2,24,8]));
        // This two-phrase form opens on the modal fifth, then answers on tonic.
        for (end, expected_pc) in [(phrase, 700_000), (2*phrase, 0)] {
            let last_melody = score.notes.iter().filter(|n| n.part == "melody" && n.onset < end && n.onset >= end-bar)
                .max_by_key(|n| n.onset).unwrap();
            let bass = score.notes.iter().find(|n| n.part == "bass" && n.onset == end-bar).unwrap();
            assert_eq!(last_melody.pitch.millicents.rem_euclid(1_200_000), expected_pc);
            assert_eq!(bass.pitch.millicents.rem_euclid(1_200_000), expected_pc);
            assert!(bass.onset + bass.duration > last_melody.onset, "The phrase destination overlaps its bass support.");
            assert_eq!(bass.onset + bass.duration, last_melody.onset + last_melody.duration);
            assert!(score.notes.iter().filter(|n| n.onset < end && n.onset >= end-bar).all(|n| n.onset+n.duration < end),
                "Every part leaves a real phrase-ending breath.");
        }
        let other_mode = generate_plan(&GeneratorOptions { mode: if beats == 3 { GeneratorMode::Minor } else { GeneratorMode::Major }, ..options }).unwrap();
        assert_ne!(anchors(&plan), anchors(&other_mode));
    }
}

#[test]
fn generated_passing_event_remains_a_live_dependency_after_authored_scene_edit() {
    let plan = generate_plan(&GeneratorOptions { seed: 1, phrases: 1, bars_per_phrase: 3,
        beats_per_bar: 4, density: 1., color: 0., ..Default::default() }).unwrap();
    let source = rendered(&plan);
    let scene = scene_from_program(&plan).unwrap();
    assert_eq!(scene.origin, SceneOrigin::Authored);
    assert_eq!(decode_scene(&scene).unwrap(), source);
    let definition = &plan.definitions.as_ref().unwrap()[0];
    // Select by the generated executable relation, not a assumed note index.
    let (leaf, placement, dependent, from_index, to_index, tone, harmony) = definition.placements.iter().enumerate()
        .filter_map(|(leaf, p)| p.pitch_bindings.as_ref().map(|b| (leaf,p,b)))
        .find_map(|(leaf,p,bindings)| bindings.iter().enumerate().find_map(|(index,b)| {
            let PitchBinding::LatticePath { from: PitchAnchor::Event {index:from}, to: PitchAnchor::Event {index:to}, .. } = b else { return None; };
            let (PitchBinding::Harmony {harmony:a,tone,..}, PitchBinding::Harmony {harmony:b,..}) = (&bindings[*from],&bindings[*to]) else { return None; };
            (a == b).then_some((leaf,p,index,*from,*to,*tone,a.as_str()))
        })).expect("A dense cadence has a passing event between two harmonic anchors.");
    let material = plan.materials.iter().find(|m| m.id == placement.material).unwrap();
    let id = |index| format!("placement-0.{leaf}:{}:{index}", material.id);
    let before = |index| source.notes.iter().find(|n| n.id == id(index)).unwrap().pitch.millicents;
    let domain = &plan.pitch_lattices.as_ref().unwrap()[0];
    let degree = |pitch| pitch_lattice_degree(pitch, domain).unwrap().unwrap();
    let raised = pitch_lattice_pitch(degree(before(from_index)) + 2, domain, 0).unwrap();
    let frame = plan.harmonies.as_ref().unwrap().iter().find(|h| h.id == harmony).unwrap();
    let mut intervals = frame.intervals.clone(); intervals[tone] += raised - before(from_index);
    let edited = change_scene_harmony(&scene, harmony, frame.root_millicents, Some(&intervals)).unwrap();
    let output = decode_scene(&edited).unwrap();
    let after = |index| output.notes.iter().find(|n| n.id == id(index)).unwrap().pitch.millicents;
    let expected = pitch_lattice_pitch((degree(after(from_index)) + degree(after(to_index))) / 2, domain, 0).unwrap();
    assert_eq!(after(dependent), expected);
    assert_ne!(after(dependent), before(dependent));
    let unrelated_start = placement.onset;
    let unrelated_end = unrelated_start + material.span;
    for note in source.notes.iter().filter(|n| n.onset < unrelated_start || n.onset >= unrelated_end) {
        assert_eq!(output.notes.iter().find(|n| n.id == note.id).unwrap(), note);
    }
    for (a,b) in output.notes.iter().zip(&source.notes) {
        assert_eq!((&a.id,&a.part,a.onset,a.duration,a.velocity,a.release_velocity,&a.gain_envelope),
            (&b.id,&b.part,b.onset,b.duration,b.velocity,b.release_velocity,&b.gain_envelope));
    }
    let mut literal = plan.clone();
    literal.definitions.as_mut().unwrap()[0].placements[leaf].pitch_bindings.as_mut().unwrap()[dependent]
        = PitchBinding::Literal { millicents: before(dependent) };
    let ablated = scene_from_program(&literal).unwrap();
    let ablated = change_scene_harmony(&ablated, harmony, frame.root_millicents, Some(&intervals)).unwrap();
    assert_eq!(decode_scene(&ablated).unwrap().notes.iter().find(|n| n.id == id(dependent)).unwrap().pitch.millicents, before(dependent),
        "An exact literal reconstruction does not retain the generated edit dependency.");
}
