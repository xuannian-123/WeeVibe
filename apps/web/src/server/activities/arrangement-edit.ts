import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { editArrangementInputSchema, arrangementEditPreviewSchema, arrangementAgreementV3, planChangeEventSchema, PLAN_CHANGE_EVENT_TYPE,
  type EditArrangementInput, type ArrangementPlan, type ArrangementEditPreview } from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { loadActivity, lockActivity } from './state';
import { replay, remember } from './idempotency';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint, segmentCounts } from './rules';
import { activitySnapshot } from './snapshot';
import { arrangementPlan } from './arrangement-history';
type State = Awaited<ReturnType<typeof loadActivity>>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function parse(raw: EditArrangementInput) {
  const value = editArrangementInputSchema.safeParse(raw);
  if (!value.success) throw new ServiceError('INVALID_INPUT', 400, '请核对环节完整安排、人数、顺序和唯一主环节');
  return value.data;
}
export function planArrangementEdit(activity: State, actor: string, input: EditArrangementInput, now: Date) {
  checkManager(activity.currentManagerId, actor); checkNotCancelled(activity.cancelledAt); checkRevision(activity.revision, input.expected_revision);
  if (activity.revision >= 2_147_483_647 || activity.mainRevision >= 2_147_483_647) throw new ServiceError('INVALID_INPUT', 409, '活动版本已达上限');
  if (activity.segments.some(s => !input.segments.some(next => next.segment_id === s.id))) throw new ServiceError('INVALID_INPUT', 400, '已有环节必须保留，可明确取消，不能删除历史记录');
  const rows = input.segments.map((next, position) => {
    const old = next.segment_id ? activity.segments.find(s => s.id === next.segment_id) : undefined;
    if (next.segment_id && !old) throw new ServiceError('INVALID_INPUT', 400, '环节不属于当前活动');
    if (old && old.clientRef !== next.client_ref) throw new ServiceError('INVALID_INPUT', 400, '不能修改已有环节的稳定引用');
    if (!old && activity.segments.some(s => s.clientRef === next.client_ref)) throw new ServiceError('INVALID_INPUT', 400, '新环节引用与历史记录重复');
    const before = old ? arrangementPlan(old) : null;
    const after: ArrangementPlan = { segment_id: old?.id ?? randomUUID(), client_ref: next.client_ref, position, type: next.type, name: next.name,
      starts_at: new Date(next.starts_at).toISOString(), ends_at: new Date(next.ends_at).toISOString(), deadline_at: new Date(next.deadline_at).toISOString(),
      minimum_participants: next.minimum_participants, capacity: next.capacity, location: next.location, fee: next.fee, requirements: next.requirements };
    const cancelled = next.cancelled;
    if (old?.cancelledAt && (!cancelled || !same(before, after))) throw new ServiceError('INVALID_INPUT', 409, '已取消环节仅保留历史，不能复活或修改');
    if (old && now >= old.startsAt && (!same(before, after) || cancelled !== !!old.cancelledAt)) throw new ServiceError('INVALID_INPUT', 409, '已开始环节的线上安排已锁定，不能回拨时间绕过限制');
    if (!old && (cancelled || new Date(after.starts_at) <= now || new Date(after.deadline_at) <= now)) throw new ServiceError('INVALID_INPUT', 400, '新增环节必须未开始且报名仍开放');
    if (old && !old.cancelledAt && now < old.startsAt && new Date(after.starts_at) <= now) throw new ServiceError('INVALID_INPUT', 409, '新开始时间必须仍在未来');
    if (old && next.capacity < segmentCounts(old).occupied_count) throw new ServiceError('CAPACITY_BELOW_OCCUPIED', 409, '新上限不能少于当前占位人数，待重新接受也占位');
    const material = !!before && !same(arrangementAgreementV3(before), arrangementAgreementV3(after));
    const reset = !!before && (!same(before.location, after.location) || before.starts_at !== after.starts_at || before.ends_at !== after.ends_at);
    return { old, before, after, cancelled, material, reset, cross: false };
  });
  // A changed gap/order matters to people attending both segments. No guessed travel durations.
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (!a.old || !b.old || a.cancelled || b.cancelled || !a.before || !b.before) continue;
    const shared = a.old.participations.some(p => p.status === 'joined' && b.old!.participations.some(q => q.userId === p.userId && q.status === 'joined'));
    if (!shared) continue;
    const oldOrder = a.before.position < b.before.position;
    const oldGap = oldOrder ? Date.parse(b.before.starts_at) - Date.parse(a.before.ends_at) : Date.parse(a.before.starts_at) - Date.parse(b.before.ends_at);
    const gap = Date.parse(b.after.starts_at) - Date.parse(a.after.ends_at);
    if (oldOrder !== (a.after.position < b.after.position) || oldGap !== gap) {
      for (const row of [a, b]) if (!row.material) {
        if (now < row.old!.startsAt) row.cross = true;
      }
    }
  }
  const main = rows.find(row => row.after.client_ref === input.main_segment_ref)!;
  const mainChanged = main.after.segment_id !== activity.mainSegmentId;
  if (mainChanged && new Date(main.after.starts_at) <= now) throw new ServiceError('INVALID_INPUT', 409, '新主环节必须未开始且未取消');
  if (rows.some(row => row.old && row.old.planRevision >= 2_147_483_647 && (row.material || row.cross))) throw new ServiceError('INVALID_INPUT', 409, '安排版本已达上限');
  const changed = rows.filter(row => !row.old || !same(row.before, row.after) || row.cancelled !== !!row.old.cancelledAt || row.cross);
  if (!changed.length && !mainChanged) throw new ServiceError('INVALID_INPUT', 400, '安排没有变化');
  const preview = arrangementEditPreviewSchema.parse({ activity_id: activity.id, viewer_user_id: actor, revision: activity.revision, main_changed: mainChanged,
    warnings: ['新地点或时段需要重新核实；系统不自动取消旧预订、改价、退款或替成员同意。', '转场耗时及商家可用性尚需人工核实；跨段时间影响会纳入重新接受。'],
    changes: changed.map(row => ({ client_ref: row.after.client_ref, name: row.after.name, before: row.before, after: row.after, cancelled: row.cancelled,
      is_new: !row.old, requires_reacceptance: !row.cancelled && (row.material || row.cross), resets_verification: row.reset,
      affected_count: row.old ? segmentCounts(row.old).occupied_count : 0 })) });
  return { rows, main, mainChanged, changed, preview };
}
export function previewArrangementEdit(id: string, actor: string, raw: EditArrangementInput): Promise<ArrangementEditPreview> {
  const input = parse(raw);
  return withDb(db => db.$transaction(async tx => planArrangementEdit(await loadActivity(tx, id), actor, input, new Date()).preview,
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}
export function editArrangement(id: string, actor: string, raw: EditArrangementInput) {
  const input = parse(raw), scope = `arrangement-edit:${id}`, hash = requestFingerprint(actor, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, id); checkManager(activity.currentManagerId, actor);
    if (await replay(tx, actor, input.idempotency_key, scope, hash)) return activitySnapshot(tx, id, actor);
    const plan = planArrangementEdit(activity, actor, input, new Date());
    // Vacate the unique (activity, position) slots inside the transaction before reordering.
    const offset = Math.max(0, ...activity.segments.map(s => s.position)) + plan.rows.length + 1;
    if (offset + activity.segments.length > 2_147_483_647) throw new ServiceError('INVALID_INPUT', 409, '环节顺序已达上限');
    for (const [i, old] of activity.segments.entries()) await tx.segment.update({ where: { id: old.id }, data: { position: offset + i } });
    const now = new Date();
    // Recheck start locks after asynchronous writes; an entire failed edit rolls back.
    planArrangementEdit(activity, actor, input, now);
    for (const row of plan.rows) {
      const s = row.after, increment = row.material || row.cross;
      const data = { position: s.position, type: s.type, name: s.name, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), deadlineAt: new Date(s.deadline_at),
        minimumParticipants: s.minimum_participants, capacity: s.capacity, location: s.location, fee: s.fee, requirements: s.requirements,
        ...(row.reset ? { verificationStatus: 'unknown' as const, bookingStatus: 'unknown' as const } : {}),
        ...(row.cancelled ? { cancelledAt: row.old?.cancelledAt ?? now } : {}) };
      if (row.old) await tx.segment.update({ where: { id: row.old.id }, data: { ...data, ...(increment ? { planRevision: { increment: 1 } } : {}) } });
      else await tx.segment.create({ data: { ...data, id: s.segment_id, activityId: id, clientRef: s.client_ref } });
      if (row.before && (!same(row.before, row.after) || row.cross)) {
        const reasons = [...(row.material ? ['arrangement' as const] : []), ...(row.cross ? ['cross_segment' as const] : []),
          ...(row.before.capacity !== s.capacity ? ['capacity' as const] : []), ...(row.before.deadline_at !== s.deadline_at ? ['deadline' as const] : [])];
        const event = planChangeEventSchema.parse({ schema_version: 1, segment_id: s.segment_id, from_plan_revision: row.old!.planRevision,
          to_plan_revision: row.old!.planRevision + (increment ? 1 : 0), before: row.before, after: s, reasons });
        await tx.activityEvent.create({ data: { activityId: id, actorUserId: actor, type: PLAN_CHANGE_EVENT_TYPE, revision: activity.revision + 1, detail: event } });
      }
    }
    planArrangementEdit(activity, actor, input, new Date());
    const mainAffected = plan.mainChanged || plan.main.material || plan.main.cross || plan.main.reset;
    const updated = await tx.activity.update({ where: { id }, data: { revision: { increment: 1 }, mainSegmentId: plan.main.after.segment_id,
      ...(plan.mainChanged ? { mainRevision: { increment: 1 } } : {}),
      ...(mainAffected ? { confirmedAt: null, confirmedMainRevision: null, confirmedPlanRevision: null } : {}) } });
    await tx.activityEvent.create({ data: { activityId: id, actorUserId: actor, type: 'activity_arrangement_edited', revision: updated.revision,
      detail: { main_segment_id: plan.main.after.segment_id, changes: plan.preview.changes.map(s => ({ segment_id: s.after.segment_id, is_new: s.is_new, cancelled: s.cancelled })) } } });
    await remember(tx, actor, input.idempotency_key, scope, hash, id);
    return activitySnapshot(tx, id, actor);
  });
}
