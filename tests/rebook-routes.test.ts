import { describe,expect,it } from 'vitest';
import { GET } from '../apps/web/src/app/api/v1/activities/[activityId]/rebook/route';
const activityId='00000000-0000-4000-8000-000000000001';
const context={params:Promise.resolve({activityId})};
describe('rebook actual HTTP auth boundary, no configured database',()=>{
 it('authenticates before source reads and has no public permission via invitation/actor query',async()=>{const r=await GET(new Request('http://localhost/api?actor_id=forged&invitation=forged',{headers:{'x-wx-openid':'forged'}}),context);expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('no-store');});
 it('preserves native cloud HTTP error envelope without false success',async()=>{const r=await GET(new Request('http://localhost/api',{headers:{'X-Weego-Response-Envelope':'1'}}),context);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
