import { handle,readJson,ServiceError } from '../../../../../../server/http';
import { requireActor,parseActivityId } from '../../../../../../server/activities/transport';
import { getGatheringMembers } from '../../../../../../server/gatherings/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export function GET(request:Request,context:Context){return handle(async()=>{const actor=await requireActor(request),id=parseActivityId((await context.params).id),cursor=new URL(request.url).searchParams.get('cursor');return getGatheringMembers(id,actor,cursor?parseActivityId(cursor):undefined);},request);}
