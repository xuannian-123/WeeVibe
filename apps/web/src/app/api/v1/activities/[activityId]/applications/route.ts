import { applyToActivityInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../server/http';
import { applyToActivity } from '../../../../../../server/activities/service';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
import {assertGatheringProfileActor} from '../../../../../../server/gatherings/profile';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId } = await context.params;
    const id=parseActivityId(activityId),input=await parseBody(request, applyToActivityInputSchema);
    await assertGatheringProfileActor(actor);
    return applyToActivity(id,actor,input);
  }, request);
}
