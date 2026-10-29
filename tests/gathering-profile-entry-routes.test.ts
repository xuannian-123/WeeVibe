import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({auth:vi.fn(),profile:vi.fn(),create:vi.fn(),apply:vi.fn(),requirementCreate:vi.fn(),requirementCommand:vi.fn(),generate:vi.fn(),read:vi.fn()}));
vi.mock('../apps/web/src/server/auth',()=>({identityService:{authenticate:h.auth}}));
vi.mock('../apps/web/src/server/gatherings/profile',()=>({assertGatheringProfileActor:h.profile}));
vi.mock('../apps/web/src/server/activities/service',()=>({createActivity:h.create,applyToActivity:h.apply}));
vi.mock('../apps/web/src/server/requirements/service',()=>({createRequirement:h.requirementCreate,commandRequirement:h.requirementCommand,listRequirements:h.read,getRequirementForActivity:h.read,getRequirement:h.read}));
vi.mock('../apps/web/src/server/ai/creation',()=>({aiCreationProvider:{generate:h.generate}}));
import {ServiceError} from '../apps/web/src/server/http';
import {POST as create} from '../apps/web/src/app/api/v1/activities/route';
import {POST as apply} from '../apps/web/src/app/api/v1/activities/[activityId]/applications/route';
import {POST as requirementCreate} from '../apps/web/src/app/api/v1/requirements/route';
import {GET as requirementRead,POST as requirementCommand} from '../apps/web/src/app/api/v1/requirements/[collectionId]/route';
import {POST as draft} from '../apps/web/src/app/api/v1/ai/creation-draft/route';
const actor='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const request=(body:unknown)=>new Request('https://fixture.test/api/v1/profile-entry',{method:'POST',headers:{authorization:'Bearer fixture-session','content-type':'application/json'},body:JSON.stringify(body)});
const draftInput={title:'测试',description:'',starts_at:'',deadline_at:'',timezone:'Asia/Shanghai',locations:[],questions:[]};
const activityInput={idempotency_key:'profile-entry-key',name:'朋友活动',timezone:'Asia/Shanghai',main_segment_ref:'s1',participating_segment_refs:[],segments:[{client_ref:'s1',type:'sport',name:'打球',starts_at:'2030-01-02T12:00:00+08:00',ends_at:'2030-01-02T14:00:00+08:00',deadline_at:'2030-01-01T12:00:00+08:00',minimum_participants:1,capacity:4,location:{name:'公开场地',address:null,source_url:null},fee:{kind:'unknown',amount_cents:null,currency:'CNY',note:''},requirements:''}]};
const context={params:Promise.resolve({collectionId:id})};
beforeEach(()=>{for(const fn of Object.values(h))fn.mockReset();h.auth.mockResolvedValue({user_id:actor});[h.create,h.apply,h.requirementCreate,h.requirementCommand,h.generate].forEach(fn=>fn.mockResolvedValue({ok:true}));h.profile.mockRejectedValue(new ServiceError('INVALID_INPUT',400,'请先保存头像和昵称'));});
describe('legacy public writes require trusted identity without requiring account presentation',()=>{
  const cases=[
    ['create activity',()=>create(request(activityInput))],
    ['apply activity',()=>apply(request({idempotency_key:'profile-entry-key',expected_revision:1,segments:[{segment_id:id,plan_revision:1}]}),{params:Promise.resolve({activityId:id})})],
    ['create requirements',()=>requirementCreate(request({action:'create',kind:'team',idempotency_key:'profile-entry-key',draft:draftInput}))],
    ['save requirements',()=>requirementCommand(request({action:'save-draft',expected_revision:1,draft:draftInput}),context)],
    ['publish requirements',()=>requirementCommand(request({action:'publish',expected_revision:1}),context)],
    ['respond requirements',()=>requirementCommand(request({action:'respond',expected_revision:1,expected_response_version:0,response:{selected_segment_ids:[],answers:[],location_ids:[],location_other:null,time_preferences:'',budget_note:'',preferences:''}}),context)],
    ['finalize requirements',()=>requirementCommand(request({action:'finalize',expected_revision:1,final_selection:{location_id:null,location_other:null,note:''}}),context)],
    ['generate AI draft',()=>draft(request({text:'一起打球',selected_date:'2030-01-02',source_revision:1}))],
  ] as const;
  it.each(cases)('allows authenticated %s without a saved account avatar or nickname',async(_label,run)=>{
    const response=await run();expect(response.status).toBe(200);expect(h.profile).not.toHaveBeenCalled();
    expect([h.create,h.apply,h.requirementCreate,h.requirementCommand,h.generate].reduce((n,fn)=>n+fn.mock.calls.length,0)).toBe(1);
  });
  it.each(cases)('still blocks unauthenticated %s before any write',async(_label,run)=>{
    h.auth.mockRejectedValue(new ServiceError('UNAUTHENTICATED',401,'请先登录'));
    expect((await run()).status).toBe(401);
    expect([h.create,h.apply,h.requirementCreate,h.requirementCommand,h.generate].every(fn=>!fn.mock.calls.length)).toBe(true);
  });
  it('keeps closing an existing collection and read-only access available without completing profile',async()=>{
    h.requirementCommand.mockResolvedValue({ack:true});h.read.mockResolvedValue({view:true});
    expect((await requirementCommand(request({action:'close',expected_revision:1}),context)).status).toBe(200);
    expect((await requirementRead(new Request('https://fixture.test/api/v1/requirements/'+id),context)).status).toBe(200);
    expect(h.profile).not.toHaveBeenCalled();
  });
});
