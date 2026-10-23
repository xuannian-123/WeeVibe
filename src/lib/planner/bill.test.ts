import { describe, expect, it } from "vitest";
import type { Member, Receipt, ReceiptItem } from "../types";
import { splitBill } from "./index";
import { hashString, seededRandom } from "../map/geo";
import { member } from "./testutil";

const item = (id: string, name: string, price: number, tags: ReceiptItem["tags"] = [], qty = 1): ReceiptItem => ({ id, name, price, qty, tags });
const cents = (x: number) => Math.round(x * 100);
const sumCents = (split: ReturnType<typeof splitBill>) => Object.values(split.perMember).reduce((s, v) => s + cents(v.amount), 0);

describe("splitBill", () => {
  const a = member("A", 0, 0, { id: "a" });
  const b = member("B", 0, 0, { id: "b", priv: { billFacts: { noAlcohol: true } } });
  const c = member("C", 0, 0, { id: "c", priv: { dietTags: ["不吃辣"] } });

  it("没有特殊约束时平均分，分到分、总和守恒", () => {
    const r: Receipt = { items: [item("1", "锅底", 100, ["shared"])], total: 100 };
    const s = splitBill(r, [a, member("X", 0, 0, { id: "x" }), member("Y", 0, 0, { id: "y" })]);
    expect(Object.values(s.perMember).map((v) => v.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(sumCents(s)).toBe(10000);
    expect(s.explain).toEqual(["按人头平均分摊"]);
  });

  it("酒水只分给没标 noAlcohol 的人；辣锅不摊给不吃辣的", () => {
    const r: Receipt = {
      items: [item("1", "啤酒", 10, ["alcohol", "drink"], 6), item("2", "麻辣锅底", 60, ["spicy", "shared"]), item("3", "肥牛", 90, ["beef"])],
      total: 210,
    };
    const s = splitBill(r, [a, b, c]);
    // 啤酒 60：A、C 各 30；辣锅 60：A、B 各 30；肥牛 90：各 30
    expect(s.perMember.a.amount).toBe(90);
    expect(s.perMember.b.amount).toBe(60);
    expect(s.perMember.c.amount).toBe(60);
    expect(s.perMember.b.lines).toContainEqual({ itemName: "啤酒 ×6", amount: 0, reason: "你没喝酒，酒水不摊" });
    expect(s.perMember.c.lines).toContainEqual({ itemName: "麻辣锅底", amount: 0, reason: "你不吃辣，辣的不摊" });
    expect(s.explain).toContain("酒水只由喝酒的人分摊");
    expect(s.explain).toContain("辣锅 / 辣菜不摊给不吃辣的人");
    expect(s.explain.join("")).not.toMatch(/[ABC]/); // 不点名
  });

  it("牛肉 / 海鲜 / 内脏按忌口；skipItems 按名字；提前走的人少摊非共享菜", () => {
    const veg = member("V", 0, 0, { id: "v", priv: { dietTags: ["不吃牛肉", "不吃海鲜", "不吃内脏"] } });
    const skip = member("S", 0, 0, { id: "s", priv: { billFacts: { skipItems: ["虾滑"] } } });
    const early = member("E", 0, 0, { id: "e", priv: { billFacts: { leftEarly: true } } });
    const r: Receipt = {
      items: [
        item("1", "肥牛", 30, ["beef"]),
        item("2", "毛肚", 30, ["offal"]),
        item("3", "虾滑", 30, ["seafood"]),
        item("4", "锅底", 50, ["shared"]),
        item("5", "蔬菜拼盘", 50),
      ],
      total: 190,
    };
    const s = splitBill(r, [veg, skip, early]);
    // 肥牛 / 毛肚：S 和 E(0.5) → S 20 E 10；虾滑：只有 E → 30；锅底：三人平均；蔬菜：1:1:0.5
    expect(s.perMember.v.lines.find((l) => l.itemName === "肥牛")!.amount).toBe(0);
    expect(s.perMember.s.lines.find((l) => l.itemName === "肥牛")!.amount).toBe(20);
    expect(s.perMember.e.lines.find((l) => l.itemName === "肥牛")).toMatchObject({ amount: 10, reason: "提前走了，少摊一半" });
    expect(s.perMember.s.lines.find((l) => l.itemName === "虾滑")).toMatchObject({ amount: 0, reason: "你说没吃这个，不摊" });
    expect(s.perMember.e.lines.find((l) => l.itemName === "虾滑")!.amount).toBe(30);
    expect(s.perMember.e.lines.find((l) => l.itemName === "锅底")!.amount).toBeCloseTo(16.66, 2);
    expect(s.perMember.v.lines.find((l) => l.itemName === "蔬菜拼盘")!.amount).toBe(20);
    expect(s.perMember.e.lines.find((l) => l.itemName === "蔬菜拼盘")!.amount).toBe(10);
    expect(sumCents(s)).toBe(19000);
    expect(s.explain).toContain("有人提前离开，少摊了部分菜");
    expect(s.explain).toContain("有人没吃的菜，不摊给他");
  });

  it("服务费 / 折扣按比例；没人该摊的菜大家一起摊", () => {
    const r: Receipt = { items: [item("1", "啤酒", 30, ["alcohol"]), item("2", "菜", 70)], serviceFee: 10, discount: 20.5, total: 89.5 };
    const s = splitBill(r, [b, member("B2", 0, 0, { id: "b2", priv: { billFacts: { noAlcohol: true } } })]);
    expect(s.perMember.b.amount).toBe(44.75);
    expect(sumCents(s)).toBe(8950);
    expect(s.perMember.b.lines.map((l) => l.itemName)).toEqual(["啤酒", "菜", "服务费", "优惠"]);
    expect(s.explain).toEqual(["服务费按各人消费比例分摊", "优惠按各人消费比例抵扣"]);
  });

  it("随机 300 张小票：各人之和（分）严格等于 total", () => {
    const tags: ReceiptItem["tags"][] = [[], ["alcohol"], ["spicy"], ["beef"], ["seafood"], ["offal"], ["shared"], ["spicy", "shared"], ["meat"]];
    for (let run = 0; run < 300; run++) {
      const r = seededRandom(hashString(`bill|${run}`));
      const people: Member[] = Array.from({ length: 1 + Math.floor(r() * 7) }, (_, i) =>
        member(`P${i}`, 0, 0, {
          id: `p${i}`,
          priv: {
            dietTags: r() < 0.3 ? ["不吃辣"] : r() < 0.2 ? ["素食"] : [],
            billFacts: { noAlcohol: r() < 0.4, leftEarly: r() < 0.2, skipItems: r() < 0.2 ? ["菜1"] : [] },
          },
        }),
      );
      const items = Array.from({ length: 1 + Math.floor(r() * 10) }, (_, i) =>
        item(`${i}`, `菜${i}`, Math.round(r() * 20000) / 100, tags[Math.floor(r() * tags.length)], 1 + Math.floor(r() * 3)),
      );
      const sub = items.reduce((s, it) => s + cents(it.price * it.qty), 0);
      const fee = r() < 0.5 ? Math.round(r() * 3000) / 100 : undefined;
      const discount = r() < 0.5 ? Math.round(r() * 2000) / 100 : undefined;
      const total = Math.round(sub + cents(fee ?? 0) - cents(discount ?? 0) - Math.floor(r() * 100)) / 100; // 带抹零
      const s = splitBill({ items, total, serviceFee: fee, discount }, people);
      expect(sumCents(s)).toBe(cents(total));
      for (const v of Object.values(s.perMember)) expect(cents(v.amount)).toBe(Math.round(v.amount * 100));
    }
  });
});
