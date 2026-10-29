import {randomInt} from 'node:crypto';
import {gatheringAvatarKeys} from '@weevibe/contracts';
import type {Tx} from '../activities/state';
import {ServiceError} from '../http';

/** Call under the parent activity lock (or while creating a new activity). The
 * composite database unique index is the final guard against duplicate keys. */
export async function allocateGatheringAvatar(tx:Tx,gatheringId:string){
  const assigned=await tx.gatheringMember.findMany({where:{gatheringId},select:{avatarKey:true}});
  const used=new Set(assigned.map(row=>row.avatarKey));
  const available=gatheringAvatarKeys.filter(key=>!used.has(key));
  if(!available.length)throw new ServiceError('CAPACITY_FULL',409,'这次活动的头像名额已用完');
  return available[randomInt(available.length)];
}
