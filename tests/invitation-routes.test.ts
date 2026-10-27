import { describe, expect, it } from 'vitest';
import { POST as create } from '../apps/web/src/app/api/v1/activities/[activityId]/invitations/route';
import { POST as save, GET as read } from '../apps/web/src/app/api/v1/invitations/[invitationId]/route';
const id='00000000-0000-4000-8000-000000000001';
const request=()=>new Request('http://localhost/api/v1/invitations/'+id,{method:'POST',headers:{'x-wx-openid':'forged'},body:'{}'});
describe('actual invitation HTTP route offline auth boundaries',()=>{
 it('anonymous cannot mint sources',async()=>expect((await create(request(),{params:Promise.resolve({activityId:id})})).status).toBe(401));
 it('anonymous cannot save to an arbitrary user',async()=>expect((await save(request(),{params:Promise.resolve({invitationId:id})})).status).toBe(401));
 it('invalid public source ID fails before DB',async()=>expect((await read(new Request('http://localhost/'),{params:Promise.resolve({invitationId:'../private'})})).status).toBe(400));
});
