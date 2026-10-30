import {describe,expect,it} from 'vitest';
import {emptyGatheringDetails,gatheringDetailsSchema,type GatheringDetails} from '../packages/contracts/src';
import {gatheringFeeLabel,gatheringPeopleLabel,hasGatheringPublicDetails} from '../apps/miniprogram/src/features/gatherings/details-summary';
import {gatheringCapacityReached,gatheringConfirmedDetails,gatheringDetailNumberIssue,gatheringDetailsDraftSchema,gatheringDetailsIssue} from '../apps/miniprogram/src/features/gatherings/details-validation';
import {gatheringId,gatheringUiFixture} from './gathering-ui-fixtures';

const details=():GatheringDetails=>({...emptyGatheringDetails(),date:'2030-11-08'});
const numbers=(patch:Partial<{minimum:string;capacity:string;amount:string}>={})=>({minimum:'',capacity:'',amount:'',...patch});

describe('visible public reference numbers and fee wording',()=>{
  it.each([
    {kind:'unknown',amount:null,label:'参考金额待商量'},
    {kind:'unknown',amount:0,label:'参考 0 元（口径待商量）'},
    {kind:'per_person',amount:0,label:'参考 0 元/人'},
    {kind:'per_person',amount:128.5,label:'参考 128.5 元/人'},
    {kind:'total',amount:256,label:'参考总额 256 元'},
    {kind:'per_hour',amount:12.25,label:'参考 12.25 元/小时'},
  ] as const)('keeps $kind / $amount as a reference with its own unit',({kind,amount,label})=>{
    expect(gatheringFeeLabel({kind,amount,note:''})).toBe(label);
  });

  it('does not turn an explanatory note into a known amount or a free price',()=>{
    const value=details();value.fee={kind:'per_person',amount:null,note:'消费方式由大家再商量'};
    expect(gatheringFeeLabel(value.fee)).toBe('参考金额待商量');
    expect(gatheringFeeLabel(value.fee)).not.toContain('免费');
    expect(hasGatheringPublicDetails(value)).toBe(true);
  });

  it('hides an empty reference even if a fee unit was selected',()=>{
    const value=details();value.fee={kind:'per_hour',amount:null,note:'  '};
    expect(hasGatheringPublicDetails(value)).toBe(false);
    expect(gatheringPeopleLabel(value)).toBe('人数待商量');
  });

  it('keeps explicit zero and either stored public people value visible',()=>{
    const value=details();value.fee.amount=0;
    expect(hasGatheringPublicDetails(value)).toBe(true);
    value.fee.amount=null;value.minimum=4;
    expect(hasGatheringPublicDetails(value)).toBe(true);
    value.minimum=null;value.capacity=8;
    expect(hasGatheringPublicDetails(value)).toBe(true);
  });

  it('distinguishes a stored intended minimum from the actual preparation submission cap',()=>{
    const value=details();value.minimum=4;value.capacity=8;
    const label=gatheringPeopleLabel(value);
    expect(label).toContain('人数意向至少 4 人');
    expect(label).toContain('筹备填写上限 8 人（含局头）');
    expect(label).not.toMatch(/成行|成局|席位/);
  });
});

