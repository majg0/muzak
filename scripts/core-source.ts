import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Freeze the implementation actually executed, including locked dependencies. */
export function coreMethodFiles(): string[] {
  const files = (directory: string): string[] => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name).replaceAll('\\', '/');
    return entry.isDirectory() ? files(path) : entry.name.endsWith('.rs') ? [path] : [];
  });
  return ['Cargo.lock', 'Cargo.toml', 'crates/muzak-core/Cargo.toml', ...files('crates/muzak-core/src')].sort();
}
