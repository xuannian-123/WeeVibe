import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({token:'session-a' as string|undefined,transport:vi.fn()}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>state.token,transport:state.transport}));
import {extensionRequest} from '../apps/miniprogram/src/platform/extension-api';
import {uncertain} from '../apps/miniprogram/src/platform/write-policy';
beforeEach(()=>{state.token='session-a';state.transport.mockReset().mockResolvedValue({status:200,body:{ok:true}});});
describe('extension transport actor and route boundaries',()=>{
 it.each(['/api/v1/account','/api/v1/account/avatar','/api/v1/venues/city','/api/v1/requirements','/api/v1/requirements/550e8400-e29b-41d4-a716-446655440000','/api/v1/requirements?activity_id=550e8400-e29b-41d4-a716-446655440000'])('permits known route %s',async path=>{await expect(extensionRequest(path)).resolves.toEqual({ok:true});});
 it.each(['https://evil.test/api/v1/account','/api/v1/account/../auth','/api/v1/requirements?user_id=victim','/api/v1/account#evil'])('rejects arbitrary route %s',async path=>{await expect(extensionRequest(path)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(state.transport).not.toHaveBeenCalled();});
 it('rejects unauthenticated reads before transport',async()=>{state.token=undefined;await expect(extensionRequest('/api/v1/account')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(state.transport).not.toHaveBeenCalled();});
 it('uses bearer identity only and cloud compatible POST for PATCH',async()=>{await extensionRequest('/api/v1/account','PATCH',{action:'profile'});expect(state.transport).toHaveBeenCalledWith(expect.objectContaining({method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer session-a'}}));});
 it('drops a private response after account switches',async()=>{state.transport.mockImplementation(async()=>{state.token='session-b';return {status:200,body:{private:'A'}};});await expect(extensionRequest('/api/v1/account')).rejects.toMatchObject({code:'UNAUTHENTICATED'});});
 it.each([404,405])('gives actionable but uncertain interface/version guidance for unrecognized HTTP %s',async status=>{
  state.transport.mockResolvedValueOnce({status,body:'<html>PRIVATE_RESPONSE_SENTINEL</html>'});
  try{await extensionRequest('/api/v1/requirements','POST',{action:'create'});throw new Error('expected failure');}catch(error){
   expect(error).toMatchObject({code:'INVALID_RESPONSE',status,message:expect.stringContaining(`HTTP ${status}`)});expect((error as Error).message).toContain('前后端版本');expect((error as Error).message).not.toContain('PRIVATE_RESPONSE_SENTINEL');expect(uncertain(error)).toBe(true);
  }
 });
 it('preserves structured resource-not-found instead of calling every 404 an undeployed API',async()=>{
  state.transport.mockResolvedValueOnce({status:404,body:{error:{code:'NOT_FOUND',message:'未找到本人可查看的需求'},request_id:'fixture'}});
  await expect(extensionRequest('/api/v1/requirements/550e8400-e29b-41d4-a716-446655440000')).rejects.toMatchObject({code:'NOT_FOUND',status:404,message:'未找到本人可查看的需求'});
 });
 it('preserves explicit missing-configuration response and never turns it into login success',async()=>{
  state.transport.mockResolvedValueOnce({status:503,body:{error:{code:'NOT_CONFIGURED',message:'测试后端未配置'},request_id:'fixture'}});
  await expect(extensionRequest('/api/v1/account')).rejects.toMatchObject({code:'NOT_CONFIGURED',status:503,message:'测试后端未配置'});
 });
});
