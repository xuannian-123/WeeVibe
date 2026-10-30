import { describe, expect, it, vi } from 'vitest';
import { createCityProvider } from '../apps/web/src/server/providers/city';
const location = {longitude:116.397128,latitude:39.916527,crs:'GCJ-02'};
const key = 'offline-key';
const result = (city:unknown, province='北京市') => new Response(JSON.stringify({status:'1',infocode:'10000',regeocode:{formatted_address:'PRIVATE ADDRESS NOT RETURNED',addressComponent:{province,city,district:'东城区'}}}));
describe('city reverse geocode offline boundary',()=>{
 it('only returns administrative region and no private coordinates/address',async()=>{const fetcher=vi.fn(async(_input: RequestInfo | URL)=>result([]));const city=await createCityProvider({fetch:fetcher,getKey:()=>key})('actor',{location});expect(city.city).toBe('北京市');expect(JSON.stringify(city)).not.toMatch(/PRIVATE|39\.916527|offline-key/);const url=new URL(String(fetcher.mock.calls[0]?.[0]));expect(url.origin+url.pathname).toBe('https://restapi.amap.com/v3/geocode/regeo');expect(url.searchParams.get('extensions')).toBe('base');});
 it('uses returned city outside municipalities',async()=>expect((await createCityProvider({fetch:async()=>result('杭州市','浙江省'),getKey:()=>key})('u',{location})).city).toBe('杭州市'));
 it('fails safely before fetch without configuration',async()=>{const fetcher=vi.fn();await expect(createCityProvider({fetch:fetcher,getKey:()=>''})('u',{location})).rejects.toMatchObject({code:'NOT_CONFIGURED'});expect(fetcher).not.toHaveBeenCalled();});
 it('rejects spoofed user and arbitrary upstream URL fields',async()=>{const fetcher=vi.fn();await expect(createCityProvider({fetch:fetcher,getKey:()=>key})('u',{location,url:'https://evil.test',user_id:'v'})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(fetcher).not.toHaveBeenCalled();});
 it('does not infer prefecture from province when city unavailable',async()=>await expect(createCityProvider({fetch:async()=>result([],'浙江省'),getKey:()=>key})('u',{location})).rejects.toMatchObject({reason:'INVALID_RESPONSE'}));
 it('redacts malformed upstream and limits stream',async()=>{for(const response of [new Response(key),new Response('x'.repeat(65537)),new Response(key,{status:500})]){const err=await createCityProvider({fetch:async()=>response,getKey:()=>key})('u',{location}).catch(e=>e);expect(String(err)).not.toContain(key);expect(err).toHaveProperty('status');}});
 it('bounds timeouts and does not retry',async()=>{const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));await expect(createCityProvider({fetch:fetcher,getKey:()=>key,timeoutMs:5})('u',{location})).rejects.toMatchObject({reason:'TIMEOUT'});expect(fetcher).toHaveBeenCalledTimes(1);});
});

describe('explicit nearest address lookup',()=>{
 const response=(extra:object)=>new Response(JSON.stringify({status:'1',infocode:'10000',regeocode:{addressComponent:{province:'江苏省',city:'苏州市',district:'虎丘区'},...extra}}));
 it('sorts valid POIs by distance rather than trusting their returned order',async()=>{
  const fetcher=vi.fn(async(_input:RequestInfo|URL)=>response({pois:[{name:'远处商场',address:'长江路88号',distance:'90'},{name:'附近大厦',address:'长江路18号',distance:'8'},{name:'没有距离',address:'未知地址'},{name:'无效距离',distance:''}]}));
  const value=await createCityProvider({fetch:fetcher,getKey:()=>key})('u',{location,include_address:true});
  expect(value.nearest_address).toBe('附近大厦');
  const url=new URL(String(fetcher.mock.calls[0][0]));
  expect(url.searchParams.get('extensions')).toBe('all');expect(url.searchParams.get('radius')).toBe('1000');
  expect(value).not.toHaveProperty('pois');expect(JSON.stringify(value)).not.toContain(key);
 });
 it('falls back to an actual street address if there is no nearby POI',async()=>{
  const value=await createCityProvider({fetch:async()=>response({pois:[],formatted_address:'江苏省苏州市虎丘区长江路18号',addressComponent:{province:'江苏省',city:'苏州市',district:'虎丘区',streetNumber:{street:'长江路',number:'18号'}}}),getKey:()=>key})('u',{location,include_address:true});
  expect(value.nearest_address).toBe('江苏省苏州市虎丘区长江路18号');
 });
 it.each([{pois:[],formatted_address:'江苏省苏州市虎丘区'},{pois:[{name:'远处地点',distance:1001}]},{pois:[{name:key,distance:1}]},{pois:[{name:'无效距离',distance:-1}]}])('never replaces a missing concrete address with city/district %#',async extra=>{
  await expect(createCityProvider({fetch:async()=>response(extra),getKey:()=>key})('u',{location,include_address:true})).rejects.toMatchObject({reason:'INVALID_RESPONSE'});
 });
 it('keeps exact address information out of the ordinary city-only result',async()=>{
  const value=await createCityProvider({fetch:async()=>response({pois:[{name:'私人住址',address:'长江路18号',distance:0}]}),getKey:()=>key})('u',{location});
  expect(value).not.toHaveProperty('nearest_address');expect(JSON.stringify(value)).not.toContain('私人住址');
 });
});
