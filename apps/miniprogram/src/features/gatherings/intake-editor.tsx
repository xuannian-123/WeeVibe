import {requestMemory,memoryCategories} from './memory-client';
import {MemoryPanel} from './memory-panel';
import {GatheringFlowHeader} from './flow-header';
import {CAction} from '../design-c/ui';
import {useGatheringFormChrome} from './page-chrome';
import {GatheringPreferenceForm} from './preference-form';
import {useEffect,useRef,useState} from 'react';
import {gatheringProgressIntake,makeGatheringIntakeProgress,readGatheringIntakeProgress,type GatheringIntakeProgress} from './intake-progress';
import {Button,Text,View} from '@tarojs/components';
import {gatheringCertaintyBlocks,gatheringSections,gatheringOwnBlocks,gatheringIntakeSchema,type GatheringIntake} from '@weevibe/contracts';
import {gatheringMessage,organizeGathering} from './client';
import {useGatheringSource} from './use-source';
import {requestAccount} from '../../platform/account-api';
import {GatheringNicknameStep} from './nickname-step';
import {CInterviewView} from '../design-c/interview-view';
import {CInterviewInputs} from '../design-c/interview-inputs';
import {CInterviewReview} from '../design-c/interview-review';
import {applyInterviewPatch,interviewQuestions,interviewAnswerSummary,interviewAcknowledgement,parseInterviewAnswer} from './interview-flow';

