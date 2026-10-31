// v6 只问会改变结果的问题（docs/AVATAR.md 4.2，价值信息）。
// 某个人还缺 / 不确定的一项信息（预算、哪天几点、忌口、这次的状态），把它可能的几种取值分别代进去重排一遍：
// 只有不同取值会改变推荐方案、或改变谁被照顾到时，才值得问。C 的授权书卡片据此决定高亮哪个空格；
// 上限沿用 v5：每人最多被问 2 次、每局最多 5 次（问够了就不再高亮 / 追问）。
// 确定性：假设值是固定的几档，候选按三级准则排，同样输入同样结论。
import type { DayAvailability, DietTag, Ju, MapProvider, Member, MemberPrivate, Mood } from "../../types";
import { weatherEffects } from "../external";
import { computeCandidates, decisionCompare, evaluateCandidate, inMembersOf, type Candidate } from "../plan";
import type { PlanContext } from "../experience";
import { ASK_LIMIT_PER_JU, ASK_LIMIT_PER_PERSON } from "../repair";
import { applyGive } from "./give";
import { planMember } from "./mandate";

export type VoiField = "budget" | "time" | "diet" | "mood";

export type VoiResult = {
  field: VoiField;
  /** 值得问：不同取值会改变推荐方案或谁被照顾到 */
  worth: boolean;
  /** 给内部 / 调试看的一句话（不含任何人的私密数值） */
  reason: string;
};

/** 每个空格试哪几档 */
const BUDGET_TRIES = [60, 100, 200];
const DIET_TRIES: DietTag[][] = [[], ["不吃辣"], ["清真"], ["素食"]];

/** 这个人哪些信息还缺 / 不确定（局长预填的也算不确定） */
export function missingFields(m: Member): VoiField[] {
  const p = m.private;
  const auto = new Set(p?.autoFilled ?? []);
  const out: VoiField[] = [];
  if (Object.keys(p?.availability ?? {}).length === 0 || auto.has("availability")) out.push("time");
  if (p?.budgetMax === undefined || auto.has("budget")) out.push("budget");
  if ((p?.dietTags ?? []).length === 0 || auto.has("diet")) out.push("diet");
  if (!p?.mood) out.push("mood");
  return out;
}

/** 这个人 / 这一局还能问几次（v5 上限：每人 2 次、每局 5 次） */
export function askBudget(members: Member[], memberId: string): number {
  const me = members.find((m) => m.id === memberId);
  const mine = me?.private?.asks?.length ?? 0;
  const total = members.reduce((s, m) => s + (m.private?.asks?.length ?? 0), 0);
  return Math.max(0, Math.min(ASK_LIMIT_PER_PERSON - mine, ASK_LIMIT_PER_JU - total));
}

function variantsFor(field: VoiField, m: Member, dates: string[], earliest: string): Partial<MemberPrivate>[] {
  if (field === "budget") return BUDGET_TRIES.map((b) => ({ budgetMax: b }));
  if (field === "diet") return DIET_TRIES.map((d) => ({ dietTags: d }));
  if (field === "time") {
    const all = (day: DayAvailability) => Object.fromEntries(dates.map((d) => [d, day]));
    return [
      { availability: all({ from: earliest, pref: "ok" }) },
      { availability: all({ from: "19:30", pref: "ok" }) },
      { availability: all({ from: earliest, homeBy: "21:30", pref: "ok" }) },
      { availability: Object.fromEntries(dates.slice(0, 1).map((d) => [d, { from: earliest, pref: "ok" as const }])) },
    ];
  }
  // 心情：B 的计算不看心情（活动层由 A 打分）；给出所有档位，结果一样就是"不值得问"
  return (["hype", "chill", "active", "lazy"] as Mood[]).map((mood) => ({ mood }));
}

/** 用一组成员重排：推荐的是哪个候选、谁被照顾到 */
function outcome(members: Member[], cands: Candidate[], weights: number[], ctx: PlanContext): string {
  const pm = members.map(planMember);
  const re = cands.map((c) =>
    evaluateCandidate(pm, c.slot, c.poi, c.pubs.map((e) => e.commuteMin), weights, ctx, c.idx, c.cost, weatherEffects(c.wx, c.poi)),
  );
  const given = applyGive(pm, re, weights, ctx).cands;
  const pool = given.filter((c) => !c.vetoed && c.attend > 0);
  const rec = [...(pool.length ? pool : given)].sort(decisionCompare)[0];
  if (!rec) return "none";
  return `${rec.slot.id}|${rec.poi.id}|${rec.mines.map((x) => (x.cared ? 1 : 0)).join("")}`;
}

/**
 * 某个人每个缺 / 不确定的空格值不值得问。cands / weights / ctx 来自 computeCandidates（同一局只算一次地图）。
 * members 是在局成员，和 cands 里的 pubs 一一对应。
 */
export function worthAsking(input: { members: Member[]; cands: Candidate[]; weights: number[]; ctx: PlanContext; memberId: string }): VoiResult[] {
  const { members, cands, weights, ctx, memberId } = input;
  const i = members.findIndex((m) => m.id === memberId);
  if (i < 0) return [];
  const fields = missingFields(members[i]);
  if (askBudget(members, memberId) <= 0) return fields.map((field) => ({ field, worth: false, reason: "问的次数到上限了" }));
  const dates = ctx.spec.dates ?? [];
  return fields.map((field) => {
    const keys = new Set(
      variantsFor(field, members[i], dates, ctx.spec.earliest).map((patch) => {
        const ms = [...members];
        ms[i] = { ...members[i], private: { ...members[i].private!, ...patch } };
        return outcome(ms, cands, weights, ctx);
      }),
    );
    return keys.size > 1
      ? { field, worth: true, reason: "不同的答案会改变推荐方案或谁被照顾到" }
      : { field, worth: false, reason: "不管怎么答，推荐方案和谁被照顾到都不变" };
  });
}

/** 便捷版：自己跑一遍候选计算（会调地图；C 的授权书卡片用） */
export async function worthAskingFor(ju: Ju, members: Member[], memberId: string, map: MapProvider): Promise<VoiResult[]> {
  const ins = inMembersOf(members);
  if (!ins.some((m) => m.id === memberId)) return [];
  const { cands, weights, ctx } = await computeCandidates(ju, ins, map, {}, () => {});
  return worthAsking({ members: ins, cands, weights, ctx, memberId });
}
