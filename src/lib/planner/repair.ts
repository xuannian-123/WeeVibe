// v5 极端情况（docs/DECISION.md 第 5 节）：推荐方案没能照顾到所有人时，诊断卡在哪，找代价最小的修复办法。
// 修复 = 局长私下问一个人一个是 / 否问题：
//   selfTime：请被卡住的人接受晚到 / 少待一会儿（松的是"至少待满 60 分钟""最多晚 45 分钟"这类门槛，不是门禁）
//   waiveSoft：请本人这次不计较某一条软偏好（预算超一点、路上久一点）
// 绝不请人违反硬约束（门禁、清真、"最多一小时"）。每个修复都会把这个人重新评估一遍，确认真的能被照顾到才算数。
// 确定性：只用候选的计算结果和固定规则，同样的输入一定得到同样的问题。
import type { Diagnosis, Member } from "../types";
import { experienceDetail, timeFit, type PlanContext } from "./experience";
import type { Candidate } from "./plan";
import { slotLabel } from "./util";

/** 每个人每局最多被问几次 */
export const ASK_LIMIT_PER_PERSON = 2;
/** 每局最多问几次（超过就交给发起人） */
export const ASK_LIMIT_PER_JU = 5;
/** selfTime 能放宽到的边界：最多晚到 90 分钟、至少待 30 分钟，再多就不问了 */
export const RELAX_MAX_LATE = 90;
export const RELAX_MIN_STAY = 30;

export type AskDraft = {
  memberId: string;
  kind: "selfTime" | "waiveSoft";
  text: string;
  relax?: { maxLateMin?: number; minStayMin?: number };
  needKey?: string;
  /** 问这个人的代价：让过步的人、被问过的人更贵 */
  cost: number;
};

/** 问这个人这件事的代价；Infinity = 不能问（问够了 / 正在等他回答 / 这件事他已经说过不行） */
export function askCostOf(m: Member, kind: AskDraft["kind"], needKey: string | undefined, concessions: number): number {
  const asks = m.private?.asks ?? [];
  if (asks.length >= ASK_LIMIT_PER_PERSON) return Infinity;
  if (asks.some((a) => a.status === "pending")) return Infinity;
  if (asks.some((a) => a.status === "no" && a.kind === kind && (a.needKey ?? "") === (needKey ?? ""))) return Infinity;
  const yes = asks.filter((a) => a.status === "yes").length;
  return 1 + 0.6 * yes + 0.5 * concessions + (kind === "waiveSoft" ? 0.3 : 0);
}

function someone(k: number, rest: string): string {
  return k === 1 ? `有 1 位朋友${rest}` : `${k} 人${rest}`;
}

/** 某个人在某个候选里能不能靠一个问题被照顾到；能就返回问题草稿 */
function fixFor(m: Member, i: number, c: Candidate, ctx: PlanContext, concessions: number): AskDraft | undefined {
  if (c.mines[i].cared || c.flags[i].hard) return undefined;
  const commute = c.pubs[i].commuteMin;
  const when = `${slotLabel(c.slot.start)}在「${c.poi.name}」`;

  if (c.pubs[i].status === "absent") {
    const tf = timeFit(m, c.slot, commute);
    if (!tf.dayOk || tf.late > RELAX_MAX_LATE || tf.stay < RELAX_MIN_STAY) return undefined;
    const relax = { maxLateMin: Math.max(45, tf.late), minStayMin: Math.min(60, tf.stay) };
    const trial = { ...m, private: { ...m.private!, relax: { ...m.private?.relax, ...relax } } };
    if (!experienceDetail(trial, c.slot, c.poi, commute, ctx).mine.cared) return undefined;
    const cost = askCostOf(m, "selfTime", undefined, concessions);
    if (!Number.isFinite(cost)) return undefined;
    const lateText = tf.late > 45 ? `要晚到 ${tf.late} 分钟` : "";
    const stayText = tf.stay < 60 ? `大约只能待 ${tf.stay} 分钟${tf.leaveAt ? `（${tf.leaveAt} 得走）` : ""}` : "";
    const text = `${when}：你${[lateText, stayText].filter(Boolean).join("、")}。这样也来吗？来的话大家会照顾你的时间。`;
    return { memberId: m.id, kind: "selfTime", text, relax, cost };
  }

  // 人来得了，但被软偏好拖到保底线以下：只问扣分最多的那一条
  const top = [...(c.softs[i] ?? [])].sort((a, b) => b.cost - a.cost || (a.key < b.key ? -1 : 1))[0];
  if (!top) return undefined;
  const trial = { ...m, private: { ...m.private!, waived: [...(m.private?.waived ?? []), top.key] } };
  if (!experienceDetail(trial, c.slot, c.poi, commute, ctx).mine.cared) return undefined;
  const cost = askCostOf(m, "waiveSoft", top.key, concessions);
  if (!Number.isFinite(cost)) return undefined;
  const text =
    top.key === "budget"
      ? `${when}：${top.detail}。这是能让所有人都来的方案，这次可以接受吗？`
      : `${when}：你说的「${top.text}」这次没法完全照顾到（${top.detail}）。为了让所有人都能来，这次可以吗？`;
  return { memberId: m.id, kind: "waiveSoft", text, needKey: top.key, cost };
}

