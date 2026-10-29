import { createActivityInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../server/http';
import { createActivity } from '../../../../server/activities/service';
import { parseBody, requireActor } from '../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    const input=await parseBody(request, createActivityInputSchema);
    return createActivity(actor,input);
  }, request);
}
