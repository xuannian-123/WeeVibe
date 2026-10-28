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
