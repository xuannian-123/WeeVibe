import { describe, expect, it, vi } from 'vitest';
import { readJson } from '../apps/web/src/server/http';

const request = (body: string, headers: Record<string, string> = {}) => new Request('http://local.test', { method: 'POST', headers, body });
describe('bounded JSON reads', () => {
  it('counts UTF-8 bytes even without Content-Length', async () => {
    const raw = JSON.stringify({ value: '中文' });
    expect(await readJson(request(raw), Buffer.byteLength(raw))).toEqual({ value: '中文' });
    await expect(readJson(request(raw), raw.length)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
  });
  it('cancels an oversized streamed body without waiting for its end', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel });
    const streamed = new Request('http://local.test', { method: 'POST', body, duplex: 'half' } as RequestInit);
    await expect(readJson(streamed)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects an oversized declared body before reading', async () => {
    const body = request('{}', { 'content-length': '5000' });
    await expect(readJson(body)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(body.bodyUsed).toBe(false);
  });
  it('allows an explicitly larger business payload while keeping auth default small', async () => {
    const raw = JSON.stringify({ requirements: '要求'.repeat(1000) });
    await expect(readJson(request(raw))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await readJson(request(raw), 65_536)).toEqual(JSON.parse(raw));
  });
  it('rejects malformed or absent JSON without exposing body text', async () => {
    for (const raw of ['{private-test-data', '']) {
      await expect(readJson(request(raw))).rejects.toMatchObject({ code: 'INVALID_INPUT', message: '请求格式不正确' });
    }
  });
});
