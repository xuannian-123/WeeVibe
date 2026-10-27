import { handle } from '../../../../../../server/http';
import { getActivityRoster } from '../../../../../../server/activities/roster';
import { optionalActor, parseActivityId } from '../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const id = parseActivityId((await context.params).activityId);
    // Public signup roster follows public detail authentication: an invalid
    // supplied bearer is an error, never a silent downgrade to anonymous.
    await optionalActor(request);
    return getActivityRoster(id);
  }, request);
}
