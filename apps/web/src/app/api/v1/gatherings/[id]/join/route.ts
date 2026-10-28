import { handle,readJson,ServiceError } from '../../../../../../server/http';
import { requireActor,parseActivityId } from '../../../../../../server/activities/transport';
import { joinGathering } from '../../../../../../server/gatherings/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export function POST(request:Request,context:Context){return handle(async()=>joinGathering(parseActivityId((await context.params).id),await requireActor(request)),request);}
