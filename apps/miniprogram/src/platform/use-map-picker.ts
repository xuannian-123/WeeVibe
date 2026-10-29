import { useEffect, useRef } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import type { Gcj02 } from '@weevibe/contracts';
import { getToken } from './api';
import { chooseMapPlace } from './map-picker';

export const staleMapPicker = () => new ApiClientError('MAP_PICKER_STALE', '原填写页面已变化，请重新选择地点', 0);

/** Only this native interaction may survive one hide/show; ordinary requests do not. */
export function useMapPicker(disabled: boolean, session?: string) {
  const latest = useRef({ disabled, session }); latest.current = { disabled, session };
  const state = useRef({ mounted: true, visible: true, epoch: 0, opening: false, hides: 0 });
  const wake = useRef<(() => void) | undefined>();
  const invalidate = () => { state.current.epoch++; wake.current?.(); wake.current = undefined; };
  useEffect(() => { state.current.mounted = true; return () => { state.current.mounted = false; invalidate(); }; }, []);
  useEffect(invalidate, [disabled, session]);
  useDidHide(() => {
    const s = state.current; s.visible = false;
    if (s.opening && s.hides++ === 0) return;
    invalidate();
  });
  useDidShow(() => { state.current.visible = true; wake.current?.(); wake.current = undefined; });
  useUnload(() => { state.current.mounted = false; invalidate(); });

  return async (center?: Gcj02) => {
    const s = state.current;
    if (latest.current.disabled || !s.mounted || !s.visible) throw staleMapPicker();
    if (s.opening) throw new ApiClientError('MAP_PICKER_BUSY', '地图选择已打开，请先完成当前选择', 0);
    const token = getToken(), expectedSession = latest.current.session;
    const owner = Taro.getCurrentPages().at(-1), epoch = s.epoch;
    const guard = () => {
      if (!s.mounted || s.epoch !== epoch || latest.current.disabled || latest.current.session !== expectedSession ||
          getToken() !== token || expectedSession !== undefined && token !== expectedSession ||
          !owner || Taro.getCurrentPages().at(-1) !== owner) throw staleMapPicker();
    };
    guard(); s.opening = true; s.hides = 0;
    try {
      const result = await chooseMapPlace({ guard, center });
      guard();
      // Native success can precede onShow. Wait without applying to a hidden form.
      if (!s.visible) await new Promise<void>(resolve => { wake.current = resolve; });
      guard();
      if (!s.visible) throw staleMapPicker();
      return result;
    } finally { s.opening = false; }
  };
}
