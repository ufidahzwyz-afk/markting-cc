import { spawnSync } from 'node:child_process';

// The approval preview contains only the UI slice. Backend packages are pending.
for (const project of ['packages/ui', 'apps/ops']) {
  const result = spawnSync('node_modules/.bin/tsc', ['--noEmit', '-p', `${project}/tsconfig.json`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

