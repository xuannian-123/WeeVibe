// 局长私信（站内信）：只在本人视图里出现。
// 这里的函数只改内存里的 Member 对象，调用方负责 upsertMember 保存。
import { nanoid } from "nanoid";
import type { Member, MemberPrivate, Notice } from "../../types";

/** 站内信最多保留多少条（老的丢掉） */
export const INBOX_MAX = 50;

/** 保证 m.private 存在（老数据 / 别人漏初始化时兜底） */
export function ensurePrivate(m: Member): MemberPrivate {
  if (!m.private) {
    m.private = {
      chat: [],
      availability: {},
      dietTags: [],
      notes: [],
      swipes: {},
      autoFilled: [],
      wants: [],
      matches: [],
      billFacts: {},
      inbox: [],
    };
  }
  if (!Array.isArray(m.private.inbox)) m.private.inbox = [];
  return m.private;
}

function push(m: Member, n: Notice): void {
  const p = ensurePrivate(m);
  p.inbox.push(n);
  if (p.inbox.length > INBOX_MAX) p.inbox.splice(0, p.inbox.length - INBOX_MAX);
}

/** 给某个人发一条私信 */
export function pushNotice(m: Member, kind: Notice["kind"], text: string, now: Date): void {
  push(m, { id: nanoid(10), at: now.toISOString(), kind, text });
}

/**
 * 幂等版：同一个 key 只发一次（key 直接当 notice.id）。
 * 定时任务靠它保证"连 tick 几次也只发一条"。返回是否真的发了。
 */
export function pushNoticeOnce(m: Member, kind: Notice["kind"], key: string, text: string, now: Date): boolean {
  if (hasNotice(m, key)) return false;
  push(m, { id: key, at: now.toISOString(), kind, text });
  return true;
}

export function hasNotice(m: Member, key: string): boolean {
  return (m.private?.inbox ?? []).some((n) => n.id === key);
}

export function unreadCount(m: Member): number {
  return (m.private?.inbox ?? []).filter((n) => !n.read).length;
}

/** 标记已读；ids 为空时全部标记。返回是否有变化 */
export function markRead(m: Member, ids?: string[]): boolean {
  const want = ids && ids.length ? new Set(ids) : null;
  let changed = false;
  for (const n of m.private?.inbox ?? []) {
    if (!n.read && (!want || want.has(n.id))) {
      n.read = true;
      changed = true;
    }
  }
  return changed;
}
