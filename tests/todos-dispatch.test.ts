import { beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({auth:vi.fn(),todos:vi.fn()}));
vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.auth}}));
vi.mock('../apps/web/src/server/todos',()=>({getTodos:h.todos}));
import { GET } from '../apps/web/src/app/api/v1/todos/route';
import { ServiceError } from '../apps/web/src/server/http';
const actor='00000000-0000-4000-8000-000000009001';
const request=(query='',envelope=false)=>new Request('http://localhost/api/v1/todos'+query,{headers:{Authorization:'Bearer fixture-session',...(envelope?{'X-Weego-Response-Envelope':'1'}:{})}});
beforeEach(()=>{h.auth.mockReset().mockResolvedValue({user_id:actor});h.todos.mockReset().mockResolvedValue({});});
describe('todos actual authenticated route dispatch/service-double only',()=>{
 it('takes actor only from authenticated session and optional opaque cursor',async()=>{expect((await GET(request())).status).toBe(200);expect(h.todos).toHaveBeenCalledExactlyOnceWith(actor,undefined);expect((await GET(request('?cursor=YWJj'))).status).toBe(200);expect(h.todos).toHaveBeenLastCalledWith(actor,'YWJj');});
 it.each(['?userId=forged','?actor_id=forged','?cursor=one&cursor=two','?cursor=','?cursor=not%2Fbase64','?cursor='+('x'.repeat(1025))])('rejects unknown/unsafe/duplicate query before service %s',async query=>{expect((await GET(request(query))).status).toBe(400);expect(h.todos).not.toHaveBeenCalled();});
 it('preserves explicit refresh409 and missing-schema503 in native envelope',async()=>{for(const [code,status]of [['TODOS_SNAPSHOT_CHANGED',409],['NOT_CONFIGURED',503]] as const){h.todos.mockRejectedValueOnce(new ServiceError(code,status,'准确的可恢复提示'));const r=await GET(request('',true));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({transport:'weego.http.v1',status,body:{error:{code}}});}});
 it('never leaks raw database payload or secret fields',async()=>{h.todos.mockRejectedValueOnce(Error('PRIVATE_RAW_SQL'));const r=await GET(request());expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_RAW_SQL');});
});
