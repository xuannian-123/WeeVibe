import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type Transport } from '../packages/api-client/src';

describe('venue client integration (offline transport)', () => {
  const source = { provider: 'amap', checked_at: '2026-10-24T00:00:00Z', source_api: 'https://restapi.amap.com/v5/place/text' };
  it('uses the authenticated WeeVibe API and validates sourced empty results', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, body: { source, venues: [], excluded_count: 0, pagination: false } }));
    const result = await createApiClient(transport, () => 'fixture-session').searchVenues({ keyword: '羽毛球', region: '上海' });
    expect(result.venues).toEqual([]);
    expect(transport.mock.calls[0][0]).toMatchObject({ path: '/api/v1/venues/search', method: 'POST', headers: { Authorization: 'Bearer fixture-session' }, body: { page_size: 5 } });
    expect(JSON.stringify(transport.mock.calls)).not.toContain('key=');
  });
  it('rejects invalid coordinates before transport and malformed upstream success', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, body: {} }));
    const api = createApiClient(transport);
    await expect(api.walkRoute({ origin: { longitude: 31, latitude: 121, crs: 'GCJ-02' }, destination: { longitude: 121, latitude: 31, crs: 'GCJ-02' } })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await expect(api.searchVenues({ keyword: '羽毛球', region: '上海' })).rejects.toThrow();
  });
});
