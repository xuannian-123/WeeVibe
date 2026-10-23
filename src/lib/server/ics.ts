// 生成 RFC 5545 日历文件：VEVENT + 两个提醒（提前 2 小时 / 出发前）
// 只用公开视图里的东西（firewall.publicState），所以 ics 链接不需要鉴权。
import type { JuState, Proposal } from "../types";
import { HttpError } from "./http";

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** 按 75 字节折行，不切断 UTF-8 字符 */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // 续行开头有一个空格
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function utc(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** 出发前多留的余量（分钟） */
export const DEPART_BUFFER_MIN = 10;

function pickProposal(state: JuState): Proposal | undefined {
  const plan = state.ju.plan;
  if (!plan) return undefined;
  return (
    plan.proposals.find((p) => p.id === state.ju.confirmedProposalId) ??
    plan.proposals.find((p) => p.recommended) ??
    plan.proposals[0]
  );
}

/**
 * state 必须是公开视图。memberId 给了的话按他在方案里的公开通勤时间加一个"该出发了"提醒，
 * 否则默认开始前 1 小时提醒出发。
 */
export function buildIcs(state: JuState, opts: { memberId?: string } = {}, now = new Date()): { filename: string; body: string } {
  const { ju, members } = state;
  const p = pickProposal(state);
  if (!p) throw new HttpError(409, "还没出方案，没法加日历");

  const names = p.experiences
    .filter((e) => e.status !== "absent")
    .map((e) => members.find((m) => m.id === e.memberId)?.name)
    .filter((x): x is string => !!x);

  const desc = [
    `${ju.title}${ju.status === "confirmed" ? "" : "（待定）"}`,
    `地点：${p.poi.name}`,
    p.poi.address ? `地址：${p.poi.address}` : "",
    p.poi.tel ? `电话：${p.poi.tel}` : "",
    names.length ? `一起的朋友（${names.length} 人）：${names.join("、")}` : "",
    p.poi.costPerPerson !== undefined ? `人均约 ${Math.round(p.poi.costPerPerson)} 元` : "",
    "—— 由 AI 局长 组局",
  ]
    .filter(Boolean)
    .join("\n");

  const mine = opts.memberId ? p.experiences.find((e) => e.memberId === opts.memberId && e.status !== "absent") : undefined;
  const lead = mine ? Math.max(5, mine.commuteMin + mine.lateMin + DEPART_BUFFER_MIN) : 60;
  const departText = mine
    ? `该出发了：去${p.poi.name}路上约 ${mine.commuteMin} 分钟`
    : `准备出发：${p.poi.name}，${ju.title} 1 小时后开始`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Juzhang//Hackathon//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ju.id}-${p.slot.id.replace(/[^0-9T]/g, "")}@juzhang`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(p.slot.start)}`,
    `DTEND:${utc(p.slot.end)}`,
    `SUMMARY:${esc(`${ju.title} · ${p.poi.name}`)}`,
    `LOCATION:${esc([p.poi.name, p.poi.address].filter(Boolean).join(" "))}`,
    `GEO:${p.poi.lat.toFixed(6)};${p.poi.lng.toFixed(6)}`,
    `DESCRIPTION:${esc(desc)}`,
    `STATUS:${ju.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`${ju.title} 还有 2 小时开始，${p.poi.name}`)}`,
    "TRIGGER:-PT2H",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(departText)}`,
    `TRIGGER:-PT${lead}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { filename: `${ju.title}.ics`, body: lines.map(fold).join("\r\n") + "\r\n" };
}

export function icsResponse({ filename, body }: { filename: string; body: string }): Response {
  // 老客户端只认 filename=，中文标题时退回 juzhang.ics；新客户端读 filename*
  const ascii = /^[\x20-\x7e]+$/.test(filename) ? filename.replace(/"/g, "") : "juzhang.ics";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
