// 全国定位：城市按 IP 猜 / 按第一个出发地校正；私聊里的地名走地理编码（全国），上海小词典只在上海的局里用。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { describe, expect, it } from "vitest";
import { chatTurn, placeQueryOf } from "../llm/chat";
import { normalizeCity } from "../map/amap";
import type { Ju, Member, Place } from "../types";
import { clientIpOf } from "./http";
import { withCityFrom } from "./ju";

describe("地名判断", () => {
  it("像地名的才去查；私密备注、预算、客套话都不查", () => {
    expect(placeQueryOf("我从中关村出发")).toBe("中关村");
    expect(placeQueryOf("住在天河区体育西路")).toBe("天河区体育西路");
    expect(placeQueryOf("浙大紫金港校区")).toBe("浙大紫金港校区");
    expect(placeQueryOf("这周在减肥别太油")).toBeUndefined();
    expect(placeQueryOf("人均八十左右")).toBeUndefined();
    expect(placeQueryOf("都行")).toBeUndefined();
    expect(placeQueryOf("好的")).toBeUndefined();
  });
});

describe("城市", () => {
  it("高德的城市名规范化：直辖市 / 地级市都去掉'市'，空数组当不知道", () => {
    expect(normalizeCity("北京市")).toBe("北京");
    expect(normalizeCity("苏州市")).toBe("苏州");
    expect(normalizeCity("香港特别行政区")).toBe("香港");
    expect(normalizeCity("[]")).toBeUndefined();
    expect(normalizeCity("")).toBeUndefined();
  });

  it("城市是不是亲口说的：原话里出现才算，否则记成猜的（之后可以按出发地校正）", () => {
    const spec = { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:00", latest: "19:00", durationMinutes: 120, city: "成都" };
    expect(withCityFrom(spec, "周五在成都吃火锅", "ip").cityFrom).toBe("said");
    expect(withCityFrom(spec, "周五吃火锅", "ip").cityFrom).toBe("ip");
    expect(withCityFrom({ ...spec, city: "上海" }, "周五吃火锅", "default").cityFrom).toBe("default");
  });

  it("请求者 IP：取 X-Real-IP / X-Forwarded-For 第一个，内网和本机地址不算", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(clientIpOf(req({ "x-real-ip": "114.247.50.2" }))).toBe("114.247.50.2");
    expect(clientIpOf(req({ "x-forwarded-for": "223.5.5.5, 10.0.0.1" }))).toBe("223.5.5.5");
    expect(clientIpOf(req({ "x-real-ip": "127.0.0.1" }))).toBeUndefined();
    expect(clientIpOf(req({ "x-real-ip": "192.168.1.8" }))).toBeUndefined();
    expect(clientIpOf(req({}))).toBeUndefined();
  });
});

describe("私聊里的地名：全国地理编码", () => {
  const ju = (city: string): Ju => ({
    id: "j",
    title: "周五火锅",
    rawPrompt: "",
    spec: { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:00", latest: "19:00", durationMinutes: 120, city },
    slots: [],
    status: "collecting",
    createdAt: "2030-10-30T00:00:00Z",
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
  });
  const me = (): Member => ({
    id: "m1",
    juId: "j",
    name: "小林",
    avatar: "🙂",
    role: "guest",
    intake: "chatting",
    status: "in",
    joinedAt: "2030-10-30T00:00:00Z",
    isOrganizer: false,
    private: {
      chat: [{ role: "juzhang", text: "你从哪儿出发？", at: "2030-10-30T00:00:00Z", ask: "location" }],
      rsvp: "yes",
      availability: {},
      dietTags: [],
      notes: [],
      swipes: {},
      autoFilled: [],
      wants: [],
      matches: [],
      billFacts: {},
      inbox: [],
    },
  });
  const zgc: Place = { label: "中关村", lat: 39.9832, lng: 116.3105 };

  it("北京的局：'我从中关村出发'查高德拿到坐标；'南站'不会被认成上海南站", async () => {
    const asked: string[] = [];
    const resolvePlace = async (q: string) => (asked.push(q), q === "中关村" ? zgc : undefined);
    const r = await chatTurn({ ju: ju("北京"), me: me(), userText: "我从中关村出发", quorumPending: false, now: new Date(), resolvePlace });
    expect(r.patch.location).toEqual(zgc);
    expect(asked).toEqual(["中关村"]);
    const r2 = await chatTurn({ ju: ju("北京"), me: me(), userText: "南站", quorumPending: false, now: new Date(), resolvePlace: async () => undefined });
    expect(r2.patch.location?.label).not.toBe("上海南站");
  });

  it("上海的局：小词典照常用（不用联网）", async () => {
    const r = await chatTurn({ ju: ju("上海"), me: me(), userText: "漕河泾", quorumPending: false, now: new Date() });
    expect(r.patch.location?.label).toBe("漕河泾");
  });

  it("私密备注不会被当成地名去查", async () => {
    const asked: string[] = [];
    await chatTurn({ ju: ju("北京"), me: me(), userText: "这周在减肥别太油", quorumPending: false, now: new Date(), resolvePlace: async (q) => (asked.push(q), zgc) });
    expect(asked).toEqual([]);
  });
});
