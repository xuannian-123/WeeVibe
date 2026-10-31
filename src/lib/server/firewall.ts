// 隐私防火墙（CONTRACT 第二节）。三层：
//   1. 视图剥离：publicState / publicMember 用白名单构造公开对象，private / secret / admin 一律不出去；
//      只有 status = in 的人对外存在；#1 门限未达成时只露发起人。
//   2. 输入隔离：publicFacts 是写公开文案的 LLM 唯一能拿到的输入（类型上就没有 MemberPrivate）。
//   3. 输出兜底：公开文案生成后再扫一遍，命中私密备注原文 / 私密预算数字 / 不在场的人名 / 任何 token，
//      就退回规则版文案并写 warn 日志（guardPlan / guardMessages / guardPublicText）。
// 反事实检验（privacy.ts）直接调用这里的函数，测的就是线上跑的这一份代码。
import { timingSafeEqual } from "node:crypto";
import * as db from "../db";
import { decisionOf } from "../decision";
import { mySeats, publicSeating } from "./social-view";
import type {
  GroupMessages,
  Ju,
  JuState,
  Member,
  MyExperience,
  Plan,
  Proposal,
  PublicCounts,
  PublicFacts,
  SeedMember,
  Slot,
} from "../types";

// ---------------------------------------------------------------- 常数时间比较

/** 常数时间比较两个字符串（长度不同也走一遍比较，避免长度侧信道） */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? "");
  const bb = Buffer.from(b ?? "");
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ba.length === bb.length && ba.length > 0;
}

/** 在成员里按 token 找人：遍历全部成员、不提前退出（常数时间） */
export function findByToken(members: Member[], token: string | undefined | null): Member | undefined {
  if (!token) return undefined;
  let hit: Member | undefined;
  for (const m of members) {
    const ok = safeEqual(m.secret?.token ?? "", token);
    if (ok && !hit) hit = m;
  }
  return hit;
}

// ---------------------------------------------------------------- 成员

/** 公开成员：白名单构造，剥掉 private / secret / profileId（拿到 profileId 就能读档案） */
export function publicMember(m: Member): Member {
  const out: Member = {
    id: m.id,
    juId: m.juId,
    name: m.name,
    avatar: m.avatar,
    role: m.role,
    intake: m.intake,
    status: m.status,
    joinedAt: m.joinedAt,
    isOrganizer: m.isOrganizer,
  };
  if (m.location) out.location = { lat: m.location.lat, lng: m.location.lng, label: m.location.label };
  if (m.seedId !== undefined) out.seedId = m.seedId;
  if (m.fillSeconds !== undefined) out.fillSeconds = m.fillSeconds;
  if (m.isDemo) out.isDemo = true;
  if (m.eta) out.eta = { arriveAt: m.eta.arriveAt, lateMin: m.eta.lateMin, updatedAt: m.eta.updatedAt };
  // v4：兴趣是本人明确同意公开的（填的时候写着"会给同桌看"）
  if (m.interests?.length) out.interests = [...m.interests];
  return out;
}

/** 本人视图：公开字段 + private + profileId，绝不含 secret（token / tier） */
export function selfMember(m: Member): Member {
  const out = publicMember(m);
  if (m.profileId) out.profileId = m.profileId;
  if (m.private) out.private = structuredClone(m.private);
  return out;
}

// ---------------------------------------------------------------- 可见性

/** #1 门限没达成（pending / failed）时，对外只有发起人 */
export function quorumHidden(ju: Ju): boolean {
  return !!ju.quorum && ju.quorum.state !== "met";
}

/** 对外可见的成员：status = in；门限未达成时只剩发起人 */
export function visibleMembers(ju: Ju, members: Member[]): Member[] {
  const inMembers = members.filter((m) => m.status === "in");
  return quorumHidden(ju) ? inMembers.filter((m) => m.isOrganizer) : inMembers;
}

/** 局里互选成功的对数（只算双方都在局里的） */
export function matchPairCount(members: Member[]): number {
  const inIds = new Set(members.filter((m) => m.status === "in").map((m) => m.id));
  const pairs = new Set<string>();
  for (const m of members) {
    if (!inIds.has(m.id)) continue;
    for (const other of m.private?.matches ?? []) {
      if (inIds.has(other)) pairs.add([m.id, other].sort().join("|"));
    }
  }
  return pairs.size;
}

