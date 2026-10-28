import {useState} from 'react';
import {Button,Picker,Switch,Text,View} from '@tarojs/components';
import {gatheringQuestionBank,gatheringIntakeSchema,privateGatheringQuestion,type GatheringDetails,type GatheringIntake} from '@weevibe/contracts';
import {newKey} from '../../platform/local-id';
import {GatheringField} from './fields';
import {GatheringOrigin} from './origin-search';
import {useGatheringSource} from './use-source';

type Question=GatheringDetails['questions'][number];
export function GatheringQuestionEditor({questions,change,disabled=false}:{questions:Question[];change:(v:Question[])=>void;disabled?:boolean}){
  const[bank,setBank]=useState(false);
  const changeQuestions=(next:Question[])=>{if(!disabled)change(next);};
  const make=(title='',type:Question['type']='single',options:readonly string[]=['']):Question=>({id:`q_${newKey()}`,title,type,required:false,options:type==='text'?[]:options.map(label=>({id:`o_${newKey()}`,label}))});
  const patch=(index:number,value:Partial<Question>)=>changeQuestions(questions.map((q,i)=>i===index?{...q,...value}:q));
  return <View><Text className="gg-heading">活动内的问题 <Text className="gg-muted">选填</Text></Text><Text className="gg-muted">单选、多选或文字题；选择题自动保留“其他／自己填写”。预算和出发地点相关题目仅本人可见。</Text>
    <Button className="gg-secondary" disabled={disabled} onClick={()=>{if(!disabled)setBank(v=>!v);}}>从示例题库选题 {bank?'－':'＋'}</Button>
    {bank&&<View className="gg-question-bank">{gatheringQuestionBank.map(t=><View key={t.id} className="gg-bank-item"><Text className="gg-muted">{t.category}</Text><Text>{t.title}</Text><Text className="gg-muted">{t.options.join('、')||'文字填写'}</Text><Button className="gg-soft" disabled={disabled||questions.length>=20} onClick={()=>changeQuestions([...questions,make(t.title,t.type,t.options)])}>加入这道题</Button></View>)}</View>}
    {questions.map((q,index)=><View key={q.id} className="gg-question-editor"><View className="gg-row"><Text className="gg-heading">问题 {index+1}</Text><Button className="gg-link" disabled={disabled} onClick={()=>changeQuestions(questions.filter((_,i)=>i!==index))}>删除</Button></View><GatheringField disabled={disabled} label="题目" value={q.title} change={title=>patch(index,{title})}/><View className="gg-row"><Picker disabled={disabled} range={['单选','多选','文字']} value={['single','multiple','text'].indexOf(q.type)} onChange={e=>{const type=(['single','multiple','text'] as const)[Number(e.detail.value)]||'single';patch(index,{type,options:type==='text'?[]:q.options.length?q.options:[{id:`o_${newKey()}`,label:''}]});}}><View className="gg-soft">题型：{{single:'单选',multiple:'多选',text:'文字'}[q.type]}　›</View></Picker><Text>必答</Text><Switch disabled={disabled} checked={q.required} onChange={e=>patch(index,{required:e.detail.value})}/></View>
      {q.type!=='text'&&<View>{q.options.map((o,i)=><View className="gg-option-editor" key={o.id}><GatheringField disabled={disabled} label={`选项 ${i+1}`} value={o.label} change={label=>patch(index,{options:q.options.map((item,n)=>n===i?{...item,label}:item)})}/><Button className="gg-link" disabled={disabled} onClick={()=>patch(index,{options:q.options.filter((_,n)=>n!==i)})}>删除</Button></View>)}<Button className="gg-soft" disabled={disabled||q.options.length>=20} onClick={()=>patch(index,{options:[...q.options,{id:`o_${newKey()}`,label:''}]})}>＋ 添加选项</Button><Text className="gg-muted">另有“其他／自己填写”，无需重复添加。</Text></View>}
      {privateGatheringQuestion(q)&&<Text className="gg-notice">此题涉及私人信息，答案不会进入局头统计或其他人的页面。</Text>}
    </View>)}
    <Button className="gg-secondary" disabled={disabled||questions.length>=20} onClick={()=>changeQuestions([...questions,make()])}>＋ 添加问题</Button>
  </View>;
}
export function GatheringQuestionnaire({details,initial,session,busy=false,preview=false,readOnly=false,save,cancel}:{details:GatheringDetails;initial:GatheringIntake;session:string;busy?:boolean;preview?:boolean;readOnly?:boolean;save:(v:GatheringIntake)=>void;cancel:()=>void}){
  const source=useGatheringSource(session);
  const leave=()=>{if(source.valid()&&!busy)cancel();};const[value,setValue]=useState(initial),[notice,setNotice]=useState('');
  const[minimum,setMinimum]=useState(initial.private.budget_min===null?'':String(initial.private.budget_min)),[maximum,setMaximum]=useState(initial.private.budget_max===null?'':String(initial.private.budget_max));
  const answer=(q:Question)=>value.answers.find(a=>a.question_id===q.id)||{question_id:q.id,option_ids:[],other:'',text:''};
  const patch=(q:Question,data:Partial<GatheringIntake['answers'][number]>)=>{if(source.valid()&&!busy&&!readOnly){const next={...answer(q),...data};setValue(v=>({...v,answers:[...v.answers.filter(a=>a.question_id!==q.id),next]}));setNotice('');}};
  function submit(){if(!source.valid()||busy||readOnly)return;for(const q of details.questions){const a=answer(q);if(q.required&&!(q.type==='text'?a.text.trim():a.option_ids.length||a.other.trim())){setNotice(`请填写必答题：${q.title}`);return;}}const parsed=gatheringIntakeSchema.safeParse(value);if(!parsed.success){setNotice('请检查预算和输入格式。');return;}if(preview)setNotice('试填检查通过；答案没有保存或发送。');else save(parsed.data);}
  const privatePatch=(patch:Partial<GatheringIntake['private']>)=>{if(source.valid()&&!busy&&!readOnly)setValue(v=>({...v,private:{...v.private,...patch,confirmed_keys:[]}}));};
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，原填写内容已隐藏，请返回后重新打开。</Text>;
  return <View className="gg-editor"><Button className="gg-back" disabled={busy} onClick={leave}>← {preview?'返回问卷设计':'返回管理活动'}</Button><Text className="gg-title">{preview?'预览并试填问卷':'填写团建问卷'}</Text><Text className="gg-muted">{preview?'这是本机试填，检查不会保存或发送答案。':'只有局头能查看统计结果；其他参与者看不到你的答案。预算和个人出发地点始终仅本人可见。'}</Text>
    {details.questions.map((q,i)=>{const a=answer(q);return <View key={q.id} className="gg-panel"><Text className="gg-heading">{i+1}. {q.title}{q.required?' *':''}</Text><Text className="gg-muted">{{single:'单选',multiple:'可多选',text:'文字题'}[q.type]}{privateGatheringQuestion(q)?' · 仅本人可见':''}</Text>{q.type==='text'?<GatheringField label="你的回答" value={a.text} type="area" disabled={busy||readOnly} change={text=>patch(q,{text})}/>:<View>{q.options.map(o=><Button key={o.id} className={`gg-choice ${a.option_ids.includes(o.id)?'selected':''}`} disabled={busy||readOnly} onClick={()=>patch(q,{option_ids:q.type==='single'?[o.id]:a.option_ids.includes(o.id)?a.option_ids.filter(id=>id!==o.id):[...a.option_ids,o.id],...(q.type==='single'?{other:''}:{})})}>{a.option_ids.includes(o.id)?'●':'○'} {o.label}</Button>)}<GatheringField label="其他／自己填写" value={a.other} type="area" disabled={busy||readOnly} change={other=>patch(q,{other,...(q.type==='single'&&other.trim()?{option_ids:[]}:{})})}/></View>}</View>;})}
    {!details.questions.length&&<View className="gg-panel"><Text>这份问卷暂时没有自定义问题，可以直接提交参与意向。</Text></View>}
    {!preview&&<View className="gg-panel"><Text className="gg-heading">仅本人可见的补充</Text><View className="gg-pair"><GatheringField label="最低预算（元）" value={minimum} type="digit" disabled={busy||readOnly} change={v=>{setMinimum(v);privatePatch({budget_min:v.trim()?Number(v):null});}}/><GatheringField label="最高预算（元）" value={maximum} type="digit" disabled={busy||readOnly} change={v=>{setMaximum(v);privatePatch({budget_max:v.trim()?Number(v):null});}}/></View><GatheringOrigin session={session} disabled={busy||readOnly} value={value.private.origin} change={origin=>privatePatch({origin})}/></View>}
    {notice&&<Text className="gg-notice">{notice}</Text>}{readOnly?<Text className="gg-notice">填写已截止，你仍可以查看本人的已保存答卷。</Text>:<Button className="gg-primary" loading={busy} disabled={busy} onClick={submit}>{preview?'检查本地试填':'保存我的问卷'}</Button>}<Button className="gg-secondary" disabled={busy} onClick={leave}>返回</Button>
  </View>;
}
