import { getToken } from '../../platform/api';
import type { CActivityBrowseState } from './activity-overview';

export const cAccountPages = ['activities', 'settings', 'privacy', 'help', 'about', 'invitations', 'number'] as const;
export type CAccountPage = typeof cAccountPages[number];
export type CActivityEntry = 'all' | 'managed' | 'joined';
export function isCAccountPage(value: unknown): value is CAccountPage { return cAccountPages.includes(value as CAccountPage); }
export function cAccountUrl(page: CAccountPage, group?: CActivityEntry) { return `/pages/account/index?page=${page}${page === 'activities' && group ? `&group=${group}` : ''}`; }

// Presentation only, held in memory. No account data or draft is persisted here.
let cached: CActivityBrowseState | undefined;
export function clearCActivityBrowse() { cached = undefined; }
export function rememberCActivityBrowse(value: CActivityBrowseState) {
  if (value.session && value.session === getToken()) cached = { ...value, groups: { managed: { ...value.groups.managed }, joined: { ...value.groups.joined } } };
}
export function readCActivityBrowse(session: string | undefined, group?: CActivityEntry): CActivityBrowseState | undefined {
  if (!session || getToken() !== session || cached?.session !== session) return undefined;
  return { ...cached, group: group === 'managed' || group === 'joined' ? group : cached.group, groups: { managed: { ...cached.groups.managed }, joined: { ...cached.groups.joined } } };
}
