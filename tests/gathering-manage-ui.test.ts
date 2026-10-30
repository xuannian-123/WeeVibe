// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {ApiClientError} from '../packages/api-client/src';
import type {GatheringSnapshot} from '../packages/contracts/src';
import {gatheringId,gatheringOwner,gatheringPeer,gatheringPlanFixture,gatheringUiFixture} from './gathering-ui-fixtures';
const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const{createElement,act,useState}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const{createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(el:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',store:new Map<string,unknown>(),transport:vi.fn(),modal:vi.fn(),refresh:vi.fn(),updated:vi.fn(),hide:[] as (()=>void)[],show:[] as (()=>void)[],pageScroll:undefined as ((e:{scrollTop:number})=>void)|undefined,scrollTo:vi.fn().mockResolvedValue({}),readOnly:false,intakeReadOnly:false,saving:false,intake:undefined as unknown}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,transport:h.transport}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{getStorageSync:(key:string)=>h.store.get(key),setStorageSync:(key:string,v:unknown)=>h.store.set(key,v),removeStorageSync:(key:string)=>h.store.delete(key),showModal:h.modal,pageScrollTo:h.scrollTo,env:{USER_DATA_PATH:'/tmp'},getFileSystemManager:()=>({writeFileSync:vi.fn()})},useDidShow:(f:()=>void)=>h.show.push(f),useDidHide:(f:()=>void)=>h.hide.push(f),useUnload:()=>{},usePageScroll:(fn:(e:{scrollTop:number})=>void)=>{h.pageScroll=fn;}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{className:p.className,disabled:p.disabled,onClick:p.onClick,'data-open-type':p.openType},p.children),Image:()=>null,Textarea:(p:any)=>createElement('textarea',{value:p.value,disabled:p.disabled,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})})}));
vi.mock('../apps/miniprogram/src/features/gatherings/intake-editor',()=>({GatheringIntakeEditor:(p:any)=>{h.saving=!!p.saving;h.intakeReadOnly=!!p.readOnly;return createElement('div',{},createElement('button',{disabled:p.saving,onClick:()=>p.done(h.intake)},'完成本人整理'),p.saveFeedback?.message&&createElement('span',{'data-testid':'editor-save-feedback'},p.saveFeedback.message),p.saveFeedback?.pending&&createElement('button',{'data-testid':'editor-save-retry',disabled:p.saveFeedback.busy,onClick:p.saveFeedback.retry},'编辑器内核对保存')); }}));
vi.mock('../apps/miniprogram/src/features/gatherings/questionnaire',()=>({GatheringQuestionnaire:(p:any)=>{h.readOnly=!!p.readOnly;return createElement('div',{},p.readOnly?'只读本人问卷':createElement('button',{onClick:()=>p.save(h.intake)},'保存本人问卷'));}}));
vi.mock('../apps/miniprogram/src/features/gatherings/details-editor',()=>({GatheringDetailsEditor:()=>createElement('div',{},'修改基本信息')}));
vi.mock('../apps/miniprogram/src/features/gatherings/subscription',()=>({useGatheringSubscription:()=>({busy:false,requestFromTap:async()=>undefined,record:async()=>{}}),GatheringSubscription:()=>null}));
import {GatheringManage} from '../apps/miniprogram/src/features/gatherings/manage';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
function Connected({initial,actor=gatheringOwner,entry='manage'}:{initial:GatheringSnapshot;actor?:string;entry?:'share'|'manage'}){const[current,setCurrent]=useState(initial);return createElement(GatheringManage,{snapshot:current,actor,entry,session:'session-a',update:(v:GatheringSnapshot)=>{h.updated(v);setCurrent(v);},refresh:h.refresh});}
beforeEach(()=>{h.token='session-a';h.store.clear();h.modal.mockReset().mockResolvedValue({confirm:true});h.transport.mockReset();h.refresh.mockReset().mockResolvedValue(undefined);h.updated.mockReset();h.hide=[];h.show=[];h.readOnly=false;h.intakeReadOnly=false;h.saving=false;h.intake=gatheringUiFixture().own!.intake;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
async function render(value=gatheringUiFixture(),actor=gatheringOwner,entry:'share'|'manage'='manage'){await act(async()=>root.render(createElement(Connected,{initial:value,actor,entry})));}
function button(label:string){const b=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label);expect(b,label).toBeTruthy();return b!;}
async function click(label:string){await act(async()=>{button(label).click();await Promise.resolve();});}
const text=()=>host.textContent||'';
it('opens the owner menu with integration and arrangements; participants go directly to named content',async()=>{await render();expect(text()).toContain('内容整合');expect(text()).toContain('暂未生成');expect(text()).not.toContain('朋友乙');await click('内容整合看看每个人已经整理好的想法↗');expect(text()).toContain('朋友乙');expect(text()).toContain('轻松不赶场');expect(text()).not.toContain('PRIVATE_ONLY_MY_BUDGET');expect(h.transport).not.toHaveBeenCalled();});
it('does not expose the owner generation action to another participant',async()=>{await render(gatheringUiFixture('friend',false),gatheringPeer);expect(text()).toContain('朋友乙');expect(text()).not.toContain('人齐了，生成安排！');expect(h.transport).not.toHaveBeenCalled();});
it('shows an empty arrangements state to everyone before a plan exists',async()=>{await render(gatheringUiFixture('friend',false),gatheringPeer);await click('活动安排');expect(text()).toContain('暂未生成');expect(h.transport).not.toHaveBeenCalled();});
it('renders multiple full-plan cards then sequential segment cards and segment detail',async()=>{const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();await render(value);await click('活动安排2 套方案，点击查看顺序环节↗');expect(text()).toContain('文星广场 · 吃饭→打台球→唱歌');expect(host.querySelectorAll('.gg-plan-card')).toHaveLength(2);await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());expect(text()).toContain('吃饭');expect(text()).toContain('打台球');expect(host.querySelectorAll('.gg-plan-stop-card')).toHaveLength(3);await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.gg-plan-stop-card')).find(b=>b.textContent?.includes('打台球'))!.click());expect(text()).toContain('费用待核实');expect(text()).toContain('待核对的建议环节');expect(h.transport).not.toHaveBeenCalled();});
it('uses explicit confirmation to generate; a cancel does not write',async()=>{h.modal.mockResolvedValue({confirm:false});await render(gatheringUiFixture('friend',true));await click('内容整合看看每个人已经整理好的想法↗');await click('人齐了，生成安排！');expect(h.modal).toHaveBeenCalledOnce();expect(h.transport).not.toHaveBeenCalled();});
it('sends one bounded generation under the original session without private data',async()=>{const result=gatheringUiFixture();result.itinerary=gatheringPlanFixture();result.generation={id:gatheringId,status:'ready',error:null};h.transport.mockResolvedValue({status:200,body:result});await render();await click('内容整合看看每个人已经整理好的想法↗');await click('人齐了，生成安排！');expect(h.transport).toHaveBeenCalledOnce();const request=h.transport.mock.calls[0][0];expect(request).toMatchObject({path:`/api/v1/gatherings/${gatheringId}/generate`,method:'POST',headers:{Authorization:'Bearer session-a'}});expect(Object.keys(request.body).sort()).toEqual(['expected_source','idempotency_key']);expect(JSON.stringify(request)).not.toContain('PRIVATE_ONLY');expect(text()).toContain('方案1');expect(text()).toContain('安排已生成');});
it('never reports a failed generation replay as success and permits a fresh confirmed retry',async()=>{const failed=gatheringUiFixture();failed.generation={id:gatheringId,status:'failed',error:'生成未完成，请重新生成'};h.transport.mockResolvedValue({status:200,body:failed});await render();await click('内容整合看看每个人已经整理好的想法↗');await click('人齐了，生成安排！');expect(text()).toContain('生成未完成，请重新生成');expect(text()).not.toContain('安排已生成');expect(text()).toContain('人齐了，生成安排！');const key=h.transport.mock.calls[0][0].body.idempotency_key;await click('人齐了，生成安排！');expect(h.transport).toHaveBeenCalledTimes(2);expect(h.transport.mock.calls[1][0].body.idempotency_key).not.toBe(key);});
it('saves against the form versions captured on opening instead of a later refreshed questionnaire',async()=>{let value=gatheringUiFixture();const props={actor:gatheringOwner,session:'session-a',update:h.updated,refresh:h.refresh};await act(async()=>root.render(createElement(GatheringManage,{...props,snapshot:value})));await click('内容整合看看每个人已经整理好的想法↗');await click('修改我的想法');value={...value,gathering:{...value.gathering,revision:2},own:{...value.own!,version:2}};await act(async()=>root.render(createElement(GatheringManage,{...props,snapshot:value})));h.transport.mockResolvedValue({status:200,body:value});await click('完成本人整理');expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0].body).toMatchObject({expected_version:1,expected_revision:1});});
it('shows team statistics only to the owner and keeps the participant page free of results',async()=>{await render(gatheringUiFixture('team',true));expect(text()).toContain('问卷统计结果');expect(text()).toContain('2 人填写');await act(async()=>root.unmount());root=createRoot(host);await render(gatheringUiFixture('team',false),gatheringPeer);expect(text()).not.toContain('2 人填写');expect(text()).not.toContain('问卷统计结果');expect(text()).toContain('局头已确认的信息');});
it('allows opening a closed questionnaire in read-only mode',async()=>{const value=gatheringUiFixture('team',false);value.viewer.can_respond=false;await render(value,gatheringPeer);await click('查看我的填写');expect(h.readOnly).toBe(true);expect(text()).toContain('只读本人问卷');expect(h.transport).not.toHaveBeenCalled();});
it('hides stale actor content and never starts navigation or generation for another token',async()=>{await render(gatheringUiFixture('friend',false),gatheringPeer);expect(text()).toContain('朋友乙');expect(text()).not.toContain('PRIVATE_ONLY_MY_ORIGIN');h.token='session-b';await render(gatheringUiFixture('friend',false),gatheringPeer);expect(text()).not.toContain('PRIVATE_ONLY');expect(h.transport).not.toHaveBeenCalled();});

function sharedVisitor(kind:'friend'|'team'){
  const value=gatheringUiFixture(kind,false);value.viewer={is_owner:false,is_member:false,can_respond:true,can_generate:false};value.own=null;value.members=null;value.gathering.has_responded=false;return value;
}
it('opens a new friend share directly in AI intake and joins only on its explicit saved submission',async()=>{
  const next=gatheringUiFixture('friend',false);h.transport.mockResolvedValue({status:200,body:next});await render(sharedVisitor('friend'),gatheringPeer,'share');
  expect(text()).toContain('完成本人整理');expect(text()).not.toContain('参与并填写');expect(h.transport).not.toHaveBeenCalled();
  await click('完成本人整理');expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0]).toMatchObject({path:`/api/v1/gatherings/${gatheringId}/intake`,body:{join_if_needed:true,expected_version:0}});
  expect(host.querySelectorAll('.gg-menu-card')).toHaveLength(2);expect(text()).toContain('内容整合');expect(text()).toContain('活动安排');
});
it('opens a completed friend share in the two-choice management page instead of reopening intake',async()=>{
  await render(gatheringUiFixture('friend',false),gatheringPeer,'share');expect(host.querySelectorAll('.gg-menu-card')).toHaveLength(2);expect(text()).not.toContain('完成本人整理');expect(h.transport).not.toHaveBeenCalled();
});
it('opens a new team share directly in the questionnaire then moves to activity arrangements',async()=>{
  h.transport.mockResolvedValue({status:200,body:gatheringUiFixture('team',false)});await render(sharedVisitor('team'),gatheringPeer,'share');expect(text()).toContain('保存本人问卷');expect(h.transport).not.toHaveBeenCalled();
  await click('保存本人问卷');expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0].body).toMatchObject({join_if_needed:true,expected_version:0});expect(text()).toContain('活动安排');expect(text()).toContain('查看我的填写');expect(text()).not.toContain('问卷统计结果');
  await click('查看我的填写');expect(h.readOnly).toBe(false);expect(text()).toContain('保存本人问卷');
});
it('opens a completed team share in arrangements with an editable view-my-response entry',async()=>{
  await render(gatheringUiFixture('team',false),gatheringPeer,'share');expect(text()).toContain('活动安排');expect(text()).toContain('查看我的填写');expect(text()).not.toContain('保存本人问卷');await click('查看我的填写');expect(h.readOnly).toBe(false);
});
it('keeps personal ideas editable after suggestions have been generated but before a final choice',async()=>{
  const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();await render(value);await click('内容整合看看每个人已经整理好的想法↗');await click('修改我的想法');expect(h.intakeReadOnly).toBe(false);expect(h.saving).toBe(false);
});
it('requires an explicit final choice and sends only its generation, plan and source identifiers',async()=>{
  const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();const finalized=structuredClone(value);finalized.final_choice={generation_id:gatheringId,plan_id:'plan1',finalized_at:'2030-11-01T00:01:00Z'};finalized.viewer.can_respond=false;finalized.viewer.can_generate=false;h.transport.mockResolvedValue({status:200,body:finalized});await render(value);await click('活动安排2 套方案，点击查看顺序环节↗');await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());
  h.modal.mockResolvedValueOnce({confirm:false});await click('确定采用这套方案');expect(h.transport).not.toHaveBeenCalled();await click('确定采用这套方案');
  expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0]).toMatchObject({path:`/api/v1/gatherings/${gatheringId}/finalize`,body:{generation_id:gatheringId,plan_id:'plan1',expected_source:'a'.repeat(64)}});expect(Object.keys(h.transport.mock.calls[0][0].body).sort()).toEqual(['expected_source','generation_id','plan_id']);
  expect(host.querySelectorAll('.gg-final-stop')).toHaveLength(3);expect(text()).toContain('筹备方案已定案');await click('查看完整安排');expect(text()).toContain('安排1 · 吃饭');await click('← 返回全部方案');expect(text()).toContain('筹备方案已定案');await click('查看我的填写');expect(h.intakeReadOnly).toBe(true);
});
it('does not offer an adopt action for a stale proposal',async()=>{const value=gatheringUiFixture();value.itinerary={...gatheringPlanFixture(),stale:true};await render(value);await click('活动安排2 套方案，点击查看顺序环节↗');await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());expect(button('确定采用这套方案').disabled).toBe(true);expect(h.transport).not.toHaveBeenCalled();});

