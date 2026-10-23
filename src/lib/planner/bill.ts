// #15 拍小票分账：按私密约束逐项分摊。全程以"分"为单位整数计算，各人之和严格等于 receipt.total。
import type { BillShareLine, BillSplit, Member, Receipt, ReceiptItem, ReceiptItemTag } from "../types";
import { apportion } from "./util";

const toCents = (yuan: number | undefined) => (Number.isFinite(yuan) ? Math.round((yuan as number) * 100) : 0);
const toYuan = (cents: number) => Math.round(cents) / 100;

/** 某人不该摊这道菜的原因（只给本人看）；undefined = 正常摊 */
function excludeReason(m: Member, item: ReceiptItem): { reason: string; rule: string } | undefined {
  const tags = new Set<ReceiptItemTag>(item.tags ?? []);
  const diet = new Set(m.private?.dietTags ?? []);
  const facts = m.private?.billFacts ?? {};
  if (tags.has("alcohol") && facts.noAlcohol) return { reason: "你没喝酒，酒水不摊", rule: "alcohol" };
  if (tags.has("spicy") && diet.has("不吃辣")) return { reason: "你不吃辣，辣的不摊", rule: "spicy" };
  if (tags.has("beef") && (diet.has("不吃牛肉") || diet.has("素食"))) return { reason: "你不吃牛肉，这道不摊", rule: "diet" };
  if (tags.has("seafood") && (diet.has("不吃海鲜") || diet.has("素食"))) return { reason: "你不吃海鲜，这道不摊", rule: "diet" };
  if (tags.has("offal") && (diet.has("不吃内脏") || diet.has("素食"))) return { reason: "你不吃内脏，这道不摊", rule: "diet" };
  if (tags.has("meat") && diet.has("素食")) return { reason: "你吃素，荤菜不摊", rule: "diet" };
  const name = item.name ?? "";
  const skip = (facts.skipItems ?? []).map((s) => s.trim()).find((s) => s && name.includes(s));
  if (skip) return { reason: "你说没吃这个，不摊", rule: "skip" };
  return undefined;
}

/** 提前走的人非共享菜只摊一半 */
export const LEFT_EARLY_WEIGHT = 0.5;

export function splitBill(receipt: Receipt, attendees: Member[]): BillSplit {
  const people = attendees.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const totalCents = toCents(receipt.total);
  const perMember: BillSplit["perMember"] = {};
  if (people.length === 0) return { perMember, total: toYuan(totalCents), explain: [] };

  const lines: BillShareLine[][] = people.map(() => []);
  const itemCents = people.map(() => 0);
  const rules = new Set<string>();

  for (const item of receipt.items ?? []) {
    const cents = toCents((item.price ?? 0) * (Number.isFinite(item.qty) && item.qty > 0 ? item.qty : 1));
    if (cents === 0) continue;
    const shared = (item.tags ?? []).includes("shared");
    const excl = people.map((m) => excludeReason(m, item));
    let weights = people.map((m, i) => {
      if (excl[i]) return 0;
      return !shared && m.private?.billFacts?.leftEarly ? LEFT_EARLY_WEIGHT : 1;
    });
    if (weights.every((w) => w === 0)) weights = people.map(() => 1); // 没人该摊就大家一起摊，钱不能凭空消失
    else excl.forEach((e) => e && rules.add(e.rule));
    if (!shared && people.some((m, i) => m.private?.billFacts?.leftEarly && weights[i] > 0 && weights.some((w) => w === 1)))
      rules.add("leftEarly");
    const parts = apportion(cents, weights);
    const label = item.qty > 1 ? `${item.name} ×${item.qty}` : item.name;
    people.forEach((m, i) => {
      itemCents[i] += parts[i];
      if (parts[i] !== 0) {
        const line: BillShareLine = { itemName: label, amount: toYuan(parts[i]) };
        if (weights[i] === LEFT_EARLY_WEIGHT && weights.some((w) => w === 1)) line.reason = "提前走了，少摊一半";
        lines[i].push(line);
      } else if (excl[i] && weights[i] === 0) {
        lines[i].push({ itemName: label, amount: 0, reason: excl[i]!.reason });
      }
    });
  }

  // 服务费 / 优惠 / 其他差额（抹零等）按各人菜品消费比例分摊
  const itemsTotal = itemCents.reduce((s, c) => s + c, 0);
  const basis = itemsTotal > 0 ? itemCents : people.map(() => 1);
  const fee = toCents(receipt.serviceFee);
  const discount = toCents(receipt.discount);
  const residual = totalCents - itemsTotal - fee + discount;
  const adj: [string, number][] = [
    ["服务费", fee],
    ["优惠", -discount],
    [itemsTotal > 0 ? "抹零 / 其他差额" : "AA", residual],
  ];
  const finalCents = [...itemCents];
  for (const [name, c] of adj) {
    if (c === 0) continue;
    const parts = apportion(c, basis);
    people.forEach((_, i) => {
      finalCents[i] += parts[i];
      if (parts[i] !== 0) lines[i].push({ itemName: name, amount: toYuan(parts[i]) });
    });
  }

  people.forEach((m, i) => {
    perMember[m.id] = { amount: toYuan(finalCents[i]), lines: lines[i] };
  });

  // 只给聚合说明，不点名
  const explain: string[] = [];
  if (rules.has("alcohol")) explain.push("酒水只由喝酒的人分摊");
  if (rules.has("spicy")) explain.push("辣锅 / 辣菜不摊给不吃辣的人");
  if (rules.has("diet")) explain.push("按忌口，没吃的菜不摊");
  if (rules.has("skip")) explain.push("有人没吃的菜，不摊给他");
  if (rules.has("leftEarly")) explain.push("有人提前离开，少摊了部分菜");
  if (fee) explain.push("服务费按各人消费比例分摊");
  if (discount) explain.push("优惠按各人消费比例抵扣");
  if (!explain.length) explain.push("按人头平均分摊");
  return { perMember, total: toYuan(totalCents), explain };
}

/** AA：人均向上取整到 1 元 */
export function settle(total: number, n: number): { total: number; perPerson: number } {
  const t = Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : 0;
  const k = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
  const cents = Math.round(t * 100);
  return { total: t, perPerson: Math.ceil(cents / k / 100 - 1e-9) };
}
