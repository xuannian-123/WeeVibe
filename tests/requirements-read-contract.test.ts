/// <reference path="../apps/miniprogram/src/assets.d.ts" />
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireMini = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = requireMini('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ request: vi.fn(), activity: vi.fn(), show: undefined as undefined | (() => void) }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => 'session-a', api: { getActivity: mocks.activity } }));
vi.mock('../apps/miniprogram/src/platform/extension-api', () => ({ extensionRequest: mocks.request }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: {}, useDidShow: (fn: () => void) => { mocks.show = fn; }, useRouter: () => ({ params: { activity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }), useShareAppMessage: () => {}, useUnload: () => {} }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({ Button: (p: Record<string, unknown>) => createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children as never), Text: (p: Record<string, unknown>) => createElement('span', {}, p.children as never), View: (p: Record<string, unknown>) => createElement('div', {}, p.children as never), Canvas: () => null }));
vi.mock('../apps/miniprogram/src/features/requirements/share-image', () => ({ useRequirementShareImage: () => '', REQUIREMENT_SHARE_CANVAS: 'test-canvas' }));
vi.mock('../apps/miniprogram/src/features/requirements/collection-editor', () => ({ CollectionEditor: () => null }));
vi.mock('../apps/miniprogram/src/features/requirements/response-form', () => ({ ResponseForm: () => null }));
vi.mock('../apps/miniprogram/src/features/requirements/manager-panel', () => ({ ManagerPanel: () => null }));
import RequirementsPage from '../apps/miniprogram/src/features/requirements';
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; mocks.request.mockReset(); mocks.activity.mockReset(); });
async function load() { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(createElement(RequirementsPage))); await act(async () => { mocks.show!(); await Promise.resolve(); }); return host; }
describe('requirement read failures are not an absent collection', () => {
  it('rejects malformed success before opening the editor or asserting no collection exists', async () => {
    mocks.request.mockResolvedValueOnce({ ok: true, secret: 'PRIVATE_SENTINEL' }); const host = await load();
    expect(mocks.activity).not.toHaveBeenCalled(); expect(host.textContent).toContain('响应与当前版本不匹配');
    expect(host.textContent).not.toContain('这场活动尚未开放需求收集'); expect(host.textContent).not.toContain('PRIVATE_SENTINEL');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '刷新状态' && !button.disabled)).toBe(true);
  });
  it('still shows absence only after a valid explicit absence response and activity lookup', async () => {
    mocks.request.mockResolvedValueOnce({ collection: null }); mocks.activity.mockResolvedValueOnce({ viewer: { is_manager: false } }); const host = await load();
    expect(mocks.activity).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('这场活动尚未开放需求收集');
  });
});
