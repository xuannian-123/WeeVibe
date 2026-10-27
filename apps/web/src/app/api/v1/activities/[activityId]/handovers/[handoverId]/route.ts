import { handoverCommandSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../../server/http';
import { commandHandover, getHandovers } from '../../../../../../../server/activities/handover';
import { parseActivityId, parseBody, requireActor } from '../../../../../../../server/activities/transport';
export const runtime='nodejs';
type Context={params:Promise<{activityId:string;handoverId:string}>};
export function GET(request:Request,context:Context){return handle(async()=>{const actor=await requireActor(request);const{activityId,handoverId}=await context.params;return getHandovers(parseActivityId(activityId),actor,parseActivityId(handoverId));},request);}
export function POST(request:Request,context:Context){return handle(async()=>{const actor=await requireActor(request);const{activityId,handoverId}=await context.params;return commandHandover(parseActivityId(activityId),parseActivityId(handoverId),actor,await parseBody(request,handoverCommandSchema));},request);}
