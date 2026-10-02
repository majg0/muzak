//! Source meter and exact display geometry. SMF FF58 gives a signature, not
//! pickup length or expressive beat tracking. Unknown/conflicting meter stays
//! unknown; quarter coordinates are a declared PPQ fallback, never inferred 4/4.
use crate::{error::{CoreResult, budget, invalid}, midi::midi_payload, model::{Score, validate_score}};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all="camelCase")]
pub struct ScoreMeterOptions {
    #[serde(skip_serializing_if="Option::is_none")]
    #[ts(optional)]
    pub from_tick: Option<u64>,
    #[serde(skip_serializing_if="Option::is_none")]
    #[ts(optional)]
    pub to_tick: Option<u64>,
    #[serde(skip_serializing_if="Option::is_none")]
    #[ts(optional)]
    pub max_markers: Option<usize>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all="kebab-case")]
pub enum MeterSource { Metadata, Missing, Unsupported, Conflict }
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all="camelCase")]
pub struct MeterSegment {
    pub start_tick: u64,
    pub end_tick: u64,
    pub numerator: Option<u8>,
    pub denominator: Option<u16>,
    pub source: MeterSource,
    /// Assumed display downbeat; MIDI does not encode an anacrusis here.
    pub phase_origin_tick: u64,
    /// Bar index at phaseOriginTick, as decimal text to retain large indices.
    pub first_bar: Option<String>,
    pub clocks_per_click: Option<u8>,
    pub notated32nds_per_quarter: Option<u8>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MeterFraction { pub numerator: String, pub denominator: String }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all="kebab-case")]
pub enum MeterMarkerKind { Bar, Beat, Quarter }
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all="camelCase")]
pub struct MeterMarker {
    /// Approximation for drawing only. exactTick is authoritative.
    pub tick: f64,
    pub exact_tick: MeterFraction,
    pub kind: MeterMarkerKind,
    pub bar: Option<String>,
    /// One-based denominator-note beat, not an inferred compound tactus.
    pub beat: Option<u8>,
    pub label: String,
    pub segment: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all="camelCase")]
