import {useGatheringFormChrome} from './page-chrome';
import {GatheringFormFooter} from './form-footer';
import {useRef,useState} from 'react';
import {Button,Text,View} from '@tarojs/components';
import {gatheringCertaintyBlocks,gatheringSections,gatheringOwnBlocks,gatheringIntakeSchema,type GatheringIntake} from '@weevibe/contracts';
import {GatheringField} from './fields';
import {GatheringOrigin} from './origin-search';
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
const stepTitles=['活动昵称','基本偏好','干什么','想要','想避开'];
export function GatheringIntakeEditor({initial,session,date,done,cancel,saving=false,readOnly=false,saveFeedback,participationNotice}:{initial:GatheringIntake;session:string;date:string;saving?:boolean;readOnly?:boolean;done:(v:GatheringIntake)=>void;cancel:()=>void;saveFeedback?:{message:string;pending:boolean;busy:boolean;retry:()=>void};participationNotice?:string}){
  const source=useGatheringSource(session),lock=useRef(false),externalBlocked=useRef(saving||readOnly);externalBlocked.current=saving||readOnly;
  const[value,setValue]=useState<GatheringIntake>(()=>({...initial,public:{...initial.public,activity_nickname:initial.public.activity_nickname||'',date:initial.public.date||date}}));
  const[budgetMinText,setBudgetMinText]=useState(initial.private.budget_min===null?'':String(initial.private.budget_min)),[budgetMaxText,setBudgetMaxText]=useState(initial.private.budget_max===null?'':String(initial.private.budget_max));
  const[mode,setMode]=useState<'form'|'interview'>('form'),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[summary,setSummary]=useState(''),[confirm,setConfirm]=useState(false),[selected,setSelected]=useState<string[]>([]);
  useGatheringFormChrome(readOnly||mode==='form'&&step>0);
  const[answered,setAnswered]=useState<boolean[]>(()=>interviewQuestions.map((_,i)=>hasInterviewAnswer(initial,i)));
  const[noteBase,setNoteBase]=useState(initial.public.note),[questionProse,setQuestionProse]=useState<Record<number,string>>({});
  const[acknowledgements,setAcknowledgements]=useState<Record<number,string>>({}),[composers,setComposers]=useState<Record<number,string>>({}),[organizeFailed,setOrganizeFailed]=useState(false);
  function editable(){return source.valid()&&!lock.current&&!externalBlocked.current;}
  function composeNote(base:string,prose:Record<number,string>){return [base,...Object.keys(prose).map(Number).sort().map(index=>prose[index])].filter(Boolean).join('\n');}
  function invalidate(indices:number[]){setAnswered(current=>current.map((done,i)=>indices.includes(i)?false:done));setAcknowledgements(current=>Object.fromEntries(Object.entries(current).filter(([index])=>!indices.includes(Number(index)))));setOrganizeFailed(false);}
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
  function nextStep(){if(!editable())return;if(step===0){if(!validNickname()){setNotice('请填写 1—32 字的本次活动昵称。');return;}nicknameField(value.public.activity_nickname.trim());if(mode==='interview'){const missing=nextMissing(answered);setStep((missing<0?4:missing)+1);return;}}setStep(s=>s+1);}
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
  if(readOnly){const blocks=gatheringOwnBlocks(initial),privateBlock=(id:string)=>id==='budget'||id==='origin',leave=()=>{if(source.valid()&&!saving)cancel();};return <View className="gg-editor"><Button className="gg-back" disabled={saving} onClick={leave}>← 返回管理活动</Button><Text className="gg-eyebrow">朋友出游 / 本人内容</Text><Text className="gg-title">我的整理内容</Text><Text className="gg-notice">活动已定案，以下为本人的已保存内容，仅供查看。预算和个人出发地点始终仅本人可见。</Text><View className="gg-panel mint"><Text className="gg-label">本次活动昵称</Text><Text>{initial.public.activity_nickname||'暂未设置'}</Text></View>{[false,true].map(privateOnly=><View key={String(privateOnly)} className={`gg-panel ${privateOnly?'lilac':''}`}><Text className="gg-heading">{privateOnly?'仅本人可见的补充':'我的公开内容'}</Text><View className="gg-blocks">{blocks.filter(b=>privateBlock(b.id)===privateOnly).map(block=><View key={block.id} className={`gg-block ${block.confirmed?'confirmed':''}`}><Text className="gg-block-label">{block.label} · {block.confirmed?'已确定':'待商量'}</Text><Text>{block.value}</Text></View>)}</View>{!blocks.some(b=>privateBlock(b.id)===privateOnly)&&<Text className="gg-muted">暂未填写。</Text>}</View>)}<Button className="gg-secondary" disabled={saving} onClick={leave}>返回</Button></View>;}
  if(confirm&&mode==='interview')return <CInterviewReview blocks={gatheringCertaintyBlocks(value)} selected={selected} summary={summary} saving={saving} onToggle={id=>{if(editable())setSelected(current=>current.includes(id)?current.filter(key=>key!==id):[...current,id]);}} onCommit={commit} onBack={()=>{if(editable())setConfirm(false);}} participationNotice={participationNotice} notice={saveFeedback?.message} retryBusy={saveFeedback?.busy} onRetry={saveFeedback?.pending?()=>{if(source.valid()&&!saveFeedback.busy)saveFeedback.retry();}:undefined}/>;
  if(confirm){const blocks=gatheringCertaintyBlocks(value);return <View className="gg-editor gg-confirm-screen gg-with-footer"><Text className="gg-eyebrow">AI 整理 / 再确认一步</Text><Text className="gg-title">哪些内容已经确定了？</Text><Text className="gg-muted">可多选，也可以一个都不选。这里只确认日期和吃、喝、玩的内容。</Text>{summary&&<View className="gg-panel lilac"><Text>{summary}</Text></View>}<View className="gg-blocks">{blocks.map(block=><Button key={block.id} className={`gg-block gg-confirm-block ${selected.includes(block.id)?'selected':''}`} disabled={saving} onClick={()=>{if(source.valid()&&!saving)setSelected(s=>s.includes(block.id)?s.filter(id=>id!==block.id):[...s,block.id]);}}><Text className="gg-block-label">{block.label}</Text><Text>{block.value}</Text><Text className="gg-confirm-mark">{selected.includes(block.id)?'已选':'点选确定'}</Text></Button>)}</View>{!blocks.length&&<Text className="gg-muted">暂未填写偏好，可以先保留待定。</Text>}<GatheringFormFooter><Button className="gg-primary" disabled={saving} loading={saving} onClick={commit}>{selected.length?'这些是已经确定了的':'还都没确定'}</Button><Button className="gg-secondary" disabled={saving} onClick={()=>setConfirm(false)}>返回修改</Button></GatheringFormFooter></View>;}
  const count=mode==='interview'?6:5,nicknameStep=step===0,contentStep=step-1;
  const basic=!nicknameStep&&(mode==='form'?contentStep===0:contentStep<=2);
  const availability=basic&&(mode==='form'||contentStep===0),origin=basic&&(mode==='form'||contentStep===1),budget=basic&&(mode==='form'||contentStep===2);
  const sections=mode==='form'?gatheringSections.filter((_,i)=>i===contentStep-1):contentStep===3?gatheringSections.filter(s=>s.id==='do'):contentStep===4?gatheringSections.filter(s=>s.id!=='do'):[];
  function clearStep(){
    if(!editable())return;
    const prose={...questionProse};const clearedQuestions=mode==='interview'?[contentStep]:sections.map(section=>section.id==='do'?3:4);for(const index of clearedQuestions)delete prose[index];if(mode==='interview'&&contentStep===4)setNoteBase('');setQuestionProse(prose);
    setValue(current=>{const next={...current,public:{...current.public,keywords:{...current.public.keywords},confirmed_keys:[]},private:{...current.private,confirmed_keys:[]}};
      if(nicknameStep)next.public.activity_nickname='';
      if(availability){next.public.date='';next.public.availability='';}
      if(origin)next.private.origin=null;
      if(budget){next.private.budget_min=null;next.private.budget_max=null;next.private.budget_note='';}
      for(const section of sections)for(const group of section.groups){next.public.keywords[group.id]=[];if(section.id==='do'){const doGroup=group.id as 'eat'|'drink'|'play';next.public.keyword_notes={...next.public.keyword_notes,[doGroup]:''};next.public.selected_places=next.public.selected_places?.filter(place=>place.group!==doGroup);}}
      if(clearedQuestions.some(index=>index>=3))next.public.note=composeNote(mode==='interview'&&contentStep===4?'':noteBase,prose);
      return next;});
    if(budget){setBudgetMinText('');setBudgetMaxText('');}if(mode==='interview'){const index=step-1;setAnswered(current=>current.map((done,i)=>i===index?false:done));setAcknowledgements(current=>({...current,[index]:''}));setComposers(current=>({...current,[index]:''}));}else invalidate(contentStep===0?[0,1,2,4]:[contentStep===1?3:4]);setOrganizeFailed(false);setNotice('');
  }
  if(nicknameStep)return <GatheringNicknameStep value={value.public.activity_nickname} mode={mode} busy={busy} saving={saving} notice={notice} change={nicknameField} switchMode={next=>{if(source.valid()&&!busy&&!saving){setMode(next);setStep(0);}}} adopt={()=>void adoptProfileNickname()} next={nextStep} cancel={()=>{if(source.valid()&&!busy&&!saving)cancel();}}/>;
  if(mode==='interview')return <CInterviewView nickname={value.public.activity_nickname} index={contentStep} turns={interviewQuestions.map((question,index)=>({question:question.title,private:question.private,answer:interviewAnswerSummary(index,value,answered[index]),answered:answered[index],acknowledgement:acknowledgements[index]}))} disabled={saving||readOnly} busy={busy} notice={notice}
    activeInput={<CInterviewInputs index={contentStep} value={value} session={session} disabled={saving||busy} budgetMin={budgetMinText} budgetMax={budgetMaxText} publicChange={publicField} privateChange={privateField} select={selectKeyword} minChange={text=>{if(editable()){setBudgetMinText(text);privateField({budget_min:text.trim()?Number(text):null});}}} maxChange={text=>{if(editable()){setBudgetMaxText(text);privateField({budget_max:text.trim()?Number(text):null});}}}/>}
    composer={composers[contentStep]||''} onComposerChange={text=>{if(editable())setComposers(current=>({...current,[contentStep]:text}));}} onSend={submitText} onNext={submitControls} onSkip={skipQuestion} onClearCurrent={clearStep}
    onJump={index=>{if(editable()&&interviewQuestions[index]){setStep(index+1);setNotice('');}}} onBack={()=>{if(editable()){setStep(0);setNotice('');}}} onSwitchForm={()=>{if(editable()){setMode('form');setStep(1);setNotice('');}}} canSummarize={answered.every(Boolean)&&!Object.values(composers).some(text=>text.trim())} onSummarize={()=>{if(answered.every(Boolean)&&!Object.values(composers).some(text=>text.trim()))void organize();}} onManualFallback={organizeFailed?manualOrganization:undefined}/>;
  return <View className="gg-editor gg-with-footer"><Button className="gg-back" disabled={busy||saving} onClick={leave}>← 返回</Button><Text className="gg-title">AI 整理</Text><View className="gg-mode"><Button className={mode==='form'?'active':''} disabled={busy||saving} onClick={()=>{setMode('form');setStep(0);}}>填表</Button><Button className="" disabled={busy||saving} onClick={()=>{setMode('interview');setStep(0);}}>小橘头（AI问答）</Button></View>
    <Text className="gg-muted">公开想法可由同次出游成员查看；私密信息留在本人栏位，整理请求不发送私密信息。</Text>
    <View className="gg-step-header"><Text>{stepTitles[step]}</Text><Text>{step+1} / {count}</Text></View>
    {basic&&<View className="gg-panel"><Text className="gg-muted">出发地或预算留空，默认愿意配合其他人的安排；不代表免费或已同意最终安排。</Text>{availability&&<><GatheringField label="出游日期" value={value.public.date} type="date" disabled={busy||saving} change={date=>publicField({date})}/><GatheringField label="什么时间有空" value={value.public.availability} disabled={busy||saving} placeholder="例如：下午2点后都可以" change={availability=>publicField({availability})}/></>}{origin&&<GatheringOrigin session={session} disabled={saving||busy} value={value.private.origin} change={origin=>privateField({origin})}/>}{budget&&<><Text className="gg-heading">我的预算 <Text className="gg-private-tag">仅本人</Text></Text><View className="gg-pair"><GatheringField label="最低（元）" value={budgetMinText} type="digit" disabled={busy||saving} placeholder="不限" change={v=>{setBudgetMinText(v);privateField({budget_min:v.trim()?Number(v):null});}}/><GatheringField label="最高（元）" value={budgetMaxText} type="digit" disabled={busy||saving} placeholder="不限" change={v=>{setBudgetMaxText(v);privateField({budget_max:v.trim()?Number(v):null});}}/></View><GatheringField label="预算备注" value={value.private.budget_note} disabled={busy||saving} privateField change={budget_note=>privateField({budget_note})}/></>}
      {mode==='form'&&<GatheringField label="想法" type="area" value={value.public.note} disabled={busy||saving} placeholder="写下想一起做的事；预算与个人出发地址请填写在私密栏位" change={note=>publicField({note})}/>}</View>}
    {sections.map(section=><View className="gg-panel" key={section.id}><Text className="gg-heading">{section.title}</Text>{section.groups.map(group=><View className="gg-keyword-group" key={group.id}><Text className="gg-label">{group.title}</Text><View className="gg-chips">{group.options.map(option=><Button key={option} disabled={busy||saving} className={value.public.keywords[group.id].includes(option)?'selected':''} onClick={()=>selectKeyword(group,option)}>{option}</Button>)}</View>{section.id==='do'&&<GatheringField label={`${group.title}：具体地点或补充`} type="area" maxLength={500} disabled={busy||saving} value={value.public.keyword_notes?.[group.id as 'eat'|'drink'|'play']||''} change={text=>publicField({keyword_notes:{...value.public.keyword_notes,[group.id]:text}})}/>}</View>)}</View>)}
    <Button className="gg-link" disabled={busy||saving} onClick={clearStep}>清空这一页</Button><View className="gg-inline gg-step-nav"><Button className="gg-link" disabled={busy||saving||step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>← 上一页</Button>{step<count-1&&<Button className="gg-soft" disabled={busy||saving} onClick={nextStep}>下一步 →</Button>}</View>
    {notice&&<View className="gg-notice error"><Text>{notice}</Text>{organizeFailed&&<Button className="gg-link" disabled={busy||saving} onClick={manualOrganization}>继续按已填内容整理</Button>}</View>}
    <GatheringFormFooter>{!nicknameStep&&<Button className="gg-primary" disabled={busy||saving} loading={busy} onClick={()=>void organize()}>{busy?'正在整理…':'AI 整理 ✦'}</Button>}<Button className="gg-secondary" disabled={busy||saving} onClick={leave}>取消本次修改</Button></GatheringFormFooter>
  </View>;
}
