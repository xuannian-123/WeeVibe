import { extendDeadlineInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../../../server/http';
import { requireActor, parseActivityId, parseBody } from '../../../../../../../../server/activities/transport';
import { extendDeadline } from '../../../../../../../../server/activities/deadline';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string; segmentId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request), { activityId, segmentId } = await context.params;
    return extendDeadline(parseActivityId(activityId), parseActivityId(segmentId), actor, await parseBody(request, extendDeadlineInputSchema));
  }, request);
}