it('adopts the explicitly switched candidate and never sends a write while browsing',async()=>{
  const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();await render(value);
  await click('活动安排2 套方案，点击查看顺序环节↗');await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());
  await act(async()=>host.querySelectorAll<HTMLButtonElement>('.gg-plan-tabs button')[1]!.click());
  expect(h.transport).not.toHaveBeenCalled();
  h.transport.mockResolvedValue({status:409,body:{error:{code:'CONCURRENT_MODIFICATION',message:'想法已更新，请刷新'},request_id:'plan-test'}});
  await click('确定采用这套方案');expect(h.transport.mock.calls[0][0].body.plan_id).toBe(value.itinerary.plans[1].id);
  expect(text()).toContain('请刷新核对后再操作');
});

it('restores plan and overview scroll on return without creating another page',async()=>{
  h.scrollTo.mockClear();const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();await render(value);
  await click('活动安排2 套方案，点击查看顺序环节↗');h.pageScroll?.({scrollTop:180});
  await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());
  h.pageScroll?.({scrollTop:420});await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-stop-card')!.click());
  await click('← 返回方案');await act(async()=>{await new Promise(r=>setTimeout(r,10));});
  expect(h.scrollTo).toHaveBeenLastCalledWith({scrollTop:420,duration:0});
  await click('← 返回全部方案');await act(async()=>{await new Promise(r=>setTimeout(r,10));});
  expect(h.scrollTo).toHaveBeenLastCalledWith({scrollTop:180,duration:0});expect(h.transport).not.toHaveBeenCalled();
});

