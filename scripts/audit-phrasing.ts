import { MusicEngine, eventHash } from '../src/engine';
import { DEFAULT_CONDUCTOR } from '../src/conductor';
import { DEFAULT_PARAMETERS } from '../src/parameters';
import { DEFAULT_PHRASING } from '../src/phrasing';
import type { Frame, NoteEvent } from '../src/types';

for (const seed of ['glass-garden', 'velvet-orbit', 'amber-current']) {
  const engine = new MusicEngine({ seed, parameters: DEFAULT_PARAMETERS, conductor: DEFAULT_CONDUCTOR, phrasing: DEFAULT_PHRASING });
  const frames: Frame[] = [], start = performance.now();
  while (frames.length < 1200) {
    const frame = engine.step();
    if (frame.form!.cycle >= 6) break;
    frames.push(frame);
  }
  const phrases = [...new Map(frames.map(frame => [frame.phrase!.phraseId, frame.phrase!])).values()];
  const notes = frames.flatMap(frame => frame.notes);
  const overlap = (note: NoteEvent, startTick: number, endTick: number) => note.tick < endTick && note.tick + note.duration > startTick;
  const globalRests = phrases.flatMap(phrase => phrase.rests.filter(rest => rest.scope === 'ensemble'));
  const ids = new Set(phrases.flatMap(phrase => phrase.ideas.map(idea => idea.id)));
  const returns = phrases.filter(phrase => phrase.relationship.startsWith('recall') || phrase.relationship.startsWith('anchor returns'));
  const solos = notes.filter(note => note.voice === 6), firstSoloFrame = frames.find(frame => frame.notes.some(note => note.voice === 6))!;
  // The first solo cell is the complete argument; following solo cells explain
  // its individual gestures and must not count as extra solo passages.
  const spans = phrases.flatMap(phrase => {
    const cell = phrase.cells.find(cell => cell.role === 'solo');
    return cell ? [(cell.endTick - cell.startTick) / frames.find(frame => frame.phrase!.phraseId === phrase.phraseId)!.form!.barTicks] : [];
  });
  const theme = notes.filter(note => note.voice === 5);
  const melodicSteps = solos.slice(1).flatMap((note, i) => note.tick - solos[i].tick <= 240 ? [Math.abs(note.absolutePitch!.millicents - solos[i].absolutePitch!.millicents) / 1000] : []);
  console.log(JSON.stringify({ seed, frames: frames.length, phrases: phrases.length, millisecondsPerFrame: (performance.now() - start) / frames.length, hash: eventHash(notes), uniqueIdeas: ids.size, heardDescendants: [...ids].filter(id => id.startsWith('heard-')).length, maximumArchive: Math.max(...phrases.map(phrase => phrase.ideas.length)), returns: returns.length, firstSoloSeconds: solos[0].tick / 480 * 60 / firstSoloFrame.parameters.tempo, soloPassages: spans.length, averageSoloBars: spans.reduce((sum, span) => sum + span, 0) / spans.length, soloNotes: solos.length, soloThirdOrWiderShare: melodicSteps.filter(step => step >= 300).length / melodicSteps.length, themeOffbeatShare: theme.filter(note => note.tick % 480 !== 0).length / theme.length, counterNotes: notes.filter(note => note.voice === 7).length, rhythmRelays: phrases.flatMap(phrase => phrase.cells).filter(cell => ['bass', 'drums'].includes(cell.role)).length, ensemblePauses: globalRests.length, pauseViolations: globalRests.reduce((sum, rest) => sum + notes.filter(note => overlap(note, rest.startTick, rest.endTick)).length, 0), roles: [...new Set(phrases.map(phrase => phrase.leadRole))] }));
}
