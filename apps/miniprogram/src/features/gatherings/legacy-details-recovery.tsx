import {Text,View} from '@tarojs/components';
import type {GatheringDetails,GatheringSnapshot} from '@weevibe/contracts';
import {CAction} from '../design-c/ui';
import {GatheringFlowHeader} from './flow-header';
import {useGatheringFormChrome} from './page-chrome';
import {GatheringSupplementRecord} from './supplement-record';
import {sameGatheringDetails} from './friend-draft';
import './friend-review.css';

type Input={expected_revision:number;details:GatheringDetails};
export function GatheringLegacyDetailsRecovery({snapshot,input,verified,busy,blocked,message,refresh,resolve,home}:{snapshot:GatheringSnapshot;input?:Input;verified:boolean;busy:boolean;blocked:boolean;message:string;refresh:()=>void;resolve:()=>void;home:()=>void}){
  useGatheringFormChrome();
  const matches=verified&&!!input&&snapshot.gathering.revision>=input.expected_revision+1&&sameGatheringDetails(snapshot.gathering.details,input.details);
  return <View className="c-ui gf-start gw-flow gf-review">
    <GatheringFlowHeader back={home} disabled={busy} label="回到首页"/>
    <View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / 上次修改待核对</Text><Text className="gf-title">先核对已有记录</Text><View className="gf-marker"/></View>
    <Text className="gp-caption">这里保留的是之前未确认结果的一次公共信息修改。先读取当前记录；清除本机待核对记录不会撤回已经保存的内容，也不会重新发送或覆盖活动。</Text>
    <View className="gp-panel"><Text className="gp-section-title">当前保存的日期</Text><Text className="gp-caption">{snapshot.gathering.details.date||'未填写'} · {snapshot.gathering.details.confirmed_details.includes('date')?'已标记确定':'待商量'}</Text></View>
    <GatheringSupplementRecord details={snapshot.gathering.details} title="当前保存的补充" caption="来自刚读取的活动记录，以下为当前保存的内容。"/>
    {input&&<><View className="gp-panel"><Text className="gp-section-title">上次修改中的日期</Text><Text className="gp-caption">{input.details.date||'未填写'} · {input.details.confirmed_details.includes('date')?'已标记确定':'待商量'}</Text></View><GatheringSupplementRecord details={input.details} title="上次修改中的补充" pending/></>}
    <View className="gh-notice"><Text>{matches?'当前保存内容已与这次修改一致，可以完成本机核对。':blocked?'上次修改内容暂时无法恢复，请核对当前记录后再清除本机标记。':'上次修改尚未确认与当前记录一致，请先核对以上内容。'}</Text>{message&&<Text>{message}</Text>}</View>
    <CAction className="gw-full" disabled={busy} onClick={refresh}>重新读取当前记录</CAction>
    <CAction className="gw-full" variant="primary" disabled={busy||!verified} onClick={resolve}>{matches?'保留当前内容并完成核对':'保留当前内容，清除本机待核对记录'}</CAction>
  </View>;
}
