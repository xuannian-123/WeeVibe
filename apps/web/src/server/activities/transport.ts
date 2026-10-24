import { activityIdSchema } from '@weego/contracts';
import { ACTIVITY_JSON_MAX_BYTES } from '@weego/contracts/src/limits';
import { identityService } from '../auth';
import { readJson, ServiceError } from '../http';

export async function requireActor(request: Request) {
  return (await identityService.authenticate(request.headers.get('authorization'))).user_id;
}
export async function optionalActor(request: Request) {
  return request.headers.has('authorization') ? requireActor(request) : null;
}
export function parseActivityId(value: string) {
  const parsed = activityIdSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '活动或申请标识无效');
  return parsed.data;
}
export async function parseBody<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  const parsed = schema.safeParse(await readJson(request, ACTIVITY_JSON_MAX_BYTES));
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '提交内容不完整或格式不正确，请检查各环节安排');
  return parsed.data;
}
