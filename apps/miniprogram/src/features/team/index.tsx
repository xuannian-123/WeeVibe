import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { RequirementList } from '@weevibe/contracts';
import { listRequirements } from '../../platform/requirements-api';
import { getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { beijingLabel } from '../requirements/answer-state';
import '../requirements/requirements.css';

export function TeamCreate({ onClose, kind = 'team' }: { onClose: () => void; kind?: 'friend' | 'team' }) {
  const session = useRef(getToken());
  const [list, setList] = useState<RequirementList>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const epoch = useRef(0), active = useRef(true), mounted = useRef(true);
  const valid = (ticket: number) => mounted.current && active.current && epoch.current === ticket && session.current === getToken();
  async function load() {
    if (!active.current || session.current !== getToken()) return;
    const ticket = ++epoch.current; setBusy(true); setNotice('');
    try { const next = await listRequirements(); if (valid(ticket)) setList(next); }
    catch (error) { if (valid(ticket)) setNotice(errorText(error)); }
    finally { if (valid(ticket)) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; epoch.current++; }; }, []);
  const hide = () => { active.current = false; epoch.current++; setBusy(false); };
  useDidHide(hide); useUnload(hide); useDidShow(() => { active.current = true; void load(); });
  function open(path: string) {
    if (!active.current || !mounted.current || session.current !== getToken()) return;
    void Taro.navigateTo({ url: path }).catch(() => { if (mounted.current && session.current === getToken()) setNotice('页面未能打开，请重试。'); });
  }
  if (!session.current || session.current !== getToken()) return <View className="req-notice">请使用当前微信身份重新打开筹备入口。</View>;
  return <View className="req-page"><Button className="req-back" onClick={onClose}>‹ 返回</Button>
    <Text className="req-title">{kind === 'team' ? '一起，把团建安排好' : '先有想法，再一起安排'}</Text>
    <Text className="req-subtitle">先收需求，再确定时间地点；筹备不等于报名。</Text>
    {notice && <View className="req-notice"><Text>{notice}</Text></View>}
    <Button className="req-button" onClick={() => open(`/pages/requirements/index?new=${kind}`)}>＋ 发起筹备</Button>
    <Button className="req-button secondary" disabled={busy} onClick={() => void load()}>{busy ? '读取中…' : '刷新我的筹备'}</Button>
    {list?.collections.filter(item => item.kind === kind && item.activity_id === null).map(item => <View key={item.id} className="req-card mint" onClick={() => open(`/pages/requirements/index?id=${encodeURIComponent(item.id)}`)}>
      <Text className="req-heading">{item.title || '未命名筹备'}</Text><Text className="req-muted">{item.is_manager ? '我在组织' : '我已填写'} · {item.status === 'draft' ? '草稿' : item.status === 'open' ? '收集中' : item.status === 'finalized' ? '方案已记录' : '已截止'} · 更新于 {beijingLabel(item.updated_at)}</Text>
    </View>)}
    <Text className="req-muted">分享进入后需微信登录；链接可能被转发，不作为原群成员证明。最多显示最近 {list?.limit || 100} 条本人相关记录。</Text>
  </View>;
}
