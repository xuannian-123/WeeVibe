import { Prisma } from '@prisma/client';
import { invitationSourceSchema } from '@weevibe/contracts/src/invitations';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { checkMayCreateInvitation, publicInvitationName } from './invitation-rules';
const include = { activity: { include: { segments: { orderBy: { position: 'asc' as const } } } } } satisfies Prisma.InvitationSourceInclude;
type Source = Prisma.InvitationSourceGetPayload<{ include: typeof include }>;
export function invitationSourceView(source: Source) {
  const segments=source.activity.segments.filter(s=>!s.cancelledAt);
  return invitationSourceSchema.parse({invitation_id:source.id,activity_id:source.activityId,title:source.activity.name,
    inviter_display_name:source.inviterDisplayName,inviter_avatar_url:source.inviterAvatarUrl,
    starts_at:segments.length?new Date(Math.min(...segments.map(s=>s.startsAt.getTime()))).toISOString():null,
    ends_at:segments.length?new Date(Math.max(...segments.map(s=>s.endsAt.getTime()))).toISOString():null,
    timezone:source.activity.timezone,cancelled:!!source.activity.cancelledAt||segments.length===0,source_only:true});
}
export function createInvitationSource(activityId:string,actorId:string){
 return mutation(async tx=>{
  const activity=await lockActivity(tx,activityId);checkMayCreateInvitation(activity,actorId,new Date());
  const profile=await tx.privateProfile.findUnique({where:{userId:actorId}});
  // Explicit source creation consents to publishing this nickname only, not the full private profile.
  const nickname=publicInvitationName(profile?.data);
  const source=await tx.invitationSource.upsert({where:{activityId_inviterUserId:{activityId,inviterUserId:actorId}},create:{activityId,inviterUserId:actorId,inviterDisplayName:nickname,inviterAvatarUrl:null},update:{},include});
  return invitationSourceView(source);
 });
}
export function getInvitationSource(invitationId:string){return withDb(async db=>{const source=await db.invitationSource.findUnique({where:{id:invitationId},include});if(!source)throw new ServiceError('NOT_FOUND',404,'未找到真实邀请入口');return invitationSourceView(source);});}
export function saveReceivedInvitation(invitationId:string,activityId:string,actorId:string){
 return mutation(async tx=>{
  // Account-level lock bounds stored invitations and races between two saved sources.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId}::uuid FOR UPDATE`;
  const source=await tx.invitationSource.findUnique({where:{id:invitationId},include});
  if(!source||source.activityId!==activityId)throw new ServiceError('NOT_FOUND',404,'邀请入口不存在或不属于此活动');
  const where={userId_invitationId:{userId:actorId,invitationId}};
  const existing=await tx.receivedInvitation.findUnique({where});
  if(!existing&&await tx.receivedInvitation.count({where:{userId:actorId}})>=100)throw new ServiceError('INVALID_INPUT',400,'最多保存100份邀请');
  const received=await tx.receivedInvitation.upsert({where,create:{userId:actorId,invitationId},update:{}});
  // Saving public provenance grants no participation, requirement access, or group membership.
  return {invitation:invitationSourceView(source),saved:true as const,saved_at:received.savedAt.toISOString()};
 });
}
