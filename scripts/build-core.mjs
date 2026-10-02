import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const release = process.argv.includes('--release');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Generate away from the watched sources, then replace only changed files.
// A failed compile must leave the last usable declarations intact.
const declarations = resolve(root, 'src/core/generated');
const staging = resolve(root, 'target/generated-types');
mkdirSync(declarations, { recursive: true });
mkdirSync(staging, { recursive: true });
for (const entry of readdirSync(staging, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.ts')) unlinkSync(resolve(staging, entry.name));
}
run('cargo', ['run', '-q', '-p', 'muzak-core', '--', '--schema', staging]);
const generated = new Set(readdirSync(staging).filter(name => name.endsWith('.ts')));
for (const name of generated) {
  const destination = resolve(declarations, name), contents = readFileSync(resolve(staging, name));
  if (!existsSync(destination) || !readFileSync(destination).equals(contents)) writeFileSync(destination, contents);
}
for (const entry of readdirSync(declarations, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.ts') && !generated.has(entry.name)) unlinkSync(resolve(declarations, entry.name));
}
run('cargo', ['build', '-p', 'muzak-core', '--lib', '--target', 'wasm32-unknown-unknown', ...(release ? ['--release'] : [])]);
mkdirSync(resolve(root, 'src/core/wasm'), { recursive: true });
const version = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8', shell: false });
if (version.error) throw version.error;
if (version.status !== 0 || version.stdout.trim() !== 'wasm-bindgen 0.2.114') throw new Error('Install wasm-bindgen-cli 0.2.114 to match the locked Rust bridge.');
const wasm = resolve(root, `target/wasm32-unknown-unknown/${release ? 'release' : 'debug'}/muzak_core.wasm`);
const bridge = resolve(root, 'src/core/wasm'), stamp = resolve(bridge, 'input.sha256');
const hash = createHash('sha256').update(version.stdout).update(readFileSync(wasm)).digest('hex');
if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash
  || !['muzak_core.js', 'muzak_core.d.ts', 'muzak_core_bg.wasm'].every(name => existsSync(resolve(bridge, name)))) {
  run('wasm-bindgen', [wasm, '--target', 'web', '--out-dir', bridge, '--out-name', 'muzak_core']);
  writeFileSync(stamp, hash);
}
