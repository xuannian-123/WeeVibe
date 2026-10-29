import { describe, expect, it } from 'vitest';
import { applicationDetail } from './application-fixtures';
import { formFromArrangement, editInputFromForm } from '../apps/miniprogram/src/features/arrangement-change/edit-form';
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/arrangement-edit/route';
describe('published arrangement editor mapping and HTTP authorization', () => {
  it('retains a newly selected coordinate even when the displayed name and address are unchanged',()=>{
    const detail=applicationDetail();detail.timezone='Asia/Shanghai';detail.segments[0].location.source_url='https://example.org/old-point';
    const form=formFromArrangement(detail),segment=form.segments[0];
    segment.venue={name:segment.place,address:segment.address||null,location:{latitude:31.2,longitude:120.3,crs:'GCJ-02'},source:{provider:'wechat',source_api:'wx.chooseLocation'}};
    expect(editInputFromForm(detail,form,'edit-native-map').segments[0].location.source_url).toContain('120.3,31.2');
  });
  it('preserves exact original seconds and map source when no time/place was edited', () => {
    const detail = applicationDetail(); detail.timezone = 'Asia/Shanghai'; detail.segments[0].starts_at = '2030-01-02T11:00:33.123Z';
    detail.segments[0].location.source_url = 'https://example.org/venue';
    const input = editInputFromForm(detail, formFromArrangement(detail), 'edit-form-key');
    expect(input.segments[0].starts_at).toBe(detail.segments[0].starts_at);
    expect(input.segments[0].location.source_url).toBe('https://example.org/venue');
  });
  it('does not silently carry original venue evidence to a newly typed location', () => {
    const detail = applicationDetail(); detail.timezone = 'Asia/Shanghai'; detail.segments[0].location.source_url = 'https://example.org/old';
    const form = formFromArrangement(detail); form.segments[0].place = 'New venue';
    expect(editInputFromForm(detail, form, 'edit-form-key').segments[0].location.source_url).toBeNull();
  });
  it('rejects anonymous/forged management for preview and actual writes', async () => {
    for (const suffix of ['', '?preview=1']) {
      const detail = applicationDetail();
      const response = await POST(new Request(`http://localhost/api/v1/activities/${detail.activity_id}/arrangement-edit${suffix}`, {
        method: 'POST', headers: { 'x-wx-openid': 'forged' }, body: '{}' }), { params: Promise.resolve({ activityId: detail.activity_id }) });
      expect(response.status).toBe(401);
    }
  });
});
