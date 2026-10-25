import { loginRequestSchema } from '@weego/contracts';
import { identityService } from '../../../../../server/auth';
import { handle, readJson, ServiceError } from '../../../../../server/http';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return handle(async () => {
    const input = loginRequestSchema.safeParse(await readJson(request));
    if (!input.success) throw new ServiceError('INVALID_INPUT', 400, '只允许提交微信临时登录凭证');
    return identityService.login(input.data.code);
  }, request);
}
