import { handle } from '../../../../../../../server/http';
import { parseActivityId, requireActor } from '../../../../../../../server/activities/transport';
import { memberProfile } from '../../../../../../../server/member-profile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ activityId: string; userId: string }> }) {
  return handle(async () => { const p = await context.params; return memberProfile(parseActivityId(p.activityId), parseActivityId(p.userId), await requireActor(request)); }, request);
}
