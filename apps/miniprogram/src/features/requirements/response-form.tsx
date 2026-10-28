import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import { activityIdSchema, constraintTagSchema, preferenceTagSchema, requirementResponseInputSchema, type RequirementResponseInput, type RequirementSnapshot } from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
import { responseInputFromSaved, responseVersion } from './response-recovery';
import { assertRequirementSession } from './session-boundary';
import { requestRequirement } from '../../platform/requirements-api';
import { errorText } from '../../platform/page-state';
import { answerFromSaved, beijingLabel, emptyAnswer, relevantQuestions, serializeAnswers, toggleAnswerOption, toggleOther, type AnswerMap } from './answer-state';
function message(error:unknown) { return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : errorText(error); }
export function ResponseForm({ snapshot, updated }: {snapshot:RequirementSnapshot;updated:(next:RequirementSnapshot)=>void}) {
  const own=snapshot.own_response; const actorSession=useRef(getToken());
  const [segments,setSegments]=useState<string[]>(own?.selected_segment_ids || []);
  const [answers,setAnswers]=useState<AnswerMap>(()=>Object.fromEntries((own?.answers || []).map(answer=>[answer.question_id,answerFromSaved(answer)])));
  const [locations,setLocations]=useState<string[]>(own?.location_ids || []); const [otherSelected,setOtherSelected]=useState(own?.location_other!==null && own?.location_other!==undefined);const [otherLocation,setOtherLocation]=useState(own?.location_other || '');
  const [time,setTime]=useState(own?.time_preferences || '');const [budget,setBudget]=useState(own?.budget_note || '');const [preferences,setPreferences]=useState(own?.preferences || '');const [origin,setOrigin]=useState(own?.private_origin?.label || '');const [privateOrigin,setPrivateOrigin]=useState(own?.private_origin ?? null);
  const [budgetMax,setBudgetMax]=useState(own?.budget_max_yuan == null ? '' : String(own.budget_max_yuan));
  const [tags,setTags]=useState<NonNullable<RequirementResponseInput['preference_tags']>>(own?.preference_tags || []);
  const [limits,setLimits]=useState<NonNullable<RequirementResponseInput['constraint_tags']>>(own?.constraint_tags || []);
  const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const locked=useRef(false);const [saved,setSaved]=useState(!!own);
  const [navigating,setNavigating]=useState(false);const navigationLock=useRef(false);const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [acceptedVersion,setAcceptedVersion]=useState(()=>responseVersion(own));const [savedAt,setSavedAt]=useState(own?.updated_at);const [noticeSuccess,setNoticeSuccess]=useState(false);
  const incomingVersion=responseVersion(own);const latestIncoming=useRef(incomingVersion);latestIncoming.current=incomingVersion;
  const needsRecovery=incomingVersion!==acceptedVersion;const [writeConflict,setWriteConflict]=useState(false);
  const disabled=busy || navigating || !snapshot.viewer.can_respond || needsRecovery || writeConflict;
  const canContinue=saved && !!own && Number.isInteger(own.response_version) && own.response_version>0 && !busy && !needsRecovery && !writeConflict;
  const activityId=activityIdSchema.safeParse(snapshot.collection.activity_id);
  async function openActivity(){
    if(!canContinue || !activityId.success || navigationLock.current || !mounted.current)return;
    try{assertRequirementSession(actorSession.current);navigationLock.current=true;setNavigating(true);await Taro.redirectTo({url:`/pages/activity/index?id=${encodeURIComponent(activityId.data)}`});}
    catch{if(mounted.current && getToken()===actorSession.current){setNoticeSuccess(false);setNotice('活动页面暂时无法打开，请重试。已保存的需求不需要重新提交。');}}
    finally{navigationLock.current=false;if(mounted.current)setNavigating(false);}
  }
  function changed(){setSaved(false);setNotice('');setNoticeSuccess(false);}
  const body=(validate=true):RequirementResponseInput=>({selected_segment_ids:segments,answers:validate?serializeAnswers(snapshot.collection.draft.questions,segments,answers):relevantQuestions(snapshot.collection.draft.questions,segments).map(question=>{const answer=answers[question.id] || emptyAnswer();return {question_id:question.id,option_ids:answer.option_ids.filter(id=>question.options.some(option=>option.id===id)),other:answer.other_selected?answer.other_text.trim():null};}),location_ids:locations,location_other:otherSelected?otherLocation.trim():null,time_preferences:time.trim(),budget_note:budget.trim(),preferences:preferences.trim(),budget_max_yuan:budgetMax.trim() ? Number(budgetMax) : null,preference_tags:tags,constraint_tags:limits,private_origin:privateOrigin});
  async function submit(){if(locked.current || navigationLock.current || !snapshot.viewer.can_respond)return;if(needsRecovery || writeConflict){setNotice('服务器中的本人答卷已更新，请先核对并加载服务器答卷。');setNoticeSuccess(false);return;}locked.current=true;setBusy(true);setSaved(false);setNotice('');setNoticeSuccess(false);try{assertRequirementSession(actorSession.current);if(otherSelected&&!otherLocation.trim())throw new Error('已选择其他地点，请填写地点名称或描述。');const expectedResponseVersion=own?own.response_version:0;if(!Number.isInteger(expectedResponseVersion)||expectedResponseVersion<0)throw new ApiClientError('INVALID_RESPONSE','后端未提供答卷版本，请先核对前后端已更新到同一版本；本次未保存',409);const input=requirementResponseInputSchema.parse(body());const next=await requestRequirement(`/api/v1/requirements/${snapshot.collection.id}`,'POST',{action:'respond',expected_revision:snapshot.collection.revision,expected_response_version:expectedResponseVersion,response:input});if(!next.own_response || !Number.isInteger(next.own_response.response_version) || next.own_response.response_version!==expectedResponseVersion+1)throw new ApiClientError('INVALID_RESPONSE','保存结果无法确认，请刷新核对',0);setAcceptedVersion(responseVersion(next.own_response));setSavedAt(next.own_response.updated_at);updated(next);setSaved(true);setNoticeSuccess(true);setNotice('需求已保存。再次提交会更新你的同一份需求，不会重复计票，也不会自动报名。');}catch(e){if(e instanceof ApiClientError&&(e.code==='VERSION_CONFLICT'||e.code==='CONCURRENT_MODIFICATION'))setWriteConflict(true);setNoticeSuccess(false);setNotice(`${message(e)} 输入仍保留在当前页面，请核对状态后再试。`);}finally{locked.current=false;setBusy(false);}}
  async function copy(){try{assertRequirementSession(actorSession.current);const input=body(false);const {private_origin:_,...publicInput}=input;await Taro.setClipboardData({data:JSON.stringify(publicInput,null,2)});setNoticeSuccess(true);setNotice('已复制当前填写草稿（可以尚未填完，不包含私有出发地点）。');}catch{setNoticeSuccess(false);setNotice('复制未完成，请核对登录状态后重试。');}}
  async function refreshConflict(){
    if(locked.current)return;locked.current=true;setBusy(true);setNotice('');setNoticeSuccess(false);
    try{assertRequirementSession(actorSession.current);const next=await requestRequirement(`/api/v1/requirements/${snapshot.collection.id}`);assertRequirementSession(actorSession.current);
      if(next.own_response&&(!Number.isInteger(next.own_response.response_version)||next.own_response.response_version<1))throw new ApiClientError('INVALID_RESPONSE','后端缺少答卷版本，请核对前后端部署版本；未重新提交',409);
      updated(next);setWriteConflict(false);setNotice('已刷新服务器状态，当前输入仍保留。若答卷已变更，请核对并确认加载后再修改。');
    }catch(e){setNotice(message(e));}finally{locked.current=false;setBusy(false);}
  }
  async function recover(){
    if(locked.current || !needsRecovery)return;
    locked.current=true;setBusy(true);setNotice('');setNoticeSuccess(false);
    const target=own;const targetVersion=incomingVersion;
    try{
      assertRequirementSession(actorSession.current);
      const confirm=await Taro.showModal({title:'加载服务器答卷？',content:'将用服务器答卷替换当前页面输入。你可以先取消并复制本机草稿备份；不会自动向服务器提交。',confirmText:'加载答卷'});
      if(!confirm.confirm)return;
      assertRequirementSession(actorSession.current);
      if(latestIncoming.current!==targetVersion){setNotice('确认期间服务器答卷再次更新，当前输入仍保留，请重新核对后加载。');return;}
      const input=responseInputFromSaved(target);
      setSegments(input.selected_segment_ids);setAnswers(Object.fromEntries(input.answers.map(answer=>[answer.question_id,answerFromSaved(answer)])));
      setLocations(input.location_ids);setOtherSelected(input.location_other!==null);setOtherLocation(input.location_other || '');
      setTime(input.time_preferences);setBudget(input.budget_note);setPreferences(input.preferences);setBudgetMax(input.budget_max_yuan == null ? "" : String(input.budget_max_yuan));setTags(input.preference_tags || []);setLimits(input.constraint_tags || []);setOrigin(input.private_origin?.label || '');setPrivateOrigin(input.private_origin ?? null);
      setWriteConflict(false);setAcceptedVersion(targetVersion);setSavedAt(target?.updated_at);setSaved(!!target);setNoticeSuccess(true);setNotice('已加载所核对的服务器答卷；此操作没有提交或修改服务器数据。');
    }catch(e){setNotice(message(e));}finally{locked.current=false;setBusy(false);}
  }
  if(getToken()!==actorSession.current)return <View className="req-notice">登录账号已变化，请返回并重新打开。原账号的私人输入已隐藏，不会提交给新账号。</View>;
  return <View>
    <View className="req-notice"><Text>填写前请了解：组织者可逐人查看时间和意向环节；预算、偏好和限制仅展示不关联姓名的汇总，个人文字备注仅本人可见。出发地点只对本人可见，不向管理者或其他成员展示。本页面不会将位置或答卷发送给模型。</Text></View>
    {!snapshot.viewer.can_respond && <View className="req-notice"><Text>{snapshot.viewer.blocked_reason || '当前不能填写或修改需求。'} 原始输入仍保留。截止后的退出或晚到，请回到活动详情操作；最终安排确认不受需求截止影响。</Text></View>}
    {writeConflict && <View className="req-notice"><Text>提交发生版本冲突，未覆盖服务器答卷。请先刷新核对；重复原请求不会被当作保存成功。</Text><Button className="req-button secondary" disabled={busy} onClick={()=>void refreshConflict()}>刷新服务器答卷</Button></View>}
    {needsRecovery && <View className="req-notice"><Text>服务器中的本人答卷已更新，当前页面输入没有被覆盖。请先复制需要保留的本机草稿，再确认加载服务器答卷；核对前不能提交旧输入。</Text><Button className="req-button secondary" disabled={busy} onClick={()=>void copy()}>先复制本机草稿</Button><Button className="req-button secondary" disabled={busy} onClick={()=>void recover()}>加载服务器答卷</Button></View>}
    {savedAt && <Text className="req-muted">当前表单依据的保存时间：{beijingLabel(savedAt)} · {saved?'已提交':'有未保存修改'}</Text>}
    <View className="req-card"><Text className="req-heading">拟参加哪些环节？</Text><Text className="req-muted">仅用于显示相关问题，不是报名或席位确认。填写前不需要管理员审批。</Text>{snapshot.segments.filter(s=>!s.cancelled_at).map(segment=><View key={segment.id} className={`req-option ${segments.includes(segment.id)?'selected':''}`} onClick={()=>{if(disabled)return;setSegments(current=>current.includes(segment.id)?current.filter(id=>id!==segment.id):[...current,segment.id]);changed();}}><Text className="req-option-mark">{segments.includes(segment.id)?'☑':'□'}</Text><Text>{segment.name}</Text></View>)}</View>
    <View className="req-card mint"><Text className="req-heading">候选地点 · 可多选</Text>{snapshot.collection.draft.locations.map(location=><View key={location.id} className={`req-option ${locations.includes(location.id)?'selected':''}`} onClick={()=>{if(disabled)return;setLocations(current=>current.includes(location.id)?current.filter(id=>id!==location.id):[...current,location.id]);changed();}}><Text className="req-option-mark">{locations.includes(location.id)?'☑':'□'}</Text><Text>{location.label}</Text></View>)}<View className={`req-option ${otherSelected?'selected':''}`} onClick={()=>{if(disabled)return;setOtherSelected(!otherSelected);setOtherLocation('');changed();}}><Text className="req-option-mark">{otherSelected?'☑':'□'}</Text><Text>其他／自行输入地点</Text></View>{otherSelected&&<Textarea disabled={disabled} className="req-area" maxlength={500} value={otherLocation} placeholder="请输入地点名称或描述，不会伪造坐标" onInput={e=>{setOtherLocation(e.detail.value);changed();}}/>}</View>
    <View className="req-card peach"><Text className="req-heading">时间、预算与偏好</Text><Text className="req-label">方便的时间（选填，最多 1000 字）</Text><Textarea disabled={disabled} className="req-area" maxlength={1000} value={time} placeholder="例如：周六下午可以参加" onInput={e=>{setTime(e.detail.value);changed();}}/><Text className="req-label">预算想法（选填，最多 500 字）</Text><Textarea disabled={disabled} className="req-area" maxlength={500} value={budget} placeholder="只是意向，不是付款或同意最终费用" onInput={e=>{setBudget(e.detail.value);changed();}}/><Text className="req-label">其他偏好（选填，最多 1000 字）</Text><Textarea disabled={disabled} className="req-area" maxlength={1000} value={preferences} placeholder="私人备注，仅本人可见；需共同注意的事项请选下方标签" onInput={e=>{setPreferences(e.detail.value);changed();}}/></View>
    <View className="req-card mint"><Text className="req-heading">可用于共同规划的意向</Text><Text className="req-label">本人预算上限（元，选填）</Text><Input disabled={disabled} className="req-input" type="digit" value={budgetMax} placeholder="例如 100；不是费用或付款承诺" onInput={e=>{setBudgetMax(e.detail.value);changed();}}/><Text className="req-label">活动兴趣（多选，仅汇总）</Text>{preferenceTagSchema.options.map(tag=><View className={`req-option ${tags.includes(tag)?'selected':''}`} key={tag} onClick={()=>{if(disabled)return;setTags(v=>v.includes(tag)?v.filter(x=>x!==tag):[...v,tag]);changed();}}><Text>{tags.includes(tag)?'☑':'□'} {tag}</Text></View>)}<Text className="req-label">安排需注意（选填，不展示个人原因）</Text>{constraintTagSchema.options.map(tag=><View className={`req-option ${limits.includes(tag)?'selected':''}`} key={tag} onClick={()=>{if(disabled)return;setLimits(v=>v.includes(tag)?v.filter(x=>x!==tag):[...v,tag]);changed();}}><Text>{limits.includes(tag)?'☑':'□'} {tag}</Text></View>)}</View>
    {relevantQuestions(snapshot.collection.draft.questions,segments).map(question=>{const answer=answers[question.id] || emptyAnswer();return <View key={question.id} className="req-card lilac"><Text className="req-heading">{question.title}{question.required?' *':''}</Text><Text className="req-muted">{question.multiple?'可多选':'单选'} · {question.required?'必答':'选填'}{question.segment_id?' · 仅所选环节相关':''}</Text>{question.options.map(option=><View key={option.id} className={`req-option ${answer.option_ids.includes(option.id)?'selected':''}`} onClick={()=>{if(disabled)return;setAnswers(current=>({...current,[question.id]:toggleAnswerOption(question,current[question.id] || emptyAnswer(),option.id)}));changed();}}><Text className="req-option-mark">{answer.option_ids.includes(option.id)?(question.multiple?'☑':'●'):(question.multiple?'□':'○')}</Text><Text>{option.label}</Text></View>)}<View className={`req-option ${answer.other_selected?'selected':''}`} onClick={()=>{if(disabled)return;setAnswers(current=>({...current,[question.id]:toggleOther(question,current[question.id] || emptyAnswer())}));changed();}}><Text className="req-option-mark">{answer.other_selected?'●':'○'}</Text><Text>其他／自己填写</Text></View>{answer.other_selected&&<Textarea disabled={disabled} className="req-area" value={answer.other_text} maxlength={500} placeholder="选择其他后，请填写具体内容" onInput={e=>{setAnswers(current=>({...current,[question.id]:{...(current[question.id] || emptyAnswer()),other_text:e.detail.value}}));changed();}}/>}</View>;})}
    <View className="req-card req-origin"><Text className="req-heading">个人出发地点 · 仅本人可见</Text><Text className="req-muted">完全选填。管理者接口不会包含这项信息。当前仅保存，不执行个人路线规划；不提供位置也可以提交需求。</Text>{privateOrigin && !origin && <Text className="req-muted">当前保存了本人私人坐标。修改描述会替换坐标，也可以主动清空。</Text>}{privateOrigin && <Button className="req-button secondary" disabled={disabled} onClick={()=>{setPrivateOrigin(null);setOrigin('');changed();}}>清空私人出发地点</Button>}<Textarea disabled={disabled} className="req-area" maxlength={200} value={origin} placeholder="选填：用于以后本人规划的出发区域" onInput={e=>{setOrigin(e.detail.value);setPrivateOrigin(e.detail.value.trim()?{label:e.detail.value.trim()}:null);changed();}}/></View>
    {canContinue && <View className="req-card mint">
      <Text className="req-heading">需求已保存，接下来</Text>
      <Text className="req-muted">填写需求只表达意向，不等于已报名或已加入。正式参加仍需查看并接受安排，再由组织者审批。</Text>
      {activityId.success ? <Button className="req-button secondary" disabled={navigating} onClick={()=>void openActivity()}>{navigating?'正在打开活动…':'返回活动，查看安排与报名状态'}</Button> : <Text className="req-muted">等待组织者发布正式活动；届时请通过正式活动邀请查看安排并申请参加。</Text>}
    </View>}
    {notice&&<View className={`req-notice ${noticeSuccess?'req-success':''}`}><Text selectable>{notice}</Text></View>}<Button className="req-button" loading={busy} disabled={disabled} onClick={()=>void submit()}>{saved?'更新我的需求':'保存我的需求'}</Button><Button className="req-button secondary" disabled={busy} onClick={()=>void copy()}>复制当前输入（不含私有地点）</Button><Text className="req-muted">截止依据服务端时间与状态判断。即使本机时间不准确，过期提交也会被拒绝。</Text>
  </View>;
}
