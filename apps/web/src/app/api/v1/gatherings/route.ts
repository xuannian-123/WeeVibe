import { handle,readJson,ServiceError } from '../../../../server/http';
import { requireActor,parseActivityId } from '../../../../server/activities/transport';
import { listGatherings,createGathering } from '../../../../server/gatherings/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handle(async()=>listGatherings(await requireActor(request)),request);}
export function POST(request:Request){return handle(async()=>createGathering(await requireActor(request),await readJson(request,65536)),request);}
