import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { BRAND_NAME } from '../../brand';
import { activityIdSchema } from '@weego/contracts';
import { api } from '../../platform/api';
import { errorText, requireUser, useLogin, usePageRead } from '../../platform/page-state';
import { recentActivities } from '../../platform/activities';
import { Action, Field, Notice, Panel } from '../../components/ui';
import './home.css';

export default function Home() {
  const [id, setId] = useState(''); const [inputError, setInputError] = useState('');
  const [showMore, setShowMore] = useState(false);
  const read = usePageRead(async () => {
    const user = await requireUser();
    const entries = await Promise.all(recentActivities(user.user_id).map(async ref => {
      try { return { ref, detail: await api.getActivity(ref.id), error: '' }; }
      catch (error) { return { ref, detail: undefined, error: errorText(error) }; }
    }));
    return { user, entries };
  });
  const login = useLogin(read.refresh);
  function open(activityId: string) {
    const parsed = activityIdSchema.safeParse(activityId.trim());
    if (!parsed.success) { setInputError('活动编号格式不正确，请核对收到的编号后再试。'); return; }
    setInputError(''); void Taro.navigateTo({ url: `/pages/activity/index?id=${encodeURIComponent(parsed.data)}` });
  }
  const signedIn = !!read.data && !read.error;
  return <View className="screen home-screen">
    <View className="home-hero">
      <Text className="home-wordmark">{BRAND_NAME}</Text>
      <Text className="home-title">一起出发，把局组起来。</Text>
      <Text className="home-subtitle">把一起做的事排好，让朋友按想参加的环节加入。</Text>
      <Action variant="primary" onClick={() => { void Taro.navigateTo({ url: '/pages/editor/index' }); }}>发起活动</Action>
    </View>
    <View className="home-account">
      <View className="home-account-info">
        <View className={`home-status-dot${signedIn ? ' home-status-dot-ready' : ''}`} />
        <Text>{login.busy ? '正在登录…' : read.loading ? '正在确认登录状态…' : signedIn ? '微信已登录' : '登录后查看自己的活动'}</Text>
      </View>
      <Action variant="text" disabled={login.busy} onClick={() => { void login.login(); }}>{login.busy ? '请稍候' : signedIn ? '重新登录' : '微信登录'}</Action>
    </View>
    <View className="home-feedback">
      {read.error && <Notice>{read.error}{read.data ? ' 下方保留的是此前读取的内容，请刷新核对。' : ''}</Notice>}
      {login.error && <Notice>{login.error}</Notice>}
    </View>
    <View className="home-section-heading">
      <Text className="home-section-title">最近活动</Text>
      <Action variant="text" disabled={read.loading} onClick={() => { void read.refresh(); }}>{read.loading ? '更新中…' : '刷新'}</Action>
    </View>
    <Text className="home-recent-note">记录当前微信在这台设备打开或发起过的活动，其他设备的活动不会自动出现在这里。</Text>
    {read.loading && !read.data && <View className="home-empty"><Text>正在读取最近活动…</Text></View>}
    {!read.loading && !read.error && read.data?.entries.length === 0 && <View className="home-empty">
      <Text className="home-empty-title">还没有最近活动</Text>
      <Text>发起一场活动，或从朋友分享的入口打开。</Text>
    </View>}
    {!read.loading && !read.data && <View className="home-empty"><Text>登录后，在这里继续查看最近打开的活动。</Text></View>}
    {read.data?.entries.map(entry => <View key={entry.ref.id} className="home-activity-card">
        <View className="home-card-heading">
          <Text className="home-card-title">{entry.detail?.name ?? entry.ref.name}</Text>
          {entry.detail && <Text className="home-role">{entry.detail.viewer.is_manager ? '我在管理' : '最近打开'}</Text>}
        </View>
        {entry.error ? <Notice>{entry.error} 此入口尚未读取成功。</Notice> : entry.detail && <View>
          <Text className="home-formation">{entry.detail.cancelled_at ? '活动已取消' : entry.detail.formation_status === 'confirmed' ? '主环节已确认成局' : '主环节待确认成局'}</Text>
          {entry.detail.segments.map(segment => <View key={segment.segment_id} className="home-segment">
            <Text className="home-segment-name">{segment.name}</Text>
            <Text className="home-segment-count">{segment.counts.occupied_count}/{segment.capacity} 人 · 最少 {segment.minimum_participants} 人</Text>
          </View>)}
        </View>}
        <Action onClick={() => open(entry.ref.id)}>查看活动</Action>
      </View>)}
    <View className="home-more">
      <Action variant="text" onClick={() => setShowMore(!showMore)}>{showMore ? '收起更多' : '更多 · 打开活动'}</Action>
      {showMore && <Panel title="打开收到的活动">
        <Field label="活动编号" value={id} onChange={setId} placeholder="粘贴朋友分享的活动编号" />
        {inputError && <Notice>{inputError}</Notice>}
        <Action onClick={() => open(id)}>打开活动</Action>
        <Text className="caption">打开后可以先看安排，再选择是否申请参加。体验版使用资格需要单独添加。</Text>
        <Action variant="text" onClick={() => { void Taro.navigateTo({ url: '/pages/diagnostics/index' }); }}>连接检查</Action>
      </Panel>}
    </View>
  </View>;
}
