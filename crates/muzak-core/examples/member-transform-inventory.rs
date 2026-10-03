//! Finite research catalog adapter. Core enumeration has no chord vocabulary,
//! temperament, labels or probability model; this caller declares its projection.
use muzak_core::{
    composition::{CompositionHarmony, PitchLattice},
    member_transform::{
        MemberTransform, MemberTransformLimits, MemberTransformOptions, enumerate_member_transforms,
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
const MC: i64 = 100_000;
const QUALITIES: [(&str, &[i64]); 9] = [
    ("M", &[0, 4, 7]),
    ("m", &[0, 3, 7]),
    ("Mm7", &[0, 4, 7, 10]),
    ("m7", &[0, 3, 7, 10]),
    ("M7", &[0, 4, 7, 11]),
    ("o", &[0, 3, 6]),
    ("o7", &[0, 3, 6, 9]),
    ("half-diminished", &[0, 3, 6, 10]),
    ("augmented", &[0, 4, 8]),
];
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
struct Input {
    domains: Vec<Vec<i64>>,
    max_changed_members: usize,
    contextual_steps: Vec<i64>,
    chromatic_semitones: Vec<i64>,
    max_checks: usize,
    max_programs: usize,
}
impl Default for Input {
    fn default() -> Self {
        Self {
            domains: vec![],
            max_changed_members: 2,
            contextual_steps: vec![-1, 1],
            chromatic_semitones: vec![-1, 1],
            max_checks: 500_000,
            max_programs: 500_000,
        }
    }
}
fn run(x: Input) -> Result<Value, String> {
    if x.domains.len() > 64
        || x.max_checks == 0
        || x.max_checks > 500_000
        || x.max_programs == 0
        || x.max_programs > 500_000
    {
        return Err("Research catalog bounds".into());
    }
    for offsets in [&x.contextual_steps, &x.chromatic_semitones] {
        if offsets.len() > 2
            || offsets.iter().any(|x| ![-1, 1].contains(x))
            || offsets.windows(2).any(|w| w[0] >= w[1])
        {
            return Err("Expected a sorted distinct subset of [-1,1]".into());
        }
    }
    let mut unique = std::collections::HashSet::new();
    for d in &x.domains {
        if d.is_empty()
            || d.len() > 12
            || d.iter().any(|p| !(0..12).contains(p))
            || d.windows(2).any(|w| w[0] >= w[1])
            || !unique.insert(d)
        {
            return Err("Invalid or duplicate semitone domain".into());
        }
    }
    let parents: Vec<_> = (0..12)
        .flat_map(|root| {
            QUALITIES.iter().map(move |(_, is)| CompositionHarmony {
                id: "parent".into(),
                root_millicents: root * MC,
                intervals: is.iter().map(|i| i * MC).collect(),
            })
        })
        .collect();
    let domains: Vec<_> = x
        .domains
        .iter()
        .map(|d| PitchLattice {
            id: "domain".into(),
            origin_millicents: d[0] * MC,
            period_millicents: 12 * MC,
            intervals: d.iter().map(|p| (p - d[0]) * MC).collect(),
        })
        .collect();
    let options = MemberTransformOptions {
        max_changed_members: x.max_changed_members,
        contextual_steps: x.contextual_steps,
        chromatic_offsets: x.chromatic_semitones.iter().map(|p| p * MC).collect(),
        limits: MemberTransformLimits {
            max_patterns: 256,
            max_candidate_checks: x.max_checks,
            max_programs: x.max_programs,
            ..Default::default()
        },
    };
    let out =
        enumerate_member_transforms(&parents, &domains, &options).map_err(|e| e.to_string())?;
    let patterns:Vec<_>=out.patterns.iter().map(|p|Ok(json!({"notesCount":p.transforms.len(),"usesDomain":p.uses_domain(),
        "transforms":p.transforms.iter().map(|t|match t {MemberTransform::Keep=>json!({"kind":"keep"}),
            MemberTransform::Contextual{steps}=>json!({"kind":"contextual","amount":steps}),
            MemberTransform::Chromatic{millicents}=>json!({"kind":"chromatic","amount":millicents/MC})}).collect::<Vec<_>>(),
        "bindings":p.bindings("parent",Some("domain")).map_err(|e|e.to_string())?}))).collect::<Result<_,String>>()?;
    let programs:Vec<_>=out.programs.iter().map(|p|{
        let core=p.pitches.iter().fold(0u16,|mask,pitch|{assert_eq!(pitch%MC,0);mask|1<<((pitch/MC).rem_euclid(12))});
        json!({"rootPC":p.parent_index/9,"qualityIndex":p.parent_index%9,"usedDomainIndex":p.domain_index,
            "bindingTemplateIndex":p.pattern_index,"coreMask":core})
    }).collect();
    Ok(
        json!({"domains":x.domains,"qualities":QUALITIES.iter().map(|(name,intervals)|json!({"name":name,"intervals":intervals})).collect::<Vec<_>>(),
        "bindingTemplates":patterns,"programs":programs,"candidateChecks":out.work.candidate_checks,
        "offDomainAnchorRejections":out.work.off_domain_anchor_rejections,"completeWithinDeclaredGrammar":true}),
    )
}
fn main() {
    let mut raw = String::new();
    let result = io::stdin()
        .take(1_048_577)
        .read_to_string(&mut raw)
        .map_err(|e| e.to_string())
        .and_then(|_| {
            if raw.len() > 1_048_576 {
                Err("Request byte budget".into())
            } else {
                Ok(())
            }
        })
        .and_then(|_| serde_json::from_str::<Input>(&raw).map_err(|e| e.to_string()))
        .and_then(run);
    println!(
        "{}",
        match result {
            Ok(result) => json!({"ok":true,"result":result}),
            Err(error) => json!({"ok":false,"error":error}),
        }
    );
}