export function publicCounts(ju: Ju, members: Member[]): PublicCounts {
  const hidden = quorumHidden(ju);
  const inMembers = members.filter((m) => m.status === "in");
  // 门限达成前，私下说"不来"的人也照样算在"已入局"里：不然人数一减，大家就知道刚才有人拒绝了
  const joined = hidden ? members.filter((m) => m.status !== "waitlist") : inMembers;
  const counts: PublicCounts = {
    in: joined.length,
    done: joined.filter((m) => m.intake === "done").length,
    waitlist: members.filter((m) => m.status === "waitlist").length,
    matchPairs: hidden ? 0 : matchPairCount(members),
  };
  if (ju.quorum) {
    counts.quorumHave = inMembers.filter((m) => m.private?.rsvp === "yes").length;
    counts.quorumNeed = ju.quorum.min;
  }
  return counts;
}

// ---------------------------------------------------------------- 局

function publicSeeds(seeds: SeedMember[] | undefined, visibleIds: Set<string>): SeedMember[] | undefined {
  if (!seeds) return undefined;
  return seeds
    .filter((s) => s.said !== "no") // #5 群里说了不去的人，公开视图里不显示
    .map((s) => {
      const out: SeedMember = { id: s.id, name: s.name, said: s.said };
      if (s.quote !== undefined) out.quote = s.quote;
      if (s.hint !== undefined) out.hint = s.hint;
      // 认领人不在局里（退出 / 候补 / 门限前）时不暴露"有人认领过"
      if (s.claimedBy && visibleIds.has(s.claimedBy)) out.claimedBy = s.claimedBy;
      return out;
    });
}

function publicPlan(plan: Plan, visibleIds: Set<string>): Plan {
  const p = structuredClone(plan);
  // 攒批期间有人退出：方案不重算，但他那一行体验不能再出现在公开视图里
  for (const pr of p.proposals) pr.experiences = pr.experiences.filter((e) => visibleIds.has(e.memberId));
  return p;
}

/** Ju 的公开版：去掉 admin；票、方案体验、截图预填、座位表只保留对外可见的人 */
export function publicJu(ju: Ju, members: Member[]): Ju {
  const visibleIds = new Set(visibleMembers(ju, members).map((m) => m.id));
  const { admin: _admin, plan, votes, seeds, seating, ...rest } = structuredClone(ju);
  void _admin;
  const out: Ju = { ...rest, votes: {} };
  for (const [mid, pid] of Object.entries(votes ?? {})) if (visibleIds.has(mid)) out.votes[mid] = pid;
  if (plan) out.plan = publicPlan(plan, visibleIds);
  const s = publicSeeds(seeds, visibleIds);
  if (s) out.seeds = s;
  if (seating) out.seating = publicSeating(seating, visibleIds);
  return out;
}

function adminTokenOk(juId: string, token: string | undefined): boolean {
  if (!token) return false;
  let expected: string | null = null;
  try {
    expected = db.getAdminToken(juId);
  } catch {
    expected = null;
  }
  return expected !== null && safeEqual(expected, token);
}

/**
 * GET /api/ju/:id 的返回。
 * - 不带 token：纯公开视图
 * - 带正确 x-member-token：附 me（含 private，不含 secret）和 mine
 * - 带正确 x-admin-token：附 ju.admin 和 isAdmin（成员列表照样只有公开的人：发起人也不该知道谁拒绝了）
 * opts.mine 不传时从数据库的 ju_private 取（反事实检验时直接传内存里的）。
 */
export function publicState(
  ju: Ju,
  members: Member[],
  viewer?: { memberToken?: string; adminToken?: string },
  opts?: { mine?: Record<string, MyExperience[]> },
): JuState {
  const visible = visibleMembers(ju, members);
  const state: JuState = {
    ju: publicJu(ju, members),
    members: visible.map(publicMember),
    counts: publicCounts(ju, members),
  };

  const me = findByToken(members, viewer?.memberToken);
  if (me) {
    state.me = selfMember(me);
    let mineAll = opts?.mine;
    if (!mineAll) {
      try {
        mineAll = db.getJuPrivate(ju.id).mine;
      } catch {
        mineAll = {};
      }
    }
    const visibleById = new Map(visible.map((m) => [m.id, m]));
    const namesOf = (ids: string[] | undefined) => (ids ?? []).map((id) => visibleById.get(id)?.name).filter((x): x is string => !!x);
    state.mine = {
      experiences: structuredClone(mineAll[me.id] ?? []),
      matchNames: namesOf(me.private?.matches),
      unread: (me.private?.inbox ?? []).filter((n) => !n.read).length,
    };
    const seats = me.status === "in" ? mySeats(ju, visible, me) : undefined;
    if (seats) state.mine.seats = seats;
    const clicks = namesOf(me.private?.clickMatches);
    if (clicks.length) state.mine.clickNames = clicks;
  }

  if (adminTokenOk(ju.id, viewer?.adminToken)) {
    state.isAdmin = true;
    if (ju.admin) state.ju.admin = structuredClone(ju.admin);
  }
  return state;
}

