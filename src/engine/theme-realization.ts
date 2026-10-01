import type { TuningId } from '../pitch';
import { TUNINGS } from '../pitch';
import type { LyricalNote, LyricalSentence } from './lyrical';
import { lyricalField } from './lyrical-support';
import { ORNAMENT_KINDS, planOrnaments } from './ornaments';
import { random } from './random';
import { DEFAULT_PARAMETERS } from '../parameters';
import type { Parameters } from '../types';
import type { TextureAt } from './texture';
import { periodicField } from './periodic-field';

export interface DeliveredThemeNote extends LyricalNote { core: boolean; }
export interface ThemeDelivery {
  segments: Array<Omit<LyricalSentence['segments'][number], 'notes'> & { notes: DeliveredThemeNote[] }>;
  anchors: DeliveredThemeNote[];
  ornamentCount: number;
}
export interface ThemeDeliveryContext {
  seed: string; occurrence: number; tuning: TuningId; third: 3 | 4;
  embellishment: number; textureAt: TextureAt; parameters?: Parameters; allowGlides?: boolean;
  /** Absolute register is selected from the protected source before delivery. */
  pitchInRange?: (relativeCents: number) => boolean;
}

/** Foreground delivery grows out of a frozen theme. Only a connected interior
 * continuation can lend time to a small native-scale link. The identifying
 * head, prepared high point and held cadence are never replaced or shortened.
 * No chord-dependent pitch mutation occurs here, so a reharmonized comparison
 * retains exactly the same melody, including its separately named ornaments. */
export function realizeThemeDelivery(sentence: LyricalSentence, context: ThemeDeliveryContext): ThemeDelivery {
  const segments = sentence.segments.map(segment => ({ ...segment, notes: segment.notes.map(note => ({ ...note, core: true })) }));
  const anchors = segments.flatMap(segment => segment.notes);
  const field = lyricalField(context.tuning, context.third), divisions = TUNINGS[context.tuning].divisions;
  const native = { fieldCents: field.map(degree => degree * 1200 / divisions), chromaticStepCents: 1200 / divisions };
  const pitchField = periodicField(native.fieldCents);
  let ornamentCount = 0;
  const budget = Math.floor(anchors.length * Math.min(.7, Math.max(0, context.embellishment) * .7));
  const candidates = anchors.slice(0, -1).map((note, index) => ({ index, priority: random(context.seed, 'theme-ornament-priority', note.sourceId, context.occurrence) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index);
  for (const { index } of candidates) {
    const note = anchors[index], target = anchors[index + 1];
    if (!['continuation', 'approach'].includes(note.coreRole ?? '')) continue;
    const available = target.tick - note.tick;
    const soundingEnd = Math.min(target.tick, note.tick + note.duration);
    if (available < 480 || soundingEnd - note.tick < 480
      || sentence.rests.some(rest => rest.startTick < soundingEnd && rest.endTick > note.tick)) continue;
    const texture = context.textureAt(note.tick + Math.floor(available / 2));
    if (texture.pace < .24 || context.embellishment <= 0) continue;
    // A connected link may occupy a smaller branch of the same pulse tree
    // than the surrounding texture. Keep four local steps available so short
    // thoughts can still admit a figure without borrowing from another note.
    let subdivisionTicks = Math.max(80, Math.min(240, texture.subdivisionTicks));
    const connectedSpan = soundingEnd - note.tick;
    while (subdivisionTicks * 4 > connectedSpan && subdivisionTicks / 2 >= 80
      && Number.isInteger(subdivisionTicks / 2)) subdivisionTicks /= 2;
    const planned = planOrnaments({ seed: context.seed, occurrenceId: String(context.occurrence), sourceId: note.sourceId,
      core: [{ ...note, role: note.coreRole }, { ...target, role: target.coreRole }], endTick: target.tick,
      subdivisionTicks,
      parameters: context.parameters ?? DEFAULT_PARAMETERS, amount: context.embellishment * (.65 + texture.pace * .35),
      variation: context.parameters?.motifTransformation ?? .5, energy: texture.pace, native, allowGlides: context.allowGlides,
      noteBudget: budget - ornamentCount, pitchInRange: context.pitchInRange,
      plan: { scope: `${sentence.headId}:ornaments:${context.tuning}`, ordinal: context.occurrence,
        vocabulary: ORNAMENT_KINDS.filter(kind => kind !== 'connected-slide' || context.allowGlides),
        maxRegret: .4 + (context.parameters?.motifTransformation ?? .5) * .2 } });
    if (!planned.notes.length) continue;
    note.duration = planned.coreDurations[0];
    const segment = segments.find(item => note.tick >= item.startTick && note.tick < item.endTick)!;
    const ornament: DeliveredThemeNote[] = planned.notes.map(written => ({ ...written, degree: pitchField.indexAt(written.cents),
      protectedTheme: true, function: 'development', core: false }));
    segment.notes.push(...ornament);
    ornamentCount += ornament.length;
  }
  for (const segment of segments) segment.notes.sort((a, b) => a.tick - b.tick || Number(b.core) - Number(a.core));
  return { segments, anchors, ornamentCount };
}
