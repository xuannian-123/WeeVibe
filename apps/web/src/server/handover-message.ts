import type { InboxMessage } from '@weevibe/contracts';

type Offer = {
  id: string; activityId: string; fromUserId: string; toUserId: string;
  fromManagementRevision: number;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'invalidated';
  createdAt: Date; resolvedAt: Date | null;
  activity: { name: string; currentManagerId: string; managementRevision: number; cancelledAt: Date | null };
};
/** Read receipts belong to a lifecycle result, never consent or management rights. */
export function handoverMessage(offer: Offer, actor: string): InboxMessage {
  const invalid = offer.status === 'pending' && (offer.activity.cancelledAt !== null
    || offer.activity.currentManagerId !== offer.fromUserId
    || offer.activity.managementRevision !== offer.fromManagementRevision);
  const status = invalid ? 'invalidated' : offer.status;
  const recipient = offer.toUserId === actor;
  const label = { pending: recipient ? '待接任' : '等待回应', accepted: '已接任', rejected: '已拒绝', withdrawn: '已撤回', invalidated: '已失效' }[status];
  const summary = status === 'pending' ? recipient ? '你收到一份活动管理交接邀请' : '你发起的管理交接正在等待回应'
    : status === 'accepted' ? recipient ? '你已接任活动管理，请查看当前管理入口' : '对方已接任活动管理，你的参加状态保留'
    : status === 'rejected' ? '管理交接已被拒绝，管理归属没有改变'
    : status === 'withdrawn' ? '管理交接已撤回，原邀请不能再接受'
    : '管理交接已失效，原邀请不能再接受';
  return {
    id: status === 'pending' ? `handover:${offer.id}` : `handover:${offer.id}:${status}`,
    activity_id: offer.activityId, title: offer.activity.name, summary,
    created_at: (offer.resolvedAt ?? (invalid ? offer.activity.cancelledAt : null) ?? offer.createdAt).toISOString(),
    read: false, pending: status === 'pending' && recipient, status: label, section: 'handover',
  };
}