// ---------------------------------------------------------------- PublicFacts

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** "10月23日 周五 19:00"（按北京时间） */
export function slotLabel(slot: Pick<Slot, "start">): string {
  const d = new Date(new Date(slot.start).getTime() + 8 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${WEEK[d.getUTCDay()]} ${hh}:${mm}`;
}

/** 定局方案的到场人数：在局的人里，除了方案里明确来不了（absent）的都算——
 *  方案算完之后才进来的人（攒批期间入局 / 候补转正）在方案里没有体验行，但人是来的 */
function attendeesOf(p: Proposal, visibleIds: Set<string>): number {
  const absent = new Set(p.experiences.filter((e) => e.status === "absent").map((e) => e.memberId));
  return [...visibleIds].filter((id) => !absent.has(id)).length;
}

/** 写公开文案的 LLM 唯一的输入。只从公开视图构造，所以天然不含任何私密字段 */
export function publicFacts(ju: Ju, members: Member[]): PublicFacts {
  const view = publicState(ju, members, undefined, { mine: {} });
  const pj = view.ju;
  const visibleIds = new Set(view.members.map((m) => m.id));
  const facts: PublicFacts = {
    title: pj.title,
    category: pj.spec.category,
    city: pj.spec.city,
    status: pj.status,
    members: view.members.map((m) => ({
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      role: m.role,
      intake: m.intake,
      isOrganizer: m.isOrganizer,
    })),
    counts: view.counts,
    constraintSummaries: [...(pj.plan?.constraintSummaries ?? [])],
  };
  if (pj.organizerName) facts.organizerName = pj.organizerName;
  if (pj.plan) {
    facts.proposals = pj.plan.proposals.map((p) => {
      const out: NonNullable<PublicFacts["proposals"]>[number] = {
        id: p.id,
        labelText: p.labelText,
        slotLabel: slotLabel(p.slot),
        poiName: p.poi.name,
        attendCount: p.attendCount,
        headline: p.headline,
        tradeoffs: [...p.tradeoffs],
        highlights: [...p.highlights],
        recommended: p.recommended,
      };
      if (p.poi.costPerPerson !== undefined) out.costPerPerson = p.poi.costPerPerson;
      return out;
    });
    facts.recommendation = pj.plan.recommendation;
    if (pj.plan.caredFor) facts.caredFor = pj.plan.caredFor;
    if (pj.plan.why?.length) facts.why = [...pj.plan.why];
    if (pj.plan.reminders?.length) facts.reminders = [...pj.plan.reminders];
    const c = pj.status === "confirmed" ? pj.plan.proposals.find((p) => p.id === pj.confirmedProposalId) : undefined;
    if (c) {
      const headcount = attendeesOf(c, visibleIds);
      facts.confirmed = {
        slotLabel: slotLabel(c.slot),
        poiName: c.poi.name,
        address: c.poi.address,
        headcount,
      };
      if (c.poi.tel) facts.confirmed.tel = c.poi.tel;
      // v5 决定书的公开部分（只读公开的方案数据：理由、风险、备案）
      const d = decisionOf(pj, headcount);
      if (d) {
        if (d.why.length) facts.confirmed.why = d.why;
        if (d.risks.length) facts.confirmed.risks = d.risks.map((r) => ({ text: r.text, mitigation: r.mitigation }));
        if (d.fallback) facts.confirmed.fallback = { trigger: d.fallback.trigger, poiName: d.fallback.poi.name };
        if (d.groupActions.length) facts.confirmed.groupActions = d.groupActions;
      }
    }
  }
  if (pj.settlement) {
    facts.settlement = {
      total: pj.settlement.total,
      payCount: pj.settlement.payCount,
      paidCount: pj.settlement.paidCount,
      // 分账说明本身就是公开安全的聚合句（C splitBill 产出）
      explain: [...(ju.admin?.split?.explain ?? [])],
    };
  }
  if (pj.revisions.length) facts.revisions = pj.revisions.map((r) => [r.reason, ...r.changes].join("："));
  return facts;
}

// ---------------------------------------------------------------- 输出兜底

/** 一个局里所有"绝不能出现在公开输出里"的东西 */
export type Sensitive = {
  /** 私密备注原文 */
  notes: string[];
  /** 私密预算数字 */
  budgets: number[];
  /** 不在场的人名（out / waitlist；门限未达成时除发起人外所有人），已排除和在场者重名的 */
  hiddenNames: string[];
  /** 各种 token / 密钥 / profileId：出现一次就算泄露 */
  secrets: string[];
  /** 圈层标签（核心圈 / 第二圈…） */
  tierLabels: string[];
};

export function sensitiveOf(ju: Ju, members: Member[]): Sensitive {
  const visible = visibleMembers(ju, members);
  const visibleNames = new Set(visible.map((m) => m.name));
  const notes = new Set<string>();
  const budgets = new Set<number>();
  const secrets = new Set<string>();
  // 点菜提醒是本人写授权书时就知道会匿名写出来的（"有人不吃香菜"）：同样的话出现在私聊备注里不算泄露
  const reminded = (ju.plan?.reminders ?? []).join("、");
  for (const m of members) {
    for (const n of m.private?.notes ?? []) if (n.trim().length >= 2 && !reminded.includes(n.trim())) notes.add(n.trim());
    // v5：局长私下问的问题原文（里面有本人的时间 / 预算细节），任何公开输出里都不能出现
    for (const a of m.private?.asks ?? []) if (a.text.trim().length >= 2) notes.add(a.text.trim());
    if (m.private?.budgetMax !== undefined) budgets.add(m.private.budgetMax);
    if (m.secret?.token) secrets.add(m.secret.token);
    if (m.profileId) secrets.add(m.profileId);
  }
  for (const t of ju.admin?.tiers ?? []) secrets.add(t.token);
  if (ju.admin?.auditSecret) secrets.add(ju.admin.auditSecret);
  try {
    const at = db.getAdminToken(ju.id);
    if (at) secrets.add(at);
  } catch {
    /* 测试场景不在库里 */
  }
  const hiddenNames = members
    .filter((m) => !visible.includes(m) && !visibleNames.has(m.name) && m.name.trim().length > 0)
    .map((m) => m.name);
  const tierLabels = (ju.admin?.tiers ?? []).map((t) => t.label).filter((l) => l.trim().length >= 2);
  return { notes: [...notes], budgets: [...budgets], hiddenNames: [...new Set(hiddenNames)], secrets: [...secrets], tierLabels };
}

export type LeakHit = { kind: "note" | "budget" | "name" | "secret" | "tier"; detail: string };

// v4 起"第 N 轮"是局内编排的活动轮次（公开），只有"第 N 轮邀请 / 名单 / 链接"才是圈层
const TIER_RE = /第\s*[一二三123]\s*[圈层]|第\s*[一二三123]\s*轮\s*(?:邀请|名单|链接)|tier\s*\d/i;

const numRe = (n: number) => new RegExp(`(?<![\\d.])${String(n).replace(".", "\\.")}(?![\\d]|\\.\\d)`);

/** 文本里出现的所有数字（用于"这个数字本来就在公开输入里"的豁免） */
export function numbersIn(text: string): Set<number> {
  return new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
}

/**
 * 扫一段公开文本。allowedNumbers：本来就公开的数字（如店的人均价），撞上私密预算不算泄露。
 * 名字只在两侧不是汉字字母时才算命中太宽，这里按子串匹配（宁可误报退回规则版，也不漏）。
 */
export function scanText(text: string, s: Sensitive, allowedNumbers: Set<number> = new Set()): LeakHit[] {
  const hits: LeakHit[] = [];
  if (!text) return hits;
  for (const n of s.notes) if (text.includes(n)) hits.push({ kind: "note", detail: n });
  for (const b of s.budgets) if (!allowedNumbers.has(b) && numRe(b).test(text)) hits.push({ kind: "budget", detail: String(b) });
  for (const name of s.hiddenNames) if (text.includes(name)) hits.push({ kind: "name", detail: name });
  for (const sec of s.secrets) if (sec && text.includes(sec)) hits.push({ kind: "secret", detail: sec.slice(0, 4) + "…" });
  for (const l of s.tierLabels) if (text.includes(l)) hits.push({ kind: "tier", detail: l });
  if (TIER_RE.test(text)) hits.push({ kind: "tier", detail: "圈层" });
  return hits;
}

/** 递归收集对象里的所有字符串值 */
export function stringsIn(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) for (const v of x) stringsIn(v, out);
  else if (x && typeof x === "object") for (const v of Object.values(x)) stringsIn(v, out);
  return out;
}

function warnLeak(where: string, ju: Ju, hits: LeakHit[]) {
  // 日志里只写类别，不写命中的原文（日志本身也不该成为泄露渠道）
  const kinds = [...new Set(hits.map((h) => h.kind))].join(",");
  console.warn(`[firewall] ${where} 输出命中私密信息（${kinds}），已退回规则版文案（局 ${ju.id}）`);
}

/** 通用：扫一段公开文案，命中就用 fallback */
export function guardPublicText(ju: Ju, members: Member[], text: string, fallback: string, where = "text"): string {
  const facts = publicFacts(ju, members);
  const hits = scanText(text, sensitiveOf(ju, members), numbersIn(JSON.stringify(facts)));
  if (hits.length === 0) return text;
  warnLeak(where, ju, hits);
  return fallback;
}

function sameNumbers(a: Proposal, b: Proposal): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.slot.id === b.slot.id &&
    a.poi.id === b.poi.id &&
    a.attendCount === b.attendCount &&
    a.minUtility === b.minUtility &&
    a.avgUtility === b.avgUtility &&
    a.score === b.score &&
    a.recommended === b.recommended &&
    JSON.stringify(a.experiences) === JSON.stringify(b.experiences)
  );
}

/** 规则版润色：blurb = headline。LLM 不可用 / 越界时用它 */
export function rulePolish(plan: Plan): Plan {
  const p = structuredClone(plan);
  for (const pr of p.proposals) if (!pr.blurb) pr.blurb = pr.headline;
  return p;
}

/**
 * polishPlan 的输出兜底：只许改文字。数字 / 排序 / 体验有任何变化，或文字命中私密信息，都退回规则版。
 * audit 一律用原方案的（哈希不能被 LLM 改）。
 */
export function guardPlan(ju: Ju, members: Member[], original: Plan, polished: Plan | undefined): Plan {
  const fallback = rulePolish(original);
  if (!polished || !Array.isArray(polished.proposals)) return fallback;
  if (
    polished.proposals.length !== original.proposals.length ||
    polished.proposals.some((p, i) => !sameNumbers(p, original.proposals[i]))
  ) {
    console.warn(`[firewall] polishPlan 改动了数字或排序，已退回规则版（局 ${ju.id}）`);
    return fallback;
  }
  const facts = publicFacts({ ...ju, plan: original }, members);
  const allowed = numbersIn(JSON.stringify(facts));
  const texts = [
    polished.recommendation,
    polished.caredFor ?? "",
    ...polished.constraintSummaries,
    ...polished.proposals.flatMap((p) => [p.blurb ?? "", p.headline, p.labelText, ...p.tradeoffs, ...p.highlights]),
  ];
  const hits = texts.flatMap((t) => scanText(t, sensitiveOf(ju, members), allowed));
  if (hits.length) {
    warnLeak("polishPlan", ju, hits);
    return fallback;
  }
  const out = structuredClone(original);
  out.recommendation = polished.recommendation || original.recommendation;
  out.proposals.forEach((p, i) => {
    const q = polished.proposals[i];
    p.blurb = q.blurb || p.headline;
    p.headline = q.headline || p.headline;
    p.tradeoffs = q.tradeoffs;
    p.highlights = q.highlights;
  });
  if (polished.caredFor !== undefined) out.caredFor = polished.caredFor;
  return out;
}

/** groupMessages 的输出兜底：任何一句命中就整份退回规则版 */
export function guardMessages(ju: Ju, members: Member[], msgs: GroupMessages | undefined, fallback: GroupMessages): GroupMessages {
  if (!msgs || typeof msgs.broadcast !== "string") return fallback;
  const facts = publicFacts(ju, members);
  const allowed = numbersIn(JSON.stringify(facts));
  const visibleIds = new Set(facts.members.map((m) => m.id));
  // nudges 只能点名在场的人
  if ((msgs.nudges ?? []).some((n) => !visibleIds.has(n.memberId))) {
    console.warn(`[firewall] groupMessages 点名了不在场的人，已退回规则版（局 ${ju.id}）`);
    return fallback;
  }
  const hits = stringsIn(msgs).flatMap((t) => scanText(t, sensitiveOf(ju, members), allowed));
  if (hits.length) {
    warnLeak("groupMessages", ju, hits);
    return fallback;
  }
  return msgs;
}
