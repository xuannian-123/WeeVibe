import { saveInvitationSchema } from '@weevibe/contracts/src/invitations';
import { handle } from '../../../../../server/http';
import { getInvitationSource, saveReceivedInvitation } from '../../../../../server/activities/invitations';
import { parseActivityId, parseBody, requireActor } from '../../../../../server/activities/transport';
export const runtime='nodejs';
export function GET(request:Request,context:{params:Promise<{invitationId:string}>}){return handle(async()=>{const{invitationId}=await context.params;return getInvitationSource(parseActivityId(invitationId));},request);}
export function POST(request:Request,context:{params:Promise<{invitationId:string}>}){return handle(async()=>{const actor=await requireActor(request);const{invitationId}=await context.params;const input=await parseBody(request,saveInvitationSchema);return saveReceivedInvitation(parseActivityId(invitationId),input.activity_id,actor);},request);}
