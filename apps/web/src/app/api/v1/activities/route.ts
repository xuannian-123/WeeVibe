import { createActivityInputSchema } from '@weego/contracts';
import { handle } from '../../../../server/http';
import { createActivity } from '../../../../server/activities/service';
import { parseBody, requireActor } from '../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    return createActivity(actor, await parseBody(request, createActivityInputSchema));
  });
}
