import {useRef,useState} from 'react';
import {Button,Text,View} from '@tarojs/components';
import {gatheringSections,gatheringOwnBlocks,gatheringIntakeSchema,type GatheringIntake} from '@weevibe/contracts';
import {GatheringField} from './fields';
import {GatheringOrigin} from './origin-search';
import {gatheringMessage,organizeGathering} from './client';
import {useGatheringSource} from './use-source';

const interviewTitles=['哪天、什么时间有空？','你准备从哪出发？','这次你的预算是多少？','这次想吃、喝、玩些什么？','你想要什么，又想避开什么？'];
const stepTitles=['基本偏好','干什么','想要','想避开'];
export function GatheringIntakeEditor({initial,session,date,done,cancel,saving=false,readOnly=false}:{initial:GatheringIntake;session:string;date:string;saving?:boolean;readOnly?:boolean;done:(v:GatheringIntake)=>void;cancel:()=>void}){
  const source=useGatheringSource(session),lock=useRef(false);
  const[value,setValue]=useState<GatheringIntake>(()=>({...initial,public:{...initial.public,date:initial.public.date||date}}));
  const[budgetMinText,setBudgetMinText]=useState(initial.private.budget_min===null?'':String(initial.private.budget_min)),[budgetMaxText,setBudgetMaxText]=useState(initial.private.budget_max===null?'':String(initial.private.budget_max));
  const[mode,setMode]=useState<'form'|'interview'>('form'),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[summary,setSummary]=useState(''),[confirm,setConfirm]=useState(false),[selected,setSelected]=useState<string[]>([]);
  const publicField=(patch:Partial<GatheringIntake['public']>)=>{if(source.valid()&&!lock.current&&!saving&&!readOnly){setValue(v=>({...v,public:{...v.public,...patch,confirmed_keys:[]}}));setNotice('');}};
  const privateField=(patch:Partial<GatheringIntake['private']>)=>{if(source.valid()&&!lock.current&&!saving&&!readOnly){setValue(v=>({...v,private:{...v.private,...patch,confirmed_keys:[]}}));setNotice('');}};
  function selectKeyword(group:typeof gatheringSections[number]['groups'][number],option:string){const values=value.public.keywords[group.id];publicField({keywords:{...value.public.keywords,[group.id]:values.includes(option)?values.filter(x=>x!==option):[...values,option]}});}
  function beginConfirmation(text:string){if(!source.valid()||readOnly)return;const checked=gatheringIntakeSchema.parse(value);gatheringOwnBlocks(checked);setSummary(text);setSelected([...value.public.confirmed_keys,...value.private.confirmed_keys]);setConfirm(true);}
  async function organize(){if(lock.current||saving||readOnly||!source.valid())return;let checked:GatheringIntake;try{checked=gatheringIntakeSchema.parse(value);gatheringOwnBlocks(checked);}catch(e){setNotice(e instanceof Error&&e.name!=='ZodError'?e.message:'请检查预算和填写内容');return;}
    lock.current=true;setBusy(true);setNotice('');const guard=source.ticket();try{const result=await organizeGathering(session,checked.public,guard);guard();beginConfirmation(result.summary);}catch(e){if(source.valid()&&!(e instanceof Error&&e.message==='STALE_GATHERING'))setNotice(gatheringMessage(e));}finally{lock.current=false;if(source.alive())setBusy(false);}}
  function commit(){if(saving||readOnly||!source.valid())return;const publicIds=new Set(gatheringOwnBlocks(value).filter(b=>b.id!=='budget'&&b.id!=='origin').map(b=>b.id));done({...value,public:{...value.public,confirmed_keys:selected.filter(id=>publicIds.has(id))},private:{...value.private,confirmed_keys:selected.filter((id):id is 'budget'|'origin'=>id==='budget'||id==='origin')}});}
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，原填写内容已隐藏，请返回后重新打开。</Text>;
  if(readOnly){const blocks=gatheringOwnBlocks(initial),privateBlock=(id:string)=>id==='budget'||id==='origin',leave=()=>{if(source.valid()&&!saving)cancel();};return <View className="gg-editor"><Button className="gg-back" disabled={saving} onClick={leave}>← 返回管理活动</Button><Text className="gg-eyebrow">朋友出游 / 本人内容</Text><Text className="gg-title">我的整理内容</Text><Text className="gg-notice">活动已定案，以下为本人的已保存内容，仅供查看。预算和个人出发地点始终仅本人可见。</Text>{[false,true].map(privateOnly=><View key={String(privateOnly)} className={`gg-panel ${privateOnly?'lilac':''}`}><Text className="gg-heading">{privateOnly?'仅本人可见的补充':'我的公开内容'}</Text><View className="gg-blocks">{blocks.filter(b=>privateBlock(b.id)===privateOnly).map(block=><View key={block.id} className={`gg-block ${block.confirmed?'confirmed':''}`}><Text className="gg-block-label">{block.label} · {block.confirmed?'已确定':'待商量'}</Text><Text>{block.value}</Text></View>)}</View>{!blocks.some(b=>privateBlock(b.id)===privateOnly)&&<Text className="gg-muted">暂未填写。</Text>}</View>)}<Button className="gg-secondary" disabled={saving} onClick={leave}>返回</Button></View>;}
  if(confirm){const blocks=gatheringOwnBlocks(value);return <View className="gg-editor gg-confirm-screen"><Text className="gg-eyebrow">AI 整理 / 再确认一步</Text><Text className="gg-title">哪些内容已经确定了？</Text><Text className="gg-muted">可多选，也可以一个都不选。预算和个人出发地点始终仅本人可见。</Text>{summary&&<View className="gg-panel lilac"><Text>{summary}</Text></View>}<View className="gg-blocks">{blocks.map(block=><Button key={block.id} className={`gg-block gg-confirm-block ${selected.includes(block.id)?'selected':''}`} disabled={saving} onClick={()=>{if(source.valid()&&!saving)setSelected(s=>s.includes(block.id)?s.filter(id=>id!==block.id):[...s,block.id]);}}><Text className="gg-block-label">{block.label}</Text><Text>{block.value}</Text><Text className="gg-confirm-mark">{selected.includes(block.id)?'已选':'点选确定'}</Text></Button>)}</View>{!blocks.length&&<Text className="gg-muted">暂未填写偏好，可以先保留待定。</Text>}<Button className="gg-primary" disabled={saving} loading={saving} onClick={commit}>{selected.length?'这些是已经确定了的':'还都没确定'}</Button><Button className="gg-secondary" disabled={saving} onClick={()=>setConfirm(false)}>返回修改</Button></View>;}
  const count=mode==='interview'?5:4;
  const basic=mode==='form'?step===0:step<=2;
  const availability=basic&&(mode==='form'||step===0),origin=basic&&(mode==='form'||step===1),budget=basic&&(mode==='form'||step===2);
  const sections=mode==='form'?gatheringSections.filter((_,i)=>i===step-1):step===3?gatheringSections.filter(s=>s.id==='do'):step===4?gatheringSections.filter(s=>s.id!=='do'):[];
  function clearStep(){
    if(!source.valid()||busy||saving||lock.current)return;
    setValue(current=>{const next={...current,public:{...current.public,keywords:{...current.public.keywords},confirmed_keys:[]},private:{...current.private,confirmed_keys:[]}};
      if(availability){next.public.date='';next.public.availability='';}
      if(origin)next.private.origin=null;
      if(budget){next.private.budget_min=null;next.private.budget_max=null;next.private.budget_note='';}
      for(const section of sections)for(const group of section.groups)next.public.keywords[group.id]=[];
      return next;});
    if(budget){setBudgetMinText('');setBudgetMaxText('');}setNotice('');
  }
  function interviewAnswer(index:number){
    if(index===0)return [value.public.date,value.public.availability].filter(Boolean).join(' · ')||'暂未填写';
    if(index===1)return value.private.origin?.label||'暂未填写';
    if(index===2)return [value.private.budget_min===null?'':`最低 ${value.private.budget_min} 元`,value.private.budget_max===null?'':`最高 ${value.private.budget_max} 元`,value.private.budget_note].filter(Boolean).join('，')||'暂未填写';
    const groups=gatheringSections.filter(section=>index===3?section.id==='do':section.id!=='do').flatMap(section=>section.groups);
    return groups.flatMap(group=>value.public.keywords[group.id]).join('、')||'暂未填写';
  }
  return <View className="gg-editor"><Button className="gg-back" disabled={busy||saving} onClick={cancel}>← 返回</Button><Text className="gg-title">AI 整理</Text><View className="gg-mode"><Button className={mode==='form'?'active':''} disabled={busy||saving} onClick={()=>{setMode('form');setStep(0);}}>填写</Button><Button className={mode==='interview'?'active':''} disabled={busy||saving} onClick={()=>{setMode('interview');setStep(0);}}>AI 问答</Button></View>
    <Text className="gg-muted">公开想法可由同次出游成员查看；私密信息留在本人栏位，整理请求不发送私密信息。</Text>
    {mode==='interview'&&<View className="gg-conversation">{interviewTitles.slice(0,step+1).map((title,i)=><Button className={`gg-chat-bubble ${i===step?'active':''}`} disabled={busy||saving} key={title} onClick={()=>setStep(i)}><Text>{i+1}. {title}</Text>{i<step&&<><Text className="gg-chat-answer">{interviewAnswer(i)}</Text><Text className="gg-muted">点此修改回答</Text></>}</Button>)}</View>}
    <View className="gg-step-header"><Text>{mode==='form'?stepTitles[step]:interviewTitles[step]}</Text><Text>{step+1} / {count}</Text></View>
    {basic&&<View className="gg-panel">{availability&&<><GatheringField label="出游日期" value={value.public.date} type="date" disabled={busy||saving} change={date=>publicField({date})}/><GatheringField label="什么时间有空" value={value.public.availability} disabled={busy||saving} placeholder="例如：下午2点后都可以" change={availability=>publicField({availability})}/></>}{origin&&<GatheringOrigin session={session} disabled={saving||busy} value={value.private.origin} change={origin=>privateField({origin})}/>}{budget&&<><Text className="gg-heading">我的预算 <Text className="gg-private-tag">仅本人</Text></Text><View className="gg-pair"><GatheringField label="最低（元）" value={budgetMinText} type="digit" disabled={busy||saving} placeholder="不限" change={v=>{setBudgetMinText(v);privateField({budget_min:v.trim()?Number(v):null});}}/><GatheringField label="最高（元）" value={budgetMaxText} type="digit" disabled={busy||saving} placeholder="不限" change={v=>{setBudgetMaxText(v);privateField({budget_max:v.trim()?Number(v):null});}}/></View><GatheringField label="预算备注" value={value.private.budget_note} disabled={busy||saving} privateField change={budget_note=>privateField({budget_note})}/></>}
      {mode==='form'&&<GatheringField label="想法" type="area" value={value.public.note} disabled={busy||saving} placeholder="写下想一起做的事；预算与个人出发地址请填写在私密栏位" change={note=>publicField({note})}/>}</View>}
    {sections.map(section=><View className="gg-panel" key={section.id}><Text className="gg-heading">{section.title}</Text>{section.groups.map(group=><View className="gg-keyword-group" key={group.id}><Text className="gg-label">{group.title}</Text><View className="gg-chips">{group.options.map(option=><Button key={option} disabled={busy||saving} className={value.public.keywords[group.id].includes(option)?'selected':''} onClick={()=>selectKeyword(group,option)}>{option}</Button>)}</View></View>)}</View>)}
    {mode==='interview'&&step===4&&<GatheringField label="补充想法" type="area" value={value.public.note} disabled={busy||saving} change={note=>publicField({note})}/>}
    <Button className="gg-link" disabled={busy||saving} onClick={clearStep}>{mode==='interview'?'清空这一题':'清空这一页'}</Button><View className="gg-inline gg-step-nav"><Button className="gg-link" disabled={busy||saving||step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>← 上一页</Button>{step<count-1&&<Button className="gg-soft" disabled={busy||saving} onClick={()=>setStep(s=>s+1)}>下一步 →</Button>}</View>
    {notice&&<View className="gg-notice error"><Text>{notice}</Text><Button className="gg-link" disabled={busy||saving} onClick={()=>{try{beginConfirmation('按你填写的内容整理，以下尚未经 AI 总结。');}catch{setNotice('请先检查预算和输入内容。');}}}>继续按已填内容整理</Button></View>}
    <Button className="gg-primary" disabled={busy||saving} loading={busy} onClick={()=>void organize()}>{busy?'正在整理…':'AI 整理 ✦'}</Button><Button className="gg-secondary" disabled={busy||saving} onClick={cancel}>取消本次修改</Button>
  </View>;
}
