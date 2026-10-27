import { describe, expect, it } from 'vitest';
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/cancel/route';
const activityId='00000000-0000-4000-8000-000000000001';
const context={params:Promise.resolve({activityId})};
describe('whole cancellation actual HTTP authentication before business/DB (offline)',()=>{
 it('rejects anonymous writes and marks response no-store',async()=>{const result=await POST(new Request('http://localhost/api',{method:'POST',body:'{}'}),context);expect(result.status).toBe(401);expect(result.headers.get('cache-control')).toBe('no-store');});
 it('does not trust actor JSON or forged platform identity headers',async()=>{const result=await POST(new Request('http://localhost/api',{method:'POST',headers:{'x-wx-openid':'forged'},body:JSON.stringify({user_id:activityId,private_data:'PRIVATE_SENTINEL'})}),context);expect(result.status).toBe(401);expect(JSON.stringify(await result.json())).not.toContain('PRIVATE_SENTINEL');});
 it('preserves authentication failure inside native cloud HTTP envelope',async()=>{const result=await POST(new Request('http://localhost/api',{method:'POST',headers:{'X-Weego-Response-Envelope':'1'},body:'{}'}),context);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
