import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { openDatabase, type Database } from "@boran/db";
import {dispatchMarketing} from './marketing-dispatch';
import {dispatchBrowserWork} from './browser-dispatch';
import {dispatchReports} from "./report-dispatch";
import {cleanupPublicEvents} from "./public-events-cleanup";
import {scheduleDueWorkflows} from "./scheduler";
import {registerDomainHandlers,processReceptionTimers,markUnconfiguredPrivacyRequests} from "./handlers";
export * from "./queue";
export { runOnce, registerHandler, registeredHandlers, type WorkflowHandler } from "./runner";

export async function startWorker(port=Number(process.env.WORKER_PORT??4100)):Promise<void>{
  // Health and polling share one database instance. There is no unauthenticated dispatch endpoint.
  let db:Database;
  try{db=await openDatabase({mode:process.env.BORAN_MODE==="live"?"live":"mock",initialize:false});await db.query("SELECT id FROM workflow_runs LIMIT 1");}catch{throw new Error("Worker database is not configured or migrated");}
  const server=createServer((request,response)=>{if(request.method!=="GET"||request.url!=="/health"){response.writeHead(404);response.end();return;}void db.query("SELECT 1").then(()=>{response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({status:"ok",component:"worker",handlers:"domain-handlers",mode:process.env.BORAN_MODE??"mock",externalWrites:false}));}).catch(()=>{response.writeHead(503,{"Content-Type":"application/json"});response.end(JSON.stringify({status:"unavailable",component:"worker"}));});});
  server.listen(port,"0.0.0.0");
  registerDomainHandlers();
  const { runOnce, registeredHandlers }=await import("./runner");
  let busy=false,lastSchedule=0,lastCleanup=0;
  const timer=setInterval(()=>{if(busy)return;busy=true;void (Date.now()-lastSchedule>=60_000 ? (lastSchedule=Date.now(),scheduleDueWorkflows(db)) : Promise.resolve(0)).then(()=>runOnce(db)).then(()=>processReceptionTimers(db)).then(()=>markUnconfiguredPrivacyRequests(db)).then(()=>dispatchReports(db)).then(()=>dispatchMarketing(db)).then(()=>dispatchBrowserWork(db)).then(()=>Date.now()-lastCleanup>=60_000 ? (lastCleanup=Date.now(),cleanupPublicEvents(db)) : Promise.resolve(null)).catch(()=>{process.stderr.write("Worker iteration failed; durable state retained\n");}).finally(()=>{busy=false;});},1000);
  async function stop(){clearInterval(timer);server.close();await db.close();}
  process.once("SIGINT",()=>void stop());process.once("SIGTERM",()=>void stop());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void startWorker().catch((error:unknown)=>{process.stderr.write(`${error instanceof Error?error.message:"Worker startup failed"}\n`);process.exitCode=1;});
