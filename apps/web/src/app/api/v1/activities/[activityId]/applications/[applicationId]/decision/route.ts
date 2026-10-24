import { decideApplicationInputSchema } from '@weego/contracts';
import { handle } from '../../../../../../../../server/http';
import { decideApplication } from '../../../../../../../../server/activities/service';
import { parseActivityId, parseBody, requireActor } from '../../../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string; applicationId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId, applicationId } = await context.params;
    return decideApplication(parseActivityId(activityId), parseActivityId(applicationId), actor, await parseBody(request, decideApplicationInputSchema));
  });
}