describe('confirmation scope of a team edit',()=>{
  it('confirms the fields offered by team details without promoting its undecided date or title',()=>{
    const value=details();value.title='周末团建';value.start_time='14:00';value.place='示例公园';
    value.approximate_time='下午';value.minimum=6;value.fee.amount=0;value.confirmed_details=['description'];
    const confirmed=gatheringConfirmedDetails(value,'details');
    expect(confirmed).toEqual(expect.arrayContaining(['description','start_time','place','minimum','fee']));
    expect(confirmed).not.toContain('date');
    expect(confirmed).not.toContain('title');
    expect(confirmed).not.toContain('approximate_time');
    expect(value.confirmed_details).toEqual(['description']);
  });

  it('preserves an explicitly confirmed date while editing team detail fields',()=>{
    const value=details();value.capacity=8;value.confirmed_details=['date','description','approximate_time'];
    expect(gatheringConfirmedDetails(value,'details')).toEqual(expect.arrayContaining(['date','description','approximate_time','capacity']));
  });

  it('removes confirmations for cleared people and fee fields',()=>{
    const value=details();value.confirmed_details=['date','minimum','capacity','fee'];
    value.fee={kind:'per_person',amount:null,note:''};
    expect(gatheringConfirmedDetails(value,'details')).toEqual(['date']);
  });

  it('keeps a public fee note confirmed when the numerical amount is absent',()=>{
    const value=details();value.fee.note='交通费用另行商量';
    expect(gatheringConfirmedDetails(value,'details')).toContain('fee');
  });

  it('does not publish other team details while saving questionnaire information',()=>{
    const value=details();value.title='团建活动';value.approximate_time='下午';value.start_time='14:00';
    value.capacity=80;value.minimum=6;value.fee.amount=128;value.confirmed_details=['place'];
    const confirmed=gatheringConfirmedDetails(value,'questionnaire');
    expect(confirmed).toEqual(expect.arrayContaining(['date','title','approximate_time','place']));
    expect(confirmed).not.toContain('start_time');
    expect(confirmed).not.toContain('minimum');
    expect(confirmed).not.toContain('capacity');
    expect(confirmed).not.toContain('fee');
  });

  it('removes cleared questionnaire confirmations without touching the other page',()=>{
    const value=details();value.date='';value.title='';value.confirmed_details=['date','title','capacity'];
    expect(gatheringConfirmedDetails(value,'questionnaire')).toEqual(['capacity']);
  });
});

describe('raw team numeric input before conversion',()=>{
  it.each(['1','50','500'])('accepts a team member range boundary of %s',value=>{
    expect(gatheringDetailNumberIssue(numbers({minimum:value,capacity:value}))).toBeUndefined();
  });

  it('allows blanks without imposing the intended minimum as a join threshold',()=>{
    expect(gatheringDetailNumberIssue(numbers(),4)).toBeUndefined();
    expect(gatheringDetailNumberIssue(numbers({minimum:'8'}),4)).toBeUndefined();
  });

  it.each(['1e1','0x10','1.5','+2','-1','0','501'])('rejects a team people value typed as %s',raw=>{
    expect(gatheringDetailNumberIssue(numbers({minimum:raw}))).toContain('1—500 的整数');
    expect(gatheringDetailNumberIssue(numbers({capacity:raw}))).toContain('1—500 的整数');
  });

  it('keeps the team maximum of 500 independent from the friend collection limit',()=>{
    expect(gatheringDetailNumberIssue(numbers({minimum:'51',capacity:'51'}))).toBeUndefined();
    expect(gatheringDetailNumberIssue(numbers({capacity:'501'}))).toContain('1—500 的整数');
  });

  it('trims surrounding whitespace without reinterpreting invalid number syntax',()=>{
    expect(gatheringDetailNumberIssue(numbers({minimum:' 4 ',capacity:' 8 ',amount:' 12.50 '}))).toBeUndefined();
    expect(gatheringDetailNumberIssue(numbers({capacity:' 1e1 '}))).toBeDefined();
  });

  it.each(['0','0.00','12.3','12.34','1000000.00'])('accepts public reference amount %s',amount=>{
    expect(gatheringDetailNumberIssue(numbers({amount}))).toBeUndefined();
  });

  it.each(['0.001','12.345','1e2','0x10','-1','1000000.01'])('rejects unsupported public reference amount %s',amount=>{
    expect(gatheringDetailNumberIssue(numbers({amount}))).toContain('最多保留两位小数');
  });

  it('does not allow a new cap to exclude an existing team preparation member',()=>{
    expect(gatheringDetailNumberIssue(numbers({capacity:'2'}),3)).toContain('当前 3 位成员');
    expect(gatheringDetailNumberIssue(numbers({capacity:'3'}),3)).toBeUndefined();
    expect(gatheringDetailNumberIssue(numbers({capacity:''}),3)).toBeUndefined();
  });
});

