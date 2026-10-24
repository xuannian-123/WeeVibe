import {
  aiSnapshotSchema, aiCoordinationProposalSchema, aiCreationDraftSchema, aiInvitationSchema,
  type AiSnapshot, type AiCoordinationProposal
} from '@weego/contracts/src/ai';

export type AiValidationIssue = { code: string; path: string };
export type AiValidationResult<T> =
  | { ok: false; issues: AiValidationIssue[]; can_apply: false }
  | { ok: true; value: T; issues: []; can_apply: false; disposition: 'review_required' | 'needs_info' | 'no_solution'; computed: { affected_member_ids: string[]; unknown_transfer_edges: string[]; requires_reverification: string[] } };
const ms = (s: string) => Date.parse(s);
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x,i)=>same(x,b[i]));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string,unknown>, y = b as Record<string,unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));
};
const equalSet = (a: string[], b: string[]) => new Set(a).size === a.length && a.length === b.length && a.every(x => b.includes(x));
const fail = (issues: AiValidationIssue[]) => ({ ok: false as const, issues, can_apply: false as const });
const issue = (a: AiValidationIssue[], code: string, path = '') => a.push({ code, path });

function binding(s: AiSnapshot, p: {activity_id: string; base_revision: number; segment_versions: Record<string, number>}, errors: AiValidationIssue[]) {
  if (s.activity_id !== p.activity_id || s.revision !== p.base_revision) issue(errors, 'STALE_ACTIVITY');
  const ids = s.segments.map(x => x.id);
  if (!equalSet(Object.keys(p.segment_versions), ids) || s.segments.some(x => p.segment_versions[x.id] !== x.revision)) issue(errors, 'STALE_SEGMENTS');
}

/** Pure validation only. Snapshot/actor must come from the trusted server, never a model or client claim.
 * A successful result is NOT permission to write, nor proof of booking or physical feasibility. */
