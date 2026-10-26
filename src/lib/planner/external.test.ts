import { describe, expect, it } from "vitest";
import type { Slot, WeatherDay } from "../types";
import { classifyWeather, openFits, parseOpenTime, risksFor, slotWeather, weatherEffects } from "./external";
import { bjIso } from "./util";

const slot = (date: string, hm: string, minutes = 120): Slot => {
  const [h, m] = hm.split(":").map(Number);
  const start = bjIso(date, h * 60 + m);
  return { id: `${date}T${hm}`, start, end: new Date(new Date(start).getTime() + minutes * 60_000).toISOString() };
};
const W = (date: string, day: string, night: string, temp = 22): WeatherDay => ({
  date,
  day: { text: day, temp, windPower: "1-3" },
  night: { text: night, temp: temp - 6, windPower: "1-3" },
});

describe("营业时间", () => {
  it("解析单段、多段、跨午夜", () => {
    expect(parseOpenTime("11:00-21:30")).toEqual([{ open: 660, close: 1290 }]);
    expect(parseOpenTime("10:00-14:00 17:00-22:00")).toEqual([{ open: 600, close: 840 }, { open: 1020, close: 1320 }]);
    expect(parseOpenTime("17:00-04:00")).toEqual([{ open: 1020, close: 1680 }]);
    expect(parseOpenTime("")).toBeUndefined();
    expect(parseOpenTime("全天")).toBeUndefined();
  });

  it("结束要比打烊早 15 分钟；不知道就说不知道", () => {
    expect(openFits("11:00-21:30", 19 * 60, 21 * 60).fit).toBe("yes");
    expect(openFits("11:00-21:30", 19 * 60 + 30, 21 * 60 + 30)).toMatchObject({ fit: "no", closeAt: "21:30" });
    expect(openFits("11:00-21:30", 19 * 60, 21 * 60 + 20).fit).toBe("no");
    expect(openFits("17:00-04:00", 22 * 60, 24 * 60 + 60).fit).toBe("yes");
    expect(openFits("10:00-14:00 17:00-22:00", 15 * 60, 17 * 60).fit).toBe("no");
    expect(openFits(undefined, 19 * 60, 21 * 60).fit).toBe("unknown");
  });
});

describe("天气", () => {
  it("档位", () => {
    expect(classifyWeather("晴")).toBe("ok");
    expect(classifyWeather("多云")).toBe("ok");
    expect(classifyWeather("小雨")).toBe("light");
    expect(classifyWeather("阵雨")).toBe("light");
    expect(classifyWeather("中雨")).toBe("heavy");
    expect(classifyWeather("雷阵雨")).toBe("heavy");
    expect(classifyWeather("小雪")).toBe("heavy");
  });

  it("18 点前看白天，之后看夜间；4 天外是未知", () => {
    const fc = [W("2030-11-01", "晴", "小雨")];
    expect(slotWeather(fc, slot("2030-11-01", "15:00"))).toMatchObject({ kind: "ok", label: "周五白天" });
    expect(slotWeather(fc, slot("2030-11-01", "19:00"))).toMatchObject({ kind: "light", label: "周五夜间" });
    expect(slotWeather(fc, slot("2030-11-09", "19:00")).kind).toBe("unknown");
  });

  it("户外 + 中雨以上不成立；户外 + 小雨扣分；室内只影响通勤", () => {
    const park = { name: "滨江草坪", type: "风景名胜;公园" };
    const resto = { name: "某餐厅", type: "餐饮服务;中餐厅" };
    const heavy = slotWeather([W("2030-11-01", "中雨", "中雨")], slot("2030-11-01", "15:00"));
    const light = slotWeather([W("2030-11-01", "小雨", "小雨")], slot("2030-11-01", "15:00"));
    expect(weatherEffects(heavy, park).infeasible).toBe(true);
    expect(weatherEffects(heavy, resto)).toMatchObject({ infeasible: false, commuteFactor: 1.25, penalty: 0 });
    expect(weatherEffects(light, park)).toMatchObject({ infeasible: false, commuteFactor: 1.15, penalty: 12 });
    const hot = slotWeather([W("2030-11-01", "晴", "晴", 36)], slot("2030-11-01", "15:00"));
    expect(weatherEffects(hot, park).penalty).toBe(10);
  });

  it("风险：每条都带应对办法；室内的店下雨只提醒带伞", () => {
    const s = slot("2030-11-01", "19:00");
    const rain = slotWeather([W("2030-11-01", "晴", "小雨")], s);
    const r1 = risksFor(s, { name: "某餐厅", type: "餐饮服务;中餐厅", indoor: true, openTime: "11:00-21:30" }, rain, openFits("11:00-21:30", 1140, 1260), 20);
    expect(r1.map((r) => r.kind)).toEqual(["weather", "closing", "queue"]);
    expect(r1[0].mitigation).toContain("室内，不受影响");
    expect(r1[1].text).toBe("店 21:30 打烊，我们 21:00 结束");
    expect(r1.every((r) => r.mitigation)).toBe(true);
    const far = slot("2030-11-09", "15:00");
    const r2 = risksFor(far, { name: "露营地", type: "体育休闲服务;露营" }, slotWeather([], far), openFits(undefined, 900, 1020), 0);
    expect(r2.map((r) => r.kind)).toEqual(["weather", "closing"]);
    expect(r2[0].confidence).toBe("unknown");
    const late = slot("2030-11-01", "21:30");
    expect(risksFor(late, { name: "a", type: "b", indoor: true }, slotWeather([], late), { fit: "yes", closeMin: 1680, closeAt: "04:00" }, 0).some((r) => r.kind === "lateNight")).toBe(true);
  });
});