it('lets a member switch candidates without exposing the owner adoption action',async()=>{
  const value=gatheringUiFixture('friend',false);value.itinerary=gatheringPlanFixture();await render(value,gatheringPeer);
  await click('活动安排');await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());
  expect(host.querySelectorAll('.gg-plan-tabs button')).toHaveLength(value.itinerary.plans.length);
  expect(text()).not.toContain('确定采用这套方案');expect(text()).toContain('由组织者核对');expect(h.transport).not.toHaveBeenCalled();
});

it('requires a verifiable source before allowing a final choice',async()=>{
  const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();value.source_fingerprint=null;await render(value);
  await click('活动安排2 套方案，点击查看顺序环节↗');await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());
  expect(button('确定采用这套方案').disabled).toBe(true);expect(text()).toContain('方案来源暂时无法核对');expect(h.transport).not.toHaveBeenCalled();
});

function finalSnapshot(owner=true){const value=gatheringUiFixture('friend',owner);value.itinerary=gatheringPlanFixture();value.final_choice={generation_id:gatheringId,plan_id:'plan2',finalized_at:'2030-11-01T00:01:00Z'};value.viewer.can_respond=false;value.viewer.can_generate=false;return value;}

it('reopens a persisted final choice with only its chosen plan and native share entry',async()=>{
  await render(finalSnapshot(false),gatheringPeer,'share');expect(text()).toContain('筹备方案已定案');
  expect(text()).toContain('下午茶');expect(text()).not.toContain('打台球');expect(text()).not.toContain('PRIVATE_ONLY');
  expect(button('分享给朋友').getAttribute('data-open-type')).toBe('share');expect(text()).not.toContain('确定采用这套方案');
  await click('查看我的填写');expect(h.intakeReadOnly).toBe(true);expect(h.transport).not.toHaveBeenCalled();
});

