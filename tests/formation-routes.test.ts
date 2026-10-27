import { describe, expect, it } from 'vitest';
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/formation/route';
const id='00000000-0000-4000-8000-000000000001';
const context={params:Promise.resolve({activityId:id})};
describe('formation actual HTTP route authentication before business/DB (offline)',()=>{
 it('rejects anonymous manager writes and marks response no-store',async()=>{const result=await POST(new Request(`http://localhost/api/v1/activities/${id}/formation`,{method:'POST',body:'{}'}),context);expect(result.status).toBe(401);expect(result.headers.get('cache-control')).toBe('no-store');});
 it('does not trust actor JSON or forged platform identity headers',async()=>{const result=await POST(new Request(`http://localhost/api/v1/activities/${id}/formation`,{method:'POST',headers:{'x-wx-openid':'forged'},body:JSON.stringify({action:'confirm-formation',manager_id:id,verified:true,private_data:'PRIVATE_SENTINEL'})}),context);expect(result.status).toBe(401);expect(JSON.stringify(await result.json())).not.toContain('PRIVATE_SENTINEL');});
 it('preserves authentication failure inside the native cloud HTTP envelope',async()=>{const result=await POST(new Request(`http://localhost/api/v1/activities/${id}/formation`,{method:'POST',headers:{'X-Weego-Response-Envelope':'1'},body:'{}'}),context);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
