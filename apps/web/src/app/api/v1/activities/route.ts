import { createActivityInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../server/http';
import { createActivity } from '../../../../server/activities/service';
import { parseBody, requireActor } from '../../../../server/activities/transport';
import {assertGatheringProfileActor} from '../../../../server/gatherings/profile';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    const input=await parseBody(request, createActivityInputSchema);
    await assertGatheringProfileActor(actor);
    return createActivity(actor,input);
  }, request);
}