function hasInterviewAnswer(value:GatheringIntake,index:number){
  if(index===0)return !!(value.public.date||value.public.availability.trim());
  if(index===1)return !!value.private.origin?.label.trim();
  if(index===2)return value.private.budget_min!==null||value.private.budget_max!==null||!!value.private.budget_note.trim();
  return gatheringSections.filter(section=>index===3?section.id==='do':section.id!=='do').some(section=>section.groups.some(group=>value.public.keywords[group.id].length>0))||(index===3&&Object.values(value.public.keyword_notes??{}).some(note=>!!note?.trim()))||(index===4&&!!value.public.note.trim());
}
function GatheringIntakeEditorInner({memoryBusyChanged,initial,session,date,done,cancel,saving=false,readOnly=false,readOnlyNotice,saveFeedback,participationNotice,creating=false,flow=false,activityLabel,submitLabel,draftProgress,onDraftProgress}:{memoryBusyChanged?:(busy:boolean)=>void;initial:GatheringIntake;session:string;date:string;saving?:boolean;readOnly?:boolean;readOnlyNotice?:string;done:(v:GatheringIntake)=>void;cancel:()=>void;saveFeedback?:{message:string;pending:boolean;busy:boolean;retry:()=>void};participationNotice?:string;creating?:boolean;flow?:boolean;activityLabel?:string;submitLabel?:string;draftProgress?:unknown;onDraftProgress?:(progress:GatheringIntakeProgress)=>void}){
  const source=useGatheringSource(session),lock=useRef(false),externalBlocked=useRef(saving||readOnly);externalBlocked.current=saving||readOnly;
  const restored=useRef<{progress?:GatheringIntakeProgress}>();
  if(!restored.current){
    const progress=onDraftProgress?readGatheringIntakeProgress(draftProgress):undefined;
    restored.current={progress:progress&&!(creating&&progress.confirm&&!progress.intake.public.date)?progress:undefined};
  }
  const restoredProgress=restored.current.progress,seed=restoredProgress?gatheringProgressIntake(restoredProgress):initial;
  const progressCallback=useRef(onDraftProgress);progressCallback.current=onDraftProgress;
  const progressEnabled=!!onDraftProgress;
  const[value,setValue]=useState<GatheringIntake>(()=>({...seed,public:{...seed.public,activity_nickname:seed.public.activity_nickname||'',date:restoredProgress?seed.public.date:seed.public.date||date}}));
  const[budgetMinText,setBudgetMinText]=useState(restoredProgress?.budgetMinText??(initial.private.budget_min===null?'':String(initial.private.budget_min))),[budgetMaxText,setBudgetMaxText]=useState(restoredProgress?.budgetMaxText??(initial.private.budget_max===null?'':String(initial.private.budget_max)));
  const[mode,setMode]=useState<'form'|'interview'>(restoredProgress?.mode??'form'),[step,setStep]=useState(restoredProgress?.step??0),[busy,setBusy]=useState(false),[notice,setNotice]=useState(restoredProgress?'已恢复上次未完成的填写，请核对后继续。':''),[summary,setSummary]=useState(restoredProgress?.summary??''),[confirm,setConfirm]=useState(restoredProgress?.confirm??false),[selected,setSelected]=useState<string[]>(restoredProgress?.selected??[]);
  useGatheringFormChrome(!confirm&&(readOnly||mode==='form'&&step>0));
  const[answered,setAnswered]=useState<boolean[]>(()=>restoredProgress?.answered??interviewQuestions.map((_,i)=>hasInterviewAnswer(initial,i)));
  const[noteBase,setNoteBase]=useState(restoredProgress?.noteBase??initial.public.note),[questionProse,setQuestionProse]=useState<Record<number,string>>(restoredProgress?.questionProse??{});
  const[acknowledgements,setAcknowledgements]=useState<Record<number,string>>(restoredProgress?.acknowledgements??{}),[composers,setComposers]=useState<Record<number,string>>(restoredProgress?.composers??{}),[organizeFailed,setOrganizeFailed]=useState(false);
  useEffect(()=>{
    if(!progressEnabled||readOnly||!source.valid())return;
    const progress=makeGatheringIntakeProgress({intake:value,mode,step,budgetMinText,budgetMaxText,answered,noteBase,questionProse,acknowledgements,composers,confirm,selected,summary});
    if(progress)progressCallback.current?.(progress);
  },[progressEnabled,readOnly,value,mode,step,budgetMinText,budgetMaxText,answered,noteBase,questionProse,acknowledgements,composers,confirm,selected,summary]);
  function editable(){return source.valid()&&!lock.current&&!externalBlocked.current;}
  function composeNote(base:string,prose:Record<number,string>){return [base,...Object.keys(prose).map(Number).sort().map(index=>prose[index])].filter(Boolean).join('\n');}
  function invalidate(indices:number[]){setAnswered(current=>current.map((done,i)=>indices.includes(i)?false:done));setAcknowledgements(current=>Object.fromEntries(Object.entries(current).filter(([index])=>!indices.includes(Number(index)))));setOrganizeFailed(false);}
  useEffect(()=>{memoryBusyChanged?.(busy);},[busy,memoryBusyChanged]);
  const publicField=(patch:Partial<GatheringIntake['public']>)=>{if(!editable())return;
    const affected:number[]=[];if('date' in patch||'availability' in patch)affected.push(0);if('note' in patch)affected.push(4);
    if(patch.keyword_notes)affected.push(3);
    if(patch.keywords)for(const section of gatheringSections)if(section.groups.some(group=>JSON.stringify(patch.keywords?.[group.id])!==JSON.stringify(value.public.keywords[group.id])))affected.push(section.id==='do'?3:4);
    const prose={...questionProse};for(const index of affected)if(index>=3)delete prose[index];
    if('note' in patch){setNoteBase(patch.note||'');setQuestionProse({});}else setQuestionProse(prose);
    setValue(v=>({...v,public:{...v.public,...patch,note:'note' in patch?patch.note||'':composeNote(noteBase,prose),confirmed_keys:v.public.confirmed_keys.filter(id=>{if(id==='date')return !('date' in patch)||patch.date===v.public.date;const group=id.split('_')[0] as 'eat'|'drink'|'play';return !(['eat','drink','play'].includes(group)&&((patch.keywords&&JSON.stringify(patch.keywords[group])!==JSON.stringify(v.public.keywords[group]))||(patch.keyword_notes&&patch.keyword_notes[group]!==v.public.keyword_notes?.[group])));})}}));setNotice('');invalidate(affected);
  };
  const privateField=(patch:Partial<GatheringIntake['private']>)=>{if(!editable())return;setValue(v=>({...v,private:{...v.private,...patch,confirmed_keys:[]}}));setNotice('');invalidate(['origin' in patch?1:-1,'budget_min' in patch||'budget_max' in patch||'budget_note' in patch?2:-1]);};
  function selectKeyword(group:typeof gatheringSections[number]['groups'][number],option:string){const values=value.public.keywords[group.id];publicField({keywords:{...value.public.keywords,[group.id]:values.includes(option)?values.filter(x=>x!==option):[...values,option]},...(values.includes(option)?{selected_places:value.public.selected_places?.filter(p=>p.group!==group.id||p.option!==option),keyword_notes:{...value.public.keyword_notes,...(value.public.keyword_notes?.[group.id as 'eat'|'drink'|'play']?.startsWith(option+'：')?{[group.id]:''}:{})}}:{})});}
  function beginConfirmation(text:string){if(!source.valid()||externalBlocked.current)return;if(!validNickname()){setNotice('请先填写本次活动昵称，再整理活动想法。');return;}const checked=gatheringIntakeSchema.parse(value);gatheringOwnBlocks(checked);const blocks=gatheringCertaintyBlocks(checked),allowed=new Set(blocks.map(b=>b.id));setSummary((text.includes('尚未经 AI 总结')?'按已填内容整理，尚未经 AI 总结。\n':'')+blocks.map(b=>`${b.label}：${b.value}`).join('；'));setSelected([...new Set([...value.public.confirmed_keys])].filter(id=>allowed.has(id)));setConfirm(true);}
  async function organize(){if(lock.current||saving||readOnly||!source.valid())return;if(!validNickname()){setNotice('请先填写本次活动昵称，再整理活动想法。');setStep(0);return;}let checked:GatheringIntake;try{checked=gatheringIntakeSchema.parse(value);gatheringOwnBlocks(checked);}catch(e){setNotice(e instanceof Error&&e.name!=='ZodError'?e.message:'请检查预算和填写内容');return;}
    if(creating&&!checked.public.date){setNotice('请先选择出游日期，再继续整理并预览活动。');setStep(1);return;}
    lock.current=true;setBusy(true);setNotice('');setOrganizeFailed(false);const ticket=source.ticket();const guard=()=>{ticket();if(externalBlocked.current)throw Error('STALE_GATHERING');};try{const result=await organizeGathering(session,preferencesForAI(checked),guard);guard();beginConfirmation(result.summary);}catch(e){if(source.valid()&&!externalBlocked.current&&!(e instanceof Error&&e.message==='STALE_GATHERING')){setNotice(gatheringMessage(e));setOrganizeFailed(true);}}finally{lock.current=false;if(source.alive())setBusy(false);}}
  function commit(){if(saving||readOnly||!source.valid()||!validNickname())return;const publicIds=new Set(gatheringCertaintyBlocks(value).map(b=>b.id));done({...value,public:{...value.public,activity_nickname:value.public.activity_nickname.trim(),confirmed_keys:selected.filter(id=>publicIds.has(id))},private:{...value.private,confirmed_keys:[]}});}
  function validNickname(){const nickname=value.public.activity_nickname.trim();return nickname.length>0&&nickname.length<=32;}
  function nicknameField(nickname:string){if(source.valid()&&!lock.current&&!externalBlocked.current){setValue(v=>({...v,public:{...v.public,activity_nickname:nickname}}));setNotice('');}}
  function preferencesForAI(intake:GatheringIntake){const{activity_nickname:activityNickname,...preferences}=intake.public;void activityNickname;return {...preferences,confirmed_keys:preferences.confirmed_keys.filter(id=>gatheringCertaintyBlocks(intake).some(block=>block.id===id))};}
  async function adoptProfileNickname(){
    if(lock.current||!source.valid()||externalBlocked.current)return;lock.current=true;setBusy(true);setNotice('');const ticket=source.ticket();
    const guard=()=>{ticket();if(externalBlocked.current)throw Error('STALE_GATHERING');};
    try{const account=await requestAccount(session);guard();const nickname=account.profile.nickname?.trim()||'';if(!nickname||nickname.length>32){setNotice('小程序昵称尚未保存，请自行填写本次活动昵称，直接填写即可。');return;}setValue(v=>({...v,public:{...v.public,activity_nickname:nickname}}));}
    catch(error){if(source.valid()&&!externalBlocked.current&&!(error instanceof Error&&error.message==='STALE_GATHERING'))setNotice('暂时无法读取已保存的小程序昵称，可重试或自行填写。');}
    finally{lock.current=false;if(source.alive())setBusy(false);}
  }
  function nextMissing(completed:boolean[],current=-1){const later=completed.findIndex((done,i)=>i>current&&!done);return later>=0?later:completed.findIndex(done=>!done);}
  function nextStep(){if(!editable())return;if(mode==='form'&&step===1&&!gatheringIntakeSchema.safeParse(value).success){setNotice('请检查预算：金额需为非负数，最多两位小数，最高不能低于最低。');return;}if(creating&&mode==='form'&&step===1&&!value.public.date){setNotice('请先选择出游日期，再继续填写偏好。');return;}if(step===0){if(!validNickname()){setNotice('请填写 1—32 字的本次活动昵称。');return;}nicknameField(value.public.activity_nickname.trim());if(mode==='interview'){const missing=nextMissing(answered);setStep((missing<0?4:missing)+1);return;}}if(mode==='form'&&step>0){try{gatheringOwnBlocks(value);}catch(error){setNotice(error instanceof Error?error.message:'请检查当前填写内容。');return;}}setNotice('');setStep(step+1);}
  function completeQuestion(index:number,acknowledgement:string){
    const completed=answered.map((done,i)=>i===index?true:done);setAnswered(completed);setAcknowledgements(current=>({...current,[index]:acknowledgement}));setNotice('');setOrganizeFailed(false);
    // Revisiting an answered question must still advance when no answers are missing.
    const next=nextMissing(completed,index);setStep((next<0?Math.min(index+1,interviewQuestions.length-1):next)+1);
  }
  function submitText(text:string){
    if(!editable())return;const index=step-1,prose={...questionProse};delete prose[index];
    const base=index>=3?{...value,public:{...value.public,note:composeNote(noteBase,prose)}}:value;
    const result=parseInterviewAnswer(index,text,base);
    if(result.status==='clarify'){setNotice(result.message);return;}
    const next=applyInterviewPatch(base,result.patch);
    if(index>=3){if(result.patch.public?.note!==undefined&&result.patch.public.note!==base.public.note)prose[index]=text.trim();next.public.note=composeNote(noteBase,prose);setQuestionProse(prose);}
    setValue(next);setBudgetMinText(next.private.budget_min===null?'':String(next.private.budget_min));setBudgetMaxText(next.private.budget_max===null?'':String(next.private.budget_max));setComposers(current=>({...current,[index]:''}));completeQuestion(index,result.acknowledgement);
  }
  function submitControls(){
    if(!editable())return;const index=step-1;if(composers[index]?.trim()){setNotice('输入框里还有未发送的回答，请先发送或清空，再确认填写卡片。');return;}
    try{const checked=gatheringIntakeSchema.parse(value);gatheringOwnBlocks(checked);if(!hasInterviewAnswer(checked,index)){setNotice(interviewQuestions[index]?.private?'可以填写这一题，或明确选择“愿意配合”。':'可以填写这一题，或明确选择“先留待定”。');return;}completeQuestion(index,interviewAcknowledgement(index,checked));}catch{setNotice('请检查这一题的日期、预算和填写内容，再继续。');}
  }
  function skipQuestion(){
    if(!editable())return;const index=step-1;if(composers[index]?.trim()){setNotice('输入框里还有未发送的回答，请先发送或清空，再选择待定。');return;}
    if(interviewQuestions[index]?.private){const result=parseInterviewAnswer(index,'愿意配合',value);if(result.status!=='accepted'){setNotice(result.message);return;}const next=applyInterviewPatch(value,result.patch);setValue(next);setBudgetMinText(next.private.budget_min===null?'':String(next.private.budget_min));setBudgetMaxText(next.private.budget_max===null?'':String(next.private.budget_max));completeQuestion(index,result.acknowledgement);return;}
    completeQuestion(index,'这一题先留待商量，已有填写仍保留在草稿中。');
  }
  function manualOrganization(){if(!editable()||!organizeFailed)return;try{beginConfirmation('按你填写的内容整理，以下尚未经 AI 总结。');}catch{setNotice('请先检查预算和输入内容。');}}
  function leave(){if(editable())cancel();}
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，原填写内容已隐藏，请返回后重新打开。</Text>;
  if(readOnly){const blocks=gatheringOwnBlocks(initial),privateBlock=(id:string)=>id==='budget'||id==='origin',leave=()=>{if(source.valid()&&!saving)cancel();};return <View className="c-ui gf-start gw-flow"><GatheringFlowHeader back={leave} disabled={saving}/><View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / 本人内容</Text><Text className="gf-title">我的整理内容</Text><View className="gf-marker"/></View><Text className="gp-caption">{readOnlyNotice||'活动已定案，以下为本人的已保存内容，仅供查看。预算和个人出发地点始终仅本人可见。'}</Text><View className="gp-panel"><Text className="gp-section-title">本次活动昵称</Text><Text className="gp-caption">{initial.public.activity_nickname||'暂未设置'}</Text></View>{[false,true].map(privateOnly=><View key={String(privateOnly)} className={`gp-panel ${privateOnly?'gp-private':''}`}><Text className="gp-section-title">{privateOnly?'仅本人可见的补充':'我的公开内容'}</Text>{blocks.filter(b=>privateBlock(b.id)===privateOnly).map(block=><View key={block.id}><Text className="gp-caption">{block.label} · {block.confirmed?'已确定':'待商量'}</Text><Text className="gp-section-title">{block.value}</Text></View>)}{!blocks.some(b=>privateBlock(b.id)===privateOnly)&&<Text className="gp-caption">暂未填写。</Text>}</View>)}<CAction disabled={saving} onClick={leave}>返回</CAction></View>;}
  if(confirm)return <CInterviewReview formLayout={mode==='form'} commitLabel={submitLabel} blocks={gatheringCertaintyBlocks(value)} selected={selected} summary={summary} saving={saving} onToggle={id=>{if(editable())setSelected(current=>current.includes(id)?current.filter(key=>key!==id):[...current,id]);}} onCommit={commit} onBack={()=>{if(editable())setConfirm(false);}} participationNotice={participationNotice} notice={saveFeedback?.message||(restoredProgress?'上次整理的内容已恢复，请重新核对确定项后继续。':undefined)} sourceLabel={mode==='form'?'填表 · 整理结果':undefined} retryBusy={saveFeedback?.busy} onRetry={saveFeedback?.pending?()=>{if(source.valid()&&!saveFeedback.busy)saveFeedback.retry();}:undefined}/>;
  const nicknameStep=step===0,contentStep=step-1;
  const basic=!nicknameStep&&(mode==='form'?contentStep===0:contentStep<=2);
  const availability=basic&&(mode==='form'||contentStep===0),origin=basic&&(mode==='form'||contentStep===1),budget=basic&&(mode==='form'||contentStep===2);
  const sections=mode==='form'?gatheringSections.filter((_,i)=>i===contentStep-1):contentStep===3?gatheringSections.filter(s=>s.id==='do'):contentStep===4?gatheringSections.filter(s=>s.id!=='do'):[];
  function clearStep(){
    if(!editable())return;
    const clearFormNote=mode==='form'&&(contentStep===0||contentStep===2);if(clearFormNote){setNoteBase('');setQuestionProse({});}
    const prose={...questionProse};const clearedQuestions=mode==='interview'?[contentStep]:sections.map(section=>section.id==='do'?3:4);for(const index of clearedQuestions)delete prose[index];if(mode==='interview'&&contentStep===4)setNoteBase('');setQuestionProse(prose);
    setValue(current=>{const next={...current,public:{...current.public,keywords:{...current.public.keywords},confirmed_keys:[...current.public.confirmed_keys]},private:{...current.private,confirmed_keys:current.private.confirmed_keys.filter(id=>!(origin&&id==='origin'||budget&&id==='budget'))}};
      if(nicknameStep)next.public.activity_nickname='';
      if(availability){next.public.date='';next.public.availability='';next.public.confirmed_keys=next.public.confirmed_keys.filter(id=>id!=='date');}
      if(origin)next.private.origin=null;
      if(budget){next.private.budget_min=null;next.private.budget_max=null;next.private.budget_note='';}
      for(const section of sections)for(const group of section.groups){next.public.keywords[group.id]=[];next.public.confirmed_keys=next.public.confirmed_keys.filter(id=>!id.startsWith(group.id+'_')); if(section.id==='do'){const doGroup=group.id as 'eat'|'drink'|'play';next.public.keyword_notes={...next.public.keyword_notes,[doGroup]:''};next.public.selected_places=next.public.selected_places?.filter(place=>place.group!==doGroup);}}
      if(clearFormNote){next.public.note='';next.public.confirmed_keys=next.public.confirmed_keys.filter(id=>id!=='note');}
      else if(clearedQuestions.some(index=>index>=3))next.public.note=composeNote(mode==='interview'&&contentStep===4?'':noteBase,prose);
      return next;});
    if(budget){setBudgetMinText('');setBudgetMaxText('');}if(mode==='interview'){const index=step-1;setAnswered(current=>current.map((done,i)=>i===index?false:done));setAcknowledgements(current=>({...current,[index]:''}));setComposers(current=>({...current,[index]:''}));}else invalidate(contentStep===0?[0,1,2,4]:[contentStep===1?3:4]);setOrganizeFailed(false);setNotice('');
  }
  if(nicknameStep)return <GatheringNicknameStep creating={creating||flow} activityLabel={activityLabel} value={value.public.activity_nickname} mode={mode} busy={busy} saving={saving} notice={notice} change={nicknameField} switchMode={next=>{if(source.valid()&&!busy&&!saving){setMode(next);setStep(0);}}} adopt={()=>void adoptProfileNickname()} next={nextStep} cancel={()=>{if(source.valid()&&!busy&&!saving)cancel();}}/>;
  if(mode==='interview')return <CInterviewView nickname={value.public.activity_nickname} index={contentStep} turns={interviewQuestions.map((question,index)=>({question:question.title,private:question.private,answer:interviewAnswerSummary(index,value,answered[index]),answered:answered[index],acknowledgement:acknowledgements[index]}))} disabled={saving||readOnly} busy={busy} notice={notice}
    activeInput={<CInterviewInputs index={contentStep} value={value} session={session} disabled={saving||busy} budgetMin={budgetMinText} budgetMax={budgetMaxText} publicChange={publicField} privateChange={privateField} select={selectKeyword} minChange={text=>{if(editable()){setBudgetMinText(text);privateField({budget_min:text.trim()?Number(text):null});}}} maxChange={text=>{if(editable()){setBudgetMaxText(text);privateField({budget_max:text.trim()?Number(text):null});}}}/>}
    composer={composers[contentStep]||''} onComposerChange={text=>{if(editable())setComposers(current=>({...current,[contentStep]:text}));}} onSend={submitText} onNext={submitControls} onSkip={skipQuestion} onClearCurrent={clearStep}
    onJump={index=>{if(editable()&&interviewQuestions[index]){setStep(index+1);setNotice('');}}} onBack={()=>{if(editable()){setStep(0);setNotice('');}}} onSwitchForm={()=>{if(editable()){setMode('form');setStep(1);setNotice('');}}} canSummarize={answered.every(Boolean)&&!Object.values(composers).some(text=>text.trim())} onSummarize={()=>{if(answered.every(Boolean)&&!Object.values(composers).some(text=>text.trim()))void organize();}} onManualFallback={organizeFailed?manualOrganization:undefined}/>;
  return <GatheringPreferenceForm value={value} session={session} step={step} budgetMin={budgetMinText} budgetMax={budgetMaxText} creating={creating} busy={busy} saving={saving} notice={notice} organizeFailed={organizeFailed}
    publicChange={publicField} privateChange={privateField} select={selectKeyword}
    minChange={text=>{if(editable()){setBudgetMinText(text);privateField({budget_min:text.trim()?Number(text):null});}}} maxChange={text=>{if(editable()){setBudgetMaxText(text);privateField({budget_max:text.trim()?Number(text):null});}}}
    previous={()=>{if(editable()){setNotice('');setStep(Math.max(0,step-1));}}} next={nextStep} switchMode={()=>{if(editable()){setMode('interview');setStep(0);setNotice('');}}} clear={clearStep} cancel={leave} organize={()=>void organize()} manual={manualOrganization}/>;
}

