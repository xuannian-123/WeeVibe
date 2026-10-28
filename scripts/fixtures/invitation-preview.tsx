/// <reference path="../../apps/miniprogram/src/assets.d.ts" />
import { useEffect, useState } from '../../apps/miniprogram/node_modules/react';
import { createRoot } from '../../apps/miniprogram/node_modules/react-dom/client';
import { applicationDetail, applicantB, applicationId, applicationSegment } from '../../tests/application-fixtures';
import { InvitationOverview } from '../../apps/miniprogram/src/features/activity-entry/InvitationOverview';
import { useApplications } from '../../apps/miniprogram/src/features/applications/use-applications';
import { cardLayout, activityCardModel } from '../../apps/miniprogram/src/features/share-card/model';
import { renderActivityCard } from '../../apps/miniprogram/src/features/share-card/canvas';
import { getToken, Canvas } from './invitation-preview-platform';
const mode = new URLSearchParams(location.search).get('view') || 'participant';
const detail = applicationDetail();
detail.name = mode === 'long' ? '这个周末一起去打羽毛球然后在老街吃火锅聊聊最近的生活与旅行计划吧！' : '周末见！打场球，再一起吃饭';
detail.viewer.is_manager = mode === 'manager';
if (mode === 'guest') detail.viewer.user_id = null;
detail.server_time = '2030-01-01T00:00:00Z';
detail.segments[0] = { ...detail.segments[0], name: '羽毛球，轻松开打', starts_at: '2030-01-05T06:00:00Z', ends_at: '2030-01-05T08:00:00Z', deadline_at: '2030-01-04T12:00:00Z', capacity: 8, minimum_participants: 4, location: { name: '城市运动中心', address: '示例路 88 号 · 二层羽毛球馆（离线样例）', source_url: null }, fee: { kind: 'per_person', amount_cents: 3500, currency: 'CNY', note: '场地参考费用，实际以组织者确认为准' }, counts: { occupied_count: 5, accepted_count: 4, pending_acceptance_count: 1, remaining_capacity: 3, meets_minimum: true, is_full: false } };
detail.segments.push({ ...detail.segments[0], segment_id: applicantB, client_ref: 'dinner', position: 1, name: '老街火锅，边吃边聊', starts_at: '2030-01-05T09:00:00Z', ends_at: '2030-01-05T11:00:00Z', location: { name: '老街火锅店（离线样例）', address: null, source_url: null }, fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, counts: { occupied_count: 3, accepted_count: 3, pending_acceptance_count: 0, remaining_capacity: 5, meets_minimum: false, is_full: false } });
if (mode === 'participant') detail.viewer.applications = [{ application_id: applicationId, applicant_user_id: detail.viewer.user_id!, display_name: '周末小水豚', status: 'pending', segments: [{ segment_id: applicationSegment, plan_revision: 1 }], created_at: detail.server_time, decided_at: null }];
function Preview() {
  const state = useApplications({ id: detail.activity_id, detail, session: getToken(), fresh: true, refresh: async () => {} });
  return <div className="screen activity-page"><InvitationOverview detail={detail} session={getToken()} state={state} login={{ busy: false, login: async () => {} }} fresh anyBusy={false} refresh={async () => {}}/></div>;
}
function CardPreview() {
  const card = activityCardModel(detail), layout = cardLayout(card);
  const [image, setImage] = useState('');
  useEffect(() => { void renderActivityCard(card, () => {}, 'preview-card').then(() => setImage((document.getElementById('preview-card') as HTMLCanvasElement).toDataURL())); }, []);
  return <><Canvas id="preview-card" style={{ position: 'fixed', left: '-10000px', width: `${layout.width}px`, height: `${layout.height}px` }}/>{image && <img src={image} style={{ width: '100%', display: 'block' }}/>}</>;
}
createRoot(document.getElementById('root')!).render(mode === 'card' ? <CardPreview/> : <Preview/>);
