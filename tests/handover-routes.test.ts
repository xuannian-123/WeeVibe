import { describe,expect,it } from 'vitest';
import { GET,POST } from '../apps/web/src/app/api/v1/activities/[activityId]/handovers/route';
import { GET as detailGET,POST as detailPOST } from '../apps/web/src/app/api/v1/activities/[activityId]/handovers/[handoverId]/route';
import { handoverIds as I,handoverId } from './handover-fixture';
const context={params:Promise.resolve({activityId:I.activity,handoverId:handoverId(100)})};
describe('WG06 actual HTTP auth boundary without database/configuration',()=>{
 it.each([['list',GET],['read',detailGET],['create',POST],['command',detailPOST]] as const)('%s authenticates first and never treats actor JSON/platform headers as identity',async(name,route)=>{const request=new Request('http://localhost/api',{method:name==='create'||name==='command'?'POST':'GET',headers:{'x-wx-openid':'forged'},...(name==='create'||name==='command'?{body:JSON.stringify({actor_user_id:I.a,private:'PRIVATE_SENTINEL'})}:{})});const response=await route(request,context);expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_SENTINEL');});
 it('preserves native cloud HTTP envelope authentication status',async()=>{const r=await POST(new Request('http://localhost/api',{method:'POST',headers:{'X-Weego-Response-Envelope':'1'},body:'{}'}),context);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
