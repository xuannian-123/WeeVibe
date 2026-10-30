import {describe,it,expect,vi,beforeEach} from 'vitest';
import {emptyGatheringIntake} from '../packages/contracts/src';
import {aggregate,allowed} from '../apps/web/src/server/gatherings/memory-rules';
const h=vi.hoisted(()=>({tx:undefined as unknown}));
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(fn:(tx:unknown)=>unknown)=>fn(h.tx)}));
import {enqueueMemory,separateAutomatic,processMemoryJob,resolveMemoryRows} from '../apps/web/src/server/gatherings/memory';
import type {Tx} from '../apps/web/src/server/activities/state';
const now=new Date(),actor='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
function fixture({learning=true,epoch=1,sourceVersion=1,barrier=false}={}){
 const intake=emptyGatheringIntake();intake.public.keywords.play=['看展'];
 const settings={userId:actor,learning,recommending:true,version:epoch,profileVersion:1,barriers:barrier?{play:new Date(Date.now()+10000).toISOString()}:{},overrides:{}};
 const execute=vi.fn(async(_parts:TemplateStringsArray,..._values:unknown[])=>1),query=vi.fn(async(parts:TemplateStringsArray)=>{const sql=parts.join('?');if(sql.includes('PreferenceMemory'))return [settings];if(sql.includes('GROUP BY status'))return [];if(sql.includes('PreferenceLearningJob'))return sql.includes('SELECT status,attempts')?[{status:'pending',attempts:0}]:[{userId:actor,sourceId:id,sourceVersion:1,epoch:1,status:'pending'}];if(sql.includes('PreferenceEvidence'))return [{category:'play',values:['看展'],sourceId:id,occurredAt:now}];return [];});
 const tx={$queryRaw:query,$executeRaw:execute,gatheringMember:{findUnique:vi.fn(async()=>({responseVersion:sourceVersion,publicIntake:intake.public,privateIntake:intake.private}))},gathering:{findUnique:vi.fn(async()=>({createdAt:now}))}} as unknown as Tx;h.tx=tx;return {tx,execute,query,intake};
}
beforeEach(()=>{h.tx=undefined;});
describe('explainable preference learning boundaries',()=>{
 it('whitelists structured values and rejects free text and unrelated categories',()=>{expect(allowed('play',['看展','详细住址：某街','其他','看展'])).toEqual(['看展']);});
 it('uses independent sources, ages evidence and gives manual correction priority',()=>{const evidence=[1,2,3].map(n=>({category:'play' as const,values:['看展'],sourceId:String(n),occurredAt:now}));expect(aggregate(evidence,{},now.getTime())[0]).toMatchObject({confidence:'high',evidence_count:3});expect(aggregate(evidence,{play:['唱歌']})[0]).toMatchObject({values:['唱歌'],confidence:'manual'});expect(aggregate(evidence,{},now.getTime()+181*86400000)).toEqual([]);});
 it('does not enqueue when learning is disabled',async()=>{const f=fixture({learning:false});await enqueueMemory(f.tx,actor,id,1);expect(f.execute).not.toHaveBeenCalled();});
 it.each([{learning:false},{epoch:2},{sourceVersion:2}])('late task cannot learn with stale gates %j',async options=>{const f=fixture(options);await processMemoryJob(id);expect(f.execute.mock.calls.some(c=>String(c[0]).includes('INSERT INTO "PreferenceEvidence"'))).toBe(false);});
 it('delete barrier prevents old sources from rebuilding a category',async()=>{const f=fixture({barrier:true});await processMemoryJob(id);expect(f.execute.mock.calls.map(c=>String(c[0])).filter(sql=>sql.includes('INSERT INTO "PreferenceEvidence"'))).toEqual([]);});
 it('automatic values never become shared input or new learning evidence',()=>{const i=emptyGatheringIntake();i.public.keywords.play=['看展'];i.private.preference_memory={use_history:true,automatic:{play:['看展']}};expect(separateAutomatic(i).public.keywords.play).toEqual([]);i.public.keywords.play=['唱歌'];expect(separateAutomatic(i).public.keywords.play).toEqual(['唱歌']);});
 it('generation reads permitted preferences and explicit current values win',async()=>{const f=fixture();f.intake.private.preference_memory={use_history:true,automatic:{}};f.intake.public.keywords.play=[];const rows=[{userId:actor,gatheringId:id,publicIntake:f.intake.public,answers:[],responseVersion:1}];const result=await resolveMemoryRows(f.tx,rows);expect((result.rows[0].publicIntake as typeof f.intake.public).keywords.play).toEqual(['看展']);f.intake.public.keywords.play=['唱歌'];const changed=await resolveMemoryRows(f.tx,rows);expect((changed.rows[0].publicIntake as typeof f.intake.public).keywords.play).toEqual(['唱歌']);});
 it('opting out injects no historical summary',async()=>{const f=fixture();f.intake.private.preference_memory={use_history:false,automatic:{}};f.intake.public.keywords.play=[];const result=await resolveMemoryRows(f.tx,[{userId:actor,gatheringId:id,publicIntake:f.intake.public,answers:[],responseVersion:1}]);expect((result.rows[0].publicIntake as typeof f.intake.public).keywords.play).toEqual([]);expect(result.stamp).toBe('[]');});
});
