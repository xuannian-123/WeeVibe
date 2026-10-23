// 单人 × 单候选的体验：公开一份（只用公开因素），私密一份（叠加预算 / 忌口 / 刷卡 / 备注 / 排队）。
// 隐私硬规则：publicExperience 的入参里根本没有 poi 和预算等私密字段，类型上就碰不到。
import type { DayAvailability, Experience, JuSpec, Member, Poi, Slot, SwipeVerdict } from "../types";
import { dietConflictReason, isHotpot } from "./diet";
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
  const minStay = Math.min(MIN_STAY_MIN, end - start);
  if (late > ABSENT_LATE_MIN || stay < minStay) return absent();

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

/** 饭点排队：吃饭的地方 + 17:30–19:30 开始 + 评分 ≥ 4.5（公开因素，所有人一样） */
export function queueMinutes(slot: Slot, poi: Poi): number {
  if (!isFoodPoi(poi)) return 0;
  const { start } = slotTimes(slot);
  if (start < 17 * 60 + 30 || start > 19 * 60 + 30) return 0;
  return (poi.rating ?? 0) >= 4.5 ? 20 : 0;
}

/** 私密预算扣分：超 30% 以内温和，超 30% 重扣；永远不会让人 absent */
export function budgetPenalty(cost: number, budget: number): number {
  if (!(budget > 0) || cost <= budget) return 0;
  const over = (cost - budget) / budget;
  return over <= 0.3 ? over * 60 : Math.min(60, 18 + (over - 0.3) * 120);
}

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

type NoteRule = { kw: RegExp; hit: (poi: Poi, slot: Slot, commute: number) => boolean; delta: number; note: string };
/** 私密备注关键词（原话只在本人视图里出现，这里只生成给本人的提示） */
const NOTE_RULES: NoteRule[] = [
  { kw: /减肥|油腻|清淡|别太油|太油/, hit: (p) => /火锅|烧烤|烤肉|串|炸/.test(p.name + p.type), delta: -8, note: "你说想吃清淡点，这家偏油" },
  { kw: /安静|太吵|怕吵/, hit: (p) => /KTV|烧烤|大排档|酒吧|串/i.test(p.name + p.type), delta: -8, note: "你想安静点，这家可能比较吵" },
  { kw: /远|累|不想跑/, hit: (_p, _s, c) => c > 30, delta: -8, note: "你说不想跑太远，这家路上有点久" },
  { kw: /早点回|早点走|明天早/, hit: (_p, s) => slotTimes(s).start >= 19 * 60 + 30, delta: -6, note: "你想早点回，这个时间偏晚" },
];

/** 内部聚合用的私密标记（只用来数人数，绝不单独出现在公开文案里） */
export type PrivateFlags = { overBudget: boolean; dietConflict: boolean; yuanyang: boolean; verdict?: SwipeVerdict };

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
): { pub: Experience; mine: { utility: number; notes: string[] } } {
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
): { pub: Experience; mine: { utility: number; notes: string[] }; flags: PrivateFlags } {
  const pub = publicExperience(member, slot, commuteMin);
  const flags: PrivateFlags = { overBudget: false, dietConflict: false, yuanyang: false };
  if (pub.status === "absent") return { pub, mine: { utility: 0, notes: ["这个时间你来不了"] }, flags };

  const p = member.private;
  const notes: string[] = [];
  let u = pub.utility;
  const food = isFoodPoi(poi);

  // 1. 预算：私下说的优先；没说就按发起人公开的人均，放宽 20% 轻扣
  const cost = poi.costPerPerson;
  if (cost !== undefined) {
    if (p?.budgetMax !== undefined && p.budgetMax > 0) {
      const pen = budgetPenalty(cost, p.budgetMax);
      if (pen > 0) {
        u -= pen;
        flags.overBudget = true;
        notes.push(`人均 ${cost}，超出你说的 ${p.budgetMax}`);
      } else notes.push(`人均 ${cost}，在你的预算内`);
    } else if (ctx.spec.budgetPerPerson && ctx.spec.budgetPerPerson > 0) {
      const over = (cost - ctx.spec.budgetPerPerson) / ctx.spec.budgetPerPerson;
      if (over > 0.2) {
        u -= Math.min(15, (over - 0.2) * 40);
        notes.push(`人均 ${cost}，比说好的 ${ctx.spec.budgetPerPerson} 贵一些`);
      }
    }
  }

  // 2. 忌口：火锅 + 不吃辣 → 鸳鸯锅，只轻扣
  if (food) {
    for (const tag of [...new Set(p?.dietTags ?? [])]) {
      const reason = dietConflictReason(tag, poi);
      if (!reason) continue;
      if (tag === "不吃辣" && (isHotpot(poi) || /火锅/.test(ctx.spec.category))) {
        u -= 6;
        flags.yuanyang = true;
        notes.push("有鸳鸯锅，你可以吃清汤那边");
      } else {
        u -= 35;
        flags.dietConflict = true;
        notes.push(`${reason}，和你的忌口（${tag}）冲突`);
      }
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

  // 4. 私密备注关键词
  const noteText = (p?.notes ?? []).join(" ");
  if (noteText) {
    for (const r of NOTE_RULES) {
      if (r.kw.test(noteText) && r.hit(poi, slot, pub.commuteMin)) {
        u += r.delta;
        notes.push(r.note);
      }
    }
    // "想吃 X"：店名 / 类型里有 X 就加分
    const want = /想吃([一-龥A-Za-z]{2,4}?)/.exec(noteText)?.[1];
    if (want && `${poi.name}${poi.type}`.includes(want)) {
      u += 6;
      notes.push(`你说想吃${want}，这家正好`);
    }
  }

  // 5. 口碑：评分高的店大家都更满意（公开信息，但只进内部满意度，不进公开 utility）
  if (poi.rating !== undefined) u += clamp((poi.rating - 4.2) * 12, -8, 8);

  // 6. 饭点排队（怕排队的人扣双倍）
  const q = queueMinutes(slot, poi);
  if (q > 0) {
    u -= /排队/.test(noteText) ? 10 : 5;
    notes.push(`饭点可能要排队约 ${q} 分钟`);
  }

  return { pub, mine: { utility: Math.round(clamp(u, 0, 100)), notes }, flags };
}
