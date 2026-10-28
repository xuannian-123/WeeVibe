import type {ReactNode} from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { Venue } from '@weevibe/contracts';
import { profilePresentationSchema } from '@weevibe/contracts';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { getToken } from '../../platform/api';
import { ProfileCard } from './profile-card';
import { VenueCard, VenueDetail } from './venue-card';
import { Action, Notice } from '../../components/ui';
import { errorText } from '../../platform/page-state';

export function ProfileHome({ account, session, edit, settings, activities, changed, plan, gatherings }: { gatherings?:ReactNode; account: AccountSnapshot; session: string; edit: () => void; settings: () => void; activities: (filter: 'managed' | 'joined') => void; changed: (v: AccountSnapshot) => void; plan: (v: Venue) => void }) {
  const [preview, setPreview] = useState(false), [allFavorites, setAllFavorites] = useState(false), [selected, setSelected] = useState<Venue>(), [tool, setTool] = useState<'help' | 'about' | ''>('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''); const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = () => mounted.current && getToken() === session;
  const extra = profilePresentationSchema.parse(account.profile), p = account.profile;
  const displayed = { nickname: p.nickname || '', ...extra, ...(!preview ? { mbti: p.mbti, zodiac: p.zodiac } : { bio: extra.visibility.bio ? extra.bio : undefined, interests: extra.visibility.interests ? extra.interests : undefined, mbti: extra.visibility.mbti ? p.mbti : undefined, zodiac: extra.visibility.zodiac ? p.zodiac : undefined }) };
  async function remove(venue: Venue) {
    if (!valid() || lock.current) return; lock.current = true; setBusy(true); setNotice('');
    try { const next = await requestAccount(session, 'PATCH', { action: 'favorite', venue, saved: false }); if (valid()) { changed(next); setSelected(undefined); } }
    catch (e) { if (valid()) setNotice(errorText(e)); } finally { lock.current = false; if (valid()) setBusy(false); }
  }
  if (!valid()) return <Notice>账号已变化，原账号的主页和收藏已隐藏，请重新打开。</Notice>;
  if (tool) return <View className="wv-section"><Text className="wv-title">{tool === 'help' ? '帮助与反馈' : '关于 WeeVibe'}</Text><Text className="wv-subtitle">{tool === 'help' ? '使用中遇到问题，可以记录发生的页面、操作和提示，通过邀请你试用的组织者联系项目团队。' : '把想见的人，约进下一段好时光。WeeVibe 帮你收集想法、确认安排，一起把相聚变成现实。'}</Text><Text className="wv-muted">报名需要组织者审批；收藏、阅读消息和填写筹备意向均不代表已加入活动。</Text><Action onClick={() => setTool('')}>返回我的</Action></View>;
  return <View className="wv-profile-home"><ProfileCard profile={displayed} session={session} avatarPath={p.avatar_url} edit={!preview ? edit : undefined} settings={!preview ? settings : undefined}/>
    <Button className="wv-preview-profile" onClick={() => setPreview(v => !v)}>{preview ? '返回本人视角' : '预览他人看到的主页'}　›</Button>
    {preview ? <Text className="wv-list-note">仅同一活动的组织者和已加入成员可查看；此视角只展示你主动公开的内容。</Text> : <View>
      {gatherings}
      <View className="wv-section-heading"><Text className="wv-section-title">我的收藏</Text><Button className="wv-link" onClick={() => setAllFavorites(v => !v)}>{allFavorites ? '收起' : '全部'}　›</Button></View>
      {notice && <Notice tone="error">{notice}</Notice>}
      {account.favorites.length ? <View className="wv-venue-grid">{account.favorites.slice(0, allFavorites ? 100 : 2).map(v => <VenueCard key={v.provider_id} venue={v} saved busy={busy} open={() => setSelected(v)} favorite={() => void remove(v)}/>)}</View> : <View className="wv-empty compact"><Text className="wv-muted">把想一起去的地点，慢慢收藏起来。</Text></View>}
      <View className="wv-section-heading"><Text className="wv-section-title">我的活动</Text></View><View className="wv-my-activity-links"><Button onClick={() => activities('managed')}><Text>我组织的</Text><Text>安排每一次相聚　›</Text></Button><Button onClick={() => activities('joined')}><Text>我参与的</Text><Text>一起留下的好时光　›</Text></Button></View>
      <View className="wv-profile-tools"><Button onClick={() => setTool('help')}>帮助与反馈　›</Button><Button onClick={() => setTool('about')}>关于 WeeVibe　›</Button></View>
    </View>}
    {selected && <VenueDetail venue={selected} busy={busy} saved favorite={() => void remove(selected)} close={() => setSelected(undefined)} plan={() => { if (valid()) plan(selected); }}/>}
  </View>;
}
