import { describe,expect,it } from 'vitest';
import * as contracts from '../packages/contracts/src';
import { createHandoverInputSchema,handoverCommandSchema } from '../packages/contracts/src/handover';
import { createApiClient } from '../packages/api-client/src';
describe('WG06 dedicated handover boundary',()=>{
 it('has real typed handover commands separate from ordinary invitations',()=>{expect(contracts).toHaveProperty('createHandoverInputSchema');expect(contracts).toHaveProperty('handoverCommandSchema');expect(contracts).toHaveProperty('handoverStateSchema');});
 it('has collection and exact historical offer read/write client operations',()=>{const api=createApiClient(async()=>({status:503,body:{}}));for(const key of ['getHandovers','getHandover','createHandover','commandHandover'])expect(api).toHaveProperty(key);});
});

describe('strict handover command shape',()=>{
 const target='00000000-0000-4000-8000-000000000011';
 const create={target_user_id:target,expected_revision:1,expected_management_revision:1,idempotency_key:'original-create-key'};
 it('does not accept caller status/actor/time/role or missing version',()=>{for(const extra of [{status:'accepted'},{actor_id:target},{expires_at:'2030-01-01T00:00:00Z'},{is_manager:true}])expect(createHandoverInputSchema.safeParse({...create,...extra}).success).toBe(false);const{expected_management_revision,...missing}=create;expect(createHandoverInputSchema.safeParse(missing).success).toBe(false);});
 it('supports exactly accept/reject/withdraw and canonical target UUID',()=>{for(const action of ['accept','reject','withdraw'])expect(handoverCommandSchema.safeParse({action,expected_revision:1,expected_management_revision:1,idempotency_key:'original-command-key'}).success).toBe(true);expect(handoverCommandSchema.safeParse({action:'force-assign',expected_revision:1,expected_management_revision:1,idempotency_key:'original-command-key'}).success).toBe(false);expect(createHandoverInputSchema.parse({...create,target_user_id:target.toUpperCase()}).target_user_id).toBe(target);});
});
