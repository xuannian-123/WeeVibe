// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {gatheringSubscriptionIntentSchema} from '../packages/contracts/src';
const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const{createElement,act}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const{createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type NativeOptions={tmplIds:string[];success?:(result:Record<string,string>)=>void;fail?:(result:{errMsg:string})=>void};
type HttpOptions={url:string;method:string;header?:Record<string,string>;data?:Record<string,unknown>;timeout?:number};
const h=vi.hoisted(()=>({store:new Map<string,unknown>(),request:vi.fn(),subscribe:vi.fn(),native:[] as NativeOptions[],hide:[] as (()=>void)[],show:[] as (()=>void)[]}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{
  request:h.request,requestSubscribeMessage:h.subscribe,
  getStorageSync:(key:string)=>h.store.get(key),setStorageSync:(key:string,value:unknown)=>h.store.set(key,value),removeStorageSync:(key:string)=>h.store.delete(key),
},useDidShow:(callback:()=>void)=>h.show.push(callback),useDidHide:(callback:()=>void)=>h.hide.push(callback),useUnload:()=>{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(props:any)=>createElement('div',{className:props.className},props.children),Text:(props:any)=>createElement('span',{},props.children),Button:(props:any)=>createElement('button',{disabled:props.disabled,onClick:props.onClick},props.children)}));
// Keep the hook, its source guard, stored-write state and both real transport layers.
import {useGatheringSubscription,GatheringSubscription} from '../apps/miniprogram/src/features/gatherings/subscription';

const actorA='11111111-1111-4111-8111-111111111111',actorB='22222222-2222-4222-8222-222222222222';
const groupA='33333333-3333-4333-8333-333333333333',groupB='44444444-4444-4444-8444-444444444444';
const template='fixture-wechat-template-id',path='/api/v1/gatherings/notifications/subscription',origin='https://fixture.test';
const enabled={enabled:true,template_id:template,scope:'fixture-env',authorization:'one_time_intent'};
const acknowledged={recorded:true,available_intents:1,authorization:'one_time_intent'};
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
function Harness({actor=actorA,session='session-a',group=groupA}:{actor?:string;session?:string;group?:string}){
  const value=useGatheringSubscription(actor,session);
  return createElement(GatheringSubscription,{value,gatheringId:group});
}
beforeEach(()=>{
  vi.stubGlobal('__WEEVIBE_API_TRANSPORT__','https');vi.stubGlobal('__WEEVIBE_API_BASE_URL__',origin);
  h.store.clear();h.store.set('weego_session_v1','session-a');h.native=[];h.hide=[];h.show=[];
  h.subscribe.mockReset().mockImplementation((options:NativeOptions)=>{h.native.push(options);return undefined;});
  h.request.mockReset().mockImplementation(async(options:HttpOptions)=>({statusCode:200,data:options.method==='GET'?enabled:acknowledged}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
async function render(props:Parameters<typeof Harness>[0]={}){await act(async()=>root.render(createElement(Harness,{key:`${props.actor??actorA}:${props.session??'session-a'}`,...props})));}
const requests=(method:string)=>h.request.mock.calls.map(([request])=>request as HttpOptions).filter(request=>request.method===method);
function button(label:string){const found=Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.textContent===label);expect(found,label).toBeTruthy();return found!;}
async function click(label:string){await act(async()=>{button(label).click();await Promise.resolve();});}
async function complete(result:'accept'|'reject'|'ban',index=0){await act(async()=>{h.native[index].success?.({errMsg:'requestSubscribeMessage:ok',[template]:result});await Promise.resolve();});}

describe('real gathering subscription hook and transport through native callback boundaries',()=>{
  it('preloads only the configuration on mounting and never authorizes or records automatically',async()=>{
    await render();expect(requests('GET')).toHaveLength(1);expect(requests('GET')[0]).toMatchObject({url:origin+path,header:{Authorization:'Bearer session-a'},timeout:15000});
    expect(h.subscribe).not.toHaveBeenCalled();expect(requests('POST')).toHaveLength(0);expect(host.textContent).toContain('开启微信提醒');
    expect([...h.store.keys()].filter(key=>key.includes('subscription-pending'))).toEqual([]);
  });
  it('invokes the native API synchronously in the click with the preloaded template before any new network request',async()=>{
    await render();const count=h.request.mock.calls.length;
    await act(async()=>{button('开启微信提醒').click();expect(h.subscribe).toHaveBeenCalledOnce();expect(h.request).toHaveBeenCalledTimes(count);});
    expect(h.native[0].tmplIds).toEqual([template]);expect(Object.keys(h.native[0]).sort()).toEqual(['fail','success','tmplIds']);
    expect(button('开启微信提醒').disabled).toBe(true);expect(requests('POST')).toHaveLength(0);
    await complete('reject');
  });
  it('records accept for the current gathering and authenticated actor with the actual mini key shape',async()=>{
    h.store.set('weego_session_v1','session-b');await render({actor:actorB,session:'session-b',group:groupB});await click('开启微信提醒');await complete('accept');
    expect(requests('POST')).toHaveLength(1);const request=requests('POST')[0];
    expect(request).toMatchObject({url:origin+path,header:{Authorization:'Bearer session-b','Content-Type':'application/json'},timeout:40000,data:{gathering_id:groupB,template_id:template,result:'accept'}});
    expect(request.data!.authorization_key).toMatch(/^mini-[A-Za-z0-9_-]+$/);expect(gatheringSubscriptionIntentSchema.safeParse(request.data).success).toBe(true);
    expect(Object.keys(request.data!).sort()).toEqual(['authorization_key','gathering_id','result','template_id']);
    expect(JSON.stringify(request.data)).not.toMatch(/session-a|session-b|user_id|openid|appId/);expect(host.textContent).toContain('服务端已确认本次操作');
    expect([...h.store.keys()].filter(key=>key.includes('subscription-pending'))).toEqual([]);
  });
  it('records a rejection as rejection and never fabricates an accepted intent',async()=>{
    h.request.mockImplementation(async(options:HttpOptions)=>({statusCode:200,data:options.method==='GET'?enabled:{recorded:false,available_intents:0,authorization:'one_time_intent'}}));
    await render();await click('开启微信提醒');await complete('reject');
    expect(requests('POST')).toHaveLength(1);expect(requests('POST')[0].data).toMatchObject({gathering_id:groupA,result:'reject'});
    expect(requests('POST').some(request=>request.data?.result==='accept')).toBe(false);
  });
  it('does not record any intent when the native API fails',async()=>{
    await render();await click('开启微信提醒');await act(async()=>{h.native[0].fail?.({errMsg:'requestSubscribeMessage:fail cancel'});await Promise.resolve();});
    expect(requests('POST')).toHaveLength(0);expect(host.textContent).toContain('微信提醒授权未完成');expect(button('开启微信提醒').disabled).toBe(false);
    expect([...h.store.keys()].filter(key=>key.includes('subscription-pending'))).toEqual([]);
  });
  it('ignores a late native acceptance after the account changes and never submits it as either account',async()=>{
    await render();await click('开启微信提醒');h.store.set('weego_session_v1','session-b');
    await render({actor:actorB,session:'session-b',group:groupB});await complete('accept',0);
    expect(requests('POST')).toHaveLength(0);expect([...h.store.keys()].filter(key=>key.includes('subscription-pending'))).toEqual([]);
    await click('开启微信提醒');await complete('accept',1);
    expect(requests('POST')).toHaveLength(1);expect(requests('POST')[0]).toMatchObject({header:{Authorization:'Bearer session-b'},data:{gathering_id:groupB,result:'accept'}});
  });
  it('restores an unknown POST outcome and retries the identical authorized request without a second native call',async()=>{
    let writes=0;
    h.request.mockImplementation(async(options:HttpOptions)=>{if(options.method==='GET')return {statusCode:200,data:enabled};if(++writes===1)throw Error('fixture network response lost');return {statusCode:200,data:acknowledged};});
    await render();await click('开启微信提醒');await complete('accept');
    const first=requests('POST')[0],saved=h.store.get(`weevibe-gathering-subscription-pending-v1:${actorA}`);
    expect(saved).toEqual({userId:actorA,input:first.data});expect(host.textContent).toContain('核对上次微信提醒授权');expect(h.subscribe).toHaveBeenCalledOnce();
    await act(async()=>root.unmount());root=createRoot(host);await render();
    expect(requests('POST')).toHaveLength(1);expect(h.subscribe).toHaveBeenCalledOnce();
    await click('核对上次微信提醒授权');
    expect(requests('POST')).toHaveLength(2);expect(requests('POST')[1]).toEqual(first);expect(h.subscribe).toHaveBeenCalledOnce();
    expect(h.store.has(`weevibe-gathering-subscription-pending-v1:${actorA}`)).toBe(false);expect(host.textContent).toContain('服务端已确认本次操作');
  });
  it('keeps a disabled configuration from authorizing or recording and only lets the user refresh configuration',async()=>{
    h.request.mockResolvedValue({statusCode:200,data:{enabled:false,template_id:null,scope:null,authorization:'one_time_intent'}});
    await render();expect(host.textContent).not.toContain('开启微信提醒');await click('读取微信提醒设置');
    expect(requests('GET')).toHaveLength(2);expect(h.subscribe).not.toHaveBeenCalled();expect(requests('POST')).toHaveLength(0);
  });
});

it('releases an unanswered native authorization after timeout and ignores a late acceptance',async()=>{vi.useFakeTimers();try{await render();await click('开启微信提醒');expect(button('开启微信提醒').disabled).toBe(true);await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});expect(button('开启微信提醒').disabled).toBe(false);expect(host.textContent).toContain('授权未完成');expect(requests('POST')).toHaveLength(0);await complete('accept');expect(requests('POST')).toHaveLength(0);}finally{vi.useRealTimers();}});
