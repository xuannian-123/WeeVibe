import { describe, expect, it } from 'vitest';
import { formFromAiDraft } from '../apps/miniprogram/src/features/activity-create/ai-form';
import { buildCreateInput, emptyForm, isActivityForm, selectedVenueUrl } from '../apps/miniprogram/src/features/activity-create/form';
import type { AiCreationDraft, VenueSelection } from '../packages/contracts/src';

const venue: VenueSelection = { name: '朋友球馆', address: '测试路1号', location: { longitude: 121.451445, latitude: 31.227973, crs: 'GCJ-02' },
  source: { provider: 'amap', source_api: 'https://restapi.amap.com/v5/place/text', checked_at: '2026-10-25T10:00:00Z' } };
function filledForm() {
  const form = emptyForm(); form.name = '打球';
  Object.assign(form.segments[0], { startDate: '2026-10-30', startTime: '14:00', endTime: '16:00', minimum: '4', capacity: '6', place: venue.name, address: venue.address, venue });
  return form;
}
describe('AI and AMap editable form integration', () => {
  it('preserves chosen coordinates in a public source URL without adding credentials or changing fees', () => {
    const form = filledForm(); const input = buildCreateInput(form, 'fixture-create-map');
    expect(input.segments[0].location.source_url).toContain('121.451445,31.227973');
    expect(input.segments[0].location).toMatchObject({ name: venue.name, address: venue.address });
    expect(input.segments[0].fee).toMatchObject({ kind: 'unknown', amount_cents: null });
    expect(new URL(input.segments[0].location.source_url!).searchParams.get('name')).toBe(venue.name);
  });
  it('does not carry stale map evidence after manual name/address changes and reads legacy drafts', () => {
    const form = filledForm();
    expect(isActivityForm(JSON.parse(JSON.stringify(form)))).toBe(true);
    form.segments[0].place = '另一个集合点'; expect(selectedVenueUrl(form.segments[0])).toBeNull();
    form.segments[0].place = venue.name; form.segments[0].address = '另一个地址'; expect(selectedVenueUrl(form.segments[0])).toBeNull();
    delete form.segments[0].venue; expect(isActivityForm(form)).toBe(true);
    expect(isActivityForm({ ...form, segments: [{ ...form.segments[0], venue: { ...venue, location: { longitude: 31, latitude: 121, crs: 'GCJ-02' } } }] })).toBe(false);
  });
  it('creates new local refs, preserves the nickname, and requires fresh personal participation and fee decisions', () => {
    const segment = { ref: 's1', type: 'sport' as const, name: '打球', starts_at: '2026-10-30T06:00:00Z', ends_at: null, deadline_at: null, location: null, minimum: null, capacity: null, fee_minor: 0 };
    const draft: AiCreationDraft = { source_revision: 1, apply_intent: false, publishable: false, name: '打球聚餐', primary_segment_ref: 's2',
      segments: [segment, { ...segment, ref: 's2', type: 'dinner', name: '聚餐', starts_at: null }], missing_fields: [], unknowns: [] };
    const form = formFromAiDraft(draft, '小明');
    expect(form.nickname).toBe('小明'); expect(form.attending).toEqual([]);
    expect(form.mainRef).toBe(form.segments[1].ref); expect(form.mainRef).not.toBe('s2');
    expect(form.segments[0]).toMatchObject({ startDate: '2026-10-30', startTime: '14:00', endTime: '', place: '', minimum: '', capacity: '', feeUnit: 'unknown', amount: '' });
    expect(form.segments[1].startDate).toBe('');
    expect(() => buildCreateInput(form, 'fixture-create-ai')).toThrow();
  });
});
