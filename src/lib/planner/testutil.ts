// 测试用工厂函数（只被 *.test.ts 引用）
import type { DietTag, Ju, JuSpec, Member } from "../types";

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

let seq = 0;
export function member(
  name: string,
  lat: number,
  lng: number,
  over: Partial<Member> & { dietTags?: DietTag[] } = {},
): Member {
  seq++;
  return {
    id: over.id ?? `m${seq}`,
    juId: "j1",
    name,
    avatar: "🙂",
    location: { lat, lng, label: name },
    availableSlotIds: [],
    dietRaw: "",
    dietTags: [],
    status: "in",
    joinedAt: "2026-10-22T10:00:00+08:00",
    isOrganizer: false,
    ...over,
  };
}

export function ju(s: JuSpec, slots: Ju["slots"]): Ju {
  return {
    id: "j1",
    title: "测试局",
    rawPrompt: "周五晚上 6 个人吃火锅人均 100",
    spec: s,
    slots,
    status: "collecting",
    createdAt: "2026-10-22T10:00:00+08:00",
    votes: {},
  };
}
