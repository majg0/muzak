//! Offline latent-harmony persistence across exact pitched-note silence.
//! The copied window is a hypothesis; no note witness is added by the hold.
use muzak_core::{
    error::{CoreResult, budget, invalid},
    harmony::HarmonyWindow,
    model::{Score, validate_score},
};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilentGapExtension {
    pub window_index: usize,
    pub window_id: String,
    /// The original window's end; the extension is half-open [start, end).
    pub start_tick: u64,
    pub end_tick: u64,
    pub ends_at_score_end: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilentGapHold {
    pub criterion: &'static str,
    pub windows: Vec<HarmonyWindow>,
    pub extensions: Vec<SilentGapExtension>,
}

pub fn hold_silent_gaps(score: &Score, original: &[HarmonyWindow]) -> CoreResult<SilentGapHold> {
    const MAX_ITEMS: usize = 1_000_000;
    if score.notes.len() > MAX_ITEMS || original.len() > MAX_ITEMS {
        return Err(budget("Silent-gap hold exceeds its note/window budget."));
    }
    validate_score(score)?;
    if original.iter().any(|w| {
        w.start_tick >= w.end_tick
            || w.end_tick > score.duration
            || w.selected.is_some_and(|i| i >= w.alternatives.len())
    }) || original
        .windows(2)
        .any(|pair| pair[0].end_tick > pair[1].start_tick)
    {
        return Err(invalid(
            "Silent-gap hold requires ordered, nonoverlapping positive windows within the score and valid selections.",
        ));
    }
    if original.iter().any(|w| w.functional_root.is_some()) {
        return Err(invalid(
            "Hold raw windows before contextual inference; existing functional-root evidence must not be extended.",
        ));
    }
    let percussion: HashSet<_> = score
        .parts
        .iter()
        .filter(|p| p.percussion)
        .map(|p| p.id.as_str())
        .collect();
    // Native curves and fractional pitches still occupy the source interval.
    // Pedal/reverb/gain are not interpreted by this key-down silence policy.
    let mut occupied: Vec<_> = score
        .notes
        .iter()
        .filter(|n| n.duration > 0 && !percussion.contains(n.part.as_str()))
        .map(|n| (n.onset, n.onset + n.duration))
        .collect();
    occupied.sort_unstable();
    let mut merged: Vec<(u64, u64)> = Vec::with_capacity(occupied.len());
    for (start, end) in occupied {
        if let Some(last) = merged.last_mut().filter(|last| start <= last.1) {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    let mut result = SilentGapHold {
        criterion: "No positive-duration nonpercussion score note overlaps the half-open extension; this is latent harmony, not acoustic sustain.",
        windows: original.to_vec(),
        extensions: vec![],
    };
    // No note-supported predecessor can exist in a wholly unpitched score.
    if merged.is_empty() {
        return Ok(result);
    }
    let mut cursor = 0;
    for (index, window) in original.iter().enumerate() {
        let end = original
            .get(index + 1)
            .map_or(score.duration, |next| next.start_tick);
        if window.selected.is_none() || end == window.end_tick {
            continue;
        }
        while merged
            .get(cursor)
            .is_some_and(|span| span.1 <= window.end_tick)
        {
            cursor += 1;
        }
        if merged.get(cursor).is_some_and(|span| span.0 < end) {
            continue;
        }
        result.extensions.push(SilentGapExtension {
            window_index: index,
            window_id: window.id.clone(),
            start_tick: window.end_tick,
            end_tick: end,
            ends_at_score_end: index + 1 == original.len(),
        });
        result.windows[index].end_tick = end;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> (Score, Vec<HarmonyWindow>) {
        let score = json!({"ppq":4,"duration":8,"parts":[
            {"id":"p","name":"","track":0,"channel":0,"percussion":false},
            {"id":"drum","name":"","track":0,"channel":9,"percussion":true}],
            "notes":[note("a",0,1,"p"),note("b",4,1,"p")],"attachments":[],"trackEnds":[8]});
        let windows = (0..2).map(|i| json!({
            "id":format!("w{i}"),"startTick":i*4,"endTick":i*4+1,"label":"raw","rest":false,
            "noteIds":[if i==0{"a"}else{"b"}],"coreNoteIds":[],"colorNoteIds":[],"residualNoteIds":[],
            "unsupportedNoteIds":[],"percussionNoteIds":[],"selected":0,"ambiguityGap":null,
            "localAmbiguityGap":null,"roles":[],"rhythms":[],"alternatives":[{
                "rootMillicents":0,"templateId":"M","label":"M","coreIntervals":[0,400000,700000],
                "colorIntervals":[],"score":0,"coreCoverage":1,"coreMassFraction":1,"contextualCost":null}]
        })).collect::<Vec<_>>();
        (
            serde_json::from_value(score).unwrap(),
            serde_json::from_value(json!(windows)).unwrap(),
        )
    }
    fn note(id: &str, onset: u64, duration: u64, part: &str) -> Value {
        json!({"id":id,"part":part,"onset":onset,"duration":duration,
            "pitch":{"millicents":6000000},"velocity":80,"releaseVelocity":64})
    }

    #[test]
    fn extends_internal_and_terminal_silence_without_mutation_or_extra_witnesses() {
        let (score, windows) = fixture();
        let original = serde_json::to_value((&score, &windows)).unwrap();
        let held = hold_silent_gaps(&score, &windows).unwrap();
        assert_eq!(
            held.windows.iter().map(|w| w.end_tick).collect::<Vec<_>>(),
            [4, 8]
        );
        assert_eq!(held.extensions.len(), 2);
        assert_eq!(held.extensions[0].start_tick, 1);
        assert!(!held.extensions[0].ends_at_score_end);
        assert!(held.extensions[1].ends_at_score_end);
        for (mut held, original) in held.windows.into_iter().zip(&windows) {
            held.end_tick = original.end_tick;
            assert_eq!(
                serde_json::to_value(held).unwrap(),
                serde_json::to_value(original).unwrap()
            );
        }
        assert_eq!(serde_json::to_value((&score, &windows)).unwrap(), original);
    }

    #[test]
    fn any_pitched_overlap_blocks_the_entire_gap_including_carried_notes() {
        for (onset, duration) in [(0, 2), (1, 1), (2, 1), (3, 2)] {
            let (mut score, windows) = fixture();
            let mut blocker = note("block", onset, duration, "p");
            blocker["pitch"]["millicents"] = json!(6000001);
            score.notes.push(serde_json::from_value(blocker).unwrap());
            let held = hold_silent_gaps(&score, &windows).unwrap();
            assert_eq!(held.windows[0].end_tick, 1, "{onset}/{duration}");
        }
    }

    #[test]
    fn exact_boundary_touch_zero_duration_and_percussion_do_not_occupy_gap() {
        let (mut score, windows) = fixture();
        for n in [
            note("touch-left", 0, 1, "p"),
            note("touch-right", 4, 1, "p"),
            note("instant", 2, 0, "p"),
            note("drum", 1, 3, "drum"),
        ] {
            score.notes.push(serde_json::from_value(n).unwrap());
        }
        assert_eq!(
            hold_silent_gaps(&score, &windows).unwrap().windows[0].end_tick,
            4
        );
    }

    #[test]
    fn no_leading_fill_no_unselected_hold_and_no_empty_score_invention() {
        let (mut score, mut windows) = fixture();
        windows[0].selected = None;
        assert_eq!(
            hold_silent_gaps(&score, &windows).unwrap().windows[0].end_tick,
            1
        );
        let single = hold_silent_gaps(&score, &windows[1..]).unwrap();
        assert_eq!(single.windows.len(), 1);
        assert_eq!(single.windows[0].start_tick, 4);
        assert!(hold_silent_gaps(&score, &[]).unwrap().windows.is_empty());
        score.notes.clear();
        assert!(
            hold_silent_gaps(&score, &windows)
                .unwrap()
                .extensions
                .is_empty()
        );
    }

    #[test]
    fn rejects_bad_scope_selection_and_stale_context() {
        let (score, windows) = fixture();
        for (index, start, end) in [(0, 0, 0), (0, 0, 5), (1, 4, 9)] {
            let mut bad = windows.clone();
            bad[index].start_tick = start;
            bad[index].end_tick = end;
            assert!(hold_silent_gaps(&score, &bad).is_err());
        }
        let mut bad = windows.clone();
        bad.reverse();
        assert!(hold_silent_gaps(&score, &bad).is_err());
        let mut bad = windows.clone();
        bad[0].selected = Some(1);
        assert!(hold_silent_gaps(&score, &bad).is_err());
        let mut bad = serde_json::to_value(windows).unwrap();
        bad[0]["functionalRoot"] = json!({"rootMillicents":0,"realizationAlternativeIndex":0,"evidence":{
            "nextWindowIndex":1,"bassMillicents":6000000,"currentBassTick":0,"nextBassTick":4,
            "currentBassNoteIds":["a"],"nextBassNoteIds":["b"],"resolutionNoteIds":["b"],
            "observedResolutionIntervals":[0],"resolutionEndTick":5}});
        assert!(
            hold_silent_gaps(
                &score,
                &serde_json::from_value::<Vec<HarmonyWindow>>(bad).unwrap()
            )
            .is_err()
        );
    }
}
