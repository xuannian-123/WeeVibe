import {randomUUID} from 'node:crypto';
import type {Gathering} from '@prisma/client';
import type {Tx} from '../activities/state';
import {ServiceError} from '../http';

/** Call under the gathering row lock, in the same transaction as the answer write. */
export async function enqueueGatheringSubmission(tx:Tx,row:Pick<Gathering,'id'|'kind'|'ownerUserId'>,actor:string,version:number,sequence:number){
  const event=await tx.gatheringSubmissionEvent.create({data:{gatheringId:row.id,actorUserId:actor,actorVersion:version,sequence,action:version===1?'submitted':'updated'},select:{id:true}});
  const recipients=new Set<string>([row.ownerUserId]);
  if(row.kind==='friend'){
    // Eligibility survives later edits: it is the first submission, not updatedAt.
    const earlier=await tx.gatheringMember.findMany({where:{gatheringId:row.id,responseVersion:{gt:0},firstSubmissionSequence:{lt:sequence}},select:{userId:true},take:501});
    if(earlier.length>500)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'通知成员超出完整读取上限');
    for(const member of earlier)recipients.add(member.userId);
  }
  recipients.delete(actor);
  const records=[...recipients].sort().map(userId=>({id:randomUUID(),eventId:event.id,userId}));
  if(records.length){
    await tx.gatheringNotificationRecipient.createMany({data:records});
    await tx.gatheringPushOutbox.createMany({data:records.map(record=>({recipientId:record.id}))});
  }
}

/** Lifecycle events share the durable per-recipient outbox; no direct provider send in a mutation. */
export async function enqueueGatheringLifecycle(tx:Tx,row:Pick<Gathering,'id'|'kind'|'ownerUserId'>,actor:string,action:'plans_ready'|'selection_updated'|'confirmation_requested'|'confirmation_declined'|'completed'){
 const next=await tx.gathering.update({where:{id:row.id},data:{submissionSequence:{increment:1}}});
 const event=await tx.gatheringSubmissionEvent.create({data:{gatheringId:row.id,actorUserId:actor,actorVersion:Math.max(1,next.revision),sequence:next.submissionSequence,action},select:{id:true}});
 const members=await tx.gatheringMember.findMany({where:{gatheringId:row.id},select:{userId:true},take:501});
 if(members.length>500)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'成员范围暂时无法核对');
 const all=row.kind==='friend'||action==='completed';
 const people=all?members.map(m=>m.userId):[row.ownerUserId];
 const recipients=[...new Set(people)].filter(userId=>userId!==actor).map(userId=>({id:randomUUID(),eventId:event.id,userId}));
 if(recipients.length){await tx.gatheringNotificationRecipient.createMany({data:recipients});await tx.gatheringPushOutbox.createMany({data:recipients.map(r=>({recipientId:r.id}))});}
}
