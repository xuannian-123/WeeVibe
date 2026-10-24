import { handle } from '../../../../../server/http';
import { getActivity } from '../../../../../server/activities/service';
import { optionalActor, parseActivityId } from '../../../../../server/activities/transport';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const { activityId } = await context.params;
    const id = parseActivityId(activityId);
    return getActivity(id, await optionalActor(request));
  });
}
