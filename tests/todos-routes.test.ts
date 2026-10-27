import { describe,expect,it } from 'vitest';
import { GET } from '../apps/web/src/app/api/v1/todos/route';
describe('todos actual auth/cloud boundary without database',()=>{
 it('requires session and does not grant actor identity from query or platform headers',async()=>{const r=await GET(new Request('http://localhost/api/v1/todos?userId=forged',{headers:{'x-wx-openid':'forged'}}));expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('no-store');});
 it('uses native cloud error envelope without treating401 as business success',async()=>{const r=await GET(new Request('http://localhost/api/v1/todos',{headers:{'X-Weego-Response-Envelope':'1'}}));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({transport:'weego.http.v1',status:401,body:{error:{code:'UNAUTHENTICATED'}}});});
});
