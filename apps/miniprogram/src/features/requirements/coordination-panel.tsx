import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import type { CoordinationContext, RequirementSnapshot } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { readCoordination } from './coordination-read';
import { beijingLabel } from './answer-state';

/** Read-only preparation. Suggestions and application remain unavailable in C1. */
export function CoordinationPanel({ snapshot }: { snapshot: RequirementSnapshot }) {
  const [context, setContext] = useState<CoordinationContext>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const session = getToken();
  const { collection, viewer } = snapshot;
  // Include answer updates from parent refreshes, even when collection revision is unchanged.
  const source = JSON.stringify(snapshot);
  const identity = `${session}:${collection.id}:${source}`;
  const latest = useRef(identity); latest.current = identity;
  useEffect(() => {
    generation.current++; lock.current = false;
    setContext(undefined); setNotice(''); setBusy(false);
    return () => { generation.current++; };
  }, [identity]);
  const eligible = viewer.is_manager && !!snapshot.manager && collection.status !== 'draft';
  if (!eligible) return null;
  const supported = collection.kind === 'friend' && !!collection.activity_id;
  async function refresh() {
    if (lock.current || !supported || !session || getToken() !== session) return;
    lock.current = true; setBusy(true); setNotice(''); setContext(undefined);
    const ticket = ++generation.current;
    try {
      const next = await readCoordination(collection.id, collection.activity_id!);
      if (ticket === generation.current && latest.current === identity && getToken() === session) setContext(next);
    } catch (e) {
      if (ticket === generation.current && latest.current === identity && getToken() === session) setNotice(e instanceof ApiClientError ? e.message : '协调资料暂时无法读取，请重试；你已填写的需求仍保留。');
    } finally {
      if (ticket === generation.current) { lock.current = false; setBusy(false); }
    }
  }
  return <View className="req-card">
    <Text className="req-heading">AI 协调前核对</Text>
    <Text className="req-muted">先收集需求，再核对人数与安排。AI 时间建议暂未开放，你仍可参考统计人工记录最终选择。</Text>
    {!supported ? <Text className="req-muted">{collection.kind === 'team' ? '团建可继续分享和收集需求，AI 协调暂未接通。' : '独立筹备尚未关联正式活动，暂不能核对席位；定案后可继续创建正式活动。'}</Text> : <Button className="req-button secondary" disabled={busy} loading={busy} onClick={() => void refresh()}>{busy ? '正在核对…' : '核对协调资料'}</Button>}
    {notice && <View className="req-notice"><Text>{notice}</Text></View>}
    {context && <View>
      <Text className="req-muted">核对时间：{beijingLabel(context.server_time)}。其他成员提交后，请再次核对。</Text>
      <Text className="req-answer-text">已填写 {context.aggregate.respondent_count} 人 · 实际占位 {context.aggregate.joined_people_count} 人 · 跨环节共 {context.aggregate.joined_seat_count} 个席位</Text>
      <Text className="req-muted">填写但未占位 {context.aggregate.respondents_without_active_seats} 人；占位但未填写 {context.aggregate.joined_people_without_response} 人。填写需求不等于报名获批。</Text>
      {context.aggregate.segments.map((segment, index) => <View key={segment.segment_ref}>
        <Text className="req-label">环节 {index + 1} · {{ planned: '未开始', started: '已开始', cancelled: '已取消（历史记录）' }[segment.state]}</Text>
        <Text className="req-muted">意向 {segment.intent_respondent_count} 人 · 占位 {segment.occupied_count} 人 · 已接受 {segment.accepted_count} 人 · 待接受 {segment.pending_acceptance_count} 人</Text>
      </View>)}
      {context.limitations.map((item, index) => <Text className="req-muted" key={index}>{item}</Text>)}
    </View>}
    <Text className="req-muted">定案不代表成员同意或成局。正式安排变更后，受影响成员仍需重新确认；报名获批才占位，成局需管理者明确确认。</Text>
  </View>;
}
