import { ServiceError } from '../http';
export function checkMayCreateInvitation(activity: { currentManagerId: string; cancelledAt: Date | null; segments: Array<{ cancelledAt: Date | null; endsAt: Date; participations: Array<{ userId: string; status: 'joined' | 'exited' }> }> }, actorId: string, now: Date) {
  if(activity.cancelledAt)throw new ServiceError('ACTIVITY_CANCELLED',409,'已取消的活动不能新建邀请入口');
  if(activity.currentManagerId===actorId)return;
  if(!activity.segments.some(s=>!s.cancelledAt&&s.endsAt>now&&s.participations.some(p=>p.userId===actorId&&p.status==='joined')))throw new ServiceError('FORBIDDEN',403,'只有当前管理者或有效已参加成员可以创建邀请入口');
}
export function publicInvitationName(data: unknown): string | null {
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const nickname=(data as Record<string,unknown>).nickname;
  return typeof nickname==='string'&&nickname.trim()&&nickname.length<=32?nickname.trim():null;
}
export function invitationDisplayStatus(cancelled: boolean, startsAt: Date | null, endsAt: Date | null, now: Date) {
  if(cancelled)return '已取消';
  if(!startsAt||!endsAt)return '时间待定';
  return now<startsAt?'待参加':now>=endsAt?'已结束':'活动中';
}
