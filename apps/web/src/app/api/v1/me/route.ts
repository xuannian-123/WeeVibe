import { identityService } from '../../../../server/auth';
import { handle } from '../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(() => identityService.authenticate(request.headers.get('authorization')), request);
}
