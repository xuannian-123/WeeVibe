// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {GatheringSnapshot} from '../packages/contracts/src';
import {gatheringId,gatheringOwner,gatheringPeer,gatheringUiFixture,gatheringPlanFixture} from './gathering-ui-fixtures';

const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',params:{} as Record<string,string>,automatic:vi.fn(),establish:vi.fn(),transport:vi.fn(),manage:vi.fn(),designer:vi.fn(),showHistory:[] as (()=>void)[],show:undefined as (()=>void)|undefined,hide:undefined as (()=>void)|undefined,unload:undefined as (()=>void)|undefined,share:undefined as (()=>{path:string;title:string})|undefined}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,establishSession:h.establish,transport:h.transport}));
vi.mock('../apps/miniprogram/src/platform/automatic-session',()=>({automaticUser:h.automatic}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{navigateBack:vi.fn().mockResolvedValue({}),reLaunch:vi.fn().mockResolvedValue({})},useRouter:()=>({params:h.params}),useDidShow:(f:()=>void)=>{h.show=f;h.showHistory.push(f);},useDidHide:(f:()=>void)=>{h.hide=f;},useUnload:(f:()=>void)=>{h.unload=f;},useShareAppMessage:(f:()=>{path:string;title:string})=>{h.share=f;}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Image:()=>null,View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children)}));
vi.mock('../apps/miniprogram/src/components/privacy-consent',()=>({PrivacyConsent:()=>null}));
vi.mock('../apps/miniprogram/src/features/gatherings/manage',()=>({GatheringManage:(p:{actor:string;session:string;snapshot:GatheringSnapshot;entry?:'share'|'manage'})=>{h.manage(p);return createElement('div',{className:'test-manage','data-actor':p.actor,'data-session':p.session,'data-member':String(p.snapshot.viewer.is_member),'data-entry':p.entry??'manage'},p.snapshot.gathering.title,p.snapshot.own?.intake.private.budget_note);}}));
vi.mock('../apps/miniprogram/src/features/gatherings/designer',()=>({GatheringDesigner:(p:{actor:string;session:string;kind:string})=>{h.designer(p);return createElement('div',{className:'test-designer'},p.kind);}}));
vi.mock('../apps/miniprogram/src/features/gatherings/profile-boundary',()=>({GatheringProfileBoundary:({children}:any)=>children}));
import GatheringPage from '../apps/miniprogram/src/features/gatherings';

