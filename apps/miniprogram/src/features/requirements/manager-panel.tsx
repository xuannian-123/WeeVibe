import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import type { RequirementFinalSelection, RequirementSnapshot } from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
import { assertRequirementSession } from './session-boundary';
import { requestRequirement } from '../../platform/requirements-api';
import { beijingLabel } from './answer-state';
import { CoordinationPanel } from './coordination-panel';
export function ManagerPanel({snapshot,updated}:{snapshot:RequirementSnapshot;updated:(next:RequirementSnapshot)=>void}) {
  const actorSession=useRef(getToken());
  const [expanded,setExpanded]=useState(false);const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false);
  const [selection,setSelection]=useState<RequirementFinalSelection>(snapshot.collection.final_selection || {location_id:null,location_other:null,note:''});
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const latest=useRef({snapshot,selection});latest.current={snapshot,selection};
  const data=snapshot.manager;if(!data)return null;
  async function command(action:'close'|'finalize') {
    if(lock.current||!mounted.current)return;
    const key=(value:RequirementSnapshot)=>JSON.stringify([value.collection.id,value.collection.revision,value.collection.status,value.viewer.is_manager,!!value.manager,action==='close'?value.viewer.can_close:value.viewer.can_finalize]);
    const target=latest.current.snapshot;const targetKey=key(target);const finalSelection={...latest.current.selection};
    if(!target.viewer.is_manager||!target.manager||!(action==='close'?target.viewer.can_close:target.viewer.can_finalize))return;
    lock.current=true;setBusy(true);setNotice('');let requested=false;
    try{
      assertRequirementSession(actorSession.current);
      const confirm=await Taro.showModal({title:action==='close'?'提前截止需求？':'确定记录此安排？',content:action==='close'?'截止后不能新增或修改需求，且不能重新开放。已填内容会保留。':'这只记录管理者的最终选择，不会自动获席位、扣费或代表成员接受新安排。',confirmText:action==='close'?'确认截止':'确认记录'});
      if(!confirm.confirm||!mounted.current)return;assertRequirementSession(actorSession.current);
      if(key(latest.current.snapshot)!==targetKey){setNotice('确认期间活动或权限状态已变化，请重新核对；本次未发送。');return;}
      requested=true;
      const next=await requestRequirement(`/api/v1/requirements/${target.collection.id}`,'POST',{action,expected_revision:target.collection.revision,...(action==='finalize'?{final_selection:finalSelection}:{})});
      if(!mounted.current)return;assertRequirementSession(actorSession.current);
      if(key(latest.current.snapshot)!==targetKey){setNotice('服务器操作已返回，但页面状态已变化，请刷新核对；未覆盖较新的页面。');return;}
      updated(next);setNotice(action==='close'?'需求收集已截止。':'最终选择已记录，请回到原活动流程核实安排并让受影响成员确认。');
    }catch(e){if(mounted.current)setNotice(e instanceof ApiClientError?e.message:requested?'操作结果无法确认，请刷新核对；不会显示成功。':'确认未完成，本次未发送，请重试。');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  const name=(questionId:string,optionId:string)=>snapshot.collection.draft.questions.find(q=>q.id===questionId)?.options.find(o=>o.id===optionId)?.label || '未知选项';
  if(getToken()!==actorSession.current)return <View className="req-notice">登录账号已变化，请返回并重新打开。原账号的私人输入已隐藏，不会提交给新账号。</View>;
  return <View><CoordinationPanel snapshot={snapshot}/><View className="req-card"><Text className="req-heading">管理者统计</Text><Text className="req-subtitle">{data.respondent_count} 位参与者已提交</Text><Text className="req-muted">每人只有一份有效需求，修改后更新原答卷。多选题总票数可能超过答题人数；不会自动确定最高票。</Text><Text className="req-heading">地点意向</Text>{data.locations.map(item=><View key={item.option_id}><View className="req-stat-row"><Text>{snapshot.collection.draft.locations.find(l=>l.id===item.option_id)?.label || '候选地点'}</Text><Text>{item.count} 人</Text></View><View className="req-stat-track"><View className="req-stat-fill" style={{width:`${data.respondent_count?item.count/data.respondent_count*100:0}%`}}/></View></View>)}<Text className="req-muted">其他地点：{data.location_other_count} 人填写，原文仅本人可见。</Text>{data.questions.map(stat=><View key={stat.question_id}><View className="req-divider"/><Text className="req-label">{snapshot.collection.draft.questions.find(q=>q.id===stat.question_id)?.title || '问题'}</Text><Text className="req-muted">答题人数 {stat.respondent_count}</Text>{stat.options.map(option=><View className="req-stat-row" key={option.option_id}><Text>{name(stat.question_id,option.option_id)}</Text><Text>{option.count} 人</Text></View>)}<Text className="req-muted">其他自由文本：{stat.other_count} 人填写</Text></View>)}</View>
  <Button className="req-button secondary" onClick={()=>setExpanded(!expanded)}>{expanded?'收起时间及环节意向':'查看时间及环节意向'}</Button>{expanded&&<View><View className="req-notice">逐人仅展示时间和意向环节；预算、兴趣及个人原因只通过汇总呈现，出发地点仅本人可见。</View>{data.responses.map(response=><View className="req-card" key={response.user_id}><Text className="req-heading">{response.nickname || '活动参与者'}</Text><Text className="req-muted">更新于 {beijingLabel(response.updated_at)}</Text><Text className="req-label">时间想法</Text><Text className="req-answer-text">{response.time_preferences || '未填写'}</Text><Text className="req-label">意向环节</Text><Text>{response.selected_segment_ids.map(id=>snapshot.segments.find(s=>s.id===id)?.name || '环节').join('、') || '尚未选择'}</Text></View>)}</View>}
  {snapshot.viewer.can_close&&<Button className="req-button danger" loading={busy} disabled={busy} onClick={()=>void command('close')}>提前截止需求收集</Button>}
  {snapshot.viewer.can_finalize&&<View className="req-card mint"><Text className="req-heading">参考结果，由你拍板</Text><Text className="req-muted">选择不等于更新原活动行程。涉及时间、地点或费用变化，仍需按原规则修改和重新确认。</Text>{snapshot.collection.draft.locations.map(location=><View key={location.id} className={`req-option ${selection.location_id===location.id?'selected':''}`} onClick={()=>{if(!lock.current)setSelection(s=>({...s,location_id:location.id,location_other:null}));}}><Text>{selection.location_id===location.id?'●':'○'} {location.label}</Text></View>)}<View className={`req-option ${selection.location_other!==null?'selected':''}`} onClick={()=>{if(!lock.current)setSelection(s=>({...s,location_id:null,location_other:''}));}}>○ 其他／自行输入</View>{selection.location_other!==null&&<Input disabled={busy} className="req-input" maxlength={500} value={selection.location_other} placeholder="确定的地点或描述" onInput={e=>{if(!lock.current)setSelection(s=>({...s,location_other:e.detail.value}));}}/>}<Textarea disabled={busy} className="req-area" maxlength={1000} value={selection.note} placeholder="最终安排说明（不能假定所有成员已同意）" onInput={e=>{if(!lock.current)setSelection(s=>({...s,note:e.detail.value}));}}/><Button className="req-button" loading={busy} disabled={busy || (!selection.location_id&&!selection.location_other?.trim()&&!selection.note.trim())} onClick={()=>void command('finalize')}>记录最终选择</Button></View>}
  {notice&&<View className="req-notice"><Text selectable>{notice}</Text></View>}</View>;
}
