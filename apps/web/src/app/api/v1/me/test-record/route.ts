import { testRecordInputSchema } from '@weego/contracts';
import { identityService } from '../../../../../server/auth';
import { withDb } from '../../../../../server/db';
import { handle, readJson, ServiceError } from '../../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => {
    const user = await identityService.authenticate(request.headers.get('authorization'));
    const record = await withDb(db => db.userTestRecord.findUnique({ where: { userId: user.user_id } }));
    return { value: record?.value ?? null, updated_at: record?.updatedAt.toISOString() ?? null };
  }, request);
}
export function PUT(request: Request) {
  return handle(async () => {
    const user = await identityService.authenticate(request.headers.get('authorization'));
    const input = testRecordInputSchema.safeParse(await readJson(request));
    if (!input.success) throw new ServiceError('INVALID_INPUT', 400, '测试记录仅允许不超过200字的文本');
    const record = await withDb(db => db.userTestRecord.upsert({ where: { userId: user.user_id }, create: { userId: user.user_id, value: input.data.value }, update: { value: input.data.value } }));
    return { value: record.value, updated_at: record.updatedAt.toISOString() };
  }, request);
}
