import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionScoreMarkup, compositionExpressionMarkup, layerPhaseAt, phraseSettingsMarkup, applyVisiblePhraseControls, ideaJourneyMarkup, pulseMapMarkup } from '../src/phrase-panel';
import { DEFAULT_PHRASING, type PhraseSnapshot } from '../src/phrasing';
import { DEFAULT_COMPOSITION } from '../src/composition';
import type { Frame } from '../src/types';
import { DEFAULT_PARAMETERS } from '../src/parameters';

const phrase: PhraseSnapshot = {
  phraseId: 4, startTick: 960, endTick: 8640, gesture: 'Statement and answer', leadRole: 'theme',
  themeId: 'theme-a', themeName: 'A', relationship: 'return', grooveId: 'steady-pocket',
  envelopes: [], rests: [], cells: [], ideas: [], distribution: 'balanced', variation: .35,
  composition: {
    movementId: 'movement-2', movementName: 'A connected route', movementIndex: 2,
    themeId: 'theme-a', themeName: 'Opening light', themeStartTick: 0, themeEndTick: 15360,
    phraseId: 'section-7:phrase-1', sourcePhraseId: 'theme-a:period', phraseFunction: 'restatement',
    phraseOrdinal: 1, phraseCount: 3, iteration: 2, treatment: 'varied reprise', cadence: 'open',
    motifs: [
      { id: 'heard-now-1', sourceId: 'theme-a:motif-0', startTick: 960, endTick: 2880, treatment: 'literal opening' },
      { id: 'heard-now-2', sourceId: 'theme-a:motif-0', startTick: 4800, endTick: 7680, treatment: 'decorated opening' },
      { id: 'outside-phrase', sourceId: 'theme-b:motif-0', startTick: 9000, endTick: 9600, treatment: 'later' },
    ],
    shortPhrases: [
      { id: 'short-now-1', sourceId: 'short-a', motifId: 'heard-now-1', startTick: 960, endTick: 1920, cycleTicks: 960, transpositionCents: 0, intervalScale: 1, coreNotes: 4 },
      { id: 'short-now-2', sourceId: 'short-a', motifId: 'heard-now-2', startTick: 4800, endTick: 6000, cycleTicks: 1200, transpositionCents: 500, intervalScale: .8, coreNotes: 4 },
      { id: 'outside-short', sourceId: 'short-b', motifId: 'later', startTick: 8640, endTick: 9600, cycleTicks: 960, transpositionCents: 0, intervalScale: 1, coreNotes: 3 },
    ],
    layers: [
      { id: 'counter-7', role: 'counter', sourceId: 'short-a', label: 'Displaced answer', cycleTicks: 1680, cycleStartTick: 720, cycleEndTick: 2400, active: true },
      { id: 'rhythm-3', role: 'rhythm', sourceId: 'cross-beat', label: 'Three-beat thread', cycleTicks: 1440, cycleStartTick: 1440, cycleEndTick: 2880, active: false },
    ],
    transition: { boundaryTick: 8640, startTick: 7680, endTick: 9120, kind: 'roll', reason: 'meter', energy: .72 },
    cues: [
      { id: 'shared-accent', tick: 2880, kind: 'accent', strength: .8, ensemble: 'cell', sourceId: 'short-a' },
      { id: 'shared-space', tick: 6720, endTick: 7680, kind: 'break', strength: .6 },
      { id: 'outside-cue', tick: 8640, kind: 'arrival', strength: 1 },
    ],
  },
};

test('the live composition panel exposes active controls without retired branch or probability knobs', () => {
  const html = phraseSettingsMarkup();
  for (const key of ['embellishment', 'cohesion', 'accent', 'dynamicRange', 'displacement', 'polymeter', 'transition'])
    assert.match(html, new RegExp(`id="composition-${key}"`));
  for (const key of ['renewal', 'variation']) assert.match(html, new RegExp(`id="phrase-${key}"`));
  assert.doesNotMatch(html, /id="(?:phrase-(?:space|syncopation|interplay|virtuosity|arc|distribution|character)|phrasing-enabled|composition-(?:development|repetition))"/);
  assert.doesNotMatch(html, /probability|variation band|Solo flight|Length of thought|Thematic repetition/i);
  assert.match(html, /protected thematic core/);
});

