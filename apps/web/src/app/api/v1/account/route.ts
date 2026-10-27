import { identityService } from '../../../../server/auth';
import { accountSnapshot, updateAccount } from '../../../../server/account';
import { handle, readJson } from '../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => { const user = await identityService.authenticate(request.headers.get('authorization')); return accountSnapshot(user.user_id); }, request);
}
export function PATCH(request: Request) {
  return handle(async () => { const user = await identityService.authenticate(request.headers.get('authorization')); return updateAccount(user.user_id, await readJson(request, 65536)); }, request);
}

// POST alias is required by the existing signed cloud HTTP transport.
export const POST = PATCH;
