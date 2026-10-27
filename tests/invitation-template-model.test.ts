import { describe, expect, it } from 'vitest';
import type { ActivityDetail } from '../packages/contracts/src';
import { applicantA, applicantB, applicationDetail, applicationSegment } from './application-fixtures';
import { InvitationTemplateError, invitationTemplateModel, MAX_TEMPLATE_CHARACTERS, MAX_TEMPLATE_SEGMENTS } from '../apps/miniprogram/src/features/invitation-template/model';

function detail(): ActivityDetail {
  const d = applicationDetail();
  d.segments[0].counts = { occupied_count: 3, accepted_count: 2, pending_acceptance_count: 1,
    remaining_capacity: 7, meets_minimum: true, is_full: false };
  d.segments[0].deadline_at = '2030-01-01T12:00:00Z';
  return d;
}
function clock(d: ActivityDetail, time: string) {
  d.server_time = time;
  for (const s of d.segments) {
    s.has_started = Date.parse(time) >= Date.parse(s.starts_at);
    s.is_join_open = !d.cancelled_at && !s.cancelled_at && !s.has_started
      && Date.parse(time) < Date.parse(s.deadline_at) && s.counts.remaining_capacity > 0;
  }
}
const model = (d = detail(), id?: string) => invitationTemplateModel(d, id);
const invalid = (d: ActivityDetail) => {
  expect(() => model(d)).toThrowError('INVALID_PUBLIC_SNAPSHOT');
  try { model(d); } catch (e) { expect(e).toBeInstanceOf(InvitationTemplateError); }
};

