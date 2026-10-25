import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';

const host = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], dependencies: [] as unknown[][],
  stateIndex: 0, refIndex: 0, effectIndex: 0, effects: [] as (() => void)[],
  storage: new Map<string, unknown>(), show: () => {}, hide: () => {}, unload: () => {}
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
  useEffect(effect: () => void, dependencies: unknown[]) {
    const index = host.effectIndex++, previous = host.dependencies[index];
    if (!previous || dependencies.some((value, i) => value !== previous[i])) host.effects.push(effect);
    host.dependencies[index] = dependencies;
  }
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js', () => ({
  default: {
    getStorageSync: (key: string) => host.storage.get(key),
    setStorageSync: (key: string, value: unknown) => host.storage.set(key, value),
    removeStorageSync: (key: string) => host.storage.delete(key)
  },
  useDidShow: (callback: () => void) => { host.show = callback; },
  useDidHide: (callback: () => void) => { host.hide = callback; },
  useUnload: (callback: () => void) => { host.unload = callback; }
}));
vi.mock('../apps/miniprogram/src/platform/page-state', async () => ({
  errorText: () => 'fixture error', uncertain: (await import('../apps/miniprogram/src/platform/write-policy')).uncertain
}));
import { useStoredWrite } from '../apps/miniprogram/src/platform/write-state';

const original = { idempotency_key: 'original-key', starts_at: '2020-01-01T00:00:00Z' };
const execute = vi.fn<(input: typeof original) => Promise<string>>(), committed = vi.fn();
function reopen() { host.states = []; host.refs = []; host.dependencies = []; host.effects = []; }
function render(userId = 'actor-A') {
  host.stateIndex = 0; host.refIndex = 0; host.effectIndex = 0;
  const write = useStoredWrite({ storageKey: 'pending:' + userId, userId, parse: input => input as typeof original, execute, committed });
  const effects = host.effects.splice(0); effects.forEach(effect => effect());
  return write;
}
beforeEach(() => { reopen(); host.storage.clear(); execute.mockReset(); committed.mockReset(); });

describe('reopening an uncertain write', () => {
  it('retries the original request, then unlocks only after a definite business rejection', async () => {
    execute.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR', 'fixture', 0));
    await render().send(original);
    expect(render().pending?.input).toEqual(original);
    reopen(); render();
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockRejectedValueOnce(new ApiClientError('SEGMENT_APPLICATION_CLOSED', 'fixture', 409));
    await render().send();
    expect(execute.mock.calls[1][0]).toEqual(original);
    expect(render()).toMatchObject({ pending: undefined, blocked: false });
    expect(host.storage.has('pending:actor-A')).toBe(false);
    expect(committed).not.toHaveBeenCalled();
  });
  it('can recover a committed result even when the original start date is past', async () => {
    execute.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR', 'fixture', 0));
    await render().send(original);
    reopen(); render();
    execute.mockResolvedValueOnce('existing-activity');
    await render().send();
    expect(execute.mock.calls[1][0]).toEqual(original);
    expect(committed).toHaveBeenCalledExactlyOnceWith('existing-activity');
    expect(host.storage.size).toBe(0);
  });
  it('retains the original request for unavailable services and isolates another actor', async () => {
    execute.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR', 'fixture', 0));
    await render().send(original);
    reopen(); render();
    execute.mockRejectedValueOnce(new ApiClientError('DATABASE_UNAVAILABLE', 'fixture', 503));
    await render().send();
    expect(render().pending?.input).toEqual(original);
    reopen(); render('actor-B');
    expect(render('actor-B').pending).toBeUndefined();
    expect(host.storage.has('pending:actor-A')).toBe(true);
  });
});
