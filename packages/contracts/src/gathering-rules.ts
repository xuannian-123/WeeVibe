import { gatheringSections } from './gathering-reference';
import { gatheringPublicIntakeSchema, gatheringIntakeSchema, type GatheringBlock, type GatheringDetails, type GatheringIntake } from './gatherings';

export const privateGatheringText = /预算|budget|个人出发|私人出发|出发地址|出发地点|从哪(?:里)?出发|家庭地址|家庭住址|家住|住在|从家出发/i;
const moneyAmount = '[0-9０-９零〇一二两三四五六七八九十百千万几]+(?:[.点][0-9０-９零〇一二两三四五六七八九]+)?';
const amountEnd = '(?![0-9０-９零〇一二两三四五六七八九十百千万几点]|\\s*(?:小时|分钟|秒|天|周|月|年|次|人|个|项|场|首|杯|瓶|份|张|步|公里|米|页|斤|克|公斤))';
const amountQualifier = '(?:大约|约|最多|至少|不超过|了|是|为|控制在|大概|差不多|希望|在|可以|能|可|\\s)*';
/** Shared by public form validation and the local interview; no private amount is inferred or saved. */
export const privateGatheringMoneyText = new RegExp([
  '预算|budget|[¥￥]',
  `${moneyAmount}(?:来|多)?\\s*(?:元|人民币|块钱|块(?=$|[，,。；;！!\\s]|以内|以下|左右|上下|足够|够))`,
  `(?:人均|花费|花销|开销|消费|费用|支出|价位|花)\\s*${amountQualifier}${moneyAmount}${amountEnd}`,
].join('|'), 'i');
// Public POIs and nearby preferences stay valid. Residential building/room detail
// or explicit ownership wording is required, rather than “家庭”“宿舍” alone.
const privateResidentialText = /(?:小区|家属院|公寓)[^\n，,。；;]{0,35}[0-9０-９一二两三四五六七八九十]+\s*(?:栋|幢|号楼|单元|室)|[0-9０-９一二两三四五六七八九十]+\s*(?:栋|幢|号楼|单元)[^\n，,。；;]{0,15}[0-9０-９]+\s*(?:室|房)|(?:我家|我的家|我的宿舍)(?:在|是|地址|[：:])|本人住址|个人地址|住址是/;
/** Public notes are not a second channel for amounts or a person's departure. */
export const privateGatheringInputText = new RegExp([
  privateGatheringMoneyText.source,
  privateResidentialText.source,
  /从[^\n。；]{1,80}出发|出发点|个人出发|私人出发|家庭地址|家庭住址|家住|住在|居住地址/.source,
].join('|'), 'i');
export function privateGatheringQuestion(question: GatheringDetails['questions'][number]) {
  const sensitive=/预算|budget|出发|住址|居住|住在哪|在哪住|从哪|起点|家庭地址|家庭住址|[¥￥]|\d\s*元/i;
  return sensitive.test(question.title) || question.options.some(o => sensitive.test(o.label));
}
export function emptyGatheringIntake(): GatheringIntake {
  return { public: {activity_nickname:'',date:'',availability:'',note:'',keywords:{eat:[],drink:[],play:[],pace:[],atmosphere:[],experience:[],arrangement:[],venue:[],environment:[],travel:[],exertion:[]},confirmed_keys:[]},
    private:{budget_min:null,budget_max:null,budget_note:'',origin:null,confirmed_keys:[]}, answers:[] };
}
export function emptyGatheringDetails(): GatheringDetails {
  return {date:'',title:'',start_time:'',end_date:'',end_time:'',place:'',address:'',description:'',approximate_time:'',minimum:null,capacity:null,fee:{kind:'unknown',amount:null,note:''},candidate_places:[],questions:[],deadline_at:null,confirmed_details:[]};
}
/** Stable derived question: venue IDs remain the answer IDs, never display indexes. */
export const gatheringPlaceQuestionId = 'candidate_place_choice';
export function gatheringQuestions(details: GatheringDetails): GatheringDetails['questions'] {
  return details.candidate_places.length > 1
    ? [{id:gatheringPlaceQuestionId,title:'你想选择哪个候选地点？',type:'single',required:true,options:details.candidate_places.map(place=>({id:place.id,label:place.label}))},...details.questions]
    : details.questions;
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
    const notes=value.keyword_notes?.[group.id as 'eat'|'drink'|'play'];
    if(notes&&privateGatheringInputText.test(notes))throw Error('预算和个人出发地点请填写在仅本人可见的栏位');
    let used=false;group.options.forEach((option,index)=>{if(chosen.includes(option)){const detail=notes?.startsWith(option+'：')?notes:option;used=used||detail===notes;add(`${group.id}_${index}`,group.title,detail);}});
    if(notes&&!used)add(`${group.id}_note`,group.title,notes);
  }
  for(const place of value.selected_places??[]){const group=gatheringSections[0].groups.find(g=>g.id===place.group);if(!group?.options.includes(place.option)||!value.keywords[place.group].includes(place.option))throw Error('地点与所选活动分类不一致');}
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
/** Certainty review is limited to the date and concrete eating/drinking/playing choices. */
export function gatheringCertaintyBlocks(raw: unknown): GatheringBlock[] {
  return gatheringOwnBlocks(raw).filter(block=>block.id==='date'||/^(eat|drink|play)_/.test(block.id));
}
export function normalizeGatheringCertainty(value: GatheringIntake): GatheringIntake {
  const allowed=new Set(gatheringCertaintyBlocks(value).map(block=>block.id));
  return {...value,public:{...value.public,confirmed_keys:value.public.confirmed_keys.filter(id=>allowed.has(id))},private:{...value.private,confirmed_keys:[]}};
}
