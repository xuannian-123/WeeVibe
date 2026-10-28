import { handle,readJson,ServiceError } from '../../../../../../server/http';
import { requireActor,parseActivityId } from '../../../../../../server/activities/transport';
import { generateGatheringItinerary } from '../../../../../../server/gatherings/generation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export function POST(request:Request,context:Context){return handle(async()=>generateGatheringItinerary(parseActivityId((await context.params).id),await requireActor(request),await readJson(request,4096)),request);}
