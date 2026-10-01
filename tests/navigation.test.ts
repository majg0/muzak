import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePlayback } from '../src/navigation';
import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_CONDUCTOR, formAt } from '../src/conductor';
import { DEFAULT_PHRASING } from '../src/phrasing';
import { FRAME_TICKS } from '../src/types';

const config = { seed: 'velvet-orbit', parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING };
test('section navigation presents the destination phrase and does not skip its first frame', async () => {
  const live = new MusicEngine(config);
  for (let section = 0, tick = 0; section < 9; section++) {
    while (live.tick < tick) live.step();
    const expected = live.step();
    const seek = await preparePlayback(config, tick);
    assert.equal(seek.firstFrame.tick, tick);
    assert.equal(seek.firstFrame.form?.sectionStartTick, tick);
    assert.equal(seek.firstFrame.phrase?.startTick, tick);
    assert.equal(eventHash(seek.firstFrame.notes), eventHash(expected.notes));
    assert.equal(seek.engine.tick, tick + FRAME_TICKS);
    assert.equal(eventHash(seek.engine.step().notes), eventHash(live.step().notes));
    tick = formAt(config.seed, tick, config.conductor).sectionEndTick;
  }
});
test('cancelled reconstruction keeps one valid resumable frame and bounded history', async () => {
  let cancel = false;
  const seek = await preparePlayback(config, 1000 * FRAME_TICKS, {
    maxHistory: 12, cancelled: () => cancel, onProgress: () => { cancel = true; },
  });
  assert.equal(seek.cancelled, true);
  assert.equal(seek.tick, 32 * FRAME_TICKS);
  assert.equal(seek.firstFrame.tick, seek.tick);
  assert.equal(seek.history.length, 12);
  assert.equal(seek.history.at(-1)!.tick + FRAME_TICKS, seek.tick);
});
test('invalid positions reject without altering an existing composer', async () => {
  await assert.rejects(preparePlayback(config, -1), /Invalid playback/);
  await assert.rejects(preparePlayback(config, Number.NaN), /Invalid playback/);
});
