import { handle, readJson, ServiceError } from '../../../../server/http';
import { requireActor, parseActivityId } from '../../../../server/activities/transport';
import { createRequirement, getRequirementForActivity, listRequirements } from '../../../../server/requirements/service';
import { requirementCreateSchema } from '@weevibe/contracts';
import {assertGatheringProfileActor} from '../../../../server/gatherings/profile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== 'activity_id') || url.searchParams.getAll('activity_id').length > 1) throw new ServiceError('INVALID_INPUT', 400, '查询条件无效');
    const activityId = url.searchParams.get('activity_id');
    return activityId === null ? listRequirements(actor) : getRequirementForActivity(parseActivityId(activityId), actor);
  }, request);
}
export function POST(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    const input = requirementCreateSchema.safeParse(await readJson(request, 65536));
    if (!input.success) throw new ServiceError('INVALID_INPUT', 400, '需求草稿格式无效');
    await assertGatheringProfileActor(actor);
    return createRequirement(actor, input.data);
  }, request);
}