export function GatheringIntakeEditor(props:Parameters<typeof GatheringIntakeEditorInner>[0]){
 const [innerBusy,setInnerBusy]=useState(false);
 const [seed,setSeed]=useState<GatheringIntake>(),[notice,setNotice]=useState(''),[useHistory,setUseHistory]=useState(true),[remove,setRemove]=useState(false),[settings,setSettings]=useState(false);
 const automatic=useRef<Record<string,string[]>>(props.initial.private.preference_memory?.automatic??{});
 useEffect(()=>{if(props.readOnly)return;let active=true;void requestMemory(props.session).then(v=>{
  if(!active)return;const next=JSON.parse(JSON.stringify(props.initial)) as GatheringIntake;
  if(v.recommending&&!props.readOnly&&!props.draftProgress)for(const p of v.profiles)if(!next.public.keywords[p.category].length){next.public.keywords[p.category]=p.values;automatic.current[p.category]=p.values;}
  if(Object.keys(automatic.current).length)setNotice('已参考你之前的活动偏好，可修改');
  setUseHistory(v.recommending);setSeed(next);
 }).catch(()=>{if(active){setSeed(props.initial);setUseHistory(false);setNotice('偏好记忆暂不可用，本次继续正常填写。');}});return()=>{active=false;};},[props.session]);
 if(!seed&&!props.readOnly)return <Text>正在读取偏好设置…</Text>;
 return <>{!props.readOnly&&<View><Text>{notice}</Text><Button disabled={innerBusy||props.saving} onClick={()=>setSettings(v=>!v)}>自动记住我的组局偏好 / 设置</Button>{settings&&!innerBusy&&!props.saving&&<MemoryPanel session={props.session}/>}
 <Button disabled={innerBusy||props.saving} onClick={()=>setUseHistory(v=>!v)}>{useHistory?'本次不用历史偏好':'本次使用历史偏好'}</Button>{!useHistory&&<Button disabled={innerBusy||props.saving} onClick={()=>setRemove(v=>!v)}>{remove?'已选择移除未修改带入项':'保留已带入内容；点此改为移除未修改项'}</Button>}</View>}
 <GatheringIntakeEditorInner {...props} memoryBusyChanged={setInnerBusy} initial={seed??props.initial} done={value=>{
 const next=JSON.parse(JSON.stringify(value)) as GatheringIntake;const unchanged:Record<string,string[]>={};
 for(const category of memoryCategories)if(automatic.current[category]&&JSON.stringify(next.public.keywords[category])===JSON.stringify(automatic.current[category])){unchanged[category]=automatic.current[category];if(!useHistory&&remove)next.public.keywords[category]=[];}
 next.private.preference_memory={use_history:useHistory,retain_automatic:!remove,automatic:unchanged};props.done(next);
 }}/></>;
}
