import { beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({auth:vi.fn(),source:vi.fn()}));
vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.auth}}));
vi.mock('../apps/web/src/server/activities/rebook',()=>({getRebookSource:h.source}));
import { GET } from '../apps/web/src/app/api/v1/activities/[activityId]/rebook/route';
import { ServiceError } from '../apps/web/src/server/http';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request=(envelope=false)=>new Request('http://localhost/api?actor_id=untrusted',{headers:{Authorization:'Bearer fixture-session',...(envelope?{'X-Weego-Response-Envelope':'1'}:{})}});
beforeEach(()=>{h.auth.mockReset().mockResolvedValue({user_id:actor});h.source.mockReset().mockResolvedValue({source_activity_id:id});});
describe('rebook route authenticated dispatch with service double',()=>{
 it('uses canonical target UUID and only trusted authenticated actor',async()=>{expect((await GET(request(),{params:Promise.resolve({activityId:id.toUpperCase()})})).status).toBe(200);expect(h.source).toHaveBeenCalledExactlyOnceWith(id,actor);});
 it('rejects malformed target before service read',async()=>{expect((await GET(request(),{params:Promise.resolve({activityId:'../../other'})})).status).toBe(400);expect(h.source).not.toHaveBeenCalled();});
 it('returns explicit source-scope 409 in native cloud dispatch',async()=>{h.source.mockRejectedValueOnce(new ServiceError('REBOOK_SCOPE_UNAVAILABLE',409,'其它来源范围暂未启用'));const r=await GET(request(true),{params:Promise.resolve({activityId:id})});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({transport:'weego.http.v1',status:409,body:{error:{code:'REBOOK_SCOPE_UNAVAILABLE'}}});});
 it('never discloses raw backend errors in response',async()=>{h.source.mockRejectedValueOnce(Error('PRIVATE_RAW_SENTINEL'));const r=await GET(request(),{params:Promise.resolve({activityId:id})});expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_RAW_SENTINEL');});
});
