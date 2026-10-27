import { handle, readJson } from '../../../../../../server/http';
import { requireActor, parseActivityId } from '../../../../../../server/activities/transport';
import { coordinationBoundary } from '../../../../../../server/ai/coordination';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ collectionId: string }> };
export function GET(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request);
    return coordinationBoundary.prepare(parseActivityId((await context.params).collectionId), actor);
  }, request);
}
export function POST(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor(request);
    return coordinationBoundary.generate(parseActivityId((await context.params).collectionId), actor, await readJson(request, 4096));
  }, request);
}
