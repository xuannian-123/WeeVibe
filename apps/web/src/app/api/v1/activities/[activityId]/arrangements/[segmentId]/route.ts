import { reacceptArrangementCommandSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../../server/http';
import { getArrangementReview, reacceptArrangement } from '../../../../../../../server/activities/arrangement';
import { parseActivityId, parseBody, requireActor } from '../../../../../../../server/activities/transport';
export const runtime = 'nodejs';
type Context = { params: Promise<{ activityId: string; segmentId: string }> };
export function GET(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId, segmentId } = await context.params;
    return getArrangementReview(parseActivityId(activityId), parseActivityId(segmentId), actor);
  }, request);
}
export function POST(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId, segmentId } = await context.params;
    return reacceptArrangement(parseActivityId(activityId), parseActivityId(segmentId), actor, await parseBody(request, reacceptArrangementCommandSchema));
  }, request);
}