/** 卡在哪：按类别数人（公开安全） */
function reasonsFor(c: Candidate): string[] {
  let time = 0;
  let hard = 0;
  let money = 0;
  let other = 0;
  c.pubs.forEach((e, i) => {
    if (c.mines[i].cared) return;
    if (e.status === "absent") time++;
    else if (c.flags[i].hard) hard++;
    else if ((c.softs[i] ?? []).sort((a, b) => b.cost - a.cost)[0]?.key === "budget") money++;
    else other++;
  });
  return [
    time ? someone(time, "时间凑不上") : "",
    hard ? someone(hard, "的忌口或硬性要求和这家冲突") : "",
    money ? someone(money, "觉得偏贵") : "",
    other ? someone(other, "的小要求没照顾到") : "",
  ].filter(Boolean);
}

/**
 * 诊断 + 修复：在所有候选里找"照顾到的人 + 一个问题就能照顾到的人"最多、问的代价最小的那个，
 * 只有它比推荐方案照顾到更多人时才去问。concessions：memberId -> 最近答应过让步的次数。
 */
export function planRepairs(
  members: Member[],
  cands: Candidate[],
  rec: Candidate,
  ctx: PlanContext,
  concessions: Record<string, number> = {},
  compare: (a: Candidate, b: Candidate) => number,
): { asks: AskDraft[]; diagnosis?: Diagnosis } {
  const n = members.length;
  const pendingNow = members.filter((m) => (m.private?.asks ?? []).some((a) => a.status === "pending")).length;
  if (rec.cared >= n) return { asks: [] };

  const askedTotal = members.reduce((s, m) => s + (m.private?.asks?.length ?? 0), 0);
  const capacity = Math.max(0, ASK_LIMIT_PER_JU - askedTotal);

  let best: { c: Candidate; fixes: AskDraft[]; potential: number; cost: number } | undefined;
  if (capacity > 0) {
    for (const c of cands) {
      if (c.vetoed || c.infeasible) continue;
      const fixes = members
        .map((m, i) => fixFor(m, i, c, ctx, concessions[m.id] ?? 0))
        .filter((f): f is AskDraft => !!f)
        .sort((a, b) => a.cost - b.cost || (a.memberId < b.memberId ? -1 : 1))
        .slice(0, capacity);
      const potential = c.cared + fixes.length;
      const cost = fixes.reduce((s, f) => s + f.cost, 0);
      if (
        !best ||
        potential > best.potential ||
        (potential === best.potential && (cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && compare(c, best.c) < 0)))
      ) {
        best = { c, fixes, potential, cost };
      }
    }
  }
  const asks = best && best.potential > rec.cared ? best.fixes : [];

  // 局长自己解决不了的，交给发起人
  const suggestions: string[] = [];
  const stillTime = rec.pubs.some((e, i) => e.status === "absent" && !rec.mines[i].cared && !asks.some((a) => a.memberId === members[i].id));
  if (stillTime && !cands.some((c) => c.pubs.every((e) => e.status !== "absent"))) suggestions.push("加一个候选时间（比如周末下午），可能让所有人都能来");
  const stillHard = rec.flags.some((f, i) => f.hard && !rec.mines[i].cared);
  if (stillHard && !cands.some((c) => c.flags.every((f) => !f.hard))) suggestions.push("附近没有满足所有人忌口 / 硬性要求的店，可以换个品类或扩大范围");

  return {
    asks,
    diagnosis: { uncared: n - rec.cared, reasons: reasonsFor(rec), coordinating: pendingNow + asks.length, suggestions },
  };
}
