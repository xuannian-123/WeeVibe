import { identityService } from '../../../../../server/auth';
import { cityProvider } from '../../../../../server/providers/city';
import { handle, readJson } from '../../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handle(async () => { const actor = await identityService.authenticate(request.headers.get('authorization')); return cityProvider(actor.user_id, await readJson(request)); }, request); }
