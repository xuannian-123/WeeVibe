// 单人 × 单候选的体验：公开一份（只用公开因素），私密一份（叠加预算 / 忌口 / 刷卡 / 备注 / 排队）。
// 隐私硬规则：publicExperience 的入参里根本没有 poi 和预算等私密字段，类型上就碰不到。
import type { DayAvailability, Experience, JuSpec, Member, NeedResult, Poi, Slot, SwipeVerdict } from "../types";
import { dietConflictReason, HARD_DIET, isHotpot } from "./diet";
import { evaluateRule, softPenalty } from "./needs";
import { bjParts, chainName, clamp, hmToMin, isFoodPoi, minToHm } from "./util";

/** experienceFor 的上下文 */
export type PlanContext = {
  spec: JuSpec;
  /** 已知店（刷卡卡片等）的店名：用来把对某家分店的刷卡表态推广到同品牌的其他分店 */
  knownPois?: Record<string, Pick<Poi, "name">>;
};

// ---- 公开体验的常数（路演讲解以此为准） ----
export const ABSENT_LATE_MIN = 45; // 迟到超过 45 分钟算来不了
export const MIN_STAY_MIN = 60; // 待不满 60 分钟算来不了
export const COMMUTE_FREE_MIN = 15; // 通勤 15 分钟以内不扣分
const PREF_PENALTY: Record<DayAvailability["pref"], number> = { best: 0, ok: 4, meh: 15 };

/** 没填任何时间的人（还没聊到 / 说了都行）：当作那几天都行 */
const ANY_DAY: DayAvailability = { from: "00:00", pref: "ok" };

export function dayAvailability(m: Member, date: string): DayAvailability | undefined {
  const av = m.private?.availability ?? {};
  if (Object.keys(av).length === 0) return ANY_DAY;
  return av[date];
}

