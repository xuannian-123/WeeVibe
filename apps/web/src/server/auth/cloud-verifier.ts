import { CloudProofError, LOGIN_PATH, MAX_PROOF_BYTES, readVerifierConfig, verifySignedProof } from '../../../../../cloudfunctions/weegoLogin/proof.cjs';
import { readText, ServiceError } from '../http';

export async function verifyCloudLoginRequest(request: Request) {
  // This is a signed server-to-server endpoint, never a trust switch for x-wx-*.
  try {
    const config = readVerifierConfig(process.env);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== LOGIN_PATH || url.search ||
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ServiceError('UNAUTHENTICATED', 401, '云身份凭证无法验证');
    }
    const body = await readText(request, MAX_PROOF_BYTES);
    return verifySignedProof(body, request.headers.get('x-weego-cloud-signature') ?? '', config);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof CloudProofError && error.kind === 'configuration') {
      throw new ServiceError('NOT_CONFIGURED', 503, '尚未配置微信云身份接入');
    }
    throw new ServiceError('UNAUTHENTICATED', 401, '云身份凭证无法验证');
  }
}
