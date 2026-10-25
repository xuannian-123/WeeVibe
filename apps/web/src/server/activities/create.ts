import { randomUUID } from 'node:crypto';
import type { CreateActivityInput } from '@weevibe/contracts';
import { mutation } from './mutation';
import { replay, remember } from './idempotency';
import { activitySnapshot } from './snapshot';
import { checkJoinOpen, requestFingerprint } from './rules';

export function createActivity(actorId: string, input: CreateActivityInput) {
  const scope = 'create';
  const fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const previous = await replay(tx, actorId, input.idempotency_key, scope, fingerprint);
    if (previous) return activitySnapshot(tx, previous.activityId, actorId);
    const now = new Date();
    // Management never implicitly joins. Explicit self-selection follows the
    // same open/started boundaries as any seat acquisition.
    for (const s of input.segments.filter(s => input.participating_segment_refs.includes(s.client_ref))) {
      checkJoinOpen({ startsAt: new Date(s.starts_at), deadlineAt: new Date(s.deadline_at), cancelledAt: null }, now);
    }
    const activityId = randomUUID();
    const refs = new Map(input.segments.map(s => [s.client_ref, randomUUID()]));
    await tx.activity.create({ data: { id: activityId, name: input.name, timezone: input.timezone, currentManagerId: actorId } });
    await tx.segment.createMany({ data: input.segments.map((s, position) => ({
      id: refs.get(s.client_ref)!, activityId, clientRef: s.client_ref, position, type: s.type, name: s.name,
      startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), deadlineAt: new Date(s.deadline_at),
      minimumParticipants: s.minimum_participants, capacity: s.capacity, location: s.location, fee: s.fee, requirements: s.requirements
    })) });
    await tx.activity.update({ where: { id: activityId }, data: { mainSegmentId: refs.get(input.main_segment_ref)! } });
    if (input.participating_segment_refs.length) {
      await tx.participation.createMany({ data: input.participating_segment_refs.map(ref => ({
        activityId, segmentId: refs.get(ref)!, userId: actorId, acceptedPlanRevision: 1, acceptedAt: now, displayName: input.display_name ?? null
      })) });
    }
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: 'activity_created', revision: 1, detail: { segment_ids: [...refs.values()] } } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}
