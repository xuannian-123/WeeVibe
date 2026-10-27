import { describe, expect, it } from 'vitest';
import { GET, POST } from '../apps/web/src/app/api/v1/requirements/route';
import { GET as detail, POST as command } from '../apps/web/src/app/api/v1/requirements/[collectionId]/route';
const id='11111111-1111-4111-8111-111111111111';
const context={params:Promise.resolve({collectionId:id})};
describe('requirements actual route auth guards (no HTTP server or database)',()=>{
 it('keeps own collection lists private even with forged WeChat headers',async()=>{
  const r=await GET(new Request('http://localhost/api/v1/requirements',{headers:{'x-wx-openid':'forged'}}));
  expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('does not let public activity locator bypass requirements authentication',async()=>{
  const r=await GET(new Request(`http://localhost/api/v1/requirements?activity_id=${id}`));expect(r.status).toBe(401);
 });
 it('does not create from a self-reported user or manager identity',async()=>{
  const r=await POST(new Request('http://localhost/api/v1/requirements',{method:'POST',body:JSON.stringify({action:'create',owner_user_id:id,user_id:id})}));expect(r.status).toBe(401);
 });
 it('does not let knowing collection IDs read private draft/answers',async()=>{
  const r=await detail(new Request(`http://localhost/api/v1/requirements/${id}`),context);expect(r.status).toBe(401);
 });
 it('guards all POST actions before parsing attacker private data and preserves cloud envelope',async()=>{
  const r=await command(new Request(`http://localhost/api/v1/requirements/${id}`,{method:'POST',headers:{'X-Weego-Response-Envelope':'1'},body:JSON.stringify({action:'respond',user_id:id,private_origin:'DO_NOT_ECHO'})}),context);
  const body=await r.json();expect(body).toMatchObject({status:401,body:{error:{code:'UNAUTHENTICATED'}}});expect(JSON.stringify(body)).not.toContain('DO_NOT_ECHO');
 });
});
