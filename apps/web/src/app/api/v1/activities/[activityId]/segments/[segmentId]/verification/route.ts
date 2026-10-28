import { verifySegmentInputSchema } from '@weevibe/contracts';
import { handle, ServiceError } from '../../../../../../../../server/http';
import { verifySegment } from '../../../../../../../../server/activities/verification';
import { parseActivityId, parseBody, requireActor } from '../../../../../../../../server/activities/transport';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ activityId: string; segmentId: string }> }) {
  return handle(async () => {
    const actor = await requireActor(request), params = await context.params, input = await parseBody(request, verifySegmentInputSchema);
    if (input.segment_id !== parseActivityId(params.segmentId)) throw new ServiceError('INVALID_INPUT', 400, '核实目标不一致');
    return verifySegment(parseActivityId(params.activityId), actor, input);
  }, request);
}
