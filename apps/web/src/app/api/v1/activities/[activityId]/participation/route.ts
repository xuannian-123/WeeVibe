import { participationActionSchema } from '@weevibe/contracts/src/participation-actions';
import { handle } from '../../../../../../server/http';
import { changeParticipation } from '../../../../../../server/activities/participation';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId } = await context.params;
    return changeParticipation(parseActivityId(activityId), actor, await parseBody(request, participationActionSchema));
  }, request);
}
