import {openDatabase} from '@boran/db';
import {runOnce} from './runner';
import {registerDomainHandlers,processReceptionTimers,markUnconfiguredPrivacyRequests} from './handlers';
import {dispatchMarketing} from './marketing-dispatch';
import {dispatchBrowserWork} from './browser-dispatch';
import {dispatchReports} from './report-dispatch';
import {cleanupPublicEvents} from './public-events-cleanup';
import {scheduleDueWorkflows} from './scheduler';
const db=await openDatabase({mode:process.env.BORAN_MODE==='live'?'live':'mock',initialize:false});
try{registerDomainHandlers();await scheduleDueWorkflows(db);await processReceptionTimers(db);await markUnconfiguredPrivacyRequests(db);await dispatchReports(db);await dispatchMarketing(db);await dispatchBrowserWork(db);const result=await runOnce(db);await cleanupPublicEvents(db);process.stdout.write(JSON.stringify(result)+'\n');}finally{await db.close();}
