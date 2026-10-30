import {describe,expect,it} from 'vitest';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringDateSchema,gatheringDetailsSchema,gatheringIntakeSchema,gatheringCreateSchema,gatheringGenerateSchema,gatheringFinalizeSchema,gatheringMemberSaveSchema,gatheringSubscriptionConfigSchema,gatheringSubscriptionIntentSchema,gatheringSubscriptionIntentResultSchema,inboxMessageSchema,gatheringOwnBlocks,gatheringPublicBlocks,privateGatheringQuestion} from '../packages/contracts/src';
import {newKey} from '../apps/miniprogram/src/platform/local-id';
import {gatheringModelSource,gatheringSourceFingerprint} from '../apps/web/src/server/gatherings/privacy';

const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222';
const details=()=>({...emptyGatheringDetails(),date:'2030-02-01',title:'周末出游'});
function intake(){const value=emptyGatheringIntake();value.public.date='2030-02-01';value.public.keywords.eat=['火锅／串串'];value.public.confirmed_keys=['eat_2'];value.private={budget_min:111,budget_max:987,budget_note:'PRIVATE_BUDGET_SENTINEL',origin:{label:'PRIVATE_HOME_SENTINEL',latitude:30.111,longitude:120.999,crs:'GCJ-02'},confirmed_keys:['budget','origin']};return value;}
const row=(userId=owner,version=1)=>({userId,publicIntake:intake().public,privateIntake:intake().private,answers:[],responseVersion:version});
describe('gathering private fields and confirmed blocks',()=>{
  it('preserves legacy friend details and native map records, but rejects stale labels',()=>{
    const base=details();expect(gatheringDetailsSchema.parse(base)).toEqual(base);
    const venue={name:'UNCONFIRMED_MAP',address:'UNCONFIRMED_ADDRESS',location:{latitude:31.2,longitude:120.3,crs:'GCJ-02' as const},source:{provider:'wechat' as const,source_api:'wx.chooseLocation' as const}};
    const value={...base,place:venue.name,address:venue.address,place_venue:venue,candidate_places:[]};
    expect(gatheringDetailsSchema.parse(value).place_venue).toEqual(venue);
    expect(gatheringDetailsSchema.safeParse({...value,place:'另一个地点'}).success).toBe(false);
    expect(gatheringDetailsSchema.safeParse({...base,candidate_places:[{id:'p1',label:'另一个地点',venue}]}).success).toBe(false);
    expect(JSON.stringify(gatheringModelSource(value,[]))).not.toMatch(/latitude|longitude|wx.chooseLocation/);
  });
  it('preserves private blocks for the owner while shared blocks contain only selected public input',()=>{
    const value=intake(),own=gatheringOwnBlocks(value),shared=gatheringPublicBlocks(value.public);
    expect(own.filter(b=>b.id==='budget'||b.id==='origin')).toHaveLength(2);
    expect(own.find(b=>b.id==='origin')?.value).toBe('PRIVATE_HOME_SENTINEL');
    expect(shared.find(b=>b.id==='eat_2')).toMatchObject({value:'火锅／串串',confirmed:true});
    expect(JSON.stringify(shared)).not.toMatch(/PRIVATE_|987|latitude|longitude/);
  });
  it('represents an entirely undecided answer with no confirmed block',()=>{const value=intake();value.public.confirmed_keys=[];value.private.confirmed_keys=[];expect(gatheringOwnBlocks(value).every(b=>!b.confirmed)).toBe(true);});
  it.each(['预算200','最多200元','从杭州东站出发','我住在西湖区'])('rejects private prose %s submitted through public notes',note=>{const value=intake();value.public.note=note;expect(()=>gatheringPublicBlocks(value.public)).toThrow('仅本人可见');});
  it('rejects unknown selections, duplicate choices and stale confirmed keys',()=>{
    const value=intake();value.public.keywords.eat=['不存在的选项'];expect(()=>gatheringPublicBlocks(value.public)).toThrow();
    value.public.keywords.eat=['火锅／串串','火锅／串串'];expect(()=>gatheringPublicBlocks(value.public)).toThrow();
    value.public.keywords.eat=['火锅／串串'];value.public.confirmed_keys=['drink_1'];expect(()=>gatheringPublicBlocks(value.public)).toThrow();
  });
  it.each([{label:''},{label:'地点',latitude:30},{label:'地点',longitude:120},{label:'地点',latitude:30,longitude:120}])('rejects incomplete private origin %#',origin=>{const value=intake();value.private.origin=origin as typeof value.private.origin;expect(gatheringIntakeSchema.safeParse(value).success).toBe(false);});
  it('rejects duplicate private confirmation, inverted budgets and an impossible calendar date',()=>{
    const value=intake();value.private.confirmed_keys=['budget','budget'];expect(gatheringIntakeSchema.safeParse(value).success).toBe(false);
    value.private.confirmed_keys=[];value.private.budget_min=999;expect(gatheringIntakeSchema.safeParse(value).success).toBe(false);
    expect(gatheringDateSchema.safeParse('0000-01-01').success).toBe(false);expect(gatheringDateSchema.safeParse('2030-02-29').success).toBe(false);
  });
  it('requires the displayed questionnaire revision as well as the own answer version',()=>{const input={expected_version:0,idempotency_key:owner,intake:intake()};expect(gatheringMemberSaveSchema.safeParse(input).success).toBe(false);expect(gatheringMemberSaveSchema.safeParse({...input,expected_revision:1}).success).toBe(true);});
  it('keeps old retry payloads byte-equivalent without implicit join consent and accepts only a boolean opt-in',()=>{
    const old={expected_version:0,expected_revision:1,idempotency_key:owner,intake:intake()};
    expect(gatheringMemberSaveSchema.parse(old)).toEqual(old);expect(gatheringMemberSaveSchema.parse(old)).not.toHaveProperty('join_if_needed');
    expect(gatheringMemberSaveSchema.parse({...old,join_if_needed:true}).join_if_needed).toBe(true);
    expect(gatheringMemberSaveSchema.safeParse({...old,join_if_needed:'true'}).success).toBe(false);
  });
  it('uses a bounded plan identity and current source for natural final-choice idempotency',()=>{
    const input={expected_source:'a'.repeat(64),generation_id:owner,plan_id:'plan1'};
    expect(gatheringFinalizeSchema.parse(input)).toEqual(input);
    expect(gatheringFinalizeSchema.safeParse({...input,plan_id:'../private'}).success).toBe(false);
    expect(gatheringFinalizeSchema.safeParse({...input,ownerUserId:member}).success).toBe(false);
  });
  it('accepts the actual mini-program operation key in create, save and generation contracts',()=>{
    const idempotency_key=newKey();expect(idempotency_key).toMatch(/^mini-/);
    expect(gatheringCreateSchema.safeParse({kind:'friend',idempotency_key,details:details(),intake:intake()}).success).toBe(true);
    expect(gatheringMemberSaveSchema.safeParse({expected_version:0,expected_revision:1,idempotency_key,intake:intake()}).success).toBe(true);
    expect(gatheringGenerateSchema.safeParse({idempotency_key,expected_source:'a'.repeat(64)}).success).toBe(true);
  });
  it('models one-time subscription intent for one gathering with actual mini keys instead of permanent authorization',()=>{
    expect(gatheringSubscriptionConfigSchema.safeParse({enabled:true,template_id:null,scope:null,authorization:'one_time_intent'}).success).toBe(false);
    expect(gatheringSubscriptionConfigSchema.safeParse({enabled:false,template_id:null,scope:null,authorization:'one_time_intent'}).success).toBe(true);
    const value={gathering_id:owner,authorization_key:newKey(),template_id:'fixture-template-id',result:'accept'};
    expect(gatheringSubscriptionIntentSchema.safeParse(value).success).toBe(true);
    expect(gatheringSubscriptionIntentSchema.safeParse({...value,appId:'untrusted-app-id'}).success).toBe(false);
    expect(gatheringSubscriptionIntentResultSchema.safeParse({recorded:true,available_intents:1,authorization:'permanent'}).success).toBe(false);
  });
  it('keeps gathering inbox destinations separate from formal activity and requirement destinations',()=>{
    const message={id:'gathering-notice:'+owner,activity_id:null,gathering_id:member,title:'朋友出游有新填写',summary:'有成员更新了填写',created_at:'2030-01-01T00:00:00Z',read:false,pending:false,status:'填写已更新',section:'gathering'};
    expect(inboxMessageSchema.safeParse(message).success).toBe(true);
    expect(inboxMessageSchema.safeParse({...message,activity_id:owner}).success).toBe(false);
    expect(inboxMessageSchema.safeParse({...message,section:'activity'}).success).toBe(false);
  });
});
describe('model input and historical question privacy',()=>{
  it('keeps real IDs, private objects and questionnaire free prose out of the AI source',()=>{
    const value=row();value.answers=[{question_id:'q1',option_ids:[],other:'',text:'PRIVATE_ANSWER'}] as never;
    const serialized=JSON.stringify(gatheringModelSource(details(),[value]));
    expect(serialized).toContain('火锅／串串');expect(serialized).toContain('p1');expect(serialized).not.toMatch(/PRIVATE_|987|latitude|longitude|11111111/);
  });
  it('invalidates the source when a new unsubmitted member joins during generation',()=>{const d=details();expect(gatheringSourceFingerprint(d,[row()])).not.toBe(gatheringSourceFingerprint(d,[row(),row(member,0)]));});
  it('invalidates changed published fields or answer versions and is independent from query order',()=>{
    const d=details(),rows=[row(),row(member)];const hash=gatheringSourceFingerprint(d,rows);
    expect(gatheringSourceFingerprint(d,[...rows].reverse())).toBe(hash);
    expect(gatheringSourceFingerprint({...d,capacity:10},rows)).not.toBe(hash);
    expect(gatheringSourceFingerprint(d,[row(owner,2),row(member)])).not.toBe(hash);
  });
  it.each(['个人预算是多少？','你从哪里来？','你居住在哪个区域？','出发点在哪里？'])('marks %s as own-only questionnaire data',title=>{expect(privateGatheringQuestion({id:'q',title,type:'text',required:false,options:[]})).toBe(true);});
});
