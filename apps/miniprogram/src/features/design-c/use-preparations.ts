import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import type { GatheringSummary } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { gatheringMessage, readGatheringList } from '../gatherings/client';

/** Existing authenticated read flow, separated from the replaced dashboard UI. */
export function useCPreparations(session: string | undefined, enabled: boolean) {
  const [stored, setStored] = useState<{ session: string; records: GatheringSummary[] }>();
  const [state, setState] = useState<{ session: string; busy: boolean; error: string }>();
  const mounted = useRef(true), visible = useRef(true), sequence = useRef(0), locked = useRef(false);
  const source = useRef({ session, enabled }); source.current = { session, enabled };
  const current = () => enabled && source.current.enabled && source.current.session === session && mounted.current && visible.current && !!session && getToken() === session;
  async function refresh() {
    if (!current() || !session || locked.current) return;
    const ticket = ++sequence.current;
    locked.current = true;
    setState({ session, busy: true, error: '' });
    const guard = () => { if (!current() || ticket !== sequence.current) throw Error('STALE_GATHERING'); };
    try {
      const value = await readGatheringList(session, guard);
      guard();
      setStored({ session, records: value.gatherings });
      setState({ session, busy: false, error: '' });
    } catch (e) {
      if (current() && ticket === sequence.current) setState({ session, busy: false, error: gatheringMessage(e) });
    } finally {
      if (ticket === sequence.current) locked.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true; locked.current = false; void refresh();
    return () => { mounted.current = false; sequence.current++; locked.current = false; };
  }, [session, enabled]);
  const hide = () => { visible.current = false; sequence.current++; locked.current = false; };
  useDidHide(hide); useUnload(hide); useDidShow(() => { visible.current = true; void refresh(); });
  const valid = !!session && session === getToken();
  return {
    records: valid && stored?.session === session ? stored.records : [],
    busy: valid && state?.session === session ? state.busy : false,
    error: valid && state?.session === session ? state.error : '',
    refresh,
  };
}
