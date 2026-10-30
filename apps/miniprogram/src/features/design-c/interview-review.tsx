import { useContext, useEffect } from 'react';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import type { GatheringBlock } from '@weevibe/contracts';
import { GatheringDesignChrome } from '../gatherings/page-chrome';
import { CIcon } from './chrome';
import {GatheringFlowHeader} from '../gatherings/flow-header';
import '../gatherings/preference-form.css';
import './interview.css';
import './interview-review.css';

type Props = {
  blocks: GatheringBlock[]; selected: string[]; summary: string; saving: boolean;
  onToggle: (id: string) => void; onCommit: () => void; onBack: () => void;
  commitLabel?:string;formLayout?:boolean; sourceLabel?:string; notice?: string; onRetry?: () => void; retryBusy?: boolean; participationNotice?: string;
};

/** Explicit certainty review; selecting a block does not publish or confirm the final plan. */
export function CInterviewReview({ blocks, selected, summary, saving, onToggle, onCommit, onBack, notice = '', onRetry, retryBusy = false, participationNotice = '', sourceLabel = '小橘头 · 整理结果', formLayout = false, commitLabel }: Props) {
  const chrome = useContext(GatheringDesignChrome);
  useEffect(() => { chrome?.('interview'); return () => chrome?.(null); }, [chrome]);
  const privateBlock = (block: GatheringBlock) => block.id === 'budget' || block.id === 'origin';
  return <View className={formLayout?'c-ui gf-start gp-certainty':'c-interview ci-review'}>
    {formLayout?<GatheringFlowHeader back={onBack} disabled={saving} label="返回修改"/>:<View className="ci-header"><Button className="ci-back" ariaLabel="返回修改" disabled={saving} onClick={onBack}><CIcon name="back" /><Text className="ci-sr-only">返回修改</Text></Button><View className="ci-heading"><Text>再确认一步</Text><Text>{sourceLabel}</Text></View></View>}
    <ScrollView className={formLayout?'gp-confirm-content':'ci-scroll'} scrollY={!formLayout}><View className="cr-content">
      <Text className="cr-title">哪些内容已经确定了？</Text><Text className="cr-caption">可以多选，也可以一个都不选。其余内容继续留待商量。</Text>
      {participationNotice && <Text className="cr-participation-notice">{participationNotice}</Text>}
      {summary && <View className="cr-summary"><Text>{summary}</Text></View>}
      {[false, true].map(isPrivate => {
        const group = blocks.filter(block => privateBlock(block) === isPrivate);
        if (!group.length) return null;
        return <View className={`cr-group ${isPrivate ? 'cr-private' : ''}`} key={String(isPrivate)}><View className="cr-group-heading"><CIcon name={isPrivate ? 'lock' : 'group'} /><Text>{isPrivate ? '仅本人可见' : '我的公开想法'}</Text></View>{isPrivate && <Text className="cr-private-note">预算与出发地点不会分享给局头、其他成员或 AI。</Text>}{group.map(block => <Button className={`cr-block ${selected.includes(block.id) ? 'cr-selected' : ''}`} key={block.id} disabled={saving} onClick={() => onToggle(block.id)} ariaLabel={`${selected.includes(block.id) ? '取消确定' : '标为确定'}：${block.label}`}><View className="cr-block-copy"><Text className="cr-block-label">{block.label}</Text><Text className="cr-block-value">{block.value}</Text><Text className="cr-block-status">{selected.includes(block.id) ? '已选' : '点选确定'}</Text></View><View className="cr-check"><Text>{selected.includes(block.id) ? '✓' : ''}</Text></View></Button>)}</View>;
      })}
      {!blocks.length && <Text className="cr-caption">暂未填写偏好，可以先保留待定。</Text>}
    </View></ScrollView>
    <View className={formLayout?'gp-footer cr-footer':'ci-footer cr-footer'}>{notice && <Text className="cr-save-notice">{notice}</Text>}{onRetry && <Button className="cr-retry" disabled={retryBusy} onClick={onRetry}>{retryBusy ? '正在核对保存…' : '沿用原请求核对保存'}</Button>}<Text className="cr-save-hint">确定的是本人偏好，不代表已经接受最终安排。</Text><Button className={formLayout?'c-action c-action-primary cr-commit':'cr-commit'} disabled={saving} loading={saving && !onRetry} onClick={onCommit}>{saving ? onRetry ? '保存结果待核对' : '正在保存…' : commitLabel || (selected.length ? '这些是已经确定了的' : '还都没确定')}</Button></View>
  </View>;
}
