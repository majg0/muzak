import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { callCoreSync } from '../src/core/sync';
import { evaluateBoundaries } from '../src/score/evaluation';
import { exportScoreMidi, importMidi } from '../src/score/midi-score';
import type { Score } from '../src/score/score';
import type { GlobalHarmonyAnalysis } from '../src/core/generated/GlobalHarmonyAnalysis';
import type { HarmonyOptions } from '../src/core/generated/HarmonyOptions';
import { sliceScore } from '../src/score/operations';
import { coreMethodFiles } from './core-source';
import { writeAuditJson } from './audit-output';

type Row = Record<string, string>;
interface Asset { path: string; sha256: string }
export interface HarmonyWork {
  id: string; split: string; scorePpq?: number; scoreNotes: Asset; scoreMusicXml: Asset; harmonicAnalysis: Asset;
}
interface Corpus { id: string; root: string; split: { development: string[]; holdout: string[] }; works: HarmonyWork[] }
interface XmlNote { offset: number; measure: string; measureEnd: number; meter: [number, number]; issue?: string }
export interface HarmonicReference {
  startTick: number; endTick: number; label: string; root: number | null;
  core: number[]; added: number[]; issue?: string;
}
export interface HarmonyPrediction { windows: Array<{
  startTick: number; endTick: number; selected: number | null;
  alternatives: Array<{ rootMillicents: number; coreIntervals: number[]; colorIntervals: number[] }>;
  functionalRoot?: { rootMillicents: number; realizationAlternativeIndex: number };
}> }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const integer = (value: string, name: string) => {
  if (!/^-?\d+$/.test(value)) throw new Error(`Invalid integer ${name}.`);
  const n = Number(value); if (!Number.isSafeInteger(n)) throw new Error(`Unsafe integer ${name}.`); return n;
};
const pc = (value: number) => ((value % 1_200_000) + 1_200_000) % 1_200_000;
const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
const same = <T>(a: T[], b: T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface HarmonyRunnerArguments {
  prepare: boolean; diagnostics: boolean; oracle: boolean; compact: boolean;
  native?: string; optionsPath?: string; output?: string;
}
/** Parsing this CLI must not read a corpus or silently ignore experiment flags. */
export function parseHarmonyArguments(args: string[]): HarmonyRunnerArguments {
  const result: HarmonyRunnerArguments = { prepare: false, diagnostics: false, oracle: false, compact: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const [flag, ...suffix] = args[i].split('='), inline = suffix.length ? suffix.join('=') : undefined;
    if (seen.has(flag)) throw new Error(`Duplicate argument ${flag}.`); seen.add(flag);
    if (['--prepare', '--diagnostics', '--oracle', '--compact'].includes(flag)) {
      if (inline !== undefined) throw new Error(`Flag ${flag} takes no value.`);
      result[flag.slice(2) as 'prepare'|'diagnostics'|'oracle'|'compact'] = true;
    } else if (flag === '--native') {
      result.native = inline ?? resolve('target/debug', process.platform === 'win32' ? 'muzak-core.exe' : 'muzak-core');
      if (!result.native) throw new Error('Empty native executable path.');
    } else if (flag === '--options' || flag === '--out') {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      result[flag === '--options' ? 'optionsPath' : 'output'] = value;
    } else throw new Error(`Unknown argument ${flag}. Usage: tsx scripts/evaluate-harmony.ts [--native[=executable]] [--options=file] [--out file] [--compact] [--diagnostics] [--oracle] [--prepare]. Holdout evaluation is unavailable.`);
  }
  if (result.prepare && (result.diagnostics || result.oracle || result.optionsPath)) throw new Error('--prepare cannot infer or accept model options.');
  return result;
}

type HarmonyInfer = (score: Score, options?: Partial<HarmonyOptions>) => Promise<GlobalHarmonyAnalysis>;
/** One native child, one request/reply stream: no per-window process starts. */
export function nativeHarmonyBackend(executable: string): { infer: HarmonyInfer; close: () => Promise<void> } {
  const child = spawn(resolve(executable), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending: Array<{ resolve: (value: GlobalHarmonyAnalysis) => void; reject: (error: Error) => void }> = [];
  let failure: Error | undefined, stderr = '', ended = false;
  const fail = (error: Error) => { failure ??= error; for (const waiter of pending.splice(0)) waiter.reject(error); };
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8192); });
  child.on('error', error => fail(error));
  child.stdin.on('error', error => fail(error));
  const completion = new Promise<void>(resolveClose => child.on('close', code => {
    ended = true;
    if (pending.length || code !== 0) fail(new Error(`Native harmony core exited (${code}): ${stderr}`));
    resolveClose();
  }));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const waiter = pending.shift();
    if (!waiter) { fail(new Error('Unexpected native harmony response.')); child.kill(); return; }
    try {
      const reply = JSON.parse(line);
      if (reply.error) { waiter.reject(new Error(`${reply.error.code}: ${reply.error.message}`)); return; }
      if (reply.response?.op !== 'inferGlobalHarmony') throw new Error('Mismatched native harmony response.');
      waiter.resolve(reply.response.output as GlobalHarmonyAnalysis);
    } catch (error) { waiter.reject(error instanceof Error ? error : new Error(String(error))); fail(new Error('Invalid native harmony response.')); child.kill(); }
  });
  return {
    infer: (score, options) => {
      if (failure || ended) return Promise.reject(failure ?? new Error('Native harmony backend is closed.'));
      let request: string;
      try { request = JSON.stringify({ op: 'inferGlobalHarmony', input: { score, options } }, (_key, value) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Native harmony input numbers must be finite.');
        return value;
      }); } catch (error) { return Promise.reject(error); }
      return new Promise((resolveReply, reject) => {
        pending.push({ resolve: resolveReply, reject });
        child.stdin.write(`${request}\n`, error => { if (error) fail(error); });
      });
    },
    close: async () => { if (!ended) child.stdin.end(); await completion; lines.close(); },
  };
}

/** Strict delimited records, including quoted commas/newlines and doubled quotes. */
export function parseTable(text: string, delimiter = ','): Row[] {
  const records: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
    if (c === '"') { if (field || closed) throw new Error('Invalid quoted table field.'); quoted = true; }
    else if (c === delimiter) { row.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v !== '')) records.push(row); row = []; field = ''; closed = false;
    } else { if (closed) throw new Error('Unexpected text after table quote.'); field += c; }
  }
  if (quoted) throw new Error('Unterminated table quote.');
  if (field || row.length) { row.push(field); records.push(row); }
  const header = records.shift(); if (header?.length) header[0] = header[0].replace(/^\uFEFF/, '');
  if (!header?.length || header.some(v => !v) || new Set(header).size !== header.length) throw new Error('Invalid table header.');
  return records.map(values => { if (values.length !== header.length) throw new Error('Ragged table row.'); return Object.fromEntries(header.map((key, i) => [key, values[i]])); });
}

