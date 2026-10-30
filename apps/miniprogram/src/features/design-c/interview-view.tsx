import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, ScrollView, Text, View } from '@tarojs/components';
import { CIcon } from './chrome';
import { GatheringDesignChrome } from '../gatherings/page-chrome';
import './interview.css';

export type CInterviewTurn = {
  question: string;
  answer: string;
  answered: boolean;
  private: boolean;
  acknowledgement?: string;
};

export type CInterviewViewProps = {
  nickname: string;
  index: number;
  turns: CInterviewTurn[];
  disabled: boolean;
  busy: boolean;
  notice: string;
  activeInput: ReactNode;
  composer: string;
  onComposerChange: (text: string) => void;
  onJump: (index: number) => void;
  onSend: (text: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSwitchForm: () => void;
  onSummarize: () => void;
  onSkip?: () => void;
  onClearCurrent?: () => void;
  canSummarize?: boolean;
  onManualFallback?: () => void;
};

/** Presentation only. Answers, advancement and AI requests belong to the verified owner controller. */
export function CInterviewView({ nickname, index, turns, disabled, busy, notice, activeInput, composer, onComposerChange, onJump, onSend, onNext, onBack, onSwitchForm, onSummarize, onSkip, onClearCurrent, canSummarize = true, onManualFallback }: CInterviewViewProps) {
  const chrome = useContext(GatheringDesignChrome);
  useEffect(() => { chrome?.('interview'); return () => chrome?.(null); }, [chrome]);
  const currentIndex = Math.max(0, Math.min(4, index));
  const current = turns[currentIndex];
  const blocked = disabled || busy;
  const [viewport, setViewport] = useState({ bottom: 0, keyboard: false });
  const [anchor, setAnchor] = useState('');
  const originalHeight = useRef(typeof Taro.getWindowInfo === 'function' ? Taro.getWindowInfo().windowHeight : 700);
  const mounted = useRef(true);
  const answeredKey = turns.map(turn => `${turn.answered}:${turn.answer}`).join('|');
  useEffect(() => {
    mounted.current = true;
    const changed = (event: { height: number }) => {
      if (!mounted.current) return;
      const windowHeight = typeof Taro.getWindowInfo === 'function' ? Taro.getWindowInfo().windowHeight : originalHeight.current;
      const resizedBy = Math.max(0, originalHeight.current - windowHeight);
      setViewport({ bottom: Math.max(0, event.height - resizedBy), keyboard: event.height > 0 });
    };
    Taro.onKeyboardHeightChange?.(changed);
    return () => { mounted.current = false; Taro.offKeyboardHeightChange?.(changed); };
  }, []);
  useEffect(() => {
    let alive = true;
    setAnchor('');
    const move = () => { if (alive && mounted.current) setAnchor(notice || busy ? 'ci-feedback-end' : `ci-active-${currentIndex}`); };
    if (typeof Taro.nextTick === 'function') Taro.nextTick(move); else move();
    return () => { alive = false; };
  }, [currentIndex, answeredKey, notice, busy]);
  const send = () => { const text = composer.trim(); if (text && !blocked) onSend(text); };
  const readyToSummarize = currentIndex === 4 && !!current?.answered;
  return <View className={`c-interview ${viewport.keyboard ? 'ci-keyboard' : ''}`} style={{ bottom: `${viewport.bottom}px` }}>
    <View className="ci-header"><Button className="ci-back" ariaLabel="返回" disabled={blocked} onClick={onBack}><CIcon name="back" /><Text className="ci-sr-only">返回</Text></Button><View className="ci-heading"><Text>小橘头</Text><Text>聊聊这次出游</Text></View><Button className="ci-form-link" disabled={blocked} onClick={onSwitchForm}>切换填表</Button></View>
    <View className="ci-progress"><Text>{current?.answered ? '修改' : '第'} {currentIndex + 1} 题<Text className="ci-progress-total"> ／ 共 5 题</Text></Text><View>{Array.from({ length: 5 }, (_, i) => <View key={i} className={`${turns[i]?.answered ? 'ci-done' : ''} ${i === currentIndex ? 'ci-current' : ''}`} />)}</View></View>
    <ScrollView className="ci-scroll" scrollY scrollWithAnimation scrollIntoView={anchor}>
      <View className="ci-content"><View className="ci-bot-line ci-introduction"><View className="ci-bot-avatar"><Text>✦</Text></View><View className="ci-bot-bubble"><Text>{nickname ? `${nickname}，` : ''}我们一次聊一件事。已经回答的，随时都能改。</Text></View></View>
        {turns.map((turn, i) => i !== currentIndex && turn.answered ? <View className="ci-turn" key={i}><View className="ci-question-label"><Text>{i + 1} / 5</Text>{turn.private && <Text className="ci-private-tag">仅本人</Text>}</View><View className="ci-bot-line"><View className="ci-bot-bubble"><Text>{turn.question}</Text></View></View><Button className={`ci-answer ${turn.private ? 'ci-answer-private' : ''}`} disabled={blocked} onClick={() => onJump(i)} ariaLabel={`修改第${i + 1}题回答`}><Text>{turn.answer}</Text><Text className="ci-edit-label">修改回答 ↗</Text></Button>{turn.acknowledgement && <View className="ci-ack"><Text>{turn.acknowledgement}</Text></View>}</View> : null)}
        <View id={`ci-active-${currentIndex}`} className="ci-active-question"><View className="ci-question-label"><Text>{current?.answered ? `修改第 ${currentIndex + 1} 题` : `第 ${currentIndex + 1} 题`}</Text>{current?.private && <Text className="ci-private-tag">仅本人</Text>}</View><View className="ci-bot-line"><View className="ci-bot-avatar"><Text>✦</Text></View><View className="ci-bot-bubble"><Text>{current?.question || '说说这次出游的想法吧。'}</Text></View></View><View className="ci-inline-input">{activeInput}</View>{current?.answered && <Text className="ci-saved-answer">本次填写：{current.answer}</Text>}{current?.acknowledgement && <View className="ci-ack"><Text>{current.acknowledgement}</Text></View>}</View>
        {notice && <View className="ci-notice"><Text>{notice}</Text>{onManualFallback && <Button className="ci-summary-link" disabled={blocked} onClick={onManualFallback}>继续按已填内容整理</Button>}</View>}{busy && <View className="ci-busy"><View /><Text>正在整理你填写的公开想法…</Text></View>}<View id="ci-feedback-end" className="ci-scroll-end" />
      </View>
    </ScrollView>
    <View className="ci-footer"><View className="ci-visibility"><CIcon name={current?.private ? 'lock' : 'group'} /><Text>{current?.private ? '这一题仅本人可见，不发送给 AI。' : '整理后的公开偏好可供本次活动成员查看。'}</Text></View><View className="ci-composer"><Input className="ci-composer-input" value={composer} disabled={blocked} adjustPosition={false} cursorSpacing={18} confirmType="send" maxlength={1000} placeholder={current?.private ? '也可以在这里直接说，仅本人可见' : '也可以在这里直接说'} onInput={event => onComposerChange(event.detail.value)} onConfirm={send} /><Button className="ci-send" disabled={blocked || !composer.trim()} onClick={send} ariaLabel="发送回答"><Text>发送</Text></Button></View>
      <View className="ci-actions">{onClearCurrent && <Button className="ci-clear" disabled={blocked} onClick={onClearCurrent}>清空本题</Button>}{onSkip && <Button className="ci-skip" disabled={blocked} onClick={onSkip}>{current?.private ? '愿意配合' : '先留待定'}</Button>}<Button className="ci-next" disabled={blocked || readyToSummarize && !canSummarize} onClick={readyToSummarize ? onSummarize : onNext}>{busy ? '正在整理…' : readyToSummarize ? '帮我整理' : currentIndex === 4 ? '这一题好了' : '下一题 →'}</Button></View>
      {canSummarize && currentIndex !== 4 && <Button className="ci-summary-link" disabled={blocked} onClick={onSummarize}>查看整理结果 ↗</Button>}
    </View>
  </View>;
}
