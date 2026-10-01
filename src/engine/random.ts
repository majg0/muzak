/** Addressed, stateless randomness. Each musical decision has its own address. */
export function hash32(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function random(seed: string, domain: string, ...address: (number | string)[]): number {
  // Length-prefix strings: ['ab', 'c'] and ['a', 'bc'] cannot alias.
  return hash32([seed, domain, ...address].map(v => `${String(v).length}:${v}`).join('|')) / 4294967296;
}

export function integer(seed: string, domain: string, min: number, max: number, ...address: (number | string)[]): number {
  return min + Math.floor(random(seed, domain, ...address) * (max - min + 1));
}

export function eventHash(events: unknown): string {
  return hash32(JSON.stringify(events)).toString(16).padStart(8, '0');
}
