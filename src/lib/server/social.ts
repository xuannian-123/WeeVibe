// v4 局内编排（DB 层）：route 文件只做参数解析，状态机在 social-core.ts（纯内存）。
// 所有写操作经 mutateJu 串行化；返回给本人的只有 selfMember（含本人 private），给发起人的是 publicState。
import * as db from "../db";
import { solveGrouping, symmetricFamiliarity } from "../planner";
import type { CircleStep, Familiarity, Ju, JuState, Member, Profile, RoundFeel } from "../types";
import { findByToken, publicState, quorumHidden, selfMember, visibleMembers } from "./firewall";
import { HttpError } from "./http";
import { loadJu, mutateJu, type MutateCtx, type Viewer } from "./ju";
import { emptyPrivate, inOnly } from "./ju-core";
import { emptyProfile, getProfile, saveProfile } from "./profile";
import {
  advanceRound,
  applySocial,
  clickPairCount,
  computeSeating,
  markAbsent,
  recomputeClicks,
  setFeel as setFeelCore,
  type SocialPatch,
} from "./social-core";

function requireMe(ctx: MutateCtx, token: string | undefined): Member {
  if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
  const me = findByToken(ctx.members, token);
  if (!me) throw new HttpError(403, "成员身份不对");
  if (!me.private) me.private = emptyPrivate();
  return me;
}

// ---------------------------------------------------------------- #17 #18 私下标记

/** 我和大家熟不熟 / 今天电量 / 悄悄回避 / 公开兴趣 */
export function setSocial(juId: string, token: string, patch: SocialPatch): Promise<{ me: Member }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    if (ctx.ju.status === "cancelled") throw new HttpError(409, "局已取消");
    if (quorumHidden(ctx.ju)) throw new HttpError(409, "成局之后才能看到有谁");
    if (me.status !== "in") throw new HttpError(409, "你现在不在局里");
    const allowed = new Set(visibleMembers(ctx.ju, ctx.members).map((m) => m.id).filter((id) => id !== me.id));
    applySocial(me, patch, allowed);
    // 只写本人（公开兴趣在本人的 Member 上）
    ctx.members = ctx.members.filter((m) => m.id === me.id);
    return { me: selfMember(me) };
  });
}

// ---------------------------------------------------------------- #19 轮次反馈

export function setFeel(juId: string, token: string, round: number, feel: RoundFeel): Promise<{ me: Member }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    setFeelCore(ctx.ju, me, round, feel);
    ctx.members = ctx.members.filter((m) => m.id === me.id);
    return { me: selfMember(me) };
  });
}

// ---------------------------------------------------------------- #20 聊得来

/** 档案里记一笔"我和 TA 多熟"（只升不降） */
function remember(profile: Profile, otherPid: string, level: Familiarity): boolean {
  if (!otherPid || otherPid === profile.id) return false;
  const know = (profile.know ??= {});
  if ((know[otherPid] ?? 0) >= level) return false;
  know[otherPid] = level;
  return true;
}

export function setClicked(juId: string, token: string, memberIds: string[]): Promise<{ me: Member; clickNames: string[] }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    if (ctx.ju.status !== "confirmed") throw new HttpError(409, "局散了之后再来选吧");
    if (me.status !== "in") throw new HttpError(409, "你不在这次的局里");
    const visible = visibleMembers(ctx.ju, ctx.members);
    const ok = new Set(visible.map((m) => m.id));
    me.private!.clicked = [...new Set(memberIds)].filter((id) => id !== me.id && ok.has(id)).slice(0, 20);
    recomputeClicks(ctx.members, me, ctx.now);
    // #21 我选了聊得来的人，下次在我的档案里就是"挺熟"（只影响本人自己的标记）
    if (me.profileId) {
      const prof = getProfile(me.profileId) ?? emptyProfile(me.profileId);
      let dirty = false;
      for (const id of me.private!.clicked) {
        const o = ctx.members.find((m) => m.id === id);
        if (o?.profileId && remember(prof, o.profileId, 2)) dirty = true;
      }
      if (dirty) saveProfile(prof);
    }
    const byId = new Map(visible.map((m) => [m.id, m.name]));
    const clickNames = (me.private!.clickMatches ?? []).map((id) => byId.get(id)).filter((x): x is string => !!x);
    return { me: selfMember(me), clickNames };
  });
}

// ---------------------------------------------------------------- #21 圈子记忆

/**
 * 局后（生成回顾时）：一起到场的人，在各自档案里至少是"见过"。只写本人自己的档案，
 * 每个人记的是"我见过 TA"这个事实，不涉及任何人对别人的评价。
 */
export function rememberAttendance(attendees: Member[]): void {
  const withPid = attendees.filter((m) => m.profileId);
  for (const m of withPid) {
    const prof = getProfile(m.profileId!) ?? emptyProfile(m.profileId!);
    let dirty = false;
    for (const o of withPid) if (o.id !== m.id && remember(prof, o.profileId!, 1)) dirty = true;
    if (dirty) saveProfile(prof);
  }
}

