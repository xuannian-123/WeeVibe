import { identityService } from '../../../../../server/auth';
import { getAvatar, putAvatar } from '../../../../../server/avatar';
import { handle, readJson } from '../../../../../server/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request) {return handle(async()=>{const user=await identityService.authenticate(request.headers.get('authorization'));return getAvatar(user.user_id);},request);}
export function POST(request:Request) {return handle(async()=>{const user=await identityService.authenticate(request.headers.get('authorization'));return putAvatar(user.user_id,await readJson(request,60000));},request);}
