import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js', () => ({ default: {}, useDidHide: vi.fn(), useDidShow: vi.fn(), useUnload: vi.fn() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ api: {}, establishSession: vi.fn(), forgetSession: vi.fn(), getToken: vi.fn() }));
import { errorText } from '../apps/miniprogram/src/platform/page-state';
import { unrecognizedResponseMessage } from '../apps/miniprogram/src/platform/response-error';
describe('recoverable configuration and unrecognized interface messages', () => {
  it.each([404, 405])('keeps HTTP %s actionable without claiming the write did or did not happen', status => {
    const message = errorText(new ApiClientError('INVALID_RESPONSE', 'PRIVATE_RAW_HTML_SENTINEL', status));
    expect(message).toBe(unrecognizedResponseMessage(status)); expect(message).toContain(`HTTP ${status}`); expect(message).toContain('接口部署'); expect(message).toContain('写入结果未确认');
    expect(message).not.toContain('PRIVATE_RAW_HTML_SENTINEL'); expect(message).not.toContain('本次未保存'); expect(message).not.toContain('已保存');
  });
  it('does not convert a valid business NOT_FOUND into a missing-interface diagnosis', () => {
    const message = errorText(new ApiClientError('NOT_FOUND', 'no activity', 404));
    expect(message).toContain('未找到活动'); expect(message).not.toContain('接口部署');
  });
  it('keeps explicit unconfigured and unauthenticated errors distinct', () => {
    expect(errorText(new ApiClientError('NOT_CONFIGURED', 'not configured', 503))).toContain('配置');
    expect(errorText(new ApiClientError('NOT_CONFIGURED', 'not configured', 503))).not.toContain('重新登录');
    expect(errorText(new ApiClientError('UNAUTHENTICATED', 'expired', 401))).toContain('重新登录');
  });
  it('never echoes raw malformed response bodies and keeps other invalid responses uncertain', () => {
    const message = errorText(new ApiClientError('INVALID_RESPONSE', 'SECRET_KEY_OR_PRIVATE_ANSWER', 500));
    expect(message).toContain('服务响应无法验证'); expect(message).not.toContain('SECRET_KEY_OR_PRIVATE_ANSWER'); expect(message).not.toContain('HTTP 404');
  });
});