let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{h.token='session-a';h.params={id:gatheringId};h.showHistory=[];h.show=undefined;h.hide=undefined;h.unload=undefined;h.share=undefined;h.automatic.mockReset().mockResolvedValue({session:'session-a',user:{user_id:gatheringOwner}});h.establish.mockReset();h.transport.mockReset();h.manage.mockReset();h.designer.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const response=(body:GatheringSnapshot)=>({status:200,body});
const text=()=>host.textContent||'';
async function mount(){await act(async()=>root.render(createElement(GatheringPage)));await act(async()=>h.show?.());}
async function switchAccount(){await act(async()=>h.hide?.());h.token='session-b';h.automatic.mockResolvedValue({session:'session-b',user:{user_id:gatheringPeer}});await act(async()=>h.show?.());}
function namedFixture(title:string,owner=true){const value=gatheringUiFixture('friend',owner);value.gathering.title=title;value.own!.intake.private.budget_note=`${title}_PRIVATE_BUDGET`;return value;}

it('hides a loaded account snapshot while a different account is being confirmed and read',async()=>{
  const wait=deferred<ReturnType<typeof response>>();h.transport.mockResolvedValueOnce(response(namedFixture('OLD_ACCOUNT'))).mockReturnValueOnce(wait.promise);
  await mount();expect(text()).toContain('OLD_ACCOUNT_PRIVATE_BUDGET');
  await switchAccount();expect(h.transport).toHaveBeenCalledTimes(2);expect(text()).not.toContain('OLD_ACCOUNT');expect(host.querySelector('.test-manage')).toBeNull();
  await act(async()=>wait.resolve(response(namedFixture('NEW_ACCOUNT',false))));
  expect(text()).toContain('NEW_ACCOUNT_PRIVATE_BUDGET');expect(host.querySelector('.test-manage')?.getAttribute('data-actor')).toBe(gatheringPeer);expect(host.querySelector('.test-manage')?.getAttribute('data-session')).toBe('session-b');
});

it('ignores an old account delayed response after the new account read has finished',async()=>{
  const old=deferred<ReturnType<typeof response>>(),next=deferred<ReturnType<typeof response>>();h.transport.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await mount();await switchAccount();expect(h.transport).toHaveBeenCalledTimes(2);
  await act(async()=>next.resolve(response(namedFixture('CURRENT_ACCOUNT',false))));expect(text()).toContain('CURRENT_ACCOUNT');
  await act(async()=>old.resolve(response(namedFixture('LATE_OLD_ACCOUNT'))));
  expect(text()).toContain('CURRENT_ACCOUNT');expect(text()).not.toContain('LATE_OLD_ACCOUNT');expect(host.querySelector('.test-manage')?.getAttribute('data-actor')).toBe(gatheringPeer);
});

it.each(['friend','team'] as const)('passes a %s share visitor to its share landing without implicitly joining',async kind=>{
  h.params={id:gatheringId,entry:'share'};
  const invitation=gatheringUiFixture(kind,false);invitation.viewer={is_owner:false,is_member:false,can_respond:true,can_generate:false};invitation.gathering.has_responded=false;invitation.own=null;invitation.members=null;invitation.source_fingerprint=null;
  h.transport.mockResolvedValue(response(invitation));await mount();
  expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0]).toMatchObject({path:`/api/v1/gatherings/${gatheringId}`,method:'GET',headers:{Authorization:'Bearer session-a'}});
  expect(host.querySelector('.test-manage')?.getAttribute('data-member')).toBe('false');expect(host.querySelector('.test-manage')?.getAttribute('data-entry')).toBe('share');expect(h.manage.mock.calls.at(-1)?.[0].snapshot.own).toBeNull();expect(h.manage.mock.calls.at(-1)?.[0].snapshot.gathering.kind).toBe(kind);expect(h.transport.mock.calls.some(([request])=>request.method==='POST')).toBe(false);
});

it('shares an explicit share entry with the actual id and no private payload, and drops it when the account changes',async()=>{
  h.transport.mockResolvedValue(response(gatheringUiFixture()));await mount();
  const shared=h.share?.();expect(shared?.path).toBe(`/pages/gathering/index?id=${gatheringId}&entry=share`);expect(shared?.title).toContain('朋友出游');expect(JSON.stringify(shared)).not.toMatch(/PRIVATE_ONLY|session-a|11111111/);
  expect(host.querySelector('.test-manage')?.getAttribute('data-entry')).toBe('manage');
  h.token='session-b';expect(h.share?.().path).toBe('/pages/index/index');
});

it('retains a submitted member snapshot when an earlier invitation read arrives with no own intake and a later server time',async()=>{
  h.params={id:gatheringId,entry:'share'};
  const invitation=gatheringUiFixture('friend',false);invitation.viewer={is_owner:false,is_member:false,can_respond:true,can_generate:false};invitation.gathering.has_responded=false;invitation.own=null;invitation.members=null;invitation.source_fingerprint=null;
  const pending=deferred<ReturnType<typeof response>>();h.transport.mockResolvedValueOnce(response(invitation)).mockReturnValueOnce(pending.promise);
  await mount();const props=h.manage.mock.calls.at(-1)![0] as {refresh:()=>Promise<void>;update:(next:GatheringSnapshot)=>void};
  let refresh!:Promise<void>;await act(async()=>{refresh=props.refresh();await Promise.resolve();});expect(h.transport).toHaveBeenCalledTimes(2);
  const submitted=namedFixture('SUBMITTED_CURRENT',false);submitted.server_time='2030-11-01T00:00:01Z';await act(async()=>props.update(submitted));expect(text()).toContain('SUBMITTED_CURRENT_PRIVATE_BUDGET');
  const late={...invitation,gathering:{...invitation.gathering,title:'LATE_INVITATION'},server_time:'2030-11-01T00:00:59Z'};
  await act(async()=>{pending.resolve(response(late));await refresh;});
  expect(text()).toContain('SUBMITTED_CURRENT_PRIVATE_BUDGET');expect(text()).not.toContain('LATE_INVITATION');expect(host.querySelector('.test-manage')?.getAttribute('data-member')).toBe('true');expect(h.manage.mock.calls.at(-1)?.[0].snapshot.own.version).toBe(1);
});

