import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({authenticate:vi.fn(),withdraw:vi.fn()}));
vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.authenticate}}));
vi.mock('../apps/web/src/server/activities/withdrawal',()=>({withdrawApplication:h.withdraw}));
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/applications/[applicationId]/withdraw/route';
import { ServiceError } from '../apps/web/src/server/http';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',application='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const command={idempotency_key:'withdraw-route-key',expected_revision:2};
beforeEach(()=>{h.authenticate.mockReset().mockResolvedValue({user_id:actor});h.withdraw.mockReset().mockResolvedValue({activity_id:activity});});
const request=(body:unknown,envelope=false)=>new Request('http://localhost/api',{method:'POST',headers:{Authorization:'Bearer offline-test-session',...(envelope?{'X-Weego-Response-Envelope':'1'}:{})},body:JSON.stringify(body)});
const context={params:Promise.resolve({activityId:activity,applicationId:application})};
describe('withdrawal route dispatch with authenticated identity/service doubles',()=>{
 it('passes only authenticated actor and validated canonical target IDs/input',async()=>{const response=await POST(request(command),{params:Promise.resolve({activityId:activity.toUpperCase(),applicationId:application.toUpperCase()})});expect(response.status).toBe(200);expect(h.authenticate).toHaveBeenCalledExactlyOnceWith('Bearer offline-test-session');expect(h.withdraw).toHaveBeenCalledExactlyOnceWith(activity,application,actor,command);});
 it('rejects forged actor/partial targets/decision fields without service dispatch',async()=>{for(const extra of [{actor_id:actor},{segments:[]},{decision:'approve'}])expect((await POST(request({...command,...extra}),context)).status).toBe(400);expect(h.withdraw).not.toHaveBeenCalled();});
 it('rejects either malformed target UUID before mutation',async()=>{for(const target of [{activityId:'../another',applicationId:application},{activityId:activity,applicationId:'bad'}])expect((await POST(request(command),{params:Promise.resolve(target)})).status).toBe(400);expect(h.withdraw).not.toHaveBeenCalled();});
 it('preserves later-phase feature-not-enabled semantics in cloud envelope',async()=>{h.withdraw.mockRejectedValueOnce(new ServiceError('WITHDRAWAL_RULE_UNCONFIRMED',409,'此阶段的新撤回尚未启用，规则待确认'));const response=await POST(request(command,true),context);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({transport:'weego.http.v1',status:409,body:{error:{code:'WITHDRAWAL_RULE_UNCONFIRMED',message:'此阶段的新撤回尚未启用，规则待确认'}}});});
 it('never leaks raw service errors or private fields',async()=>{h.withdraw.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'));const response=await POST(request(command),context);expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_SENTINEL');});
});
