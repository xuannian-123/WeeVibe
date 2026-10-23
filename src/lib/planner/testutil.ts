// 测试用工厂函数（只被 *.test.ts 引用）
import type { Ju, JuSpec, Member, MemberPrivate, Slot } from "../types";

export function spec(over: Partial<JuSpec> = {}): JuSpec {
  return {
    category: "火锅",
    poiKeywords: ["火锅"],
    headcount: 6,
    budgetPerPerson: 100,
    dates: ["2026-10-23"],
    earliest: "18:00",
    latest: "20:00",
    durationMinutes: 150,
    city: "苏州",
    ...over,
  };
}

export function priv(over: Partial<MemberPrivate> = {}): MemberPrivate {
  return {
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
    ...over,
  };
}

let seq = 0;
/** v3 成员：私密字段放 over.priv */
export function member(
  name: string,
  lat: number,
  lng: number,
  over: Partial<Member> & { priv?: Partial<MemberPrivate> } = {},
): Member {
  seq++;
  const { priv: p, ...rest } = over;
  return {
    id: rest.id ?? `m${seq}`,
    juId: "j1",
    name,
    avatar: "🙂",
    location: { lat, lng, label: name },
    role: "guest",
    intake: "done",
    status: "in",
    joinedAt: "2026-10-22T10:00:00+08:00",
    isOrganizer: false,
    ...rest,
    private: priv(p),
  };
}

export function ju(s: JuSpec, slots: Slot[], over: Partial<Ju> = {}): Ju {
  return {
    id: "j1",
    title: "测试局",
    rawPrompt: "周五晚上 6 个人吃火锅人均 100",
    spec: s,
    slots,
    status: "collecting",
    createdAt: "2026-10-22T10:00:00+08:00",
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    ...over,
  };
}
