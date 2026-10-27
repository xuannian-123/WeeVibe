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
