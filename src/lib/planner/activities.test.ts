// v6 活动层（docs/AVATAR.md 3.2 / 3.3）：活动库完整性、中文说法识别、契合度打分。
import { describe, expect, it } from "vitest";
import type { MemberPrivate, Mood, Need, WeatherDay } from "../types";
import { ACTIVITY_LIB, activitiesIn, activityByKey, activityFit, moodFit, scoreActivities, singleFit } from "./activities";
import { CARE_FLOOR } from "./experience";
import { member, spec } from "./testutil";

const DAY = "2030-11-02"; // 周六
const S = spec({ category: "局长定", poiKeywords: ["餐厅"], open: true, dates: [DAY], earliest: "14:00", latest: "16:00", budgetPerPerson: undefined });
const need = (rule: Need["rule"], dim: Need["dim"], kind: Need["kind"] = "soft", strength: Need["strength"] = 2): Need => ({
  id: `n-${rule.t}`,
  dim,
  kind,
  strength,
  rule,
  text: rule.t,
  source: "chat",
  at: "2030-10-30T10:00:00+08:00",
});
const who = (id: string, priv: Partial<MemberPrivate> = {}) => member(id, 31.27, 120.73, { id, priv });
const fitOf = (key: string, m = who("x"), s = S, forecast: WeatherDay[] = []) => activityFit(m, activityByKey(key)!, { spec: s, forecast });

describe("活动库", () => {
  it("≥ 24 种，key 唯一，吃 / 喝 / 玩 / 看 / 户外都有", () => {
    expect(ACTIVITY_LIB.length).toBeGreaterThanOrEqual(24);
    expect(new Set(ACTIVITY_LIB.map((a) => a.key)).size).toBe(ACTIVITY_LIB.length);
    for (const g of ["eat", "drink", "play", "see", "outdoor"]) expect(ACTIVITY_LIB.some((a) => a.group === g)).toBe(true);
  });

  it("覆盖 AVATAR.md 3.2 的清单", () => {
    const names = ACTIVITY_LIB.map((a) => `${a.name}|${a.aliases.join("|")}`).join("|");
    for (const w of ["火锅", "烧烤", "家常菜", "日料", "西餐", "自助", "小吃", "咖啡", "清吧", "奶茶", "桌游", "剧本杀", "密室", "ktv", "电玩", "台球", "保龄球", "射箭", "攀岩", "羽毛球", "展览", "电影", "livehouse", "徒步", "野餐", "骑行", "露营"])
      expect(names.toLowerCase()).toContain(w.toLowerCase());
  });

  it("属性合理：区间有序、时长 / 人数在常识范围、户外不在室内、吃饭的才是 food", () => {
    for (const a of ACTIVITY_LIB) {
      expect(a.cost[0]).toBeLessThanOrEqual(a.cost[1]);
      expect(a.cost[1]).toBeLessThanOrEqual(300);
      expect(a.minutes).toBeGreaterThanOrEqual(60);
      expect(a.minutes).toBeLessThanOrEqual(300);
      expect(a.people[0]).toBeLessThanOrEqual(a.people[1]);
      expect(a.poiKeywords.length).toBeGreaterThan(0);
      expect(a.aliases.length).toBeGreaterThan(0);
      expect([0, 1, 2, 3]).toContain(a.energy);
      expect([0, 1, 2]).toContain(a.talk);
      expect(a.food).toBe(a.group === "eat");
      if (a.group === "outdoor") expect(a.indoor).toBe(false);
      if (!a.food) expect(a.halal && a.veg).toBe(true);
    }
    // 几个常识：攀岩最累、KTV 吵且聊不了、清吧有酒、剧本杀不能中途加入
    expect(activityByKey("climbing")!.energy).toBe(3);
    expect(activityByKey("ktv")).toMatchObject({ loud: true, talk: 0 });
    expect(activityByKey("bar")!.alcohol).toBe(true);
    expect(activityByKey("jubensha")!.lateJoin).toBe(false);
    expect(activityByKey("nope")).toBeUndefined();
  });
});

