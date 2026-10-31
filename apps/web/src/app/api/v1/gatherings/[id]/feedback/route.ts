import { handle, readJson } from '../../../../../../server/http';
import { requireActor, parseActivityId } from '../../../../../../server/activities/transport';
import { addGatheringFeedback } from '../../../../../../server/gatherings/publication';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseActivityId((await context.params).id);
    return addGatheringFeedback(id, await requireActor(request), await readJson(request, 8192));
  }, request);
}