it.each(['friend','team'] as const)('opens a new %s designer only after identity confirmation without skipping its start screen or creating a gathering',async kind=>{
  h.params={new:kind};const identity=deferred<{session:string;user:{user_id:string}}>();h.automatic.mockReturnValue(identity.promise);
  await mount();expect(host.querySelector('.test-designer')).toBeNull();expect(h.transport).not.toHaveBeenCalled();
  if(kind==='friend'){expect(host.querySelector('.gg-top')).toBeNull();expect(text()).not.toContain('← 返回');}
  await act(async()=>identity.resolve({session:'session-a',user:{user_id:gatheringOwner}}));
  expect(h.designer.mock.calls.at(-1)?.[0]).toMatchObject({actor:gatheringOwner,session:'session-a',kind});expect(h.designer.mock.calls.at(-1)?.[0]).not.toHaveProperty('startWithIntake');expect(h.manage).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();
});

it('binds sharing to the newly created gathering while the page still has a new-friend route',async()=>{
  h.params={new:'friend'};await mount();expect(h.share?.().path).toBe('/pages/index/index');
  const created=h.designer.mock.calls.at(-1)![0].onCreated as (value:GatheringSnapshot)=>void;const value=gatheringUiFixture();await act(async()=>created(value));
  expect(h.share?.().path).toBe(`/pages/gathering/index?id=${gatheringId}&entry=share`);expect(h.share?.().title).toContain(value.gathering.title);expect(JSON.stringify(h.share?.())).not.toContain('PRIVATE_ONLY');expect(h.transport).not.toHaveBeenCalled();
  await switchAccount();expect(h.share?.().path).toBe('/pages/index/index');await act(async()=>created(value));expect(h.share?.().path).toBe('/pages/index/index');
});
it.each([{id:'../../invalid'},{id:gatheringId,new:'friend'},{new:'unsupported'},{}])('rejects an invalid or conflicting entry before reading identity or creating anything: %j',async params=>{
  h.params=Object.fromEntries(Object.entries(params).filter(([,value])=>typeof value==='string'));await mount();expect(h.automatic).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();expect(h.designer).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();expect(text()).toContain('入口不完整');expect(h.share?.().path).toBe('/pages/index/index');
});
it('continues the same invitation after explicit login with only a read',async()=>{
  h.token='';h.params={id:gatheringId,entry:'share'};h.automatic.mockRejectedValueOnce(Error('需要微信身份')).mockResolvedValue({session:'session-a',user:{user_id:gatheringPeer}});h.establish.mockImplementation(async()=>{h.token='session-a';});
  const visitor=gatheringUiFixture('friend',false);visitor.viewer.is_member=false;visitor.own=null;visitor.members=null;visitor.gathering.has_responded=false;visitor.source_fingerprint=null;h.transport.mockResolvedValue(response(visitor));await mount();
  expect(h.transport).not.toHaveBeenCalled();const login=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='微信登录并继续')!;await act(async()=>login.click());expect(h.establish).toHaveBeenCalledOnce();expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0]).toMatchObject({method:'GET',path:`/api/v1/gatherings/${gatheringId}`});expect(h.manage.mock.calls.at(-1)?.[0]).toMatchObject({entry:'share',actor:gatheringPeer});expect(h.params).toEqual({id:gatheringId,entry:'share'});
});
it('keeps the unknown shared activity loading screen free of the legacy header',async()=>{
  h.params={id:gatheringId,entry:'share'};const pending=deferred<ReturnType<typeof response>>();h.transport.mockReturnValueOnce(pending.promise);await mount();expect(host.querySelector('.gg-top')).toBeNull();expect(text()).not.toContain('WeeVibe•');expect(text()).toContain('正在打开这次相聚');expect(h.manage).not.toHaveBeenCalled();await act(async()=>pending.resolve(response(gatheringUiFixture('friend',false))));expect(h.manage).toHaveBeenCalled();
});