it('keeps a finalized shared visitor read-only without any private response entry',async()=>{
  const value=finalSnapshot(false);value.viewer.is_member=false;value.own=null;value.members=null;value.gathering.has_responded=false;
  await render(value,gatheringPeer,'share');expect(text()).toContain('筹备方案已定案');expect(text()).not.toContain('查看我的填写');
  expect(text()).not.toContain('继续填写');expect(text()).not.toContain('PRIVATE_ONLY');expect(h.transport).not.toHaveBeenCalled();
});

it('distinguishes a saved final choice from missing arrangement content',async()=>{
  const value=finalSnapshot();value.itinerary=null;await render(value);
  expect(text()).toContain('定案记录已保存，暂时无法核对完整安排');expect(button('查看完整安排').disabled).toBe(true);
  await click('重新读取安排');expect(h.refresh).toHaveBeenCalledOnce();expect(h.transport).not.toHaveBeenCalled();
});

it.each(['missing','different-plan','unlocked'])('does not display a success result for an unverified %s finalization receipt',async failure=>{
  const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();await render(value);
  await click('活动安排2 套方案，点击查看顺序环节↗');await act(async()=>host.querySelector<HTMLButtonElement>('.gg-plan-card')!.click());
  const result=finalSnapshot();if(failure==='missing')result.final_choice=null;
  if(failure==='different-plan')result.final_choice!.plan_id='plan2';
  if(failure==='unlocked'){result.final_choice!.plan_id='plan1';result.viewer.can_respond=true;}
  h.transport.mockResolvedValue({status:200,body:result});await click('确定采用这套方案');
  expect(h.updated).not.toHaveBeenCalled();expect(host.querySelector('.gg-final-result')).toBeNull();
  expect(text()).toContain('上次操作结果待核对');expect(text()).not.toContain('筹备方案已定案');
});

