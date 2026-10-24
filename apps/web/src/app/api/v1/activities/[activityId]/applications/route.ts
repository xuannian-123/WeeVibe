import { applyToActivityInputSchema } from '@weego/contracts';
import { handle } from '../../../../../../server/http';
import { applyToActivity } from '../../../../../../server/activities/service';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId } = await context.params;
    return applyToActivity(parseActivityId(activityId), actor, await parseBody(request, applyToActivityInputSchema));
  });
}
