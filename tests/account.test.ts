import { describe, expect, it } from 'vitest';
import { emptyProfile, parsePrivateProfile, participationDisplayStatus, parseDecisionMessageId } from '../apps/web/src/server/account-rules';
const now = new Date('2026-10-26T11:50:00Z');
describe('private account rules', () => {
  it('allows empty optional profile', () => expect(parsePrivateProfile({}, now)).toEqual(emptyProfile));
  it('trims nickname and preserves valid optional data', () => expect(parsePrivateProfile({ nickname: '  小明 ', birthday: '2000-02-29', mbti: 'INTJ' }, now).nickname).toBe('小明'));
  it.each(['2026-10-27', '2025-02-29', '0000-00-00', '2026-1-1'])('rejects invalid/future birthday %s', birthday => expect(() => parsePrivateProfile({ birthday }, now)).toThrow());
  it('rejects identity and avatar injection', () => { expect(() => parsePrivateProfile({ user_id: 'other' })).toThrow(); expect(() => parsePrivateProfile({ avatar_url: 'wxfile://temp' })).toThrow(); });
  it('rejects excessive signature and malformed MBTI', () => { expect(() => parsePrivateProfile({ signature: 'a'.repeat(101) })).toThrow(); expect(() => parsePrivateProfile({ mbti: 'ABCD' })).toThrow(); });
  it('computes statuses on server times and keeps cancellation separate', () => {
    const segments = [{ startsAt: new Date('2026-10-26T12:00:00Z'), endsAt: new Date('2026-10-26T13:00:00Z'), cancelledAt: null }];
    expect(participationDisplayStatus(segments, false, now)).toBe('待参加');
    expect(participationDisplayStatus(segments, false, new Date('2026-10-26T12:00:00Z'))).toBe('活动中');
    expect(participationDisplayStatus(segments, false, new Date('2026-10-26T13:00:00Z'))).toBe('已结束');
    expect(participationDisplayStatus(segments, true, now)).toBe('已取消');
  });
  it('only accepts actual decision ID shapes', () => {
    expect(parseDecisionMessageId('application:11111111-1111-1111-1111-111111111111:approved').status).toBe('approved');
    expect(() => parseDecisionMessageId('application:11111111-1111-1111-1111-111111111111:pending')).toThrow();
  });
});
