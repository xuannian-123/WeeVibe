import { withdrawApplicationInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../../../server/http';
import { withdrawApplication } from '../../../../../../../../server/activities/withdrawal';
import { parseActivityId, parseBody, requireActor } from '../../../../../../../../server/activities/transport';

export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string; applicationId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId, applicationId } = await context.params;
    return withdrawApplication(parseActivityId(activityId), parseActivityId(applicationId), actor, await parseBody(request, withdrawApplicationInputSchema));
  }, request);
}
