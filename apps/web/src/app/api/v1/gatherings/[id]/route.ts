import { handle,readJson,ServiceError } from '../../../../../server/http';
import { requireActor,parseActivityId } from '../../../../../server/activities/transport';
import { getGathering } from '../../../../../server/gatherings/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export function GET(request:Request,context:Context){return handle(async()=>getGathering(parseActivityId((await context.params).id),await requireActor(request)),request);}
