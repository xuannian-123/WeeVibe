import { changeMainSegmentInputSchema } from '@weevibe/contracts';
import { handle } from '../../../../../../server/http';
import { requireActor,parseActivityId,parseBody } from '../../../../../../server/activities/transport';
import { changeMainSegment } from '../../../../../../server/activities/main-segment';
export const runtime='nodejs';
export function POST(request:Request,context:{params:Promise<{activityId:string}>}){return handle(async()=>{
 const actor=await requireActor(request),{activityId}=await context.params;
 return changeMainSegment(parseActivityId(activityId),actor,await parseBody(request,changeMainSegmentInputSchema));
},request);}