it('shows local animal avatars and activity nicknames with no profile links or private budget/origin in integration',async()=>{await render(gatheringUiFixture('friend',false),gatheringPeer);expect(text()).toContain('朋友乙');expect(host.querySelectorAll('.gg-person button')).toHaveLength(0);expect(host.querySelectorAll('.gg-avatar-link')).toHaveLength(0);expect(text()).not.toContain('PRIVATE_ONLY');expect(h.transport).not.toHaveBeenCalled();});

it('passes pending save state and the exact original retry into the editor while leaving its save action locked',async()=>{
  h.transport.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','未知写入结果',0));await render();await click('内容整合看看每个人已经整理好的想法↗');await click('修改我的想法');await click('完成本人整理');expect(h.transport).toHaveBeenCalledOnce();expect(h.saving).toBe(true);expect(button('完成本人整理').disabled).toBe(true);expect(host.querySelector('[data-testid="editor-save-feedback"]')?.textContent).toContain('原内容已保留');const original=h.transport.mock.calls[0][0];let finish!:(value:unknown)=>void;h.transport.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const recovery=host.querySelector<HTMLButtonElement>('[data-testid="editor-save-retry"]')!;expect(recovery.disabled).toBe(false);await act(async()=>recovery.click());expect(h.transport).toHaveBeenCalledTimes(2);expect(h.transport.mock.calls[1][0]).toEqual(original);expect(host.querySelector<HTMLButtonElement>('[data-testid="editor-save-retry"]')?.disabled).toBe(true);expect(button('完成本人整理').disabled).toBe(true);await act(async()=>finish({status:200,body:gatheringUiFixture()}));expect(h.updated).toHaveBeenCalledOnce();expect(host.querySelector('[data-testid="editor-save-retry"]')).toBeNull();expect(text()).toContain('服务端已确认保存');
});