/**
 * 入局时按档案记忆预填熟悉度（两个方向：我对已在局里的人、已在局里的人对我）。
 * 只填本人还没标过的；预填的记在 knowAuto 里，本人页面上会显示"局长记得"并且可以改。
 */
export function prefillKnow(members: Member[], newcomer: Member): void {
  if (!newcomer.profileId) return;
  const mine = getProfile(newcomer.profileId);
  for (const o of members) {
    if (o.id === newcomer.id || !o.profileId || !o.private) continue;
    const a = mine?.know?.[o.profileId];
    if (a) fill(newcomer, o.id, a);
    const theirs = getProfile(o.profileId);
    const b = theirs?.know?.[newcomer.profileId];
    if (b) fill(o, newcomer.id, b);
  }
}

function fill(m: Member, otherId: string, level: Familiarity): void {
  const p = (m.private ??= emptyPrivate());
  if (p.know?.[otherId] !== undefined) return;
  p.know = { ...(p.know ?? {}), [otherId]: level };
  p.knowAuto = [...new Set([...(p.knowAuto ?? []), otherId])];
}

// ---------------------------------------------------------------- #18 排座（发起人）

export function makeSeating(juId: string, body: { rounds?: number; tableSize?: number }, viewer: Viewer): Promise<JuState> {
  return mutateJu(juId, (ctx) => {
    computeSeating(ctx.ju, ctx.members, ctx.priv, { ...body, now: ctx.now });
    return publicState(ctx.ju, ctx.members, viewer, { mine: ctx.priv.mine });
  });
}

export function nextRound(juId: string, viewer: Viewer): Promise<JuState> {
  return mutateJu(juId, (ctx) => {
    advanceRound(ctx.ju, ctx.members, ctx.priv, ctx.now);
    return publicState(ctx.ju, ctx.members, viewer, { mine: ctx.priv.mine });
  });
}

export function seatAbsent(juId: string, memberId: string, absent: boolean, viewer: Viewer): Promise<JuState> {
  return mutateJu(juId, (ctx) => {
    markAbsent(ctx.ju, ctx.members, ctx.priv, memberId, absent, ctx.now);
    return publicState(ctx.ju, ctx.members, viewer, { mine: ctx.priv.mine });
  });
}

/** #18 一键复算：用最近一次排座的输入快照重跑，比对 outputHash */
export function verifySeating(juId: string): { ok: boolean; inputHash: string; outputHash: string; recomputedOutputHash: string } {
  const ju = loadJu(juId);
  const snap = db.getJuPrivate(juId).seatSnapshot;
  if (!ju.seating || !snap || !ju.admin?.auditSecret) throw new HttpError(409, "还没排座");
  const r = solveGrouping(structuredClone(snap.input), ju.admin.auditSecret);
  const a = ju.seating.audit;
  return {
    ok: r.outputHash === a.outputHash && r.inputHash === a.inputHash,
    inputHash: a.inputHash,
    outputHash: a.outputHash,
    recomputedOutputHash: r.outputHash,
  };
}

// ---------------------------------------------------------------- #21 圈子：一局一局熟起来

const CIRCLE_MAX = 8;

/** 一局的聚合数字：有排座就用排座的统计；没有排座时，定了局的按"到场的人都见过了"算 */
export function circleStepOf(ju: Ju, members: Member[]): CircleStep {
  const s = ju.seating;
  const p = ju.plan?.proposals.find((x) => x.id === ju.confirmedProposalId);
  const step: CircleStep = { juId: ju.id, title: ju.title, people: 0, pairs: 0, knownBefore: 0, knownAfter: 0, clickPairs: clickPairCount(members) };
  if (p) step.at = p.slot.start;
  if (s) {
    step.people = s.metrics.people;
    step.pairs = s.metrics.pairs;
    step.knownBefore = s.metrics.knownBefore;
    step.knownAfter = s.metrics.knownBefore + s.metrics.newPairs;
    return step;
  }
  const ins = quorumHidden(ju) ? [] : inOnly(members);
  const n = ins.length;
  const marks: Record<string, Record<string, Familiarity> | undefined> = {};
  for (const m of ins) marks[m.id] = m.private?.know;
  step.people = n;
  step.pairs = (n * (n - 1)) / 2;
  step.knownBefore = Object.keys(symmetricFamiliarity(marks, ins.map((m) => m.id))).length;
  step.knownAfter = ju.status === "confirmed" ? step.pairs : step.knownBefore;
  return step;
}

/** 顺着「再约」链往回找，最多 8 局，按时间先后 */
export function circle(juId: string): CircleStep[] {
  const chain: Ju[] = [];
  let cur: Ju | null = loadJu(juId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id) && chain.length < CIRCLE_MAX) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.prevJuId ? db.getJu(cur.prevJuId) : null;
  }
  return chain.map((j) => circleStepOf(j, db.listMembers(j.id)));
}
