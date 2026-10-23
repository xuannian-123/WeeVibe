// v1 → v3 数据升级：线上库里有 v1 时期的局（方案存成 plan.options、成员没有 private）。
// 读库时就地转换成 v3 形状，下次保存时自然写回 v3。转换是确定性的，只用记录里已有的字段。
// v1 的 conflicts 里会点名（"小周：清真"），v3 不允许公开点名，所以不带过来。
import { randomUUID } from "node:crypto";
import type { DayAvailability, DietTag, Experience, Ju, Member, Plan, Poi, Proposal, ProposalLabel, Slot } from "./types";

type V1Option = {
  poi: Poi;
  score?: number;
  commutes?: { memberId: string; minutes: number }[];
  reasons?: string[];
  blurb?: string;
};
type V1Plan = {
  slotId?: string;
  attendeeIds?: string[];
  absentIds?: string[];
  center?: Plan["center"];
  options?: V1Option[];
  computedAt?: string;
};

const LABELS: { label: ProposalLabel; text: string }[] = [
  { label: "balanced", text: "方案 A" },
  { label: "most-comfortable", text: "方案 B" },
  { label: "cheapest", text: "方案 C" },
];

function slotOf(ju: Ju, slotId: string | undefined): Slot {
  const s = ju.slots?.find((x) => x.id === slotId) ?? ju.slots?.[0];
  if (s) return s;
  const id = slotId ?? ju.createdAt.slice(0, 16);
  return { id, start: `${id}:00+08:00`, end: `${id}:00+08:00` };
}

function upgradePlan(ju: Ju, v1: V1Plan): Plan {
  const slot = slotOf(ju, v1.slotId);
  const attendees = v1.attendeeIds ?? [];
  const proposals: Proposal[] = (v1.options ?? []).slice(0, LABELS.length).map((o, i) => {
    const experiences: Experience[] = (o.commutes ?? [])
      .filter((c) => attendees.includes(c.memberId))
      .map((c) => ({
        memberId: c.memberId,
        status: "full",
        lateMin: 0,
        stayMin: ju.spec?.durationMinutes ?? 120,
        commuteMin: c.minutes,
        utility: Math.max(0, Math.min(100, 100 - Math.max(0, c.minutes - 15))),
        notes: [],
      }));
    const us = experiences.map((e) => e.utility);
    return {
      id: o.poi.id,
      label: LABELS[i].label,
      labelText: LABELS[i].text,
      slot,
      poi: o.poi,
      experiences,
      attendCount: attendees.length,
      minUtility: us.length ? Math.min(...us) : 0,
      avgUtility: us.length ? Math.round(us.reduce((a, b) => a + b, 0) / us.length) : 0,
      score: o.score ?? 0,
      headline: o.reasons?.[0] ?? o.poi.name,
      tradeoffs: [],
      highlights: (o.reasons ?? []).slice(1, 4),
      blurb: o.blurb,
      recommended: i === 0,
    };
  });
  return {
    proposals,
    recommendation: proposals[0]?.blurb ?? "",
    constraintSummaries: [],
    center: v1.center ?? { lat: 0, lng: 0 },
    audit: {
      inputHash: "legacy",
      outputHash: "legacy",
      candidates: proposals.length,
      evaluations: 0,
      paretoSize: 0,
      algorithmVersion: "juzhang-planner/1 (旧版局)",
    },
    computedAt: v1.computedAt ?? ju.createdAt,
  };
}

/** v1 局 → v3；已经是 v3 的原样补齐缺省字段 */
export function upgradeJu(raw: Ju): Ju {
  const j = raw as Ju & { confirmedPoiId?: string };
  const ju: Ju = {
    ...j,
    votes: j.votes ?? {},
    trace: j.trace ?? [],
    announcements: j.announcements ?? [],
    revisions: j.revisions ?? [],
    pendingChanges: j.pendingChanges ?? 0,
  };
  const plan = j.plan as unknown as (Plan & V1Plan) | undefined;
  if (plan && !Array.isArray(plan.proposals)) ju.plan = upgradePlan(ju, plan);
  if (!ju.confirmedProposalId && j.confirmedPoiId) ju.confirmedProposalId = j.confirmedPoiId;
  delete (ju as { confirmedPoiId?: string }).confirmedPoiId;
  if (ju.settlement && ju.settlement.payCount === undefined) {
    ju.settlement = { ...ju.settlement, itemized: false, payCount: 0, paidCount: 0 };
  }
  if (!ju.admin) ju.admin = { tiers: [], auditSecret: `legacy-${ju.id}` };
  return ju;
}

/** v1 成员 → v3：时间、忌口搬进 private；没有 token 的旧成员给一个谁也猜不到的随机 token（只在内存里） */
export function upgradeMember(raw: Member): Member {
  const m = raw as Member & { availableSlotIds?: string[]; dietTags?: DietTag[]; dietRaw?: string };
  const isV1 = !m.private && !m.secret;
  if (!isV1) return m;
  const availability: Record<string, DayAvailability> = {};
  for (const sid of m.availableSlotIds ?? []) {
    const date = sid.slice(0, 10);
    const from = sid.slice(11, 16);
    if (!availability[date] || from < availability[date].from) availability[date] = { from, pref: "ok" };
  }
  const { availableSlotIds: _a, dietTags, dietRaw: _d, ...rest } = m;
  void _a;
  void _d;
  return {
    ...rest,
    role: rest.role ?? "guest",
    intake: rest.intake ?? "done",
    private: {
      chat: [],
      availability,
      dietTags: dietTags ?? [],
      notes: [],
      swipes: {},
      autoFilled: [],
      wants: [],
      matches: [],
      billFacts: {},
      inbox: [],
    },
    secret: { token: randomUUID(), tier: 1 },
  };
}