it.each(['unlocked','generation','proposal','missing-choice','incomplete-count','private-visitor'])('rejects a contradictory post-final %s snapshot before mounting its member UI',async mode=>{const value=gatheringUiFixture();value.itinerary=gatheringPlanFixture();value.final_choice={generation_id:gatheringId,plan_id:'plan1',finalized_at:'2030-11-01T00:01:00Z'};value.viewer.can_respond=false;value.viewer.can_generate=false;value.workflow={version:5,generation_id:gatheringId,phase:'completed',proposal_plan_id:'plan1',proposal_version:2,stale:false,coordination_note:'',total:2,selected_count:2,accepted_count:2,rejected_count:0,own_selection:null,own_confirmation:null,people:[],final_plan:value.itinerary.plans[0]};if(mode==='unlocked')value.viewer.can_respond=true;if(mode==='generation')value.workflow.generation_id=gatheringOwner;if(mode==='proposal')value.workflow.proposal_plan_id='plan2';if(mode==='missing-choice')value.final_choice=null;if(mode==='incomplete-count')value.workflow.accepted_count=1;if(mode==='private-visitor'){value.viewer.is_owner=false;value.viewer.is_member=false;}h.transport.mockResolvedValue(response(value));await mount();expect(h.manage).not.toHaveBeenCalled();expect(text()).toContain('筹备响应无法核实');expect(h.share?.().path).toBe('/pages/index/index');expect(h.transport.mock.calls.every(([r])=>r.method==='GET')).toBe(true);});

it('shares the same final record with an explicit final title and no intake or consent payload',async()=>{const value=gatheringUiFixture();value.final_choice={generation_id:gatheringId,plan_id:'plan2',finalized_at:'2030-11-01T00:01:00Z'};value.viewer.can_respond=false;value.viewer.can_generate=false;h.transport.mockResolvedValue(response(value));await mount();const share=h.share?.();expect(share?.path).toBe(`/pages/gathering/index?id=${gatheringId}&entry=share`);expect(share?.title).toContain('安排已定案');expect(JSON.stringify(share)).not.toMatch(/PRIVATE_ONLY|idempotency|proposal_version/);expect(h.transport.mock.calls.every(([r])=>r.method==='GET')).toBe(true);});

it('retains a same-account final record after a transient foreground refresh failure and marks it unverified until recovery',async()=>{const value=gatheringUiFixture();value.final_choice={generation_id:gatheringId,plan_id:'plan1',finalized_at:'2030-11-01T00:01:00Z'};value.viewer.can_respond=false;value.viewer.can_generate=false;h.transport.mockResolvedValueOnce(response(value)).mockResolvedValueOnce({status:503,body:{error:{code:'UPSTREAM_UNAVAILABLE',message:'暂未读到最新安排'}}});await mount();const originalShow=h.showHistory[0]!;await act(async()=>originalShow());expect(host.querySelector('.test-manage')).not.toBeNull();expect(text()).toContain('上次读取的定案记录');expect(h.manage.mock.calls.at(-1)?.[0].readVerified).toBe(false);h.transport.mockResolvedValueOnce(response(value));await act(async()=>h.manage.mock.calls.at(-1)![0].refresh());expect(text()).not.toContain('上次读取的定案记录');expect(h.manage.mock.calls.at(-1)?.[0].readVerified).toBe(true);expect(h.transport.mock.calls.every(([r])=>r.method==='GET')).toBe(true);});
it.each(['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'])('hides a cached final record when refreshed access is %s',async code=>{const value=gatheringUiFixture();value.final_choice={generation_id:gatheringId,plan_id:'plan1',finalized_at:'2030-11-01T00:01:00Z'};value.viewer.can_respond=false;value.viewer.can_generate=false;h.transport.mockResolvedValueOnce(response(value)).mockResolvedValueOnce({status:code==='NOT_FOUND'?404:code==='FORBIDDEN'?403:401,body:{error:{code,message:'当前访问已失效'},request_id:'post-final-access-test'}});await mount();await act(async()=>h.showHistory[0]!());expect(host.querySelector('.test-manage')).toBeNull();expect(text()).not.toContain('PRIVATE_ONLY');expect(h.share?.().path).toBe('/pages/index/index');});

it('hides cached own information even when a forbidden response body is malformed',async()=>{h.transport.mockResolvedValueOnce(response(gatheringUiFixture())).mockResolvedValueOnce({status:403,body:'unreadable proxy response'});await mount();await act(async()=>h.showHistory[0]!());expect(host.querySelector('.test-manage')).toBeNull();expect(text()).not.toContain('PRIVATE_ONLY');});
