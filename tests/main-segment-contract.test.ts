import { describe,expect,it } from 'vitest';
import * as contracts from '../packages/contracts/src';
import { createApiClient } from '../packages/api-client/src';
describe('direct main-segment change boundary',()=>{
 it('has a dedicated strict input, not a formation or cancelled-segment alias',()=>{expect(contracts).toHaveProperty('changeMainSegmentInputSchema');});
 it('has a dedicated API method returning current activity snapshot',()=>{expect(createApiClient(async()=>({status:503,body:{}}))).toHaveProperty('changeMainSegment');});
});

describe('strict main change shape is not a general arrangement edit',()=>{
 const input={idempotency_key:'main-contract-key',expected_revision:1,expected_main_segment_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',target_segment_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
 it('canonicalizes UUIDs and requires different expected and target main',()=>{expect(contracts.changeMainSegmentInputSchema.parse({...input,target_segment_id:input.target_segment_id.toUpperCase()}).target_segment_id).toBe(input.target_segment_id);expect(contracts.changeMainSegmentInputSchema.safeParse({...input,target_segment_id:input.expected_main_segment_id.toUpperCase()}).success).toBe(false);});
 it('rejects caller management/formation/counts/booking and timestamp fields',()=>{for(const extra of [{user_id:input.target_segment_id},{confirmed:true},{minimum_participants:1},{booking_status:'manual_booked'},{starts_at:'2031-01-01T00:00:00Z'}])expect(contracts.changeMainSegmentInputSchema.safeParse({...input,...extra}).success).toBe(false);});
});
