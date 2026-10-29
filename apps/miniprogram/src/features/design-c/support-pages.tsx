import { Button, Text, View } from '@tarojs/components';
import { CIcon } from './chrome';
import { CAction } from './ui';
import type { CIconName } from './icons';
import './support-pages.css';

export type CSupportPage = 'settings' | 'privacy' | 'help' | 'about';
export type CSupportPagesProps = {
  page: CSupportPage;
  signedIn: boolean;
  busy?: boolean;
  onBack: () => void;
  onOpen: (page: 'profile' | 'privacy' | 'help' | 'about') => void;
  onLogout: () => void;
  onPermissions: () => void;
};

const titles: Record<CSupportPage, string> = {
  settings: '设置', privacy: '隐私与权限说明', help: '帮助与反馈', about: '关于 WeeVibe',
};
const privacy: { icon: CIconName; title: string; body: string }[] = [
  { icon: 'user', title: '活动内的身份', body: '活动内使用本次活动昵称与动物头像，不展示微信头像和昵称，也不提供成员个人主页。个人预算与出发地点仅本人可见，局头和其他成员无法查看，也不会发送给 AI。' },
  { icon: 'pin', title: '定位', body: '用于查找附近地点。未获取位置时，仍可手动选择城市浏览。' },
  { icon: 'lock', title: '头像与昵称', body: '账号头像和昵称用于本人的账号显示，由本人选择或修改；与活动内的昵称和动物头像分开。' },
  { icon: 'chat', title: '订阅消息', body: '用于活动提醒；未订阅或未收到提醒时，仍可在站内查看消息。' },
];
const questions = [
  ['怎样进入活动？', '打开朋友的微信分享，也可从我的活动、消息或已保存邀请进入。'],
  ['申请后就算加入了吗？', '申请不占位，审批通过后才算加入。'],
  ['填写筹备需求等于报名吗？', '不等于。筹备与正式报名分别进行。'],
  ['定位失败怎么办？', '可以手动选城市，继续搜索地点。'],
] as const;
const about: { icon: CIconName; title: string; body: string }[] = [
  { icon: 'calendar', title: '安排明确，直接创建', body: '已有安排时，继续创建活动。' },
  { icon: 'tickets', title: '只有想法，先筹备', body: '收集需求后，再形成安排。' },
  { icon: 'chat', title: '提醒集中在消息', body: '结合微信订阅提醒，查看变化与待处理事项。' },
];

/** C presentation only: account operations and native permissions belong to the owner controller. */
export function CSupportPages({ page, signedIn, busy = false, onBack, onOpen, onLogout, onPermissions }: CSupportPagesProps) {
  const row = (target: 'profile' | 'privacy' | 'help' | 'about', icon: CIconName, title: string, description = '') => <Button className="cs-utility-row" disabled={busy} onClick={() => onOpen(target)} key={target}><CIcon name={icon} /><View><Text className="cs-row-title">{title}</Text>{description && <Text className="cs-row-description">{description}</Text>}</View><CIcon name="right" /></Button>;
  const section = ({ icon, title, body }: { icon: CIconName; title: string; body: string }) => <View className="cs-prose-section" key={title}><CIcon name={icon} /><View><Text className="cs-section-title">{title}</Text><Text className="cs-paragraph">{body}</Text></View></View>;
  return <View className={`c-ui c-support-page cs-${page}`}>
    <View className="cs-header"><Button className="cs-back" ariaLabel="返回" disabled={busy} onClick={onBack}><CIcon name="back" /><Text className="c-sr-only">返回</Text></Button><Text className="cs-title">{titles[page]}</Text></View>
    {page === 'settings' && <View className="cs-body cs-settings-body">
      <View className="cs-settings-group">{row('profile', 'user', '头像与昵称', '修改头像和昵称')}{row('privacy', 'lock', '隐私与权限说明', '活动身份、定位与图片使用')}</View>
      <View className="cs-settings-group">{row('help', 'help', '帮助与反馈', '使用说明与问题反馈方式')}{row('about', 'info', '关于 WeeVibe')}</View>
      {signedIn ? <><CAction className="cs-logout" disabled={busy} onClick={onLogout}>退出登录</CAction><Text className="cs-hint">退出后，本机登录状态将清除，活动与收藏仍保留。</Text></> : <CAction variant="primary" className="cs-login" disabled={busy} onClick={() => onOpen('profile')}>微信登录</CAction>}
    </View>}
    {page === 'privacy' && <View className="cs-body cs-prose">
      {privacy.map(section)}
      <CAction className="cs-permissions" disabled={busy} onClick={onPermissions}>管理微信权限</CAction><Text className="cs-hint cs-centered">权限状态以微信实际设置为准。</Text>
    </View>}
    {page === 'help' && <View className="cs-body cs-prose">
      <Text className="cs-section-title cs-prose-top">常见问题</Text>
      {questions.map(([question, answer], index) => <View className="cs-prose-section cs-question" key={question}><View className={`cs-question-mark ${index % 2 ? 'cs-question-lilac' : ''}`}><Text>?</Text></View><View><Text className="cs-section-title">{question}</Text><Text className="cs-paragraph">{answer}</Text></View></View>)}
      <Text className="cs-section-title">遇到其他问题</Text><Text className="cs-paragraph">记录发生的页面、操作步骤和提示，通过邀请你试用的组织者联系项目团队。</Text>
    </View>}
    {page === 'about' && <View className="cs-body cs-prose cs-about">
      <View className="cs-wordmark"><Text>wee<Text className="cs-wordmark-vibe">vibe</Text><Text className="cs-wordmark-star">✳</Text></Text></View>
      <Text className="cs-paragraph cs-about-intro">和朋友、熟人一起，把出游和团建安排起来。</Text>
      {about.map(section)}<Text className="cs-paragraph cs-about-closing">活动由你们决定。</Text>
    </View>}
  </View>;
}
