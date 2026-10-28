import { editArrangementInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../server/http';
import { editArrangement, previewArrangementEdit } from '../../../../../../server/activities/arrangement-edit';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request), { activityId } = await context.params;
    const input = await parseBody(request, editArrangementInputSchema), id = parseActivityId(activityId);
    return new URL(request.url).searchParams.get('preview') === '1' ? previewArrangementEdit(id, actor, input) : editArrangement(id, actor, input);
  }, request);
}
