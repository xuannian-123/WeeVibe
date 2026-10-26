// 和 B2（后端核心）的接缝，集中在这一个文件里。
// - 门限截止 / 方案截止这两个动作属于 B2（runDeadlines = advanceJu），这里只负责到点调用；
//   B2 的函数自己拿锁，必须在 B3 的锁外调
// - 一键再约复用 B2 的建局逻辑 createJu
// - 账本要用的"含私密因素的本人体验"由 B2 出方案时存在 ju_private.mine
import * as db from "../../db";
import type { Ju, JuSpec, Member, Proposal } from "../../types";
import { createJu, runDeadlines } from "../ju";

/** 到点就执行 B2 的截止动作（门限截止 → 成局 / 作废；截止时间 → 自动出方案 / 自动定局；攒批重算） */
export async function runCoreDeadlines(juId: string): Promise<void> {
  try {
    await runDeadlines(juId);
  } catch (e) {
    console.warn(`[after ${juId}] runDeadlines 失败：${(e as Error)?.message ?? e}`);
  }
}

/** 本人在定局方案下的真实满意度（含私密因素）；没存时返回 undefined，由调用方退回公开 utility */
export function myUtilityFor(ju: Ju, m: Member, proposal: Proposal): number | undefined {
  try {
    const mine = db.getJuPrivate(ju.id).mine[m.id] ?? [];
    return mine.find((x) => x.proposalId === proposal.id)?.utility;
  } catch {
    return undefined;
  }
}

/** 把候选日期按整周往后挪，直到第一天不早于明天（北京时间） */
export function shiftSpecToFuture(spec: JuSpec, now: Date): JuSpec {
  if (!spec.dates.length) return spec;
  const dayMs = 24 * 3600_000;
  const tomorrow = new Date(now.getTime() + 8 * 3600_000 + dayMs).toISOString().slice(0, 10);
  const diffDays = Math.max(0, Math.round((Date.parse(tomorrow) - Date.parse(spec.dates[0])) / dayMs));
  const shift = Math.ceil(diffDays / 7) * 7;
  if (!shift) return spec;
  return { ...spec, dates: spec.dates.map((d) => new Date(Date.parse(d) + shift * dayMs).toISOString().slice(0, 10)) };
}

/** 一键再约：用 B2 的建局逻辑新建一个局，seeds = 这次在场的人（发起人自己除外，他会以发起人身份入局） */
export async function createJuForAgain(
  ju: Ju,
  attendees: Member[],
  prompt: string | undefined,
): Promise<{ id: string; adminToken: string; tierLinks: { tier: number; label: string; token: string }[] }> {
  const seeds = attendees
    .filter((m) => !m.isOrganizer)
    .map((m) => ({ name: m.name, said: "yes" as const, hint: "上次一起的朋友" }));
  const organizer = attendees.find((m) => m.isOrganizer)?.name ?? ju.organizerName;
  const text = prompt?.trim() || ju.rawPrompt;
  return createJu(
    {
      prompt: text || `再约一次${ju.spec.category}`,
      ...(organizer ? { organizerName: organizer } : {}),
      // 没有一句话可解析（截图开的局）：沿用上次的需求，日期顺延到下周同一天
      ...(text ? {} : { spec: shiftSpecToFuture(ju.spec, new Date()), title: ju.title }),
      ...(ju.capacity ? { capacity: ju.capacity } : {}),
      ...(seeds.length ? { seeds } : {}),
    },
    // #21 同一个圈子的上一局：大屏和局页能画出"一局一局熟起来"
    { prevJuId: ju.id },
  );
}
