import { handle, readJson } from '../../../../../../server/http';
import { requireActor, parseActivityId } from '../../../../../../server/activities/transport';
import { publishGatheringArrangement } from '../../../../../../server/gatherings/publication';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export function POST(request:Request,context:{params:Promise<{id:string}>}){return handle(async()=>publishGatheringArrangement(parseActivityId((await context.params).id),await requireActor(request),await readJson(request,8192)),request);}
