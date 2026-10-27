import { beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({auth:vi.fn(),change:vi.fn()}));vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.auth}}));vi.mock('../apps/web/src/server/activities/main-segment',()=>({changeMainSegment:h.change}));
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/main-segment/route';
import { ServiceError } from '../apps/web/src/server/http';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',from='cccccccc-cccc-4ccc-8ccc-cccccccccccc',to='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const context={params:Promise.resolve({activityId:id})},input={idempotency_key:'route-main-key',expected_revision:1,expected_main_segment_id:from,target_segment_id:to};
const request=(body:any,envelope=false)=>new Request('http://localhost/api',{method:'POST',headers:{Authorization:'Bearer fixture-session',...(envelope?{'X-Weego-Response-Envelope':'1'}:{})},body:JSON.stringify(body)});
beforeEach(()=>{h.auth.mockReset().mockResolvedValue({user_id:actor});h.change.mockReset().mockResolvedValue({});});
describe('main-segment route authenticated dispatch with service double',()=>{
 it('canonicalizes all UUIDs and uses only server authenticated actor',async()=>{const r=await POST(request({...input,expected_main_segment_id:from.toUpperCase(),target_segment_id:to.toUpperCase()}),{params:Promise.resolve({activityId:id.toUpperCase()})});expect(r.status).toBe(200);expect(h.change).toHaveBeenCalledExactlyOnceWith(id,actor,input);});
 it.each([{actor_id:actor},{confirmed:true},{booked:true},{segments:[]},{main_revision:88}])('rejects unknown state/actor inputs %j',async extra=>{expect((await POST(request({...input,...extra}),context)).status).toBe(400);expect(h.change).not.toHaveBeenCalled();});
 it('same-id and missing expected main are invalid before service dispatch',async()=>{expect((await POST(request({...input,target_segment_id:from}),context)).status).toBe(400);const{expected_main_segment_id,...missing}=input;expect((await POST(request(missing),context)).status).toBe(400);expect(h.change).not.toHaveBeenCalled();});
 it('keeps explicit scope409 inside cloud envelope and hides raw exceptions',async()=>{h.change.mockRejectedValueOnce(new ServiceError('MAIN_SEGMENT_SCOPE_UNAVAILABLE',409,'本片范围尚未启用'));let r=await POST(request(input,true),context);expect(await r.json()).toMatchObject({status:409,body:{error:{code:'MAIN_SEGMENT_SCOPE_UNAVAILABLE'}}});h.change.mockRejectedValueOnce(Error('PRIVATE_RAW_SENTINEL'));r=await POST(request(input),context);expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_RAW_SENTINEL');});
});
