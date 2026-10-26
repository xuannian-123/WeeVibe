// v4 局内编排的视图部分：本人看到的座位说明、公开视图里的座位表。只依赖类型，防火墙可以直接用（不会循环引用）。
import type { Ju, Member, MySeat, Seating } from "../types";

/** 我每一轮坐哪 + 为什么这么排。解释只用本人自己的标记和本来就公开的信息 */
export function mySeats(ju: Ju, members: Member[], me: Member): MySeat[] | undefined {
  const s = ju.seating;
  if (!s) return undefined;
  const byId = new Map(members.map((m) => [m.id, m]));
  const know = me.private?.know ?? {};
  const matches = new Set(me.private?.matches ?? []);
  const out: MySeat[] = [];
  for (const r of s.rounds) {
    const t = r.tables.find((x) => x.memberIds.includes(me.id));
    if (!t) continue;
    const mates = t.memberIds.filter((x) => x !== me.id && byId.get(x)?.status === "in");
    const name = (id: string) => byId.get(id)?.name ?? "";
    const close = mates.filter((x) => know[x] === 2).map(name);
    const met = mates.filter((x) => know[x] === 1).map(name);
    // 只有本人明确标了"不认识"的才说不认识；没标过的不下结论（不能拿别人的标记来解释）
    const fresh = mates.filter((x) => know[x] === 0).length;
    const unmarked = mates.filter((x) => know[x] === undefined).length;
    const notes: string[] = [];
    const matched = mates.filter((x) => matches.has(x)).map(name);
    if (matched.length) notes.push(`你和${matched.join("、")}互相想认识，这轮坐一起 ✨`);
    if (close.length) notes.push(`这桌有你挺熟的${close.join("、")}`);
    else if (met.length) notes.push(`这桌有你见过的${met.join("、")}`);
    if (fresh > 0) notes.push(`另外 ${fresh} 位你还不认识，话题卡给你们准备好了`);
    else if (unmarked > 0 && !close.length && !met.length) notes.push("话题卡给这桌准备好了");
    if (unmarked > 0 && Object.keys(know).length === 0 && r.index === 0) notes.push("你还没标和大家熟不熟，标一下局长能排得更准");
    if (r.index > 0 && me.private?.energy === "low" && (close.length || met.length)) notes.push("你说今天想安静点，这一轮也给你留了认识的人");
    out.push({ round: r.index, tableId: t.id, mates: mates.map(name), notes });
  }
  return out;
}

/** 公开视图里的排座：只留对外可见的人（私下退出的人从座位表里消失，和他没来过一样） */
export function publicSeating(s: Seating, visibleIds: Set<string>): Seating {
  const out = structuredClone(s);
  for (const r of out.rounds) for (const t of r.tables) t.memberIds = t.memberIds.filter((id) => visibleIds.has(id));
  out.absentIds = out.absentIds.filter((id) => visibleIds.has(id));
  return out;
}
