import { handle } from '../../../../../../server/http';
import { getApplicationAttributions } from '../../../../../../server/activities/application-attributions';
import { parseActivityId, requireActor } from '../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const activityId = parseActivityId((await context.params).activityId);
    const actorId = await requireActor(request);
    return getApplicationAttributions(activityId, actorId);
  }, request);
}
