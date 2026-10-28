import { Sheet } from './sheet';
import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { getToken } from '../platform/api';

type Resolver = Parameters<Taro.onNeedPrivacyAuthorization.Listener>[0];
let registered = false;
let receive: ((resolve: Resolver) => void) | undefined;
function install() {
  if (!registered && typeof Taro.onNeedPrivacyAuthorization === 'function') {
    Taro.onNeedPrivacyAuthorization(resolve => receive ? receive(resolve) : resolve({ event: 'disagree' })); registered = true;
  }
}
/** Native consent is resolved only by the platform's actual agree button event. */
export function PrivacyConsent() {
  const [open, setOpen] = useState(false), [contract, setContract] = useState('用户隐私保护指引'), [notice, setNotice] = useState('');
  const active = useRef(true), pending = useRef<{ resolve: Resolver; session: string | undefined }[]>([]);
  function finish(agree = false) {
    const requests = pending.current; pending.current = []; setOpen(false);
    for (const request of requests) request.resolve(agree && active.current && request.session === getToken() ? { event: 'agree', buttonId: 'weevibe-privacy-agree' } : { event: 'disagree' });
  }
  useEffect(() => {
    active.current = true; install();
    const handler = (resolve: Resolver) => {
      if (!active.current) { resolve({ event: 'disagree' }); return; }
      pending.current.push({ resolve, session: getToken() }); setOpen(true); setNotice('');
      resolve({ event: 'exposureAuthorization' });
      Taro.getPrivacySetting?.({ success: result => { if (active.current && pending.current.length) setContract(result.privacyContractName || '用户隐私保护指引'); } });
    };
    receive = handler;
    return () => { active.current = false; if (receive === handler) receive = undefined; const requests = pending.current; pending.current = []; for (const r of requests) r.resolve({ event: 'disagree' }); };
  }, []);
  const hide = () => { active.current = false; finish(); }; useDidHide(hide); useUnload(hide); useDidShow(() => { active.current = true; });
  if (!open) return null;
  return <Sheet title="先了解信息如何使用" close={()=>finish()} className="wv-privacy-sheet" overlayClassName="wv-privacy-overlay">
    <Text className="wv-muted">头像和昵称用于展示你主动填写的个人资料；定位仅在你主动操作时获取：城市识别使用大致位置，查看附近可请求精确位置，也可选择大致位置；不用于展示私人出发位置。</Text>
    <Button className="wv-link" onClick={() => Taro.openPrivacyContract({ fail: () => { if (active.current) setNotice('暂时无法打开隐私指引，请稍后重试。'); } })}>阅读《{contract.replace(/[《》]/g, '')}》</Button>
    {notice && <Text className="wv-muted">{notice}</Text>}
    <Button id="weevibe-privacy-agree" className="action action-primary" openType="agreePrivacyAuthorization" onAgreePrivacyAuthorization={() => finish(true)}>同意并继续</Button>
    <Button className="action action-text" onClick={() => finish()}>暂不同意</Button>
  </Sheet>;
}
