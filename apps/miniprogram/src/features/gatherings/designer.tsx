import {friendDetailsFromIntake,friendIntakeFromDraft,friendSupplement} from './friend-draft';
import {readGatheringIntakeProgress,type GatheringIntakeProgress} from './intake-progress';
import {useCallback,useEffect,useRef,useState} from 'react';
import Taro from '@tarojs/taro';
import {Text} from '@tarojs/components';
import {ApiClientError} from '@weevibe/api-client';
import {emptyGatheringIntake,gatheringCreateSchema,gatheringIntakeSchema,type GatheringDetails,type GatheringIntake,type GatheringSnapshot} from '@weevibe/contracts';
import {newKey} from '../../platform/local-id';
import {useStoredWrite} from '../../platform/write-state';
import {gatheringRequest,parseGatheringSnapshot} from './client';
import {useGatheringSource} from './use-source';
import {GatheringIntakeEditor} from './intake-editor';
import {GatheringSubscription,useGatheringSubscription} from './subscription';
import {GatheringFriendStart} from './friend-start';
import {GatheringFriendReview} from './friend-review';
import {GatheringFriendCreated} from './friend-created';
import {useGatheringFormChrome} from './page-chrome';

export function GatheringDesigner({actor,session,kind,initialIntake,draftSuffix='',onCreated}:{actor:string;session:string;kind:'friend';initialIntake?:GatheringIntake;draftSuffix?:string;onCreated?:(snapshot:GatheringSnapshot)=>void}){
  const subscription=useGatheringSubscription(actor,session),publishLock=useRef(false);
  const source=useGatheringSource(session),draftKey=`weevibe-gathering-draft-v1:${actor}:${kind}${draftSuffix}`,draft=useRef<unknown>();
  if(draft.current===undefined){try{draft.current=Taro.getStorageSync(draftKey)||null;}catch{draft.current=null;}}
  const savedDraft=draft.current as {actor?:string;details?:unknown;intake?:unknown;reviewed?:boolean;intake_progress?:unknown;retired_details?:unknown}|null;
  const[intake,setIntake]=useState<GatheringIntake>(()=>savedDraft?.actor===actor?gatheringIntakeSchema.safeParse(savedDraft.intake).data??initialIntake??emptyGatheringIntake():initialIntake??emptyGatheringIntake());
  const[details,setDetails]=useState<GatheringDetails>(()=>friendDetailsFromIntake(intake));
  const[intakeProgress,setIntakeProgress]=useState<GatheringIntakeProgress|undefined>(()=>savedDraft?.actor===actor?readGatheringIntakeProgress(savedDraft.intake_progress):undefined);
  const[retiredDetails,setRetiredDetails]=useState<GatheringDetails|undefined>(()=>savedDraft?.actor===actor?friendSupplement(savedDraft.retired_details)??friendSupplement(savedDraft.details):undefined);
  const captureProgress=useCallback((progress:GatheringIntakeProgress)=>{if(source.valid())setIntakeProgress(progress);},[session]);
  const[reviewed,setReviewed]=useState(savedDraft?.actor===actor&&!!savedDraft.reviewed),[edit,setEdit]=useState<''|'ai'>(''),[notice,setNotice]=useState(''),[review,setReview]=useState(false);
  useEffect(()=>{if(source.valid()){try{Taro.setStorageSync(draftKey,{actor,flow_version:2,details:friendDetailsFromIntake(intake),intake,reviewed,intake_progress:intakeProgress,retired_details:retiredDetails});}catch{setNotice('本机草稿暂时无法保存，请保持当前页面。');}}},[details,intake,reviewed,draftKey,intakeProgress,retiredDetails]);
  const write=useStoredWrite({storageKey:`weevibe-gathering-create-pending-v1:${actor}:${kind}${draftSuffix}`,userId:actor,parse:v=>gatheringCreateSchema.parse(v),
    execute:input=>gatheringRequest(session,'/api/v1/gatherings','POST',input,raw=>{const value=parseGatheringSnapshot(raw);if(!value.viewer.is_owner||value.gathering.owner.user_id.toLowerCase()!==actor.toLowerCase()||value.gathering.kind!==kind)throw new ApiClientError('INVALID_RESPONSE','发起结果与当前身份或活动类型不符，请保留原请求并刷新核对。',200);return value;},source.ticket()),
    committed:snapshot=>{if(!source.valid())throw Error('STALE_GATHERING');Taro.setStorageSync(`weevibe-gathering-created-v1:${actor}`,{id:snapshot.gathering.id});Taro.removeStorageSync(draftKey);onCreated?.(snapshot);}});
  useEffect(()=>{if(write.pending||write.blocked){setReview(true);if(write.pending){setIntake(write.pending.input.intake);setDetails(friendDetailsFromIntake(write.pending.input.intake));setIntakeProgress(undefined);setReviewed(true);setRetiredDetails(previous=>previous??friendSupplement(write.pending!.input.details));}}},[kind,write.pending,write.blocked]);
  async function openCreated(){if(!source.valid()||!write.result)return;try{await Taro.redirectTo({url:`/pages/gathering/index?id=${write.result.gathering.id}&entry=share`});}catch{if(source.valid())setNotice('页面暂时无法打开，筹备已保存，点击管理活动重试即可。');}}
  function resumeFriendReview(){setReview(true);setNotice('');}
  async function publish(){
    if(!source.valid()||write.busy||write.pending||write.blocked||publishLock.current||subscription.busy)return;
    if(!review||!reviewed||intakeProgress){setNotice('请先完成偏好填写和确定项确认。');return;}
    const current=friendDetailsFromIntake(intake);
    if(!current.date){setNotice('请先选择出游日期，再发起活动。');return;}
    if(!intake.public.activity_nickname.trim()){setNotice('请先填写本次活动昵称。');return;}
    const confirmed_details=current.confirmed_details;
    const input={kind,idempotency_key:newKey(),details:{...current,confirmed_details},intake:friendIntakeFromDraft(intake)};
    if(!gatheringCreateSchema.safeParse(input).success){setNotice('请检查日期、昵称和偏好填写内容。');return;}
    publishLock.current=true;const guard=source.ticket();try{guard();await write.send(input);}catch{if(source.valid())setNotice('当前页面或账号已变化，请重新打开。');}finally{publishLock.current=false;}
  }
  useGatheringFormChrome(!edit);
  async function back(){if(!source.valid()||write.busy)return;try{await Taro.navigateBack();}catch{if(source.valid())await Taro.reLaunch({url:'/pages/index/index'}).catch(()=>setNotice('页面暂时无法返回，请重试。'));}}
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，请返回后重新打开。</Text>;
  if(write.result)return <GatheringFriendCreated snapshot={write.result} shareReady={!!onCreated} notice={notice} busy={subscription.busy} home={()=>void Taro.reLaunch({url:'/pages/index/index'})} manage={()=>void openCreated()} subscription={<GatheringSubscription appearance="c" value={subscription} gatheringId={write.result.gathering.id}/>}/>;
  if(edit==='ai')return <GatheringIntakeEditor creating draftProgress={intakeProgress} onDraftProgress={captureProgress} initial={intake} session={session} date={details.date} cancel={()=>{setIntakeProgress(undefined);setEdit('');setNotice('');}} done={next=>{if(source.valid()){setIntake(next);setDetails(friendDetailsFromIntake(next));setIntakeProgress(undefined);setReviewed(true);setNotice('');setEdit('');setReview(true);}}}/>;
  const disabled=write.busy||!!write.pending||write.blocked||subscription.busy;
    const start=()=>{if(!disabled&&source.valid()){setNotice('');setEdit('ai');}};
    if(review)return <GatheringFriendReview details={write.pending?.input.details??friendDetailsFromIntake(intake)} excludedDetails={!write.pending?retiredDetails:undefined} intake={write.pending?.input.intake??intake} busy={write.busy} locked={disabled} pending={!!write.pending} blocked={write.blocked} notice={[notice,write.message].filter(Boolean).join('\n')} back={()=>{if(!write.busy){setReview(false);setNotice('');}}} edit={start} publish={()=>void publish()} retry={()=>{if(source.valid())void write.send();}}/>;
    return <GatheringFriendStart intake={intake} reviewed={reviewed} hasProgress={!!intakeProgress} disabled={disabled} notice={notice} recoveryMessage={write.message} pending={!!write.pending} busy={write.busy} back={()=>void back()} start={start} resume={()=>{if(source.valid()&&!write.busy)resumeFriendReview();}}/>;
}
