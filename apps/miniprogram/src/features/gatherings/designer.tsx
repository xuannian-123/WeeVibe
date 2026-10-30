import {friendDetailsFromIntake,friendIntakeFromDraft,friendSupplement} from './friend-draft';
import {readGatheringIntakeProgress,type GatheringIntakeProgress} from './intake-progress';
import {gatheringDetailsDraftSchema} from './details-validation';
import {useCallback,useEffect,useRef,useState} from 'react';
import Taro from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import {ApiClientError} from '@weevibe/api-client';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringCreateSchema,gatheringDetailsSchema,gatheringIntakeSchema,type GatheringDetails,type GatheringIntake,type GatheringSnapshot} from '@weevibe/contracts';
import {newKey} from '../../platform/local-id';
import {useStoredWrite} from '../../platform/write-state';
import {gatheringRequest,parseGatheringSnapshot} from './client';
import {useGatheringSource} from './use-source';
import {GatheringIntakeEditor} from './intake-editor';
import {GatheringDetailsEditor} from './details-editor';
import {GatheringQuestionnaire} from './questionnaire';
import {GatheringSubscription,useGatheringSubscription} from './subscription';
import {GatheringNicknameStep} from './nickname-step';
import {GatheringFriendStart} from './friend-start';
import {GatheringFriendReview} from './friend-review';
import {GatheringFriendCreated} from './friend-created';
import {useGatheringFormChrome} from './page-chrome';

