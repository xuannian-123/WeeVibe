import { beforeEach,describe,expect,it,vi } from 'vitest';
const fixture=vi.hoisted(()=>({token:'A' as string|undefined,me:vi.fn(),request:vi.fn(),write:vi.fn(),compress:vi.fn(),read:vi.fn()}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js',()=>({default:{env:{USER_DATA_PATH:'/cache'},compressImage:fixture.compress,getFileSystemManager:()=>({writeFileSync:fixture.write,readFileSync:fixture.read})}}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>fixture.token,api:{me:fixture.me}}));
vi.mock('../apps/miniprogram/src/platform/extension-api',()=>({extensionRequest:fixture.request}));
import {loadAvatar,uploadAvatar} from '../apps/miniprogram/src/platform/avatar';
const actor='550e8400-e29b-41d4-a716-446655440000';
const asset={base64:'AAAA',content_type:'image/jpeg',digest:'a'.repeat(64),updated_at:'2026-10-26T12:00:00Z'};
beforeEach(()=>{fixture.token='A';fixture.me.mockReset().mockResolvedValue({user_id:actor});fixture.request.mockReset().mockResolvedValue({avatar:asset});fixture.write.mockReset();fixture.compress.mockReset().mockResolvedValue({tempFilePath:'/temporary/compressed.jpg'});fixture.read.mockReset().mockReturnValue('AAAA');});
describe('avatar native API adapter offline tests',()=>{
 it('writes returned persistent data only into verified actor namespace',async()=>{const path=await loadAvatar(actor);expect(path).toContain(actor);expect(fixture.write).toHaveBeenCalledWith(path,'AAAA','base64');});
 it('rejects forged local actor id before private asset retrieval',async()=>{await expect(loadAvatar('550e8400-e29b-41d4-a716-446655440001')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(fixture.request).not.toHaveBeenCalled();expect(fixture.write).not.toHaveBeenCalled();});
 it('rejects stale profile editor token before native compression',async()=>{fixture.token='B';await expect(uploadAvatar('/tmp/preview','A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(fixture.compress).not.toHaveBeenCalled();expect(fixture.request).not.toHaveBeenCalled();});
 it('does not upload to another actor after compression awaits',async()=>{fixture.compress.mockImplementation(async()=>{fixture.token='B';return {tempFilePath:'/tmp/p'};});await expect(uploadAvatar('/tmp/preview','A')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(fixture.request).not.toHaveBeenCalled();});
 it('does not cache a failed upload as persisted image',async()=>{fixture.request.mockRejectedValue(new Error('network'));await expect(uploadAvatar('/tmp/p','A')).rejects.toThrow();expect(fixture.write).not.toHaveBeenCalled();});
 it('uploads bounded image content, never its temporary file path',async()=>{await uploadAvatar('/tmp/private-photo','A');expect(fixture.request).toHaveBeenCalledWith('/api/v1/account/avatar','POST',{base64:'AAAA'});expect(JSON.stringify(fixture.request.mock.calls)).not.toContain('private-photo');});
});