describe('team schema errors and structural draft retention',()=>{
  it.each(['17:00','18:00'])('rejects a same-day end at %s after an 18:00 start',end_time=>{
    const value=details();value.start_time='18:00';value.end_time=end_time;
    expect(gatheringDetailsIssue(value)).toMatchObject({message:'结束时间应晚于开始时间'});
  });

  it('accepts a correctly ordered overnight arrangement',()=>{
    const value=details();value.start_time='22:00';value.end_date='2030-11-09';value.end_time='02:00';
    expect(gatheringDetailsIssue(value)).toBeUndefined();
  });

  it('rejects an end date earlier than the selected activity date',()=>{
    const value=details();value.start_time='22:00';value.end_date='2030-11-09';value.end_time='02:00';
    expect(gatheringDetailsIssue(value)).toBeUndefined();
    value.date='2030-11-10';
    expect(gatheringDetailsIssue(value)).toMatchObject({message:'结束日期不能早于活动日期'});
  });

  it('reports an impossible calendar date without referring to a removed editor page',()=>{
    const value=details();value.date='2030-02-30';
    expect(gatheringDetailsIssue(value)?.message).toContain('日期');
    expect(gatheringDetailsIssue(value)).not.toHaveProperty('section');
  });

  it('reports inverted minimum and capacity values',()=>{
    const value=details();value.minimum=8;value.capacity=4;
    expect(gatheringDetailsIssue(value)?.message).toContain('人数');
  });

  it('accepts team values beyond fifty without applying a removed friend-editor check',()=>{
    const value=details();value.minimum=51;value.capacity=500;
    expect(gatheringDetailsIssue(value)).toBeUndefined();
  });

  it('accepts a matching map selection and rejects a changed name or address',()=>{
    const value=details();
    value.place_venue={name:'示例公园',address:'示例公园南门',location:{latitude:31.2,longitude:120.3,crs:'GCJ-02'},source:{provider:'wechat',source_api:'wx.chooseLocation'}};
    value.place=value.place_venue.name;value.address=value.place_venue.address??'';
    expect(gatheringDetailsIssue(value)).toBeUndefined();
    value.place='另一个地点';
    expect(gatheringDetailsIssue(value)).toMatchObject({message:'集合地点与地图记录不一致，请重新选择地点'});
    value.place=value.place_venue.name;value.address='手动改写的地址';
    expect(gatheringDetailsIssue(value)).toMatchObject({message:'集合地点与地图记录不一致，请重新选择地点'});
  });

  it('retains structurally valid historical drafts even while their cross-field dates are incomplete',()=>{
    const value=details();value.title='保留的旧名称';value.end_date='2030-11-07';value.start_time='22:00';
    expect(gatheringDetailsSchema.safeParse(value).success).toBe(false);
    expect(gatheringDetailsDraftSchema.parse(value)).toEqual(value);
  });
});

describe('actual friend collection capacity checks',()=>{
  const visitor=()=>{const value=gatheringUiFixture('friend',false);value.viewer.is_member=false;value.own=null;value.members=null;value.gathering.has_responded=false;return value;};
  it('uses the real fifty-member collection limit when no historical lower cap exists',()=>{
    const value=visitor();value.gathering.member_count=49;
    expect(gatheringCapacityReached(value)).toBe(false);
    value.gathering.member_count=50;
    expect(gatheringCapacityReached(value)).toBe(true);
    value.gathering.details.capacity=500;
    expect(gatheringCapacityReached(value)).toBe(true);
  });
  it('respects an existing lower cap and still allows current members to save their own intake',()=>{
    const value=visitor();value.gathering.member_count=2;value.gathering.details.capacity=2;
    expect(gatheringCapacityReached(value)).toBe(true);
    value.viewer.is_member=true;
    expect(gatheringCapacityReached(value)).toBe(false);
  });
  it('does not apply the visitor-cap notice to a final record or a team activity',()=>{
    const value=visitor();value.gathering.member_count=50;
    value.final_choice={generation_id:gatheringId,plan_id:'plan1',finalized_at:'2030-11-01T00:01:00Z'};
    expect(gatheringCapacityReached(value)).toBe(false);
    value.final_choice=null;value.gathering.kind='team';
    expect(gatheringCapacityReached(value)).toBe(false);
  });
});