test('editing active composition controls preserves dormant recipe fields and harmonic policy', () => {
  const source = { ...DEFAULT_PHRASING, space: .93, syncopation: .71, interplay: .13, virtuosity: .89,
    arc: 'fall' as const, distribution: 'adventurous' as const,
    composition: { ...DEFAULT_COMPOSITION, development: .23, repetition: .94 } };
  const before = structuredClone(source);
  const edited = applyVisiblePhraseControls(source, { renewal: .8, variation: .22 }, { cohesion: .91, dynamicRange: .88 });
  assert.deepEqual(source, before);
  for (const key of ['space', 'syncopation', 'interplay', 'virtuosity', 'arc', 'distribution'] as const) assert.equal(edited[key], source[key]);
  assert.equal(edited.composition!.development, .23);
  assert.equal(edited.composition!.repetition, .94);
  assert.equal(edited.composition!.cohesion, .91);
  assert.equal(edited.composition!.dynamicRange, .88);
  assert.equal(edited.renewal, .8);
  assert.equal(edited.variation, .22);
  assert.deepEqual(edited.harmony, source.harmony);
});

test('shared expression shows observed past score range without queued future intentions', () => {
  const moment = (tick: number, energy: number): Frame => ({ tick,
    sound: { instrument: 'ensemble' }, parameters: DEFAULT_PARAMETERS,
    diagnostics: { compositionExpression: { energy, activity: .4, intensity: .6, register: .5, sustain: .7, accent: .3,
      direction: 'gathering', pace: .44, rhythmDrive: .52, articulation: 'connected', subdivisionTicks: 120 } },
    notes: [{ part: 'melody', timbre: 'reed', articulation: 'connected' }],
  } as Frame);
  const now = moment(480 * 150, .4);
  const history = [moment(0, .01), moment(now.tick - 960, .2), now, moment(now.tick + 960, .99)];
  const html = compositionExpressionMarkup(now, history);
  assert.match(html, /20%–40% observed/);
  assert.doesNotMatch(html, /1%–|99%|Singing strings|Long phrases/);
  assert.match(html, /Observed score range: 2 moments/);
  assert.match(html, /not measured audio loudness/);
  assert.match(html, /Notes in this moment: connected/);
  assert.match(html, /Colors: reed/);
  assert.equal((html.match(/<progress /g) ?? []).length, 6);
  assert.match(compositionExpressionMarkup(), /appear with the first composed moment/);
});

