import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
for (const root of ['packages','apps']) for (const name of readdirSync(root)) {
  const project = `${root}/${name}`;
  if (!existsSync(`${project}/tsconfig.json`)) continue;
  console.log(`Typecheck: ${project}`);
  const result = spawnSync('node_modules/.bin/tsc',['--noEmit','-p',`${project}/tsconfig.json`],{stdio:'inherit'});
  if(result.status!==0) process.exit(result.status??1);
}
