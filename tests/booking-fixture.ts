import { vi } from 'vitest';
import { createDeadlineFixture, deadlineIds as I } from './deadline-fixture';
import { selectFields } from './handover-fixture';
export { deadlineIds as bookingIds } from './deadline-fixture';
export function createBookingFixture(history = false) {
  const f = createDeadlineFixture(history);
  f.activity.segments[0].bookingStatus = 'unknown';
  f.tx.segment.findFirst = vi.fn(async ({where,select}:any) => selectFields(f.activity.segments.find((s:any)=>s.id===where.id&&s.activityId===where.activityId)??null,select));
  f.tx.segment.updateMany = vi.fn(async ({where,data}:any) => { const row=f.activity.segments.find((s:any)=>Object.entries(where).every(([key,value])=>s[key]===value));if(!row)return{count:0};Object.assign(row,structuredClone(data));return{count:1}; });
  f.tx.activityEvent.findMany = vi.fn(async ({where,take,select}:any) => f.events.filter((e:any)=>e.activityId===where.activityId&&e.type===where.type&&e.detail.segment_id===where.detail.equals).sort((a:any,b:any)=>a.revision-b.revision).slice(0,take).map((e:any)=>selectFields(e,select)));
  return f;
}
