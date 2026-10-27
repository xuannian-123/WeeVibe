import { Button, Input, Picker, Switch, Text, View } from '@tarojs/components';
import type { RequirementQuestion } from '@weevibe/contracts';
import { newKey } from '../../platform/local-id';
export type SegmentChoice = { id: string; name: string };
function id() { return newKey().replace(/[^A-Za-z0-9_-]/g, ''); }
export function QuestionEditor({ questions, segments = [], onChange, disabled = false }: { questions: RequirementQuestion[]; segments?: SegmentChoice[]; onChange:(questions:RequirementQuestion[])=>void; disabled?:boolean }) {
  const change = (question: RequirementQuestion) => onChange(questions.map(item => item.id === question.id ? question : item));
  const choices = ['全局问题', ...segments.map(s => s.name)];
  return <View>
    <Text className="req-muted">每题均支持“其他／自己填写”。题目 ID 和选项 ID 在保存时保持不变。首份答卷提交后，题目结构不再编辑。</Text>
    {questions.map((question, index) => <View key={question.id} className="req-question-editor">
      <Input className="req-input" ariaLabel={`问题${index + 1}`} disabled={disabled} value={question.title} maxlength={200} placeholder={`问题 ${index + 1}`} onInput={e=>change({...question,title:e.detail.value})}/>
      <View className="req-toggle-row"><Text>可多选</Text><Switch disabled={disabled} checked={question.multiple} onChange={e=>change({...question,multiple:e.detail.value})}/><Text>必答</Text><Switch disabled={disabled} checked={question.required} onChange={e=>change({...question,required:e.detail.value})}/></View>
      {!!segments.length && <Picker disabled={disabled} range={choices} value={Math.max(0,segments.findIndex(s=>s.id===question.segment_id)+1)} onChange={e=>change({...question,segment_id:Number(e.detail.value)===0?null:segments[Number(e.detail.value)-1]?.id ?? null})}><View className="req-picker">适用范围：{question.segment_id ? segments.find(s=>s.id===question.segment_id)?.name ?? '关联环节不存在' : '全部参与者'}　⌄</View></Picker>}
      {question.options.map((option, optionIndex) => <View key={option.id} className="req-option-row"><Input className="req-input" ariaLabel={`问题${index + 1}选项${optionIndex + 1}`} disabled={disabled} maxlength={100} value={option.label} placeholder={`选项 ${optionIndex+1}`} onInput={e=>change({...question,options:question.options.map(item=>item.id===option.id?{...item,label:e.detail.value}:item)})}/><Button disabled={disabled || question.options.length<=1} onClick={()=>change({...question,options:question.options.filter(item=>item.id!==option.id)})}>删除</Button></View>)}
      <Text className="req-muted">○ 其他／自己填写（参与者选择后显示文本框）</Text><View className="req-inline"><Button disabled={disabled || question.options.length>=20} onClick={()=>change({...question,options:[...question.options,{id:id(),label:''}]})}>＋ 添加选项</Button><Button disabled={disabled} onClick={()=>onChange(questions.filter(item=>item.id!==question.id))}>删除问题</Button></View>
    </View>)}
    <Button className="req-button secondary" disabled={disabled || questions.length>=20} onClick={()=>onChange([...questions,{id:id(),title:'',multiple:true,required:false,segment_id:null,options:[{id:id(),label:''},{id:id(),label:''}]}])}>＋ 添加问题</Button>
  </View>;
}
