import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';
const h = vi.hoisted(() => ({ token: 'session-a', reads: 0, rotate: 0, transport: vi.fn(), locate: vi.fn() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => { if (++h.reads === h.rotate) h.token = 'session-b'; return h.token; }, transport: h.transport }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { getPrivacySetting:({success}:any)=>success({needAuthorization:false}),getSetting:async()=>({authSetting:{"scope.userLocation":true}}),authorize:vi.fn(),getLocation: h.locate } }));
import { locateBrowseCenterForSession, locateCityForSession, nearbyForSession, searchForSession, locationError } from '../apps/miniprogram/src/features/shell/location-api';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const coordinates = { latitude: 30.1234567, longitude: 120.2345678 };
const source = { provider: 'amap', source_api: 'https://restapi.amap.com/v5/place/around', checked_at: '2030-01-01T00:00:00Z' };
const city = { city: '杭州市', region: '浙江省', district: '西湖区', source: { ...source, source_api: 'https://restapi.amap.com/v3/geocode/regeo' } };
const list = { source, venues: [], excluded_count: 0, pagination: false };
const posts = () => h.transport.mock.calls.filter(([r]) => r.method === 'POST');
beforeEach(() => { h.token = 'session-a'; h.reads = 0; h.rotate = 0; h.locate.mockReset().mockResolvedValue(coordinates); h.transport.mockReset().mockImplementation(async r => ({ status: 200, body: r.path === '/api/v1/me' ? { user_id: A } : r.path.endsWith('/city') ? city : list })); });
describe('native location fixed-session boundary', () => {
  it.each(['city','nearby'] as const)('verifies server actor before native permission and sends only a bounded %s request', async kind => { const order: string[] = []; h.transport.mockImplementation(async r => { order.push(r.path); return { status: 200, body: r.path === '/api/v1/me' ? {user_id:A.toUpperCase()} : kind === 'city' ? city : list }; }); h.locate.mockImplementation(async () => { order.push('native'); return coordinates; }); const value = kind === 'city' ? await locateCityForSession('session-a', () => {}) : await nearbyForSession('session-a', '茶馆', () => {}); expect(value).toEqual(kind === 'city' ? city : list); expect(order).toEqual(['/api/v1/me','native',`/api/v1/venues/${kind}`]); expect(posts()[0][0].headers.Authorization).toBe('Bearer session-a'); expect(posts()[0][0].body[kind === 'city' ? 'location' : 'center']).toEqual({ latitude:30.123457,longitude:120.234568,crs:'GCJ-02' }); expect(JSON.stringify(posts()[0][0].body)).not.toContain(A); });
  it.each([1,2,3,4,5,6,7,8,9])('never substitutes B token when session rotates at check %s', async rotate => { h.rotate = rotate; await expect(nearbyForSession('session-a','',()=>{})).rejects.toMatchObject({code:'UNAUTHENTICATED'}); if (rotate <= 7) expect(posts()).toHaveLength(0); expect(h.transport.mock.calls.every(([r])=>r.headers.Authorization==='Bearer session-a')).toBe(true); });
  it('does not ask for native location when identity is missing or malformed', async () => { h.transport.mockResolvedValue({ status:200,body:{user_id:'RAW_COORDINATE_SECRET'} }); await expect(locateCityForSession('session-a',()=>{})).rejects.toMatchObject({code:'INVALID_RESPONSE'}); expect(h.locate).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0); });
  it('does not request identity or location without a source session', async () => { await expect(locateCityForSession(undefined,()=>{})).rejects.toMatchObject({code:'UNAUTHENTICATED'}); expect(h.transport).not.toHaveBeenCalled(); expect(h.locate).not.toHaveBeenCalled(); });
  it.each(['cancel','deny','unknown'])('normalizes native %s rejection without raw data', async mode => { h.locate.mockRejectedValue({errMsg:`getLocation:fail ${mode} PRIVATE_ADDRESS`}); let error:unknown;try{await nearbyForSession('session-a','',()=>{});}catch(e){error=e;} expect(locationError(error)).toMatch(/取消定位|未能获取位置|位置权限未开启/); expect(locationError(error)).not.toContain('PRIVATE_ADDRESS'); expect(posts()).toHaveLength(0); });
  it.each([{latitude:NaN,longitude:120},{latitude:30,longitude:200},{latitude:'private',longitude:120}])('does not send malformed native coordinates %#', async coordinates => { h.locate.mockResolvedValue(coordinates); await expect(locateCityForSession('session-a',()=>{})).rejects.toMatchObject({code:'INVALID_RESPONSE'}); expect(posts()).toHaveLength(0); });
  it.each([200,404,405,503])('rejects malformed or unavailable city response %s without exposing raw body', async status => { h.transport.mockImplementation(async r=>({status:r.method==='GET'?200:status,body:r.method==='GET'?{user_id:A}:'PRIVATE_RAW_COORDINATES'})); let error:unknown;try{await locateCityForSession('session-a',()=>{});}catch(e){error=e;} expect(error).toBeInstanceOf(ApiClientError); expect(locationError(error)).not.toContain('PRIVATE_RAW_COORDINATES'); });
  it('searches manually without obtaining native coordinates or fabricating a me result', async () => { await searchForSession('session-a',{region:'杭州',keyword:'公园'},()=>{}); expect(h.locate).not.toHaveBeenCalled(); expect(h.transport).toHaveBeenCalledTimes(1); expect(posts()[0][0]).toMatchObject({path:'/api/v1/venues/search',headers:{Authorization:'Bearer session-a'}}); });
  it('checks lifecycle after native resolution and immediately before the final POST', async () => { let current=true;h.locate.mockImplementation(async()=>{current=false;return coordinates;});await expect(locateCityForSession('session-a',()=>{if(!current)throw new ApiClientError('INVALID_RESPONSE','inactive',0);})).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(posts()).toHaveLength(0); });
});

 it.each(['city','nearby'] as const)('uses the shared precise adapter for %s without sending speed, accuracy or altitude',async kind=>{h.locate.mockResolvedValue({...coordinates,speed:2,accuracy:5,altitude:10});if(kind==='city')await locateCityForSession('session-a',()=>{});else await nearbyForSession('session-a','运动',()=>{});expect(h.locate).toHaveBeenCalledWith(expect.objectContaining({type:'gcj02',isHighAccuracy:true,highAccuracyExpireTime:5000}));const body=posts()[0][0].body;expect(body[kind==='city'?'location':'center']).toEqual({latitude:30.123457,longitude:120.234568,crs:'GCJ-02'});expect(JSON.stringify(body)).not.toMatch(/speed|accuracy|altitude/);});

