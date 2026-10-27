import type { ArrangementPlan } from '../packages/contracts/src/arrangement';
export const arrangementUuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
export const arrangementIds = { activity: arrangementUuid(1), segment: arrangementUuid(2), otherSegment: arrangementUuid(3), manager: arrangementUuid(9), actor: arrangementUuid(20), other: arrangementUuid(21) };
export function arrangementFixturePlan(minimum = 4, segmentId = arrangementIds.segment): ArrangementPlan {
 return { segment_id:segmentId,client_ref:'s1',position:0,type:'custom',name:'public plan',starts_at:'2030-01-01T11:00:00.000Z',ends_at:'2030-01-01T12:00:00.000Z',deadline_at:'2030-01-01T09:00:00.000Z',minimum_participants:minimum,capacity:6,location:{name:'public venue',address:null,source_url:null},fee:{kind:'total',amount_cents:24000,currency:'CNY',note:'fixed quote'},requirements:'original requirements' };
}
export function arrangementFixtureEvent(from=1, before=4, after=5, segmentId=arrangementIds.segment) {
 return { activityId:arrangementIds.activity,revision:from+1,createdAt:new Date(`2030-01-01T09:0${from}:00Z`),type:'segment_arrangement_changed',detail:{schema_version:1,segment_id:segmentId,from_plan_revision:from,to_plan_revision:from+1,before:arrangementFixturePlan(before,segmentId),after:arrangementFixturePlan(after,segmentId)} };
}