/** This deliberately small reader admits the one-part, fixed-division author
 * MusicXML edition. It derives measure offsets from note/backup/forward events;
 * it does not pretend to be a general MusicXML renderer or repeat expander. */
function xmlTiming(text: string, ppq: number): Map<string, XmlNote> {
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  if ([...text.matchAll(/<part(?=[\s>])/g)].length !== 1) throw new Error('Expected one piano part in source MusicXML.');
  const divisions = [...text.matchAll(/<divisions>\s*(\d+)\s*<\/divisions>/g)].map(m => Number(m[1]));
  if (!divisions.length || divisions.some(d => d !== ppq)) throw new Error('Unsupported or mismatching MusicXML divisions.');
  const result = new Map<string, XmlNote>(); let meter: [number, number] | undefined;
  for (const measure of text.matchAll(/<measure\b[^>]*\bnumber="([^"]+)"[^>]*>([\s\S]*?)<\/measure>/g)) {
    const time = /<time\b[^>]*>([\s\S]*?)<\/time>/.exec(measure[2]);
    if (time) {
      const beats = /<beats>(\d+)<\/beats>/.exec(time[1]), type = /<beat-type>(\d+)<\/beat-type>/.exec(time[1]);
      if (!beats || !type) throw new Error('Unsupported source meter.');
      meter = [Number(beats[1]), Number(type[1])];
      if (meter[0] < 1 || meter[0] > 255 || !Number.isInteger(Math.log2(meter[1]))) throw new Error('Unsupported source meter.');
    }
    if (!meter) throw new Error('Missing initial source meter.');
    let cursor = 0, previous = 0, end = 0, issue: string | undefined; const members: XmlNote[] = [];
    for (const token of measure[2].matchAll(/<(note|backup|forward)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const duration = /<duration>(\d+)<\/duration>/.exec(token[3]);
      const d = duration ? integer(duration[1], 'XML duration') : 0;
      if (token[1] !== 'note') { if (!duration) throw new Error('Missing XML motion duration.'); cursor += token[1] === 'backup' ? -d : d; }
      else {
        const chord = /<chord\s*\/>/.test(token[3]), onset = chord ? previous : cursor;
        if (!chord) { previous = onset; cursor += d; }
        const id = /\bid="([^"]+)"/.exec(token[2]);
        if (id) {
          if (result.has(id[1])) throw new Error('Repeated XML note ID.');
          const note = { offset: onset, measure: measure[1], measureEnd: 0, meter }; result.set(id[1], note); members.push(note);
        }
        end = Math.max(end, onset + d);
      }
      if (!Number.isSafeInteger(cursor)) throw new Error('Unsafe source measure cursor.');
      if (cursor < 0) issue = `Source XML measure ${measure[1]} moves before its start after comments are excluded.`;
      end = Math.max(end, cursor);
    }
    for (const note of members) { note.measureEnd = end; if (issue) note.issue = issue; }
  }
  if (!result.size) throw new Error('No source MusicXML notes.'); return result;
}

export function scoreObservations(rows: Row[], xml: string, ppq: number): { score: Score; xmlNotes: Map<string, XmlNote> } {
  if (!Number.isSafeInteger(ppq) || ppq < 1 || ppq > 32767 || rows.length > 100_000) throw new Error('Unsupported score observation bounds.');
  const xmlNotes = xmlTiming(xml, ppq), voices = [...new Set(rows.map(r => integer(r.voice, 'voice')))].sort((a, b) => a - b);
  const parts = voices.map((voice, i) => ({ id: `notation-voice-${voice}`, name: `Notated voice ${voice}`, track: i + 1, channel: 0, percussion: false }));
  let duration = 0; const meters = new Map<number, [number, number]>(), ids = new Set<string>(), measureStarts = new Map<string, number>();
  const notes = rows.map(r => {
    const onset = integer(r.onset_div, 'onset_div'), length = integer(r.duration_div, 'duration_div'), pitch = integer(r.pitch, 'pitch');
    const original = xmlNotes.get(r.id.replace(/-\d+$/, ''));
    if (!original || original.measure !== r.xml_mn) throw new Error(`Unmatched source XML note ${r.id}.`);
    if (onset < 0 || length < 0 || pitch < 0 || pitch > 127 || !r.id || ids.has(r.id)) throw new Error('Invalid or duplicate score note.'); ids.add(r.id);
    const measureStart = onset - original.offset;
    if (measureStart < 0) throw new Error('Negative unfolded measure start.');
    const occurrence = `${r.xml_mn}:${r.id.match(/-(\d+)$/)?.[1] ?? 'original'}`;
    if (!original.issue) {
      const start = measureStarts.get(occurrence);
      if (start !== undefined && start !== measureStart) throw new Error('Score observations disagree on unfolded XML measure start.');
      measureStarts.set(occurrence, measureStart);
    }
    const existing = meters.get(measureStart); if (!original.issue && existing && !same(existing, original.meter)) throw new Error('Conflicting unfolded meter.');
    const end = Math.max(onset + length, original.issue ? 0 : measureStart + original.measureEnd);
    if (!Number.isSafeInteger(end)) throw new Error('Unsafe score end.');
    if (!original.issue) meters.set(measureStart, original.meter); duration = Math.max(duration, end);
    return { id: r.id, part: `notation-voice-${integer(r.voice, 'voice')}`, onset, duration: length, pitch: { millicents: pitch * 100_000 }, velocity: 80, releaseVelocity: 64 };
  });
  const attachments: Score['attachments'] = [{ tick: 0, track: 0, order: 0, bytes: [255, 81, 3, 7, 161, 32] }];
  let previous: [number, number] | undefined;
  for (const [tick, meter] of [...meters].sort(([a], [b]) => a - b)) if (!previous || !same(meter, previous)) {
    attachments.push({ tick, track: 0, order: attachments.length, bytes: [255, 88, 4, meter[0], Math.log2(meter[1]), 24, 8] }); previous = meter;
  }
  for (const part of parts) {
    // The source's numeric voice identifiers produce short ASCII names, so
    // the MIDI track-name payload length fits one VLQ byte.
    const name = [...new TextEncoder().encode(part.name)];
    attachments.push({ tick: 0, track: part.track, order: 0, bytes: [255, 3, name.length, ...name] });
  }
  return { score: { ppq, duration, parts, notes, attachments, trackEnds: Array(parts.length + 1).fill(duration) }, xmlNotes };
}

/** DCML expanded tones are fifth stacks relative to LOCAL tonic. Roman-key
 * slash chains are resolved from right to left with each denominator's mode. */
