// v5 提醒（docs/DECISION.md 第 8 节）：定局之后局长还在盯着。
// - 天气复查：活动前 24 小时、前 3 小时各一次。户外 + 中雨以上 → 提醒发起人一键切到备案；要下雨 → 提醒大家带伞
// - 该往回走了：门禁 / 末班车的人，离开前 15 分钟私下提醒（只发本人）
// - 夜归：结束晚于 22:30，散场时提醒结伴回去
// - 安静时段：23:00–8:00 的非紧急提醒顺延
// 每条提醒都带一个行动；同一件事只提醒一次（pushNoticeOnce 去重）。
import { getMapProvider } from "../../map";
import { poiIndoor, proposalAt, slotWeather } from "../../planner";
import { LATE_NIGHT_MIN } from "../../planner/external";
import { slotTimes } from "../../planner/experience";
import { bjIso, bjParts, hmToMin } from "../../planner/util";
import type { Ju, JuState, Member } from "../../types";
import { publicState } from "../firewall";
import { HttpError } from "../http";
import { announce, appendTrace, loadJu, nowFor, withJuLock } from "../ju";
import * as db from "../../db";
import { pushNotice, pushNoticeOnce } from "./inbox";
import { cachedItinerary } from "./scheduler";
import { HOUR, MIN, confirmedProposal, inOnly, saveMembers } from "./util";

/** 北京时间 23:00–8:00 */
export function isQuietHour(now: Date): boolean {
  const h = Math.floor(bjParts(now).min / 60);
  return h >= 23 || h < 8;
}

/** 天气复查。返回被改动的成员；ju 本身的改动（weatherAlert / 公告）由调用方保存 */
export async function dueWeatherCheck(ju: Ju, members: Member[], now: Date): Promise<{ touched: Member[]; dirty: boolean }> {
  const p = confirmedProposal(ju);
  if (!p || !ju.plan) return { touched: [], dirty: false };
  const start = Date.parse(p.slot.start);
  const t = now.getTime();
  const phase = t >= start - 3 * HOUR && t < start ? "3h" : t >= start - 24 * HOUR && t < start - 3 * HOUR ? "24h" : undefined;
  if (!phase || ju.weatherAlert?.phase === phase) return { touched: [], dirty: false };
  const map = getMapProvider();
  let forecast: Awaited<ReturnType<NonNullable<typeof map.weather>>> = [];
  try {
    forecast = map.weather ? await map.weather(ju.plan.center) : [];
  } catch {
    forecast = [];
  }
  const wx = slotWeather(forecast, p.slot);
  const outdoor = poiIndoor(p.poi) === false;
  const urgent = wx.kind === "heavy" && outdoor;
  // 安静时段只发紧急的；不紧急的等早上再查（复查窗口足够长）
  if (isQuietHour(now) && !urgent) return { touched: [], dirty: false };
  const text = wx.half?.text ?? "暂无预报";
  ju.weatherAlert = {
    phase,
    at: now.toISOString(),
    label: wx.label,
    text,
    kind: wx.kind,
    outdoor,
    ...(urgent && p.fallback ? { suggestFallback: true } : {}),
  };
  appendTrace(ju, "listen", `复查天气（活动前 ${phase === "24h" ? "24" : "3"} 小时）：${wx.label}${text}`);
  const touched: Member[] = [];
  if (urgent) {
    const org = members.find((m) => m.isOrganizer && m.status === "in");
    if (org) {
      pushNoticeOnce(
        org,
        "revision",
        `wx-urgent:${p.id}:${phase}`,
        `局长复查天气：${wx.label}预报${text}，「${p.poi.name}」在户外。${p.fallback ? `建议切到备案「${p.fallback.poi.name}」，在「管理」里一键切换。` : "建议换到室内的店。"}`,
        now,
      );
      touched.push(org);
    }
    announce(ju, `【天气】${wx.label}预报${text}，局长正在和发起人商量换到室内，有变化会第一时间通知大家。`);
  } else if (wx.kind === "light" || wx.kind === "heavy") {
    for (const m of inOnly(members)) {
      if (pushNoticeOnce(m, "depart", `wx-umbrella:${p.id}`, `局长复查天气：${wx.label}预报${text}，记得带伞${outdoor ? "（这次在户外，已备好室内备案）" : "，这家在室内不受影响"}。`, now)) touched.push(m);
    }
  }
  return { touched, dirty: true };
}