function workflowSnapshot(kind:'friend'|'team'='friend',owner=false):GatheringSnapshot{
 const result=gatheringUiFixture(kind,owner);result.itinerary=gatheringPlanFixture();result.viewer.can_generate=owner;
 result.workflow={version:1,generation_id:gatheringId,phase:'selecting',stale:false,proposal_plan_id:null,proposal_version:0,coordination_note:'',total:kind==='friend'?2:0,selected_count:0,accepted_count:0,rejected_count:0,own_selection:null,own_confirmation:null,people:[],final_plan:null};return result;
}
it('posts member multi-plan preferences to workflow without treating the choice as final consent',async()=>{
 const initial=workflowSnapshot();const saved=structuredClone(initial);saved.workflow!.version=2;saved.workflow!.own_selection={version:1,plan_ids:['plan1','plan2'],note:''};saved.workflow!.selected_count=1;h.transport.mockResolvedValue({status:200,body:saved});
 await render(initial,gatheringPeer);const choose=Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(b=>b.textContent==='选择这套偏好');await act(async()=>choose[0].click());await act(async()=>choose[1].click());await click('保存我的方案选择');
 expect(h.transport.mock.calls[0][0]).toMatchObject({path:`/api/v1/gatherings/${gatheringId}/workflow`,body:{action:'select',plan_ids:['plan1','plan2'],expected_version:0}});expect(h.updated.mock.calls[0][0].final_choice).toBeNull();expect(text()).toContain('已选偏好 1 / 2 人');
});
it('keeps unknown workflow writes and retries the original key rather than sending a new selection',async()=>{
 const initial=workflowSnapshot();h.transport.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','结果未知',0));await render(initial,gatheringPeer);await click('这些都不合适，提交意见');const first=h.transport.mock.calls[0][0].body;
 const saved=structuredClone(initial);saved.workflow!.version=2;saved.workflow!.own_selection={version:1,plan_ids:[],note:''};h.transport.mockResolvedValue({status:200,body:saved});await click('沿用原请求核对操作');expect(h.transport.mock.calls[1][0].body).toEqual(first);expect(h.store.has(`weevibe-gathering-workflow-pending-v1:${gatheringPeer}:${gatheringId}`)).toBe(false);
});
it('sends explicit consent for the proposed version and waits for other members',async()=>{
 const initial=workflowSnapshot();Object.assign(initial.workflow!,{phase:'confirming',proposal_plan_id:'plan1',proposal_version:3,selected_count:2});const saved=structuredClone(initial);Object.assign(saved.workflow!,{version:2,accepted_count:1,own_confirmation:{version:1,proposal_version:3,decision:'accept',note:''}});h.transport.mockResolvedValue({status:200,body:saved});await render(initial,gatheringPeer);expect(text()).not.toContain('轻松聊天路线');await click('我确认这套安排');expect(h.transport.mock.calls[0][0].body).toMatchObject({action:'respond',proposal_version:3,decision:'accept'});expect(text()).toContain('等待其他人');expect(h.updated.mock.calls[0][0].final_choice).toBeNull();
});
it('shows only the finalized team plan to members and never asks for all-member consent',async()=>{
 const initial=workflowSnapshot('team');Object.assign(initial.workflow!,{phase:'completed',proposal_plan_id:'plan2',proposal_version:1,final_plan:initial.itinerary!.plans[1]});initial.itinerary=null;initial.viewer.can_respond=false;await render(initial,gatheringPeer);expect(text()).toContain('轻松聊天路线');expect(text()).not.toContain('吃饭与娱乐结合');expect(text()).not.toContain('我确认这套安排');expect(text()).not.toContain('问卷统计结果');expect(h.transport).not.toHaveBeenCalled();
});
it('blocks stale workflow writes while keeping refresh and owner regeneration available',async()=>{
 const initial=workflowSnapshot('friend',true);initial.workflow!.stale=true;await render(initial);expect(text()).toContain('旧方案不能继续选择或确认');expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='我确认这套安排')).toBe(false);expect(button('重新生成推荐安排').disabled).toBe(false);await click('刷新核对进度');expect(h.refresh).toHaveBeenCalledOnce();expect(h.transport).not.toHaveBeenCalled();
});
