import {describe,expect,it} from 'vitest';
import {emptyGatheringIntake,gatheringIntakeSchema} from '../packages/contracts/src';
import {gatheringProgressIntake,makeGatheringIntakeProgress,readGatheringIntakeProgress,type GatheringIntakeProgressState} from '../apps/miniprogram/src/features/gatherings/intake-progress';

function state():GatheringIntakeProgressState{
  const intake=emptyGatheringIntake();intake.public.activity_nickname='本次出游的小林';intake.public.date='2030-11-08';
  return {intake,mode:'interview',step:3,budgetMinText:'',budgetMaxText:'',answered:[true,true,false,false,false],noteBase:'',questionProse:{},acknowledgements:{0:'时间先这样记录。'},composers:{2:'还没发送的预算回答'},confirm:false,selected:[],summary:''};
}

describe('actor-owned local intake progress format',()=>{
  it('round-trips the active question, unfinished composer and explicitly answered states',()=>{
    const value=state();value.mode='interview';value.step=3;value.composers={1:'未发送的私人出发地',2:'未发送的私人预算'};
    value.intake.private.origin={label:'已填写的私人出发地'};
    const stored=makeGatheringIntakeProgress(value)!;
    const restored=readGatheringIntakeProgress(JSON.parse(JSON.stringify(stored)))!;
    expect(restored).toMatchObject({version:1,mode:'interview',step:3,answered:[true,true,false,false,false],composers:value.composers});
    expect(gatheringProgressIntake(restored).private.origin?.label).toBe('已填写的私人出发地');
    expect(restored).not.toHaveProperty('session');
    expect(restored).not.toHaveProperty('idempotency_key');
    expect(restored).not.toHaveProperty('busy');
  });

  it('retains original public prose bookkeeping so editing an answer need not duplicate it',()=>{
    const value=state();value.intake.public.note='已有补充\n想一起散步';value.noteBase='已有补充';
    value.questionProse={3:'想一起散步'};value.acknowledgements={3:'已保留你的原话'};value.step=4;
    expect(readGatheringIntakeProgress(makeGatheringIntakeProgress(value))).toMatchObject({noteBase:'已有补充',questionProse:{3:'想一起散步'},acknowledgements:{3:'已保留你的原话'}});
  });

  it.each([null,undefined,{},'not-a-progress-record',[]])('ignores an unknown local record %#',raw=>{
    expect(readGatheringIntakeProgress(raw)).toBeUndefined();
  });

  it.each([
    {version:2},
    {mode:'unknown'},
    {step:-1},
    {step:6},
    {mode:'form',step:5},
    {step:1.5},
    {answered:[true]},
    {composers:{5:'越界问题'}},
    {questionProse:{1:'私人回答不能变成公开原文'}},
    {budgetMinText:'1'.repeat(129)},
    {composers:{0:'字'.repeat(1001)}},
    {selected:['date','date']},
    {session:'should-never-be-persisted'},
  ])('rejects an incompatible or out-of-bounds local record %#',patch=>{
    expect(readGatheringIntakeProgress({...makeGatheringIntakeProgress(state())!,...patch})).toBeUndefined();
  });

  it('keeps the intentionally cleared date empty instead of inventing a recovered date',()=>{
    const value=state();value.intake.public.date='';
    const restored=readGatheringIntakeProgress(makeGatheringIntakeProgress(value))!;
    expect(gatheringProgressIntake(restored).public.date).toBe('');
  });
});

describe('temporary raw private amount edits',()=>{
  it('preserves a decimal still being typed and never rounds it during recovery',()=>{
    const value=state();value.budgetMinText='1.';value.intake.private.budget_min=1;
    const restored=readGatheringIntakeProgress(makeGatheringIntakeProgress(value))!;
    expect(restored.budgetMinText).toBe('1.');
    expect(gatheringProgressIntake(restored).private.budget_min).toBe(1);
  });

  it('keeps an inverted draft without making it a valid completed intake',()=>{
    const value=state();value.budgetMinText='200';value.budgetMaxText='100';
    value.intake.private.budget_min=200;value.intake.private.budget_max=100;
    const stored=makeGatheringIntakeProgress(value)!;
    expect(stored).toBeDefined();
    expect(gatheringIntakeSchema.safeParse(gatheringProgressIntake(stored)).success).toBe(false);
  });

  it.each(['not-a-number','1e999'])('keeps %s as unfinished text while using a JSON-safe snapshot',text=>{
    const value=state();value.budgetMinText=text;value.intake.private.budget_min=Number(text);
    const stored=makeGatheringIntakeProgress(value)!;
    expect(stored.intake.private.budget_min).toBeNull();
    const restored=readGatheringIntakeProgress(JSON.parse(JSON.stringify(stored)))!;
    expect(restored.budgetMinText).toBe(text);
    expect(gatheringIntakeSchema.safeParse(gatheringProgressIntake(restored)).success).toBe(false);
  });

  it('restores explicit zero separately from an empty private amount',()=>{
    const value=state();value.budgetMinText='0';value.intake.private.budget_min=0;
    const restored=readGatheringIntakeProgress(makeGatheringIntakeProgress(value))!;
    expect(gatheringProgressIntake(restored).private.budget_min).toBe(0);
    value.budgetMinText='';value.intake.private.budget_min=null;
    expect(gatheringProgressIntake(makeGatheringIntakeProgress(value)!).private.budget_min).toBeNull();
  });
});

describe('confirmation is restored as a review, not a submission',()=>{
  it('retains only explicitly chosen valid confirmation blocks',()=>{
    const value=state();value.mode='form';value.step=4;value.confirm=true;value.selected=['date'];value.summary='日期：2030-11-08';
    const restored=readGatheringIntakeProgress(makeGatheringIntakeProgress(value))!;
    expect(restored.confirm).toBe(true);expect(restored.selected).toEqual(['date']);
    expect(restored.intake.public.confirmed_keys).toEqual([]);
  });

  it.each(['missing-nickname','unknown-block','invalid-budget','private-public-note'])('does not restore a corrupted %s confirmation',failure=>{
    const value=state();value.confirm=true;value.selected=['date'];
    if(failure==='missing-nickname')value.intake.public.activity_nickname='';
    if(failure==='unknown-block')value.selected=['missing_block'];
    if(failure==='invalid-budget'){value.budgetMinText='200';value.budgetMaxText='100';value.intake.private.budget_min=200;value.intake.private.budget_max=100;}
    if(failure==='private-public-note')value.intake.public.note='我的预算是200元';
    expect(makeGatheringIntakeProgress(value)).toBeUndefined();
  });
});