pub struct ScoreMeterMap {
    pub from_tick: u64,
    pub to_tick: u64,
    pub segments: Vec<MeterSegment>,
    pub markers: Vec<MeterMarker>,
    pub diagnostics: Vec<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Signature { n:u8, d:u16, clocks:Option<u8>, bb:u8 }
impl Signature {
    fn same_geometry(self, other: Self)->bool { (self.n,self.d,self.bb)==(other.n,other.d,other.bb) }
    // bb = number of notated 32nds per MIDI quarter. It need not equal 8.
    fn pulse(self,ppq:u64)->(u128,u128) { (32*ppq as u128,self.d as u128*self.bb as u128) }
}
fn gcd(mut a:u128,mut b:u128)->u128 { while b!=0 { (a,b)=(b,a%b); } a }
fn exact(n:u128,d:u128)->MeterFraction { let g=gcd(n,d);MeterFraction{numerator:(n/g).to_string(),denominator:(d/g).to_string()} }
fn ceil(n:u128,d:u128)->u128 { n/d+u128::from(n%d!=0) }

/// Shared source parser for the display, harmonic lattice and accent features.
/// Repeated identical metadata does not establish a new downbeat. Conflicting
/// signatures stay unknown instead of privileging an arbitrary track.
pub fn meter_segments(score:&Score, limit:usize)->CoreResult<(Vec<MeterSegment>,Vec<String>)> {
    validate_score(score)?;
    if limit==0 {return Err(invalid("Meter segment budget must be positive."));}
    let mut diagnostics=vec!["Bar numbering assumes the first supported signature is a downbeat. MIDI time signatures alone do not establish a pickup or original printed measure number; denominator beats are not inferred tactus.".into()];
    let mut events:BTreeMap<u64,Vec<Option<Signature>>>=BTreeMap::new();
    for (index,event) in score.attachments.iter().filter(|e|e.bytes.starts_with(&[255,88])).enumerate() {
        if index>=limit {return Err(budget("Meter metadata budget exceeded maxMarkers."));}
        let p=midi_payload(&event.bytes)?;
        let value=if p.len()==4&&p[0]>0&&p[1]<=7&&p[3]>0 {Some(Signature{n:p[0],d:1u16<<p[1],clocks:Some(p[2]),bb:p[3]})} else {None};
        events.entry(event.tick).or_default().push(value);
        if events.len()>limit {return Err(budget("Meter segment budget exceeded maxMarkers."));}
    }
    let mut changes=vec![(0,None,MeterSource::Missing)];
    for (tick,values) in events {
        let mut first=values[0];
        let conflict=values.iter().any(|&v|match (first,v){(Some(a),Some(b))=>!a.same_geometry(b),(None,None)=>false,_=>true});
        if !conflict&&values.iter().any(|&v|v!=first) {
            if let Some(ref mut signature)=first {signature.clocks=None;}
            diagnostics.push(format!("Metronome-click metadata disagrees at tick {tick}; the agreed signature geometry remains available."));
        }
        let (signature,source)=if conflict {(None,MeterSource::Conflict)}else if first.is_none(){(None,MeterSource::Unsupported)}else{(first,MeterSource::Metadata)};
        if source==MeterSource::Conflict {diagnostics.push(format!("Conflicting simultaneous meter metadata at tick {tick}; no track/order winner is invented."));}
        if source==MeterSource::Unsupported {diagnostics.push(format!("Unsupported meter payload at tick {tick}; require positive numerator/bb and a denominator through 1/128."));}
        if let Some(last)=changes.last_mut().filter(|c|c.0==tick) {*last=(tick,signature,source);}
        else if changes.last().is_none_or(|c|c.1!=signature||c.2!=source) {changes.push((tick,signature,source));}
    }
    if changes.iter().any(|c|c.1.is_none()) {diagnostics.push("Unknown meter is drawn in MIDI-quarter coordinates only; those lines do not assert musical beats or bars.".into());}
    let mut segments=vec![];let mut origin=0u64;let mut base=1u128;
    for (i,&(start,signature,source)) in changes.iter().enumerate() {
        if i>0 {
            let previous=changes[i-1].1;
            if !matches!((previous,signature),(Some(a),Some(b)) if a.same_geometry(b)) {
                if let Some(previous)=previous {
                    let (num,den)=previous.pulse(score.ppq);let phase=(start-origin) as u128*den;let bar=num*previous.n as u128;
                    base+=ceil(phase,bar);
                    if phase%bar!=0 {diagnostics.push(format!("Signature change at tick {start} cuts the previous display bar; a new bar origin is assumed."));}
                } else {base=1;diagnostics.push(format!("Bar numbering restarts locally at tick {start} after unknown meter."));}
                origin=start;
            }
        }
        let end=changes.get(i+1).map_or(score.duration,|c|c.0);
        segments.push(MeterSegment{start_tick:start,end_tick:end,numerator:signature.map(|s|s.n),denominator:signature.map(|s|s.d),source,phase_origin_tick:origin,
            first_bar:signature.map(|_|base.to_string()),clocks_per_click:signature.and_then(|s|s.clocks),notated32nds_per_quarter:signature.map(|s|s.bb)});
    }
    Ok((segments,diagnostics))
}
fn signature(segment:&MeterSegment)->Option<Signature> {
    let n=segment.numerator?;let d=segment.denominator?;let bb=segment.notated32nds_per_quarter?;
    if n==0||d==0||bb==0{return None;}
    Some(Signature{n,d,bb,clocks:segment.clocks_per_click})
}
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub struct MetricalPosition {pub bar:bool,pub denominator_beat:bool,pub compound_group:bool}
/// Exact relation only; each caller owns its declared accent coefficients.
pub fn metrical_position(segments:&[MeterSegment],ppq:u64,tick:u64)->Option<MetricalPosition> {
    if ppq==0{return None;}
    let segment=segments.get(segments.partition_point(|s|s.start_tick<=tick).checked_sub(1)?)?;
    if tick>segment.end_tick||tick<segment.phase_origin_tick{return None;}
    let s=signature(segment)?;let(num,den)=s.pulse(ppq);let position=(tick-segment.phase_origin_tick) as u128*den;
    Some(MetricalPosition{bar:position%(num*s.n as u128)==0,denominator_beat:position%num==0,
        compound_group:s.n>3&&s.n%3==0&&position%(3*num)==0})
}
/// Read the whole source once; range limits only display markers. maxMarkers
/// also bounds admitted signature events. Every denominator beat is returned
/// or the explicit budget fails; no thinning, rounding or metadata mutation.
pub fn score_meter(score:&Score, options:&ScoreMeterOptions)->CoreResult<ScoreMeterMap> {
    let from=options.from_tick.unwrap_or(0);let to=options.to_tick.unwrap_or(score.duration);
    let limit=options.max_markers.unwrap_or(20_000);
    if from>to||to>score.duration||limit==0 {return Err(invalid("Invalid meter display range or maxMarkers."));}
    let(segments,diagnostics)=meter_segments(score,limit)?;
    let mut markers=vec![];
    for (i,segment) in segments.iter().enumerate() {
        let start=from.max(segment.start_tick);let end=to.min(segment.end_tick);
        let include_end=i+1==segments.len()&&end==score.duration;
        if start>end||(start==end&&!include_end) {continue;}
        let signature=signature(segment);
        let (num,den)=signature.map_or((score.ppq as u128,1),|s|s.pulse(score.ppq));
        let anchor=if signature.is_some(){segment.phase_origin_tick}else{0};
        if signature.is_none()&&segment.start_tick>=from&&segment.start_tick<=to&&segment.start_tick%score.ppq!=0 {
            if markers.len()>=limit{return Err(budget("Meter marker budget exceeded maxMarkers."));}
            let q=exact(segment.start_tick as u128,score.ppq as u128);
            markers.push(MeterMarker{tick:segment.start_tick as f64,exact_tick:exact(segment.start_tick as u128,1),kind:MeterMarkerKind::Quarter,bar:None,beat:None,label:format!("q{}/{}",q.numerator,q.denominator),segment:i});
        }
        let first=ceil((start-anchor) as u128*den,num);let mut last=(end-anchor) as u128*den/num;
        if !include_end&&anchor as u128*den+last*num==end as u128*den {if last==0{continue;}last-=1;}
        if first>last {continue;}
        let count=last-first+1;
        if count>limit.saturating_sub(markers.len()) as u128 {return Err(budget("Meter marker budget exceeded maxMarkers; request a smaller display range or a larger explicit budget."));}
        for step in first..=last {
            let n=anchor as u128*den+step*num;
            if n==end as u128*den&&!include_end {continue;}
            let (kind,bar,beat,label)=if let Some(s)=signature {
                let base=segment.first_bar.as_ref().and_then(|s|s.parse::<u128>().ok()).ok_or_else(||invalid("Invalid internal meter bar index."))?;
                let bar=base+step/s.n as u128;let beat=(step%s.n as u128) as u8+1;
                (if beat==1{MeterMarkerKind::Bar}else{MeterMarkerKind::Beat},Some(bar.to_string()),Some(beat),format!("{bar}:{beat}"))
            }else{(MeterMarkerKind::Quarter,None,None,format!("q{step}"))};
            markers.push(MeterMarker{tick:n as f64/den as f64,exact_tick:exact(n,den),kind,bar,beat,label,segment:i});
        }
    }
    Ok(ScoreMeterMap{from_tick:from,to_tick:to,segments,markers,diagnostics})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ScoreAttachment;
    fn score(ppq:u64,duration:u64,events:&[(u64,u8,u8,u8,u8)])->Score {
        Score{ppq,duration,midi_format:Some(1),parts:vec![],notes:vec![],track_ends:vec![duration],attachments:events.iter().enumerate().map(|(i,&(tick,n,d,c,b))|ScoreAttachment{tick,track:0,order:i as u64,bytes:vec![255,88,4,n,d,c,b]}).collect()}
    }
    #[test]
    fn compound_meter_is_six_eighths_not_three_quarters_and_changes_continue_bars() {
        let source=score(48,480,&[(0,6,3,36,8),(288,4,2,24,8)]);let before=source.clone();
        let m=score_meter(&source,&ScoreMeterOptions::default()).unwrap();assert_eq!(source,before);
        assert_eq!(m.segments[0].numerator,Some(6));assert_eq!(m.segments[0].denominator,Some(8));
        assert_eq!(m.markers.iter().find(|p|p.tick==120.).unwrap().label,"1:6");
        assert_eq!(m.markers.iter().find(|p|p.tick==144.).unwrap().label,"2:1");
        assert_eq!(m.markers.iter().find(|p|p.tick==288.).unwrap().label,"3:1");
        assert_eq!(m.markers.iter().find(|p|p.tick==336.).unwrap().label,"3:2");
    }
    #[test]
    fn nonintegral_beats_and_unusual_bb_remain_exact() {
        let m=score_meter(&score(3,6,&[(0,3,3,24,8)]),&ScoreMeterOptions::default()).unwrap();
        assert_eq!(m.markers[1].exact_tick,exact(3,2));assert_eq!(m.markers[1].tick,1.5);
        let m=score_meter(&score(3,6,&[(0,3,3,24,16)]),&ScoreMeterOptions::default()).unwrap();
        assert_eq!(m.markers[1].exact_tick,exact(3,4));
    }
    #[test]
    fn missing_unsupported_and_conflicting_metadata_do_not_assert_meter() {
        let empty=score_meter(&score(4,12,&[]),&ScoreMeterOptions::default()).unwrap();
        assert!(empty.markers.iter().all(|m|m.bar.is_none()&&m.kind==MeterMarkerKind::Quarter));
        let m=score_meter(&score(4,32,&[(0,4,2,24,8),(8,0,2,24,8),(16,3,2,24,8),(16,6,3,36,8)]),&ScoreMeterOptions::default()).unwrap();
        assert_eq!(m.segments[1].source,MeterSource::Unsupported);assert_eq!(m.segments[2].source,MeterSource::Conflict);
    }
    #[test]
    fn repeated_signature_does_not_reset_phase_and_partial_change_is_explicit() {
        let m=score_meter(&score(4,40,&[(0,4,2,24,8),(5,4,2,24,8),(20,3,2,24,8)]),&ScoreMeterOptions::default()).unwrap();
        assert_eq!(m.segments.len(),2);assert_eq!(m.markers.iter().find(|p|p.tick==16.).unwrap().label,"2:1");
        assert_eq!(m.markers.iter().find(|p|p.tick==20.).unwrap().label,"3:1");assert!(m.diagnostics.iter().any(|s|s.contains("cuts the previous")));
    }
    #[test]
    fn bounded_range_admission_does_not_truncate_or_rebase_global_bar_indices() {
        let s=score(4,80,&[(0,4,2,24,8)]);
        assert!(score_meter(&s,&ScoreMeterOptions{max_markers:Some(2),..Default::default()}).is_err());
        let m=score_meter(&s,&ScoreMeterOptions{from_tick:Some(32),to_tick:Some(39),max_markers:Some(2)}).unwrap();
        assert_eq!(m.markers.len(),2);assert_eq!(m.markers[0].label,"3:1");
    }
}
