import type { LabDefinition } from './types';

export const labs = [
  {
    id: 'harmonic-motion', title: 'Harmonic motion', group: 'Compose & inspect',
    description: 'Generate a chord progression in your chosen key and scale. Read its Roman numerals, try altered chords and substitutions, then hear the result.',
    tags: ['harmony', 'progression', 'Roman numerals', 'harmonic minor', 'melodic minor', 'diminished', 'tonic', 'modal', 'jazz', 'substitution', 'Tonnetz', 'Coltrane', 'xenharmonic', 'voice leading'],
    load: () => import('./harmonic-motion'),
  },
  {
    id: 'melody', title: 'Melody', group: 'Generate',
    description: 'Explore a seeded melodic walk. Try different phrase lengths, step sizes and repetitions.',
    tags: ['pitch', 'seed', 'contour', 'piano roll'],
    load: () => import('./melody'),
  },
  {
    id: 'rhythm', title: 'Rhythm', group: 'Generate',
    description: 'Spread pulses across a cycle. Try different lengths, rotations and subdivisions.',
    tags: ['pulses', 'euclidean', 'cycle', 'piano roll'],
    load: () => import('./rhythm'),
  },
  {
    id: 'composition', title: 'Composition', group: 'Compose & inspect',
    description: 'Generate a passage or open MIDI. Audition, edit its structure and export the result.',
    tags: ['midi', 'scene', 'arrangement', 'import', 'codec'],
    load: () => import('./composition'),
  },
] as const satisfies readonly LabDefinition[];

export function matchesLab(lab: LabDefinition, query: string): boolean {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = [lab.title, lab.description, lab.group, ...lab.tags].join(' ').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

export function labRoute(hash: string): {kind: 'library'} | {kind: 'lab'; id: string} | {kind: 'missing'} {
  if (!hash || hash === '#/' || hash === '#/labs' || hash === '#/labs/') return {kind: 'library'};
  const match = /^#\/labs\/([a-z][a-z0-9-]*)$/.exec(hash);
  return match ? {kind: 'lab', id: match[1]} : {kind: 'missing'};
}
