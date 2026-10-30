// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {emptyGatheringIntake,type GatheringIntake} from '../packages/contracts/src';
import {makeGatheringIntakeProgress,type GatheringIntakeProgress,type GatheringIntakeProgressState} from '../apps/miniprogram/src/features/gatherings/intake-progress';

const mini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act,useState}=mini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=mini('react-dom/client') as {createRoot:(host:Element)=>{render:(node:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',organize:vi.fn(),account:vi.fn(),done:vi.fn(),cancel:vi.fn(),progress:vi.fn(),latest:vi.fn()}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token}));
vi.mock('../apps/miniprogram/src/platform/account-api',()=>({requestAccount:h.account}));
vi.mock('../apps/miniprogram/src/features/gatherings/client',()=>({organizeGathering:h.organize,gatheringMessage:(e:unknown)=>e instanceof Error?e.message:'暂未整理'}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{pageScrollTo:vi.fn().mockResolvedValue({})},useDidShow:()=>{},useDidHide:()=>{},useUnload:()=>{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{className:p.className},p.children),Button:(p:any)=>createElement('button',{className:p.className,disabled:p.disabled,onClick:p.onClick},p.children),Image:()=>null}));
vi.mock('../apps/miniprogram/src/features/gatherings/nickname-step',()=>({GatheringNicknameStep:(p:any)=>createElement('div',{className:'test-nickname'},createElement('input',{value:p.value,onInput:(e:any)=>p.change(e.currentTarget.value)}),createElement('span',{},p.mode),createElement('button',{onClick:p.next},'下一步'),p.notice)}));
vi.mock('../apps/miniprogram/src/features/gatherings/preference-form',()=>({GatheringPreferenceForm:(p:any)=>createElement('div',{className:'test-form','data-step':p.step},createElement('span',{className:'test-date'},p.value.public.date),createElement('input',{className:'test-min',value:p.budgetMin,onInput:(e:any)=>p.minChange(e.currentTarget.value)}),createElement('input',{className:'test-max',value:p.budgetMax,onInput:(e:any)=>p.maxChange(e.currentTarget.value)}),createElement('button',{onClick:p.next},'下一步'),createElement('button',{onClick:p.organize},'整理'),p.notice)}));
vi.mock('../apps/miniprogram/src/features/design-c/interview-inputs',()=>({CInterviewInputs:()=>null}));
vi.mock('../apps/miniprogram/src/features/design-c/interview-view',()=>({CInterviewView:(p:any)=>createElement('div',{className:'test-interview','data-index':p.index},createElement('span',{},p.turns[p.index]?.question),createElement('span',{className:'test-ack'},p.turns[p.index]?.acknowledgement),createElement('input',{value:p.composer,onInput:(e:any)=>p.onComposerChange(e.currentTarget.value)}),createElement('button',{onClick:()=>p.onSend(p.composer)},'发送'),createElement('button',{disabled:!p.canSummarize,onClick:p.onSummarize},'帮我整理'),p.notice)}));
vi.mock('../apps/miniprogram/src/features/design-c/interview-review',()=>({CInterviewReview:(p:any)=>createElement('div',{className:'test-confirm'},p.summary,p.selected.join(','),p.notice,createElement('button',{onClick:p.onCommit},'明确确认'),createElement('button',{onClick:p.onBack},'返回核对'))}));
import {GatheringIntakeEditor} from '../apps/miniprogram/src/features/gatherings/intake-editor';

let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
function intake():GatheringIntake{const value=emptyGatheringIntake();value.public.activity_nickname='已保存昵称';value.public.date='2030-11-08';return value;}
function progress(patch:Partial<GatheringIntakeProgressState>={}):GatheringIntakeProgress{
  return makeGatheringIntakeProgress({intake:intake(),mode:'interview',step:3,budgetMinText:'',budgetMaxText:'',answered:[true,true,false,false,false],noteBase:'',questionProse:{},acknowledgements:{},composers:{},confirm:false,selected:[],summary:'',...patch})!;
}
const props=()=>({initial:intake(),date:'2030-11-08',session:'session-a',creating:true,done:h.done,cancel:h.cancel});
async function render(extra:Record<string,unknown>={}){await act(async()=>root.render(createElement(GatheringIntakeEditor,{...props(),...extra})));}
async function click(label:string){const button=Array.from(host.querySelectorAll('button')).find(node=>node.textContent===label);expect(button,label).toBeTruthy();await act(async()=>button!.click());}
async function input(selector:string,text:string){const field=host.querySelector<HTMLInputElement>(selector);expect(field,selector).toBeTruthy();await act(async()=>{field!.value=text;field!.dispatchEvent(new Event('input',{bubbles:true}));});}
async function reopen(extra:Record<string,unknown>){await act(async()=>root.unmount());root=createRoot(host);await render(extra);}
beforeEach(()=>{h.token='session-a';h.progress.mockReset();h.latest.mockReset();h.done.mockReset();h.cancel.mockReset();h.account.mockReset();h.organize.mockReset().mockResolvedValue({summary:'整理结果',source:'ai',blocks:[]});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});

it('ignores progress entirely when the parent did not opt into local persistence',async()=>{
  await render({draftProgress:progress({composers:{2:'私人预算未发'}})});
  expect(host.querySelector('.test-nickname')).not.toBeNull();expect(host.querySelector('.test-interview')).toBeNull();
  expect(h.progress).not.toHaveBeenCalled();expect(h.organize).not.toHaveBeenCalled();
});

it('restores the exact private question and unsent composer without sending or advancing',async()=>{
  const saved=progress({composers:{2:'200以内'},acknowledgements:{1:'私人出发地点已记录'}});
  await render({draftProgress:saved,onDraftProgress:h.progress});
  expect(host.querySelector('.test-interview')?.getAttribute('data-index')).toBe('2');
  expect(host.querySelector('input')?.value).toBe('200以内');
  expect(h.organize).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();expect(h.account).not.toHaveBeenCalled();
  await click('发送');
  expect(host.querySelector('.test-interview')?.getAttribute('data-index')).toBe('3');
  const next=h.progress.mock.calls.at(-1)![0] as GatheringIntakeProgress;
  expect(next.intake.private.budget_max).toBe(200);expect(next.composers[2]).toBe('');
  expect(next.answered).toEqual([true,true,true,false,false]);expect(h.organize).not.toHaveBeenCalled();
});

it('round-trips an unfinished decimal in form mode through a JSON local draft',async()=>{
  const saved=progress({mode:'form',step:1,budgetMinText:'1.',intake:{...intake(),private:{...intake().private,budget_min:1}}});
  await render({draftProgress:saved,onDraftProgress:h.progress});
  expect(host.querySelector('.test-form')?.getAttribute('data-step')).toBe('1');
  expect(host.querySelector<HTMLInputElement>('.test-min')?.value).toBe('1.');
  await input('.test-min','1.25');
  const persisted=JSON.parse(JSON.stringify(h.progress.mock.calls.at(-1)![0]));
  await reopen({draftProgress:persisted,onDraftProgress:h.progress});
  expect(host.querySelector<HTMLInputElement>('.test-min')?.value).toBe('1.25');
  expect(h.organize).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();
});

it('does not resurrect a date explicitly cleared during an unfinished creation',async()=>{
  const draft=intake();draft.public.date='';
  await render({draftProgress:progress({mode:'form',step:1,intake:draft}),onDraftProgress:h.progress});
  expect(host.querySelector('.test-date')?.textContent).toBe('');
  await click('下一步');
  expect(host.textContent).toContain('请先选择出游日期');expect(h.organize).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();
});

it('restores confirmation as an explicit review and commits only after a new user tap',async()=>{
  await render({draftProgress:progress({mode:'form',step:4,confirm:true,selected:['date'],summary:'日期：2030-11-08'}),onDraftProgress:h.progress});
  expect(host.querySelector('.test-confirm')).not.toBeNull();expect(host.textContent).toContain('重新核对确定项');
  expect(h.organize).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();
  await click('明确确认');
  expect(h.done).toHaveBeenCalledOnce();expect(h.done.mock.calls[0][0].public.confirmed_keys).toEqual(['date']);
});

it('ignores a corrupted version and falls back to canonical saved input',async()=>{
  await render({draftProgress:{...progress(),version:99},onDraftProgress:h.progress});
  expect(host.querySelector('.test-nickname')).not.toBeNull();expect(host.querySelector('input')?.value).toBe('已保存昵称');
  expect(h.progress.mock.calls[0][0].version).toBe(1);expect(h.organize).not.toHaveBeenCalled();
});

it('does not write progress while showing saved read-only content',async()=>{
  const canonical=intake();canonical.private.budget_note='已保存的私人预算';
  const draft=intake();draft.private.budget_note='未保存的私人预算';
  await render({initial:canonical,readOnly:true,draftProgress:progress({intake:draft}),onDraftProgress:h.progress});
  expect(host.textContent).toContain('已保存的私人预算');expect(host.textContent).not.toContain('未保存的私人预算');
  expect(h.progress).not.toHaveBeenCalled();expect(h.organize).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();
});

it('does not loop when the parent stores every progress callback in its own state',async()=>{
  function Connected(){const [stored,setStored]=useState<unknown>();return createElement(GatheringIntakeEditor,{...props(),draftProgress:stored,onDraftProgress:(next:GatheringIntakeProgress)=>{h.progress(next);setStored(next);}});}
  await act(async()=>root.render(createElement(Connected)));
  expect(h.progress).toHaveBeenCalledOnce();
  await input('input','当前未完成昵称');
  expect(h.progress).toHaveBeenCalledTimes(2);
  expect(h.organize).not.toHaveBeenCalled();
});

it('uses progress only at initialization while applying the latest parent callback',async()=>{
  await render({onDraftProgress:h.progress});
  await input('input','当前未完成昵称');
  await render({draftProgress:progress({mode:'form',step:4}),onDraftProgress:h.latest});
  expect(host.querySelector('.test-nickname')).not.toBeNull();
  expect(host.querySelector('input')?.value).toBe('当前未完成昵称');
  expect(h.latest).not.toHaveBeenCalled();
  await input('input','刚修改的昵称');
  expect(h.latest).toHaveBeenCalledOnce();expect(h.organize).not.toHaveBeenCalled();
});

it('keeps persisted private fields in the local callback and out of an explicit organize request',async()=>{
  const draft=intake();draft.private.origin={label:'PRIVATE_DRAFT_HOME'};draft.private.budget_min=20;draft.private.budget_note='PRIVATE_DRAFT_BUDGET';
  await render({draftProgress:progress({intake:draft,mode:'form',step:4,budgetMinText:'20'}),onDraftProgress:h.progress});
  expect(h.organize).not.toHaveBeenCalled();await click('整理');
  expect(h.organize).toHaveBeenCalledOnce();expect(JSON.stringify(h.organize.mock.calls[0][1])).not.toMatch(/PRIVATE_DRAFT|budget|origin/);
  expect(h.progress.mock.calls.at(-1)![0].intake.private.budget_note).toBe('PRIVATE_DRAFT_BUDGET');
  expect(h.done).not.toHaveBeenCalled();
});

it('restores public prose and acknowledgement bookkeeping when an answered question is revised',async()=>{
  const draft=intake();draft.public.note='原有补充\n想一起散步';
  await render({draftProgress:progress({intake:draft,step:4,noteBase:'原有补充',questionProse:{3:'想一起散步'},acknowledgements:{3:'上次的想法已记录'},answered:[true,true,true,true,true],composers:{3:'还想一起喝茶'}}),onDraftProgress:h.progress});
  expect(host.querySelector('.test-ack')?.textContent).toBe('上次的想法已记录');
  await click('发送');
  const next=h.progress.mock.calls.at(-1)![0] as GatheringIntakeProgress;
  expect(next.intake.public.note).toBe('原有补充\n还想一起喝茶');
  expect(next.questionProse[3]).toBe('还想一起喝茶');
  expect(next.intake.public.note).not.toContain('想一起散步');
  expect(h.organize).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();
});
