// v5 协商（docs/DECISION.md 5.4）：局长私下问的是 / 否问题，本人在这里回答。
// 答应 → 放宽本人的时间门槛 / 这次不计较某条软偏好，记一笔让步账（下次少问他）；
// 所有问题都答完 → 重新出方案（还在投票阶段时）。群里只看到"局长私下协调了 N 位朋友"。
// v6 分身（docs/AVATAR.md 4.4）：结果公布后 30 分钟内，本人可以撤回分身替他做的任何一次自动让步——
// 撤回 = 这一局里这一维的 give 视为 0，触发重算。和回答问题一样，重算只说"有朋友更新了情况"，看不出是谁撤回的。
import { z } from "zod";
import type { AvatarLogEntry, Member } from "../types";
import { findByToken, selfMember } from "./firewall";
import { HttpError } from "./http";
import { mutateJu, planDeps, recordConcession } from "./ju";
import { REVOKE_WINDOW_MS, applyAnswer, computePlan, markChanged, pendingAsks } from "./ju-core";

export function answerAsk(juId: string, token: string, askId: string, yes: boolean): Promise<{ me: Member }> {
  return mutateJu(juId, async (ctx) => {
    if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
    const me = findByToken(ctx.members, token);
    if (!me) throw new HttpError(403, "成员身份不对");
    applyAnswer(me, askId, yes, ctx.now);
    if (yes) recordConcession(me, juId, ctx.now);
    markChanged(ctx.ju, ctx.priv, me.id);
    if (ctx.ju.status === "voting" && !pendingAsks(ctx.members)) {
      await computePlan(ctx.ju, ctx.members, ctx.priv, { ...planDeps(ctx.members), now: ctx.now });
    }
    return { me: selfMember(me) };
  });
}

/** POST /api/ju/:id/avatar 的入参 */
export const avatarBody = z.object({
  action: z.literal("revoke").default("revoke"),
  entryId: z.string().trim().min(1).max(64),
});

/**
 * 撤回一次自动让步：只能撤回自己的、还没撤回过的、带维度的让步；只在投票阶段、方案公布后 30 分钟内。
 * 撤回后（没有正在等回答的问题时）立刻重算。
 */
export function revokeConcession(juId: string, token: string, entryId: string): Promise<{ me: Member; entry: AvatarLogEntry }> {
  return mutateJu(juId, async (ctx) => {
    if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
    const me = findByToken(ctx.members, token);
    if (!me) throw new HttpError(403, "成员身份不对");
    const entry = (me.private?.avatarLog ?? []).find((e) => e.id === entryId);
    if (!entry) throw new HttpError(404, "没有这条记录");
    if (entry.kind !== "concede" || !entry.dim) throw new HttpError(400, "只有分身自动替你让的步可以撤回");
    if (entry.revoked) throw new HttpError(409, "这一步已经撤回过了");
    if (ctx.ju.status !== "voting" || !ctx.ju.plan) throw new HttpError(409, ctx.ju.status === "confirmed" ? "已经定局了，撤回不了" : "现在没有可以撤回的方案");
    const published = Date.parse(ctx.ju.plan.computedAt);
    if (!Number.isFinite(published) || ctx.now.getTime() - published > REVOKE_WINDOW_MS) throw new HttpError(409, "结果公布超过 30 分钟，撤回不了了");
    entry.revoked = true;
    markChanged(ctx.ju, ctx.priv, me.id);
    if (!pendingAsks(ctx.members)) {
      await computePlan(ctx.ju, ctx.members, ctx.priv, { ...planDeps(ctx.members), now: ctx.now });
    }
    return { me: selfMember(me), entry: structuredClone(entry) };
  });
}