test('composition score uses real hierarchy indices, reusable sources and actual cue positions', () => {
  const html = compositionScoreMarkup(phrase);
  assert.match(html, /Movement 3/);
  assert.match(html, /THOUGHT 2 OF 3/);
  assert.match(html, /Occurrence 3/);
  assert.match(html, /1 source · 2 appearances/);
  assert.match(html, /Thought source: theme-a:period/);
  assert.ok(html.indexOf('<span>Short phrases</span>') < html.indexOf('<span>Grouped motifs</span>'));
  assert.ok(html.indexOf('<span>Grouped motifs</span>') < html.indexOf('<span>Theme</span>'));
  assert.ok(html.indexOf('<span>Theme</span>') < html.indexOf('<span>Movement 3</span>'));
  assert.equal((html.match(/data-source-id="theme-a:motif-0"/g) ?? []).length, 2);
  assert.match(html, /data-cue-id="shared-accent" data-cue-tick="2880" style="left:25%;/);
  assert.match(html, /data-cue-id="shared-space" data-cue-tick="6720" style="left:75%;width:12.5%;/);
  assert.doesNotMatch(html, /outside-phrase|outside-cue|outside-short/);
  assert.match(html, /Open ending · the thought continues/);
});

test('short phrases, independent cycles and transitions use their actual timing and source relationships', () => {
  const html = compositionScoreMarkup(phrase);
  assert.equal((html.match(/data-short-source-id="short-a"/g) ?? []).length, 2);
  assert.match(html, /data-motif-id="heard-now-2" style="left:50%;width:15.625%/);
  assert.match(html, /\+500 cents · interval scale 0.8/);
  assert.match(html, /data-layer-id="counter-7" data-cycle-start="720" data-cycle-end="2400"/);
  assert.match(html, /Counterline · 3.5 quarter-note beats/);
  assert.match(html, /Participating cycle/);
  assert.match(html, /phase shows cycle participation, not continuous sound/);
  assert.match(html, /data-transition-start="7680" data-transition-end="9120" data-transition-boundary="8640" style="left:87.5%;width:12.5%/);
  assert.match(html, /Planned roll for a meter change · 72% energy/);
  assert.match(html, /title="Planned roll into meter change/);
  assert.match(html, /Shared breaks can shorten preparation\./);
  assert.match(html, /ensemble cell/);
  assert.match(html, /Cue: shared-accent ← short-a/);
  const layer = phrase.composition!.layers![0];
  assert.equal(layerPhaseAt(layer, 0), 0);
  assert.equal(layerPhaseAt(layer, 720 + 840), .5);
  assert.equal(layerPhaseAt(layer, 2400), 1);
  assert.equal(layerPhaseAt(layer, 4080), 1, 'The panel must not infer later cycles absent from the snapshot.');
});

test('absent hierarchy is not invented and engine-provided text is escaped', () => {
  assert.equal(compositionScoreMarkup({ ...phrase, composition: undefined }), '');
  const input = structuredClone(phrase);
  input.composition!.movementName = '<img src=x onerror="run()">';
  input.composition!.sourcePhraseId = '<script>run()</script>';
  input.composition!.motifs[0].sourceId = 'source" onclick="run()';
  input.composition!.layers![0].label = '<img src=x>';
  input.composition!.shortPhrases![0].sourceId = 'short" onclick="run()';
  const html = compositionScoreMarkup(input);
  assert.doesNotMatch(html, /<img|<script|source" onclick=/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
  assert.match(html, /source&quot; onclick=&quot;run\(\)/);
  assert.match(html, /short&quot; onclick=&quot;run\(\)/);
});

test('an older snapshot does not invent short phrase sources, independent layers or transitions', () => {
  const input = structuredClone(phrase);
  delete input.composition!.shortPhrases;
  delete input.composition!.layers;
  delete input.composition!.transition;
  const html = compositionScoreMarkup(input);
  assert.match(html, /Not supplied by this plan/);
  assert.doesNotMatch(html, /data-short-phrase-id|data-layer-id|data-transition-start/);
});

test('the idea journey exposes supplied lineage and targets, never infers a source graph', () => {
  assert.equal(ideaJourneyMarkup(phrase), '');
  const input = structuredClone(phrase);
  input.composition!.fingerprint = { sourceId: 'theme-a:head', intervals: [4, -1, 2], rhythmUnits: [4, 2, 2, 8] };
  Object.assign(input.composition!.motifs[0], { parentId: 'theme-a:head', goalDegree: 5, relationship: 'Widen the reach', attackCount: 7 });
  const html = ideaJourneyMarkup(input);
  assert.match(html, /\+4 · -1 · \+2/);
  assert.match(html, /4 : 2 : 2 : 8/);
  assert.match(html, /Target degree offset \+5 · 7 structural notes/);
  assert.match(html, /data-idea-start="960" data-idea-end="2880"/);
  assert.match(html, /Widen the reach/);
  assert.match(html, /← theme-a:head/);
});

test('the pulse map shows source grouping and separate actual clocks', () => {
  const frame = { form: { meter: { numerator: 7, denominator: 8 }, barStartTick: 3360, barTicks: 1680,
    meterGroups: [3, 2, 2], meterSourceId: 'cell:theme-a', meterReason: 'A returning subject brings its grouping.' },
    diagnostics: { compositionExpression: { rhythm: { reference: { beatTicks: 480, originTick: 0 }, cycleStartTick: 2880, cycleTicks: 1200 } } } } as Frame;
  const html = pulseMapMarkup(frame);
  assert.match(html, /7\/8 · grouped 3 \+ 2 \+ 2/);
  assert.equal((html.match(/class="pulse-beat group-start"/g) ?? []).length, 3);
  assert.match(html, /data-pulse-start="4080" data-pulse-end="4320"/);
  assert.match(html, /data-pulse-period="1680"/);
  assert.match(html, /data-clock-origin="0" data-clock-span="480"/);
  assert.match(html, /Hook cycle · 2.5 quarter beats/);
  assert.match(html, /A returning subject brings its grouping/);
  assert.equal((html.match(/data-sounding-part=/g) ?? []).length, 4);
  assert.equal(pulseMapMarkup(), '');
});
