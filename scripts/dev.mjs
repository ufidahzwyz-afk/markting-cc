import {spawn,spawnSync} from 'node:child_process';
import {environment} from './dev-environment.mjs';
const prepare=spawnSync('npm',['run','db:prepare'],{stdio:'inherit',env:environment});
if(prepare.status!==0)process.exit(prepare.status??1);
console.log('Operations at http://localhost:3000; persistent development records; external writes disabled.');
const child=spawn('npm',['run','dev','--workspace','@boran/ops'],{stdio:'inherit',env:environment,detached:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{try{process.kill(-child.pid,signal);}catch{child.kill(signal);}});
child.on('exit',code=>{process.exitCode=code??1;});