/** slot 的北京时间：日期、开始 / 结束（当天分钟，结束可 > 1440） */
export function slotTimes(slot: Slot): { date: string; start: number; end: number } {
  const s = bjParts(slot.start);
  const dur = Math.round((new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000);
  return { date: s.date, start: s.min, end: s.min + (dur > 0 ? dur : 120) };
}

/**
 * 公开体验：只看 出发时刻 / 门禁时刻（availability）、通勤、时段、当天意愿。
 * 不接收 poi、预算、刷卡、忌口、备注。
 */
export function publicExperience(member: Member, slot: Slot, commuteMin: number): Experience {
  const commute = Math.max(0, Math.round(commuteMin));
  const { date, start, end } = slotTimes(slot);
  const day = dayAvailability(member, date);
  const absent = (): Experience => ({
    memberId: member.id,
    status: "absent",
    lateMin: 0,
    stayMin: 0,
    commuteMin: commute,
    utility: 0,
    notes: ["这个时间来不了"],
  });
  if (!day) return absent();

  const from = hmToMin(day.from) ?? 0;
  const arrive = Math.max(start, from + commute);
  const late = arrive - start;
  let stayEnd = end;
  let leaveAt: number | undefined;
  const hbRaw = hmToMin(day.homeBy);
  if (hbRaw !== undefined) {
    // 门禁早于出发时刻（或者是凌晨）视为次日
    const hb = hbRaw <= from || (hbRaw < 12 * 60 && start >= 12 * 60) ? hbRaw + 1440 : hbRaw;
    leaveAt = hb - commute;
    stayEnd = Math.min(end, leaveAt);
  }
  const stay = stayEnd - arrive;
  // v5 协商：本人同意过"晚到一点 / 少待一会儿也来"，门槛按本人的来（来不来是现场看得见的事实，本身不算泄露）
  const relax = member.private?.relax;
  const maxLate = Math.max(ABSENT_LATE_MIN, relax?.maxLateMin ?? 0);
  const minStay = Math.min(MIN_STAY_MIN, end - start, relax?.minStayMin ?? MIN_STAY_MIN);
  if (late > maxLate || stay < minStay) return absent();

  const early = Math.max(0, end - stayEnd);
  let u = 100;
  u -= Math.min(40, late * 0.8);
  u -= Math.min(30, early * 0.4);
  u -= Math.min(35, Math.max(0, commute - COMMUTE_FREE_MIN) * 1.0);
  u -= PREF_PENALTY[day.pref] ?? 4;
  if (start >= 21 * 60) u -= 5; // 太晚开始

  const notes: string[] = [];
  if (late > 0) notes.push(`晚到 ${late} 分钟`);
  if (early > 0) notes.push(`${minToHm(stayEnd)} 需先走`);
  if (commute >= 40) notes.push(`路上 ${commute} 分钟`);
  const status: Experience["status"] = late > 0 && early > 0 ? "lateEarly" : late > 0 ? "late" : early > 0 ? "early" : "full";
  return {
    memberId: member.id,
    status,
    arriveAt: minToHm(arrive),
    lateMin: late,
    ...(early > 0 ? { leaveAt: minToHm(stayEnd) } : {}),
    stayMin: stay,
    commuteMin: commute,
    utility: Math.round(clamp(u, 0, 100)),
    notes,
  };
}

/** v5 协商用：这个人在这个时间会晚到多久、能待多久（不管门槛）。那天不行时 dayOk = false */
export function timeFit(member: Member, slot: Slot, commuteMin: number): { dayOk: boolean; late: number; stay: number; leaveAt?: string } {
  const commute = Math.max(0, Math.round(commuteMin));
  const { date, start, end } = slotTimes(slot);
  const day = dayAvailability(member, date);
  if (!day) return { dayOk: false, late: 0, stay: 0 };
  const from = hmToMin(day.from) ?? 0;
  const arrive = Math.max(start, from + commute);
  let stayEnd = end;
  let leaveAt: string | undefined;
  const hbRaw = hmToMin(day.homeBy);
  if (hbRaw !== undefined) {
    const hb = hbRaw <= from || (hbRaw < 12 * 60 && start >= 12 * 60) ? hbRaw + 1440 : hbRaw;
    stayEnd = Math.min(end, hb - commute);
    leaveAt = minToHm(stayEnd);
  }
  return { dayOk: true, late: arrive - start, stay: stayEnd - arrive, ...(leaveAt ? { leaveAt } : {}) };
}

/** 饭点排队：吃饭的地方 + 17:30–19:30 开始 + 评分 ≥ 4.5（公开因素，所有人一样） */
export function queueMinutes(slot: Slot, poi: Poi): number {
  if (!isFoodPoi(poi)) return 0;
  const { start } = slotTimes(slot);
  if (start < 17 * 60 + 30 || start > 19 * 60 + 30) return 0;
  return (poi.rating ?? 0) >= 4.5 ? 20 : 0;
}

/** 私密预算的违反程度：超出 60% 算完全违反；永远不会让人 absent（v3 隐私规则：花费不设硬约束） */
export function budgetDegree(cost: number, budget: number): number {
  if (!(budget > 0) || cost <= budget) return 0;
  return Math.min(1, (cost - budget) / budget / 0.6);
}

/** "被照顾到"的保底线（docs/DECISION.md 3.3） */
export const CARE_FLOOR = 50;

// 忌口里的硬约束定义在 diet.ts（不依赖 node，授权书在浏览器里也要用）
export { HARD_DIET };

/** 找这家店（或同品牌分店）的刷卡表态 */
export function swipeFor(member: Member, poi: Poi, ctx: PlanContext): { v: SwipeVerdict; sameShop: boolean } | undefined {
  const swipes = member.private?.swipes ?? {};
  const direct = swipes[poi.id];
  if (direct) return { v: direct, sameShop: true };
  const chain = chainName(poi.name);
  if (!chain || !ctx.knownPois) return undefined;
  for (const id of Object.keys(swipes).sort()) {
    const known = ctx.knownPois[id];
    if (known && chainName(known.name) === chain) return { v: swipes[id], sameShop: false };
  }
  return undefined;
}

/** 内部聚合用的私密标记（只用来数人数，绝不单独出现在公开文案里） */
export type PrivateFlags = {
  overBudget: boolean;
  dietConflict: boolean;
  yuanyang: boolean;
  verdict?: SwipeVerdict;
  /** v5：有硬约束没满足（清真 / 素食的店不对、"最多一小时"的通勤超了）——人可能还来，但不算被照顾到 */
  hard: boolean;
};

/** v5 协商用：一条软偏好在这个方案里扣了多少分（只在服务端内部用，不出接口） */
export type SoftCost = { key: string; cost: number; text: string; detail: string };

/** 本人在这个方案里几点离开（当天分钟，可 > 1440） */
function stayEndOf(pub: Experience, slot: Slot): number {
  const { start, end } = slotTimes(slot);
  const leave = hmToMin(pub.leaveAt);
  if (leave === undefined) return end;
  return leave < start - 6 * 60 ? leave + 1440 : leave;
}

/**
 * 某个成员在某个候选（slot × poi）下的体验。
 * pub 只由公开因素算出；mine 在 pub 的基础上叠加私密因素，只给本人和内部打分用。
 */
export function experienceFor(
  member: Member,
  slot: Slot,
  poi: Poi,
  commuteMin: number,
  ctx: PlanContext,
): { pub: Experience; mine: { utility: number; notes: string[]; needs: NeedResult[]; cared: boolean } } {
  const { pub, mine } = experienceDetail(member, slot, poi, commuteMin, ctx);
  return { pub, mine };
}

/** experienceFor + 私密标记 */
export function experienceDetail(
  member: Member,
  slot: Slot,
  poi: Poi,
  commuteMin: number,
  ctx: PlanContext,
): { pub: Experience; mine: { utility: number; notes: string[]; needs: NeedResult[]; cared: boolean }; flags: PrivateFlags; soft: SoftCost[] } {
  const pub = publicExperience(member, slot, commuteMin);
  const flags: PrivateFlags = { overBudget: false, dietConflict: false, yuanyang: false, hard: false };
  const results: NeedResult[] = [];
  const soft: SoftCost[] = [];
  if (pub.status === "absent") {
    results.push({ text: "这个时间能来", result: "unmet", detail: "这个时间你来不了" });
    return { pub, mine: { utility: 0, notes: ["这个时间你来不了"], needs: results, cared: false }, flags, soft };
  }

  const p = member.private;
  const waived = new Set(p?.waived ?? []);
  const notes: string[] = [];
  let u = pub.utility;
  const food = isFoodPoi(poi);

  // 0. 时间：能来，晚到 / 早走如实说
  results.push({
    text: "这个时间能来",
    result: pub.status === "full" ? "met" : "partial",
    detail: pub.status === "full" ? "全程都在" : pub.notes.join("，"),
  });

  // 1. 预算：私下说的优先（按在意程度扣分）；没说就按发起人公开的人均，放宽 20% 轻扣
  const cost = poi.costPerPerson;
  if (cost !== undefined) {
    if (p?.budgetMax !== undefined && p.budgetMax > 0) {
      const degree = budgetDegree(cost, p.budgetMax);
      const text = `人均 ${p.budgetMax} 以内`;
      if (degree > 0) {
        const cost0 = softPenalty("money", p.budgetStrength ?? 2, degree);
        if (!waived.has("budget")) {
          u -= cost0;
          soft.push({ key: "budget", cost: cost0, text, detail: `这家人均 ${cost}，比你说的多 ${cost - p.budgetMax}` });
        }
        flags.overBudget = true;
        notes.push(`人均 ${cost}，超出你说的 ${p.budgetMax}`);
        results.push({ text, result: degree < 0.5 ? "partial" : "unmet", detail: `这家人均 ${cost}` });
      } else {
        notes.push(`人均 ${cost}，在你的预算内`);
        results.push({ text, result: "met", detail: `这家人均 ${cost}` });
      }
    } else if (ctx.spec.budgetPerPerson && ctx.spec.budgetPerPerson > 0) {
      const over = (cost - ctx.spec.budgetPerPerson) / ctx.spec.budgetPerPerson;
      if (over > 0.2) {
        u -= Math.min(15, (over - 0.2) * 40);
        notes.push(`人均 ${cost}，比说好的 ${ctx.spec.budgetPerPerson} 贵一些`);
      }
    }
  }

  // 2. 忌口：清真 / 素食是硬约束；火锅 + 不吃辣 → 鸳鸯锅，只轻扣；其余冲突按强度 2 扣
  for (const tag of [...new Set(p?.dietTags ?? [])]) {
    const reason = food ? dietConflictReason(tag, poi) : undefined;
    if (!reason) {
      results.push({ text: tag, result: "met", detail: food ? "这家不冲突" : "不是吃饭的地方" });
      continue;
    }
    if (tag === "不吃辣" && (isHotpot(poi) || /火锅/.test(ctx.spec.category))) {
      u -= 6;
      flags.yuanyang = true;
      notes.push("有鸳鸯锅，你可以吃清汤那边");
      results.push({ text: tag, result: "met", detail: "点鸳鸯锅，你吃清汤那边" });
    } else {
      u -= softPenalty("food", 2, 1);
      flags.dietConflict = true;
      if (HARD_DIET.includes(tag)) flags.hard = true;
      notes.push(`${reason}，和你的忌口（${tag}）冲突`);
      results.push({ text: tag, result: "unmet", detail: reason });
    }
  }

  // 3. 刷卡
  const sw = swipeFor(member, poi, ctx);
  if (sw) {
    flags.verdict = sw.v;
    const k = sw.sameShop ? 1 : 0.6;
    if (sw.v === "love") {
      u += 12 * k;
      notes.push(sw.sameShop ? "你刷卡点了超想去" : "你超想去这家的其他分店");
    } else if (sw.v === "like") {
      u += 5 * k;
      notes.push(sw.sameShop ? "你刷卡点了想去" : "你想去这家的其他分店");
    } else {
      u -= 30 * k;
      notes.push(sw.sameShop ? "你刷卡时 pass 了这家" : "你 pass 过这家的其他分店");
    }
  }

  // 4. 其他需求（私聊抽出来的）：硬的不满足 = 没被照顾到；软的按 强度 × 违反程度 × 维度上限 扣分
  const q = queueMinutes(slot, poi);
  const needCtx = { poi, commuteMin: pub.commuteMin, stayEndMin: stayEndOf(pub, slot), queueMin: q };
  for (const n of p?.needs ?? []) {
    const ev = evaluateRule(n.rule, needCtx);
    if (n.kind === "hard" && ev.degree > 0) flags.hard = true;
    else if (ev.degree > 0 && !waived.has(n.id)) {
      const c = softPenalty(n.dim, n.strength, ev.degree);
      u -= c;
      soft.push({ key: n.id, cost: c, text: n.text, detail: ev.detail });
    }
    if (ev.result === "unmet" || ev.result === "partial") notes.push(`你说「${n.text}」：${ev.detail}`);
    results.push({ text: n.text, result: n.kind === "hard" && ev.degree > 0 ? "unmet" : ev.result, detail: ev.detail });
  }

  // 5. 口碑：评分高的店大家都更满意（公开信息，但只进内部满意度，不进公开 utility）
  if (poi.rating !== undefined) u += clamp((poi.rating - 4.2) * 12, -8, 8);

  // 6. 饭点排队：所有人轻扣（特别怕排队的人由上面的 noQueue 需求再扣）
  if (q > 0) {
    u -= 5;
    notes.push(`饭点可能要排队约 ${q} 分钟`);
  }

  const utility = Math.round(clamp(u, 0, 100));
  return { pub, mine: { utility, notes, needs: results, cared: !flags.hard && utility >= CARE_FLOOR }, flags, soft };
}
