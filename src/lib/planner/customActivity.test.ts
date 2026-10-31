import { describe, expect, it } from "vitest";
import type { JuSpec, Member } from "../types";
import { activityByKey, candidatePool, CUSTOM_PREFIX, libActivityOfWord, scoreActivities } from "./activities";

const spec: JuSpec = { category: "局长定", poiKeywords: ["餐厅"], dates: ["2030-11-02"], earliest: "14:00", latest: "16:00", durationMinutes: 180, city: "上海", open: true };
const who = (id: string, words: string[]): Member =>
  ({
    id,
    juId: "j",
    name: id,
    avatar: "🐱",
    role: "guest",
    intake: "done",
    status: "in",
    joinedAt: "2030-01-01T00:00:00Z",
    isOrganizer: false,
    private: {
      chat: [], availability: {}, dietTags: [], notes: [], swipes: {}, autoFilled: [], wants: [], matches: [], billFacts: {}, inbox: [],
      needs: words.length ? [{ id: "n1", dim: "activity", kind: "soft", strength: 2, rule: { t: "preferCategory", words }, text: `想去${words[0]}`, source: "widget", at: "" }] : [],
    },
  }) as Member;

describe("想干什么里自己写的活动", () => {
  it("活动库里有的说法归到那个活动", () => {
    expect(libActivityOfWord("唱歌")?.key).toBe("ktv");
    expect(libActivityOfWord("陶艺")).toBeUndefined();
  });
  it("库里没有的进候选池：用这个词搜店，key 能还原", () => {
    const pool = candidatePool(spec, [who("a", ["陶艺"]), who("b", [])]);
    const c = pool.find((a) => a.key === `${CUSTOM_PREFIX}陶艺`)!;
    expect(c).toMatchObject({ name: "陶艺", poiKeywords: ["陶艺"], food: false });
    expect(activityByKey(c.key)?.name).toBe("陶艺");
    expect(pool.find((a) => a.key === `${CUSTOM_PREFIX}猫咖`)).toBeUndefined();
  });
  it("发起人把候选定死时不加；顺序和谁写的无关", () => {
    expect(candidatePool({ ...spec, open: undefined, activities: ["hotpot", "boardgame"] }, [who("a", ["陶艺"])]).map((a) => a.key)).toEqual(["hotpot", "boardgame"]);
    const k1 = candidatePool(spec, [who("a", ["陶艺"]), who("b", ["保龄球馆"])]).map((a) => a.key);
    const k2 = candidatePool(spec, [who("b", ["保龄球馆"]), who("a", ["陶艺"])]).map((a) => a.key);
    expect(k1).toEqual(k2);
  });
  it("对写的人算命中", () => {
    const scores = scoreActivities([who("a", ["陶艺"])], spec);
    const fit = scores.find((s) => s.key === `${CUSTOM_PREFIX}陶艺`)!.detail[0];
    expect(fit.prefer?.hit).toBe(true);
  });
});
