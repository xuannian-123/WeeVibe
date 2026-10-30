import {gatheringSections} from '@weevibe/contracts';
export const categories=['play','travel','pace'] as const;
export type Category=typeof categories[number];
export const allowed=(category:Category,values:unknown):string[]=>Array.isArray(values)?[...new Set(values.filter((v):v is string=>typeof v==='string'&&v!=='其他'&&gatheringSections.flatMap(s=>s.groups).find(g=>g.id===category)?.options.includes(v)===true))].slice(0,6):[];
export type Evidence={category:Category;values:string[];sourceId:string;occurredAt:Date};
export function aggregate(evidence:Evidence[],overrides:Partial<Record<Category,string[]>>,now=Date.now()){
 return categories.flatMap(category=>{
  if(overrides[category])return [{category,values:allowed(category,overrides[category]),confidence:'manual',evidence_count:0,source:'用户主动纠正',last_at:null as string|null}];
  const recent=evidence.filter(e=>e.category===category&&now-e.occurredAt.getTime()<180*86400000);
  const counts=new Map<string,{score:number;ids:Set<string>;last:Date}>();
  for(const e of recent)for(const v of allowed(category,e.values)){const old=counts.get(v)??{score:0,ids:new Set<string>(),last:e.occurredAt};if(!old.ids.has(e.sourceId)){old.score+=Math.pow(0.5,(now-e.occurredAt.getTime())/(60*86400000));old.ids.add(e.sourceId);}if(e.occurredAt>old.last)old.last=e.occurredAt;counts.set(v,old);}
  const sorted=[...counts].sort((a,b)=>b[1].score-a[1].score||b[1].last.getTime()-a[1].last.getTime()).slice(0,3);
  if(!sorted.length)return [];
  const top=sorted[0][1],conflict=[...counts.values()].some(v=>v!==top&&v.last>top.last);
  return [{category,values:sorted.map(([v])=>v),confidence:!conflict&&top.ids.size>=3&&top.score>=2?'high':'low',evidence_count:top.ids.size,source:'本人结构化选择；180天保留、60天半衰期',last_at:top.last.toISOString()}];
 });
}
