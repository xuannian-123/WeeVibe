import { describe, expect, it } from 'vitest';
import { handoverMessage } from '../apps/web/src/server/handover-message';
const createdAt = new Date('2030-01-01T00:00:00Z'), resolvedAt = new Date('2030-01-02T00:00:00Z');
const source = { id: 'offer', activityId: 'activity', fromUserId: 'a', toUserId: 'b', fromManagementRevision: 1, status: 'pending' as const, createdAt, resolvedAt: null, activity: { name: '公开活动', currentManagerId: 'a', managementRevision: 1, cancelledAt: null as Date | null } };
describe('handover message lifecycle', () => {
  it('keeps existing pending receipt identity and targets only the recipient pending action', () => {
    expect(handoverMessage(source, 'b')).toMatchObject({ id: 'handover:offer', pending: true, status: '待接任' });
    expect(handoverMessage(source, 'a')).toMatchObject({ pending: false, status: '等待回应' });
  });
  it.each(['accepted', 'rejected', 'withdrawn', 'invalidated'] as const)('an already read pending invitation does not hide a new %s result', status => {
    const old = handoverMessage(source, 'a');
    const result = handoverMessage({ ...source, status, resolvedAt }, 'a');
    const readIds = new Set([old.id]);
    expect(readIds.has(result.id)).toBe(false);
    expect(result.created_at).toBe(resolvedAt.toISOString());
    expect(result.pending).toBe(false);
    expect(result.summary).not.toContain('等待回应');
  });
  it.each(['cancelled', 'manager-changed', 'same-manager-new-tenure'] as const)('fails closed for stale pending %s without rewriting database history', kind => {
    const offer = structuredClone(source);
    if (kind === 'cancelled') offer.activity.cancelledAt = resolvedAt;
    if (kind === 'manager-changed') offer.activity.currentManagerId = 'c';
    if (kind === 'same-manager-new-tenure') offer.activity.managementRevision = 3;
    expect(handoverMessage(offer, 'b')).toMatchObject({ status: '已失效', pending: false, id: 'handover:offer:invalidated' });
    expect(offer.status).toBe('pending');
  });
  it('later cancellation does not undo the successful handover message', () => {
    expect(handoverMessage({ ...source, status: 'accepted', resolvedAt, activity: { ...source.activity, currentManagerId: 'b', managementRevision: 2, cancelledAt: resolvedAt } }, 'b')).toMatchObject({ status: '已接任', pending: false });
  });
});
