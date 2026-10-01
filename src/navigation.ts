import { MusicEngine } from './engine';
import { FRAME_TICKS, type EngineConfig, type Frame } from './types';

/** Reconstruct off to the side, then hand the transport one coherent position.
 * The first destination frame is buffered: never display the preceding phrase
 * at a new section, or accidentally skip the destination on the next pump. */
export async function preparePlayback(config: EngineConfig, requestedTick: number, options: {
  maxHistory?: number;
  cancelled?: () => boolean;
  onProgress?: (tick: number) => void;
  yield?: () => Promise<void>;
} = {}) {
  if (!Number.isSafeInteger(requestedTick) || requestedTick < 0) throw new Error('Invalid playback position.');
  const destination = Math.ceil(requestedTick / FRAME_TICKS) * FRAME_TICKS;
  const engine = new MusicEngine(config);
  const history: Frame[] = [];
  let count = 0;
  while (engine.tick < destination && !options.cancelled?.()) {
    history.push(engine.step());
    if (history.length > (options.maxHistory ?? 8192)) history.shift();
    if (++count % 32 === 0) {
      options.onProgress?.(engine.tick);
      await (options.yield?.() ?? Promise.resolve());
    }
  }
  const tick = engine.tick;
  const firstFrame = engine.step();
  return { engine, history, firstFrame, tick, cancelled: options.cancelled?.() ?? false };
}
