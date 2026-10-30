import { describe, expect, it, vi } from 'vitest';
import { createAmapProvider, createVenueLimiter } from '../apps/web/src/server/providers/amap';
import { createVenueHandler } from '../apps/web/src/server/providers/amap/route-handler';
import { ServiceError } from '../apps/web/src/server/http';
import { gcj02Schema, venueListSchema, venueWalkResultSchema } from '../packages/contracts/src/venues';

// All upstream responses and identities below are offline fixtures, not DB or
// WeChat verification. No real key, API or repository-external file is read.
const KEY = 'offline-amap-secret-for-tests';
const center = { longitude: 121.451445, latitude: 31.227973, crs: 'GCJ-02' as const };
const destination = { ...center, longitude: 121.452 };
const search = { keyword: '羽毛球', region: '上海市', category: 'sport' };
const nearby = { center, category: 'restaurant', radius_m: 1500 };
const fixturePoi = { id: 'fixture-id', name: '测试场馆', typecode: '080118', location: '121.451445,31.227973', business: { cost: '47.00' } };
const good = (extra: object) => new Response(JSON.stringify({ status: '1', infocode: '10000', ...extra }), { headers: { 'Content-Type': 'application/json' } });
const fixedNow = () => new Date('2026-10-24T08:00:00Z');
function provider(response: () => Response = () => good({ pois: [] })) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
  return { fetcher, service: createAmapProvider({ fetch: fetcher, getKey: () => KEY, now: fixedNow }) };
}

