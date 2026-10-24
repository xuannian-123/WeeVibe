import { createActivityInputSchema, type CreateActivityInput } from '@weego/contracts';
import { ACTIVITY_JSON_MAX_BYTES } from '@weego/contracts/src/limits';
import { newKey } from './local-id';

// UI-only editable text. Network fields/types come exclusively from shared contracts.
export type SegmentForm = {
  ref: string; type: string; name: string; startDate: string; startTime: string; endDate: string; endTime: string;
  deadlineDate: string; deadlineTime: string; place: string; address: string; amount: string; feeUnit: string;
  feeNote: string; requirements: string; minimum: string; capacity: string;
};
export type ActivityForm = { name: string; nickname: string; mainRef: string; attending: string[]; segments: SegmentForm[] };
export const typeOptions = [
  { value: 'sport', label: '运动' }, { value: 'dinner', label: '聚餐' }, { value: 'karaoke', label: '唱歌' },
  { value: 'drinks', label: '喝酒' }, { value: 'board_game', label: '桌游' }, { value: 'custom', label: '自定义' }
];
export const feeOptions = [{ value: 'unknown', label: '未知（不是免费）' }, { value: 'per_person', label: '每人参考费用' }, { value: 'total', label: '环节总价' }, { value: 'per_hour', label: '每小时报价' }];
export function emptySegment(): SegmentForm {
  return { ref: newKey(), type: 'custom', name: '', startDate: '', startTime: '', endDate: '', endTime: '', deadlineDate: '', deadlineTime: '',
    place: '', address: '', amount: '', feeUnit: 'unknown', feeNote: '', requirements: '', minimum: '', capacity: '' };
}
export function emptyForm(): ActivityForm { const segment = emptySegment(); return { name: '', nickname: '', mainRef: segment.ref, attending: [], segments: [segment] }; }
export function segmentName(form: ActivityForm, segment: SegmentForm): string {
  return segment.name.trim() || (form.segments.length === 1 ? form.name.trim() : '');
}
export function shanghaiTime(date: string, time: string): string {
  const raw = `${date}T${time}:00+08:00`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请完整填写日期与时间（Asia/Shanghai）');
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || new Date(parsed + 8 * 3600000).toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error('日期或时间无效');
  return raw;
}
export function moneyCents(value: string): number {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) throw new Error('请明确填写参考费用，最多两位小数；未知不能填 0 冒充免费');
  const [whole, fraction = ''] = value.split('.'); const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('参考费用过大');
  return cents;
}
export function positiveInteger(value: string) {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) throw new Error('最低人数与上限必须为正整数');
  return number;
}

export function buildCreateInput(form: ActivityForm, key: string): CreateActivityInput {
  const segments = form.segments.map((s, i) => {
    try {
      const followsStart = !s.deadlineDate && !s.deadlineTime;
      return { client_ref: s.ref, type: s.type, name: segmentName(form, s),
        starts_at: shanghaiTime(s.startDate, s.startTime), ends_at: shanghaiTime(s.endDate || s.startDate, s.endTime),
        deadline_at: followsStart ? shanghaiTime(s.startDate, s.startTime) : shanghaiTime(s.deadlineDate, s.deadlineTime),
        minimum_participants: positiveInteger(s.minimum), capacity: positiveInteger(s.capacity),
        location: { name: s.place.trim(), address: s.address.trim() || null, source_url: null },
        fee: { kind: s.feeUnit, amount_cents: s.feeUnit === 'unknown' ? null : moneyCents(s.amount), currency: 'CNY', note: s.feeNote.trim() },
        requirements: s.requirements.trim() };
    } catch (error) { throw new Error(`环节 ${i + 1}：${error instanceof Error ? error.message : '请核对字段'}`); }
  });
  const result = createActivityInputSchema.safeParse({ idempotency_key: key, name: form.name.trim(), timezone: 'Asia/Shanghai',
    main_segment_ref: form.mainRef, participating_segment_refs: form.attending, segments,
    ...(form.nickname.trim() ? { display_name: form.nickname.trim() } : {}) });
  if (!result.success) {
    const labels: Record<string, string> = { name: '名称', timezone: '时区', main_segment_ref: '主环节', participating_segment_refs: '本人参加选择',
      starts_at: '开始时间', ends_at: '结束时间', deadline_at: '报名截止', minimum_participants: '最低人数', capacity: '人数上限',
      location: '地点', address: '地址', source_url: '来源', fee: '参考费用', note: '费用口径', amount_cents: '费用金额', requirements: '参加要求', display_name: '本人昵称' };
    throw new Error(result.error.issues.map(issue => {
      const prefix = issue.path[0] === 'segments' && typeof issue.path[1] === 'number' ? `环节 ${issue.path[1] + 1}` : '活动';
      const field = issue.path.filter(v => typeof v === 'string').map(v => labels[String(v)] ?? '').filter(Boolean).join(' · ');
      return `${prefix}${field ? ` · ${field}` : ''}：${issue.code === 'custom' ? issue.message : '请补齐内容或核对格式、长度及范围'}`;
    }).join('；'));
  }
  // Shared UTF-8 byte bound; never truncate valid fields or silently drop segments.
  if (encodeURIComponent(JSON.stringify(result.data)).replace(/%[A-Fa-f0-9]{2}/g, 'x').length > ACTIVITY_JSON_MAX_BYTES) throw new Error('当前接口请求超过 64KiB，请减少文字长度；不会截断后提交。');
  return result.data;
}

export function isActivityForm(value: unknown): value is ActivityForm {
  if (!value || typeof value !== 'object') return false;
  const form = value as Partial<ActivityForm>;
  if (typeof form.name !== 'string' || typeof form.nickname !== 'string' || typeof form.mainRef !== 'string' || !Array.isArray(form.attending) || !form.attending.every(v => typeof v === 'string') || !Array.isArray(form.segments) || !form.segments.length) return false;
  const fields: (keyof SegmentForm)[] = ['ref', 'type', 'name', 'startDate', 'startTime', 'endDate', 'endTime', 'deadlineDate', 'deadlineTime', 'place', 'address', 'amount', 'feeUnit', 'feeNote', 'requirements', 'minimum', 'capacity'];
  return form.segments.every(s => !!s && typeof s === 'object' && fields.every(field => typeof s[field] === 'string'));
}
