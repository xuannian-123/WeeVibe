import {describe,expect,it} from 'vitest';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringDateSchema,gatheringDetailsSchema,gatheringIntakeSchema,gatheringCreateSchema,gatheringGenerateSchema,gatheringFinalizeSchema,gatheringMemberSaveSchema,gatheringOwnBlocks,gatheringPublicBlocks,gatheringVisibleDetails,privateGatheringQuestion} from '../packages/contracts/src';
import {newKey} from '../apps/miniprogram/src/platform/local-id';
import {gatheringModelSource,gatheringSourceFingerprint,gatheringTeamStatistics} from '../apps/web/src/server/gatherings/privacy';

const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222';
const details=()=>({...emptyGatheringDetails(),date:'2030-02-01',title:'周末出游'});
function intake(){const value=emptyGatheringIntake();value.public.date='2030-02-01';value.public.keywords.eat=['火锅／串串'];value.public.confirmed_keys=['eat_2'];value.private={budget_min:111,budget_max:987,budget_note:'PRIVATE_BUDGET_SENTINEL',origin:{label:'PRIVATE_HOME_SENTINEL',latitude:30.111,longitude:120.999,crs:'GCJ-02'},confirmed_keys:['budget','origin']};return value;}
const row=(userId=owner,version=1)=>({userId,publicIntake:intake().public,privateIntake:intake().private,answers:[],responseVersion:version});
describe('gathering private fields and confirmed blocks',()=>{
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
});
describe('model input and team projection',()=>{
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
  it('redacts every unconfirmed organizer detail for team participants',()=>{
    const d={...details(),place:'UNCONFIRMED_PLACE',address:'UNCONFIRMED_ADDRESS',description:'UNCONFIRMED_NOTE',capacity:9,fee:{kind:'per_person' as const,amount:200,note:'UNCONFIRMED_FEE'},confirmed_details:['date'] as const};
    const view=gatheringVisibleDetails({...d,confirmed_details:[...d.confirmed_details]},'team',false);
    expect(view.date).toBe(d.date);expect(view.capacity).toBeNull();expect(JSON.stringify(view)).not.toMatch(/UNCONFIRMED/);
    expect(gatheringVisibleDetails({...d,confirmed_details:[]},'friend',false).place).toBe(d.place);
  });
  it.each(['个人预算是多少？','你从哪里来？','你居住在哪个区域？','出发点在哪里？'])('marks %s as own-only questionnaire data',title=>{expect(privateGatheringQuestion({id:'q',title,type:'text',required:false,options:[]})).toBe(true);});
  it('keeps a partial overnight disclosure valid without revealing its unconfirmed end date',()=>{
    const d={...details(),start_time:'20:00',end_time:'09:00',end_date:'2030-02-02',confirmed_details:['date','start_time','end_time'] as const};
    const visible=gatheringVisibleDetails({...d,confirmed_details:[...d.confirmed_details]},'team',false);
    expect(visible.end_date).toBe('');expect(visible.end_time).toBe('');expect(gatheringDetailsSchema.safeParse(visible).success).toBe(true);
  });
  it('returns counts without private amounts, origin options or any answer prose even to the organizer',()=>{
    const d=details();d.questions=[{id:'food',title:'吃什么',type:'single',required:false,options:[{id:'hotpot',label:'火锅'}]},{id:'budget',title:'预算范围',type:'single',required:false,options:[{id:'high',label:'987元'}]},{id:'note',title:'想法',type:'text',required:false,options:[]}];
    const value=row();value.answers=[{question_id:'food',option_ids:['hotpot'],other:'',text:''},{question_id:'budget',option_ids:['high'],other:'PRIVATE_BUDGET_SENTINEL',text:''},{question_id:'note',option_ids:[],other:'',text:'PRIVATE_HOME_SENTINEL'}] as never;
    const stats=gatheringTeamStatistics(d,[value]);
    expect(stats.questions.find(q=>q.id==='food')?.options[0].count).toBe(1);
    expect(stats.questions.find(q=>q.id==='budget')).toMatchObject({private:true,response_count:0,options:[],other_count:0});
    expect(stats.questions.find(q=>q.id==='note')?.response_count).toBe(1);
    expect(JSON.stringify(stats)).not.toMatch(/PRIVATE_|987/);
  });
});
