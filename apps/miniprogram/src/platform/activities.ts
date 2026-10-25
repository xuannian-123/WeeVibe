import Taro from '@tarojs/taro';
import { activityIdSchema, type ActivityDetail } from '@weevibe/contracts';
export { buildCreateInput } from './activity-form';

export type RecentActivity = { id: string; name: string };
export function recentActivities(userId: string): RecentActivity[] {
  try {
    const raw: unknown = Taro.getStorageSync(`weego-recent-v1:${userId}`);
    return Array.isArray(raw) ? raw.filter((v): v is RecentActivity => typeof v === 'object' && v !== null && activityIdSchema.safeParse(v.id).success && typeof v.name === 'string').slice(0, 10) : [];
  } catch { return []; }
}
export function rememberActivity(userId: string | null, activity: ActivityDetail) {
  if (!userId) return;
  try { Taro.setStorageSync(`weego-recent-v1:${userId}`, [{ id: activity.activity_id, name: activity.name }, ...recentActivities(userId).filter(v => v.id !== activity.activity_id)].slice(0, 10)); } catch { /* Reference cache only; do not reinterpret a confirmed write as a failed write. */ }
}
export function formatTime(raw: string) {
  const date = new Date(Date.parse(raw) + 8 * 3600000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') + '（上海）' : '时间待核对';
}
export function feeText(fee: ActivityDetail['segments'][number]['fee']) {
  if (fee.kind === 'unknown' || fee.amount_cents === null) return `费用待确认${fee.note ? `；${fee.note}` : ''}（不是免费）`;
  const units = { per_person: '每人', total: '环节总价', per_hour: '每小时报价' };
  return `参考 ¥${(fee.amount_cents / 100).toFixed(2)}／${units[fee.kind]}${fee.note ? `；${fee.note}` : ''}，非已付款`;
}
