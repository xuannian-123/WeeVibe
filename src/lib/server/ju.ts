// 业务逻辑：route 文件只做参数解析，真正的事都在这里。
// 同一个局的所有写操作经 withJuLock 串行化（planJu / LLM 是 async，避免并发覆盖）。
import { customAlphabet, nanoid } from "nanoid";
import * as db from "../db";
import { parseDiet, parsePrompt, titleFromSpec, writeBlurbs } from "../llm";
import { getMapProvider } from "../map";
import { generateSlots, planJu, settle as settleAA } from "../planner";
import type { Ju, JuState, Member, Plan } from "../types";
import { HttpError } from "./http";
import type { AddMemberInput, PatchMemberInput } from "./schemas";
import type { JuSpec } from "../types";

export const AVATARS = ["🐱", "🦊", "🐼", "🐸", "🐯", "🐰", "🐧", "🦄", "🐨", "🐶"];

const juId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

export function defaultCity(): string {
  return (process.env.DEMO_CITY ?? "").trim() || "苏州";
}

// ---------------------------------------------------------------- 锁

const g = globalThis as unknown as { __juLocks?: Map<string, Promise<unknown>> };
const locks = (g.__juLocks ??= new Map());

export async function withJuLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

// ---------------------------------------------------------------- 读

export function loadJu(id: string): Ju {
  const ju = db.getJu(id);
  if (!ju) throw new HttpError(404, "局不存在");
  return ju;
}

export function getState(id: string): JuState {
  const ju = loadJu(id);
  return { ju, members: db.listMembers(id) };
}

const inOnly = (ms: Member[]) => ms.filter((m) => m.status === "in");

// ---------------------------------------------------------------- 解析 / 建局

export async function previewParse(prompt: string) {
  const { title, spec } = await parsePrompt(prompt, new Date(), defaultCity());
  return { title, spec, slots: generateSlots(spec) };
}

export async function createJu(input: { prompt: string; title?: string; spec?: JuSpec; organizerName?: string }) {
  const now = new Date();
  let title: string;
  let spec: JuSpec;
  if (input.spec) {
    spec = input.spec;
    title = input.title ?? titleFromSpec(spec, now);
  } else {
    if (!input.prompt) throw new HttpError(400, "请说一句话描述这个局，或者直接传 spec");
    const parsed = await parsePrompt(input.prompt, now, defaultCity());
    spec = parsed.spec;
    title = input.title ?? parsed.title;
  }
  const slots = generateSlots(spec);
  if (slots.length === 0) throw new HttpError(400, "没有可选的时间，检查一下日期和时间段");

  const ju: Ju = {
    id: juId(),
    title,
    rawPrompt: input.prompt,
    organizerName: input.organizerName,
    spec,
    slots,
    status: "collecting",
    createdAt: now.toISOString(),
    votes: {},
  };
  const adminToken = nanoid(24);
  db.insertJu(ju, adminToken);
  return { id: ju.id, adminToken, organizerMemberId: null };
}

// ---------------------------------------------------------------- 出方案

async function computePlan(ju: Ju, members: Member[]): Promise<Plan> {
  const plan = await planJu(ju, inOnly(members), getMapProvider());
  const blurbs = await writeBlurbs(ju, plan, members);
  plan.options.forEach((o, i) => {
    if (blurbs[i]) o.blurb = blurbs[i];
  });
  return plan;
}

/** voting 阶段成员变化后自动重算（清空票数）；失败时保留旧方案 */
async function autoReplan(ju: Ju): Promise<void> {
  if (ju.status !== "voting" || !ju.plan) return;
  const members = db.listMembers(ju.id);
  if (inOnly(members).length === 0) {
    ju.plan = undefined;
    ju.status = "collecting";
    ju.votes = {};
    return;
  }
  try {
    ju.plan = await computePlan(ju, members);
    ju.votes = {};
  } catch (e) {
    console.warn(`[ju ${ju.id}] 自动重算失败，保留旧方案：${(e as Error).message}`);
    const inIds = new Set(inOnly(members).map((m) => m.id));
    for (const k of Object.keys(ju.votes)) if (!inIds.has(k)) delete ju.votes[k];
  }
}

export function makePlan(id: string): Promise<JuState> {
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    if (ju.status === "cancelled") throw new HttpError(409, "局已取消");
    const members = db.listMembers(id);
    if (inOnly(members).length === 0) throw new HttpError(400, "还没有人报名，先把链接发到群里吧");
    let plan: Plan;
    try {
      plan = await computePlan(ju, members);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, (e as Error).message || "出方案失败");
    }
    ju.plan = plan;
    ju.status = "voting";
    ju.votes = {};
    ju.confirmedPoiId = undefined;
    ju.settlement = undefined;
    db.saveJu(ju);
    return { ju, members };
  });
}

// ---------------------------------------------------------------- 成员

function pickAvatar(members: Member[]): string {
  const used = new Set(members.map((m) => m.avatar));
  return AVATARS.find((a) => !used.has(a)) ?? AVATARS[members.length % AVATARS.length];
}

