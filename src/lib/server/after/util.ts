// after/ 内部共用的小工具：时间（北京时间）、定局方案、成员视图。
import * as db from "../../db";
import type { Ju, Member, Proposal } from "../../types";
import { HttpError } from "../http";

const TZ_MS = 8 * 3600_000;

/** Date -> 北京时间 HH:mm */
export function hhmm(d: Date): string {
  return new Date(d.getTime() + TZ_MS).toISOString().slice(11, 16);
}

/** Date -> 北京时间 YYYY-MM-DD */
export function ymd(d: Date): string {
  return new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
}

/** 某个北京时间日期 + HH:mm -> Date */
export function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

export const MIN = 60_000;
export const HOUR = 3600_000;

export const inOnly = (ms: Member[]) => ms.filter((m) => m.status === "in");

/** 已定局的方案；没定局返回 undefined */
export function confirmedProposal(ju: Ju): Proposal | undefined {
  if (ju.status !== "confirmed" || !ju.plan || !ju.confirmedProposalId) return undefined;
  return ju.plan.proposals.find((p) => p.id === ju.confirmedProposalId);
}

export function requireConfirmed(ju: Ju): Proposal {
  const p = confirmedProposal(ju);
  if (!p) throw new HttpError(409, ju.status === "cancelled" ? "局已取消" : "还没定局");
  return p;
}

export function saveMembers(ms: Iterable<Member>): void {
  for (const m of ms) db.upsertMember(m);
}

/** 金额保留到分 */
export const yuan = (n: number) => Math.round(n * 100) / 100;

/** 金额展示：整数不带小数 */
export const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
