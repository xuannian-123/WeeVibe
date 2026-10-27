import { createHandoverInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../server/http';
import { createHandover, getHandovers } from '../../../../../../server/activities/handover';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
export const runtime='nodejs';
type Context={params:Promise<{activityId:string}>};
export function GET(request:Request,context:Context){return handle(async()=>{const actor=await requireActor(request);const{activityId}=await context.params;return getHandovers(parseActivityId(activityId),actor);},request);}
export function POST(request:Request,context:Context){return handle(async()=>{const actor=await requireActor(request);const{activityId}=await context.params;return createHandover(parseActivityId(activityId),actor,await parseBody(request,createHandoverInputSchema));},request);}