export async function addMember(id: string, input: AddMemberInput): Promise<{ memberId: string }> {
  loadJu(id); // 先 404，再去调 LLM
  const dietTags = await parseDiet(input.dietRaw);
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    if (ju.status === "confirmed" || ju.status === "cancelled") {
      throw new HttpError(409, ju.status === "confirmed" ? "这个局已经定了，下次早点来～" : "局已取消");
    }
    const members = db.listMembers(id);
    const slotIds = new Set(ju.slots.map((s) => s.id));
    const m: Member = {
      id: nanoid(10),
      juId: id,
      name: input.name,
      avatar: input.avatar || pickAvatar(members),
      location: input.location,
      availableSlotIds: input.availableSlotIds.filter((s) => slotIds.has(s)),
      dietRaw: input.dietRaw,
      dietTags,
      ...(input.budgetMax != null ? { budgetMax: input.budgetMax } : {}),
      status: "in",
      joinedAt: new Date().toISOString(),
      isOrganizer: input.isOrganizer ?? false,
      ...(input.fillSeconds !== undefined ? { fillSeconds: input.fillSeconds } : {}),
    };
    db.upsertMember(m);
    if (ju.status === "voting") {
      await autoReplan(ju);
      db.saveJu(ju);
    }
    return { memberId: m.id };
  });
}

export async function updateMember(id: string, mid: string, patch: PatchMemberInput): Promise<{ ok: true }> {
  loadJu(id);
  const dietTags = patch.dietRaw !== undefined ? await parseDiet(patch.dietRaw) : undefined;
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    const m = db.getMember(mid);
    if (!m || m.juId !== id) throw new HttpError(404, "成员不存在");
    const slotIds = new Set(ju.slots.map((s) => s.id));

    const statusChanged = patch.status !== undefined && patch.status !== m.status;
    const locChanged =
      patch.location !== undefined && (patch.location.lat !== m.location.lat || patch.location.lng !== m.location.lng);
    const nextSlots = patch.availableSlotIds?.filter((s) => slotIds.has(s));
    const slotsChanged = nextSlots !== undefined && nextSlots.join() !== m.availableSlotIds.join();

    if (patch.name !== undefined) m.name = patch.name;
    if (patch.avatar !== undefined) m.avatar = patch.avatar;
    if (patch.location !== undefined) m.location = patch.location;
    if (nextSlots !== undefined) m.availableSlotIds = nextSlots;
    if (patch.dietRaw !== undefined) {
      m.dietRaw = patch.dietRaw;
      m.dietTags = dietTags ?? [];
    }
    if (patch.budgetMax !== undefined) {
      if (patch.budgetMax === null) delete m.budgetMax;
      else m.budgetMax = patch.budgetMax;
    }
    if (patch.isOrganizer !== undefined) m.isOrganizer = patch.isOrganizer;
    if (patch.status !== undefined) m.status = patch.status;
    db.upsertMember(m);

    let juDirty = false;
    if (m.status === "out" && ju.votes[mid]) {
      delete ju.votes[mid];
      juDirty = true;
    }
    if (ju.status === "voting" && (statusChanged || locChanged || slotsChanged || dietTags !== undefined)) {
      await autoReplan(ju);
      juDirty = true;
    }
    if (juDirty) db.saveJu(ju);
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- 投票 / 定局 / AA

/** plan.attendeeIds 中仍在场（status=in）的人 */
function eligibleVoters(ju: Ju, members: Member[]): string[] {
  const inIds = new Set(inOnly(members).map((m) => m.id));
  return (ju.plan?.attendeeIds ?? []).filter((x) => inIds.has(x));
}

function assertPoi(ju: Ju, poiId: string) {
  if (!ju.plan) throw new HttpError(409, "还没出方案");
  if (!ju.plan.options.some((o) => o.poi.id === poiId)) throw new HttpError(400, "这家店不在候选里");
}

export function vote(id: string, memberId: string, poiId: string): Promise<JuState> {
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    if (ju.status !== "voting") {
      throw new HttpError(409, ju.status === "confirmed" ? "已经定局了" : "现在还不能投票");
    }
    const members = db.listMembers(id);
    const m = members.find((x) => x.id === memberId);
    if (!m) throw new HttpError(404, "成员不存在");
    if (m.status !== "in") throw new HttpError(409, "你已经退出这个局了");
    assertPoi(ju, poiId);
    ju.votes[memberId] = poiId;

    const voters = eligibleVoters(ju, members);
    if (voters.length > 0) {
      const tally = new Map<string, number>();
      for (const v of voters) {
        const p = ju.votes[v];
        if (p) tally.set(p, (tally.get(p) ?? 0) + 1);
      }
      for (const [p, n] of tally) {
        if (n * 2 > voters.length) {
          ju.status = "confirmed";
          ju.confirmedPoiId = p;
          break;
        }
      }
    }
    db.saveJu(ju);
    return { ju, members };
  });
}

export function confirm(id: string, poiId: string): Promise<JuState> {
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    if (ju.status === "cancelled") throw new HttpError(409, "局已取消");
    assertPoi(ju, poiId);
    ju.status = "confirmed";
    ju.confirmedPoiId = poiId;
    db.saveJu(ju);
    return { ju, members: db.listMembers(id) };
  });
}

export function settleJu(id: string, total: number, payerName?: string): Promise<JuState> {
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    if (!ju.plan) throw new HttpError(409, "还没出方案，没法 AA");
    const members = db.listMembers(id);
    const count = Math.max(1, eligibleVoters(ju, members).length);
    const s = settleAA(total, count);
    ju.settlement = { ...s, ...(payerName ? { payerName } : {}) };
    db.saveJu(ju);
    return { ju, members };
  });
}

// 供 seed 复用
export { autoReplan as _autoReplan, pickAvatar as _pickAvatar, inOnly as _inOnly };
