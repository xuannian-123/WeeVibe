import { formationCommandSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../server/http';
import { changeFormation } from '../../../../../../server/activities/formation';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { activityId } = await context.params;
    return changeFormation(parseActivityId(activityId), actor, await parseBody(request, formationCommandSchema));
  }, request);
}
