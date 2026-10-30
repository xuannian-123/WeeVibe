import {Button,Text,View} from '@tarojs/components';
import type {GatheringIntake} from '@weevibe/contracts';
import {GatheringFlowHeader} from './flow-header';
import {CIcon} from '../design-c/chrome';
import {CAction} from '../design-c/ui';
import './friend-start.css';

type Props={intake:GatheringIntake;reviewed:boolean;hasProgress:boolean;disabled:boolean;notice:string;recoveryMessage:string;pending:boolean;busy:boolean;back:()=>void;start:()=>void;resume:()=>void};
export function GatheringFriendStart({intake,reviewed,hasProgress,disabled,notice,recoveryMessage,pending,busy,back,start,resume}:Props){
  const ready=reviewed&&!hasProgress&&!!intake.public.activity_nickname.trim()&&!!intake.public.date;
  return <View className="c-ui gf-start gf-single-start">
    <GatheringFlowHeader back={back} disabled={busy}/>
    <View className="gf-heading"><Text className="gf-eyebrow">WEEVIBE / 一起出发</Text><Text className="gf-title">朋友出游</Text><View className="gf-marker"/></View>
    <Text className="gp-caption">先说说你的想法。朋友加入后，再一起挑选和确认安排。</Text>
    <View className="gf-cards"><Button className={`gf-card gf-ai${notice&&!ready?' gf-needs-attention':''}`} disabled={disabled} onClick={()=>ready?resume():start()}><View className="gf-card-top"><CIcon name="pencil" className="gf-icon"/><Text className="gf-badge">{hasProgress?'待继续':ready?'已整理':'填表 / 小橘头'}</Text></View><Text className="gf-card-title">AI整理</Text><Text className="gf-card-description">{hasProgress?'上次的填写已保留，继续整理':ready?`${intake.public.activity_nickname} · ${intake.public.date}`:'有个想法，先记下来'}</Text><Text className="gf-arrow">↗</Text></Button></View>
    <View className="gf-journey"><Text className="gp-section-title">从想法，到一起出发</Text><Text>1　整理我的偏好</Text><Text>2　核对后发起，邀请朋友补充</Text><Text>3　共同选择并确认安排</Text></View>
    {notice&&<View className="gf-notice" role="alert"><Text>{notice}</Text></View>}{recoveryMessage&&<View className="gf-notice" role="alert"><Text>{recoveryMessage}</Text></View>}
    {(pending||disabled&&recoveryMessage)&&<CAction className="gf-publish" disabled={busy} onClick={resume}>查看上次发起结果</CAction>}
    <Text className="gf-footnote">整理完再核对，最后一步才发起。</Text>
  </View>;
}
