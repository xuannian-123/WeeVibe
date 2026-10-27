import { handle } from '../../../../../../server/http';
import { getRebookSource } from '../../../../../../server/activities/rebook';
import { parseActivityId, requireActor } from '../../../../../../server/activities/transport';
export const runtime='nodejs';
export function GET(request:Request,context:{params:Promise<{activityId:string}>}){
 return handle(async()=>{const actor=await requireActor(request);const{activityId}=await context.params;return getRebookSource(parseActivityId(activityId),actor);},request);
}
