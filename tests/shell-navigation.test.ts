import { describe, expect, it } from 'vitest';
import { COMMON_CITIES, activityPathFromScan, validCity } from '../apps/miniprogram/src/features/shell/helpers';
describe('new shell navigation boundaries', () => {
  it('contains the exact twelve requested cities', () => expect([...COMMON_CITIES]).toEqual(['北京','天津','上海','苏州','深圳','南京','重庆','成都','杭州','武汉','南昌','青岛']));
  it('accepts only internal activity routes', () => expect(activityPathFromScan('pages/activity/index?id=550e8400-e29b-41d4-a716-446655440000')).toBe('/pages/activity/index?id=550e8400-e29b-41d4-a716-446655440000'));
  it.each(['https://evil.example/pages/activity/index?id=x','javascript:alert(1)','/pages/activity/index?id=x&redirect=https://evil.example','/pages/activity/index?id=../private','/pages/editor/index'])('rejects untrusted scan %s', value => expect(activityPathFromScan(value)).toBeUndefined());
  it('validates city text without requiring location permission', () => { expect(validCity('杭州')).toBe(true); expect(validCity('')).toBe(false); expect(validCity('<script>')).toBe(false); });
});

// A verified share-entry identity must survive scanning, without admitting arbitrary URLs.
it('preserves a strictly validated invitation source in the internal activity path',()=>expect(activityPathFromScan('/pages/activity/index?id=550e8400-e29b-41d4-a716-446655440000&invitation_id=660e8400-e29b-41d4-a716-446655440000')).toBe('/pages/activity/index?id=550e8400-e29b-41d4-a716-446655440000&invitation_id=660e8400-e29b-41d4-a716-446655440000'));
it.each(['/pages/activity/index?id=abc','/pages/activity/index?id=550e8400-e29b-41d4-a716-446655440000&invitation_id=not-uuid','/pages/activity/index?id=550e8400-e29b-41d4-a716-446655440000&invitation_id=660e8400-e29b-41d4-a716-446655440000&redirect=evil'])('rejects unsafe scan extras %s',value=>expect(activityPathFromScan(value)).toBeUndefined());