export function GatheringDesigner({actor,session,kind,initialIntake,draftSuffix='',onCreated}:{actor:string;session:string;kind:'friend'|'team';initialIntake?:GatheringIntake;draftSuffix?:string;onCreated?:(snapshot:GatheringSnapshot)=>void}){
  const subscription=useGatheringSubscription(actor,session),publishLock=useRef(false);
  const source=useGatheringSource(session),draftKey=`weevibe-gathering-draft-v1:${actor}:${kind}${draftSuffix}`,draft=useRef<unknown>();
  if(draft.current===undefined){try{draft.current=Taro.getStorageSync(draftKey)||null;}catch{draft.current=null;}}
  const savedDraft=draft.current as {actor?:string;details?:unknown;intake?:unknown;reviewed?:boolean;intake_progress?:unknown;retired_details?:unknown}|null;
  const[intake,setIntake]=useState<GatheringIntake>(()=>savedDraft?.actor===actor?gatheringIntakeSchema.safeParse(savedDraft.intake).data??initialIntake??emptyGatheringIntake():initialIntake??emptyGatheringIntake());
  const[details,setDetails]=useState<GatheringDetails>(()=>kind==='friend'?friendDetailsFromIntake(intake):savedDraft?.actor===actor?gatheringDetailsDraftSchema.safeParse(savedDraft.details).data??emptyGatheringDetails():emptyGatheringDetails());
  const[intakeProgress,setIntakeProgress]=useState<GatheringIntakeProgress|undefined>(()=>kind==='friend'&&savedDraft?.actor===actor?readGatheringIntakeProgress(savedDraft.intake_progress):undefined);
  const[retiredDetails,setRetiredDetails]=useState<GatheringDetails|undefined>(()=>kind==='friend'&&savedDraft?.actor===actor?friendSupplement(savedDraft.retired_details)??friendSupplement(savedDraft.details):undefined);
  const captureProgress=useCallback((progress:GatheringIntakeProgress)=>{if(source.valid())setIntakeProgress(progress);},[session]);
  const[nicknameReady,setNicknameReady]=useState(!!(savedDraft?.actor===actor&&gatheringIntakeSchema.safeParse(savedDraft.intake).data?.public.activity_nickname));
  const[reviewed,setReviewed]=useState(savedDraft?.actor===actor&&!!savedDraft.reviewed),[edit,setEdit]=useState<''|'ai'|'details'|'questionnaire'>(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState(false),[review,setReview]=useState(false);
  useEffect(()=>{if(source.valid()){try{Taro.setStorageSync(draftKey,{actor,flow_version:2,details:kind==='friend'?friendDetailsFromIntake(intake):details,intake,reviewed,...(kind==='friend'?{intake_progress:intakeProgress,retired_details:retiredDetails}:{})});}catch{setNotice('本机草稿暂时无法保存，请保持当前页面。');}}},[details,intake,reviewed,draftKey,intakeProgress,retiredDetails]);
  const write=useStoredWrite({storageKey:`weevibe-gathering-create-pending-v1:${actor}:${kind}${draftSuffix}`,userId:actor,parse:v=>gatheringCreateSchema.parse(v),
    execute:input=>gatheringRequest(session,'/api/v1/gatherings','POST',input,raw=>{const value=parseGatheringSnapshot(raw);if(!value.viewer.is_owner||value.gathering.owner.user_id.toLowerCase()!==actor.toLowerCase()||value.gathering.kind!==kind)throw new ApiClientError('INVALID_RESPONSE','发起结果与当前身份或活动类型不符，请保留原请求并刷新核对。',200);return value;},source.ticket()),
    committed:snapshot=>{if(!source.valid())throw Error('STALE_GATHERING');Taro.setStorageSync(`weevibe-gathering-created-v1:${actor}`,{id:snapshot.gathering.id});Taro.removeStorageSync(draftKey);onCreated?.(snapshot);}});
  useEffect(()=>{if(kind==='friend'&&(write.pending||write.blocked)){setReview(true);if(write.pending){setIntake(write.pending.input.intake);setDetails(friendDetailsFromIntake(write.pending.input.intake));setIntakeProgress(undefined);setReviewed(true);setRetiredDetails(previous=>previous??friendSupplement(write.pending!.input.details));}}},[kind,write.pending,write.blocked]);
  async function openCreated(){if(!source.valid()||!write.result)return;try{await Taro.redirectTo({url:`/pages/gathering/index?id=${write.result.gathering.id}&entry=share`});}catch{if(source.valid())setNotice('页面暂时无法打开，筹备已保存，点击管理活动重试即可。');}}
  function beforeTeamPublish(){if(write.busy||write.pending||write.blocked||!source.valid())return;if(!intake.public.activity_nickname.trim()){setNicknameReady(false);setNotice('请先填写本次活动昵称。');return;}if(!details.date){setNotice('请进入问卷设计选择日期。');return;}if(!gatheringDetailsSchema.safeParse(details).success){setNotice('请检查活动日期、时间、人数和费用。');return;}if(!details.deadline_at||Date.parse(details.deadline_at)<=Date.now()){setNotice('请在问卷设计中设置未来的填写截止时间。');return;}setNotice('');setReview(true);}
  function resumeFriendReview(){setReview(true);setNotice('');}
  async function publish(){
    if(!source.valid()||write.busy||write.pending||write.blocked||publishLock.current||subscription.busy)return;
    if(kind==='friend'&&(!review||!reviewed||intakeProgress)){setNotice('请先完成偏好填写和确定项确认。');return;}
    const current=kind==='friend'?friendDetailsFromIntake(intake):details;
    if(!current.date){setNotice('请先选择出游日期，再发起活动。');return;}
    if(!intake.public.activity_nickname.trim()){setNotice('请先填写本次活动昵称。');return;}
    const confirmed_details=kind==='friend'?current.confirmed_details:(['date','title','start_time','end_date','end_time','place','address','description','approximate_time','minimum','capacity','fee'] as const).filter(key=>key==='fee'?current.fee.amount!==null||!!current.fee.note:current[key]!==''&&current[key]!==null);
    const input={kind,idempotency_key:newKey(),details:{...current,confirmed_details},intake:kind==='friend'?friendIntakeFromDraft(intake):intake};
    if(!gatheringCreateSchema.safeParse(input).success){setNotice('请检查日期、昵称和偏好填写内容。');return;}
    publishLock.current=true;const guard=source.ticket();try{guard();await write.send(input);}catch{if(source.valid())setNotice('当前页面或账号已变化，请重新打开。');}finally{publishLock.current=false;}
  }
  useGatheringFormChrome(kind==='friend'&&!edit&&!preview);
  async function back(){if(!source.valid()||write.busy)return;try{await Taro.navigateBack();}catch{if(source.valid())await Taro.reLaunch({url:'/pages/index/index'}).catch(()=>setNotice('页面暂时无法返回，请重试。'));}}
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，请返回后重新打开。</Text>;
  if(kind==='team'&&!nicknameReady&&!write.result&&!write.pending)return <GatheringNicknameStep single value={intake.public.activity_nickname} mode="form" busy={false} saving={write.busy} notice={notice} change={nickname=>{if(source.valid()&&!write.busy)setIntake(current=>({...current,public:{...current.public,activity_nickname:nickname}}));}} switchMode={()=>{}} nextLabel="开始设计问卷" next={()=>{if(!source.valid()||write.busy)return;const nickname=intake.public.activity_nickname.trim();if(!nickname||nickname.length>32){setNotice('请填写 1—32 字的本次活动昵称。');return;}setIntake(current=>({...current,public:{...current.public,activity_nickname:nickname}}));setNicknameReady(true);setNotice('');}} cancel={()=>{if(source.valid())void Taro.navigateBack().catch(()=>Taro.reLaunch({url:'/pages/index/index'}));}}/>;
  if(write.result&&kind==='friend')return <GatheringFriendCreated snapshot={write.result} shareReady={!!onCreated} notice={notice} busy={subscription.busy} home={()=>void Taro.reLaunch({url:'/pages/index/index'})} manage={()=>void openCreated()} subscription={<GatheringSubscription appearance="c" value={subscription} gatheringId={write.result.gathering.id}/>}/>;
  if(write.result)return <View className="gg-editor"><Text className="gg-eyebrow">WEEVIBE / 一起出发</Text><Text className="gg-title">这次相聚已发起</Text><View className="gg-panel mint"><Text className="gg-heading">{write.result.gathering.title}</Text><Text>{write.result.gathering.date}</Text><Text className="gg-muted">可以分享邀请，让朋友填写自己的想法。预算和个人出发地点仅本人可见。</Text></View>{notice&&<Text className="gg-notice">{notice}</Text>}<GatheringSubscription value={subscription} gatheringId={write.result.gathering.id}/><Button className="gg-primary" disabled={subscription.busy} onClick={()=>void openCreated()}>管理活动</Button><Button className="gg-secondary" onClick={()=>void Taro.reLaunch({url:'/pages/index/index'})}>回到首页</Button></View>;
  if(edit==='ai')return <GatheringIntakeEditor creating={kind==='friend'} draftProgress={kind==='friend'?intakeProgress:undefined} onDraftProgress={kind==='friend'?captureProgress:undefined} initial={intake} session={session} date={details.date} cancel={()=>{setIntakeProgress(undefined);setEdit('');setNotice('');}} done={next=>{if(source.valid()){setIntake(next);setDetails(friendDetailsFromIntake(next));setIntakeProgress(undefined);setReviewed(true);setNotice('');setEdit('');setReview(kind==='friend');}}}/>;
  if(kind==='team'&&edit)return <GatheringDetailsEditor initialNotice={notice} initial={details} kind="team" section={edit} session={session} cancel={()=>{setEdit('');setNotice('');}} save={next=>{if(source.valid()){setDetails(next);setEdit('');}}}/>;
  if(preview)return <GatheringQuestionnaire details={details} initial={emptyGatheringIntake()} session={session} preview save={()=>{}} cancel={()=>setPreview(false)}/>;
  const disabled=write.busy||!!write.pending||write.blocked||subscription.busy;
  if(kind==='friend'){
    const start=()=>{if(!disabled&&source.valid()){setNotice('');setEdit('ai');}};
    if(review)return <GatheringFriendReview details={write.pending?.input.details??friendDetailsFromIntake(intake)} excludedDetails={!write.pending?retiredDetails:undefined} intake={write.pending?.input.intake??intake} busy={write.busy} locked={disabled} pending={!!write.pending} blocked={write.blocked} notice={[notice,write.message].filter(Boolean).join('\n')} back={()=>{if(!write.busy){setReview(false);setNotice('');}}} edit={start} publish={()=>void publish()} retry={()=>{if(source.valid())void write.send();}}/>;
    return <GatheringFriendStart intake={intake} reviewed={reviewed} hasProgress={!!intakeProgress} disabled={disabled} notice={notice} recoveryMessage={write.message} pending={!!write.pending} busy={write.busy} back={()=>void back()} start={start} resume={()=>{if(source.valid()&&!write.busy)resumeFriendReview();}}/>;
  }
  return <View className="gg-editor"><Button className="gg-back" disabled={write.busy} onClick={()=>review?setReview(false):void back()}>← {review?'返回修改':'返回首页'}</Button><Text className="gg-eyebrow">WEEVIBE / 一起出发</Text><Text className="gg-title">{review?'发出前，再看一眼':'一起团建'}</Text>
    {review?<View><View className="gg-panel peach"><Text className="gg-heading">{details.title||'一起团建'}</Text><Text>{details.date}</Text><Text className="gg-muted">{[details.start_time,details.place].filter(Boolean).join(' · ')||'具体时间与地点待定'}</Text><Text className="gg-muted">问卷 {details.questions.length+(details.candidate_places.length>1?1:0)} 题 · 候选地点 {details.candidate_places.length} 个</Text><Text className="gg-muted">{details.description}</Text></View><Text className="gg-notice">发起后朋友可以进入并填写；填写想法不等于已经同意最终安排，也不代表预订或付款。保存后可自愿开启微信提醒，每次同意可接收一条后续更新。</Text><Button className="gg-primary" disabled={disabled} loading={write.busy} onClick={()=>void publish()}>确认并发起活动</Button></View>:<View className="gg-planning team">
      <Button className="gg-planning-card lilac" disabled={disabled} onClick={()=>setEdit('questionnaire')}><Text className="gg-planning-icon">✧</Text><Text className="gg-badge">日期与问题</Text><Text className="gg-card-title">问卷设计</Text><Text className="gg-muted">{details.date?`${details.date} · ${details.questions.length} 道问题`:'把安排与问题放进一份问卷'}</Text><Text className="gg-corner">↗</Text></Button>
      <Button className="gg-planning-card soft-gray" disabled={disabled} onClick={()=>setEdit('details')}><Text className="gg-planning-icon">⋯</Text><Text className="gg-badge">选填</Text><Text className="gg-card-title">其他明细</Text><Text className="gg-muted">人数与费用</Text><Text className="gg-corner">↗</Text></Button>
    </View>}
    {notice&&<Text className="gg-notice error">{notice}</Text>}{write.message&&<Text className="gg-notice">{write.message}</Text>}
    {write.pending?<View className="gg-panel"><Text>上次发起结果待核对，原请求与草稿已保留。</Text><Button className="gg-secondary" disabled={write.busy} onClick={()=>void write.send()}>沿用原请求核对并重试</Button></View>:!review&&<Button className="gg-primary" disabled={disabled} onClick={beforeTeamPublish}>发起活动 ↗</Button>}
    {!review&&<Button className="gg-secondary" disabled={disabled} onClick={()=>setPreview(true)}>预览并试填问卷</Button>}
  </View>;
}
