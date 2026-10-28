import {useEffect,useRef,useState} from 'react';
import Taro from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import {ApiClientError} from '@weevibe/api-client';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringCreateSchema,gatheringDetailsSchema,gatheringIntakeSchema,type GatheringDetails,type GatheringIntake} from '@weevibe/contracts';
import {newKey} from '../../platform/local-id';
import {useStoredWrite} from '../../platform/write-state';
import {gatheringRequest,parseGatheringSnapshot} from './client';
import {useGatheringSource} from './use-source';
import {GatheringIntakeEditor} from './intake-editor';
import {GatheringDetailsEditor} from './details-editor';
import {GatheringQuestionnaire} from './questionnaire';
import {GatheringSubscription,useGatheringSubscription} from './subscription';

export function GatheringDesigner({actor,session,kind}:{actor:string;session:string;kind:'friend'|'team'}){
  const subscription=useGatheringSubscription(actor,session),pendingSubscription=useRef<Awaited<ReturnType<typeof subscription.requestFromTap>>>(),publishLock=useRef(false);
  const source=useGatheringSource(session),draftKey=`weevibe-gathering-draft-v1:${actor}:${kind}`,draft=useRef<unknown>();
  if(draft.current===undefined){try{draft.current=Taro.getStorageSync(draftKey)||null;}catch{draft.current=null;}}
  const savedDraft=draft.current as {actor?:string;details?:unknown;intake?:unknown;reviewed?:boolean}|null;
  const[details,setDetails]=useState<GatheringDetails>(()=>savedDraft?.actor===actor?gatheringDetailsSchema.safeParse(savedDraft.details).data??emptyGatheringDetails():emptyGatheringDetails());
  const[intake,setIntake]=useState<GatheringIntake>(()=>savedDraft?.actor===actor?gatheringIntakeSchema.safeParse(savedDraft.intake).data??emptyGatheringIntake():emptyGatheringIntake());
  const[reviewed,setReviewed]=useState(savedDraft?.actor===actor&&!!savedDraft.reviewed),[edit,setEdit]=useState<''|'ai'|'plan'|'details'|'questionnaire'>(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState(false),[review,setReview]=useState(false);
  useEffect(()=>{if(source.valid()){try{Taro.setStorageSync(draftKey,{actor,details,intake,reviewed});}catch{setNotice('本机草稿暂时无法保存，请保持当前页面。');}}},[details,intake,reviewed,draftKey]);
  const write=useStoredWrite({storageKey:`weevibe-gathering-create-pending-v1:${actor}:${kind}`,userId:actor,parse:v=>gatheringCreateSchema.parse(v),
    execute:input=>gatheringRequest(session,'/api/v1/gatherings','POST',input,raw=>{const value=parseGatheringSnapshot(raw);if(!value.viewer.is_owner||value.gathering.owner.user_id.toLowerCase()!==actor.toLowerCase()||value.gathering.kind!==kind)throw new ApiClientError('INVALID_RESPONSE','发起结果与当前身份或活动类型不符，请保留原请求并刷新核对。',200);return value;},source.ticket()),
    committed:snapshot=>{if(!source.valid())throw Error('STALE_GATHERING');Taro.setStorageSync(`weevibe-gathering-created-v1:${actor}`,{id:snapshot.gathering.id});Taro.removeStorageSync(draftKey);const intent=pendingSubscription.current;pendingSubscription.current=undefined;if(intent)void subscription.record(snapshot.gathering.id,intent);}});
  async function openCreated(){if(!source.valid()||!write.result)return;try{await Taro.redirectTo({url:`/pages/gathering/index?id=${write.result.gathering.id}`});}catch{if(source.valid())setNotice('页面暂时无法打开，筹备已保存，点击管理活动重试即可。');}}
  function beforePublish(){if(write.busy||write.pending||!source.valid())return;if(!details.date){setNotice(kind==='friend'?'请进入 AI 整理选择出游日期。':'请进入问卷设计选择日期。');return;}if(kind==='friend'&&!reviewed){setNotice('请先完成 AI 整理，并选择哪些内容已经确定。');return;}if(kind==='team'&&(!details.deadline_at||Date.parse(details.deadline_at)<=Date.now())){setNotice('请在问卷设计中设置未来的填写截止时间。');return;}setNotice('');setReview(true);}
  async function publish(){if(!source.valid()||write.busy||write.pending||publishLock.current||subscription.busy)return;const confirmed_details=(['date','title','start_time','end_date','end_time','place','address','description','approximate_time','minimum','capacity','fee'] as const).filter(key=>{const v=details[key];return key==='fee'?details.fee.amount!==null||!!details.fee.note:v!==''&&v!==null;});const input={kind,idempotency_key:newKey(),details:{...details,confirmed_details},intake};if(!gatheringCreateSchema.safeParse(input).success){setNotice('请检查人数、费用和填写内容。');return;}publishLock.current=true;const guard=source.ticket();try{pendingSubscription.current=await subscription.requestFromTap();guard();await write.send(input);}catch{if(source.valid())setNotice('当前页面或账号已变化，请重新打开。');}finally{publishLock.current=false;}}
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，请返回后重新打开。</Text>;
  if(write.result)return <View className="gg-editor"><Text className="gg-eyebrow">WEEVIBE / 一起出发</Text><Text className="gg-title">这次相聚已发起</Text><View className="gg-panel mint"><Text className="gg-heading">{write.result.gathering.title}</Text><Text>{write.result.gathering.date}</Text><Text className="gg-muted">可以分享邀请，让朋友填写自己的想法。预算和个人出发地点仅本人可见。</Text></View>{notice&&<Text className="gg-notice">{notice}</Text>}<GatheringSubscription value={subscription} gatheringId={write.result.gathering.id}/><Button className="gg-primary" disabled={subscription.busy} onClick={()=>void openCreated()}>管理活动</Button><Button className="gg-secondary" onClick={()=>void Taro.reLaunch({url:'/pages/index/index'})}>回到首页</Button></View>;
  if(edit==='ai')return <GatheringIntakeEditor initial={intake} session={session} date={details.date} cancel={()=>setEdit('')} done={next=>{if(source.valid()){setIntake(next);setDetails(d=>({...d,date:next.public.date||d.date}));setReviewed(true);setEdit('');}}}/>;
  if(edit)return <GatheringDetailsEditor initial={details} kind={kind} section={edit} session={session} cancel={()=>setEdit('')} save={next=>{if(source.valid()){setDetails(next);setEdit('');}}}/>;
  if(preview)return <GatheringQuestionnaire details={details} initial={emptyGatheringIntake()} session={session} preview save={()=>{}} cancel={()=>setPreview(false)}/>;
  const disabled=write.busy||!!write.pending||write.blocked||subscription.busy;
  return <View className="gg-editor"><Button className="gg-back" disabled={write.busy} onClick={()=>review?setReview(false):void Taro.navigateBack({fail:()=>void Taro.reLaunch({url:'/pages/index/index'})}).catch(()=>{})}>← {review?'返回修改':'返回首页'}</Button><Text className="gg-eyebrow">WEEVIBE / 一起出发</Text><Text className="gg-title">{review?'发出前，再看一眼':kind==='friend'?'朋友出游':'一起团建'}</Text>
    {review?<View><View className="gg-panel peach"><Text className="gg-heading">{details.title||(kind==='friend'?'朋友出游':'一起团建')}</Text><Text>{details.date}</Text><Text className="gg-muted">{[details.start_time,details.place].filter(Boolean).join(' · ')||'具体时间与地点待定'}</Text>{kind==='team'&&<Text className="gg-muted">问卷 {details.questions.length} 题 · 候选地点 {details.candidate_places.length} 个</Text>}<Text className="gg-muted">{details.description}</Text></View><Text className="gg-notice">发起后朋友可以进入并填写；填写想法不等于已经同意最终安排，也不代表预订或付款。发布时可选择接收微信提醒，每次同意可接收一条后续更新。</Text><Button className="gg-primary" disabled={disabled} loading={write.busy} onClick={()=>void publish()}>确认并发起活动</Button></View>:<View className={`gg-planning ${kind}`}>
      <Button className="gg-planning-card lilac" disabled={disabled} onClick={()=>setEdit(kind==='friend'?'ai':'questionnaire')}><Text className="gg-planning-icon">✧</Text><Text className="gg-badge">{kind==='friend'?'含日期':'日期与问题'}</Text><Text className="gg-card-title">{kind==='friend'?'AI整理':'问卷设计'}</Text><Text className="gg-muted">{kind==='friend'?(reviewed?`${Object.values(intake.public.keywords).flat().length} 个关键词 · ${details.date||'日期待选'}`:'有个想法，先记下来'):(details.date?`${details.date} · ${details.questions.length} 道问题`:'把安排与问题放进一份问卷')}</Text><Text className="gg-corner">↗</Text></Button>
      {kind==='friend'&&<Button className="gg-planning-card mint" disabled={disabled} onClick={()=>setEdit('plan')}><Text className="gg-planning-icon">☷</Text><Text className="gg-badge">选填</Text><Text className="gg-card-title">活动安排</Text><Text className="gg-muted">{details.title||details.place||'这次想一起做什么'}</Text><Text className="gg-corner">↗</Text></Button>}
      <Button className="gg-planning-card soft-gray" disabled={disabled} onClick={()=>setEdit('details')}><Text className="gg-planning-icon">⋯</Text><Text className="gg-badge">选填</Text><Text className="gg-card-title">其他明细</Text><Text className="gg-muted">人数与费用</Text><Text className="gg-corner">↗</Text></Button>
    </View>}
    {notice&&<Text className="gg-notice error">{notice}</Text>}{write.message&&<Text className="gg-notice">{write.message}</Text>}
    {write.pending?<View className="gg-panel"><Text>上次发起结果待核对，原请求与草稿已保留。</Text><Button className="gg-secondary" disabled={write.busy} onClick={()=>void write.send()}>沿用原请求核对并重试</Button></View>:!review&&<Button className="gg-primary" disabled={disabled} onClick={beforePublish}>发起活动 ↗</Button>}
    {kind==='team'&&!review&&<Button className="gg-secondary" disabled={disabled} onClick={()=>setPreview(true)}>预览并试填问卷</Button>}
  </View>;
}
