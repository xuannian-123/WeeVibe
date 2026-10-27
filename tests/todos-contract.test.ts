import { describe,expect,it } from 'vitest';
import * as contracts from '../packages/contracts/src';
import { createApiClient } from '../packages/api-client/src';
describe('WG09 dedicated readonly todos boundary',()=>{
 it('has a strict page contract separate from accountSnapshot/messages',()=>{expect(contracts).toHaveProperty('todoPageSchema');});
 it('has authenticated paginated read operation',()=>{expect(createApiClient(async()=>({status:503,body:{}}))).toHaveProperty('getTodos');});
});

describe('todo candidate-page feasibility (not number of rendered task cards)',()=>{
 const page=(offset:number,candidate_count:number,has_more=false)=>({
  actor_id:'00000000-0000-4000-8000-000000009001',server_time:'2030-01-01T10:00:00.000Z',activities:[],
  page:{offset,page_size:50,candidate_count,returned_activity_count:0,has_more,next_cursor:has_more?'YWJj':null,scope:'authorized_candidates',snapshot_fingerprint:'a'.repeat(64),valid_until:null}
 });
 it.each([[50,0,false],[2000,1,false],[1950,50,true]] as const)('rejects impossible page offset=%i candidates=%i more=%s', (offset,count,more)=>{
  expect(contracts.todoPageSchema.safeParse(page(offset,count,more)).success).toBe(false);
 });
 it.each([[0,0,false],[50,1,false],[1950,50,false],[0,50,true]] as const)('accepts real boundary offset=%i candidates=%i more=%s even with zero cards', (offset,count,more)=>{
  expect(contracts.todoPageSchema.safeParse(page(offset,count,more)).success).toBe(true);
 });
});
