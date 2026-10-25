import { issueCloudSession } from '../../../../../server/auth/cloud-store';
import { verifyCloudLoginRequest } from '../../../../../server/auth/cloud-verifier';
import { handle } from '../../../../../server/http';

export const runtime = 'nodejs';
export function POST(request: Request) {
  return handle(async () => {
    const { identity, proof } = await verifyCloudLoginRequest(request);
    return issueCloudSession(identity, proof);
  }, request);
}
