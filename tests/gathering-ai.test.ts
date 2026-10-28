import {describe,expect,it,vi} from 'vitest';
import {emptyGatheringDetails,emptyGatheringIntake,type GatheringItinerary} from '../packages/contracts/src';
import {createGatheringAI,reviewGatheringItinerary} from '../apps/web/src/server/gatherings/ai';
import {gatheringModelSource} from '../apps/web/src/server/gatherings/privacy';

const actor='11111111-1111-4111-8111-111111111111';
function source(){const intake=emptyGatheringIntake();intake.public.date='2030-02-01';intake.public.note='文星广场吃饭，之后打台球和唱歌';return gatheringModelSource({...emptyGatheringDetails(),date:'2030-02-01',place:'文星广场',address:'公开集合地址'},[{userId:actor,publicIntake:intake.public,answers:[],responseVersion:1}]);}
function proposal():GatheringItinerary{return {plans:[{id:'plan1',title:'方案1',summary:'吃饭后轻松玩一会',segments:[{id:'s1',title:'在文星广场吃饭',description:'一起吃饭聊天',date:'2030-02-01',start_time:'12:00',end_time:'13:00',place:'文星广场',address:'公开集合地址',fee_note:'费用待核实',unknowns:[]},{id:'s2',title:'打台球',description:'饭后一起玩',date:'2030-02-01',start_time:'14:00',end_time:'15:00',place:'',address:'',fee_note:'费用待核实',unknowns:['场地待选择']}],notes:[]},{id:'plan2',title:'方案2',summary:'先玩再吃饭',segments:[{id:'s1',title:'一起唱歌',description:'先一起唱歌',date:'2030-02-01',start_time:'11:00',end_time:'12:00',place:'',address:'',fee_note:'费用待核实',unknowns:['场地待选择']}],notes:[]}],notes:['时间与场地仍需核对']};}
const config=()=>({url:'https://api.deepseek.com/chat/completions',key:'PRIVATE_TEST_KEY_ONLY',model:'fixture-model'});
const response=(body:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)}}]}),{headers:{'content-type':'application/json'}});
describe('AI itinerary review for multiple complete routes',()=>{
  it('keeps multiple complete alternatives and the sequence within each plan',()=>{const result=reviewGatheringItinerary(proposal(),source());expect(result.plans.map(p=>p.segments.map(s=>s.title))).toEqual([['在文星广场吃饭','打台球'],['一起唱歌']]);});
  it('drops invented venue/address/fees without granting booking or verified-map status',()=>{const p=proposal();p.plans[0].segments[0].place='模型编造的新商家';p.plans[0].segments[0].address='模型编造的地址';p.plans[0].segments[0].fee_note='每人88元';const result=reviewGatheringItinerary(p,source()).plans[0].segments[0];expect(result).toMatchObject({place:'',address:'',fee_note:'费用待核实'});expect(result.unknowns).toContain('具体场地待选择并核实');});
  it.each(['single-plan','overlap','reverse-with-unknown-end','wrong-date','wrong-first-day','late-end','wrong-start','extra-private','duplicate-plan','duplicate-segment','false-booking','private-prose','missing-private-prose'])('rejects %s output rather than saving a usable plan',mode=>{
    const p=proposal(),s=source();
    if(mode==='single-plan')p.plans=p.plans.slice(0,1);
    if(mode==='overlap')p.plans[0].segments[1].start_time='12:30';
    if(mode==='reverse-with-unknown-end'){p.plans[0].segments[0].end_time='';p.plans[0].segments[1].start_time='11:30';}
    if(mode==='wrong-date')p.plans[0].segments[0].date='2030-02-03';
    if(mode==='wrong-first-day'){s.end_date='2030-02-03';p.plans[0].segments[0].date='2030-02-02';p.plans[0].segments[1].date='2030-02-02';}
    if(mode==='late-end')s.end_time='14:30';
    if(mode==='wrong-start')s.start_time='09:00';
    if(mode==='extra-private')(p as unknown as Record<string,unknown>).private_origin='PRIVATE_ORIGIN';
    if(mode==='duplicate-plan')p.plans[1].id='plan1';
    if(mode==='duplicate-segment')p.plans[0].segments[1].id='s1';
    if(mode==='false-booking')p.notes=['全员已同意，已预订场地'];
    if(mode==='private-prose')p.notes=['我的预算200元'];
    if(mode==='missing-private-prose')p.notes=['预算未提供，个人出发地点待填写'];
    expect(()=>reviewGatheringItinerary(p,s)).toThrow('未通过检查');
  });
});
describe('authenticated provider boundary with no private model fields',()=>{
  it('sends a JSON-only bounded non-thinking request and returns source-derived blocks',async()=>{
    const fetcher=vi.fn(async(_url:unknown,_options?:RequestInit)=>response({summary:'吃饭、玩台球，再一起唱歌。'}));
    const input=emptyGatheringIntake();input.public=source().people[0].blocks.length?{...input.public,date:'2030-02-01',note:'文星广场吃饭，之后打台球和唱歌'}:input.public;
    const value=await createGatheringAI({fetch:fetcher as typeof fetch,config}).organize(actor,input.public);
    expect(value.source).toBe('ai');expect(value.blocks.some(b=>b.id==='note')).toBe(true);
    const options=fetcher.mock.calls[0][1]!;const body=JSON.parse(String(options.body));
    expect(body).toMatchObject({stream:false,max_tokens:4000,response_format:{type:'json_object'},thinking:{type:'disabled'}});expect(options.redirect).toBe('error');
    expect(String(options.body)).not.toContain(actor);expect(String(options.body)).not.toMatch(/private_origin|budget_min|budget_max/);
  });
  it('validates a real-provider-shaped response for two complete plans',async()=>{const fetcher=vi.fn(async()=>response(proposal()));const result=await createGatheringAI({fetch:fetcher as typeof fetch,config}).generate(actor,source());expect(result.plans).toHaveLength(2);});
  it('gives the supplier the same fixed start and hard end constraints enforced by review',async()=>{
    const s={...source(),start_time:'17:30',end_time:'22:00'},p=proposal();
    p.plans[0].segments[0].start_time='17:30';p.plans[0].segments[0].end_time='18:30';
    p.plans[0].segments[1].start_time='19:00';p.plans[0].segments[1].end_time='20:00';
    p.plans[1].segments[0].start_time='17:30';p.plans[1].segments[0].end_time='18:30';
    const fetcher=vi.fn(async(_url:unknown,_options?:RequestInit)=>response(p));
    const result=await createGatheringAI({fetch:fetcher as typeof fetch,config}).generate(actor,s);
    const body=JSON.parse(String(fetcher.mock.calls[0][1]!.body)),system=body.messages[0].content;
    expect(JSON.parse(body.messages[1].content)).toMatchObject({start_time:'17:30',end_time:'22:00'});
    expect(system).toContain('所有环节的开始和结束都不得晚于此界限');
    expect(system).toContain('不要在summary、description、notes、unknowns中提示它们未提供、未知或待填写');
    const example=JSON.parse(system.slice(system.indexOf('{"plans":'),system.lastIndexOf('}')+1));
    expect(example.plans).toHaveLength(2);
    expect(result.plans.every(plan=>plan.segments[0].start_time==='17:30')).toBe(true);
  });
  it('stops an incompatible confirmed date before any supplier request',async()=>{const s=source();s.people[0].blocks[0]={id:'date',label:'日期',value:'2030-02-02',confirmed:true};const fetcher=vi.fn();await expect(createGatheringAI({fetch:fetcher,config}).generate(actor,s)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(fetcher).not.toHaveBeenCalled();});
  it.each(['missing-config','unsafe-url','supplier-error','malformed-json','truncated','oversized','key-echo'])('does not expose %s data as success or a raw error',async mode=>{
    const fetcher=vi.fn(async()=>{
      if(mode==='supplier-error')return new Response('PRIVATE_VENDOR_BODY',{status:500});
      if(mode==='malformed-json')return new Response('PRIVATE_VENDOR_BODY');
      if(mode==='truncated')return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'PRIVATE_VENDOR_BODY'}}]}));
      if(mode==='oversized')return new Response('PRIVATE_VENDOR_BODY'.repeat(5000));
      return response({summary:'PRIVATE_TEST_KEY_ONLY'});
    });
    const cfg=mode==='missing-config'?()=>({}):mode==='unsafe-url'?()=>({...config(),url:'http://127.0.0.1/chat'}):config;
    let caught:unknown;try{await createGatheringAI({fetch:fetcher as typeof fetch,config:cfg}).organize(actor,emptyGatheringIntake().public);}catch(e){caught=e;}
    expect(caught).toBeInstanceOf(Error);expect(String(caught)).not.toMatch(/PRIVATE_VENDOR_BODY|PRIVATE_TEST_KEY_ONLY/);
    if(mode==='missing-config'||mode==='unsafe-url')expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts a timed out supplier call while retaining a safe public error',async()=>{
    const fetcher=vi.fn((_url:unknown,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(Error('PRIVATE_TIMEOUT')))));
    await expect(createGatheringAI({fetch:fetcher as typeof fetch,config,timeoutMs:2}).organize(actor,emptyGatheringIntake().public)).rejects.toMatchObject({code:'UPSTREAM_UNAVAILABLE'});
  });
});
