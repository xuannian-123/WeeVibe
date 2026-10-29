import {randomUUID,createHash} from 'node:crypto';
import {vi} from 'vitest';
import type {Gathering,GatheringGeneration,GatheringMember,GatheringSubmissionEvent,GatheringNotificationRecipient,GatheringPushOutbox} from '@prisma/client';
import type {Tx} from '../apps/web/src/server/activities/state';
import {emptyGatheringDetails,emptyGatheringIntake,type GatheringDetails,type GatheringIntake,type GatheringItinerary} from '../packages/contracts/src';
export const gatheringOwner='11111111-1111-4111-8111-111111111111',gatheringAlice='22222222-2222-4222-8222-222222222222',gatheringBob='33333333-3333-4333-8333-333333333333',gatheringId='44444444-4444-4444-8444-444444444444';
export const gatheringFixtureDetails=():GatheringDetails=>({...emptyGatheringDetails(),date:'2030-02-01',title:'朋友出游',deadline_at:'2030-01-30T00:00:00Z',confirmed_details:['date','title']});
export function gatheringFixtureIntake(note='一起吃饭'):GatheringIntake{const i=emptyGatheringIntake();i.public.activity_nickname='出游伙伴';i.public.date='2030-02-01';i.public.note=note;return i;}
export function gatheringFixturePlan():GatheringItinerary{return{plans:[{id:'plan1',title:'方案1',summary:'吃饭再玩',segments:[{id:'s1',title:'吃饭',description:'一起吃饭',date:'2030-02-01',start_time:'',end_time:'',place:'',address:'',fee_note:'费用待核实',unknowns:['地点待选择']}],notes:[]},{id:'plan2',title:'方案2',summary:'先玩后吃',segments:[{id:'s1',title:'一起玩桌游',description:'轻松聊聊天',date:'2030-02-01',start_time:'',end_time:'',place:'',address:'',fee_note:'费用待核实',unknowns:['地点待选择']}],notes:[]}],notes:[]};}

