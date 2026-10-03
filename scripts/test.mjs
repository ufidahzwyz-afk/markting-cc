import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests=[];
function collect(directory){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const path=`${directory}/${entry.name}`;if(entry.isDirectory())collect(path);else if(/\.test\.tsx?$/.test(entry.name))tests.push(path);}}
for(const root of ['apps','packages'])for(const name of readdirSync(root))collect(`${root}/${name}/tests`);
collect('tests/integration');
if(!tests.length)throw new Error('No verification tests found');
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=1',...tests.sort()],{stdio:'inherit'});
process.exit(result.status??1);