export function validateTimeCoordination(snapshot: unknown, proposal: unknown, actorId: string): AiValidationResult<AiCoordinationProposal> {
  const sr = aiSnapshotSchema.safeParse(snapshot), pr = aiCoordinationProposalSchema.safeParse(proposal);
  if (!sr.success || !pr.success) return fail([{ code: !sr.success ? 'INVALID_SNAPSHOT' : 'INVALID_PROPOSAL', path: '' }]);
  const s = sr.data, p = pr.data, errors: AiValidationIssue[] = [];
  binding(s, p, errors);
  if (p.unknowns.some(x => x.segment_id !== null && !s.segments.some(t => t.id === x.segment_id))) issue(errors, 'UNKNOWN_REFERENCE');
  if (actorId !== s.manager_id) issue(errors, 'NOT_CURRENT_MANAGER');
  if (s.status === 'cancelled') issue(errors, 'ACTIVITY_CANCELLED');
  if (p.status !== 'proposed') {
    if (p.changes.length || p.affected_member_ids.length) issue(errors, 'NON_PROPOSAL_HAS_CHANGES');
    if (p.status === 'needs_info' && (!p.unknowns.length || p.feasibility !== 'unknown')) issue(errors, 'MISSING_INFORMATION_NOT_DISCLOSED');
    if (p.status === 'no_solution' && p.feasibility !== 'not_feasible') issue(errors, 'INVALID_NO_SOLUTION');
    // A no-solution explanation is a model claim, not an independently proved impossibility theorem.
    return errors.length ? fail(errors) : { ok: true, value: p, issues: [], can_apply: false, disposition: p.status, computed: { affected_member_ids: [], unknown_transfer_edges: [], requires_reverification: [] } };
  }
  if (!p.changes.length) issue(errors, 'EMPTY_PROPOSAL');
  if (p.feasibility === 'not_feasible') issue(errors, 'INFEASIBLE_PROPOSAL');
  const changed = new Set<string>(), members = new Set<string>();
  for (const c of p.changes) {
    const old = s.segments.find(x => x.id === c.segment_id);
    if (!old) { issue(errors, 'UNKNOWN_SEGMENT', c.segment_id); continue; }
    if (changed.has(c.segment_id)) issue(errors, 'DUPLICATE_CHANGE', c.segment_id);
    changed.add(c.segment_id);
    if (old.revision !== c.segment_revision || !same(c.before, {starts_at:old.starts_at,ends_at:old.ends_at,location:old.location})) issue(errors, 'STALE_BEFORE', c.segment_id);
    if (old.status !== 'planned' || ms(old.starts_at) <= ms(s.now) || old.locked) issue(errors, 'SEGMENT_LOCKED', c.segment_id);
    if (!same(c.after.location, old.location)) issue(errors, 'LOCATION_CHANGE_FORBIDDEN', c.segment_id);
    if (ms(c.after.starts_at) <= ms(s.now) || ms(c.after.starts_at) >= ms(c.after.ends_at)) issue(errors, 'INVALID_INTERVAL', c.segment_id);
    if (same(c.before, c.after)) issue(errors, 'NO_OP_CHANGE', c.segment_id);
    old.member_ids.forEach(x => members.add(x));
    if (!p.unknowns.some(x => x.code === 'availability_unknown' && x.segment_id === c.segment_id)) issue(errors, 'REVERIFICATION_NOT_DISCLOSED', c.segment_id);
  }
  const proposed = s.segments.filter(x => x.status !== 'cancelled').map(x => ({...x,...p.changes.find(c => c.segment_id === x.id)?.after}));
  for (const c of s.time_constraints) {
    const x = proposed.find(t => t.id === c.segment_id);
    if (!x) continue;
    if ((c.fixed_start && ms(x.starts_at) !== ms(c.fixed_start)) || (c.fixed_end && ms(x.ends_at) !== ms(c.fixed_end)) ||
        (c.earliest_start && ms(x.starts_at) < ms(c.earliest_start)) || (c.latest_end && ms(x.ends_at) > ms(c.latest_end)) ||
        (c.minimum_duration_minutes !== null && ms(x.ends_at) - ms(x.starts_at) < c.minimum_duration_minutes * 60000)) issue(errors, 'TIME_CONSTRAINT_VIOLATION', x.id);
  }
  const unknownEdges: string[] = [];
  for (let i=0; i<proposed.length-1; i++) {
    const a = proposed[i], b = proposed[i+1];
    const transfer = s.transfers.find(t => t.from === a.id && t.to === b.id);
    if (ms(a.ends_at) > ms(b.starts_at)) issue(errors, 'ADJACENT_CONFLICT', `${a.id}/${b.id}`);
    if (!transfer || transfer.minutes === null) {
      unknownEdges.push(`${a.id}/${b.id}`);
      if (!p.unknowns.some(x => x.code === 'transfer_unknown' && x.segment_id === b.id)) issue(errors, 'UNKNOWN_TRANSFER_NOT_DISCLOSED', b.id);
    } else if (ms(a.ends_at) + transfer.minutes * 60000 > ms(b.starts_at)) issue(errors, 'TRANSFER_CONFLICT', `${a.id}/${b.id}`);
  }
  if ((unknownEdges.length || p.unknowns.length) && p.feasibility === 'feasible') issue(errors, 'UNVERIFIED_FEASIBILITY');
  const affected = [...members].sort();
  if (!equalSet(p.affected_member_ids, affected)) issue(errors, 'WRONG_AFFECTED_MEMBERS');
  return errors.length ? fail(errors) : { ok: true, value: p, issues: [], can_apply: false, disposition: 'review_required', computed: { affected_member_ids: affected, unknown_transfer_edges: unknownEdges, requires_reverification: [...changed] } };
}