/** Query-projection and transaction-function double, not PostgreSQL concurrency. */
export function gatheringBackendFixture(kind:'friend'|'team'='friend'){
  const now=new Date();
  const gatherings=new Map<string,Gathering>([[gatheringId,{id:gatheringId,ownerUserId:gatheringOwner,kind,details:gatheringFixtureDetails() as never,revision:1,creationKey:randomUUID(),creationHash:'a'.repeat(64),currentGenerationId:null,finalGenerationId:null,finalPlanId:null,finalizedAt:null,submissionSequence:0,createdAt:now,updatedAt:now}]]);
  const members=new Map<string,GatheringMember>(),generations=new Map<string,GatheringGeneration>();
  const events=new Map<string,GatheringSubmissionEvent>(),recipients=new Map<string,GatheringNotificationRecipient>(),outbox=new Map<string,GatheringPushOutbox>(),incompleteProfiles=new Set<string>();
  const project=(row:unknown,select?:Record<string,boolean>)=>row&&select?Object.fromEntries(Object.entries(row).filter(([k])=>select[k])):row;
  const seed=(userId:string,intake=gatheringFixtureIntake(),version=1,id=gatheringId)=>{
    const row:GatheringMember={gatheringId:id,userId,animalId:'cat',avatarKey:null,publicIntake:intake.public as never,privateIntake:intake.private as never,answers:intake.answers as never,responseVersion:version,firstSubmissionSequence:version>0?0:null,lastWriteKey:null,lastWriteHash:null,createdAt:new Date(),updatedAt:new Date()};members.set(`${id}:${userId}`,row);return row;
  };
  seed(gatheringOwner);seed(gatheringAlice,gatheringFixtureIntake('想一起唱歌'));
  const locks:string[]=[];let onLock:(()=>void)|undefined;
  const raw={
    $queryRaw:vi.fn(async(strings:TemplateStringsArray)=>{locks.push(strings.join('?'));onLock?.();return[];}),
    gathering:{
      findUnique:vi.fn(async({where,select}:any)=>project(where.id?gatherings.get(where.id):[...gatherings.values()].find(g=>g.ownerUserId===where.ownerUserId_creationKey.ownerUserId&&g.creationKey===where.ownerUserId_creationKey.creationKey),select)??null),
      create:vi.fn(async({data}:any)=>{const row={id:randomUUID(),revision:1,currentGenerationId:null,finalGenerationId:null,finalPlanId:null,finalizedAt:null,submissionSequence:0,createdAt:new Date(),updatedAt:new Date(),...data} as Gathering;gatherings.set(row.id,row);return row;}),
      update:vi.fn(async({where,data}:any)=>{const old=gatherings.get(where.id)!;const row={...old,...data,revision:typeof data.revision==='object'?old.revision+data.revision.increment:old.revision,submissionSequence:typeof data.submissionSequence==='object'?old.submissionSequence+data.submissionSequence.increment:old.submissionSequence,updatedAt:new Date()};gatherings.set(row.id,row);return row;}),
      findMany:vi.fn(async({where}:any)=>[...gatherings.values()].filter(g=>members.has(`${g.id}:${where.members.some.userId}`)).map(g=>({...g,_count:{members:[...members.values()].filter(m=>m.gatheringId===g.id).length},members:[...members.values()].filter(m=>m.gatheringId===g.id&&m.userId===where.members.some.userId).map(m=>({responseVersion:m.responseVersion}))}))),
    },
    gatheringMember:{
      findUnique:vi.fn(async({where,select}:any)=>project(members.get(`${where.gatheringId_userId.gatheringId}:${where.gatheringId_userId.userId}`),select)??null),
      findMany:vi.fn(async({where,select,take}:any)=>[...members.values()].filter(m=>m.gatheringId===where.gatheringId&&(!where.userId?.gt||m.userId>where.userId.gt)&&(!where.responseVersion||m.responseVersion>where.responseVersion.gt)&&(!where.firstSubmissionSequence||m.firstSubmissionSequence!==null&&m.firstSubmissionSequence<where.firstSubmissionSequence.lt)).sort((a,b)=>a.userId.localeCompare(b.userId)).slice(0,take).map(m=>project(m,select))),
      count:vi.fn(async({where}:any)=>[...members.values()].filter(m=>m.gatheringId===where.gatheringId&&(!where.responseVersion||m.responseVersion>where.responseVersion.gt)).length),
      create:vi.fn(async({data}:any)=>{const row={animalId:'cat',avatarKey:null,responseVersion:0,firstSubmissionSequence:null,lastWriteKey:null,lastWriteHash:null,createdAt:new Date(),updatedAt:new Date(),...data} as GatheringMember;members.set(`${row.gatheringId}:${row.userId}`,row);return row;}),
      update:vi.fn(async({where,data}:any)=>{const key=`${where.gatheringId_userId.gatheringId}:${where.gatheringId_userId.userId}`,old=members.get(key)!;const row={...old,...data,responseVersion:data.responseVersion?old.responseVersion+data.responseVersion.increment:old.responseVersion,updatedAt:new Date()};members.set(key,row);return row;}),
    },
    gatheringGeneration:{
      findUnique:vi.fn(async({where}:any)=>where.id?generations.get(where.id)??null:[...generations.values()].find(g=>g.gatheringId===where.gatheringId_idempotencyKey.gatheringId&&g.idempotencyKey===where.gatheringId_idempotencyKey.idempotencyKey)??null),
      findFirst:vi.fn(async({where,select,orderBy}:any)=>{const found=[...generations.values()].filter(g=>(!where.id||g.id===where.id)&&g.gatheringId===where.gatheringId&&(!where.status||g.status===where.status));if(orderBy)found.sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime());return project(found[0],select)??null;}),
      create:vi.fn(async({data}:any)=>{const row={id:randomUUID(),result:null,error:null,createdAt:new Date(),updatedAt:new Date(),...data} as GatheringGeneration;generations.set(row.id,row);return row;}),
      update:vi.fn(async({where,data}:any)=>{const row={...generations.get(where.id)!,...data,updatedAt:new Date()};generations.set(row.id,row);return row;}),
      updateMany:vi.fn(async({where,data}:any)=>{let count=0;for(const row of generations.values())if((!where.id||row.id===where.id)&&(!where.gatheringId||row.gatheringId===where.gatheringId)&&(!where.status||row.status===where.status)&&(!where.createdAt||row.createdAt<where.createdAt.lt)){Object.assign(row,data,{updatedAt:new Date()});count++;}return{count};}),
    },
    gatheringSubmissionEvent:{create:vi.fn(async({data,select}:any)=>{const row={id:randomUUID(),createdAt:new Date(),...data} as GatheringSubmissionEvent;events.set(row.id,row);return project(row,select);})},
    gatheringNotificationRecipient:{createMany:vi.fn(async({data}:any)=>{for(const value of data){const row={createdAt:new Date(),...value} as GatheringNotificationRecipient;recipients.set(row.id,row);}return{count:data.length};}),findMany:vi.fn(async({where,take}:any)=>[...recipients.values()].filter(row=>row.userId===where.userId).slice(0,take).map(row=>{const event=events.get(row.eventId)!;return{id:row.id,createdAt:row.createdAt,event:{action:event.action,gatheringId:event.gatheringId,gathering:{kind:gatherings.get(event.gatheringId)!.kind}}};}))},
    gatheringPushOutbox:{createMany:vi.fn(async({data}:any)=>{for(const value of data){const row={id:randomUUID(),status:'pending',nextAttemptAt:new Date(),attempts:0,leaseTokenHash:null,leaseExpiresAt:null,grantId:null,lastErrorCode:null,sentAt:null,createdAt:new Date(),updatedAt:new Date(),...value} as GatheringPushOutbox;outbox.set(row.id,row);}return{count:data.length};})},
    privateProfile:{findMany:vi.fn(async({where}:any)=>where.userId.in.map((userId:string)=>({userId,data:{nickname:userId===gatheringOwner?'局头':userId===gatheringAlice?'Alice':'Bob',birthday:'PRIVATE_PROFILE_SENTINEL'}}))),findUnique:vi.fn(async({where}:any)=>incompleteProfiles.has(where.userId)?null:{data:{nickname:where.userId===gatheringOwner?'局头':'已保存昵称'}})},
    userAvatar:{findMany:vi.fn(async()=>[]),findUnique:vi.fn(async({where}:any)=>incompleteProfiles.has(where.userId)?null:{bytes:Buffer.from([255,216,255,217]),contentType:'image/jpeg',digest:createHash('sha256').update(Buffer.from([255,216,255,217])).digest('hex')})},
  };
  return{tx:raw as unknown as Tx,raw,gatherings,members,generations,events,recipients,outbox,incompleteProfiles,locks,seed,setOnLock:(fn:()=>void)=>{onLock=fn;},details:()=>gatherings.get(gatheringId)!.details as unknown as GatheringDetails};
}
