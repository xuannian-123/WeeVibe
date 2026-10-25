import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { ErrorCode } from '@weego/contracts';
import { CLOUD_HTTP_ENVELOPE_HEADER, CLOUD_HTTP_ENVELOPE_VERSION } from '@weego/contracts';
export class ServiceError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status: number, message: string) { super(message); }
}
export function ok(body: unknown, status = 200, request?: Request) {
  if (request?.headers.get(CLOUD_HTTP_ENVELOPE_HEADER) === CLOUD_HTTP_ENVELOPE_VERSION) {
    return NextResponse.json({ transport: 'weego.http.v1', status, body }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function handle(action: () => Promise<unknown>, request?: Request) {
  try { return ok(await action(), 200, request); }
  catch (error) {
    const known = error instanceof ServiceError;
    return ok({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务暂时不可用，请稍后重试' }, request_id: randomUUID() }, known ? error.status : 500, request);
  }
}
export async function readText(request: Request, maxBytes = 4096) {
  // Codes/tokens and provider error bodies must never be logged.
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65_536) throw new RangeError('Invalid JSON byte limit');
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new ServiceError('INVALID_INPUT', 400, '请求过大');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new ServiceError('INVALID_INPUT', 400, '请求过大');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new ServiceError('INVALID_INPUT', 400, '请求格式不正确'); }
}
export async function readJson(request: Request, maxBytes = 4096) {
  const text = await readText(request, maxBytes);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ServiceError('INVALID_INPUT', 400, '请求格式不正确'); }
}
