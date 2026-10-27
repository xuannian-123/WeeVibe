import type { Venue } from '../packages/contracts/src/venues';
export const accountActor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const accountActivity = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export function accountVenue(): Venue {
  const source = { provider: 'amap' as const, checked_at: '2030-01-01T00:00:00Z', source_api: 'https://restapi.amap.com/v5/place/text' as const };
  const text = { value: null, source, verification: 'unknown' as const };
  return { provider: 'amap', provider_id: 'offline-venue', name: '离线测试公园', address: null,
    category_code: '', category_text: null, location: { longitude: 121.4737, latitude: 31.2304, crs: 'GCJ-02' }, source,
    telephone: text, opening_today: text, opening_week: text, rating: text,
    reference_cost: { ...text, currency: 'CNY', unit: null, is_transaction_quote: false },
    search_distance_m: null, search_distance_kind: 'search_distance_not_walk_route', inventory: 'unknown', booking: 'unknown', suitability: 'not_merchant_verified' };
}
export function emptyAccountFixture() {
  return { profile: { nickname: '', birthday: '', gender: '未设置', zodiac: '', mbti: '', signature: '', introduction: '' },
    favorites: [] as Venue[], activities: [], invitations: [], messages: [], activity_records: [],
    capabilities: { invitations: true, avatar_upload: true }, limit: 100, server_time: '2030-01-01T00:00:00Z' };
}
