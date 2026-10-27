import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({authenticate:vi.fn(),get:vi.fn(),accept:vi.fn()}));
vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.authenticate}}));
vi.mock('../apps/web/src/server/activities/arrangement',()=>({getArrangementReview:h.get,reacceptArrangement:h.accept}));
import { GET, POST } from '../apps/web/src/app/api/v1/activities/[activityId]/arrangements/[segmentId]/route';
import { ServiceError } from '../apps/web/src/server/http';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',segment='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const context={params:Promise.resolve({activityId:activity.toUpperCase(),segmentId:segment.toUpperCase()})};
const input={action:'reaccept',idempotency_key:'reaccept-route-key',expected_revision:3,expected_plan_revision:3,from_accepted_plan_revision:1,history_digest:'a'.repeat(64)};
const request=(body?:unknown,envelope=false)=>new Request(`http://localhost/api/v1/activities/${activity}/arrangements/${segment}`,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer offline-route-test',...(envelope?{'X-Weego-Response-Envelope':'1'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{h.authenticate.mockReset().mockResolvedValue({user_id:actor});h.get.mockReset().mockResolvedValue({state:'unavailable'});h.accept.mockReset().mockResolvedValue({activity_id:activity});});
describe('arrangement routes with authenticated identity/service doubles',()=>{
 it('GET uses authenticated actor and canonical activity/segment, no manager impersonation',async()=>{expect((await GET(request(),context)).status).toBe(200);expect(h.get).toHaveBeenCalledExactlyOnceWith(activity,segment,actor);expect(h.authenticate).toHaveBeenCalledExactlyOnceWith('Bearer offline-route-test');});
 it('POST passes strict reaccept body, authenticated actor and both canonical route identifiers',async()=>{expect((await POST(request(input),context)).status).toBe(200);expect(h.accept).toHaveBeenCalledExactlyOnceWith(activity,segment,actor,input);});
 it.each([{...input,actor_id:segment},{...input,events:[]},{action:'change-minimum',minimum_participants:5}])('rejects authority/history/writer injection without dispatch',async body=>{expect((await POST(request(body),context)).status).toBe(400);expect(h.accept).not.toHaveBeenCalled();});
 it('invalid target fails before business dispatch',async()=>{expect((await GET(request(),{params:Promise.resolve({activityId:activity,segmentId:'not-a-uuid'})})).status).toBe(400);expect(h.get).not.toHaveBeenCalled();});
 it('history unavailable preserves accurate recoverable 409 in native cloud envelope',async()=>{h.accept.mockRejectedValueOnce(new ServiceError('ARRANGEMENT_HISTORY_UNAVAILABLE',409,'完整历史不可核对'));const response=await POST(request(input,true),context);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({transport:'weego.http.v1',status:409,body:{error:{code:'ARRANGEMENT_HISTORY_UNAVAILABLE'}}});});
 it('generic service failure does not echo events or private data',async()=>{h.get.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'));const response=await GET(request(),context);expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_SENTINEL');});
});