/** 门禁 / 末班车的人：离开前 15 分钟私下提醒；结束晚于 22:30：散场时提醒结伴回去 */
export async function dueLeaveAndLateNight(ju: Ju, members: Member[], now: Date): Promise<Member[]> {
  const p = confirmedProposal(ju);
  if (!p) return [];
  const { date, start, end } = slotTimes(p.slot);
  const t = now.getTime();
  const startMs = Date.parse(p.slot.start);
  const endMs = Date.parse(p.slot.end);
  if (t < startMs || t > endMs + 30 * MIN) return [];
  const touched: Member[] = [];
  for (const m of inOnly(members)) {
    try {
      const itin = await cachedItinerary(ju, m, p);
      const leave = hmToMin(itin.leaveAt);
      if (leave === undefined) continue;
      const leaveMin = leave < start - 6 * 60 ? leave + 1440 : leave;
      const leaveMs = Date.parse(bjIso(date, leaveMin));
      if (t >= leaveMs - 15 * MIN && t < leaveMs + 10 * MIN) {
        if (pushNoticeOnce(m, "depart", `leave:${p.id}`, `再过一会儿（${itin.leaveAt}）就该往回走了，局长帮你看着时间。跟大家说一声就好，不用解释原因。`, now)) touched.push(m);
      }
    } catch {
      /* 行程算不出来就不提醒 */
    }
  }
  if (end > LATE_NIGHT_MIN && t >= endMs && !isQuietHourStrict(now)) {
    for (const m of inOnly(members)) {
      if (pushNoticeOnce(m, "depart", `late:${p.id}`, "散场啦！结束得有点晚，回去的朋友结伴或者打车，到家在群里报个平安。", now) && !touched.includes(m)) touched.push(m);
    }
  }
  return touched;
}

/** 夜归提醒本身就是深夜发的，安静时段只拦凌晨 1 点以后 */
function isQuietHourStrict(now: Date): boolean {
  const h = Math.floor(bjParts(now).min / 60);
  return h >= 1 && h < 8;
}

/** 发起人一键切到备案：同一时间换成备案的室内店，重算体验、记一条变更、通知所有人 */
export function switchToFallback(juId: string, adminToken: string): Promise<JuState> {
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    const p = confirmedProposal(ju);
    if (!p || !ju.plan) throw new HttpError(409, "还没定局");
    if (!p.fallback) throw new HttpError(409, "这个方案没有备案");
    const members = db.listMembers(juId);
    const now = nowFor(ju);
    let next;
    try {
      next = await proposalAt(ju, members, p, p.fallback.poi, getMapProvider());
    } catch (e) {
      throw new HttpError(502, (e as Error)?.message || "备案的店暂时算不出来");
    }
    ju.plan.proposals = [...ju.plan.proposals.filter((x) => x.id !== next.id), next];
    ju.confirmedProposalId = next.id;
    const why = ju.weatherAlert ? `${ju.weatherAlert.label}预报${ju.weatherAlert.text}` : "天气不好";
    ju.revisions.push({ at: now.toISOString(), reason: `${why}，换到室内`, changes: [`改到「${next.poi.name}」（室内），时间不变`] });
    if (ju.weatherAlert) ju.weatherAlert = { ...ju.weatherAlert, suggestFallback: false, switched: true };
    if (ju.reservation) ju.reservation = { status: "none" };
    announce(ju, `【换到室内】${why}，改去「${next.poi.name}」（${next.poi.address}），时间不变。每个人的新路线局长已经私信了。`);
    appendTrace(ju, "decide", `切到备案：${next.poi.name}`);
    const attendees = inOnly(members);
    for (const m of attendees) pushNotice(m, "revision", `换到室内啦：${why}，改去「${next.poi.name}」，时间不变。点进来看新路线。`, now);
    saveMembers(attendees);
    db.saveJu(ju);
    return publicState(ju, db.listMembers(juId), { adminToken });
  });
}
