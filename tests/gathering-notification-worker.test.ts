import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {readConfig,sign,verify}=require('../cloudfunctions/weevibeNotifyGathering/protocol.cjs');
const {createWorker,TRIGGER}=require('../cloudfunctions/weevibeNotifyGathering/worker.cjs');
const {createNotificationHandler}=require('../cloudfunctions/weevibeNotifyGathering/index.js');
// Explicit offline fixtures: none is a usable WeChat identity, grant or deployment secret.
const now=Date.parse('2030-11-01T00:00:00Z'),id='11111111-1111-4111-8111-111111111111';
const env={GATHERING_NOTIFY_ENABLED:'true',GATHERING_NOTIFY_ENV:'cloud-notify-fixture',GATHERING_NOTIFY_APPID:'wx0000000000000000',GATHERING_NOTIFY_WORKER_SECRET:'S'.repeat(43),GATHERING_NOTIFY_API_ORIGIN:'https://notify.example.test',GATHERING_NOTIFY_TEMPLATE_ID:'fixture-template-only',GATHERING_NOTIFY_TEMPLATE_FIELDS:JSON.stringify({thing1:'event',thing2:'service',time3:'time'}),GATHERING_NOTIFY_MINIPROGRAM_STATE:'developer'};
const config=readConfig(env),timer={Type:'Timer',TriggerName:TRIGGER};
function job(){return {outbox_id:id,lease_token:'T'.repeat(43),lease_expires_at:new Date(now+45000).toISOString(),touser:'synthetic_openid',template_id:env.GATHERING_NOTIFY_TEMPLATE_ID,event_kind:'updated',gathering_id:id,created_at:new Date(now).toISOString()};}
function harness(options:{send?:ReturnType<typeof vi.fn>;jobs?:unknown[];context?:Record<string,string>;env?:Record<string,string>;ackFailure?:boolean}={}){
  const send=options.send||vi.fn().mockResolvedValue({errCode:0}),receipts:unknown[]=[];
  let failed=false;
  const fetchImpl=vi.fn(async(url:string,request:{body:string;headers:Record<string,string>})=>{
    const path=new URL(url).pathname,proof=verify(path,request.body,request.headers['x-weevibe-notify-signature'],config,now);
    if(path.endsWith('/claim'))return new Response(JSON.stringify({jobs:options.jobs??[job()]}));
    receipts.push(proof.payload);if(options.ackFailure&&!failed){failed=true;throw Error('fixture receipt timeout');}
    return new Response(JSON.stringify({recorded:true,status:'sent'}));
  });
  return {run:createWorker({env:options.env||env,context:()=>options.context||{ENV:env.GATHERING_NOTIFY_ENV},send,fetchImpl,now:()=>now,sendTimeoutMs:20}),send,fetchImpl,receipts};
}
describe('notification worker authentication and bounded delivery',()=>{
  it('binds signatures to action, environment, app, purpose, body and freshness',()=>{
    const signed=sign('claim',{limit:2},config,now);expect(verify(signed.path,signed.body,signed.signature,config,now).payload).toEqual({limit:2});
    expect(()=>verify(signed.path.replace('claim','ack'),signed.body,signed.signature,config,now)).toThrow();
    expect(()=>verify(signed.path,signed.body.replace('limit":2','limit":3'),signed.signature,config,now)).toThrow();
    expect(()=>verify(signed.path,signed.body,signed.signature,config,now+61000)).toThrow();
    expect(()=>verify(signed.path,signed.body,signed.signature,{...config,scope:'other-env'},now)).toThrow();
    expect(()=>verify(signed.path,signed.body,signed.signature,{...config,appId:'wx1111111111111111'},now)).toThrow();
  });
  it('rejects direct mini-program callers even when they imitate the timer event',async()=>{
    const test=harness({context:{ENV:env.GATHERING_NOTIFY_ENV,OPENID:'client_user'}});expect(await test.run(timer)).toEqual({ok:false,code:'FORBIDDEN'});expect(test.fetchImpl).not.toHaveBeenCalled();expect(test.send).not.toHaveBeenCalled();
  });
  it('parses each entrypoint invocation so a rejected client cannot poison a later timer on the same warm instance',async()=>{
    const fetchImpl=vi.fn().mockResolvedValue(new Response(JSON.stringify({jobs:[]}))),send=vi.fn();
    const handler=createNotificationHandler({env,fetchImpl,send});
    vi.stubEnv('WX_CONTEXT_KEYS','WX_APPID,WX_OPENID');vi.stubEnv('WX_APPID',env.GATHERING_NOTIFY_APPID);vi.stubEnv('WX_OPENID','STALE_PREVIOUS_CLIENT');vi.stubEnv('TCB_SOURCE','wx_client');vi.stubEnv('TCB_ENV',env.GATHERING_NOTIFY_ENV);
    try{
      const client={namespace:env.GATHERING_NOTIFY_ENV,environment:JSON.stringify({WX_APPID:env.GATHERING_NOTIFY_APPID,WX_OPENID:'current_client',TCB_SOURCE:'wx_client'})};
      expect(await handler(timer,client)).toEqual({ok:false,code:'FORBIDDEN'});expect(fetchImpl).not.toHaveBeenCalled();
      const currentTimer={namespace:env.GATHERING_NOTIFY_ENV,environment:JSON.stringify({TCB_ENV:env.GATHERING_NOTIFY_ENV,TCB_SOURCE:'timer'})};
      expect(await handler(timer,currentTimer)).toMatchObject({ok:true,claimed:0,sent:0});expect(fetchImpl).toHaveBeenCalledOnce();
      expect(await handler(timer,{...currentTimer,namespace:'wrong-env'})).toEqual({ok:false,code:'FORBIDDEN'});
      expect(await handler(timer,{namespace:env.GATHERING_NOTIFY_ENV,environment:JSON.stringify({TCB_SOURCE:'wx_client'})})).toEqual({ok:false,code:'FORBIDDEN'});expect(send).not.toHaveBeenCalled();
    }finally{vi.unstubAllEnvs();}
  });
  it('fails closed for an unconfigured template or a different cloud environment',async()=>{
    const missing=harness({env:{...env,GATHERING_NOTIFY_TEMPLATE_FIELDS:''}});expect(await missing.run(timer)).toEqual({ok:false,code:'NOT_CONFIGURED'});expect(missing.send).not.toHaveBeenCalled();
    const wrong=harness({context:{ENV:'other-env'}});expect(await wrong.run(timer)).toEqual({ok:false,code:'FORBIDDEN'});expect(wrong.fetchImpl).not.toHaveBeenCalled();
    const wrongApp=harness({context:{ENV:env.GATHERING_NOTIFY_ENV,APPID:'wx1111111111111111'}});expect(await wrongApp.run(timer)).toEqual({ok:false,code:'FORBIDDEN'});expect(wrongApp.fetchImpl).not.toHaveBeenCalled();
  });
  it('uses only claimed identities, configured fields and fixed private-free text',async()=>{
    const test=harness();expect(await test.run({...timer,touser:'ATTACKER',templateId:'OTHER',data:{thing1:{value:'PRIVATE_BUDGET'}}})).toMatchObject({sent:1,unknown:0});
    expect(test.send).toHaveBeenCalledExactlyOnceWith({touser:'synthetic_openid',templateId:env.GATHERING_NOTIFY_TEMPLATE_ID,page:`pages/gathering/index?id=${id}&entry=share`,data:{thing1:{value:'有成员更新了填写'},thing2:{value:'WeeVibe活动筹备'},time3:{value:'2030-11-01 08:00'}},miniprogramState:'developer',lang:'zh_CN'});
    expect(JSON.stringify(test.send.mock.calls)).not.toMatch(/ATTACKER|PRIVATE_BUDGET|budget|answers/);expect(test.receipts).toMatchObject([{outcome:'sent',err_code:0}]);
  });
  it('fills the selected activity-progress template with its three real thing fields and a bounded fixed hint',async()=>{
    const template='aVkr_cF1h4dR0RTXflHXxVFRItt5xzlYoxzXguniW4Q';
    const test=harness({env:{...env,GATHERING_NOTIFY_TEMPLATE_ID:template,GATHERING_NOTIFY_TEMPLATE_FIELDS:JSON.stringify({thing1:'service',thing2:'event',thing3:'hint'})},jobs:[{...job(),template_id:template}]});
    expect(await test.run(timer)).toMatchObject({sent:1});
    const input=test.send.mock.calls[0][0];expect(input.templateId).toBe(template);expect(input.data).toEqual({thing1:{value:'WeeVibe活动筹备'},thing2:{value:'有成员更新了填写'},thing3:{value:'点击查看最新填写'}});
    for(const field of Object.values(input.data) as {value:string}[])expect(Array.from(field.value).length).toBeLessThanOrEqual(20);
  });
  it('retries only the receipt after a lost acknowledgment and never sends twice',async()=>{
    const test=harness({ackFailure:true});expect(await test.run(timer)).toMatchObject({sent:1,ack_failed:0});expect(test.send).toHaveBeenCalledOnce();expect(test.receipts).toHaveLength(2);expect(test.receipts[0]).toEqual(test.receipts[1]);
  });
  it('records an ambiguous send failure as unknown without a send retry or raw error payload',async()=>{
    const test=harness({send:vi.fn().mockRejectedValue(Error('PRIVATE_PROVIDER_BODY'))});const result=await test.run(timer);expect(result).toMatchObject({sent:0,unknown:1});expect(test.send).toHaveBeenCalledOnce();expect(test.receipts).toMatchObject([{outcome:'unknown',err_code:null}]);expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_BODY');
  });
  it('marks a send timeout unknown while a later supplier result cannot trigger another send',async()=>{
    let finish!:(value:unknown)=>void;const pending=new Promise(done=>{finish=done;});const test=harness({send:vi.fn().mockReturnValue(pending)});expect(await test.run(timer)).toMatchObject({unknown:1});finish({errCode:0});await Promise.resolve();expect(test.send).toHaveBeenCalledOnce();expect(test.receipts).toMatchObject([{outcome:'unknown'}]);
  });
  it.each([43101,45009])('reports explicit rejection %s for the queue to classify without retrying WeChat',async code=>{
    const test=harness({send:vi.fn().mockRejectedValue({errCode:code,errMsg:'withheld'})});expect(await test.run(timer)).toMatchObject({failed:1});expect(test.send).toHaveBeenCalledOnce();expect(test.receipts).toMatchObject([{outcome:'failed',err_code:code}]);
  });
  it('rejects an oversized batch before any send and skips a lease too near expiry',async()=>{
    const huge=harness({jobs:Array.from({length:6},job)});expect(await huge.run(timer)).toEqual({ok:false,code:'INVALID_QUEUE_RESPONSE'});expect(huge.send).not.toHaveBeenCalled();
    const expired=harness({jobs:[{...job(),lease_expires_at:new Date(now+1000).toISOString()}]});expect(await expired.run(timer)).toMatchObject({unknown:1});expect(expired.send).not.toHaveBeenCalled();
  });
});
