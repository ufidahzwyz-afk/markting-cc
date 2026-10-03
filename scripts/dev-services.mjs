import {spawn,spawnSync} from 'node:child_process';
import {environment} from './dev-environment.mjs';
if(!environment.DATABASE_URL)throw new Error('Four services require PostgreSQL DATABASE_URL. Mac Studio: docker compose -f infra/compose.yaml up --build');
const prepare=spawnSync('npm',['run','db:prepare'],{stdio:'inherit',env:environment});
if(prepare.status!==0)process.exit(prepare.status??1);
const children=[];
let stopping=false;
function stop(signal='SIGTERM'){if(stopping)return;stopping=true;for(const child of children){try{process.kill(-child.pid,signal);}catch{child.kill(signal);}};}
for(const [workspace,script] of [['@boran/ops','dev'],['@boran/public-site','dev'],['@boran/worker','start'],['@boran/browser-runtime','start']]){
  const child=spawn('npm',['run',script,'--workspace',workspace],{stdio:'inherit',env:environment,detached:true});
  children.push(child);child.on('exit',code=>{if(!stopping){process.exitCode=code??1;stop();}});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(signal));
