// v5 协商（docs/DECISION.md 5.4）：局长私下问的是 / 否问题，本人在这里回答。
// 答应 → 放宽本人的时间门槛 / 这次不计较某条软偏好，记一笔让步账（下次少问他）；
// 所有问题都答完 → 重新出方案（还在投票阶段时）。群里只看到"局长私下协调了 N 位朋友"。
import type { Member } from "../types";
import { findByToken, selfMember } from "./firewall";
import { HttpError } from "./http";
import { mutateJu, planDeps } from "./ju";
import { applyAnswer, computePlan, markChanged, pendingAsks } from "./ju-core";
import { emptyProfile, getProfile, saveProfile } from "./profile";

export function answerAsk(juId: string, token: string, askId: string, yes: boolean): Promise<{ me: Member }> {
  return mutateJu(juId, async (ctx) => {
    if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
    const me = findByToken(ctx.members, token);
    if (!me) throw new HttpError(403, "成员身份不对");
    applyAnswer(me, askId, yes, ctx.now);
    if (yes && me.profileId) {
      const prof = getProfile(me.profileId) ?? emptyProfile(me.profileId);
      prof.concessions = [...(prof.concessions ?? []), { juId, at: ctx.now.toISOString() }].slice(-20);
      saveProfile(prof);
    }
    markChanged(ctx.ju, ctx.priv, me.id);
    if (ctx.ju.status === "voting" && !pendingAsks(ctx.members)) {
      await computePlan(ctx.ju, ctx.members, ctx.priv, { ...planDeps(ctx.members), now: ctx.now });
    }
    return { me: selfMember(me) };
  });
}
