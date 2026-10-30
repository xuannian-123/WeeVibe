import type {ReactNode} from 'react';
import {Text,View} from '@tarojs/components';
import type {GatheringSnapshot} from '@weevibe/contracts';
import {CIcon} from '../design-c/chrome';
import {CAction} from '../design-c/ui';
import {GatheringFlowHeader} from './flow-header';
import './preference-form.css';

export function GatheringFriendCreated({snapshot,notice,busy,home,manage,subscription,shareReady=false}:{snapshot:GatheringSnapshot;shareReady?:boolean;notice:string;busy:boolean;home:()=>void;manage:()=>void;subscription:ReactNode}){
  return <View className="c-ui gf-start gs-created"><GatheringFlowHeader back={home} disabled={busy} label="回到首页"/><View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / 已发起</Text><Text className="gf-title">这次相聚已发起</Text><View className="gf-marker"/></View><View className="gp-panel gs-receipt"><CIcon name="check"/><Text className="gs-title">{snapshot.gathering.title}</Text><Text>{snapshot.gathering.date}</Text><Text className="gp-caption">活动已保存。分享给朋友，邀请大家填写自己的想法。</Text></View><Text className="gp-caption">填写偏好不代表已接受最终安排；个人预算和出发地点仅本人可见。</Text>{notice&&<View className="gp-error" role="alert"><Text>{notice}</Text></View>}<CAction className="gs-manage" variant="primary" openType="share" disabled={busy||!shareReady}>分享给朋友</CAction><CAction className="gs-manage" disabled={busy} onClick={manage}>看看大家的想法</CAction>{subscription}</View>;
}