describe('AMap provider: offline only', () => {
  it('returns bounded real-photo fields and rejects credential-bearing or unsafe image URLs', async () => {
    const { service, fetcher } = provider(() => good({ pois: [{ ...fixturePoi, adname:'浦东新区', photos:[{url:'https://store.is.autonavi.com/example.jpg',title:'场馆图片'},{url:'http://unsafe.test/image.jpg'},{url:`https://images.test/${KEY}.jpg`}] }] }));
    const result = await service.search('verified-user', search);
    expect(result.venues[0].photos).toEqual([{url:'https://store.is.autonavi.com/example.jpg',title:'场馆图片'}]);
    expect(result.venues[0].district).toBe('浦东新区');expect(JSON.stringify(result)).not.toContain(KEY);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('show_fields')).toBe('business,photos');
  });
  it('rejects swapped, wrong CRS, outside range and excess precision coordinates', () => {
    for (const v of [ { ...center, longitude: 31, latitude: 121 }, { ...center, crs: 'WGS84' },
      { ...center, longitude: 181 }, { ...center, latitude: -1 }, { ...center, longitude: 121.4514457 }, { ...center, longitude: '121.45' } ]) {
      expect(gcj02Schema.safeParse(v).success).toBe(false);
    }
  });
  it('rejects unbounded radius, page size, extra fields and empty custom keyword before fetch', async () => {
    const { service, fetcher } = provider();
    for (const input of [{ ...nearby, radius_m: 0 }, { ...nearby, radius_m: 50001 }, { ...nearby, page_size: 11 },
      { ...nearby, page_size: '5' }, { ...nearby, url: 'https://evil.test' }, { ...nearby, category: 'custom' },
      { ...nearby, center: { ...center, latitude: 121 } }]) {
      await expect(service.nearby('verified-user', input)).rejects.toMatchObject({ reason: 'INVALID_INPUT' });
    }
    await expect(service.search('verified-user', { ...search, keyword: '' })).rejects.toMatchObject({ reason: 'INVALID_INPUT' });
    await expect(service.walk('verified-user', { origin: center, destination: { ...center, crs: 'BD09' } })).rejects.toMatchObject({ reason: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('missing configuration fails without calling fetch', async () => {
    const fetcher = vi.fn();
    const service = createAmapProvider({ fetch: fetcher, getKey: () => '' });
    await expect(service.search('verified-user', search)).rejects.toMatchObject({ code: 'NOT_CONFIGURED', status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps source, unknowns and sports cost unit; removes training institutions', async () => {
    const { service } = provider(() => good({ pois: [fixturePoi, { ...fixturePoi, id: 'training', typecode: '140000' }] }));
    const result = await service.search('verified-user', search);
    expect(venueListSchema.safeParse(result).success).toBe(true);
    expect(result.excluded_count).toBe(1); expect(result.venues).toHaveLength(1);
    const venue = result.venues[0];
    expect(venue.reference_cost).toMatchObject({ value: '47.00', unit: null, is_transaction_quote: false });
    expect(venue.opening_today).toMatchObject({ value: null, verification: 'unknown' });
    expect(venue.source.checked_at).toBe('2026-10-24T08:00:00.000Z');
    expect(venue.inventory).toBe('unknown'); expect(venue.booking).toBe('unknown');
  });
  it('nearby uses fixed official host, order, radius, first page only and dining unit', async () => {
    const calls: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new URL(String(input)));
      expect(init?.redirect).toBe('error'); expect(init?.cache).toBe('no-store');
      return good({ pois: [{ ...fixturePoi, typecode: '050100', distance: '30' }, { ...fixturePoi, typecode: '050100', distance: '1600' }] });
    });
    const service = createAmapProvider({ fetch: fetcher, getKey: () => KEY });
    const result = await service.nearby('verified-user', nearby);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls[0].origin + calls[0].pathname).toBe('https://restapi.amap.com/v5/place/around');
    expect(calls[0].searchParams.get('location')).toBe('121.451445,31.227973');
    expect(calls[0].searchParams.get('page_num')).toBe('1');
    expect(calls[0].searchParams.get('radius')).toBe('1500');
    expect(result.venues[0].reference_cost.unit).toBe('person');
    expect(result.excluded_count).toBe(1); expect(result.pagination).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it('empty successful search returns empty without fake places', async () => {
    const { service } = provider();
    expect((await service.search('verified-user', search)).venues).toEqual([]);
  });
  it('preserves returned walk metres/seconds with explicit estimate caveats', async () => {
    const { service } = provider(() => good({ route: { paths: [{ distance: '20', duration: '16' }] } }));
    const result = await service.walk('verified-user', { origin: center, destination });
    expect(venueWalkResultSchema.safeParse(result).success).toBe(true);
    expect(result.route).toEqual({ distance_m: 20, duration_seconds: 16, basis: 'provider_estimate', includes_indoor_transfer: false, includes_activity_buffer: false, booking: 'unknown' });
  });
  it('no walk path stays null, invalid metric does not become zero', async () => {
    expect((await provider(() => good({ route: { paths: [] } })).service.walk('u', { origin: center, destination })).route).toBeNull();
    for (const path of [{ distance: '', duration: '16' }, { distance: '-20', duration: '16' }, { distance: '20', duration: 'oops' }]) {
      await expect(provider(() => good({ route: { paths: [path] } })).service.walk('u', { origin: center, destination })).rejects.toMatchObject({ reason: 'INVALID_RESPONSE' });
    }
  });
  it('provider errors, non-JSON, malformed and oversized bodies are sanitized without retry', async () => {
    const responses = [new Response(`secret ${KEY}`, { status: 500 }), new Response(KEY), good({ pois: null }),
      new Response(JSON.stringify({ status: '0', infocode: '10001', info: `echo:${KEY}` })),
      new Response('x'.repeat(262145)), new Response('{}', { headers: { 'content-length': '262145' } })];
    for (const response of responses) {
      const { service, fetcher } = provider(() => response);
      const error = await service.search('verified-user', search).catch(e => e);
      expect(error).toBeInstanceOf(ServiceError);
      expect(String(error)).not.toContain(KEY); expect(JSON.stringify(error)).not.toContain(KEY);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('redacts key echoed in allowed upstream fields', async () => {
    const { service } = provider(() => good({ pois: [{ ...fixturePoi, name: `echo ${KEY}`, business: { tel: KEY } }] }));
    const result = await service.search('verified-user', search);
    expect(JSON.stringify(result)).not.toContain(KEY); expect(result.venues[0].name).toContain('[REDACTED]');
  });
  it('network rejection and response-body stall time out safely', async () => {
    const broken = createAmapProvider({ getKey: () => KEY, fetch: vi.fn(async () => { throw new Error(`url?key=${KEY}`); }) });
    await expect(broken.search('u', search)).rejects.toMatchObject({ reason: 'UPSTREAM_FAILED' });
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start() { /* never emits */ } })));
    const stalled = createAmapProvider({ getKey: () => KEY, fetch: fetcher, timeoutMs: 10 });
    const error = await stalled.search('u', search).catch(e => e);
    expect(error.reason).toBe('TIMEOUT'); expect(String(error)).not.toContain(KEY);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fetch itself ignoring AbortSignal cannot bypass the timeout', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const service = createAmapProvider({ getKey: () => KEY, fetch: fetcher, timeoutMs: 10 });
    await expect(service.search('u', search)).rejects.toMatchObject({ reason: 'TIMEOUT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('unverified category can be keyword queried without claiming live category verification', async () => {
    const calls: URL[] = [];
    const service = createAmapProvider({ getKey: () => KEY, fetch: vi.fn(async input => {
      calls.push(new URL(String(input))); return good({ pois: [] });
    }) });
    await service.nearby('u', { ...nearby, category: 'board_game' });
    expect(calls[0].searchParams.get('keywords')).toBe('桌游');
    expect(calls[0].searchParams.has('types')).toBe(false);
  });
  it('per-user limit shared across operations, bounded and reset after window', async () => {
    let clock = 0;
    const consume = createVenueLimiter({ limit: 1, windowMs: 1000, maxUsers: 2, now: () => clock });
    const fetcher = vi.fn(async () => good({ pois: [] }));
    const service = createAmapProvider({ getKey: () => KEY, fetch: fetcher, consume });
    await service.search('one', search);
    await expect(service.nearby('one', nearby)).rejects.toMatchObject({ reason: 'RATE_LIMITED', status: 429 });
    await service.search('two', search);
    await expect(service.search('three', search)).rejects.toMatchObject({ reason: 'RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock = 1000; await service.search('one', search);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('quota and frequency errors preserve only stable local categories', async () => {
    for (const [code, reason] of [['10003', 'QUOTA_EXHAUSTED'], ['10004', 'RATE_LIMITED']]) {
      const { service } = provider(() => new Response(JSON.stringify({ status: '0', infocode: code, info: KEY })));
      await expect(service.search('u', search)).rejects.toMatchObject({ reason });
    }
    await expect(provider(() => new Response('', { status: 429 })).service.search('u', search)).rejects.toMatchObject({ reason: 'RATE_LIMITED' });
  });
});

describe('venue route boundary using shared handle (offline identity fixtures)', () => {
  const request = (body: unknown) => new Request('http://local.test/api/v1/venues/search', {
    method: 'POST', headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  it('authenticates first, never invokes provider for unauthenticated request', async () => {
    const { service, fetcher } = provider();
    const identity = { authenticate: vi.fn(async () => { throw new ServiceError('UNAUTHENTICATED', 401, '请先登录'); }) };
    const response = await createVenueHandler('search', identity, service)(request(search));
    expect(response.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('uses verified user identity and rejects client user_id/URL claims', async () => {
    const { service, fetcher } = provider();
    const identity = { authenticate: vi.fn(async () => ({ user_id: 'verified-user' })) };
    const handler = createVenueHandler('search', identity, service);
    const bad = await handler(request({ ...search, user_id: 'forged', url: 'https://evil.test' }));
    expect(bad.status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
    const goodResponse = await handler(request(search));
    expect(goodResponse.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(identity.authenticate).toHaveBeenCalledWith('Bearer fixture-token');
  });
  it('uses handle error envelope with no URL, key or upstream raw body', async () => {
    const { service } = provider(() => new Response(`<html>https://upstream/?key=${KEY}</html>`));
    const response = await createVenueHandler('search', { authenticate: async () => ({ user_id: 'verified' }) }, service)(request(search));
    const body = await response.text();
    expect(response.status).toBe(502); expect(body).not.toContain(KEY); expect(body).not.toContain('<html>');
    expect(JSON.parse(body).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

it('forwards the 50km boundary to the provider and excludes farther results',async()=>{
  const {service,fetcher}=provider(()=>good({pois:[{...fixturePoi,distance:'49999'},{...fixturePoi,id:'outside',distance:'50001'}]}));
  const result=await service.nearby('verified-user',{...nearby,category:'sport',radius_m:50000});
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('radius')).toBe('50000');
  expect(result.venues.map(v=>v.provider_id)).toEqual(['fixture-id']);
});
