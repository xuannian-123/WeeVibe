import {identityService} from '../../../../server/auth';
import {handle,readJson} from '../../../../server/http';
import {readMemory,changeMemory} from '../../../../server/gatherings/memory';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handle(async()=>{const user=await identityService.authenticate(request.headers.get('authorization'));return readMemory(user.user_id);},request);}
export function POST(request:Request){return handle(async()=>{const user=await identityService.authenticate(request.headers.get('authorization'));return changeMemory(user.user_id,await readJson(request,8192));},request);}
