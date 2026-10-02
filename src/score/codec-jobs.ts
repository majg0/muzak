import type { Score } from './score';
import type { MusicalScene } from '../core/generated/MusicalScene';
import type { ScoreComparison } from '../core/generated/ScoreComparison';
import type { CodecWorkerMessage } from './codec-controller';

/** A single scene is encoded from the complete score, decoded without access
 * to that score, then independently compared. The view cannot supply a crop. */
export async function runScoreCodec(score: Score, revision: number, options: {
  call(op: 'encodeScore' | 'decodeScene' | 'compareScores', input: unknown): Promise<unknown>;
  emit(message: CodecWorkerMessage): void;
}): Promise<void> {
  options.emit({kind: 'stage', revision, stage: 'encoding'});
  const scene = await options.call('encodeScore', {score}) as MusicalScene;
  options.emit({kind: 'stage', revision, stage: 'decoding'});
  const decoded = await options.call('decodeScene', {scene}) as Score;
  options.emit({kind: 'stage', revision, stage: 'verifying'});
  const comparison = await options.call('compareScores', {a: score, b: decoded}) as ScoreComparison;
  options.emit({kind: 'ready', revision, result: {scene, decoded, comparison}});
}
