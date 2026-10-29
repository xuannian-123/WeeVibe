import { handle, readJson, ServiceError } from '../../../../../server/http';
import { requireActor, parseActivityId } from '../../../../../server/activities/transport';
import { getRequirement, commandRequirement } from '../../../../../server/requirements/service';
import { requirementCommandSchema } from '@weevibe/contracts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ collectionId: string }> };
export function GET(request: Request, context: Context) {
  return handle(async () => { const actor = await requireActor(request); return getRequirement(parseActivityId((await context.params).collectionId), actor); }, request);
}
export function POST(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request);
    const id = parseActivityId((await context.params).collectionId);
    const input = requirementCommandSchema.safeParse(await readJson(request, 65536));
    if (!input.success) throw new ServiceError('INVALID_INPUT', 400, '需求操作格式无效');

    return commandRequirement(id, actor, input.data);
  }, request);
}
