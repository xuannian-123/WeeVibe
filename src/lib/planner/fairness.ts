// #10 跨局公平账本：累计遗憾越高，本次 max-min 里的权重越高（1.0–1.6）。
import type { LedgerEntry, MyExperience } from "../types";
import { cmpStr } from "./util";

export const WEIGHT_MIN = 1.0;
export const WEIGHT_MAX = 1.6;
/** 只看最近几局（太久以前吃的亏不再算） */
export const LEDGER_WINDOW = 6;
/** 累计遗憾的尺度：约 150 分遗憾时权重走完 63% */
const REGRET_SCALE = 150;

/** 一个人的累计遗憾（最近 LEDGER_WINDOW 局，按时间取最新的） */
export function cumulativeRegret(entries: LedgerEntry[] | undefined): number {
  const list = [...(entries ?? [])]
    .filter((e) => Number.isFinite(e?.regret))
    .sort((a, b) => cmpStr(b.at ?? "", a.at ?? "") || cmpStr(a.juId ?? "", b.juId ?? ""))
    .slice(0, LEDGER_WINDOW);
  return list.reduce((s, e) => s + Math.max(0, e.regret), 0);
}

/** 遗憾 -> 权重：单调不减，1.0 起步，渐近 1.6 */
export function weightForRegret(regret: number): number {
  const r = Math.max(0, Number.isFinite(regret) ? regret : 0);
  const w = WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * (1 - Math.exp(-r / REGRET_SCALE));
  return Math.round(w * 100) / 100;
}

/** memberId -> 权重（1.0–1.6）。账本为空的人 1.0 */
export function fairnessWeights(ledgers: Record<string, LedgerEntry[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(ledgers ?? {}).sort(cmpStr)) out[id] = weightForRegret(cumulativeRegret(ledgers[id]));
  return out;
}

/** 记一笔账：regret = (100 - utility) + 通勤超出平均的部分，>= 0 */
export function ledgerEntryFor(
  juId: string,
  me: MyExperience & { commuteMin: number },
  avgCommuteMin: number,
  at: string,
): LedgerEntry {
  const commute = Math.max(0, Math.round(me.commuteMin));
  const avg = Math.round(Math.max(0, avgCommuteMin) * 10) / 10;
  const utility = Math.round(Math.max(0, Math.min(100, me.utility)));
  const regret = Math.round(Math.max(0, 100 - utility) + Math.max(0, commute - avg));
  return { juId, at, commuteMin: commute, avgCommuteMin: avg, utility, regret };
}
