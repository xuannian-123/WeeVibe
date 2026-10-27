import { cancelActivityInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../server/http';
import { cancelActivity } from '../../../../../../server/activities/cancellation';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';

export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId } = await context.params;
    return cancelActivity(parseActivityId(activityId), actor, await parseBody(request, cancelActivityInputSchema));
  }, request);
}
