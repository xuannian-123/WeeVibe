import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';
import { readActivityForSession } from '../apps/miniprogram/src/features/activity-detail/session-read';
const h=vi.hoisted(()=>({token:'A',get:vi.fn(),remember:vi.fn()}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,api:{getActivity:(id:string)=>h.get(id)}}));
vi.mock('../apps/miniprogram/src/platform/activities',()=>({rememberActivity:(...args:unknown[])=>h.remember(...args)}));
beforeEach(()=>{h.token='A';h.get.mockReset();h.remember.mockReset();});
describe('activity read session isolation',()=>{
 it('tags current reads and caches only current account references',async()=>{const detail={viewer:{user_id:'userA'}};h.get.mockResolvedValue(detail);expect(await readActivityForSession('id')).toEqual({detail,session:'A'});expect(h.remember).toHaveBeenCalledExactlyOnceWith('userA',detail);});
 it('late A response while B is current is discarded, not cached',async()=>{h.get.mockImplementation(async()=>{h.token='B';return{viewer:{user_id:'userA'}};});await expect(readActivityForSession('id')).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(h.remember).not.toHaveBeenCalled();expect(h.token).toBe('B');});
 it('late 401 from A does not signal clearing the newer B session',async()=>{h.get.mockImplementation(async()=>{h.token='B';throw new ApiClientError('UNAUTHENTICATED','expired A',401);});await expect(readActivityForSession('id')).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(h.token).toBe('B');expect(h.remember).not.toHaveBeenCalled();});
 it('a current session 401 retains normal authentication handling',async()=>{h.get.mockRejectedValue(new ApiClientError('UNAUTHENTICATED','expired',401));await expect(readActivityForSession('id')).rejects.toMatchObject({code:'UNAUTHENTICATED'});});
});
