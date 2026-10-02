import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Persist a diagnostic report, creating its output directory when needed. */
export function writeAuditJson(output: string, report: unknown): string {
  const destination = resolve(output);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return destination;
}
