import type { Score } from './score';
import type { MusicalScene } from '../core/generated/MusicalScene';
import type { ScoreComparison } from '../core/generated/ScoreComparison';
import type { CodecWorkerMessage, SceneEdit } from './codec-controller';

interface CodecJobOptions {
  call(op: 'encodeScore' | 'decodeScene' | 'compareScores' | SceneEdit['op'], input: unknown): Promise<unknown>;
  emit(message: CodecWorkerMessage): void;
}

/** A single scene is encoded from the complete score, decoded without access
 * to that score, then independently compared. The view cannot supply a crop. */
export async function runScoreCodec(score: Score, revision: number, options: CodecJobOptions): Promise<void> {
  options.emit({kind: 'stage', revision, stage: 'encoding'});
  const scene = await options.call('encodeScore', {score}) as MusicalScene;
  await decodeAndCompare(score, scene, revision, options);
}

/** Preserve the native edited program and compare against original observations. */
export async function runSceneEdit(score: Score, scene: MusicalScene, edit: SceneEdit, revision: number, options: CodecJobOptions): Promise<void> {
  options.emit({kind: 'stage', revision, stage: 'editing'});
  const changed = await options.call(edit.op, {...edit.input, scene}) as MusicalScene;
  await decodeAndCompare(score, changed, revision, options);
}

/** The first authored realization becomes its comparison source, without inference. */
export async function runAuthoredScene(scene: MusicalScene, revision: number, options: CodecJobOptions): Promise<void> {
  options.emit({kind: 'stage', revision, stage: 'decoding'});
  const decoded = await options.call('decodeScene', {scene}) as Score;
  await compare(decoded, scene, decoded, revision, options);
}

async function decodeAndCompare(score: Score, scene: MusicalScene, revision: number, options: CodecJobOptions): Promise<void> {
  options.emit({kind: 'stage', revision, stage: 'decoding'});
  const decoded = await options.call('decodeScene', {scene}) as Score;
  await compare(score, scene, decoded, revision, options);
}

async function compare(score: Score, scene: MusicalScene, decoded: Score, revision: number, options: CodecJobOptions): Promise<void> {
  options.emit({kind: 'stage', revision, stage: 'verifying'});
  const comparison = await options.call('compareScores', {a: score, b: decoded}) as ScoreComparison;
  options.emit({kind: 'ready', revision, result: {source: score, scene, decoded, comparison}});
}
