/// <reference path="../../apps/miniprogram/src/assets.d.ts" />
import { useEffect, useState } from '../../apps/miniprogram/node_modules/react';
import { createRoot } from '../../apps/miniprogram/node_modules/react-dom/client';
import { applicationDetail, applicantB, applicationId, applicationSegment } from '../../tests/application-fixtures';
import { ActivityOverview } from '../../apps/miniprogram/src/features/activity-entry/ActivityOverview';
import { ApplicationForm, MyParticipationPanel, ApprovalPanel } from '../../apps/miniprogram/src/features/applications/panels';
import { Action, Notice } from '../../apps/miniprogram/src/components/ui';
import { useApplications } from '../../apps/miniprogram/src/features/applications/use-applications';
import { cardLayout, activityCardModel } from '../../apps/miniprogram/src/features/share-card/model';
import { renderActivityCard } from '../../apps/miniprogram/src/features/share-card/canvas';
import { getToken, Canvas } from './invitation-preview-platform';
const mode = new URLSearchParams(location.search).get('view') || 'participant';
const detail = applicationDetail();
detail.name = mode === 'long' ? '这个周末一起去打羽毛球然后在老街吃火锅聊聊最近的生活与旅行计划吧！' : '周末一起打球！';
detail.viewer.is_manager = mode === 'manager';
if (mode === 'guest') detail.viewer.user_id = null;
detail.server_time = '2030-01-01T00:00:00Z';
detail.segments[0] = { ...detail.segments[0], name: '羽毛球', starts_at: '2030-01-05T06:00:00Z', ends_at: '2030-01-05T08:00:00Z', deadline_at: '2030-01-04T12:00:00Z', capacity: 8, minimum_participants: 4, location: { name: '城市运动中心', address: '示例路 88 号 · 二层羽毛球馆（离线样例）', source_url: null }, fee: { kind: 'per_person', amount_cents: 3500, currency: 'CNY', note: '场地参考费用，实际以组织者确认为准' }, counts: { occupied_count: 5, accepted_count: 4, pending_acceptance_count: 1, remaining_capacity: 3, meets_minimum: true, is_full: false } };
detail.segments.push({ ...detail.segments[0], segment_id: applicantB, client_ref: 'dinner', position: 1, name: '晚上聚餐', starts_at: '2030-01-05T09:00:00Z', ends_at: '2030-01-05T11:00:00Z', location: { name: '老街火锅店（离线样例）', address: null, source_url: null }, fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, counts: { occupied_count: 3, accepted_count: 3, pending_acceptance_count: 0, remaining_capacity: 5, meets_minimum: false, is_full: false } });
if (mode === 'pending') detail.viewer.applications = [{ application_id: applicationId, applicant_user_id: detail.viewer.user_id!, display_name: '周末小周', status: 'pending', segments: [{ segment_id: applicationSegment, plan_revision: 1 }], created_at: detail.server_time, decided_at: null }];
if (mode === 'participant' || mode === 'changed') detail.viewer.participations = [{ segment_id: applicationSegment, status: mode === 'changed' ? 'awaiting_acceptance' : 'joined', accepted_plan_revision: 1 }];
if (mode === 'cancelled') { detail.cancelled_at = detail.server_time; detail.segments.forEach(s => { s.is_join_open = false; }); }
if (mode === 'manager') detail.applications = [{ application_id: applicationId, applicant_user_id: applicantB, display_name: '小周', status: 'pending', segments: [{ segment_id: applicationSegment, plan_revision: 1 }], created_at: detail.server_time, decided_at: null }];
function Preview() {
  const [section, setSection] = useState('overview');
  const [notice, setNotice] = useState('');
  useEffect(()=>{if(new URLSearchParams(location.search).get('expanded')==='1'){setTimeout(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.startsWith('查看完整安排'))?.click();},100);}},[]);
  const state = useApplications({ id: detail.activity_id, detail, session: getToken(), fresh: true, refresh: async () => {} });
  const login = {busy:false, login:async()=>{setNotice('离线预览不执行微信登录；实际小程序将调用真实微信登录。');}};
  return <div className="screen activity-page activity-invitation-page">
    {section !== 'overview' && <Action onClick={()=>setSection('overview')}>返回活动</Action>}
    {notice && <Notice>{notice}</Notice>}
    {section === 'overview' && <><ActivityOverview suggest={()=>setSection('suggestions')} detail={detail} busy={false} open={setSection} retrySource={()=>{}} refresh={()=>setNotice('离线示例没有调用共享服务。')} sourceId={applicationId} source={{invitation_id:applicationId,activity_id:detail.activity_id,title:detail.name,inviter_display_name:'小林（离线示例）',inviter_avatar_url:null,starts_at:null,ends_at:null,timezone:'Asia/Shanghai',cancelled:!!detail.cancelled_at,source_only:true}}/></>}
    {section === 'apply' && <ApplicationForm detail={detail} state={state} login={login}/>}
    {section === 'participation' && <MyParticipationPanel detail={detail} state={state}/>}
    {section === 'approval' && <ApprovalPanel detail={detail} state={state}/>}
    {section === 'arrangement' && <Notice>此示例展示有安排变更时的优先入口。真实页面保留原有差异审阅及重新接受流程。</Notice>}
    {section === 'suggestions' && <Notice>实际小程序打开已有需求页；填写需求不等于报名，私人文字仅本人可见。</Notice>}
    {section === 'invitation' && <><CardPreview/><Notice>报名二维码尚未接入，实际页面提供生成图片、保存相册和微信原生分享入口。离线预览不执行相册或分享操作。</Notice></>}
  </div>;
}
function CardPreview() {
  const card = activityCardModel(detail), layout = cardLayout(card);
  const [image, setImage] = useState('');
  useEffect(() => { void renderActivityCard(card, () => {}, 'preview-card').then(() => setImage((document.getElementById('preview-card') as HTMLCanvasElement).toDataURL())); }, []);
  return <><Canvas id="preview-card" style={{ position: 'fixed', left: '-10000px', width: `${layout.width}px`, height: `${layout.height}px` }}/>{image && <img src={image} style={{ width: '100%', display: 'block' }}/>}</>;
}
createRoot(document.getElementById('root')!).render(mode === 'card' ? <CardPreview/> : <Preview/>);
