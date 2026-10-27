import { formationCommandSchema, type ActivityDetail, type FormationCommand } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { replay, remember } from './idempotency';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint } from './rules';
import { checkFormationReady, checkFormationTarget } from './formation-rules';
import { activitySnapshot } from './snapshot';

export function changeFormation(activityId: string, actorId: string, raw: FormationCommand): Promise<ActivityDetail> {
  const parsed = formationCommandSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '成局或人工核实请求格式不正确');
  const input = parsed.data, scope = `formation:${activityId}`;
  const fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    // A former manager cannot regain write authority with an old replay key.
    checkManager(activity.currentManagerId, actorId);
    if (await replay(tx, actorId, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt);
    checkRevision(activity.revision, input.expected_revision);
    // Sample after the parent lock, not before a possibly long lock wait.
    const now = new Date();
    const main = checkFormationTarget(activity, input, now);
    let confirmation: { confirmedAt: Date | null; confirmedMainRevision: number | null; confirmedPlanRevision: number | null } | undefined;
    if (input.action === 'set-verification') {
      const status = input.verified ? 'manual_checked' : 'unknown';
      // Re-checking a previously revoked/unknown arrangement never resurrects an old confirmation.
      // Repeating an unchanged true marker also must not manufacture a confirmation.
      if (!input.verified || main.verificationStatus !== status) confirmation = { confirmedAt: null, confirmedMainRevision: null, confirmedPlanRevision: null };
      await tx.segment.update({ where: { id: main.id }, data: { verificationStatus: status } });
    } else {
      checkFormationReady(main);
      confirmation = { confirmedAt: now, confirmedMainRevision: activity.mainRevision, confirmedPlanRevision: main.planRevision };
    }
    const updated = await tx.activity.update({ where: { id: activityId }, data: { revision: { increment: 1 }, ...confirmation } });
    await tx.activityEvent.create({ data: {
      activityId, actorUserId: actorId, revision: updated.revision,
      type: input.action === 'set-verification' ? 'main_verification_changed' : 'formation_confirmed',
      detail: { segment_id: main.id, plan_revision: main.planRevision, main_revision: activity.mainRevision,
        ...(input.action === 'set-verification' ? { verified: input.verified, source: 'manager_manual_declaration' } : { confirmed: true }) }
    } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}
