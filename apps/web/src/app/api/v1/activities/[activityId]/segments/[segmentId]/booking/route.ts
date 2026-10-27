import { declareBookingInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../../../server/http';
import { requireActor, parseActivityId, parseBody } from '../../../../../../../../server/activities/transport';
import { declareBooking, readBookingHistory } from '../../../../../../../../server/activities/booking';
export const runtime = 'nodejs';
type Context = { params: Promise<{ activityId: string; segmentId: string }> };
export function GET(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request), { activityId, segmentId } = await context.params;
    return readBookingHistory(parseActivityId(activityId), parseActivityId(segmentId), actor);
  }, request);
}
export function POST(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request), { activityId, segmentId } = await context.params;
    return declareBooking(parseActivityId(activityId), parseActivityId(segmentId), actor, await parseBody(request, declareBookingInputSchema));
  }, request);
}
