import {Button,Text,View} from '@tarojs/components';
import {gatheringSections,type GatheringIntake} from '@weevibe/contracts';
import {CAction} from '../design-c/ui';
import {CIcon} from '../design-c/chrome';
import {GatheringFlowHeader} from './flow-header';
import {GatheringFormFooter} from './form-footer';
import {GatheringField} from './fields';
import {GatheringOrigin} from './origin-search';
import './preference-form.css';

type Props={
  value:GatheringIntake;session:string;step:number;budgetMin:string;budgetMax:string;creating:boolean;busy:boolean;saving:boolean;notice:string;organizeFailed:boolean;
  publicChange:(patch:Partial<GatheringIntake['public']>)=>void;minChange:(value:string)=>void;maxChange:(value:string)=>void;privateChange:(patch:Partial<GatheringIntake['private']>)=>void;
  select:(group:typeof gatheringSections[number]['groups'][number],option:string)=>void;previous:()=>void;next:()=>void;switchMode:()=>void;clear:()=>void;cancel:()=>void;organize:()=>void;manual:()=>void;
};
const titles=['','基本偏好','想一起做些什么？','想要怎样的体验？','哪些安排想避开？'];
export function GatheringPreferenceForm(p:Props){
  const disabled=p.busy||p.saving,basic=p.step===1,last=p.step===4,sections=gatheringSections.filter((_,i)=>i===p.step-2);
  return <View className="c-ui gf-start gp-form">
    <GatheringFlowHeader back={p.previous} disabled={disabled} label="返回上一步" stepKey={p.step}/>
    <View className="gp-step-label"><Text>朋友出游 / 填写偏好</Text><Text>{p.step+1} / 5</Text></View>
    <View className="gp-progress" ariaLabel={`第 ${p.step+1} 步，共 5 步`}>{Array.from({length:5},(_,i)=><View key={i} className={i<=p.step?'gp-progress-done':''}/>)}</View>
    <View className="gf-heading"><Text className="gf-title">{titles[p.step]}</Text><View className="gf-marker"/></View>
    <View className="gp-mode-row"><Text>填表</Text><CAction variant="text" disabled={disabled} onClick={p.switchMode}>小橘头（AI问答）</CAction></View>
    {basic?<>
      <View className="gp-panel"><Text className="gp-section-title">时间安排</Text><GatheringField label={p.creating?'出游日期（必填）':'出游日期（选填）'} value={p.value.public.date} type="date" disabled={disabled} change={date=>p.publicChange({date})}/><GatheringField label="什么时间有空（选填）" value={p.value.public.availability} disabled={disabled} placeholder="例如：下午 2 点后都可以" change={availability=>p.publicChange({availability})}/></View>
      <View className="gp-panel gp-private"><View className="gp-section-heading"><Text className="gp-section-title">私密补充</Text><CIcon name="lock"/></View><Text className="gp-caption">仅本人可见。出发地和预算留空，表示愿意配合大家的安排。</Text><GatheringOrigin appearance="c" session={p.session} disabled={disabled} value={p.value.private.origin} change={origin=>p.privateChange({origin})}/><View className="gp-pair"><GatheringField label="最低（元）· 选填" value={p.budgetMin} type="digit" disabled={disabled} placeholder="不限" change={p.minChange}/><GatheringField label="最高（元）· 选填" value={p.budgetMax} type="digit" disabled={disabled} placeholder="不限" change={p.maxChange}/></View><GatheringField label="预算备注（选填）" type="area" maxLength={200} value={p.value.private.budget_note} disabled={disabled} change={budget_note=>p.privateChange({budget_note})}/></View>
      <View className="gp-panel"><GatheringField label="想法（选填）" type="area" value={p.value.public.note} disabled={disabled} placeholder="想一起做什么？个人预算和出发地址请写在私密栏位" change={note=>p.publicChange({note})}/></View>
    </>:sections.map(section=><View className="gp-panel" key={section.id}>{section.groups.map(group=><View className="gp-keyword-group" key={group.id}><Text className="gp-group-title">{group.title}</Text><View className="gp-chips">{group.options.map(option=><Button key={option} disabled={disabled} className={p.value.public.keywords[group.id].includes(option)?'gp-selected':''} ariaLabel={`${option}${p.value.public.keywords[group.id].includes(option)?'，已选':''}`} onClick={()=>p.select(group,option)}>{option}</Button>)}</View>{section.id==='do'&&<GatheringField label={`${group.title}：具体地点或补充（选填）`} type="area" maxLength={500} disabled={disabled} value={p.value.public.keyword_notes?.[group.id as 'eat'|'drink'|'play']||''} change={text=>p.publicChange({keyword_notes:{...p.value.public.keyword_notes,[group.id]:text}})}/>}</View>)}</View>)}
    {p.step===3&&<View className="gp-panel"><GatheringField label="补充想法（选填）" value={p.value.public.note} type="area" disabled={disabled} change={note=>p.publicChange({note})}/></View>}
    <Text className="gp-caption">{last?'没有特别想避开的，可以保持空白。':'除活动昵称和发起人的出游日期外，偏好可留空。'}公开想法供本次活动参考，预算与出发地点仅本人可见。</Text>
    <CAction variant="text" disabled={disabled} onClick={p.clear}>清空这一页</CAction>
    {p.notice&&<View className="gp-error" role="alert"><Text>{p.notice}</Text>{p.organizeFailed&&<CAction disabled={disabled} onClick={p.manual}>继续按已填内容整理</CAction>}</View>}
    <GatheringFormFooter className="gp-footer"><View className="gp-footer-actions"><CAction disabled={disabled} onClick={p.previous}>上一步</CAction>{last?<CAction variant="primary" disabled={disabled} loading={p.busy} onClick={p.organize}>{p.busy?'正在整理…':p.creating?'整理偏好并预览':'AI 整理 ✦'}</CAction>:<CAction variant="primary" disabled={disabled} onClick={p.next}>下一步 →</CAction>}</View>{!p.creating&&!last&&<CAction variant="text" disabled={disabled} onClick={p.organize}>AI 整理 ✦</CAction>}<CAction variant="text" disabled={disabled} onClick={p.cancel}>取消本次修改</CAction></GatheringFormFooter>
  </View>;
}
