import { describe, expect, it, vi } from 'vitest';
import { emptyGatheringIntake, gatheringOrganizeSchema, gatheringOwnBlocks, gatheringPublicBlocks, privateGatheringInputText } from '../packages/contracts/src';
import { createGatheringAI } from '../apps/web/src/server/gatherings/ai';

const privateProse = [
  '预算200以内', '人均两百', '人均不超过二百', '花费两百块钱', '这次花费控制在两百',
  '我最多花两百', '200块钱以内', '二百元', '两百块左右', '一百多块钱', '两百来元', '人均０元', '花费0',
  '我家在星湖街88号', '我的宿舍地址是文星路1号', '幸福小区3栋201室',
  '星湖街88号3幢201室', '阳光公寓二号楼', '从学校东门出发',
];
const publicProse = [
  '找免费活动', '费用未知，场地待核实', '家庭友好餐厅', '宿舍附近的公园',
  '住宅区附近散步', '我家附近的公园', '一块去唱歌', '买两块蛋糕一起吃',
  '最多3个项目', '花两小时散步', '花费两小时逛公园', '人均步行两公里',
  '希望人均步行两公里', '消费两杯咖啡', '花费两个月时间', '喜欢苏州市星湖街88号的书店', '去文星广场吃火锅后散步',
];

describe('shared public text privacy before organizing or publishing', () => {
  it.each(privateProse)('rejects private prose in either public free-text field: %s', text => {
    for (const field of ['note', 'availability'] as const) {
      const intake = emptyGatheringIntake(); intake.public[field] = text;
      expect(() => gatheringPublicBlocks(intake.public)).toThrow('仅本人可见');
      expect(() => gatheringOwnBlocks(intake)).toThrow('仅本人可见');
    }
  });
  it.each(publicProse)('keeps ordinary public preferences usable: %s', text => {
    const intake = emptyGatheringIntake(); intake.public.note = text;
    expect(gatheringPublicBlocks(intake.public)).toEqual([{ id: 'note', label: '补充想法', value: text, confirmed: false }]);
    expect(gatheringOwnBlocks(intake)).toEqual(gatheringPublicBlocks(intake.public));
  });
  it('allows the same amounts and home details in private fields, including an explicit zero', () => {
    const intake = emptyGatheringIntake();
    intake.public.note = '想吃火锅后散步';
    intake.private = { budget_min: 0, budget_max: 200, budget_note: '人均两百，不含交通费', origin: { label: '幸福小区3栋201室' }, confirmed_keys: [] };
    const own = gatheringOwnBlocks(intake), shared = gatheringPublicBlocks(intake.public);
    expect(own.find(block => block.id === 'budget')?.value).toContain('最低 0 元');
    expect(own.find(block => block.id === 'budget')?.value).toContain('人均两百');
    expect(own.find(block => block.id === 'origin')?.value).toBe('幸福小区3栋201室');
    expect(shared).toEqual([{ id: 'note', label: '补充想法', value: '想吃火锅后散步', confirmed: false }]);
  });
  it('keeps the existing regex test API stateless across repeated calls', () => {
    for (let i = 0; i < 3; i++) {
      expect(privateGatheringInputText.test('人均两百')).toBe(true);
      expect(privateGatheringInputText.test('家庭友好餐厅')).toBe(false);
    }
  });
  it.each(['花费两百块钱', '人均两百', '幸福小区3栋201室'])('rejects %s before any model provider call', async text => {
    const fetcher = vi.fn();
    const intake = emptyGatheringIntake(); intake.public.note = text;
    await expect(createGatheringAI({ fetch: fetcher, config: () => ({}) }).organize('11111111-1111-4111-8111-111111111111', intake.public)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves the strict organize payload boundary without adding private or identity fields', () => {
    const intake = emptyGatheringIntake();
    const { activity_nickname: _, ...publicInput } = intake.public;
    expect(gatheringOrganizeSchema.safeParse({ public: publicInput }).success).toBe(true);
    expect(gatheringOrganizeSchema.safeParse({ public: publicInput, private: intake.private }).success).toBe(false);
    expect(gatheringOrganizeSchema.safeParse({ public: { ...publicInput, activity_nickname: '小橘头' } }).success).toBe(false);
  });
});
