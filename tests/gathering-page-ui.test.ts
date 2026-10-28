// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {GatheringSnapshot} from '../packages/contracts/src';
import {gatheringId,gatheringOwner,gatheringPeer,gatheringUiFixture} from './gathering-ui-fixtures';

const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',params:{} as Record<string,string>,automatic:vi.fn(),establish:vi.fn(),transport:vi.fn(),manage:vi.fn(),designer:vi.fn(),show:undefined as (()=>void)|undefined,hide:undefined as (()=>void)|undefined,unload:undefined as (()=>void)|undefined,share:undefined as (()=>{path:string;title:string})|undefined}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,establishSession:h.establish,transport:h.transport}));
vi.mock('../apps/miniprogram/src/platform/automatic-session',()=>({automaticUser:h.automatic}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{navigateBack:vi.fn().mockResolvedValue({}),reLaunch:vi.fn().mockResolvedValue({})},useRouter:()=>({params:h.params}),useDidShow:(f:()=>void)=>{h.show=f;},useDidHide:(f:()=>void)=>{h.hide=f;},useUnload:(f:()=>void)=>{h.unload=f;},useShareAppMessage:(f:()=>{path:string;title:string})=>{h.share=f;}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children)}));
vi.mock('../apps/miniprogram/src/components/privacy-consent',()=>({PrivacyConsent:()=>null}));
vi.mock('../apps/miniprogram/src/features/gatherings/manage',()=>({GatheringManage:(p:{actor:string;session:string;snapshot:GatheringSnapshot;entry?:'share'|'manage'})=>{h.manage(p);return createElement('div',{className:'test-manage','data-actor':p.actor,'data-session':p.session,'data-member':String(p.snapshot.viewer.is_member),'data-entry':p.entry??'manage'},p.snapshot.gathering.title,p.snapshot.own?.intake.private.budget_note);}}));
vi.mock('../apps/miniprogram/src/features/gatherings/designer',()=>({GatheringDesigner:(p:{actor:string;session:string;kind:string})=>{h.designer(p);return createElement('div',{className:'test-designer'},p.kind);}}));
import GatheringPage from '../apps/miniprogram/src/features/gatherings';

let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{h.token='session-a';h.params={id:gatheringId};h.show=undefined;h.hide=undefined;h.unload=undefined;h.share=undefined;h.automatic.mockReset().mockResolvedValue({session:'session-a',user:{user_id:gatheringOwner}});h.establish.mockReset();h.transport.mockReset();h.manage.mockReset();h.designer.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
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

it('opens a new team designer only after identity confirmation without reading or creating a gathering',async()=>{
  h.params={new:'team'};const identity=deferred<{session:string;user:{user_id:string}}>();h.automatic.mockReturnValue(identity.promise);
  await mount();expect(host.querySelector('.test-designer')).toBeNull();expect(h.transport).not.toHaveBeenCalled();
  await act(async()=>identity.resolve({session:'session-a',user:{user_id:gatheringOwner}}));
  expect(h.designer.mock.calls.at(-1)?.[0]).toMatchObject({actor:gatheringOwner,session:'session-a',kind:'team'});expect(h.manage).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();
});