export function localTonic(global: string, local: string): number {
  const g = /^([A-Ga-g])([#b]*)$/.exec(global); if (!g) throw new Error('Unsupported global key.');
  let semitones = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[g[1].toUpperCase()]
    + [...g[2]].reduce((a, c) => a + (c === '#' ? 1 : -1), 0), minor = g[1] === g[1].toLowerCase();
  for (const key of local.split('/').reverse()) {
    const m = /^([#b]*)([ivIV]+)$/.exec(key); if (!m) throw new Error('Unsupported relative key.');
    const degree = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].indexOf(m[2].toUpperCase());
    if (degree < 0 || (m[2] !== m[2].toUpperCase() && m[2] !== m[2].toLowerCase())) throw new Error('Unsupported relative degree.');
    semitones += (minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11])[degree] + [...m[1]].reduce((a, c) => a + (c === '#' ? 1 : -1), 0);
    minor = m[2] === m[2].toLowerCase();
  }
  return pc(semitones * 100_000);
}
function fifths(text: string): number[] { return text.trim() ? text.split(',').map(v => integer(v.trim(), 'fifths')) : []; }
const fifthPc = (tonic: number, fifth: number) => pc(tonic + Number((BigInt(fifth) * 7n) % 12n) * 100_000);
function onsetFraction(text: string): [bigint, bigint] {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(text); if (!m || m[2] === '0') throw new Error('Unsupported original annotation fraction.'); return [BigInt(m[1]), BigInt(m[2] ?? 1)];
}
const joinKey = (r: Row) => JSON.stringify(['mn', 'label', 'globalkey', 'localkey', 'chord'].map(k => r[k]));
export function alignReferences(rows: Row[], expanded: Row[], xmlNotes: Map<string, XmlNote>, score: Score) {
  const lookup = new Map<string, Row[]>(); for (const r of expanded) { const key = joinKey(r); lookup.set(key, [...(lookup.get(key) ?? []), r]); }
  const events = rows.filter(r => r.chord).sort((a, b) => integer(a.onset_div, 'onset') - integer(b.onset_div, 'onset'));
  const references: HarmonicReference[] = []; let inheritedDurationOverlaps = 0;
  for (let i = 0; i < events.length; i++) {
    const r = events[i], startTick = integer(r.onset_div, 'annotation onset'), endTick = i + 1 < events.length ? integer(events[i + 1].onset_div, 'annotation onset') : score.duration;
    if (endTick <= startTick) throw new Error('Duplicate or nonincreasing harmonic annotation onset.');
    if (Number(r.duration_qb) * score.ppq > endTick - startTick + 1e-5) inheritedDurationOverlaps++;
    const reference: HarmonicReference = { startTick, endTick, label: r.label, root: null, core: [], added: [] };
    try {
      const original = xmlNotes.get(r.id.replace(/-\d+$/, '')); if (!original) throw new Error('Missing XML note anchor.');
      if (original.issue) throw new Error(original.issue);
      const matched = lookup.get(joinKey(r)) ?? []; if (!matched.length) throw new Error('Missing independent harmonic label.');
      const aligned = matched.filter(s => { const [n, d] = onsetFraction(s.mn_onset); return BigInt(original.offset) * d === n * 4n * BigInt(score.ppq); });
      if (!aligned.length) throw new Error('Joined note onset disagrees with independent within-measure annotation.');
      const tonal = new Map<string, { root: number; core: number[]; added: number[] }>();
      for (const s of aligned) {
        const tonic = localTonic(s.globalkey, s.localkey), value = { root: fifthPc(tonic, integer(s.root, 'root fifths')),
          core: unique(fifths(s.chord_tones).map(v => fifthPc(tonic, v))), added: unique(fifths(s.added_tones).map(v => fifthPc(tonic, v))) };
        if (!value.core.length) throw new Error('Empty independent chord-tone set.'); tonal.set(JSON.stringify(value), value);
      }
      if (tonal.size !== 1) throw new Error('Ambiguous independent harmonic interpretation.'); Object.assign(reference, [...tonal.values()][0]);
    } catch (error) { reference.issue = String(error); }
    references.push(reference);
  }
  return { references, diagnostics: { joinedLabelRows: rows.filter(r => r.label).length, chordRows: events.length,
    phraseOnlyRows: rows.filter(r => r.label && !r.chord).length, inheritedDurationOverlaps,
    unsupported: references.filter(r => r.issue).map(r => ({ startTick: r.startTick, endTick: r.endTick, label: r.label, reason: r.issue })) } };
}

/** Admission precedes every file read, including hash checks. */
export function loadDevelopment(work: HarmonyWork, read: (path: string) => Buffer = readFileSync) {
  if (work.split !== 'development') throw new Error('Heldout harmonic references are unavailable in this runner.');
  const acquire = (asset: Asset) => { const bytes = read(asset.path); if (hash(bytes) !== asset.sha256) throw new Error(`Source hash mismatch: ${asset.path}`); return bytes.toString('utf8'); };
  const rows = parseTable(acquire(work.scoreNotes)), xml = acquire(work.scoreMusicXml), expanded = parseTable(acquire(work.harmonicAnalysis), '\t');
  const { score, xmlNotes } = scoreObservations(rows, xml, work.scorePpq ?? 0);
  const aligned = alignReferences(rows, expanded, xmlNotes, score);
  return { score, ...aligned, diagnostics: { ...aligned.diagnostics, sourceXmlIssues: [...new Set([...xmlNotes.values()].flatMap(n=>n.issue ? [n.issue] : []))] } };
}

function signature(reference: Pick<HarmonicReference, 'root' | 'core'>) { return JSON.stringify([reference.root, reference.core]); }
const absoluteCore = (root: number, intervals: number[]) => unique(intervals.map(p=>pc(pc(root)+pc(p))));
type PredictedWindow = HarmonyPrediction['windows'][number];
const hasFunctionalRoot = (window: PredictedWindow) => window.selected !== null
  && window.functionalRoot?.realizationAlternativeIndex === window.selected;
const predictedRoot = (window: PredictedWindow, index: number) => pc(
  index === window.selected && hasFunctionalRoot(window) ? window.functionalRoot!.rootMillicents : window.alternatives[index].rootMillicents);

/** Offline evaluation only. Labels classify failures after blind inference;
 * default template reachability is a representation ceiling, not accuracy. */
export function diagnoseHarmony(score: Score, analysis: GlobalHarmonyAnalysis, references: HarmonicReference[]) {
  const templates = analysis.parameters.templates;
  const shapes = new Map<string,{relativeCore:number[];count:number;ticks:number;labels:string[];coreReachable:boolean;flatJointReachable:boolean}>();
  const categories: Record<string,{ticks:number;overlaps:number}> = {};
  const errorPartition = { correctTicks: 0, unrepresentableCoreTicks: 0, flatRootRealizationGapErrorTicks: 0,
    flatRepresentableUnselectedTicks: 0, flatRepresentableSelectedWrongTicks: 0 };
  const functionalExtension = { appliedWindows: analysis.windows.filter(hasFunctionalRoot).length,
    appliedReferenceTicks: 0, changedRootReferenceTicks: 0, jointCorrectTicks: 0 };
  let referenceTicks=0,coreReachableTicks=0,jointReachableTicks=0,missingObservedCoreTicks=0;
  const perReference = references.filter(r=>!r.issue&&r.root!==null).map((r,index)=>{
    const ticks=r.endTick-r.startTick; referenceTicks+=ticks;
    const relativeCore=unique(r.core.map(p=>pc(p-r.root!)));
    const sameRootTemplates=templates.filter(t=>same(absoluteCore(r.root!,t.coreIntervals),r.core)).map(t=>t.id);
    const coreMatches=templates.flatMap(t=>Array.from({length:12},(_,root)=>({root:root*100_000,template:t.id,core:absoluteCore(root*100_000,t.coreIntervals)})).filter(t=>same(t.core,r.core)).map(({root,template})=>({root,template})));
    if(coreMatches.length)coreReachableTicks+=ticks;if(sameRootTemplates.length)jointReachableTicks+=ticks;
    const notes=score.notes.filter(n=>n.duration>0 ? n.onset<r.endTick&&n.onset+n.duration>r.startTick : n.onset>=r.startTick&&n.onset<r.endTick);
    const observed=unique(notes.filter(n=>n.duration>0&&!score.parts.find(p=>p.id===n.part)!.percussion).map(n=>pc(n.pitch.millicents)));
    const missingCore=r.core.filter(p=>!observed.includes(p));if(missingCore.length)missingObservedCoreTicks+=ticks;
    const key=JSON.stringify(relativeCore),shape=shapes.get(key)??{relativeCore,count:0,ticks:0,labels:[],coreReachable:coreMatches.length>0,flatJointReachable:sameRootTemplates.length>0};shape.count++;shape.ticks+=ticks;
    if(shape.labels.length<5&&!shape.labels.includes(r.label))shape.labels.push(r.label);shapes.set(key,shape);
    let jointCorrectTicks=0;
    const predictions=analysis.windows.filter(w=>w.startTick<r.endTick&&w.endTick>r.startTick).map(w=>{
      const overlapTicks=Math.min(w.endTick,r.endTick)-Math.max(w.startTick,r.startTick),h=w.selected===null?undefined:w.alternatives[w.selected];
      const root=h?predictedRoot(w,w.selected!):null,core=h?absoluteCore(h.rootMillicents,h.coreIntervals):[];
      const category=!h?'unselected':same(core,r.core)?root===r.root?'root-and-core-correct':'core-correct-root-wrong':root===r.root?'root-correct-core-wrong':'root-and-core-wrong';
      const total=categories[category]??{ticks:0,overlaps:0};total.ticks+=overlapTicks;total.overlaps++;categories[category]=total;
      if(category==='root-and-core-correct')jointCorrectTicks+=overlapTicks;
      if (category === 'root-and-core-correct') errorPartition.correctTicks += overlapTicks;
      else if (!coreMatches.length) errorPartition.unrepresentableCoreTicks += overlapTicks;
      else if (!sameRootTemplates.length) errorPartition.flatRootRealizationGapErrorTicks += overlapTicks;
      else if (!h) errorPartition.flatRepresentableUnselectedTicks += overlapTicks;
      else errorPartition.flatRepresentableSelectedWrongTicks += overlapTicks;
      const functionalRootApplied=hasFunctionalRoot(w);
      if(functionalRootApplied){
        functionalExtension.appliedReferenceTicks+=overlapTicks;
        if(root!==pc(h!.rootMillicents))functionalExtension.changedRootReferenceTicks+=overlapTicks;
        if(category==='root-and-core-correct')functionalExtension.jointCorrectTicks+=overlapTicks;
      }
      return {startTick:w.startTick,endTick:w.endTick,overlapTicks,root,realizationRoot:h?pc(h.rootMillicents):null,functionalRootApplied,core,label:h?.label??null,category,extendsOutsideReference:w.startTick<r.startTick||w.endTick>r.endTick};
    });
    return {index,startTick:r.startTick,endTick:r.endTick,startQuarter:r.startTick/score.ppq,endQuarter:r.endTick/score.ppq,label:r.label,root:r.root,core:r.core,added:r.added,
      jointCorrectTicks,jointErrorTicks:ticks-jointCorrectTicks,sameRootTemplates,coreMatches,missingObservedCore:missingCore,predictions,
      notesByPart:score.parts.map(part=>({part:part.id,name:part.name,notes:notes.filter(n=>n.part===part.id).map(n=>({id:n.id,onset:n.onset,duration:n.duration,pitch:n.pitch.millicents,carriedIn:n.onset<r.startTick}))})).filter(p=>p.notes.length)};
  });
  const adjacentRelations={sameRootSameCore:0,sameRootChangedCore:0,changedRootSameCore:0,changedRootAndCore:0};
  for(let i=1;i<perReference.length;i++){
    const a=perReference[i-1],b=perReference[i];if(a.endTick!==b.startTick)continue;
    const key=a.root===b.root ? same(a.core,b.core)?'sameRootSameCore':'sameRootChangedCore' : same(a.core,b.core)?'changedRootSameCore':'changedRootAndCore';
    adjacentRelations[key]++;
  }
  return {definition:'Development-only comparison of fixed blind predictions with independent labels. Flat-template joint ceilings exclude functional-root extensions and are not ceilings for the extended model. Missing observed classes do not establish annotation error.',
    referenceTicks,coreReachableTicks,flatJointReachableTicks:jointReachableTicks,coreVocabularyCeiling:referenceTicks?coreReachableTicks/referenceTicks:null,
    flatJointVocabularyCeiling:referenceTicks?jointReachableTicks/referenceTicks:null,missingObservedCoreTicks,categories,adjacentRelations,
    functionalExtension: { definition:'Applied functional roots matching the selected realization; duration counts only supported reference overlap. The realized pitch-class set is unchanged.',...functionalExtension },
    errorPartition: { definition: 'Disjoint overlap-duration buckets. Correct extended predictions are counted first; remaining root-realization gaps refer only to flat templates, not extended-model impossibility. No change to the strict denominator.', ...errorPartition },
    shapes:[...shapes.values()].sort((a,b)=>b.ticks-a.ticks),first16Quarters:perReference.filter(r=>r.startQuarter<16).map(r=>r.index),
    worstByErrorDuration:[...perReference].sort((a,b)=>b.jointErrorTicks-a.jointErrorTicks||a.startTick-b.startTick).slice(0,12).map(r=>r.index),perReference};
}

/** Annotation boundaries are supplied only to this explicitly offline oracle.
 * No reference root, tone set, key or label is passed to inference. */
function oracleCrop(score: Score, r: HarmonicReference): Score {
  const cropped=sliceScore(score,r.startTick,r.endTick,{boundary:'clip'});
  const meter=score.attachments.filter(e=>e.tick<=r.startTick&&e.bytes[0]===255&&e.bytes[1]===88).sort((a,b)=>a.tick-b.tick||a.order-b.order).at(-1);
  if(meter&&!cropped.attachments.some(e=>e.tick===0&&e.bytes[0]===255&&e.bytes[1]===88)){
    const order=1+Math.max(-1,...cropped.attachments.filter(e=>e.track===meter.track).map(e=>e.order));
    cropped.attachments.push({...meter,tick:0,order,bytes:[...meter.bytes]});
  }
  return cropped;
}
export function oracleHarmony(score: Score, references: HarmonicReference[], parameters: HarmonyOptions,
  infer = (cropped: Score, options: Partial<HarmonyOptions>) => callCoreSync('inferGlobalHarmony', { score: cropped, options })) {
  const options={...parameters,boundaryCost:1000,weakBoundaryCost:0,maxSpanSteps:parameters.maxLatticePoints};
  const totals={referenceTicks:0,selectedTicks:0,coreCorrectTicks:0,rootCorrectTicks:0,jointCorrectTicks:0};
  const forced={candidateTicks:0,coreCorrectTicks:0,rootCorrectTicks:0,jointCorrectTicks:0}, contained={coreTicks:0,rootTicks:0,jointTicks:0};
  const intervals=references.filter(r=>!r.issue&&r.root!==null).map((r,index)=>{
    totals.referenceTicks+=r.endTick-r.startTick;
    const cropped=oracleCrop(score,r), analysis=infer(cropped,options);
    const only=analysis.windows.length===1&&analysis.windows[0].startTick===0&&analysis.windows[0].endTick===cropped.duration;
    if(!only)return{index,startTick:r.startTick,endTick:r.endTick,status:'unavailable',reason:'Maximum admitted boundary penalty did not yield exactly one complete span.',windows:analysis.windows.length};
    const metric=evaluateHarmony(analysis,[{...r,startTick:0,endTick:cropped.duration}],cropped.ppq,cropped.duration);
    for(const key of Object.keys(totals) as (keyof typeof totals)[])if(key!=='referenceTicks')totals[key]+=metric[key];
    const window=analysis.windows[0],selected=window.selected===null?null:window.alternatives[window.selected];
    const ranked=window.alternatives.map((h,i)=>({core:same(absoluteCore(h.rootMillicents,h.coreIntervals),r.core),root:predictedRoot(window,i)===r.root}));
    const ticks=r.endTick-r.startTick;
    if(ranked.length)forced.candidateTicks+=ticks;
    if(ranked[0]?.core)forced.coreCorrectTicks+=ticks;if(ranked[0]?.root)forced.rootCorrectTicks+=ticks;
    if(ranked[0]?.core&&ranked[0]?.root)forced.jointCorrectTicks+=ticks;
    if(ranked.some(h=>h.core))contained.coreTicks+=ticks;if(ranked.some(h=>h.root))contained.rootTicks+=ticks;if(ranked.some(h=>h.core&&h.root))contained.jointTicks+=ticks;
    const rank=(predicate:(h:typeof ranked[number])=>boolean)=>{const index=ranked.findIndex(predicate);return index<0?null:index+1;};
    return{index,startTick:r.startTick,endTick:r.endTick,label:r.label,status:'evaluated',notes:cropped.notes.length,
      carriedIn:score.notes.filter(n=>n.onset<r.startTick&&n.onset+n.duration>r.startTick).length,
      selected,functionalRoot:(window as PredictedWindow).functionalRoot??null,alternatives:window.alternatives,ambiguityGap:window.ambiguityGap,referenceCoreRank:rank(h=>h.core),referenceRootRank:rank(h=>h.root),referenceJointRank:rank(h=>h.core&&h.root),
      metric:{core:metric.coreAccuracy,root:metric.rootAccuracy,joint:metric.jointAccuracy}};
  });
  return{definition:'Offline annotated-boundary, forced-single-span diagnostic. Root/core labels never enter inference; output alternatives are not chosen by reference agreement.',
    interventions:{boundaryCost:options.boundaryCost,weakBoundaryCost:options.weakBoundaryCost,maxSpanSteps:options.maxSpanSteps},
    limitations:['Rust clipping creates attacks at the crop boundary for carried notes.','Prior source meter is restored, but phase rebases to zero and neighboring harmonic/voice-leading context is removed.','First-rank fit is local to the forced span; contextual gaps condition on searched subdivisions and are not posterior probabilities.','This is not a production score or unbiased generalization metric.'],
    summary:{...totals,evaluatedIntervals:intervals.filter(r=>r.status==='evaluated').length,unavailableIntervals:intervals.filter(r=>r.status!=='evaluated').length,
      selectedCoverage:totals.referenceTicks?totals.selectedTicks/totals.referenceTicks:null,coreAccuracy:totals.referenceTicks?totals.coreCorrectTicks/totals.referenceTicks:null,
      rootAccuracy:totals.referenceTicks?totals.rootCorrectTicks/totals.referenceTicks:null,jointAccuracy:totals.referenceTicks?totals.jointCorrectTicks/totals.referenceTicks:null,
      forcedFirstRank:{definition:'First ranked candidate even when the model abstains; no reference-dependent choice.',...forced,
        coreAccuracy:totals.referenceTicks?forced.coreCorrectTicks/totals.referenceTicks:null,rootAccuracy:totals.referenceTicks?forced.rootCorrectTicks/totals.referenceTicks:null,jointAccuracy:totals.referenceTicks?forced.jointCorrectTicks/totals.referenceTicks:null},
      retainedCandidateContainment:{definition:'Reference-dependent oracle upper bound within retained alternatives, not a prediction.',maxK:parameters.maxAlternatives,...contained,
        coreCoverage:totals.referenceTicks?contained.coreTicks/totals.referenceTicks:null,rootCoverage:totals.referenceTicks?contained.rootTicks/totals.referenceTicks:null,jointCoverage:totals.referenceTicks?contained.jointTicks/totals.referenceTicks:null}},intervals};
}
export function evaluateHarmony(predicted: HarmonyPrediction, references: HarmonicReference[], ppq: number, duration: number, lattice?: readonly {tick:number;changeSupported?:boolean}[]) {
  if (!Number.isSafeInteger(ppq) || ppq < 1 || !Number.isSafeInteger(duration) || duration < 0) throw new Error('Invalid metric timebase.');
  for (const [i, r] of references.entries()) {
    if (!Number.isSafeInteger(r.startTick) || !Number.isSafeInteger(r.endTick) || r.startTick < 0 || r.endTick <= r.startTick || r.endTick > duration || (i > 0 && r.startTick < references[i - 1].endTick)) throw new Error('Invalid or overlapping reference interval.');
    if (!r.issue && (r.root === null || ![r.root, ...r.core, ...r.added].every(p => Number.isSafeInteger(p) && p >= 0 && p < 1_200_000) || !r.core.length || !same(r.core, unique(r.core)) || !same(r.added, unique(r.added)))) throw new Error('Invalid reference pitch-class sets.');
  }
  const windows = predicted.windows.map(w => {
    if (!Number.isSafeInteger(w.startTick) || !Number.isSafeInteger(w.endTick) || w.startTick < 0 || w.endTick <= w.startTick || w.endTick > duration) throw new Error('Invalid predicted harmony window.');
    if (w.selected !== null && (!Number.isInteger(w.selected) || !w.alternatives[w.selected])) throw new Error('Invalid selected harmony alternative.');
    const selected = w.selected === null ? undefined : w.alternatives[w.selected];
    const pitches = selected ? [selected.rootMillicents, ...selected.coreIntervals, ...selected.colorIntervals] : [];
    if (pitches.some(p => !Number.isSafeInteger(p))) throw new Error('Nonexact predicted harmonic pitch.');
    if(w.functionalRoot&&(!Number.isSafeInteger(w.functionalRoot.rootMillicents)||!Number.isInteger(w.functionalRoot.realizationAlternativeIndex)
      ||!w.alternatives[w.functionalRoot.realizationAlternativeIndex]))throw new Error('Invalid functional-root hypothesis.');
    return { ...w, root: selected ? predictedRoot(w,w.selected!) : null, core: selected ? unique(selected.coreIntervals.map(p => pc(pc(selected.rootMillicents) + pc(p)))) : [],
      added: selected ? unique(selected.colorIntervals.map(p => pc(pc(selected.rootMillicents) + pc(p)))) : [] };
  }).sort((a, b) => a.startTick - b.startTick);
  if (windows.some((w, i) => i > 0 && w.startTick < windows[i - 1].endTick)) throw new Error('Overlapping predicted harmony windows.');
  let referenceTicks = 0, selectedTicks = 0, coreCorrectTicks = 0, rootCorrectTicks = 0, jointCorrectTicks = 0, addedCorrectTicks = 0, explicitAddedReferenceTicks = 0, nonemptyAddedCorrectTicks = 0;
  for (const r of references) if (!r.issue && r.root !== null) {
    referenceTicks += r.endTick - r.startTick;
    if (r.added.length) explicitAddedReferenceTicks += r.endTick - r.startTick;
    for (const w of windows) {
      const overlap = Math.max(0, Math.min(r.endTick, w.endTick) - Math.max(r.startTick, w.startTick)); if (!overlap || w.root === null) continue;
      selectedTicks += overlap; const core = same(r.core, w.core), root = r.root === w.root;
      if (core) coreCorrectTicks += overlap; if (root) rootCorrectTicks += overlap; if (core && root) jointCorrectTicks += overlap;
      if (same(r.added, w.added)) { addedCorrectTicks += overlap; if (r.added.length) nonemptyAddedCorrectTicks += overlap; }
    }
  }
  const spans: HarmonicReference[][] = [];
  for (const r of references) {
    if (r.issue || r.root === null) continue;
    const last = spans.at(-1); if (last?.at(-1)?.endTick === r.startTick) last.push(r); else spans.push([r]);
  }
  const referenceChangeTicks = spans.flatMap(span=>span.flatMap((r,i)=>i > 0 && signature(r) !== signature(span[i-1]) ? [r.startTick] : []));
  let latticeAttainability: {referenceChanges:number;onLattice:number;fraction:number|null;offLatticeTicks:number[]} | undefined;
  let changeLatticeAttainability: typeof latticeAttainability;
  if (lattice) {
    const ticks = lattice.map(p=>p.tick);
    if (ticks.some(t=>!Number.isSafeInteger(t)||t<0||t>duration)||new Set(ticks).size!==ticks.length) throw new Error('Invalid inference lattice.');
    const available = new Set(ticks), offLatticeTicks = referenceChangeTicks.filter(t=>!available.has(t));
    latticeAttainability = {referenceChanges:referenceChangeTicks.length,onLattice:referenceChangeTicks.length-offLatticeTicks.length,
      fraction:referenceChangeTicks.length ? 1-offLatticeTicks.length/referenceChangeTicks.length : null,offLatticeTicks};
    if (lattice.some(p=>p.changeSupported!==undefined)) {
      if (lattice.some(p=>typeof p.changeSupported!=='boolean')) throw new Error('Incomplete change-supported inference lattice.');
      const eligible = new Set(lattice.filter(p=>p.changeSupported).map(p=>p.tick));
      const unavailable = referenceChangeTicks.filter(t=>!eligible.has(t));
      changeLatticeAttainability = {referenceChanges:referenceChangeTicks.length,onLattice:referenceChangeTicks.length-unavailable.length,
        fraction:referenceChangeTicks.length ? 1-unavailable.length/referenceChangeTicks.length : null,offLatticeTicks:unavailable};
    }
  }
  const predictionBoundaries = windows.flatMap((w, i) => i > 0 && windows[i - 1].endTick === w.startTick && w.root !== null && windows[i - 1].root !== null && signature(w) !== signature(windows[i - 1]) ? [w.startTick] : []);
  const boundaryMetric = (predictedTicks: number[], definition: string) => {
    const reports = spans.map((span, i) => {
      const start = span[0].startTick, end = span.at(-1)!.endTick;
      const actual = span.flatMap((r, j) => j > 0 && signature(r) !== signature(span[j - 1]) ? [r.startTick] : []);
      return evaluateBoundaries(predictedTicks.filter(t => t > start && t < end), [{id:`supported-span-${i}`,boundaries:actual}],
        {unit:'score ticks',tolerance:0,span:[start,end],endpoints:'exclude'})[0];
    });
    const matched = reports.reduce((n, r) => n + r.matches.length, 0), actual = reports.reduce((n, r) => n + r.referenceCount, 0), estimated = reports.reduce((n, r) => n + r.estimatedCount, 0);
    const precision = estimated ? matched / estimated : 1, recall = actual ? matched / actual : 1;
    return {definition,reference:'Interior changes of (root pitch class, chord-tone pitch-class set), ignoring inversion/key-name-only changes; unsupported intervals split the domain.',
      toleranceTicks:0,referenceCount:actual,estimatedCount:estimated,matched,precision:spans.length ? precision : null,recall:spans.length ? recall : null,
      f1:spans.length ? (precision+recall ? 2*precision*recall/(precision+recall) : 0) : null,spans:reports};
  };
  return { metric:'Exact selected reference-root and realized chord-tone pitch-class sets weighted by temporal overlap; a matching functional-root extension replaces only the root. Not key, Roman-degree, spelling or note-role accuracy.',
    referenceTicks, referenceQuarters:referenceTicks/ppq, selectedTicks, coreCorrectTicks, rootCorrectTicks, jointCorrectTicks, addedCorrectTicks,
    selectedCoverage:referenceTicks ? selectedTicks/referenceTicks : null, coreAccuracy:referenceTicks ? coreCorrectTicks/referenceTicks : null,
    rootAccuracy:referenceTicks ? rootCorrectTicks/referenceTicks : null, jointAccuracy:referenceTicks ? jointCorrectTicks/referenceTicks : null,
    explicitAddedSetAccuracy:referenceTicks ? addedCorrectTicks/referenceTicks : null,
    explicitAddedReferenceTicks, nonemptyAddedSetAccuracy:explicitAddedReferenceTicks ? nonemptyAddedCorrectTicks/explicitAddedReferenceTicks : null,
    latticeAttainability, changeLatticeAttainability,
    boundaries:boundaryMetric(predictionBoundaries,'Changes between adjacent selected root/core labels; ambiguity does not supply a label.'),
    segmentationBoundaries:boundaryMetric(unique(windows.flatMap(w=>[w.startTick,w.endTick])),'All inferred window starts/ends, including ambiguous and rest windows; independent of label selection.') };
}

export function compactHarmonyMetrics(metrics: ReturnType<typeof evaluateHarmony>) {
  const { spans: _selectedSpans, ...boundaries } = metrics.boundaries;
  const { spans: _allSpans, ...segmentationBoundaries } = metrics.segmentationBoundaries;
  return { ...metrics, boundaries, segmentationBoundaries };
}

/** Explicit offline oracle: each eligible lattice cell receives its best
 * reference label independently. This is an upper bound, never a prediction. */
export function latticeHarmonyCeiling(references: HarmonicReference[], lattice: readonly {tick:number;changeSupported?:boolean}[],
  duration: number, templates: HarmonyOptions['templates']) {
  // Reuse admission, including unsupported-reference handling and lattice
  // validation, without changing any strict agreement numerator/denominator.
  const metric=evaluateHarmony({windows:[]},references,1,duration,lattice);
  const ticks=lattice.filter(p=>p.tick===0||p.tick===duration||p.changeSupported!==false).map(p=>p.tick).sort((a,b)=>a-b);
  if(ticks[0]!==0||ticks.at(-1)!==duration)throw new Error('Lattice ceiling requires both score endpoints.');
  const coreVocabulary=new Set<string>(),jointVocabulary=new Set<string>();
  for(const template of templates)for(let root=0;root<1200000;root+=100000){
    const core=absoluteCore(root,template.coreIntervals);
    coreVocabulary.add(JSON.stringify(core));jointVocabulary.add(signature({root,core}));
  }
  const admitted=references.filter(r=>!r.issue&&r.root!==null);
  let first=0,unrestrictedCoreTicks=0,unrestrictedJointTicks=0,flatTemplateCoreTicks=0,flatTemplateJointTicks=0;
  for(let i=1;i<ticks.length;i++){
    const start=ticks[i-1],end=ticks[i],cores=new Map<string,number>(),joints=new Map<string,number>();
    while(first<admitted.length&&admitted[first].endTick<=start)first++;
    for(let j=first;j<admitted.length&&admitted[j].startTick<end;j++){
      const r=admitted[j],overlap=Math.min(end,r.endTick)-Math.max(start,r.startTick);
      if(overlap<=0)continue;
      const core=JSON.stringify(r.core),joint=signature(r);
      cores.set(core,(cores.get(core)??0)+overlap);joints.set(joint,(joints.get(joint)??0)+overlap);
    }
    const best=(weights:Map<string,number>,allowed?:Set<string>)=>{
      let value=0;for(const [key,ticks]of weights)if(!allowed||allowed.has(key))value=Math.max(value,ticks);return value;
    };
    unrestrictedCoreTicks+=best(cores);unrestrictedJointTicks+=best(joints);
    flatTemplateCoreTicks+=best(cores,coreVocabulary);flatTemplateJointTicks+=best(joints,jointVocabulary);
  }
  const fraction=(ticks:number)=>metric.referenceTicks?ticks/metric.referenceTicks:null;
  return {definition:'Reference-dependent oracle: best label per change-supported lattice cell, with no evidence, transition or duration-model constraints. Unrestricted bounds permit any reference label. Flat-template bounds exclude functional-root extensions and are not extended-model ceilings.',
    referenceTicks:metric.referenceTicks,eligibleCells:Math.max(0,ticks.length-1),unrestrictedCoreTicks,unrestrictedJointTicks,flatTemplateCoreTicks,flatTemplateJointTicks,
    unrestrictedCoreCeiling:fraction(unrestrictedCoreTicks),unrestrictedJointCeiling:fraction(unrestrictedJointTicks),
    flatTemplateCoreCeiling:fraction(flatTemplateCoreTicks),flatTemplateJointCeiling:fraction(flatTemplateJointTicks)};
}
function compactDiagnosis(diagnosis: ReturnType<typeof diagnoseHarmony>) {
  const { perReference, first16Quarters: _first, worstByErrorDuration, ...totals } = diagnosis;
  return { ...totals, worstErrors: worstByErrorDuration.map(index => {
    const { notesByPart: _notes, predictions: _predictions, ...reference } = perReference[index]; return reference;
  }) };
}
async function main() {
  const arguments_ = parseHarmonyArguments(process.argv.slice(2));
  const optionsBytes=arguments_.optionsPath?readFileSync(arguments_.optionsPath):undefined;
  const options: Partial<HarmonyOptions> | undefined = optionsBytes?JSON.parse(optionsBytes.toString('utf8')):undefined;
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) throw new Error('Harmony options must be one JSON object.');
  const wasmSha256=hash(readFileSync('src/core/wasm/muzak_core_bg.wasm'));
  const backend = arguments_.native ? { kind: 'native', executable: resolve(arguments_.native), executableSha256: hash(readFileSync(arguments_.native)) }
    : { kind: 'wasm', executable: 'src/core/wasm/muzak_core_bg.wasm', executableSha256: wasmSha256 };
  const registry = JSON.parse(readFileSync('docs/research/corpus-candidates.json', 'utf8'));
  const corpus: Corpus = registry.evaluationSources.find((c: Corpus) => c.id === 'batik-mozart-harmony-9c5f700');
  if (!corpus || new Set([...corpus.split.development,...corpus.split.holdout]).size !== corpus.split.development.length + corpus.split.holdout.length) throw new Error('Invalid registered harmonic split.');
  const methodFiles = [...coreMethodFiles(), 'scripts/evaluate-harmony.ts','src/score/midi-score.ts','src/score/evaluation.ts'];
  const methodHash = hash(methodFiles.map(p => `${p}:${hash(readFileSync(p))}\n`).join(''));
  const native = arguments_.native && !arguments_.prepare ? nativeHarmonyBackend(arguments_.native) : undefined;
  const infer: HarmonyInfer = native?.infer ?? (async (score, options) => callCoreSync('inferGlobalHarmony', {score, options}));
  const results = [];
  try {
  for (const id of corpus.split.development) {
    const work = corpus.works.find(w => w.id === id); if (!work || work.split !== 'development') throw new Error('Invalid development work registration.');
    const { score, references, diagnostics } = loadDevelopment(work);
    const bytes = exportScoreMidi(score), reread = importMidi(bytes).score;
    const content = (s: Score) => s.notes.map(n => JSON.stringify([s.parts.find(p => p.id === n.part)!.track,n.onset,n.duration,n.pitch.millicents,n.velocity,n.releaseVelocity])).sort();
    if (!same(content(score), content(reread)) || reread.ppq !== score.ppq || reread.duration !== score.duration) throw new Error('Derived MIDI changed observed note geometry.');
    if (!same(score.parts.map(p=>JSON.stringify([p.track,p.name])).sort(),reread.parts.map(p=>JSON.stringify([p.track,p.name])).sort())) throw new Error('Derived MIDI changed source notated-voice names.');
    const base = `${corpus.root}/derived/${id}`; mkdirSync(dirname(base),{recursive:true}); writeFileSync(`${base}.score.mid`,bytes); writeAuditJson(`${base}.score.json`,score);
    const derived = { scorePath:`${base}.score.json`,midiPath:`${base}.score.mid`,midiSha256:hash(Buffer.from(bytes)),scoreSha256:hash(readFileSync(`${base}.score.json`)),notes:score.notes.length,ppq:score.ppq,durationTicks:score.duration,zeroDurationNotes:score.notes.filter(n=>n.duration===0).length };
    const result: Record<string,unknown> = {id,sourceHashes:{scoreNotes:work.scoreNotes.sha256,musicXml:work.scoreMusicXml.sha256,independentAnalysis:work.harmonicAnalysis.sha256},derived,diagnostics};
    if (!arguments_.prepare) {
      const start = performance.now(); const analysis = await infer(score, options);
      result.runtimeMs=performance.now()-start; result.parameters=analysis.parameters;
      result.inference={windows:analysis.windows.length,selectedWindows:analysis.windows.filter(w=>w.selected!==null).length,work:analysis.work,diagnostics:analysis.diagnostics,limitations:analysis.limitations,
        unsupportedNoteCount:analysis.unsupportedNoteIds.length,offGridNoteCount:analysis.offGridNoteIds.length,restIntervals:analysis.rests.length};
      const metrics=evaluateHarmony(analysis,references,score.ppq,score.duration,analysis.lattice);
      result.metrics=arguments_.compact?compactHarmonyMetrics(metrics):metrics;
      result.latticeCeiling=latticeHarmonyCeiling(references,analysis.lattice,score.duration,analysis.parameters.templates);
      if(arguments_.diagnostics) {
        const diagnosis=diagnoseHarmony(score,analysis,references);
        result.errorDiagnostics=arguments_.compact?compactDiagnosis(diagnosis):diagnosis;
      }
      if(arguments_.oracle) {
        // Only explicit oracle mode crops by annotation bounds. All calls still
        // use the chosen Rust backend; no reference tones/root enter a request.
        const oracleOptions={...analysis.parameters,boundaryCost:1000,weakBoundaryCost:0,maxSpanSteps:analysis.parameters.maxLatticePoints};
        const analyses: GlobalHarmonyAnalysis[]=[];
        for(const reference of references.filter(r=>!r.issue&&r.root!==null)) analyses.push(await infer(oracleCrop(score,reference),oracleOptions));
        let next=0;
        const oracle=oracleHarmony(score,references,analysis.parameters,()=>analyses[next++]);
        if(arguments_.compact) { const {intervals:_intervals,...summary}=oracle;result.oracleDiagnostics=summary; }
        else result.oracleDiagnostics=oracle;
      }
    }
    results.push(result);
  }
  } finally { await native?.close(); }
  const output = arguments_.output ?? (arguments_.oracle?'.audit/score/harmony-oracle.json':arguments_.diagnostics?'.audit/score/harmony-diagnostics.json':'.audit/score/harmony-benchmark.json'); writeAuditJson(output,{corpus:corpus.id,methodHash,methodFiles,wasmSha256,backend,requestedOptions:options??{},optionsSource:optionsBytes?{path:arguments_.optionsPath,sha256:hash(optionsBytes)}:null,compact:arguments_.compact,developmentOnly:true,heldoutParsed:0,
    assumptions:['Uniform velocity80/release64 and120-quarter/minute audition tempo are placeholders; source notated voices are not inferred voices.','Observation projection uses no harmonic/key/phrase label fields. Inference sees all observed notes.','CSV printed quarter values and raw performance MIDI ticks are not used as score timing.','Unsupported onset joins are excluded and their durations reported.','Parameters and model choices are developed using K330/K331 agreement and generic synthetic controls. These are development-agreement metrics, not held-out accuracy or generalization evidence.','Added-tone references come from harmonic labels; this is not exhaustive human annotation of passing tones, suspensions or composer intent.'],results});
  console.log(JSON.stringify({output,backend:backend.kind,results:results.map(r=>{
    const m=r.metrics as ReturnType<typeof compactHarmonyMetrics>|undefined;
    return {id:r.id,runtimeMs:r.runtimeMs,referenceTicks:m?.referenceTicks,core:m?.coreAccuracy,root:m?.rootAccuracy,joint:m?.jointAccuracy,
      selectedCoverage:m?.selectedCoverage,segmentationF1:m?.segmentationBoundaries.f1,oracle:(r.oracleDiagnostics as ReturnType<typeof oracleHarmony>|undefined)?.summary};
  })},null,2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
