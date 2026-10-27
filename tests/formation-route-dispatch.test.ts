import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({authenticate:vi.fn(),change:vi.fn()}));
vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.authenticate}}));
vi.mock('../apps/web/src/server/activities/formation',()=>({changeFormation:h.change}));
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/formation/route';
import { ServiceError } from '../apps/web/src/server/http';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',segment='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const command={action:'set-verification',idempotency_key:'formation-route-key',expected_revision:2,segment_id:segment,expected_plan_revision:3,verified:true};
beforeEach(()=>{h.authenticate.mockReset().mockResolvedValue({user_id:actor});h.change.mockReset().mockResolvedValue({activity_id:activity});});
const request=(body:unknown,envelope=false)=>new Request(`http://localhost/api/v1/activities/${activity}/formation`,{method:'POST',headers:{Authorization:'Bearer offline-test-session',...(envelope?{'X-Weego-Response-Envelope':'1'}:{})},body:JSON.stringify(body)});
describe('formation route dispatch with authenticated identity/service doubles',()=>{
 it('passes only the authenticated actor, canonical route id and validated command',async()=>{const response=await POST(request(command),{params:Promise.resolve({activityId:activity.toUpperCase()})});expect(response.status).toBe(200);expect(h.authenticate).toHaveBeenCalledExactlyOnceWith('Bearer offline-test-session');expect(h.change).toHaveBeenCalledExactlyOnceWith(activity,actor,command);});
 it('rejects a forged actor or counts after authentication without dispatching the service',async()=>{const response=await POST(request({...command,actor_id:segment,counts:{accepted:10}}),{params:Promise.resolve({activityId:activity})});expect(response.status).toBe(400);expect(h.change).not.toHaveBeenCalled();});
 it('rejects a malformed route id before business mutation',async()=>{const response=await POST(request(command),{params:Promise.resolve({activityId:'../another'})});expect(response.status).toBe(400);expect(h.change).not.toHaveBeenCalled();});
 it('preserves explicit not-enabled-after-start semantics in the cloud HTTP envelope',async()=>{h.change.mockRejectedValueOnce(new ServiceError('FORMATION_RULE_UNCONFIRMED',409,'开始后规则待确认，暂未启用'));const response=await POST(request({...command,action:'confirm-formation',verified:undefined},true),{params:Promise.resolve({activityId:activity})});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({transport:'weego.http.v1',status:409,body:{error:{code:'FORMATION_RULE_UNCONFIRMED',message:'开始后规则待确认，暂未启用'}}});});
});
