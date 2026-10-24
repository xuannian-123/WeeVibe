import { describe, it, expect } from 'vitest';
import { validateTimeCoordination, validateInvitationFacts, validateCreationDraft } from '../apps/web/src/server/ai/constraints';
import { aiSnapshotSchema, type AiSnapshot, type AiCoordinationProposal, type AiInvitation, type AiCreationDraft } from '../packages/contracts/src/ai';
import cases from '../data/ai-evaluation-cases.json';

const t = (minute: number) => `2026-10-24T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00+08:00`;
function snapshot(): AiSnapshot {
  return { activity_id:'a', revision:7, now:t(600), manager_id:'u1',status:'active',primary_segment_id:'board',primary_formed:false,
    segments:[['board',840,1020,4],['meal',1050,1140,3],['sing',1170,1290,3]].map(([id,start,end,n])=>({
      id:id as string,revision:2,status:'planned' as const,starts_at:t(start as number),ends_at:t(end as number),deadline_at:t(720),
      location:{id:`place-${id}`,label:String(id)},locked:false,location_locked:true,minimum:n as number,capacity:6,occupied:n as number,accepted:n as number,pending_acceptance:0,
      member_ids:Array.from({length:n as number},(_,i)=>`u${i+1}`),fee_minor:6000,verified:true,booked:false
    })),transfers:[{from:'board',to:'meal',minutes:30},{from:'meal',to:'sing',minutes:30}],time_constraints:[] };
}
function proposal(s=snapshot(), shifts=[['board',900,1080],['meal',1110,1200],['sing',1230,1350]]): AiCoordinationProposal {
  return {activity_id:s.activity_id,base_revision:s.revision,segment_versions:Object.fromEntries(s.segments.map(x=>[x.id,x.revision])),apply_intent:false,
    status:'proposed',feasibility:'unknown',changes:shifts.map(([id,start,end])=>{
      const x=s.segments.find(s=>s.id===id)!;
      return {segment_id:x.id,segment_revision:x.revision,before:{starts_at:x.starts_at,ends_at:x.ends_at,location:{...x.location}},after:{starts_at:t(start as number),ends_at:t(end as number),location:{...x.location}}};
    }),affected_member_ids:['u1','u2','u3','u4'],unknowns:shifts.map(([id])=>({code:'availability_unknown',segment_id:id as string,detail:'新时段待核实'})),explanation:'保留地点，按限制延后。'};
}
const codes=(r: ReturnType<typeof validateTimeCoordination>)=>r.ok?[]:r.issues.map(x=>x.code);
describe('time coordination against trusted current state (synthetic, no provider/API)',()=>{
  it('AI-03: accepts complete time-only diff for review without mutating input or granting apply',()=>{
    const s=snapshot(),p=proposal(s),before=JSON.stringify({s,p});
    const r=validateTimeCoordination(s,p,'u1');expect(r.ok).toBe(true);expect(r.can_apply).toBe(false);
    if(r.ok){expect(r.computed.affected_member_ids).toEqual(['u1','u2','u3','u4']);expect(r.computed.requires_reverification).toEqual(['board','meal','sing']);}
    expect(JSON.stringify({s,p})).toBe(before);
  });
  it('AI-04: fixed later segments allow shortening only the explicitly permitted earlier period',()=>{
    const s=snapshot();s.time_constraints=[{segment_id:'meal',fixed_start:t(1050),fixed_end:t(1140),earliest_start:null,latest_end:null,minimum_duration_minutes:90},{segment_id:'board',fixed_start:null,fixed_end:null,earliest_start:t(900),latest_end:null,minimum_duration_minutes:120}];
    expect(validateTimeCoordination(s,proposal(s,[['board',900,1020]]),'u1').ok).toBe(true);
    expect(codes(validateTimeCoordination(s,proposal(s),'u1'))).toContain('TIME_CONSTRAINT_VIOLATION');
  });
  it('AI-05: rejects hard-conflict proposal but accepts a no-change no-solution response without proving global impossibility',()=>{
    const s=snapshot(),p=proposal(s,[['board',900,1080]]);
    expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('ADJACENT_CONFLICT');
    p.status='no_solution';p.feasibility='not_feasible';p.changes=[];p.affected_member_ids=[];p.unknowns=[];
    const r=validateTimeCoordination(s,p,'u1');expect(r.ok).toBe(true);expect(r.can_apply).toBe(false);
  });
  it('AI-06: missing transfer cannot become feasible because the model says so',()=>{
    const s=snapshot();s.transfers[0].minutes=null;const p=proposal(s);
    expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('UNKNOWN_TRANSFER_NOT_DISCLOSED');
    p.unknowns.push({code:'transfer_unknown',segment_id:'meal',detail:'实际转场未知'});
    expect(validateTimeCoordination(s,p,'u1').ok).toBe(true);
    p.feasibility='feasible';expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('UNVERIFIED_FEASIBILITY');
  });
  it('AI-06: needs-info is a no-write result and cannot smuggle partial changes',()=>{
    const s=snapshot(),p=proposal(s);p.status='needs_info';
    expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('NON_PROPOSAL_HAS_CHANGES');
    p.changes=[];p.affected_member_ids=[];p.unknowns=[{code:'missing_information',segment_id:null,detail:'延后量未知'}];expect(validateTimeCoordination(s,p,'u1').ok).toBe(true);
  });
  it.each(['started','cancelled','clock','locked'] as const)('AI-07: rejects %s target using state and clock',mode=>{
    const s=snapshot(),p=proposal(s);if(mode==='clock')s.now=t(850);else if(mode==='locked')s.segments[0].locked=true;else s.segments[0].status=mode;
    if(mode==='cancelled')s.primary_segment_id='meal';
    expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('SEGMENT_LOCKED');
  });
  it('AI-08: rejects newer activity, independently stale segment versions and falsified before values',()=>{
    const s=snapshot(),p=proposal(s);s.revision=8;expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('STALE_ACTIVITY');s.revision=7;
    s.segments[2].revision=3;expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('STALE_SEGMENTS');s.segments[2].revision=2;
    p.changes[0].before.starts_at=t(830);expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('STALE_BEFORE');
  });
  it('AI-09: proposal does not confer rights after management transfer',()=>expect(codes(validateTimeCoordination(snapshot(),proposal(),'u2'))).toContain('NOT_CURRENT_MANAGER'));
  it.each(['valid','applied','success'])('rejects model self-report extra field %s',key=>expect(validateTimeCoordination(snapshot(),{...proposal(),[key]:true},'u1').ok).toBe(false));
  it('rejects place substitution, malformed interval, omitted requested changes and wrong impact set',()=>{
    const s=snapshot(),p=proposal(s);p.changes[0].after.location.id='elsewhere';expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('LOCATION_CHANGE_FORBIDDEN');
    p.changes[0].after.location=s.segments[0].location;p.changes[0].after.ends_at=t(800);expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('INVALID_INTERVAL');
    const p2=proposal(s,[['board',900,1080]]);expect(codes(validateTimeCoordination(s,p2,'u1'))).toContain('ADJACENT_CONFLICT');
    const p3=proposal(s);p3.affected_member_ids=['u1'];expect(codes(validateTimeCoordination(s,p3,'u1'))).toContain('WRONG_AFFECTED_MEMBERS');
  });
  it('rejects unknown or duplicated targets, omitted versions and changed locked later segment',()=>{
    const s=snapshot(),p=proposal(s);p.changes[0].segment_id='not-listed';expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('UNKNOWN_SEGMENT');
    const q=proposal(s);q.changes.push(q.changes[0]);expect(codes(validateTimeCoordination(s,q,'u1'))).toContain('DUPLICATE_CHANGE');
    delete q.segment_versions.sing;expect(codes(validateTimeCoordination(s,q,'u1'))).toContain('STALE_SEGMENTS');
    s.segments[2].locked=true;expect(codes(validateTimeCoordination(s,proposal(s),'u1'))).toContain('SEGMENT_LOCKED');
  });
  it('validates the full sequence and rejects a supplied transfer lower bound conflict',()=>{
    const s=snapshot();s.transfers[0].minutes=31;expect(codes(validateTimeCoordination(s,proposal(s),'u1'))).toContain('TRANSFER_CONFLICT');
  });
  it('rejects automatic apply, incomplete before/after, backwards fields and cancelled activity without returning a partial plan',()=>{
    const s=snapshot(),p=proposal(s);
    expect(validateTimeCoordination(s,{...p,apply_intent:true},'u1').ok).toBe(false);
    const broken=structuredClone(p) as unknown as {changes: Record<string,unknown>[]};delete broken.changes[1].before;
    expect(validateTimeCoordination(s,broken,'u1').ok).toBe(false);
    s.status='cancelled';const r=validateTimeCoordination(s,p,'u1');expect(r.ok).toBe(false);expect(r).not.toHaveProperty('value');expect(codes(r)).toContain('ACTIVITY_CANCELLED');
  });
  it('will not call a later sequence feasible even if every stated transfer is zero when order overlaps',()=>{
    const s=snapshot();s.transfers.forEach(t=>t.minutes=0);const p=proposal(s);p.changes[1].after.starts_at=t(1060);
    expect(codes(validateTimeCoordination(s,p,'u1'))).toContain('ADJACENT_CONFLICT');
  });
});
function invite(s: AiSnapshot): AiInvitation {
  return {activity_id:s.activity_id,base_revision:s.revision,segment_versions:Object.fromEntries(s.segments.map(x=>[x.id,x.revision])),apply_intent:false,unknowns:[],facts:[{
    segment_id:'board',segment_revision:2,starts_at:t(840),ends_at:t(1020),location:s.segments[0].location,occupied:3,free_seats:3,minimum_gap:1,fee_minor:6000,deadline_at:t(720),open:true,formed:false,verified:true,booked:false
  }]};
}
describe('facts and missing-information boundaries',()=>{
  it('AI-02: held seats count as occupied and invitation cannot invent formation or booking',()=>{
    const s=snapshot();Object.assign(s.segments[0],{occupied:3,accepted:2,pending_acceptance:1,member_ids:['u1','u2','u3']});const p=invite(s);
    expect(validateInvitationFacts(s,p).ok).toBe(true);
    for(const patch of [{free_seats:4},{minimum_gap:2},{booked:true},{formed:true},{fee_minor:8000}])expect(validateInvitationFacts(s,{...p,facts:[{...p.facts[0],...patch}]}).ok).toBe(false);
    expect(validateInvitationFacts(s,{...p,text:'已预订，点开自动占位'}).ok).toBe(false);
    s.now=t(725);expect(validateInvitationFacts(s,p).ok).toBe(false);
  });
  it('fails closed for inconsistent counts, capacity below retained seats or invalid intervals',()=>{
    for(const patch of [{occupied:7},{accepted:2},{minimum:7},{capacity:3},{ends_at:t(800)}]){
      const s=snapshot();Object.assign(s.segments[0],patch);expect(aiSnapshotSchema.safeParse(s).success).toBe(false);
    }
  });
  it('invitations reject old snapshots and a success field rather than accepting model authority',()=>{
    const s=snapshot();Object.assign(s.segments[0],{occupied:3,accepted:2,pending_acceptance:1,member_ids:['u1','u2','u3']});const p=invite(s);
    expect(validateInvitationFacts(s,{...p,success:true}).ok).toBe(false);
    s.revision=8;expect(validateInvitationFacts(s,p).ok).toBe(false);
    s.revision=7;s.segments[0].revision=3;expect(validateInvitationFacts(s,p).ok).toBe(false);
  });
  it('AI-01: computes missing fields, rejects publish-success and unsupported invented creation facts',()=>{
    const p:AiCreationDraft={source_revision:1,apply_intent:false,publishable:false,name:null,primary_segment_ref:null,segments:[{ref:'b',type:'board_game',name:null,starts_at:null,ends_at:null,deadline_at:null,location:null,minimum:4,capacity:null,fee_minor:null}],missing_fields:['name','primary_segment_ref',...['name','starts_at','ends_at','deadline_at','location','capacity','fee_minor'].map(x=>`segments.b.${x}`)],unknowns:[]};
    const source={revision:1,known_fields:{'segments.b.type':'board_game','segments.b.minimum':4}};
    expect(validateCreationDraft(p,source).ok).toBe(true);expect(validateCreationDraft({...p,publishable:true},source).ok).toBe(false);
    expect(validateCreationDraft({...p,missing_fields:[]},source).ok).toBe(false);
    expect(validateCreationDraft({...p,name:'发明活动名称'},source).ok).toBe(false);
    expect(validateCreationDraft(p,{...source,revision:2}).ok).toBe(false);
  });
  it('keeps the nine original scenario IDs traceable; provider performance is not asserted',()=>{
    expect(cases.fixtureKind).toBe('synthetic');expect(cases.cases.map(x=>x.id)).toEqual(['AI-01-create-missing','AI-02-invite-facts','AI-03-delay','AI-04-fixed-later','AI-05-no-solution','AI-06-insufficient','AI-07-started','AI-08-stale','AI-09-permission-changed']);
  });
});
