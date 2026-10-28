import { handle,readJson,ServiceError } from '../../../../../../server/http';
import { requireActor,parseActivityId } from '../../../../../../server/activities/transport';
import { updateGatheringDetails } from '../../../../../../server/gatherings/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export function POST(request:Request,context:Context){return handle(async()=>updateGatheringDetails(parseActivityId((await context.params).id),await requireActor(request),await readJson(request,65536)),request);}
