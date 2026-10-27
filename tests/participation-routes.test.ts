import { describe, expect, it } from 'vitest';
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/participation/route';
const id = '00000000-0000-4000-8000-000000000001';
describe('participation HTTP route identity boundary (offline)', () => {
 it('rejects anonymous writes before database access', async () => { const result = await POST(new Request('http://localhost/api/v1/activities/'+id+'/participation', {method:'POST',body:'{}'}),{params:Promise.resolve({activityId:id})}); expect(result.status).toBe(401);expect(result.headers.get('cache-control')).toBe('no-store'); });
 it('does not trust actor JSON or forged WeChat headers', async () => { const result = await POST(new Request('http://localhost/api/v1/activities/'+id+'/participation', {method:'POST',headers:{'x-wx-openid':'fake'},body:JSON.stringify({user_id:id,action:'exit'})}),{params:Promise.resolve({activityId:id})});expect(result.status).toBe(401); });
 it('keeps auth with cloud HTTP response envelope', async () => { const result = await POST(new Request('http://localhost/api/v1/activities/'+id+'/participation', {method:'POST',headers:{'X-Weego-Response-Envelope':'1'},body:'{}'}),{params:Promise.resolve({activityId:id})});expect(result.status).toBe(200); expect(await result.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}}); });
});
