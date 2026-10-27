import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInvitationSource, saveInvitationSource } from '../apps/miniprogram/src/features/invitations/api';
const h=vi.hoisted(()=>({token:'session-A',me:vi.fn(),transport:vi.fn()}));vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,api:{me:()=>h.me()},transport:(input:unknown)=>h.transport(input)}));
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeEach(()=>{h.token='session-B';h.me.mockReset();h.transport.mockReset();h.me.mockResolvedValue({user_id:b});});
describe('invitation actor binding',()=>{
 it('does not mint A source with a newer B session',async()=>{await expect(createInvitationSource(id,a,'session-A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport).not.toHaveBeenCalled();});
 it('does not save A displayed invitation into B account',async()=>{await expect(saveInvitationSource(id,id,a,'session-A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport).not.toHaveBeenCalled();});
});

import { readInvitationSource } from '../apps/miniprogram/src/features/invitations/api';
const sourceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function source(){return {invitation_id:sourceId,activity_id:id,title:'valid source',inviter_display_name:null,inviter_avatar_url:null,starts_at:null,ends_at:null,timezone:'UTC',cancelled:false,source_only:true};}
describe('invitation transport preflight and stable target contract',()=>{
 beforeEach(()=>{h.token='session-A';h.me.mockResolvedValue({user_id:a});h.transport.mockResolvedValue({status:200,body:source()});});
 it('verifies displayed actor even when the current session string has not changed',async()=>{h.me.mockResolvedValue({user_id:b});await expect(createInvitationSource(id,a,'session-A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport).not.toHaveBeenCalled();});
 it('blocks token rotation while me waits',async()=>{h.me.mockImplementation(async()=>{h.token='session-B';return{user_id:a};});await expect(createInvitationSource(id,a,'session-A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport).not.toHaveBeenCalled();});
 it('runs the lifecycle guard after me and before the final POST',async()=>{let active=true;h.me.mockImplementation(async()=>{active=false;return{user_id:a};});await expect(createInvitationSource(id,a,'session-A',()=>{if(!active)throw new Error('inactive');})).rejects.toThrow('inactive');expect(h.transport).not.toHaveBeenCalled();});
 it('never acknowledges an old-session response',async()=>{h.transport.mockImplementation(async()=>{h.token='session-B';return{status:200,body:source()};});await expect(createInvitationSource(id,a,'session-A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(h.transport.mock.calls[0][0].headers.Authorization).toBe('Bearer session-A');});
 it('accepts a valid created source for the original activity and uses strict create body',async()=>{await expect(createInvitationSource(id.toUpperCase(),a,'session-A')).resolves.toMatchObject({activity_id:id});expect(h.transport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({path:`/api/v1/activities/${id}/invitations`,body:{action:'create'},headers:expect.objectContaining({Authorization:'Bearer session-A'})}));});
 it('rejects a created source for a different activity',async()=>{h.transport.mockResolvedValue({status:200,body:{...source(),activity_id:b}});await expect(createInvitationSource(id,a,'session-A')).rejects.toMatchObject({code:'INVALID_RESPONSE',status:200});});
 it('rejects malformed successful bodies without putting raw private content into the error',async()=>{h.transport.mockResolvedValue({status:200,body:{private:'PRIVATE_SENTINEL'}});await expect(createInvitationSource(id,a,'session-A')).rejects.not.toThrow('PRIVATE_SENTINEL');});
 it('rejects wrong source IDs on public GET without changing which source is requested',async()=>{h.transport.mockResolvedValue({status:200,body:{...source(),invitation_id:b}});await expect(readInvitationSource(sourceId)).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(h.transport.mock.calls[0][0].path).toBe(`/api/v1/invitations/${sourceId}`);});
 it('normalizes UUID case on valid public source results',async()=>{await expect(readInvitationSource(sourceId.toUpperCase())).resolves.toMatchObject({invitation_id:sourceId});expect(h.me).not.toHaveBeenCalled();});
 it.each(['activity','invitation'])('rejects a saved response for a different %s',async kind=>{h.transport.mockResolvedValue({status:200,body:{invitation:{...source(),...(kind==='activity'?{activity_id:b}:{invitation_id:b})},saved:true,saved_at:'2030-01-01T00:00:00Z'}});await expect(saveInvitationSource(sourceId,id,a,'session-A')).rejects.toMatchObject({code:'INVALID_RESPONSE'});});
});
