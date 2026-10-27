import { describe, expect, it } from 'vitest';
import { formationCommandSchema } from '../packages/contracts/src/formation';
import { apiErrorSchema } from '../packages/contracts/src';
import { checkFormationReady, checkFormationTarget, type FormationSegment } from '../apps/web/src/server/activities/formation-rules';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base={idempotency_key:'formation-test-key',expected_revision:1,segment_id:id,expected_plan_revision:3};
function segment():FormationSegment{return{id,startsAt:new Date('2030-01-01T11:00:00Z'),deadlineAt:new Date('2030-01-01T09:00:00Z'),cancelledAt:null,planRevision:3,capacity:6,minimumParticipants:4,verificationStatus:'manual_checked',participations:Array.from({length:4},(_,i)=>({userId:`member-${i}`,status:'joined',acceptedPlanRevision:3}))};}
describe('formation contract and pure conditions',()=>{
 it.each([true,false])('accepts explicit verification %s without coercion',verified=>{expect(formationCommandSchema.parse({...base,action:'set-verification',verified})).toMatchObject({verified});});
 it('accepts strict confirmation and normalizes UUIDs',()=>{expect(formationCommandSchema.parse({...base,segment_id:id.toUpperCase(),action:'confirm-formation'}).segment_id).toBe(id);});
 it.each([{action:'set-verification'},{action:'set-verification',verified:'true'},{action:'confirm-formation',verified:true},{action:'confirm-formation',user_id:id},{action:'confirm-formation',booking_status:'manual_booked'},{action:'confirm-formation',counts:{accepted:100}},{action:'reopen'}])('rejects missing/unknown/forged fields %j',extra=>{expect(formationCommandSchema.safeParse({...base,...extra}).success).toBe(false);});
 it('does not confuse membership minimum with full capacity',()=>{expect(checkFormationReady(segment()).occupied_count).toBe(4);});
 it('requires every occupied seat to have accepted, not only a minimum subset',()=>{const s=segment();s.participations.push({userId:'pending',status:'joined',acceptedPlanRevision:2});expect(()=>checkFormationReady(s)).toThrow('尚未接受');});
 it('does not count exited or merely other-segment members',()=>{const s=segment();s.participations[0].status='exited';expect(()=>checkFormationReady(s)).toThrow('最低');});
 it('requires manual verification independently of seats',()=>{const s=segment();s.verificationStatus='unknown';expect(()=>checkFormationReady(s)).toThrow('人工核实');});
 it('permits the before-start path even after application deadline',()=>{const s=segment();expect(checkFormationTarget({mainSegmentId:id,segments:[s]},{...base,action:'confirm-formation'},new Date('2030-01-01T10:00:00Z'))).toBe(s);});
 it.each(['set-verification','confirm-formation'] as const)('fails closed for new %s at exact start with a rule-unconfirmed code',action=>{try{checkFormationTarget({mainSegmentId:id,segments:[segment()]},{...base,...(action==='set-verification'?{action,verified:true}:{action})},new Date('2030-01-01T11:00:00Z'));throw new Error('not rejected');}catch(e){expect(e).toMatchObject({code:'FORMATION_RULE_UNCONFIRMED',status:409});expect((e as Error).message).toContain('规则待确认');}});
 it('keeps both formation codes recognizable in the shared error envelope',()=>{for(const code of ['FORMATION_NOT_READY','FORMATION_RULE_UNCONFIRMED'])expect(apiErrorSchema.safeParse({error:{code,message:'explicit'},request_id:'fixture'}).success).toBe(true);});
});
