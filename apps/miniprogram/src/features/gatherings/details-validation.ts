import {z} from 'zod';
import {gatheringDetailsSchema,gatheringFriendMemberLimit,type GatheringDetails,type GatheringSnapshot} from '@weevibe/contracts';

// Retain incomplete historic friend supplements for local read-only recovery.
export const gatheringDetailsDraftSchema=z.object(gatheringDetailsSchema.shape).strict();

export function gatheringCapacityReached(snapshot:GatheringSnapshot){
  return snapshot.gathering.kind==='friend'&&!snapshot.viewer.is_member&&!snapshot.final_choice
    &&snapshot.gathering.member_count>=Math.min(snapshot.gathering.details.capacity??gatheringFriendMemberLimit,gatheringFriendMemberLimit);
}
