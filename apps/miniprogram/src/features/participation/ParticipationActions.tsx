import { useEffect, useRef, useState } from 'react';
import Taro, { useDidShow, useDidHide, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { Checkbox, CheckboxGroup, Label, Picker, Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import { participationActionSchema } from '@weevibe/contracts/src/participation-actions';
import { Action, Notice, Panel } from '../../components/ui';
import { newKey } from '../../platform/page-state';
import { formatTime, rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';
import { submitParticipation } from './api';
import { getToken } from '../../platform/api';

function targetFingerprint(value: ActivityDetail, segmentIds: string[]) {
  return JSON.stringify([value.activity_id, value.revision, value.viewer.user_id, value.cancelled_at, segmentIds.map(id => [value.segments.find(s => s.segment_id === id), value.viewer.participations.find(p => p.segment_id === id)])]);
}

export function ParticipationActions({ detail, session, fresh, refresh, onBusyChange }: { detail: ActivityDetail; session: string | undefined; fresh: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void }) {
  const [selected, setSelected] = useState<string[]>([]); const [date, setDate] = useState(''); const [time, setTime] = useState(''); const [message,setMessage]=useState('');
  const userId = detail.viewer.user_id ?? undefined;
  const [confirming,setConfirming]=useState(false);const confirmLock=useRef(false);const mounted=useRef(true);const visible=useRef(true);const epoch=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  useDidHide(()=>{visible.current=false;epoch.current++;});useUnload(()=>{visible.current=false;epoch.current++;});useDidShow(()=>{visible.current=true;});
  const latest=useRef({detail,session,fresh});latest.current={detail,session,fresh};
  const active=()=>mounted.current&&visible.current;
  const state = useStoredWrite({storageKey:`weevibe-participation-v1:${detail.activity_id}:${userId??'guest'}`,userId,parse:raw=>participationActionSchema.parse(raw),execute:async input=>{
    const ticket=epoch.current;
    if(!active()||!session||getToken()!==session)throw new ApiClientError('UNAUTHENTICATED','页面或账号已变化，请重新打开本人参加记录',401);
    const before=targetFingerprint(detail,input.segment_ids);
    const assertCanSend=()=>{
      const current=latest.current;
      if(!active()||ticket!==epoch.current||getToken()!==session||current.session!==session||!current.fresh||targetFingerprint(current.detail,input.segment_ids)!==before)
        throw new ApiClientError('INVALID_RESPONSE','页面或参加状态已变化，操作结果未确认；请返回原活动刷新核对后再决定是否重试。',0);
    };
    const result=await submitParticipation(detail.activity_id,input,userId??'',assertCanSend);
    const current=latest.current;
    if(!active()||ticket!==epoch.current||getToken()!==session||current.session!==session||current.detail.activity_id!==detail.activity_id||current.detail.viewer.user_id!==userId||result.activity.activity_id!==detail.activity_id||result.activity.viewer.user_id!==userId||current.detail.revision>result.activity.revision)
      throw new ApiClientError('INVALID_RESPONSE','页面状态已变化，已发送操作可能已提交；请回到原活动刷新核对，未用旧结果更新当前页面。',0);
    return result;
  },committed:result=>{rememberActivity(userId??null,result.activity);void refresh();}});
  useEffect(() => { onBusyChange?.(state.busy||confirming); return () => onBusyChange?.(false); }, [state.busy, confirming, onBusyChange]);
  const eligible = detail.segments.filter(s=>!s.cancelled_at && Date.parse(s.ends_at)>Date.parse(detail.server_time) && detail.viewer.participations.some(p=>p.segment_id===s.segment_id&&p.status!=='exited'));
  useEffect(()=>{setSelected([]);setDate('');setTime('');setMessage('');},[detail.activity_id,userId]);
  useEffect(()=>{if(state.result)setSelected([]);},[state.result]);
  const blocked = !fresh || confirming || state.busy || state.blocked || !!state.pending || !!detail.cancelled_at;
  async function send(action:'exit'|'late'){
    if(confirmLock.current||!active()||blocked||!userId||selected.length===0)return;
    if(!session||getToken()!==session){setMessage('账号已变化，请重新读取本人参加记录；本次未发送。');return;}
    if(selected.some(id=>!eligible.some(s=>s.segment_id===id))){setMessage('所选环节已变化，请重新选择。');return;}
    const raw={idempotency_key:newKey(),expected_revision:detail.revision,segment_ids:selected,action,...(action==='late'?{estimated_arrival_at:`${date}T${time}:00+08:00`}:{})};
    const parsed=participationActionSchema.safeParse(raw);if(!parsed.success){setMessage('请先选择环节；晚到还需选择有效日期和时间。');return;}
    const ticket=epoch.current;
    const before=targetFingerprint(detail,parsed.data.segment_ids);confirmLock.current=true;setConfirming(true);setMessage('');let requested=false;
    try{
      const confirmed=await Taro.showModal({title:action==='exit'?'确认退出所选环节？':'确认记录晚到？',content:action==='exit'?'退出将立即释放这些席位，重新参加需再次申请。人数变化后费用需重新核实，不会自动退款或分摊。':'只记录所选环节的预计到达时间，不退出其他环节，不代表同意修改后的安排。'});
      if(!confirmed.confirm||!active()||ticket!==epoch.current)return;
      const current=latest.current;
      const stillEligible=parsed.data.segment_ids.every(id=>current.detail.segments.some(s=>s.segment_id===id&&!s.cancelled_at&&Date.parse(s.ends_at)>Date.parse(current.detail.server_time))&&current.detail.viewer.participations.some(p=>p.segment_id===id&&p.status!=='exited'));
      if(getToken()!==session||current.session!==session||!current.fresh||targetFingerprint(current.detail,parsed.data.segment_ids)!==before||!stillEligible){setMessage('确认期间账号、参加记录或活动状态已变化，请刷新重新核对；本次未发送。');return;}
      requested=true;state.resetResult();await state.send(parsed.data);
    }catch{if(active())setMessage(requested?'操作结果未确认，请刷新核对；原请求不会被当作成功。':'确认未完成，本次未发送；输入仍保留，可重试。');}
    finally{confirmLock.current=false;if(mounted.current)setConfirming(false);}
  }
  if(!userId)return null;
  if(eligible.length===0&&!state.pending&&!state.result)return null;
  return <Panel title="我的参加变更">
    <Text className="caption">需求截止后仍可变更本人参加状态；不会修改原始需求或自动接受新方案。</Text>
    <CheckboxGroup onChange={e=>{if(!confirmLock.current&&!blocked)setSelected(e.detail.value);}}>{eligible.map(s=><Label className="field" key={s.segment_id}><Checkbox value={s.segment_id} checked={selected.includes(s.segment_id)} disabled={blocked}/><Text>{s.name}</Text>{detail.viewer.participations.find(p=>p.segment_id===s.segment_id)?.late_arrival_at&&<Text className="caption">预计到达：{formatTime(detail.viewer.participations.find(p=>p.segment_id===s.segment_id)!.late_arrival_at!)}</Text>}</Label>)}</CheckboxGroup>
    <Text className="caption">晚到时间 · 北京时间 UTC+8；需晚于环节开始且早于结束。跨环节请分别提交。</Text>
    <View className="field"><Picker mode="date" value={date} disabled={blocked} onChange={e=>{if(!confirmLock.current&&!blocked)setDate(e.detail.value);}}><Text>{date||'选择到达日期'}</Text></Picker><Picker mode="time" value={time||'18:00'} disabled={blocked} onChange={e=>{if(!confirmLock.current&&!blocked)setTime(e.detail.value);}}><Text>{time||'选择到达时间'}</Text></Picker></View>
    <Action disabled={blocked||!selected.length} onClick={()=>{void send('late');}}>记录晚到</Action><Action variant="danger" disabled={blocked||!selected.length} onClick={()=>{void send('exit');}}>退出所选环节</Action>
    {message&&<Notice>{message}</Notice>}{state.message&&<Notice>{state.message}</Notice>}{state.result&&<Notice>{state.result.notice}</Notice>}
    {state.pending&&<View><Notice>上次结果未确认，先刷新核对；重试会保留原选择、内容和请求标识。</Notice><Action disabled={state.busy} onClick={()=>{void refresh();}}>刷新核对</Action><Action disabled={!fresh||state.busy||state.blocked||confirming} onClick={()=>{if(active()&&fresh&&!confirmLock.current)void state.send();}}>重试原请求</Action></View>}
  </Panel>;
}
