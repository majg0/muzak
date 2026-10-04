//! Spelled, tonic-relative chord collections for the progression experiment.
//! Modes rotate a family while retaining the user's tonic. Melodic minor means
//! the ascending/jazz collection in both directions, not classical inflection.
use crate::error::{CoreResult, invalid};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ProgressionFamily {
    Major,
    HarmonicMinor,
    MelodicMinor,
    HarmonicMajor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ProgressionColor {
    Diatonic,
    Chromatic,
    Adventurous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ProgressionRole {
    Home,
    Departure,
    Preparation,
    Tension,
    Color,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgressionOptions {
    pub tonic: String,
    pub family: ProgressionFamily,
    pub mode: u8,
    pub color: ProgressionColor,
    pub length: u8,
    pub seed: u32,
    pub tempo: f64,
    pub arpeggiate: bool,
    pub line_continuity: f64,
}

impl Default for ProgressionOptions {
    fn default() -> Self {
        default_options()
    }
}

pub fn default_options() -> ProgressionOptions {
    ProgressionOptions {
        tonic: "C".into(),
        family: ProgressionFamily::Major,
        mode: 0,
        color: ProgressionColor::Chromatic,
        length: 8,
        seed: 7,
        tempo: 104.,
        arpeggiate: false,
        line_continuity: crate::harmonic_lines::DEFAULT_CONTINUITY_WEIGHT,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionFamilyChoice {
    pub id: ProgressionFamily,
    pub name: String,
    pub modes: Vec<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionChord {
    pub id: String,
    pub name: String,
    pub roman: String,
    pub global_roman: String,
    pub root_pitch_class: i32,
    /// Zero-based diatonic letter position relative to the selected tonic.
    pub degree: u8,
    /// Chromatic change from the same degree of the tonic's major scale.
    pub root_alteration: i32,
    pub intervals: Vec<i32>,
    pub tone_names: Vec<String>,
    pub role: ProgressionRole,
    pub operator: String,
    pub derivation: String,
    /// An authored directed target, not an inferred function. The route builder
    /// admits a directed chord only before this native major/minor scale chord.
    pub resolution_degree: Option<u8>,
    /// Reference for the native triad core of the target, not the exact successor
    /// ID. Native seventh extensions may realize the same root and complete core.
    pub resolution_chord_id: Option<String>,
    pub resolution_root_pitch_class: Option<i32>,
    pub color_cost: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressionCatalog {
    pub tonic: String,
    pub tonic_pitch_class: i32,
    pub scale_name: String,
    pub scale_tones: Vec<String>,
    pub scale_offsets: Vec<i32>,
    pub degree_names: Vec<String>,
    pub chords: Vec<ProgressionChord>,
}

const MAJOR: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];
const LETTERS: [&str; 7] = ["C", "D", "E", "F", "G", "A", "B"];
const ROMANS: [&str; 7] = ["I", "II", "III", "IV", "V", "VI", "VII"];

pub fn family_choices() -> Vec<ProgressionFamilyChoice> {
    [
        (
            ProgressionFamily::Major,
            "Major / natural modes",
            ["Ionian (major)", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian (natural minor)", "Locrian"],
            "Seven rotations of the major collection; every mode keeps the selected tonic as its center.",
        ),
        (
            ProgressionFamily::HarmonicMinor,
            "Harmonic minor",
            ["Harmonic minor", "Locrian ♮6", "Ionian ♯5", "Dorian ♯4", "Phrygian dominant", "Lydian ♯2", "Ultralocrian (Locrian ♭4 ♭♭7)"],
            "Minor with a raised seventh: a major V, minor-major tonic seventh and fully diminished leading-tone seventh.",
        ),
        (
            ProgressionFamily::MelodicMinor,
            "Melodic minor (jazz / ascending)",
            ["Melodic minor", "Dorian ♭2", "Lydian augmented", "Lydian dominant", "Mixolydian ♭6", "Locrian ♮2", "Altered (Locrian ♭4)"],
            "The ascending melodic-minor collection is used in both directions, as in jazz; classical descending inflection is not implied. The altered mode's ♭4 is enharmonic to a major third.",
        ),
        (
            ProgressionFamily::HarmonicMajor,
            "Harmonic major",
            ["Harmonic major", "Dorian ♭5", "Phrygian ♭4", "Lydian ♭3", "Mixolydian ♭2", "Lydian augmented ♯2", "Locrian ♭♭7"],
            "Major with a lowered sixth: minor iv, half-diminished ii and fully diminished leading-tone seventh.",
        ),
    ]
    .into_iter()
    .map(|(id, name, modes, description)| ProgressionFamilyChoice {
        id,
        name: name.into(),
        modes: modes.into_iter().map(String::from).collect(),
        description: description.into(),
    })
    .collect()
}

fn family_intervals(family: ProgressionFamily) -> [i32; 7] {
    match family {
        ProgressionFamily::Major => MAJOR,
        ProgressionFamily::HarmonicMinor => [0, 2, 3, 5, 7, 8, 11],
        ProgressionFamily::MelodicMinor => [0, 2, 3, 5, 7, 9, 11],
        ProgressionFamily::HarmonicMajor => [0, 2, 4, 5, 7, 8, 11],
    }
}

#[derive(Clone, Copy)]
struct Tonic {
    letter: usize,
    pitch: i32,
}

fn tonic(value: &str) -> CoreResult<Tonic> {
    let normalized = value.trim().replace('♯', "#").replace('♭', "b");
    let mut chars = normalized.chars();
    let letter = match chars.next().map(|c| c.to_ascii_uppercase()) {
        Some('C') => 0,
        Some('D') => 1,
        Some('E') => 2,
        Some('F') => 3,
        Some('G') => 4,
        Some('A') => 5,
        Some('B') => 6,
        _ => {
            return Err(invalid(
                "Progression tonic must be A–G with up to two sharps or flats.",
            ));
        }
    };
    let accidental = chars.collect::<String>();
    let change = match accidental.as_str() {
        "" => 0,
        "#" => 1,
        "##" => 2,
        "b" => -1,
        "bb" => -2,
        _ => {
            return Err(invalid(
                "Progression tonic must be A–G with up to two sharps or flats.",
            ));
        }
    };
    Ok(Tonic {
        letter,
        pitch: MAJOR[letter] + change,
    })
}

fn accidental(change: i32) -> String {
    if change < 0 {
        "♭".repeat((-change) as usize)
    } else {
        "♯".repeat(change as usize)
    }
}

fn spell(letter: usize, absolute_pitch: i32) -> String {
    let natural = MAJOR[letter % 7] + (letter / 7) as i32 * 12;
    format!(
        "{}{}",
        LETTERS[letter % 7],
        accidental(absolute_pitch - natural)
    )
}

fn degree_label(degree: usize, change: i32) -> String {
    format!("{}{}", accidental(change), ROMANS[degree])
}

fn closest_change(actual: i32, natural: i32) -> i32 {
    (actual - natural + 6).rem_euclid(12) - 6
}

/// Intervals are exactly the chosen scale's stacked thirds. A scale family does
/// not decide chord quality by its name or by a hand-maintained degree table.
fn stack(scale: &[i32], degree: usize, count: usize) -> Vec<i32> {
    (0..count)
        .map(|tone| {
            let at = degree + tone * 2;
            scale[at % 7] + (at / 7) as i32 * 12 - scale[degree]
        })
        .collect()
}

fn quality(intervals: &[i32]) -> CoreResult<(&'static str, &'static str, bool)> {
    Ok(match intervals {
        [0, 4, 7] => ("", "", false),
        [0, 3, 7] => ("m", "", true),
        [0, 3, 6] => ("dim", "°", true),
        [0, 4, 8] => ("aug", "+", false),
        [0, 4, 7, 11] => ("maj7", "maj7", false),
        [0, 4, 7, 10] => ("7", "7", false),
        [0, 3, 7, 10] => ("m7", "7", true),
        [0, 3, 7, 11] => ("m(maj7)", "(maj7)", true),
        [0, 3, 6, 10] => ("m7♭5", "ø7", true),
        [0, 3, 6, 9] => ("dim7", "°7", true),
        [0, 4, 8, 11] => ("aug(maj7)", "+(maj7)", false),
        [0, 4, 8, 10] => ("aug7", "+7", false),
        [0, 4, 7, 10, 13] => ("7(♭9)", "7(♭9)", false),
        [0, 4, 7, 10, 15] => ("7(♯9)", "7(♯9)", false),
        [0, 4, 6, 10] => ("7(♭5)", "7(♭5)", false),
        _ => {
            return Err(invalid(format!(
                "Unsupported progression chord intervals: {intervals:?}"
            )));
        }
    })
}

fn native_role(degree: usize, intervals: &[i32], scale: &[i32]) -> ProgressionRole {
    match degree {
        0 => ProgressionRole::Home,
        1 | 3 => ProgressionRole::Preparation,
        4 if intervals[1] == 4 && intervals[2] == 7 => ProgressionRole::Tension,
        6 if scale[6] == 11 && intervals[2] == 6 => ProgressionRole::Tension,
        2 | 4 | 5 => ProgressionRole::Departure,
        _ => ProgressionRole::Color,
    }
}

struct ChordSpec<'a> {
    id: String,
    degree: usize,
    root_offset: i32,
    intervals: Vec<i32>,
    tone_steps: &'a [usize],
    roman: Option<String>,
    role: ProgressionRole,
    operator: &'a str,
    derivation: String,
    resolution_degree: Option<u8>,
    color_cost: u8,
}

fn chord(tonic: Tonic, spec: ChordSpec<'_>) -> CoreResult<ProgressionChord> {
    let root_alteration = closest_change(spec.root_offset, MAJOR[spec.degree]);
    // Retaining the diatonic letter coordinate chooses the intended spelling,
    // including C-flat/F-double-sharp keys and diminished seventh intervals.
    let root_pitch = tonic.pitch + MAJOR[spec.degree] + root_alteration;
    let root_letter = tonic.letter + spec.degree;
    let root_name = spell(root_letter, root_pitch);
    let (name_suffix, roman_suffix, lowercase) = quality(&spec.intervals)?;
    let roman_degree = if lowercase {
        ROMANS[spec.degree].to_lowercase()
    } else {
        ROMANS[spec.degree].into()
    };
    let global_roman = format!(
        "{}{roman_degree}{roman_suffix}",
        accidental(root_alteration)
    );
    let tone_names = spec
        .intervals
        .iter()
        .zip(spec.tone_steps)
        .map(|(interval, letter)| spell(root_letter + letter, root_pitch + interval))
        .collect();
    Ok(ProgressionChord {
        id: spec.id,
        name: format!("{root_name}{name_suffix}"),
        roman: spec.roman.unwrap_or_else(|| global_roman.clone()),
        global_roman,
        root_pitch_class: root_pitch.rem_euclid(12),
        degree: spec.degree as u8,
        root_alteration,
        intervals: spec.intervals,
        tone_names,
        role: spec.role,
        operator: spec.operator.into(),
        derivation: spec.derivation,
        resolution_degree: spec.resolution_degree,
        resolution_chord_id: None,
        resolution_root_pitch_class: None,
        color_cost: spec.color_cost,
    })
}

pub fn catalog(options: &ProgressionOptions) -> CoreResult<ProgressionCatalog> {
    let tonic = tonic(&options.tonic)?;
    if options.mode > 6 {
        return Err(invalid("Progression mode must be 0–6."));
    }
    if !(4..=16).contains(&options.length) {
        return Err(invalid("Progression length must be 4–16 chords."));
    }
    if !options.tempo.is_finite() || !(30.0..=240.0).contains(&options.tempo) {
        return Err(invalid("Progression tempo must be 30–240 BPM."));
    }
    let family = family_intervals(options.family);
    let mode = usize::from(options.mode);
    let scale: Vec<i32> = (0..7)
        .map(|degree| (family[(mode + degree) % 7] - family[mode]).rem_euclid(12))
        .collect();
    let tonic_name = spell(tonic.letter, tonic.pitch);
    let mode_name = family_choices()
        .into_iter()
        .find(|f| f.id == options.family)
        .unwrap()
        .modes[mode]
        .clone();
    let scale_name = format!("{tonic_name} {mode_name}");
    let mut result = ProgressionCatalog {
        tonic: tonic_name,
        tonic_pitch_class: tonic.pitch.rem_euclid(12),
        scale_name: scale_name.clone(),
        scale_tones: scale
            .iter()
            .enumerate()
            .map(|(degree, offset)| spell(tonic.letter + degree, tonic.pitch + offset))
            .collect(),
        scale_offsets: scale.clone(),
        degree_names: scale
            .iter()
            .enumerate()
            .map(|(degree, offset)| degree_label(degree, offset - MAJOR[degree]))
            .collect(),
        chords: Vec::new(),
    };
    for degree in 0..7 {
        for count in [3, 4] {
            let intervals = stack(&scale, degree, count);
            let role = native_role(degree, &intervals, &scale);
            result.chords.push(chord(tonic, ChordSpec {
                id: format!("scale-{degree}-{count}"), degree, root_offset: scale[degree], intervals,
                tone_steps: &[0, 2, 4, 6][..count], roman: None, role, operator: "diatonic",
                derivation: format!("{count} tones in stacked thirds from {scale_name}; all notes belong to the selected collection. Function is an authored tonic-relative route role, not determined by collection membership alone."),
                resolution_degree: None, color_cost: 0,
            })?);
        }
    }
    if options.color == ProgressionColor::Diatonic {
        return Ok(result);
    }

    // Parallel collections provide reusable operations, never song presets.
    // Identical native chords are retained only once; directed aliases below
    // remain separate because an equal sonority need not share a function.
    let borrowed: [(usize, i32, &[i32], ProgressionRole, &str); 9] = [
        (
            0,
            0,
            &[0, 3, 7],
            ProgressionRole::Home,
            "parallel natural minor",
        ),
        (0, 0, &[0, 4, 7], ProgressionRole::Home, "parallel major"),
        (
            3,
            5,
            &[0, 3, 7],
            ProgressionRole::Preparation,
            "parallel natural minor",
        ),
        (
            3,
            5,
            &[0, 4, 7],
            ProgressionRole::Preparation,
            "parallel major",
        ),
        (
            2,
            3,
            &[0, 4, 7],
            ProgressionRole::Departure,
            "parallel natural minor",
        ),
        (
            5,
            8,
            &[0, 4, 7],
            ProgressionRole::Departure,
            "parallel natural minor",
        ),
        (
            6,
            10,
            &[0, 4, 7],
            ProgressionRole::Preparation,
            "parallel natural minor",
        ),
        (
            1,
            1,
            &[0, 4, 7],
            ProgressionRole::Preparation,
            "parallel Phrygian (Neapolitan root-position color)",
        ),
        (
            1,
            2,
            &[0, 3, 6, 10],
            ProgressionRole::Preparation,
            "parallel natural minor",
        ),
    ];
    for (i, (degree, root_offset, intervals, role, source)) in borrowed.into_iter().enumerate() {
        let root_pc = (tonic.pitch + root_offset).rem_euclid(12);
        if result
            .chords
            .iter()
            .any(|c| c.root_pitch_class == root_pc && c.intervals == intervals)
        {
            continue;
        }
        result.chords.push(chord(tonic, ChordSpec {
            id: format!("borrowed-{i}"), degree, root_offset, intervals: intervals.to_vec(),
            tone_steps: &[0, 2, 4, 6][..intervals.len()], roman: None, role, operator: "borrowed",
            derivation: format!("Borrowed from {source} on the same tonic. Its chromatic notes change color while the selected tonic remains the reference."),
            resolution_degree: None, color_cost: 1,
        })?);
    }

    for (target, &target_offset) in scale.iter().enumerate() {
        let target_stack = stack(&scale, target, 3);
        if target_stack != [0, 3, 7] && target_stack != [0, 4, 7] {
            continue;
        }
        let target_chord = result
            .chords
            .iter()
            .find(|c| c.id == format!("scale-{target}-3"))
            .unwrap();
        let target_roman = target_chord.roman.clone();
        let target_name = target_chord.name.clone();
        let applied_roman = |operation: &str| {
            if target == 0 {
                operation.to_owned()
            } else {
                format!("{operation}/{target_roman}")
            }
        };
        let dominant_degree = (target + 4) % 7;
        let dominant_offset = (target_offset + 7).rem_euclid(12);
        result.chords.push(chord(tonic, ChordSpec {
            id: format!("dominant-{target}"), degree: dominant_degree, root_offset: dominant_offset,
            intervals: vec![0, 4, 7, 10], tone_steps: &[0, 2, 4, 6], roman: Some(applied_roman("V7")),
            role: ProgressionRole::Tension, operator: "appliedDominant",
            derivation: format!("Dominant seventh of {target_name}: its third is the target's leading tone and its seventh supplies downward tendency. This directed operation is admitted immediately before {target_roman}."),
            resolution_degree: Some(target as u8), color_cost: 1,
        })?);
        result.chords.push(chord(tonic, ChordSpec {
            id: format!("leading-{target}"), degree: (target + 6) % 7, root_offset: (target_offset - 1).rem_euclid(12),
            intervals: vec![0, 3, 6, 9], tone_steps: &[0, 2, 4, 6], roman: Some(applied_roman("vii°7")),
            role: ProgressionRole::Tension, operator: "leadingDiminished",
            derivation: format!("Fully diminished leading-tone seventh of {target_name}. The root is one semitone below the target; the seventh is diminished (9 semitones), unlike a half-diminished seventh (10). Admitted immediately before {target_roman}."),
            resolution_degree: Some(target as u8), color_cost: 1,
        })?);
        if options.color == ProgressionColor::Adventurous {
            result.chords.push(chord(tonic, ChordSpec {
            id: format!("substitute-{target}"), degree: (target + 1) % 7, root_offset: (target_offset + 1).rem_euclid(12),
            intervals: vec![0, 4, 7, 10], tone_steps: &[0, 2, 4, 6], roman: Some(applied_roman("subV7")),
            role: ProgressionRole::Tension, operator: "tritoneSubstitution",
            derivation: format!("Tritone substitute for the dominant of {target_name}: its third and seventh exchange the dominant's tritone pitch classes. The root is a semitone above the target. Admitted immediately before {target_roman}."),
            resolution_degree: Some(target as u8), color_cost: 2,
        })?);
            for (alteration, intervals, tone_steps, roman) in [
                (
                    "flat9",
                    vec![0, 4, 7, 10, 13],
                    vec![0, 2, 4, 6, 8],
                    "V7(♭9)",
                ),
                (
                    "sharp9",
                    vec![0, 4, 7, 10, 15],
                    vec![0, 2, 4, 6, 8],
                    "V7(♯9)",
                ),
                ("flat5", vec![0, 4, 6, 10], vec![0, 2, 4, 6], "V7(♭5)"),
                ("sharp5", vec![0, 4, 8, 10], vec![0, 2, 4, 6], "V7(♯5)"),
            ] {
                let mut altered = chord(
                    tonic,
                    ChordSpec {
                        id: format!("altered-{target}-{alteration}"),
                        degree: dominant_degree,
                        root_offset: dominant_offset,
                        intervals,
                        tone_steps: &tone_steps,
                        roman: Some(applied_roman(roman)),
                        role: ProgressionRole::Tension,
                        operator: "alteredDominant",
                        derivation: format!(
                            "Altered dominant of {target_name}: the major third and minor seventh retain dominant identity while the written alteration changes an actual emitted pitch. Admitted immediately before {target_roman}."
                        ),
                        resolution_degree: Some(target as u8),
                        color_cost: 2,
                    },
                )?;
                if alteration == "sharp5" {
                    // The same intervals admit augmented-seventh nomenclature;
                    // this operator explicitly authors a changed dominant fifth.
                    let root = altered.tone_names[0].clone();
                    altered.name = format!("{root}7(♯5)");
                    altered.global_roman = format!(
                        "{}{}7(♯5)",
                        accidental(altered.root_alteration),
                        ROMANS[dominant_degree]
                    );
                }
                result.chords.push(altered);
            }
        }
    }
    for candidate in &mut result.chords {
        if let Some(target) = candidate.resolution_degree {
            candidate.resolution_chord_id = Some(format!("scale-{target}-3"));
            candidate.resolution_root_pitch_class =
                Some((tonic.pitch + scale[usize::from(target)]).rem_euclid(12));
        }
    }
    Ok(result)
}

/// A finite, root-labelled chromatic triad vocabulary for connection search.
/// These choices do not enter the ordinary progression catalog: a nearby
/// sonority alone supplies neither a functional destination nor permission to
/// treat that sonority as a passing chord. `catalog` must be produced by
/// [`catalog`], which validates its tonic and seven-degree collection.
pub fn connection_chords(catalog: &ProgressionCatalog) -> Vec<ProgressionChord> {
    let tonic = tonic(&catalog.tonic).expect("a generated catalog has a validated tonic");
    let qualities = [
        ("major", [0, 4, 7]),
        ("minor", [0, 3, 7]),
        ("diminished", [0, 3, 6]),
        ("augmented", [0, 4, 8]),
    ];
    let mut result = Vec::with_capacity(48);
    for root_pitch_class in 0..12 {
        let root_offset = (root_pitch_class - catalog.tonic_pitch_class).rem_euclid(12);
        // Keep the collection's letter for an existing scale degree. For other
        // roots use the nearest major-reference degree, preferring the lowered
        // degree in an enharmonic tie (e.g. C: D-flat rather than C-sharp).
        let degree = catalog
            .scale_offsets
            .iter()
            .position(|&offset| offset == root_offset)
            .unwrap_or_else(|| {
                (0..7)
                    .min_by_key(|&degree| {
                        let change = closest_change(root_offset, MAJOR[degree]);
                        (change.abs(), change > 0, degree)
                    })
                    .expect("the seven major-reference degrees are nonempty")
            });
        for (quality_name, intervals) in qualities {
            result.push(
                chord(
                    tonic,
                    ChordSpec {
                        id: format!("connection-{root_pitch_class}-{quality_name}"),
                        degree,
                        root_offset,
                        intervals: intervals.to_vec(),
                        tone_steps: &[0, 2, 4],
                        roman: None,
                        role: ProgressionRole::Color,
                        operator: "chromaticTriad",
                        derivation: format!(
                            "Freely authored {quality_name} triad in the chromatic connection vocabulary. Its Roman numeral describes its root and quality relative to {}. A connection must be judged by its measured motion and passage context; no functional resolution or passing role is asserted.",
                            catalog.tonic
                        ),
                        resolution_degree: None,
                        color_cost: 3,
                    },
                )
                .expect("the connection vocabulary contains supported triad qualities"),
            );
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_vocabulary_has_every_root_and_exact_triad_quality() {
        let data = catalog(&default_options()).unwrap();
        let chords = connection_chords(&data);
        assert_eq!(chords.len(), 48);
        assert!(data.chords.iter().all(|c| c.operator != "chromaticTriad"));
        let mut identities = std::collections::BTreeSet::new();
        for root in 0..12 {
            for (name, intervals) in [
                ("major", vec![0, 4, 7]),
                ("minor", vec![0, 3, 7]),
                ("diminished", vec![0, 3, 6]),
                ("augmented", vec![0, 4, 8]),
            ] {
                let c = chords
                    .iter()
                    .find(|c| c.id == format!("connection-{root}-{name}"))
                    .unwrap();
                assert_eq!(c.root_pitch_class, root);
                assert_eq!(c.intervals, intervals);
                assert_eq!(c.tone_names.len(), 3);
                assert_eq!(
                    c.intervals
                        .iter()
                        .map(|offset| (root + offset).rem_euclid(12))
                        .collect::<std::collections::BTreeSet<_>>()
                        .len(),
                    3
                );
                assert!(identities.insert((root, c.intervals.clone())));
                assert_eq!(c.role, ProgressionRole::Color);
                assert_eq!(c.operator, "chromaticTriad");
                assert_eq!(c.roman, c.global_roman);
                assert_eq!(c.color_cost, 3);
                assert!(c.resolution_degree.is_none());
                assert!(c.resolution_chord_id.is_none());
                assert!(c.resolution_root_pitch_class.is_none());
            }
        }
        // Augmented pitch sets repeat under major-third root changes; declared
        // roots remain distinct authored choices, not a claim of 48 unique sets.
        assert_eq!(identities.len(), 48);
    }

    #[test]
    fn connection_spellings_preserve_collection_degrees_without_function_stories() {
        let major = connection_chords(&catalog(&default_options()).unwrap());
        let flat = major.iter().find(|c| c.id == "connection-1-minor").unwrap();
        assert_eq!(flat.name, "D♭m");
        assert_eq!(flat.roman, "♭ii");
        assert_eq!(flat.tone_names, ["D♭", "F♭", "A♭"]);
        let lydian = connection_chords(
            &catalog(&ProgressionOptions {
                mode: 3,
                ..default_options()
            })
            .unwrap(),
        );
        let raised = lydian
            .iter()
            .find(|c| c.id == "connection-6-diminished")
            .unwrap();
        assert_eq!(raised.name, "F♯dim");
        assert_eq!(raised.roman, "♯iv°");
        assert_eq!(raised.tone_names, ["F♯", "A", "C"]);
        let transposed = connection_chords(
            &catalog(&ProgressionOptions {
                tonic: "Bb".into(),
                ..default_options()
            })
            .unwrap(),
        );
        let tonic = transposed
            .iter()
            .find(|c| c.id == "connection-10-augmented")
            .unwrap();
        assert_eq!(tonic.name, "B♭aug");
        assert_eq!(tonic.roman, "I+");
        assert_eq!(tonic.tone_names, ["B♭", "D", "F♯"]);
    }

    #[test]
    fn every_family_mode_stacks_exact_spelled_scale_thirds() {
        for family in family_choices() {
            for mode in 0..7 {
                let options = ProgressionOptions {
                    family: family.id,
                    mode,
                    color: ProgressionColor::Diatonic,
                    ..default_options()
                };
                let data = catalog(&options).unwrap();
                assert_eq!(data.chords.len(), 14);
                for c in &data.chords {
                    assert_eq!(c.tone_names.len(), c.intervals.len());
                    for (i, interval) in c.intervals.iter().enumerate() {
                        let degree = (usize::from(c.degree) + 2 * i) % 7;
                        assert_eq!(c.tone_names[i], data.scale_tones[degree]);
                        assert_eq!(
                            (c.root_pitch_class + interval).rem_euclid(12),
                            data.scale_offsets[degree]
                        );
                    }
                    assert!(!c.name.is_empty());
                }
            }
        }
    }

    #[test]
    fn harmonic_and_melodic_minor_keep_seventh_qualities_distinct() {
        let harmonic = catalog(&ProgressionOptions {
            family: ProgressionFamily::HarmonicMinor,
            ..default_options()
        })
        .unwrap();
        assert_eq!(harmonic.scale_tones, ["C", "D", "E♭", "F", "G", "A♭", "B"]);
        assert_eq!(
            harmonic
                .chords
                .iter()
                .find(|c| c.id == "scale-6-4")
                .unwrap()
                .roman,
            "vii°7"
        );
        assert_eq!(
            harmonic
                .chords
                .iter()
                .find(|c| c.id == "scale-1-4")
                .unwrap()
                .roman,
            "iiø7"
        );
        assert_eq!(
            harmonic
                .chords
                .iter()
                .find(|c| c.id == "scale-0-4")
                .unwrap()
                .name,
            "Cm(maj7)"
        );
        let melodic = catalog(&ProgressionOptions {
            family: ProgressionFamily::MelodicMinor,
            ..default_options()
        })
        .unwrap();
        assert_eq!(melodic.scale_tones, ["C", "D", "E♭", "F", "G", "A", "B"]);
        assert_eq!(
            melodic
                .chords
                .iter()
                .find(|c| c.id == "scale-6-4")
                .unwrap()
                .roman,
            "viiø7"
        );
        let altered = catalog(&ProgressionOptions {
            family: ProgressionFamily::MelodicMinor,
            mode: 6,
            ..default_options()
        })
        .unwrap();
        assert_eq!(
            altered.scale_tones,
            ["C", "D♭", "E♭", "F♭", "G♭", "A♭", "B♭"]
        );
        assert_eq!(
            altered
                .chords
                .iter()
                .find(|c| c.id == "scale-0-4")
                .unwrap()
                .roman,
            "iø7"
        );
    }

    #[test]
    fn spelling_and_roman_degrees_follow_the_selected_tonic() {
        let flat = catalog(&ProgressionOptions {
            tonic: "Bb".into(),
            mode: 1,
            ..default_options()
        })
        .unwrap();
        assert_eq!(flat.scale_tones, ["B♭", "C", "D♭", "E♭", "F", "G", "A♭"]);
        assert_eq!(
            flat.chords
                .iter()
                .find(|c| c.id == "scale-2-3")
                .unwrap()
                .roman,
            "♭III"
        );
        let sharp = catalog(&ProgressionOptions {
            tonic: "F#".into(),
            family: ProgressionFamily::HarmonicMinor,
            ..default_options()
        })
        .unwrap();
        assert_eq!(sharp.scale_tones, ["F♯", "G♯", "A", "B", "C♯", "D", "E♯"]);
        let weird = catalog(&ProgressionOptions {
            tonic: "G#".into(),
            ..default_options()
        })
        .unwrap();
        assert_eq!(weird.scale_tones[6], "F♯♯");
    }

    #[test]
    fn secondary_targets_alterations_and_substitutions_are_concrete() {
        let chromatic = catalog(&default_options()).unwrap();
        assert!(chromatic.chords.iter().all(|c| c.color_cost <= 1));
        let data = catalog(&ProgressionOptions {
            color: ProgressionColor::Adventurous,
            ..default_options()
        })
        .unwrap();
        let secondary = data.chords.iter().find(|c| c.id == "dominant-4").unwrap();
        assert_eq!(
            (
                secondary.name.as_str(),
                secondary.roman.as_str(),
                secondary.global_roman.as_str()
            ),
            ("D7", "V7/V", "II7")
        );
        assert_eq!(secondary.resolution_degree, Some(4));
        let diminished = data.chords.iter().find(|c| c.id == "leading-1").unwrap();
        assert_eq!(diminished.tone_names, ["C♯", "E", "G", "B♭"]);
        let substitute = data.chords.iter().find(|c| c.id == "substitute-0").unwrap();
        assert_eq!(substitute.tone_names, ["D♭", "F", "A♭", "C♭"]);
        assert_eq!(substitute.global_roman, "♭II7");
        let ninth = data
            .chords
            .iter()
            .find(|c| c.id == "altered-0-sharp9")
            .unwrap();
        assert_eq!(ninth.tone_names, ["G", "B", "D", "F", "A♯"]);
        assert!(data.chords.iter().all(|c| c.resolution_degree != Some(6)));
        assert!(data.chords.len() < 80);
    }

    #[test]
    fn all_catalog_spellings_match_the_emitted_intervals_and_directed_targets() {
        fn named_pitch(name: &str) -> i32 {
            let mut chars = name.chars();
            let pitch: i32 = match chars.next().unwrap() {
                'C' => 0,
                'D' => 2,
                'E' => 4,
                'F' => 5,
                'G' => 7,
                'A' => 9,
                'B' => 11,
                other => panic!("unexpected pitch letter {other}"),
            };
            chars
                .fold(pitch, |pitch, sign| match sign {
                    '♭' => pitch - 1,
                    '♯' => pitch + 1,
                    other => panic!("unexpected accidental {other}"),
                })
                .rem_euclid(12)
        }
        for family in family_choices() {
            for mode in 0..7 {
                for tonic in ["C", "Bb", "F#", "Cb", "G#", "B#", "Cbb", "A##"] {
                    let data = catalog(&ProgressionOptions {
                        tonic: tonic.into(),
                        family: family.id,
                        mode,
                        color: ProgressionColor::Adventurous,
                        ..default_options()
                    })
                    .unwrap();
                    assert!(data.chords.len() <= 80);
                    for c in &data.chords {
                        assert_eq!(c.tone_names.len(), c.intervals.len());
                        for (name, interval) in c.tone_names.iter().zip(&c.intervals) {
                            assert_eq!(
                                named_pitch(name),
                                (c.root_pitch_class + interval).rem_euclid(12),
                                "{}: {name}",
                                c.name
                            );
                        }
                        if let Some(target) = c.resolution_degree {
                            let target_chord = data
                                .chords
                                .iter()
                                .find(|x| x.id == format!("scale-{target}-3"))
                                .unwrap();
                            assert_eq!(
                                c.resolution_chord_id.as_deref(),
                                Some(target_chord.id.as_str())
                            );
                            assert_eq!(
                                c.resolution_root_pitch_class,
                                Some(target_chord.root_pitch_class)
                            );
                            assert!(
                                target_chord.intervals == [0, 3, 7]
                                    || target_chord.intervals == [0, 4, 7]
                            );
                            let distance =
                                (c.root_pitch_class - target_chord.root_pitch_class).rem_euclid(12);
                            assert_eq!(
                                distance,
                                match c.operator.as_str() {
                                    "appliedDominant" | "alteredDominant" => 7,
                                    "leadingDiminished" => 11,
                                    "tritoneSubstitution" => 1,
                                    other => panic!("unexpected directed operator {other}"),
                                }
                            );
                        }
                    }
                }
            }
        }
    }
}
