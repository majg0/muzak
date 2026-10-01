import { runConformance } from '../src/conformance';

// This command deliberately never writes fixtures. A changed hash needs review:
// it may reveal a regression or require an explicit engine version change.
const report = runConformance();
console.log(JSON.stringify({ runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch }, ...report }, null, 2));
if (!report.passed) {
  console.error('Conformance differs from the pinned fixtures. No files were changed. Review the musical changes before manually replacing expected hashes in src/conformance.ts.');
  process.exitCode = 1;
}
