import { createInvitationSourceSchema } from '@weevibe/contracts/src/invitations';
import { handle } from '../../../../../../server/http';
import { createInvitationSource } from '../../../../../../server/activities/invitations';
import { parseActivityId, parseBody, requireActor } from '../../../../../../server/activities/transport';
export const runtime='nodejs';
export function POST(request:Request,context:{params:Promise<{activityId:string}>}){return handle(async()=>{const actor=await requireActor(request);const{activityId}=await context.params;await parseBody(request,createInvitationSourceSchema);return createInvitationSource(parseActivityId(activityId),actor);},request);}
