import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import type { ActivityDetail } from '@weevibe/contracts';
import type { ApplicationAttributions } from '@weevibe/contracts/src/application-attributions';
import { getToken } from '../../platform/api';
import { attributionError, readApplicationAttributions } from './api';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type Input = { detail?: ActivityDetail; session?: string; fresh: boolean };
export function useApplicationAttributions({ detail, session, fresh }: Input) {
  const actor = detail?.viewer.user_id;
  const applications = detail?.viewer.is_manager ? detail.applications ?? [] : detail?.viewer.applications ?? [];
  // Wall-clock polling is not a new source. Never use a caller-created actor in place of the server snapshot.
  const source = JSON.stringify([session, detail?.activity_id, detail?.revision, actor, detail?.viewer.is_manager,
    applications.map(a => a.application_id).sort()]);
  const latest = useRef({ source, session, fresh, detail }); latest.current = { source, session, fresh, detail };
  const observed = useRef({ source, fresh }), epoch = useRef(0), generation = useRef(0);
  const operation = useRef<symbol>(), mounted = useRef(true), active = useRef(true);
  if (observed.current.source !== source) { generation.current++; epoch.current++; operation.current = undefined; }
  else if (observed.current.fresh !== fresh) { epoch.current++; operation.current = undefined; }
  observed.current = { source, fresh };
  const [wake, setWake] = useState(0);
  const [state, setState] = useState<{ source: string; generation: number; status: Status; data?: ApplicationAttributions; error: string }>({ source, generation: 0, status: 'idle', error: '' });
  const invalidate = () => { active.current = false; generation.current++; epoch.current++; operation.current = undefined; if (mounted.current) setState({ source: latest.current.source, generation: generation.current, status: 'idle', error: '' }); };
  useDidHide(invalidate); useUnload(invalidate); useDidShow(() => { active.current = true; if (mounted.current) setWake(n => n + 1); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; generation.current++; operation.current = undefined; }; }, []);
  const matching = state.source === source && state.generation === generation.current;
  const current = matching && active.current && !!actor && !!session && getToken() === session && fresh;
  const data = current ? state.data : undefined;
  const available = !!data && current && state.status === 'ready';
  async function refresh() {
    if (!detail || !actor || !session || getToken() !== session || !fresh || !latest.current.fresh || latest.current.source !== source || latest.current.session !== session || !active.current || !mounted.current || operation.current) return;
    const ticket = epoch.current, sourceGeneration = generation.current, op = Symbol('application-attribution'); operation.current = op;
    setState({ source, generation: sourceGeneration, status: 'loading', error: '' });
    const owned = () => mounted.current && active.current && epoch.current === ticket && generation.current === sourceGeneration && operation.current === op && latest.current.source === source && latest.current.session === session && getToken() === session;
    const check = () => { if (!owned() || !latest.current.fresh) throw new ApiClientError('INVALID_RESPONSE', '页面或身份已变化，未展示旧申请来源。', 0); };
    try {
      check(); const value = await readApplicationAttributions(detail, session, check); check();
      setState({ source, generation: sourceGeneration, status: 'ready', data: value, error: '' });
    } catch (error) {
      if (owned()) setState({ source, generation: sourceGeneration, status: 'error', error: attributionError(error) });
    } finally { if (operation.current === op) operation.current = undefined; }
  }
  useEffect(() => {
    if (fresh && detail && actor && session === getToken() && active.current && (!matching || state.status === 'idle' || state.status === 'loading' && !operation.current)) void refresh();
  }, [source, fresh, wake]);
  return { data, status: (current ? state.status : 'idle') as Status, error: current ? state.error : '', refresh, available };
}
export type ApplicationAttributionsState = ReturnType<typeof useApplicationAttributions>;
