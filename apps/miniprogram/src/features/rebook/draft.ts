import Taro from '@tarojs/taro';
import { z } from 'zod';
import { activityIdSchema, rebookSourceSchema, type RebookSource, type CreateActivityInput } from '@weevibe/contracts';
import { emptySegment, buildCreateInput, shanghaiTime, type ActivityForm, type SegmentForm } from '../activity-create/form';

const text = z.string();
const segmentSchema = z.object({ ref: text.min(1), type: text, name: text, startDate: text, startTime: text, endDate: text, endTime: text,
  deadlineDate: text, deadlineTime: text, place: text, address: text, amount: text, feeUnit: text, feeNote: text, requirements: text, minimum: text, capacity: text }).strict();
const formSchema = z.object({ name: text, nickname: text, mainRef: text, attending: z.array(text), segments: z.array(segmentSchema).min(1) }).strict();
const checksSchema = z.record(text, z.object({ location: text.optional(), fee: text.optional() }).strict());
const draftSchema = z.object({ version: z.literal(1), actor_id: activityIdSchema, source_activity_id: activityIdSchema,
  source_revision: z.number().int().positive(), source_timezone: text, form: formSchema, checks: checksSchema }).strict();
export type RebookDraft = z.infer<typeof draftSchema>;
export type RebookChecks = RebookDraft['checks'];
export function rebookKeys(actor: string, sourceId: string) {
  const suffix = `${activityIdSchema.parse(actor)}:${activityIdSchema.parse(sourceId)}`;
  return { draft: `weevibe-rebook-draft-v1:${suffix}`, pending: `weevibe-rebook-pending-v1:${suffix}`, completed: `weevibe-rebook-completed-v1:${suffix}` };
}
// Explicit field copy strips map metadata and any fields outside the editable form.
export function cleanRebookForm(form: ActivityForm): ActivityForm {
  return { name: form.name, nickname: form.nickname, mainRef: form.mainRef, attending: [...form.attending], segments: form.segments.map(s => {
    const { ref, type, name, startDate, startTime, endDate, endTime, deadlineDate, deadlineTime, place, address, amount, feeUnit, feeNote, requirements, minimum, capacity } = s;
    return { ref, type, name, startDate, startTime, endDate, endTime, deadlineDate, deadlineTime, place, address, amount, feeUnit, feeNote, requirements, minimum, capacity };
  }) };
}
export function draftFromRebookSource(raw: RebookSource, selectedIds: string[]): RebookDraft {
  const source = rebookSourceSchema.parse(raw);
  const selected = selectedIds.map(id => activityIdSchema.parse(id));
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !source.segments.some(s => s.source_segment_id === id))) throw new Error('请明确选择来源中至少一个有效环节');
  const segments = source.segments.filter(s => selected.includes(s.source_segment_id)).map(s => ({ ...emptySegment(), type: s.type, name: s.name, place: s.location.name, address: s.location.address ?? '',
    minimum: String(s.minimum_participants), capacity: String(s.capacity), feeUnit: s.fee.kind,
    amount: s.fee.amount_cents === null ? '' : (s.fee.amount_cents / 100).toFixed(2), feeNote: s.fee.note, requirements: s.requirements }));
  return { version: 1, actor_id: source.actor_id, source_activity_id: source.source_activity_id, source_revision: source.source_revision, source_timezone: source.source_timezone,
    form: { name: source.name, nickname: '', attending: [], mainRef: segments.length === 1 ? segments[0].ref : '', segments }, checks: {} };
}
export function parseRebookDraft(raw: unknown, actor: string, sourceId: string): RebookDraft {
  const draft = draftSchema.parse(raw);
  if (draft.actor_id !== activityIdSchema.parse(actor) || draft.source_activity_id !== activityIdSchema.parse(sourceId) || new Set(draft.form.segments.map(s => s.ref)).size !== draft.form.segments.length) throw new Error('再约草稿来源不匹配');
  return draft;
}
export function hasLocalRebook(actor: string, sourceId: string): boolean {
  const keys = rebookKeys(actor, sourceId);
  // A malformed or unreadable existing record must never be overwritten by import.
  return [keys.pending, keys.completed, keys.draft].some(key => { const value: unknown = Taro.getStorageSync(key); return value !== undefined && value !== null && value !== ''; });
}
export function checkValue(segment: SegmentForm, kind: 'location' | 'fee'): string {
  const dates = [segment.startDate, segment.startTime, segment.endDate, segment.endTime];
  return JSON.stringify([...dates, ...(kind === 'location' ? [segment.place, segment.address] : [segment.feeUnit, segment.amount, segment.feeNote])]);
}
export function rebookCheckReady(segment: SegmentForm, now = Date.now()): boolean {
  try {
    const start = Date.parse(shanghaiTime(segment.startDate, segment.startTime)), end = Date.parse(shanghaiTime(segment.endDate, segment.endTime));
    return start > now && end > start;
  } catch { return false; }
}
export function updateRebookForm(draft: RebookDraft, next: ActivityForm): RebookDraft {
  const form = cleanRebookForm(next), checks: RebookChecks = {};
  for (const segment of form.segments) {
    const old = draft.checks[segment.ref];
    if (old) checks[segment.ref] = { ...(old.location === checkValue(segment, 'location') ? { location: old.location } : {}), ...(old.fee === checkValue(segment, 'fee') ? { fee: old.fee } : {}) };
  }
  return { ...draft, form, checks };
}
export function confirmRebookField(draft: RebookDraft, ref: string, kind: 'location' | 'fee'): RebookDraft {
  const segment = draft.form.segments.find(s => s.ref === ref); if (!segment) return draft;
  if (!rebookCheckReady(segment)) throw new Error('请先完整设置未来的开始与结束日期、时间，再核对新时段地点与费用。');
  return { ...draft, checks: { ...draft.checks, [ref]: { ...draft.checks[ref], [kind]: checkValue(segment, kind) } } };
}
export function buildRebookInput(draft: RebookDraft, key: string, now: number): CreateActivityInput {
  for (const [i, segment] of draft.form.segments.entries()) {
    if (!segment.startDate || !segment.startTime || !segment.endDate || !segment.endTime || !segment.deadlineDate || !segment.deadlineTime) throw new Error(`环节 ${i + 1}：请重新明确设置开始、结束与报名截止日期和时间。`);
    if (draft.checks[segment.ref]?.location !== checkValue(segment, 'location') || draft.checks[segment.ref]?.fee !== checkValue(segment, 'fee')) throw new Error(`环节 ${i + 1}：请主动核对新日期的地点与参考费用；旧核实和预订不会继承。`);
  }
  const input = buildCreateInput(cleanRebookForm(draft.form), key);
  if (input.segments.some(s => [s.starts_at, s.ends_at, s.deadline_at].some(value => Date.parse(value) <= now))) throw new Error('再约的全部开始、结束和报名截止时间必须在未来，请重新设置。');
  return input;
}
