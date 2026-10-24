import { useRef, useState } from 'react';
import Taro, { useDidShow, useDidHide, useUnload } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { ApiClientError } from '@weego/api-client';
import { api, establishSession, forgetSession, getToken } from '../../platform/api';

export default function Index() {
  const [status, setStatus] = useState('尚未检测正式 API');
  const [identity, setIdentity] = useState('尚未登录');
  const [value, setValue] = useState('');
  const [record, setRecord] = useState('尚未读取本人测试记录');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  function stop() { active.current = false; generation.current++; }
  async function refresh(epoch: number) {
    try {
      const health = await api.health();
      if (!active.current || epoch !== generation.current) return;
      setStatus(`真实 API 已响应：${health.server_time}；数据库与身份尚未由健康接口检查`);
    } catch (error) {
      if (!active.current || epoch !== generation.current) return;
      setStatus(error instanceof Error ? error.message : '检测失败');
    }
  }
  useDidShow(() => { stop(); active.current = true; void refresh(generation.current); });
  useDidHide(stop);
  useUnload(stop);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) {
      if (error instanceof ApiClientError && error.code === 'UNAUTHENTICATED') { forgetSession(); setIdentity('会话已失效，请重新登录'); }
      const message = error instanceof Error ? error.message : '操作未完成';
      setStatus(message);
      void Taro.showToast({ title: message, icon: 'none' });
    } finally { setBusy(false); }
  }
  return <View style={{ padding: '24px' }}>
    <Button onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回业务首页</Button>
    <Text>Weego 正式工程基础联通</Text>
    <Button disabled={busy} onClick={() => void run(() => refresh(++generation.current))}>重新检测连接</Button>
    <View><Text>{status}</Text></View>
    <View><Text>{identity}</Text></View>
    <Button disabled={busy} onClick={() => void run(async () => { const user = await establishSession(); setIdentity(`本人业务身份：${user.user_id}`); })}>微信登录／重新建立会话</Button>
    <Button disabled={busy} onClick={() => void run(async () => { if (!getToken()) { setIdentity('请先登录'); return; } const user = await api.me(); setIdentity(`已恢复本人：${user.user_id}`); })}>读取已保存的本人会话</Button>
    <Input maxlength={200} value={value} placeholder="仅输入虚构测试文本，不填个人资料" onInput={event => setValue(event.detail.value)} />
    <Button disabled={busy || !value} onClick={() => void run(async () => { const result = await api.putTestRecord(value); setRecord(result.value ?? '无记录'); })}>写入本人测试记录</Button>
    <Button disabled={busy} onClick={() => void run(async () => { const result = await api.getTestRecord(); setRecord(result.value ?? '尚无记录'); })}>读取本人测试记录</Button>
    <View><Text>{record}</Text></View>
    <View><Text>这是保留的 WG-01 技术检查入口。创建和申请请返回首页；健康响应不证明微信身份、持久数据库或真机业务已验收。未配置时不会以样例伪装成功。</Text></View>
  </View>;
}
