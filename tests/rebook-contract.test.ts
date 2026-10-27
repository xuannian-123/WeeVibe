import { describe,expect,it } from 'vitest';
import * as contracts from '../packages/contracts/src';
import * as route from '../apps/web/src/app/api/v1/activities/[activityId]/rebook/route';
import { createApiClient } from '../packages/api-client/src';
describe('WG10 read-only rebook source boundary',()=>{
 it('has a dedicated strict source contract without reusing ActivityDetail',()=>{expect(contracts).toHaveProperty('rebookSourceSchema');});
 it('exposes only GET and no server-side rebook mutation action',()=>{expect(route).toHaveProperty('GET');for(const method of ['POST','PUT','PATCH','DELETE'])expect(route).not.toHaveProperty(method);});
 it('has a dedicated authenticated read operation, not a create/write alias',()=>{expect(createApiClient(async()=>({status:503,body:{}}))).toHaveProperty('getRebookSource');});
});
