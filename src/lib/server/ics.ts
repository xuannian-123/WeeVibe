// 生成 RFC 5545 日历文件：VEVENT + 提前 2 小时提醒
import type { JuState } from "../types";
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

export function buildIcs(state: JuState, now = new Date()): { filename: string; body: string } {
  const { ju, members } = state;
  const plan = ju.plan;
  if (!plan || plan.options.length === 0) throw new HttpError(409, "还没出方案，没法加日历");
  const opt = plan.options.find((o) => o.poi.id === ju.confirmedPoiId) ?? plan.options[0];
  const slot = ju.slots.find((s) => s.id === plan.slotId);
  if (!slot) throw new HttpError(409, "方案里的时间不存在");

  const byId = new Map(members.map((m) => [m.id, m]));
  const names = plan.attendeeIds
    .map((id) => byId.get(id))
    .filter((m) => m && m.status === "in")
    .map((m) => m!.name);

  const desc = [
    `${ju.title}${ju.status === "confirmed" ? "" : "（待定）"}`,
    `地点：${opt.poi.name}`,
    opt.poi.address ? `地址：${opt.poi.address}` : "",
    opt.poi.tel ? `电话：${opt.poi.tel}` : "",
    `参与者（${names.length} 人）：${names.join("、")}`,
    opt.poi.costPerPerson !== undefined ? `人均约 ${Math.round(opt.poi.costPerPerson)} 元` : "",
    ju.settlement ? `AA：每人 ${ju.settlement.perPerson} 元${ju.settlement.payerName ? `，转给${ju.settlement.payerName}` : ""}` : "",
    "—— 由 AI 局长 组局",
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Juzhang//Hackathon//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ju.id}-${plan.slotId.replace(/[^0-9T]/g, "")}@juzhang`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(slot.start)}`,
    `DTEND:${utc(slot.end)}`,
    `SUMMARY:${esc(`${ju.title} · ${opt.poi.name}`)}`,
    `LOCATION:${esc([opt.poi.name, opt.poi.address].filter(Boolean).join(" "))}`,
    `GEO:${opt.poi.lat.toFixed(6)};${opt.poi.lng.toFixed(6)}`,
    `DESCRIPTION:${esc(desc)}`,
    `STATUS:${ju.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`${ju.title} 还有 2 小时开始，${opt.poi.name}`)}`,
    "TRIGGER:-PT2H",
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
