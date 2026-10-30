import { describe, expect, it } from 'vitest';
import { emptyGatheringIntake } from '../packages/contracts/src';
import { applyInterviewPatch, interviewAnswerSummary, interviewQuestions, parseInterviewAnswer } from '../apps/miniprogram/src/features/gatherings/interview-flow';

function parsed(index: number, text: string) {
  const before = emptyGatheringIntake(); before.public.date = '2030-11-08';
  const result = parseInterviewAnswer(index, text, before);
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw Error(result.message);
  return { before, after: applyInterviewPatch(before, result.patch), result };
}
describe('five-question local parsing without implicit submission', () => {
  it('keeps nickname outside the five questions', () => {
    expect(interviewQuestions.map(q => q.id)).toEqual(['availability', 'origin', 'budget', 'do', 'preferences']);
    expect(interviewQuestions.filter(q => q.private).map(q => q.id)).toEqual(['origin', 'budget']);
  });
  it('keeps zero as an explicit maximum rather than flexible or free', () => {
    const { after, result } = parsed(2, '0元'); expect(after.private.budget_max).toBe(0); expect(after.private.budget_min).toBeNull(); expect(result.acknowledgement).toContain('不代表场地报价');
  });
  it.each(['', '都行', '愿意配合'])('treats explicitly submitted flexible budget %s as null bounds', text => {
    const { after } = parsed(2, text); expect(after.private).toMatchObject({ budget_min: null, budget_max: null, budget_note: '' }); expect(after.public.note).toBe('');
  });
  it.each([['100到200', 100, 200], ['预算200以内', null, 200], ['至少100元', 100, null], ['100-200元', 100, 200]])('records supported budget %s', (text, min, max) => {
    const { after } = parsed(2, text as string); expect(after.private.budget_min).toBe(min); expect(after.private.budget_max).toBe(max);
  });
  it.each(['200到100', '-100', '100左右', '一百以内', '1000001', '1.234', '两个人200元', '100,200'])('asks again for ambiguous or invalid budget %s without patching', text => {
    expect(parseInterviewAnswer(2, text, emptyGatheringIntake()).status).toBe('clarify');
  });
  it('stores departure text privately without manufacturing coordinates', () => {
    const { after, before } = parsed(1, '从学校东门出发'); expect(after.private.origin).toEqual({ label: '从学校东门出发' }); expect(after.public).toEqual(before.public); expect(before.private.origin).toBeNull();
  });
  it('does not erase an existing qualitative budget note when only the amount changes', () => {
    const intake=emptyGatheringIntake();intake.private.budget_note='不含交通费';const result=parseInterviewAnswer(2,'200以内',intake);expect(result.status).toBe('accepted');if(result.status==='accepted')expect(applyInterviewPatch(intake,result.patch).private.budget_note).toBe('不含交通费');
  });
  it('retains oral availability without inventing a calendar date or clock', () => {
    const { after } = parsed(0, '周六下午两点以后'); expect(after.public.date).toBe('2030-11-08'); expect(after.public.availability).toBe('周六下午两点以后');
  });
  it('accepts an explicit date only if valid', () => {
    expect(parsed(0, '2030-12-02 下午有空').after.public.date).toBe('2030-12-02'); expect(parseInterviewAnswer(0, '2030-02-30', emptyGatheringIntake()).status).toBe('clarify');
  });
  it.each([0, 3, 4])('does not copy private data into public answers at step %s', index => {
    const result = parseInterviewAnswer(index, '从宿舍出发，预算200元', emptyGatheringIntake()); expect(result).toMatchObject({ status: 'clarify', privateNotice: true }); expect('patch' in result).toBe(false);
  });
  it.each(['人均两百', '这次花费两百块钱', '我最多花两百', '希望不超过二百元', '200块钱以内', '两百块左右', '花费200', '我家在苏州市星湖街88号', '幸福小区3栋201室', '星湖街88号3幢201室', '阳光公寓二号楼'])('keeps private money and residential details out of public notes: %s', text => {
    const intake = emptyGatheringIntake(); intake.public.note = '原有公开偏好';
    expect(parseInterviewAnswer(3, text, intake)).toMatchObject({ status: 'clarify', privateNotice: true });
    expect(intake.public.note).toBe('原有公开偏好');
  });
  it.each(['家庭友好餐厅', '找免费活动', '宿舍附近的公园', '住宅区附近散步', '我家附近的公园', '一块去唱歌', '买两块蛋糕一起吃', '最多3个项目', '花两小时散步', '花费两小时逛公园', '喜欢苏州市星湖街88号的书店'])('preserves public activity and venue preferences: %s', text => {
    expect(parsed(3, text).after.public.note).toBe(text);
  });
  it('keeps existing answers untouched when a revised budget is ambiguous', () => {
    const intake = parsed(2, '0元').after; intake.private.budget_note = '不含交通';
    const before = structuredClone(intake);
    expect(parseInterviewAnswer(2, '两百左右', intake).status).toBe('clarify'); expect(intake).toEqual(before);
  });
  it('does not duplicate raw prose when an answer is replayed across steps', () => {
    const first = parsed(3, '想吃火锅，之后散步').after;
    const repeat = parseInterviewAnswer(4, '想吃火锅，之后散步', first);
    expect(repeat.status).toBe('accepted'); if (repeat.status !== 'accepted') throw Error(repeat.message);
    expect(applyInterviewPatch(first, repeat.patch).public.note).toBe(first.public.note);
  });
  it('deduplicates a previous multiline answer without swallowing distinct wording', () => {
    const intake = emptyGatheringIntake(); intake.public.note = '想散步\n想看星星\n希望多聊聊';
    const repeat = parseInterviewAnswer(4, '想散步\n想看星星', intake);
    expect(repeat.status).toBe('accepted'); if (repeat.status === 'accepted') expect(applyInterviewPatch(intake, repeat.patch).public.note).toBe(intake.public.note);
    const distinct = parseInterviewAnswer(4, '散步', intake);
    expect(distinct.status).toBe('accepted'); if (distinct.status === 'accepted') expect(applyInterviewPatch(intake, distinct.patch).public.note).toBe(`${intake.public.note}\n散步`);
  });
  it('does not classify negated food preferences as wanted activities', () => {
    const { after } = parsed(3, '想吃火锅，不要烧烤，之后散步'); expect(after.public.keywords.eat).toContain('火锅／串串'); expect(after.public.keywords.eat).not.toContain('烧烤'); expect(after.public.keywords.play).toContain('散步'); expect(after.public.note).toContain('不要烧烤');
  });
  it('separates wanted pace from avoided environment and retains unrecognized prose', () => {
    const { after } = parsed(4, '轻松不赶场，避免烟味重，想在一起多聊聊'); expect(after.public.keywords.pace).toContain('轻松不赶场'); expect(after.public.keywords.environment).toContain('烟味重'); expect(after.public.note).toContain('想在一起多聊聊');
  });
  it('does not infer confirmation or erase another privacy partition', () => {
    const intake = emptyGatheringIntake(); intake.public.confirmed_keys = ['play_0']; intake.private.confirmed_keys = ['origin'];
    const next = applyInterviewPatch(intake, { public: { note: '一起散步' } }); expect(next.public.confirmed_keys).toEqual([]); expect(next.private.confirmed_keys).toEqual(['origin']); expect(intake.public.confirmed_keys).toEqual(['play_0']);
  });
  it('keeps unknown wording instead of making up catalog choices', () => {
    const { after } = parsed(3, '想看看候鸟迁徙'); expect(Object.values(after.public.keywords).flat()).toEqual([]); expect(after.public.note).toBe('想看看候鸟迁徙');
  });
  it('does not display unfinished numeric input or mark blank private fields answered', () => {
    const intake = emptyGatheringIntake(); intake.private.budget_max = NaN;
    expect(interviewAnswerSummary(2, intake)).toBe('尚未填写预算'); expect(interviewAnswerSummary(2, intake, true)).toBe('愿意配合其他人的安排'); expect(interviewAnswerSummary(1, intake)).toBe('尚未填写出发地点');
  });
});
