import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';

// A small hook host lets fake timers drive the actual read hook and Taro lifecycle.
const host = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
  show: () => {}, hide: () => {}, unload: () => {}, forgetSession: vi.fn()
}));
vi.mock('../apps/miniprogram/node_modules/react/index.js', () => ({
  useState(initial: unknown) {
    const index = host.stateIndex++;
    if (index >= host.states.length) host.states.push(initial);
    return [host.states[index], (value: unknown) => { host.states[index] = value; }];
  },
  useRef(initial: unknown) {
    const index = host.refIndex++;
    if (index >= host.refs.length) host.refs.push({ current: initial });
    return host.refs[index];
  },
  useCallback: (callback: unknown) => callback
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js', () => ({
  default: {}, useDidShow: (callback: () => void) => { host.show = callback; },
  useDidHide: (callback: () => void) => { host.hide = callback; },
  useUnload: (callback: () => void) => { host.unload = callback; }
}));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ api: {}, establishSession: vi.fn(), getToken: vi.fn(), forgetSession: host.forgetSession }));
import { usePageRead } from '../apps/miniprogram/src/platform/page-state';

function render<T>(loader: () => Promise<T>, interval = 0, enabled = true) {
  host.stateIndex = 0; host.refIndex = 0;
  return usePageRead(loader, enabled, { pollIntervalMs: interval });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { vi.useFakeTimers(); host.states = []; host.refs = []; host.forgetSession.mockReset(); });
afterEach(() => { host.unload(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('page reads without intrusive refreshes', () => {
  it('reads home/editor on entry and explicit refresh without automatic requests', async () => {
    const loader = vi.fn(async () => 'ready');
    render(loader); host.show(); await flush();
    await vi.advanceTimersByTimeAsync(120000);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(render(loader).loading).toBe(false);
    await render(loader).refresh();
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('synchronizes activity data quietly while retaining the current screen', async () => {
    const next = deferred<string>();
    const loader = vi.fn<() => Promise<string>>().mockResolvedValueOnce('current').mockImplementationOnce(() => next.promise);
    render(loader, 20000); host.show(); await flush();
    await vi.advanceTimersByTimeAsync(19999);
    expect(loader).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(render(loader, 20000)).toMatchObject({ data: 'current', loading: false, error: '' });
    next.resolve('updated'); await flush();
    expect(render(loader, 20000)).toMatchObject({ data: 'updated', loading: false });
  });
  it('stops background requests when hidden and ignores responses after leaving', async () => {
    const next = deferred<string>();
    const loader = vi.fn<() => Promise<string>>().mockResolvedValueOnce('current').mockImplementationOnce(() => next.promise);
    render(loader, 20000); host.show(); await flush(); host.hide();
    await vi.advanceTimersByTimeAsync(60000);
    expect(loader).toHaveBeenCalledTimes(1);
    host.show(); host.unload(); next.resolve('late'); await flush();
    expect(render(loader, 20000).data).toBe('current');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never lets a slower earlier response replace a newer explicit read', async () => {
    const first = deferred<string>();
    const loader = vi.fn<() => Promise<string>>().mockImplementationOnce(() => first.promise).mockResolvedValueOnce('newest');
    render(loader); host.show();
    await render(loader).refresh(); first.resolve('old'); await flush();
    expect(render(loader)).toMatchObject({ data: 'newest', loading: false });
  });
  it('marks failed background data as stale and backs off without a loading flash', async () => {
    const loader = vi.fn<() => Promise<string>>().mockResolvedValueOnce('current').mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR', '', 0)).mockResolvedValue('recovered');
    render(loader, 20000); host.show(); await flush();
    await vi.advanceTimersByTimeAsync(20000);
    expect(render(loader, 20000)).toMatchObject({ data: 'current', loading: false });
    expect(render(loader, 20000).error).not.toBe('');
    await vi.advanceTimersByTimeAsync(39999);
    expect(loader).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(render(loader, 20000)).toMatchObject({ data: 'recovered', loading: false, error: '' });
  });
  it('stops automatic retries after an expired session until the user acts', async () => {
    const loader = vi.fn().mockRejectedValue(new ApiClientError('UNAUTHENTICATED', '', 401));
    render(loader, 20000); host.show(); await flush();
    await vi.advanceTimersByTimeAsync(120000);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(host.forgetSession).toHaveBeenCalledTimes(1);
    await render(loader, 20000).refresh();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