/** Only canonical facts are accepted. Do not display unvalidated provider prose or URLs. */
export function validateInvitationFacts(snapshot: unknown, invitation: unknown) {
  const sr = aiSnapshotSchema.safeParse(snapshot), pr = aiInvitationSchema.safeParse(invitation);
  if (!sr.success || !pr.success) return fail([{code:!sr.success?'INVALID_SNAPSHOT':'INVALID_INVITATION',path:''}]);
  const s = sr.data, p = pr.data, errors: AiValidationIssue[] = [];
  binding(s,p,errors);
  const seen = new Set<string>();
  if (!p.facts.length) issue(errors,'EMPTY_FACTS');
  for (const f of p.facts) {
    const x = s.segments.find(t=>t.id===f.segment_id);
    if (!x || seen.has(f.segment_id)) { issue(errors,'UNKNOWN_OR_DUPLICATE_SEGMENT',f.segment_id); continue; }
    seen.add(f.segment_id);
    const expected = {segment_id:x.id,segment_revision:x.revision,starts_at:x.starts_at,ends_at:x.ends_at,location:x.location,
      occupied:x.occupied,free_seats:x.capacity-x.occupied,minimum_gap:Math.max(0,x.minimum-x.occupied),fee_minor:x.fee_minor,deadline_at:x.deadline_at,
      open:s.status==='active'&&x.status==='planned'&&ms(s.now)<ms(x.starts_at)&&ms(s.now)<ms(x.deadline_at)&&x.occupied<x.capacity,
      formed:s.status==='active'&&x.id===s.primary_segment_id&&s.primary_formed,verified:x.verified,booked:x.booked};
    if (!same(f, expected)) issue(errors,'FACT_MISMATCH',x.id);
  }
  return errors.length ? fail(errors) : {ok:true as const,value:p,can_apply:false as const};
}

/** Creation always remains an editable draft. Trusted extraction facts are required to detect invented non-null values. */
export function validateCreationDraft(input: unknown, source: { revision: number; known_fields: Record<string, unknown> }) {
  const parsed = aiCreationDraftSchema.safeParse(input);
  if (!parsed.success) return fail([{code:'INVALID_CREATION_DRAFT',path:''}]);
  const p=parsed.data, errors: AiValidationIssue[]=[];
  if(p.source_revision!==source.revision)issue(errors,'STALE_SOURCE');
  const evidence = (path: string, value: unknown) => {
    if (value !== null && (!Object.hasOwn(source.known_fields,path) || !same(value,source.known_fields[path]))) issue(errors,'UNSUPPORTED_CREATION_FACT',path);
  };
  evidence('name',p.name);evidence('primary_segment_ref',p.primary_segment_ref);
  const refs=p.segments.map(x=>x.ref);
  if(new Set(refs).size!==refs.length || (p.primary_segment_ref!==null&&!refs.includes(p.primary_segment_ref)))issue(errors,'INVALID_SEGMENT_REFS');
  const missing:string[]=[];
  if(p.name===null)missing.push('name');if(p.primary_segment_ref===null)missing.push('primary_segment_ref');
  for(const s of p.segments){
    evidence(`segments.${s.ref}.type`,s.type);
    for(const key of ['name','starts_at','ends_at','deadline_at','location','minimum','capacity','fee_minor'] as const)if(s[key]===null)missing.push(`segments.${s.ref}.${key}`);
    for(const key of ['name','starts_at','ends_at','deadline_at','location','minimum','capacity','fee_minor'] as const)evidence(`segments.${s.ref}.${key}`,s[key]);
    if(s.minimum!==null&&s.capacity!==null&&s.minimum>s.capacity)issue(errors,'INVALID_CAPACITY',s.ref);
    if(s.starts_at&&s.ends_at&&ms(s.starts_at)>=ms(s.ends_at))issue(errors,'INVALID_INTERVAL',s.ref);
  }
  if(!equalSet(p.missing_fields,missing))issue(errors,'INCORRECT_MISSING_FIELDS');
  for(let i=0;i<p.segments.length-1;i++){
    const a=p.segments[i],b=p.segments[i+1];
    if(a.ends_at&&b.starts_at&&ms(a.ends_at)>ms(b.starts_at))issue(errors,'ADJACENT_CONFLICT',`${a.ref}/${b.ref}`);
  }
  return errors.length?fail(errors):{ok:true as const,value:p,can_apply:false as const,publishable:false as const,missing_fields:missing};
}
