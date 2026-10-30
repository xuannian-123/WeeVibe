import { Button, Input, Text, View } from '@tarojs/components';
import type { AccountSnapshot } from '../../platform/account-api';
import { formatActivityTime } from '../shell/activity-time';
import { CIcon } from './chrome';
import { CAction, CSheet } from './ui';
import './account-tools.css';

function AccountToolsHeading({ title, back }: { title: string; back: () => void }) {
  return <View className="c-subheader c-account-tools-heading"><Button ariaLabel="返回" onClick={back}><CIcon name="back" /></Button><Text>{title}</Text></View>;
}

export type CInvitationsPageProps = {
  invitations?: AccountSnapshot['invitations']; busy: boolean; error: string;
  refresh: () => void; openActivity: (id: string) => void; back: () => void;
};
/** Account loading and its identity belong to the caller; undefined is never an empty result. */
export function CInvitationsPage({ invitations, busy, error, refresh, openActivity, back }: CInvitationsPageProps) {
  return <View className="c-ui c-home c-account-tools c-invitations-page">
    <AccountToolsHeading title="已保存邀请" back={back} />
    <Text className="c-account-tools-hint">保存邀请不代表报名或占位。</Text>
    {busy && <Text className="c-account-tools-hint">正在读取已保存邀请…</Text>}
    {error && <View className="c-account-tools-error"><Text className="c-account-tools-error-title">邀请暂未更新</Text><Text>{error}</Text>{invitations && invitations.length > 0 && <Text>以下为上次读取的邀请。</Text>}<CAction disabled={busy} onClick={refresh}>重试</CAction></View>}
    {invitations?.map(invitation => <Button className="c-saved-invitation" key={invitation.invitation_id} onClick={() => openActivity(invitation.activity_id)}>
      <View className="c-saved-invitation-heading"><Text>{invitation.title || '未命名活动'}</Text><Text className={`c-pill ${invitation.cancelled || !invitation.starts_at ? 'c-pill-lilac' : ''}`}>{invitation.cancelled ? '已取消' : invitation.status || (invitation.starts_at ? '状态待核实' : '时间待定')}</Text></View>
      <View className="c-saved-invitation-meta"><CIcon name="calendar" /><Text>{formatActivityTime(invitation.starts_at, invitation.timezone)} · {invitation.location || '地点待定'}</Text></View>
      <View className="c-saved-invitation-bottom"><Text>查看安排 ↗</Text></View>
    </Button>)}
    {!busy && !error && invitations === undefined && <View className="c-account-tools-empty"><Text>邀请尚未读取</Text><Text className="c-account-tools-hint">暂时无法确认已保存邀请，请重新读取。</Text><CAction onClick={refresh}>重新读取</CAction></View>}
    {!busy && !error && invitations?.length === 0 && <View className="c-account-tools-empty"><Text>暂无已保存邀请</Text><Text className="c-account-tools-hint">打开朋友分享的活动后，可主动保存邀请。</Text></View>}
  </View>;
}

export type CManualActivityPageProps = { value: string; change: (value: string) => void; busy: boolean; error: string; open: () => void; back: () => void };
export function CManualActivityPage({ value, change, busy, error, open, back }: CManualActivityPageProps) {
  const canOpen = !busy && value.trim().length > 0;
  const submit = () => { if (canOpen) open(); };
  return <View className="c-ui c-home c-account-tools c-manual-page">
    <AccountToolsHeading title="通过编号打开" back={back} />
    <Text className="c-manual-intro">通常点开朋友的微信分享即可进入活动。{'\n'}已有活动编号，也可以在这里查看。</Text>
    <Text className="c-manual-label">活动编号</Text>
    <Input className="c-manual-input" value={value} maxlength={100} placeholder="输入或粘贴活动编号" confirmType="done" disabled={busy} onInput={event => change(event.detail.value)} onConfirm={submit} />
    <Text className="c-manual-error">{error}</Text>
    <CAction className="c-account-tools-full" variant="primary" disabled={!canOpen} onClick={submit}>{busy ? '正在打开…' : '查看活动'}</CAction>
    <Text className="c-account-tools-hint c-account-tools-centered">查看活动不代表报名或占位。</Text>
  </View>;
}

export type CMoreMenuProps = { close: () => void; invitations: () => void; manual: () => void };
/** A short menu at the list's top right; intentionally does not reuse a bottom sheet. */
export function CMoreMenu({ close, invitations, manual }: CMoreMenuProps) {
  return <View className="c-ui c-more-menu-overlay" catchMove onClick={close}><View className="c-more-menu" onClick={event => event.stopPropagation()}>
    <Button onClick={invitations}><CIcon name="bookmark" /><Text>已保存邀请</Text><CIcon name="right" /></Button>
    <Button onClick={manual}><CIcon name="doc" /><Text>通过编号打开</Text><CIcon name="right" /></Button>
  </View></View>;
}

export type CLogoutDialogProps = { close: () => void; confirm: () => void; busy?: boolean; error?: string };
export function CLogoutDialog({ close, confirm, busy = false, error = '' }: CLogoutDialogProps) {
  return <View className="c-ui c-logout-overlay" catchMove onClick={() => { if (!busy) close(); }}><View className="c-logout-dialog" onClick={event => event.stopPropagation()}>
    <Text className="c-logout-title">退出登录？</Text>
    <Text className="c-logout-copy">退出后需重新登录查看本人活动与收藏，已保存记录不会删除。</Text>
    {error && <Text className="c-manual-error">{error}</Text>}
    <View className="c-logout-actions"><CAction disabled={busy} onClick={close}>取消</CAction><CAction variant="danger" disabled={busy} onClick={() => { if (!busy) confirm(); }}>{busy ? '正在退出…' : '退出'}</CAction></View>
  </View></View>;
}

export type CLoginSheetProps = { close: () => void; login: () => void; busy: boolean; error: string };
/** Uses the real login callback. It neither simulates identity nor requests profile authorization. */
export function CLoginSheet({ close, login, busy, error }: CLoginSheetProps) {
  return <CSheet className="c-account-login-sheet" title="微信登录" close={close} footer={<CAction variant="primary" disabled={busy} onClick={() => { if (!busy) login(); }}>{busy ? '正在登录…' : error ? '重新登录' : '微信登录'}</CAction>}>
    <Text className="c-login-copy">使用微信身份登录后，继续查看本人的活动、邀请和消息。</Text>
    <Text className="c-account-tools-hint">登录不会自动读取你的头像与昵称，也不要求先完善头像昵称。</Text>
    {error && <View className="c-account-tools-error"><Text className="c-account-tools-error-title">登录未完成</Text><Text>{error}</Text></View>}
  </CSheet>;
}
