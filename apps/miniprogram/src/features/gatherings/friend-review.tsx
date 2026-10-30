import {Text,View} from '@tarojs/components';
import {gatheringOwnBlocks,type GatheringDetails,type GatheringIntake} from '@weevibe/contracts';
import {GatheringFlowHeader} from './flow-header';
import {CIcon} from '../design-c/chrome';
import {CAction} from '../design-c/ui';
import {GatheringSupplementRecord} from './supplement-record';
import './friend-start.css';
import './friend-review.css';

type Props={details:GatheringDetails;excludedDetails?:GatheringDetails;intake:GatheringIntake;busy:boolean;locked:boolean;pending:boolean;blocked:boolean;notice:string;back:()=>void;edit:()=>void;publish:()=>void;retry:()=>void};
export function GatheringFriendReview({details,excludedDetails,intake,busy,locked,pending,blocked,notice,back,edit,publish,retry}:Props){
  const blocks=gatheringOwnBlocks(intake),privateIds=new Set(['origin','budget']);
  return <View className="c-ui gf-start gf-review">
    <GatheringFlowHeader back={back} disabled={busy} label="返回朋友出游"/>
    <View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / 最后一步</Text><Text className="gf-title">发起前，再看一眼</Text><View className="gf-marker"/></View>
    <View className="gr-section gr-arrangement"><Text className="gr-name">{details.title||'朋友出游'}</Text><Text>{pending?`原请求日期（${details.confirmed_details.includes('date')?'已标记确定':'待商量'}）：`:intake.public.confirmed_keys.includes('date')?'我已确定的日期：':'暂定日期：'}{details.date||'出游日期未填写'}</Text><Text className="gr-caption">朋友加入并提交想法后，再生成候选安排，大家一起确认。</Text></View>
    {pending?<GatheringSupplementRecord details={details} answers={intake.answers} title="上次请求中的补充" pending/>:(excludedDetails||intake.answers.length>0)&&<GatheringSupplementRecord details={excludedDetails??details} answers={intake.answers} title="未带入本次发起的补充"/>}
    <View className="gr-section"><View className="gr-section-heading"><Text>我的偏好</Text><CAction variant="text" disabled={locked} onClick={edit}>修改偏好</CAction></View><Text className="gr-nickname">本次活动昵称：{intake.public.activity_nickname||'未填写'}</Text>{blocks.filter(block=>!privateIds.has(block.id)&&block.id!=='date').map(block=><View className="gr-preference" key={block.id}><Text className="gr-label">{block.label} · {block.confirmed?'已确定':'待商量'}</Text><Text>{block.value}</Text></View>)}</View>
    <View className="gr-section gr-private"><View className="gr-section-heading"><Text>私密补充</Text><CIcon name="lock"/></View><Text className="gr-caption">仅本人可见，个人预算和出发地点不会展示给其他成员。</Text>{blocks.filter(block=>privateIds.has(block.id)).map(block=><View className="gr-preference" key={block.id}><Text className="gr-label">{block.label}</Text><Text>{block.value}</Text></View>)}{!blocks.some(block=>privateIds.has(block.id))&&<Text>未填写，愿意配合大家的安排。</Text>}</View>
    {notice&&<View className="gf-notice" role="alert"><Text>{notice}</Text></View>}
    <Text className="gr-caption">这里发起的是活动筹备，填写偏好不代表已接受最终安排。</Text>
    {pending?<CAction className="gf-publish" variant="primary" disabled={busy} loading={busy} onClick={retry}>沿用原请求核对并重试</CAction>:<CAction className="gf-publish" variant="primary" disabled={locked||blocked} loading={busy} onClick={publish}>发起活动</CAction>}
  </View>;
}
