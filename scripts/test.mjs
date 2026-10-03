import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tests = [];
for (const directory of ['apps/ops/tests', 'packages/ui/tests']) {
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory)) if (entry.endsWith('.test.ts')) tests.push(`${directory}/${entry}`);
}
if (tests.length === 0) {
  console.error('The UI preview must include its access-control tests.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);

