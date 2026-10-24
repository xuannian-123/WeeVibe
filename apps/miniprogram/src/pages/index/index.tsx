import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { activityIdSchema } from '@weego/contracts';
import { api } from '../../platform/api';
import { errorText, requireUser, useLogin, usePageRead } from '../../platform/page-state';
import { recentActivities } from '../../platform/activities';
import { Action, Field, Notice, Panel } from '../../components/ui';

export default function Home() {
  const [id, setId] = useState(''); const [inputError, setInputError] = useState('');
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
    if (!parsed.success) { setInputError('请填写有效活动 ID（UUID），不填写会话或微信登录凭证。'); return; }
    setInputError(''); void Taro.navigateTo({ url: `/pages/activity/index?id=${encodeURIComponent(parsed.data)}` });
  }
  return <View className="screen">
    <Panel title="Weego · 一起把局组起来">
      <Notice>简版真实接口页面；资源未接通时会明确报错，不会显示本地假活动。管理与参加使用同一个微信身份。</Notice>
      {read.loading && <Notice>正在读取本人状态与活动……</Notice>}
      {read.error && <Notice>{read.error} 已有摘要可能过时。</Notice>}
      {login.error && <Notice>{login.error}</Notice>}
      <Text>{read.data && !read.error ? '已取得服务端本人状态' : '尚未确认当前登录状态'}</Text>
      <Action disabled={login.busy} onClick={() => { void login.login(); }}>{login.busy ? '正在登录' : '微信登录／重新登录'}</Action>
      <Action onClick={() => { void read.refresh(); }}>刷新最新状态</Action>
      <Action onClick={() => { void Taro.navigateTo({ url: '/pages/editor/index' }); }}>创建多环节活动</Action>
      <Action onClick={() => { void Taro.navigateTo({ url: '/pages/diagnostics/index' }); }}>WG-01 技术检查入口</Action>
    </Panel>
    <Panel title="打开收到的活动">
      <Field label="活动 ID" value={id} onChange={setId} placeholder="从活动入口取得的 UUID，不是管理凭据" />
      {inputError && <Notice>{inputError}</Notice>}
      <Action onClick={() => open(id)}>查看活动（不会自动加入）</Action>
      <Text className="caption">体验版须先有微信平台体验资格；普通活动入口不授予体验资格、本人身份或管理权限。</Text>
    </Panel>
    <Panel title="本机近期活动入口">
      <Notice>这里只保存本微信在此设备打开／创建过的入口，再向服务端读取当前状态；不是完整跨设备活动列表或待办中心。后续任务另接授权列表与待办。</Notice>
      {!read.loading && !read.error && read.data?.entries.length === 0 && <Text>此设备尚无已记录活动入口，可先创建或打开收到的活动。</Text>}
      {read.data?.entries.map(entry => <View key={entry.ref.id} className="row">
        <Text>{entry.detail?.name ?? entry.ref.name}</Text>
        {entry.error ? <Notice>{entry.error} 此入口尚未读取成功。</Notice> : entry.detail && <View>
          <Text>{entry.detail.viewer.is_manager ? '我在管理' : '查看／本人参与'} · {entry.detail.formation_status === 'confirmed' ? '主环节已成局' : '主环节尚未确认成局'}</Text>
          {entry.detail.segments.map(segment => <View key={segment.segment_id}><Text>{segment.name}：占用 {segment.counts.occupied_count}/{segment.capacity}，最少 {segment.minimum_participants} 人</Text></View>)}
        </View>}
        <Action onClick={() => open(entry.ref.id)}>打开最新详情</Action>
      </View>)}
    </Panel>
  </View>;
}
