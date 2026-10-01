/** Ordered pitch locations within one repeating period. Indexes extend in
 * both directions; nearest locations may belong to an adjacent period. */
export function periodicField(values: readonly number[], period = 1200) {
  const field = [...new Set(values)].sort((a, b) => a - b);
  if (!Number.isFinite(period) || period <= 0 || !field.length
    || field.some(value => !Number.isFinite(value) || value < 0 || value >= period)) {
    throw new RangeError('A periodic field needs finite locations within a positive period.');
  }
  const at = (index: number) => {
    if (!Number.isSafeInteger(index)) throw new RangeError('A field index must be a safe integer.');
    const value = field[((index % field.length) + field.length) % field.length] + Math.floor(index / field.length) * period;
    if (!Number.isFinite(value)) throw new RangeError('The field coordinate exceeds the finite range.');
    return value;
  };
  const indexAt = (value: number) => {
    if (!Number.isFinite(value)) throw new RangeError('A field coordinate must be finite.');
    const octave = Math.floor(value / period);
    const first = (octave - 1) * field.length, end = (octave + 2) * field.length;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end)) throw new RangeError('The coordinate exceeds the field index range.');
    let best = 0, distance = Infinity;
    for (let index = first; index < end; index++) {
      const next = Math.abs(at(index) - value);
      if (next < distance) { best = index; distance = next; }
    }
    return best;
  };
  return { at, indexAt };
}