describe("activitiesIn：常见中文说法", () => {
  it.each([
    ["周五吃火锅", ["hotpot"]],
    ["下班去唱K", ["ktv"]],
    ["周末爬山", ["hiking"]],
    ["吃饭或者桌游", ["homestyle", "boardgame"]],
    ["先攀岩再吃饭", ["climbing", "homestyle"]],
    ["周五聚餐吃火锅", ["hotpot"]],
    ["撸串喝酒", ["bbq"]],
    ["看电影还是密室", ["movie", "escape"]],
    ["今晚 KTV", ["ktv"]],
    ["周六大家聚一下", []],
  ])("%s → %j", (text, keys) => {
    expect(activitiesIn(text)).toEqual(keys);
  });
});

describe("契合度打分", () => {
  it("心情：想躺的人去攀岩低于保底线；想动的人去攀岩很合适", () => {
    expect(moodFit("lazy", activityByKey("climbing")!)).toBeLessThan(-20);
    expect(singleFit(fitOf("climbing", who("l", { mood: "lazy" })))).toBeLessThan(CARE_FLOOR);
    expect(singleFit(fitOf("climbing", who("a", { mood: "active" })))).toBeGreaterThan(80);
    expect(singleFit(fitOf("ktv", who("c", { mood: "chill" })))).toBeLessThan(singleFit(fitOf("coffee", who("c", { mood: "chill" }))));
  });

  it("想躺的人不会被排去攀岩：全是想躺的，攀岩排在最后一档、第一名不累", () => {
    const ms = ["a", "b", "c", "d"].map((id) => who(id, { mood: "lazy" as Mood }));
    const ranked = scoreActivities(ms, S);
    expect(ranked[0].act.energy).toBe(0);
    const climb = ranked.find((r) => r.key === "climbing")!;
    expect(climb.cared).toBe(0);
    expect(ranked.indexOf(climb)).toBeGreaterThan(ranked.length / 2);
  });

  it("清真：烤肉 / 日料 / 西餐 / 自助直接排除，火锅（可找清真店）、桌游不排除", () => {
    const m = who("h", { dietTags: ["清真"] });
    for (const k of ["korean_bbq", "japanese", "western", "buffet"]) expect(fitOf(k, m).hard).toBe(true);
    for (const k of ["hotpot", "homestyle", "boardgame", "climbing"]) expect(fitOf(k, m).hard).toBe(false);
    // 清吧不算底线，但以喝酒为主，扣得很多
    expect(singleFit(fitOf("bar", m))).toBeLessThan(singleFit(fitOf("coffee", m)) - 20);
  });

  it("素食：火锅 / 烧烤 / 烤肉排除", () => {
    const m = who("v", { dietTags: ["素食"] });
    for (const k of ["hotpot", "bbq", "korean_bbq"]) expect(fitOf(k, m).hard).toBe(true);
    expect(fitOf("homestyle", m).hard).toBe(false);
  });

  it("下雨：中雨以上户外不成立，小雨户外降级，室内不受影响", () => {
    const wx = (text: string): WeatherDay[] => [{ date: DAY, day: { text, temp: 20, windPower: "≤3" }, night: { text, temp: 18, windPower: "≤3" } }];
    expect(fitOf("hiking", who("x"), S, wx("中雨")).hard).toBe(true);
    const ranked = scoreActivities([who("a"), who("b")], S, wx("大雨"));
    expect(ranked.filter((r) => r.excluded).map((r) => r.key).sort()).toEqual(["camping", "cycling", "hiking", "picnic"]);
    expect(ranked.slice(-4).every((r) => r.excluded)).toBe(true);
    const sunny = singleFit(fitOf("picnic", who("x"), S, wx("晴")));
    expect(singleFit(fitOf("picnic", who("x"), S, wx("小雨")))).toBeLessThan(sunny);
    expect(singleFit(fitOf("boardgame", who("x"), S, wx("小雨")))).toBe(singleFit(fitOf("boardgame", who("x"), S, wx("晴"))));
  });

  it("预算：最便宜的都远超预算 = 底线；略超只扣分", () => {
    const m = who("p", { budgetMax: 40, budgetStrength: 3 });
    expect(fitOf("japanese", m).hard).toBe(true);
    expect(fitOf("boardgame", m).hard).toBe(false);
    expect(singleFit(fitOf("boardgame", m))).toBeLessThan(singleFit(fitOf("boardgame")));
    expect(singleFit(fitOf("milktea", m))).toBe(singleFit(fitOf("milktea")));
  });

  it("身体：确认过的底线排除累的活动，软的只扣分", () => {
    const hard = who("k", { needs: [need({ t: "maxCommute", minutes: 25 }, "body", "hard", 3)] });
    expect(fitOf("climbing", hard).hard).toBe(true);
    expect(fitOf("boardgame", hard).hard).toBe(false);
    const soft = who("s", { needs: [need({ t: "maxCommute", minutes: 25 }, "body", "soft", 3)] });
    expect(fitOf("climbing", soft).hard).toBe(false);
    expect(singleFit(fitOf("climbing", soft))).toBeLessThan(singleFit(fitOf("climbing")) - 30);
    // 档案里的身体限制（没确认成底线）也算软的
    const prof = activityFit(who("q"), activityByKey("badminton")!, { spec: S, profile: { body: ["膝盖不好"] } });
    expect(prof.hard).toBe(false);
    expect(singleFit(prof)).toBeLessThan(singleFit(fitOf("badminton")));
  });

  it("想去 / 不想去 / 怕吵 / 不喝酒，以及档案里的活动口味", () => {
    const m = who("w", { needs: [need({ t: "preferCategory", words: ["火锅"] }, "activity"), need({ t: "avoidCategory", words: ["KTV"] }, "activity")] });
    expect(fitOf("hotpot", m).prefer?.hit).toBe(true);
    expect(singleFit(fitOf("hotpot", m))).toBeGreaterThan(singleFit(fitOf("bbq", m)));
    expect(singleFit(fitOf("ktv", m))).toBeLessThan(singleFit(fitOf("ktv")) - 25);
    const q = who("q", { needs: [need({ t: "quiet" }, "ambience"), need({ t: "noAlcohol" }, "ambience")] });
    expect(singleFit(fitOf("livehouse", q))).toBeLessThan(singleFit(fitOf("livehouse")) - 30);
    const fan = activityFit(who("f"), activityByKey("boardgame")!, { spec: S, profile: { activityTastes: { boardgame: 1, ktv: -1 } } });
    expect(singleFit(fan)).toBe(singleFit(fitOf("boardgame")) + 15);
  });

  it("人数不在活动适合的范围里一起扣（2 个人玩剧本杀）", () => {
    const two = scoreActivities([who("a"), who("b")], S).find((r) => r.key === "jubensha")!;
    const six = scoreActivities(["a", "b", "c", "d", "e", "f"].map((id) => who(id)), S).find((r) => r.key === "jubensha")!;
    expect(two.fits[0]).toBeLessThan(six.fits[0]);
  });

  it("候选池：只在发起人给的活动里挑", () => {
    const ranked = scoreActivities([who("a"), who("b")], { ...S, open: false, activities: ["hotpot", "boardgame", "nope"] });
    expect(ranked.map((r) => r.key).sort()).toEqual(["boardgame", "hotpot"]);
  });

  it("确定性：同样的输入，同样的排序和分数", () => {
    const ms = [who("a", { mood: "active" }), who("b", { mood: "chill", dietTags: ["清真"] }), who("c", { budgetMax: 60 })];
    expect(JSON.stringify(scoreActivities(ms, S))).toBe(JSON.stringify(scoreActivities(structuredClone(ms), S)));
  });
});
