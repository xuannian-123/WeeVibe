import {describe,expect,it} from 'vitest';
import {emptyGatheringDetails,gatheringDetailsSchema,type GatheringDetails} from '../packages/contracts/src';
import {gatheringFeeLabel,gatheringPeopleLabel,hasGatheringPublicDetails} from '../apps/miniprogram/src/features/gatherings/details-summary';
import {gatheringCapacityReached,gatheringDetailsDraftSchema} from '../apps/miniprogram/src/features/gatherings/details-validation';
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

describe('historical friend structural draft retention',()=>{

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
  it('does not apply the visitor-cap notice to a final record',()=>{
    const value=visitor();value.gathering.member_count=50;
    value.final_choice={generation_id:gatheringId,plan_id:'plan1',finalized_at:'2030-11-01T00:01:00Z'};
    expect(gatheringCapacityReached(value)).toBe(false);

  });
});
