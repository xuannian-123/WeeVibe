import { handle } from '../../../../../../server/http';
import { parseActivityId, requireActor } from '../../../../../../server/activities/transport';
import { memberDirectory } from '../../../../../../server/member-profile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return handle(async () => memberDirectory(parseActivityId((await context.params).activityId), await requireActor(request)), request);
}
