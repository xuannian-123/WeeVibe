import { describe, it, expect } from 'vitest';
import { applicationDetail, applicantA, applicantB } from './application-fixtures';
import { activityCardModel, cardLayout, MAX_CARD_HEIGHT, QR_UNAVAILABLE } from '../apps/miniprogram/src/features/share-card/model';

describe('WG08 explicit public projection', () => {
 it('retains only public itinerary and valid invitation provenance; never carries private rows or URLs', () => {
  const d = applicationDetail(); const value = d as any;
  value.private_origin = 'SECRET_ORIGIN'; value.roster = [{name:'SECRET_MEMBER'}]; value.answers=['SECRET_ANSWER'];
  d.viewer.applications = [{secret:'SECRET_APPLICATION'} as any]; d.applications = [{secret:'SECRET_MANAGEMENT'} as any];
  d.segments[0].location.source_url = 'https://example.invalid/SECRET_URL';
  const card = activityCardModel(d, applicantB); const text = JSON.stringify(card);
  for (const forbidden of ['SECRET_', 'viewer', 'applications', 'roster', 'counts', applicantA]) expect(text).not.toContain(forbidden);
  expect(card.path).toBe(`/pages/activity/index?id=${d.activity_id}&invitation_id=${applicantB}`);
  expect(card.qrStatus).toBe('NOT_CONFIGURED');
 });
 it('never turns unknown fees into free, or total/hourly prices into per-person prices', () => {
  const d=applicationDetail(); expect(activityCardModel(d).segments[0].fee).toContain('不是免费');
  d.segments[0].fee={kind:'total',amount_cents:10000,currency:'CNY',note:''};
  expect(activityCardModel(d).segments[0].fee).toBe('参考 ¥100.00 / 环节总价（非已付款）');
  d.segments[0].fee.kind='per_hour';expect(activityCardModel(d).segments[0].fee).toContain('/ 每小时');
 });
 it('labels cancellation, verification, booking, timezone and snapshot rather than real-time seats', () => {
  const d=applicationDetail(); d.cancelled_at=d.server_time;d.segments[0].cancelled_at=d.server_time;
  const text=cardLayout(activityCardModel(d)).lines.map(x=>x.text).join('');
  for(const expected of ['活动已取消','已取消','地点未核实','预订未确认','UTC+8','快照','不是报名凭证',QR_UNAVAILABLE])expect(text).toContain(expected);
  expect(text).not.toContain('余10'); expect(text).not.toContain('已成局');
 });
 it('includes every segment in order and displays UTC dates in explicit Beijing time', () => {
  const d=applicationDetail();d.segments.push({...d.segments[0],segment_id:applicantB,name:'第二公开环节'});
  const card=activityCardModel(d);const layout=cardLayout(card);
  expect(card.segments).toHaveLength(2);expect(card.segments[0].startsAt).toBe('2030-01-02 08:00');
  expect(layout.lines.map(x=>x.text).join('')).toContain('2. 第二公开环节');
  expect(layout.height).toBeLessThanOrEqual(MAX_CARD_HEIGHT);
 });
 it('rejects malformed public invitation IDs rather than passing private query strings',()=>{
  expect(()=>activityCardModel(applicationDetail(),'token=SECRET')).toThrow();
 });
 it('bounds summary strings with explicit ellipsis, strips control/bidi chars and wraps unicode',()=>{
  const d=applicationDetail();d.name='公开\u202e\n'+ '长😀'.repeat(120);
  const card=activityCardModel(d);expect(Array.from(card.name)).toHaveLength(100);expect(card.name).not.toContain('\u202e');expect(card.name.endsWith('…')).toBe(true);
  const layout=cardLayout(card);expect(layout.lines.filter(x=>x.size===36).length).toBeGreaterThan(1);
  expect(layout.lines.every(x=>x.y<layout.height)).toBe(true);
 });
 it('fails closed for too many segments instead of silently dropping any itinerary',()=>{
  const d=applicationDetail();d.segments=Array.from({length:100},()=>d.segments[0]);
  expect(()=>cardLayout(activityCardModel(d))).toThrow('CARD_TOO_LARGE');
  d.segments=[];expect(()=>cardLayout(activityCardModel(d))).toThrow('CARD_TOO_LARGE');
 });
 it('public content changes invalidate a card while private row changes cannot alter its pixels',()=>{
  const d=applicationDetail();const before=JSON.stringify(activityCardModel(d));
  d.viewer.user_id=applicantB;d.viewer.is_manager=false;d.segments[0].counts.occupied_count=9;
  expect(JSON.stringify(activityCardModel(d))).toBe(before);
  d.segments[0].location.name='新地点';expect(JSON.stringify(activityCardModel(d))).not.toBe(before);
 });
 it('gives every segment a bounded rounded card and emphasizes the real main segment',()=>{
  const d=applicationDetail();d.name='长中文标题'.repeat(15);d.segments=Array.from({length:4},(_,index)=>({...d.segments[0],name:`第${index+1}段：长名称与地址`,segment_id:index?applicantB:d.main_segment_id}));
  const layout=cardLayout(activityCardModel(d));expect(layout.blocks).toHaveLength(5);
  expect(layout.blocks[0].color).toBe('#A7F05A');expect(layout.blocks[1].color).toBe('#eee8fc');
  expect(layout.blocks.slice(2).every(block=>block.color==='#ffffff')).toBe(true);
  expect(layout.blocks.every(block=>block.y+block.height<layout.height&&block.radius>0)).toBe(true);
  expect(layout.lines.every(line=>line.y<layout.height)).toBe(true);
 });
});