it.each([2000,5000,8000,10000,15000,20000,25000,30000,35000,40000,50000])('uses the chosen map center and %s metre radius without reading GPS',async radius=>{
  const center={latitude:31.234568,longitude:120.123457,crs:'GCJ-02' as const};
  await nearbyForSession('session-a','休闲',()=>{},'custom',radius,center);
  expect(h.locate).not.toHaveBeenCalled();
  expect(posts()[0][0].body).toMatchObject({center,radius_m:radius});
});
it('rejects a radius above 50km before provider transport',async()=>{
  await expect(nearbyForSession('session-a','休闲',()=>{},'custom',50001,{latitude:31,longitude:120,crs:'GCJ-02'})).rejects.toThrow();
  expect(posts()).toHaveLength(0);
});

it('resolves the current city and district together with the same rounded search center',async()=>{
  const value=await locateBrowseCenterForSession('session-a',()=>{});
  expect(value).toMatchObject({city:'杭州市',district:'西湖区',location:{latitude:30.123457,longitude:120.234568,crs:'GCJ-02'}});
  await nearbyForSession('session-a','休闲',()=>{},'custom',2000,value.location);
  expect(h.locate).toHaveBeenCalledTimes(1);
  expect(posts().find(([r])=>r.path.endsWith('/nearby'))?.[0].body.center).toEqual(value.location);
});

it('fills a concrete nearby address using one native location read and no map selection',async()=>{
  h.transport.mockImplementation(async r=>({status:200,body:r.path==='/api/v1/me'?{user_id:A}:r.path.endsWith('/city')?{...city,nearest_address:'附近大厦 · 长江路18号'}:list}));
  const value=await locateBrowseCenterForSession('session-a',()=>{},true);
  expect(value.nearest_address).toBe('附近大厦 · 长江路18号');
  expect(posts()[0][0].body).toMatchObject({include_address:true});
  await nearbyForSession('session-a','休闲',()=>{},'custom',2000,value.location);
  expect(h.locate).toHaveBeenCalledTimes(1);
});
it('refuses a city-only old server response instead of filling the address box with an administrative area',async()=>{
  await expect(locateBrowseCenterForSession('session-a',()=>{},true)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
it('discards a concrete address after account rotation during the lookup',async()=>{
  h.transport.mockImplementation(async r=>{if(r.path.endsWith('/city'))h.token='session-b';return {status:200,body:r.path==='/api/v1/me'?{user_id:A}:{...city,nearest_address:'附近大厦 · 长江路18号'}};});
  await expect(locateBrowseCenterForSession('session-a',()=>{},true)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
