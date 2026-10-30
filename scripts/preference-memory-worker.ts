import {getDb} from '../apps/web/src/server/db';
import {processMemoryJob} from '../apps/web/src/server/gatherings/memory';
const db=getDb();let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
if(process.argv.includes('--retry-failed'))await db.$executeRaw`UPDATE "PreferenceLearningJob" SET status='pending',attempts=0,"availableAt"=now() WHERE status='failed'`;
do{
 const jobs=await db.$queryRaw<{id:string}[]>`SELECT id FROM "PreferenceLearningJob" WHERE status='pending' AND "availableAt"<=now() ORDER BY "createdAt" LIMIT 25`;
 for(const job of jobs)try{await processMemoryJob(job.id);}catch{
  await db.$executeRaw`UPDATE "PreferenceLearningJob" SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,"availableAt"=now()+interval '1 minute' * power(2,attempts) WHERE id=${job.id}::uuid AND status='pending'`;
  console.error(JSON.stringify({event:'preference_learning_failed',job_id:job.id}));process.exitCode=1;
 }
 // Keep deletion barriers/settings; expire only evidence/jobs. No historical backfill.
 await db.$executeRaw`DELETE FROM "PreferenceEvidence" WHERE "occurredAt"<now()-interval '180 days'`;
 await db.$executeRaw`DELETE FROM "PreferenceLearningJob" WHERE "createdAt"<now()-interval '30 days' AND status='done'`;
 if(process.argv.includes('--once'))break;
 await new Promise(resolve=>setTimeout(resolve,2000));
}while(!stopped);
await db.$disconnect();
