import { describe, expect, it } from 'vitest';
import { GET, POST } from '../apps/web/src/app/api/v1/activities/[activityId]/arrangements/[segmentId]/route';
import { arrangementIds as ids } from './arrangement-fixtures';
const context={params:Promise.resolve({activityId:ids.activity,segmentId:ids.segment})};
const url=`http://localhost/api/v1/activities/${ids.activity}/arrangements/${ids.segment}`;
describe('arrangement actual route authentication before business/DB',()=>{
 it('anonymous cannot retrieve private accepted-version history',async()=>{const result=await GET(new Request(url),context);expect(result.status).toBe(401);expect(result.headers.get('cache-control')).toBe('no-store');expect(await result.json()).toMatchObject({error:{code:'UNAUTHENTICATED'}});});
 it('anonymous cannot reaccept even with forged user/manager metadata',async()=>{const result=await POST(new Request(url,{method:'POST',headers:{'x-wx-openid':'forged'},body:JSON.stringify({actor_id:ids.actor,private_origin:'PRIVATE_SENTINEL'})}),context);expect(result.status).toBe(401);expect(JSON.stringify(await result.json())).not.toContain('PRIVATE_SENTINEL');});
 it.each(['GET','POST'])('native cloud envelope preserves unauthorized %s',async method=>{const request=new Request(url,{method,headers:{'X-Weego-Response-Envelope':'1'},...(method==='POST'?{body:'{}'}:{})});const result=await(method==='GET'?GET:POST)(request,context);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