describe('WG07 fixed invitation template public model', () => {
  it('renders an explicitly fixed editable factual template, with no AI/booking/seat promise', () => {
    const m = model();
    expect(m.mode).toBe('fixed_template');
    for (const text of ['本入口未接 AI 文案服务', '可自行编辑', '活动：离线活动', '离线环节（主环节）',
      '占位 3 / 上限 10', '已接受本版 2', '保位待接受 1', '快照余位：7', '不是实时余位或占位承诺',
      '费用：待确认（不是免费）', '组织者审批', '复制这段文字不会自动分享或报名', '以活动内最新状态为准']) expect(m.text).toContain(text);
    expect(m.snapshotAt).toBe('2030-01-01T00:00:00.000Z');
    expect(m.nextBoundaryAt).toBe('2030-01-01T12:00:00.000Z');
    expect(m.path).toBe(`/pages/activity/index?id=${detail().activity_id}`);
    expect(m.text).not.toContain('/pages/');
  });
  it('does not read or serialize private fields, application names, requirements or source_url', () => {
    const d = detail() as any;
    for (const key of ['viewer', 'applications', 'private_origin', 'roster', 'answers']) Object.defineProperty(d, key, { get() { throw Error(`PRIVATE_${key}`); } });
    Object.defineProperty(d.segments[0], 'requirements', { get() { throw Error('PRIVATE_REQUIREMENTS'); } });
    Object.defineProperty(d.segments[0].location, 'source_url', { get() { throw Error('PRIVATE_SOURCE_URL'); } });
    const m = model(d);
    expect(JSON.stringify(m)).not.toMatch(/PRIVATE_|viewer|applications|source_url|requirements|private_origin/);
    expect(JSON.stringify(m)).not.toContain(applicantA);
  });
  it('has identical facts/key for guest, owner and unrelated private profile changes', () => {
    const d = detail(), before = model(d);
    d.viewer = { user_id: null, is_manager: false, participations: [], applications: [] };
    (d as any).profile = { birth_date: 'PRIVATE_BIRTH', nickname: 'PRIVATE_NAME' };
    expect(model(d)).toEqual(before);
  });
  it('reads only explicit public count fields and no extra nested payload', () => {
    const d = detail() as any;
    d.segments[0].counts.members = [{ name: 'PRIVATE_MEMBER' }];
    d.segments[0].fee.private_order_id = 'PRIVATE_ORDER';
    expect(JSON.stringify(model(d))).not.toContain('PRIVATE_');
  });
  it('canonicalizes uppercase UUIDs and adds only a supplied verified outgoing invitation UUID', () => {
    const d = detail(); d.activity_id = d.activity_id.toUpperCase(); d.main_segment_id = d.main_segment_id.toUpperCase();
    d.segments[0].segment_id = d.segments[0].segment_id.toUpperCase();
    const m = model(d, applicantB.toUpperCase());
    expect(m.path).toBe(`/pages/activity/index?id=${d.activity_id.toLowerCase()}&invitation_id=${applicantB}`);
    expect(m.text).not.toContain(applicantB);
    expect(m.sourceKey).not.toEqual(model(detail()).sourceKey);
  });
  it.each(['https://example.invalid/id', 'uuid&token=PRIVATE', '', '/pages/activity/index?id=x'])('rejects invalid outgoing identity %s', id => {
    expect(() => model(detail(), id)).toThrowError('INVALID_PUBLIC_SNAPSHOT');
  });
  it('uses explicit UTC independently of device timezone or unavailable Intl', () => {
    const d = detail(); d.timezone = 'America/New_York';
    d.segments[0].starts_at = '2030-01-02T08:00:00+08:00';
    const before = model(d);
    const original = globalThis.Intl;
    try {
      (globalThis as any).Intl = undefined;
      expect(model(d)).toEqual(before);
    } finally { (globalThis as any).Intl = original; }
    expect(before.text).toContain('2030-01-02 00:00:00 UTC');
    expect(before.text).toContain('2030-01-01 12:00:00 UTC');
    expect(before.text).not.toContain('America/New_York');
  });
  it.each([['per_person', '每人'], ['total', '环节总价'], ['per_hour', '每小时']] as const)('keeps %s fee units and reference-price disclaimer', (kind, unit) => {
    const d = detail(); d.segments[0].fee = { kind, amount_cents: 12345, currency: 'CNY', note: '仅参考报价' };
    expect(model(d).text).toContain(`¥123.45 / ${unit}（非订单价，非已付款）`);
    expect(model(d).text).toContain('费用说明：仅参考报价');
  });
  it('does not equate a zero stated reference fee with a confirmed free order', () => {
    const d = detail(); d.segments[0].fee = { kind: 'total', amount_cents: 0, currency: 'CNY', note: '' };
    expect(model(d).text).toContain('¥0.00 / 环节总价（非订单价，非已付款）');
  });
  it('labels manual verification and booking accurately', () => {
    const d = detail(); d.segments[0].verification_status = 'manual_checked'; d.segments[0].booking_status = 'manual_booked';
    expect(model(d).text).toContain('人工标记已核实（不是供应商实时核验）');
    expect(model(d).text).toContain('人工标记已预订（不等于供应商确认或付款凭证）');
  });
  it.each(['activity', 'segment'] as const)('%s cancellation shows history, never advertises available seats', target => {
    const d = detail(); if (target === 'activity') d.cancelled_at = d.server_time; else d.segments[0].cancelled_at = d.server_time;
    clock(d, d.server_time); const m = model(d);
    expect(m.text).toContain('已取消，不开放报名'); expect(m.text).toContain('人数仅为历史记录');
    expect(m.text).toContain('原同版接受 2，原未接受 1');
    expect(m.text).toContain('不代表当前保位或待接受');
    expect(m.text).not.toContain('保位待接受'); expect(m.text).not.toContain('已接受本版');
    expect(m.text).not.toContain('快照余位'); expect(m.nextBoundaryAt).toBeNull();
  });
  it.each([
    ['2030-01-01T12:00:00Z', '报名已截止', '2030-01-02T00:00:00.000Z'],
    ['2030-01-02T00:00:00Z', '环节已开始', '2030-01-02T12:00:00.000Z'],
    ['2030-01-02T12:00:00Z', '环节已结束', null],
  ] as const)('honours exact boundary %s', (now, label, next) => {
    const d = detail(); clock(d, now); const m = model(d);
    expect(m.text).toContain(`${label}，不开放报名`); expect(m.text).not.toContain('快照余位'); expect(m.nextBoundaryAt).toBe(next);
  });
  it('full means occupied includes reserved pending acceptance, not accepted-only', () => {
    const d = detail(); d.segments[0].counts = { occupied_count: 10, accepted_count: 2, pending_acceptance_count: 8,
      remaining_capacity: 0, meets_minimum: true, is_full: true }; clock(d, d.server_time);
    expect(model(d).text).toContain('人数已满，不开放报名'); expect(model(d).text).not.toContain('快照余位');
  });
  it('preserves all valid segments, sorts by position, and allows repeated public names', () => {
    const d = detail(); d.segments.push({ ...structuredClone(d.segments[0]), segment_id: applicantB, position: 1 });
    d.segments.reverse();
    const text = model(d).text;
    expect(text.indexOf('1. 离线环节（主环节）')).toBeLessThan(text.indexOf('2. 离线环节'));
    expect(text.match(/人数快照：/g)).toHaveLength(2);
  });
  it('does not advertise cancelled segment seats while other segments stay open', () => {
    const d = detail(); d.segments.push({ ...structuredClone(d.segments[0]), segment_id: applicantB, position: 1, name: '已取消第二段', cancelled_at: d.server_time, is_join_open: false });
    const text = model(d).text;
    expect(text.match(/快照余位：/g)).toHaveLength(1);
    expect(text).toContain('2. 已取消第二段');
  });
  it('ignores clock-only refresh for source identity, while recording a newer capture time', () => {
    const d = detail(), before = model(d); clock(d, '2030-01-01T00:01:00Z'); const after = model(d);
    expect(after.sourceKey).toBe(before.sourceKey); expect(after.text).not.toBe(before.text);
    expect(after.snapshotAt).not.toBe(before.snapshotAt); expect(after.nextBoundaryAt).toBe(before.nextBoundaryAt);
  });
  it('changes source identity at each material time phase', () => {
    const d = detail(), keys = [model(d).sourceKey];
    for (const now of ['2030-01-01T12:00:00Z', '2030-01-02T00:00:00Z', '2030-01-02T12:00:00Z']) { clock(d, now); keys.push(model(d).sourceKey); }
    expect(new Set(keys).size).toBe(4);
  });
  it.each(['name', 'revision', 'location', 'price', 'fee-note', 'booking', 'verification', 'counts', 'deadline', 'plan'] as const)('invalidates source identity for material %s', kind => {
    const d = detail(), before = model(d).sourceKey;
    if (kind === 'name') d.name = '新活动';
    if (kind === 'revision') d.revision++;
    if (kind === 'location') d.segments[0].location.address = '新公开地点';
    if (kind === 'price') d.segments[0].fee = { kind: 'total', amount_cents: 100, currency: 'CNY', note: '' };
    if (kind === 'fee-note') d.segments[0].fee.note = '新的公开说明';
    if (kind === 'booking') d.segments[0].booking_status = 'manual_booked';
    if (kind === 'verification') d.segments[0].verification_status = 'manual_checked';
    if (kind === 'counts') { d.segments[0].counts.accepted_count++; d.segments[0].counts.pending_acceptance_count--; }
    if (kind === 'deadline') d.segments[0].deadline_at = '2030-01-01T13:00:00Z';
    if (kind === 'plan') d.segments[0].plan_revision++;
    expect(model(d).sourceKey).not.toBe(before);
  });
  it.each(['remaining', 'accepted', 'minimum', 'meets-minimum', 'full', 'started', 'open', 'fraction', 'unsafe', 'negative'] as const)('rejects inconsistent %s facts without guessing', kind => {
    const d = detail(), s = d.segments[0], c = s.counts;
    if (kind === 'remaining') c.remaining_capacity--;
    if (kind === 'accepted') c.accepted_count++;
    if (kind === 'minimum') s.minimum_participants = 11;
    if (kind === 'meets-minimum') c.meets_minimum = false;
    if (kind === 'full') c.is_full = true;
    if (kind === 'started') s.has_started = true;
    if (kind === 'open') s.is_join_open = false;
    if (kind === 'fraction') c.accepted_count = 1.5;
    if (kind === 'unsafe') c.occupied_count = Number.MAX_SAFE_INTEGER + 1;
    if (kind === 'negative') c.occupied_count = -1;
    invalid(d);
  });
  it.each(['missing-main', 'empty', 'duplicate-id', 'duplicate-position', 'reversed-time', 'late-deadline', 'bad-date', 'blank-name', 'blank-place'] as const)('rejects %s invalid public snapshots', kind => {
    const d = detail();
    if (kind === 'missing-main') d.main_segment_id = applicantB;
    if (kind === 'empty') d.segments = [];
    if (kind === 'duplicate-id') d.segments.push({ ...d.segments[0], position: 1 });
    if (kind === 'duplicate-position') d.segments.push({ ...d.segments[0], segment_id: applicantB });
    if (kind === 'reversed-time') d.segments[0].ends_at = d.segments[0].starts_at;
    if (kind === 'late-deadline') d.segments[0].deadline_at = d.segments[0].ends_at;
    if (kind === 'bad-date') d.server_time = 'not-a-date';
    if (kind === 'blank-name') d.name = '\n\u202e';
    if (kind === 'blank-place') d.segments[0].location.name = '  ';
    invalid(d);
  });
  it('fails closed at segment or text limits instead of silently omitting facts', () => {
    const d = detail(); d.segments = Array.from({ length: MAX_TEMPLATE_SEGMENTS + 1 }, () => d.segments[0]);
    expect(() => model(d)).toThrowError('TEMPLATE_TOO_LARGE');
    d.segments = detail().segments; d.name = '长'.repeat(MAX_TEMPLATE_CHARACTERS);
    expect(() => model(d)).toThrowError('TEMPLATE_TOO_LARGE');
    expect(d.name).toHaveLength(MAX_TEMPLATE_CHARACTERS);
  });
  it('never truncates an included title or mutates the original snapshot', () => {
    const d = detail(); d.name = '长标题'.repeat(40); const copy = structuredClone(d);
    expect(model(d).text).toContain(d.name); expect(d).toEqual(copy);
  });
  it('uses the editor UTF-16 length limit for non-BMP text instead of counting emoji as one unit', () => {
    const d = detail(); d.name = '😀'.repeat(MAX_TEMPLATE_CHARACTERS / 2);
    expect(Array.from(d.name).length).toBe(MAX_TEMPLATE_CHARACTERS / 2);
    expect(d.name.length).toBe(MAX_TEMPLATE_CHARACTERS);
    expect(() => model(d)).toThrowError('TEMPLATE_TOO_LARGE');
    expect(d.name).toBe('😀'.repeat(MAX_TEMPLATE_CHARACTERS / 2));
  });
  it('keeps markup literal and replaces layout/bidi controls rather than adding forged lines', () => {
    const d = detail(); d.name = '<b>公开标题</b>\n假行\u202e';
    expect(model(d).text).toContain('活动：<b>公开标题</b> 假行');
    expect(model(d).text).not.toMatch(/\u202e/);
    expect(model(d).text).not.toContain('\n假行');
  });
  it('turns invalid runtime/getter errors into fixed safe errors only', () => {
    const d = detail(); Object.defineProperty(d, 'name', { get() { throw Error('PRIVATE_ERROR_DETAIL'); } });
    expect(() => model(d)).toThrowError('INVALID_PUBLIC_SNAPSHOT');
    expect(() => model(d)).not.toThrowError('PRIVATE_ERROR_DETAIL');
  });
  it('equivalent offset timestamps preserve the source key', () => {
    const d = detail(), before = model(d);
    d.segments[0].starts_at = '2030-01-02T08:00:00+08:00';
    expect(model(d).sourceKey).toBe(before.sourceKey);
    expect(model(d).text).toBe(before.text);
    expect(model(d).sourceKey).toContain(applicationSegment);
  });
});
