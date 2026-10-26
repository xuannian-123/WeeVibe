// v5 决定书（docs/DECISION.md 第 7 节）：一个决定 = 一份结构化的决定书，群公告、局页决定卡、发起人待办都从这里生成。
// 纯函数、不依赖 Node，前后端共用；只读公开数据（方案、风险、备案、聚合人数），所以生成的东西都是公开安全的。
// 本人那份（"你跟局长说的每一条怎么样了"）在前端用 state.mine 拼，不在这里。
import type { Ju, Proposal, Risk } from "./types";

export type DecisionView = {
  proposal: Proposal;
  /** 已定局（否则是推荐方案，还在投票） */
  final: boolean;
  /** "周六 15:00 · 星空桌游馆 · 8 人" */
  verdict: string;
  why: string[];
  risks: Risk[];
  fallback?: Proposal["fallback"];
  /** 群里每个人要做的事（带伞、先取号…） */
  groupActions: string[];
  /** 发起人的待办（订位、确认营业时间、备案…） */
  organizerActions: string[];
};

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** "11月2日 周六 15:00"（北京时间） */
export function slotLabelOf(startIso: string): string {
  const d = new Date(new Date(startIso).getTime() + 8 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${WEEK[d.getUTCDay()]} ${hh}:${mm}`;
}

/** 风险 → 每个人要做的事（去重，保持顺序） */
export function groupActionsOf(risks: Risk[]): string[] {
  const out: string[] = [];
  const add = (x: string) => !out.includes(x) && out.push(x);
  for (const r of risks) {
    if (r.kind === "weather") {
      if (/雨|雪/.test(r.text)) add("记得带伞");
      if (/(\d+)℃/.test(r.text)) add(Number(/(\d+)℃/.exec(r.text)![1]) >= 30 ? "注意防暑" : "多穿点");
    }
    if (r.kind === "closing" && /打烊/.test(r.text)) add("别太晚点单");
    if (r.kind === "queue") add("先到的人先取号");
    if (r.kind === "lateNight") add("结束得晚，回去结伴或打车，到家报个平安");
  }
  return out;
}

/** 发起人的待办（只给发起人看，但内容本身也是公开安全的） */
export function organizerActionsOf(ju: Ju, p: Proposal, headcount: number): string[] {
  const out: string[] = [];
  const tables = ju.seating?.rounds[0]?.tables.length ?? 0;
  if ((headcount >= 6 || tables >= 2) && ju.reservation?.status !== "booked") {
    out.push(`订位：${headcount} 人${tables >= 2 ? `、要分 ${tables} 桌` : ""}，建议订大桌或包间`);
  }
  if ((p.risks ?? []).some((r) => r.kind === "closing" && r.confidence === "unknown")) out.push("营业时间没查到，出发前打电话确认一下");
  if (p.fallback) out.push(`备案：如果${p.fallback.trigger}，改去「${p.fallback.poi.name}」`);
  if (/生日|寿/.test(ju.title)) out.push("生日局：别忘了蛋糕");
  else if (/欢送|送别|毕业|散伙/.test(ju.title)) out.push("准备一句祝福或一个小礼物");
  return out;
}

/** 定局了就看定局方案，否则看推荐方案；还没出方案返回 undefined */
export function decisionOf(ju: Ju, headcount?: number): DecisionView | undefined {
  const plan = ju.plan;
  if (!plan) return undefined;
  const final = ju.status === "confirmed";
  const p = (final ? plan.proposals.find((x) => x.id === ju.confirmedProposalId) : undefined) ?? plan.proposals.find((x) => x.recommended) ?? plan.proposals[0];
  if (!p) return undefined;
  const n = headcount ?? p.attendCount;
  const total = p.experiences.length;
  const why = p.recommended && plan.why?.length ? plan.why : [p.cared !== undefined ? (p.cared === total ? `${total} 个人都照顾到了` : `照顾到 ${p.cared}/${total} 人`) : "", p.headline].filter(Boolean);
  const risks = p.risks ?? [];
  return {
    proposal: p,
    final,
    verdict: `${slotLabelOf(p.slot.start)} · ${p.poi.name} · ${n} 人`,
    why,
    risks,
    ...(p.fallback ? { fallback: p.fallback } : {}),
    groupActions: groupActionsOf(risks),
    organizerActions: organizerActionsOf(ju, p, n),
  };
}
