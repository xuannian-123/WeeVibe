import { describe, expect, it } from 'vitest';
import type { RequirementQuestion } from '../packages/contracts/src/requirements';
import { emptyAnswer, toggleOther, toggleAnswerOption, serializeAnswers, beijingDateParts, beijingLabel } from '../apps/miniprogram/src/features/requirements/answer-state';
const question: RequirementQuestion = { id:'q',title:'吃什么',multiple:false,required:true,segment_id:null,options:[{id:'a',label:'面'},{id:'b',label:'饭'}] };
describe('requirement UI serialization (no platform calls)',()=>{
  it('single choice other clears ordinary selection',()=>expect(toggleOther(question,{option_ids:['a'],other_selected:false,other_text:'stale'})).toEqual({option_ids:[],other_selected:true,other_text:''}));
  it('single ordinary selection clears hidden other text',()=>expect(toggleAnswerOption(question,{option_ids:[],other_selected:true,other_text:'secret'},'a')).toEqual({option_ids:['a'],other_selected:false,other_text:''}));
  it('multiple choice keeps ordinary choices when selecting other',()=>expect(toggleOther({...question,multiple:true},{option_ids:['a'],other_selected:false,other_text:''}).option_ids).toEqual(['a']));
  it('deselecting other clears stale hidden text',()=>expect(toggleOther(question,{option_ids:[],other_selected:true,other_text:'old'})).toEqual(emptyAnswer()));
  it('ignores unknown options',()=>{const current=emptyAnswer();expect(toggleAnswerOption(question,current,'not-owned')).toBe(current);});
  it('does not send unselected segment questions',()=>expect(serializeAnswers([{...question,segment_id:'dinner'}],[],{q:{option_ids:['a'],other_selected:false,other_text:''}})).toEqual([]));
  it('rejects blank selected other',()=>expect(()=>serializeAnswers([question],[],{q:{option_ids:[],other_selected:true,other_text:'  '}})).toThrow('其他'));
  it('omits blank optional questions so they do not inflate answer counts',()=>expect(serializeAnswers([{...question,required:false}],[],{})).toEqual([]));
  it('never submits hidden other text',()=>expect(serializeAnswers([question],[],{q:{option_ids:['a'],other_selected:false,other_text:'stale'}})[0]?.other).toBeNull());
  it('requires an answer for required visible question',()=>expect(()=>serializeAnswers([question],[],{})).toThrow('必答'));
  it('formats Beijing dates independent of device timezone',()=>{expect(beijingDateParts('2030-01-01T20:30:00Z')).toEqual({date:'2030-01-02',time:'04:30'});expect(beijingLabel(null)).toBe('时间待定');});
});

import { requirementShareSummary } from '../apps/miniprogram/src/features/requirements/share-summary';
import type { RequirementSnapshot } from '../packages/contracts/src/requirements-api';
describe('public requirement share boundary',()=>{
  it('allowlists public summary and excludes private input, answers and credentials',()=>{
    const snapshot={collection:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'friend',draft:{title:'相聚',description:'计划说明',starts_at:'2030-01-02T10:00:00Z',deadline_at:'2030-01-01T10:00:00Z'},organizer_nickname:'小林'},own_response:{private_origin:{label:'SECRET_ADDRESS'},answers:[{other:'SECRET_ANSWER'}]},manager:{responses:[{preferences:'SECRET_PREFERENCE'}]},token:'SECRET_TOKEN'} as unknown as RequirementSnapshot;
    const summary=requirementShareSummary(snapshot);expect(Object.keys(summary).sort()).toEqual(['date','deadline','description','kind','organizer','path','title']);expect(JSON.stringify(summary)).not.toContain('SECRET');expect(summary.path).toBe('/pages/requirements/index?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
