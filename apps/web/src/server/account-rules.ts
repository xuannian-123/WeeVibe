export const emptyProfile = { nickname: '', birthday: '', gender: '未设置', zodiac: '', mbti: '', signature: '', introduction: '' };
export type PrivateProfileInput = typeof emptyProfile;
const limits: Record<keyof PrivateProfileInput, number> = { nickname: 32, birthday: 10, gender: 8, zodiac: 8, mbti: 4, signature: 100, introduction: 500 };
export function parsePrivateProfile(input: unknown, now = new Date()): PrivateProfileInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('个人信息格式不正确');
  const source = input as Record<string, unknown>;
  if (Object.keys(source).some(key => !Object.prototype.hasOwnProperty.call(limits, key))) throw new Error('含不支持的资料字段');
  const value = { ...emptyProfile };
  for (const key of Object.keys(limits) as (keyof PrivateProfileInput)[]) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'string') throw new Error('资料字段应为文字');
    const text = (source[key] as string).trim();
    if (text.length > limits[key] || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text)) throw new Error('资料长度或格式不正确');
    value[key] = text;
  }
  if (value.birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(value.birthday) || !Number.isFinite(Date.parse(value.birthday)) || new Date(value.birthday).toISOString().slice(0, 10) !== value.birthday || value.birthday > now.toISOString().slice(0, 10))) throw new Error('出生日期无效或晚于今天');
  if (!['', '未设置', '不愿透露', '男', '女', '其他'].includes(value.gender)) throw new Error('性别选项不正确');
  if (value.mbti && !/^[IE][NS][FT][JP]$/.test(value.mbti)) throw new Error('MBTI格式不正确');
  if (value.zodiac && !['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座'].includes(value.zodiac)) throw new Error('星座选项不正确');
  return value;
}
export function participationDisplayStatus(segments: { startsAt: Date; endsAt: Date; cancelledAt: Date | null }[], cancelled: boolean, now: Date) {
  const active = segments.filter(s => !s.cancelledAt);
  if (cancelled || !active.length) return '已取消' as const;
  const start = Math.min(...active.map(s => s.startsAt.getTime()));
  const end = Math.max(...active.map(s => s.endsAt.getTime()));
  return now.getTime() < start ? '待参加' as const : now.getTime() >= end ? '已结束' as const : '活动中' as const;
}
export function decisionMessageId(applicationId: string, status: string) { return `application:${applicationId}:${status}`; }
export function parseDecisionMessageId(id: unknown) {
  if (typeof id !== 'string') throw new Error('消息编号无效');
  const match = /^application:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(approved|rejected)$/.exec(id);
  if (!match) throw new Error('消息编号无效');
  return { applicationId: match[1], status: match[2] as 'approved' | 'rejected', id };
}
