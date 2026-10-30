import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { requirementCreateSchema, type RequirementCreateInput, type RequirementSnapshot, type TeamDraft } from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
import { GatheringProfileBoundary } from '../gatherings/profile-boundary';
import { assertRequirementSession } from './session-boundary';
import { requestRequirement } from '../../platform/requirements-api';
import { newKey } from '../../platform/local-id';
import { uncertain as isUncertainWrite } from '../../platform/write-policy';
import { adoptServerDraft, needsDraftRecovery } from './draft-recovery';
import { DraftEditor } from './draft-editor';
import type { SegmentChoice } from './question-editor';
function CollectionEditorBody({kind,activityId,initial,initialSnapshot,segments=[],saved}:{kind:'friend';activityId?:string;initial:TeamDraft;initialSnapshot?:RequirementSnapshot;segments?:SegmentChoice[];saved:(snapshot:RequirementSnapshot)=>void}) {
  const actorSession=useRef(getToken());
  const [draft,setDraft]=useState(initial);const [current,setCurrent]=useState(initialSnapshot);const [busy,setBusy]=useState(false);const lock=useRef(false);const [notice,setNotice]=useState('');const [dirty,setDirty]=useState(!initialSnapshot);const [uncertain,setUncertain]=useState(false);
  const createRequest=useRef<RequirementCreateInput>();
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const latest=useRef({current,initialSnapshot,dirty});latest.current={current,initialSnapshot,dirty};
  function publishTarget(){
    const value=latest.current;const target=value.current;const incoming=value.initialSnapshot;
    if(!target||value.dirty||!target.viewer.is_manager||!target.viewer.can_publish)return undefined;
    if(incoming&&(incoming.collection.id!==target.collection.id||incoming.collection.revision!==target.collection.revision||!incoming.viewer.is_manager||!incoming.viewer.can_publish))return undefined;
    return target;
  }
  async function save(){if(lock.current||!mounted.current)return;lock.current=true;setBusy(true);setNotice('');try{assertRequirementSession(actorSession.current);let next:RequirementSnapshot;if(current){next=await requestRequirement(`/api/v1/requirements/${current.collection.id}`,'POST',{action:'save-draft',expected_revision:current.collection.revision,draft});}else{const input=createRequest.current ?? requirementCreateSchema.parse({action:'create',kind,...(activityId?{activity_id:activityId}:{}),idempotency_key:newKey(),draft});createRequest.current=input;next=await requestRequirement('/api/v1/requirements','POST',input);}if(!mounted.current)return;assertRequirementSession(actorSession.current);setCurrent(next);setDirty(false);setUncertain(false);createRequest.current=undefined;saved(next);setNotice('草稿已保存到服务器，登录同一账号后可恢复。尚未发布，不会生成答卷或增加席位。');}catch(e){if(!current&&createRequest.current){const isUncertain=isUncertainWrite(e);setUncertain(isUncertain);if(!isUncertain)createRequest.current=undefined;}setNotice(e instanceof ApiClientError?e.message:'草稿保存结果未确认。输入保留；重试会复用原创建请求，避免重复。');}finally{lock.current=false;setBusy(false);}}
  async function publish(){
    if(lock.current||!mounted.current)return;const target=publishTarget();if(!target)return;
    lock.current=true;setBusy(true);setNotice('');let requested=false;
    const unchanged=()=>{const value=publishTarget();return !!value&&value.collection.id===target.collection.id&&value.collection.revision===target.collection.revision;};
    try{
      assertRequirementSession(actorSession.current);
      const confirm=await Taro.showModal({title:'开始收集需求？',content:'发布后题目及选项结构锁定；截止后不可重新开放。填写需求不等于获席位或接受最终安排。',confirmText:'确认发布'});
      if(!confirm.confirm||!mounted.current)return;assertRequirementSession(actorSession.current);
      if(!unchanged()){setNotice('确认期间草稿或权限状态已变化，请重新核对；本次未发布。');return;}
      requested=true;const next=await requestRequirement(`/api/v1/requirements/${target.collection.id}`,'POST',{action:'publish',expected_revision:target.collection.revision});
      if(!mounted.current)return;assertRequirementSession(actorSession.current);
      if(!unchanged()){setNotice('服务器操作已返回，但页面状态已变化，请刷新核对；未覆盖较新的草稿。');return;}
      setCurrent(next);saved(next);setNotice('需求收集已发布。');
    }catch(e){if(mounted.current)setNotice(e instanceof ApiClientError?e.message:requested?'发布结果未确认，请刷新核对，未显示发布成功。':'确认未完成，本次未发布，请重试。');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function recover(){if(lock.current)return;try{if(!initialSnapshot)return;const confirm=await Taro.showModal({title:'加载服务器版本？',content:'服务器已有更新。你可以先复制当前草稿备份，再加载服务器版本；此操作不会自动覆盖服务器。',confirmText:'加载服务器'});if(!confirm.confirm)return;assertRequirementSession(actorSession.current);const recovered=adoptServerDraft(initialSnapshot);setCurrent(recovered.snapshot);setDraft(recovered.draft);setDirty(false);setUncertain(false);createRequest.current=undefined;setNotice('已加载服务器当前版本，可以继续编辑。');}catch(e){setNotice(e instanceof ApiClientError?e.message:'恢复未完成，请核对登录状态后重试。');}}
  async function copyDraft(){try{assertRequirementSession(actorSession.current);await Taro.setClipboardData({data:JSON.stringify(draft,null,2)});}catch(e){setNotice(e instanceof ApiClientError?e.message:'复制未完成，请重试。');}}
  if(getToken()!==actorSession.current)return <View className="req-notice">登录账号已变化，请返回并重新打开。原账号的私人输入已隐藏，不会提交给新账号。</View>;
  return <View>{needsDraftRecovery(current,initialSnapshot)&&<View className="req-notice"><Text>服务器版本已更新，可能是上次保存已成功但响应丢失。当前输入不会被自动覆盖。</Text><Button className="req-button secondary" onClick={()=>void copyDraft()}>先复制当前草稿</Button><Button className="req-button secondary" disabled={busy} onClick={()=>void recover()}>加载服务器版本并恢复编辑</Button></View>}<View className="req-notice">通过分享进入并登录即可填写；链接可能被转发，不代表微信群成员身份。筹备无需确定时间地点；发布收集只需明确标题和填写截止。</View>{uncertain&&<View className="req-notice">创建结果待核对，暂时锁定输入以保留原请求。点击重试会使用同一个幂等键与原内容；也可返回列表刷新查看服务器结果。</View>}<DraftEditor value={draft} segments={segments} disabled={busy||uncertain||!!current&&!current.viewer.can_edit} onChange={next=>{if(lock.current)return;setDraft(next);setDirty(true);setNotice('');}}/>{notice&&<View className="req-notice"><Text selectable>{notice}</Text></View>}<Button className="req-button" loading={busy} disabled={busy||!!current&&!current.viewer.can_edit} onClick={()=>void save()}>{uncertain?'重试原保存请求':dirty?'保存服务器草稿':'已保存 · 再次保存'}</Button><Button className="req-button" disabled={busy||!publishTarget()} onClick={()=>void publish()}>发布需求收集</Button><Text className="req-muted">{dirty?'先保存当前修改，再发布。':'发布后不再修改题目结构，以免历史答卷错位。'} 服务端将校验截止日期、活动权限和字段有效性。</Text></View>;
}

export function CollectionEditor(props:Parameters<typeof CollectionEditorBody>[0]){return <GatheringProfileBoundary session={getToken()} required={!props.initialSnapshot||props.initialSnapshot.viewer.can_edit||props.initialSnapshot.viewer.can_publish}><CollectionEditorBody {...props}/></GatheringProfileBoundary>;}
