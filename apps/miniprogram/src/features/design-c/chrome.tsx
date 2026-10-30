import { Button, Image, Text, View } from '@tarojs/components';
import { cIcons, type CIconName } from './icons';
import './foundation.css';

export function CIcon({ name, className = '' }: { name: CIconName; className?: string }) {
  return <Image className={`c-icon ${className}`} src={cIcons[name]} mode="aspectFit" ariaHidden />;
}

export function CWordmark() {
  return <Text className="c-wordmark">wee<Text className="c-wordmark-vibe">vibe</Text><Text className="c-wordmark-star">✳</Text></Text>;
}

export function CHeader({ city, chooseCity }: { city: string; chooseCity: () => void }) {
  return <View className="c-header">
    <CWordmark />
    <Button className="c-city" ariaLabel="选择城市" onClick={chooseCity}><Text>{city}</Text><CIcon name="right" className="c-city-chevron" /></Button>
  </View>;
}

export type CTab = 'go' | 'ideas' | 'messages' | 'me';
const tabs = [
  { id: 'go', icon: 'home', label: 'GO' },
  { id: 'ideas', icon: 'search', label: '灵感' },
  { id: 'messages', icon: 'chat', label: '消息' },
  { id: 'me', icon: 'user', label: '我的' },
] as const;

export function CNavigation({ selected, change, create, unread = 0 }: { selected: CTab; change: (tab: CTab) => void; create: () => void; unread?: number }) {
  const tab = (item: typeof tabs[number]) => <Button key={item.id} className={`c-nav-item ${selected === item.id ? 'c-nav-active' : ''}`} onClick={() => change(item.id)} ariaLabel={item.id === 'messages' && unread ? `消息，${unread}条未读` : item.label}>
    <View className="c-nav-symbol"><CIcon name={item.icon} />{item.id === 'messages' && unread > 0 && <View className="c-nav-dot" />}</View><Text>{item.label}</Text>
  </Button>;
  return <View className="c-navigation">{tabs.slice(0, 2).map(tab)}<Button className="c-create" ariaLabel="创建活动" onClick={create}><Text>＋</Text></Button>{tabs.slice(2).map(tab)}</View>;
}
