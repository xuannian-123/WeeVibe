import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitParticipation } from '../apps/miniprogram/src/features/participation/api';
const h=vi.hoisted(()=>({token:'session-A',me:vi.fn(),transport:vi.fn()}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,api:{me:()=>h.me()},transport:(input:unknown)=>h.transport(input)}));
const actorA='00000000-0000-4000-8000-000000000001',actorB='00000000-0000-4000-8000-000000000002',activityId='00000000-0000-4000-8000-000000000003',segmentId='00000000-0000-4000-8000-000000000004';
const input={action:'exit' as const,segment_ids:[segmentId],expected_revision:1,idempotency_key:'persisted-write-A'};
beforeEach(()=>{h.token='session-A';h.me.mockReset();h.transport.mockReset();h.me.mockResolvedValue({user_id:actorA});h.transport.mockRejectedValue(new Error('controlled transport fixture'));});
describe('client participation actor binding',()=>{
 it('pending A plus current session B never sends the mutation',async()=>{h.token='session-B';h.me.mockResolvedValue({user_id:actorB});await expect(submitParticipation(activityId,input,actorA)).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport).not.toHaveBeenCalled();});
 it('token rotation while verifying actor never sends a mutation',async()=>{h.me.mockImplementation(async()=>{h.token='session-B';return{user_id:actorA};});await expect(submitParticipation(activityId,input,actorA)).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport).not.toHaveBeenCalled();});
 it('missing login never sends a mutation',async()=>{h.token='';await expect(submitParticipation(activityId,input,actorA)).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.me).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();});
 it.each(['hide','unmount','snapshot'])('blocks final mutation if the %s lifecycle guard changes during identity verification',async()=>{let valid=true;const guard=()=>{if(!valid)throw new Error('inactive page');};h.me.mockImplementation(async()=>{valid=false;return{user_id:actorA};});await expect(submitParticipation(activityId,input,actorA,guard)).rejects.toThrow('inactive page');expect(h.transport).not.toHaveBeenCalled();});
 it('checks lifecycle before even starting identity verification',async()=>{await expect(submitParticipation(activityId,input,actorA,()=>{throw new Error('inactive page');})).rejects.toThrow('inactive page');expect(h.me).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();});
 it('matching verified actor sends only the bound bearer and strict input',async()=>{await expect(submitParticipation(activityId,input,actorA)).rejects.toThrow('controlled transport');expect(h.transport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({method:'POST',path:`/api/v1/activities/${activityId}/participation`,headers:expect.objectContaining({Authorization:'Bearer session-A'}),body:input}));});
});
