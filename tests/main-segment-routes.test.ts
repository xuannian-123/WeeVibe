import { describe,expect,it } from 'vitest';
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/main-segment/route';
const context={params:Promise.resolve({activityId:'00000000-0000-4000-8000-000000000001'})};
describe('main-segment actual HTTP auth boundary without database',()=>{
 it('rejects anonymous/forged platform identity and marks response no-store',async()=>{const r=await POST(new Request('http://localhost/api',{method:'POST',headers:{'x-wx-openid':'forged'},body:JSON.stringify({actor_id:'forged'})}),context);expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('no-store');});
 it('preserves native cloud HTTP401 error envelope instead of false business success',async()=>{const r=await POST(new Request('http://localhost/api',{method:'POST',headers:{'X-Weego-Response-Envelope':'1'},body:'{}'}),context);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
