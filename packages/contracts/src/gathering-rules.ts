import { gatheringSections } from './gathering-reference';
import { gatheringPublicIntakeSchema, gatheringIntakeSchema, type GatheringBlock, type GatheringDetails, type GatheringIntake } from './gatherings';

export const privateGatheringText = /预算|budget|个人出发|私人出发|出发地址|出发地点|从哪(?:里)?出发|家庭地址|家庭住址|家住|住在|从家出发/i;
/** Public notes are not a second channel for amounts or a person's departure. */
export const privateGatheringInputText = /预算|budget|[¥￥]|(?:\d+(?:\.\d+)?)\s*(?:元|块钱|人民币)|从[^\n。；]{1,80}出发|出发点|个人出发|私人出发|家庭地址|家庭住址|家住|住在|居住地址/i;
export function privateGatheringQuestion(question: GatheringDetails['questions'][number]) {
  const sensitive=/预算|budget|出发|住址|居住|住在哪|在哪住|从哪|起点|家庭地址|家庭住址|[¥￥]|\d\s*元/i;
  return sensitive.test(question.title) || question.options.some(o => sensitive.test(o.label));
}
export function emptyGatheringIntake(): GatheringIntake {
  return { public: {date:'',availability:'',note:'',keywords:{eat:[],drink:[],play:[],pace:[],atmosphere:[],experience:[],arrangement:[],venue:[],environment:[],travel:[],exertion:[]},confirmed_keys:[]},
    private:{budget_min:null,budget_max:null,budget_note:'',origin:null,confirmed_keys:[]}, answers:[] };
}
export function emptyGatheringDetails(): GatheringDetails {
  return {date:'',title:'',start_time:'',end_date:'',end_time:'',place:'',address:'',description:'',approximate_time:'',minimum:null,capacity:null,fee:{kind:'unknown',amount:null,note:''},candidate_places:[],questions:[],deadline_at:null,confirmed_details:[]};
}
/** Shared blocks are built only from this allowlist, never from the private object. */
export function gatheringPublicBlocks(raw: unknown): GatheringBlock[] {
  const value = gatheringPublicIntakeSchema.parse(raw);
  const blocks: GatheringBlock[] = [];
  const add=(id:string,label:string,text:string)=>{if(text)blocks.push({id,label,value:text,confirmed:value.confirmed_keys.includes(id)});};
  add('date','日期',value.date); add('availability','有空时间',value.availability);
  for (const section of gatheringSections) for (const group of section.groups) {
    const chosen=value.keywords[group.id];
    if(chosen.some(option=>!(group.options as readonly string[]).includes(option)) || new Set(chosen).size!==chosen.length) throw Error('关键词选项不正确');
    group.options.forEach((option,index)=>{if(chosen.includes(option))add(`${group.id}_${index}`,group.title,option);});
  }
  if(privateGatheringInputText.test(value.note) || privateGatheringInputText.test(value.availability)) throw Error('预算和个人出发地点请填写在仅本人可见的栏位');
  add('note','补充想法',value.note);
  if(value.confirmed_keys.some(id=>!blocks.some(b=>b.id===id)) || new Set(value.confirmed_keys).size!==value.confirmed_keys.length)throw Error('确定项与当前填写内容不一致，请重新选择');
  return blocks;
}
export function gatheringOwnBlocks(raw: unknown): GatheringBlock[] {
  const input=gatheringIntakeSchema.parse(raw),blocks=gatheringPublicBlocks(input.public),own=input.private;
  if(own.budget_min!==null || own.budget_max!==null || own.budget_note)blocks.push({id:'budget',label:'我的预算 · 仅本人',value:[own.budget_min===null?'':`最低 ${own.budget_min} 元`,own.budget_max===null?'':`最高 ${own.budget_max} 元`,own.budget_note].filter(Boolean).join('，'),confirmed:own.confirmed_keys.includes('budget')});
  if(own.origin)blocks.push({id:'origin',label:'出发地点 · 仅本人',value:own.origin.label||'已保存私人坐标',confirmed:own.confirmed_keys.includes('origin')});
  if(own.confirmed_keys.some(id=>!blocks.some(b=>b.id===id)))throw Error('私人确定项与当前填写内容不一致');
  return blocks;
}
/** Team participants receive only the organizer's explicitly published information. */
export function gatheringVisibleDetails(details: GatheringDetails, kind:'friend'|'team', owner:boolean): GatheringDetails {
  if(kind==='friend'||owner)return details;
  const visible={...details};
  for(const field of ['date','title','start_time','end_date','end_time','place','address','description','approximate_time'] as const)if(!details.confirmed_details.includes(field))visible[field]='';
  if(!details.confirmed_details.includes('minimum'))visible.minimum=null;
  if(!details.confirmed_details.includes('capacity'))visible.capacity=null;
  if(!details.confirmed_details.includes('fee'))visible.fee={kind:'unknown',amount:null,note:''};
  // A clock without its unpublished day can turn an overnight plan into a
  // contradictory same-day interval. Withhold dependent clocks, never the day.
  if(!visible.date){visible.start_time='';visible.end_date='';visible.end_time='';}
  else if(details.end_date&&details.end_date!==details.date&&!visible.end_date)visible.end_time='';
  return visible;
}
