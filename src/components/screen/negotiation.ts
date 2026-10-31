// v6 分身谈判的展示逻辑（docs/AVATAR.md 第 4、6 节）：大屏直播、本人视图、决定书共用的纯函数。
// 只读公开的 Negotiation / Segment 和本人自己的 avatarLog；不推断"哪个代号是谁"。
import type { AvatarLogEntry, Give, Negotiation, NegotiationEvent, Proposal, Segment } from "@/lib/types";

/* ───────── 轮次 ───────── */
export type Round = NegotiationEvent["round"];

export const ROUNDS: { round: Round; label: string; short: string }[] = [
  { round: 0, label: "交底", short: "交底" },
  { round: 1, label: "方案讨论", short: "讨论" },
  { round: 2, label: "让步", short: "让步" },
  { round: 3, label: "交换与补偿", short: "交换" },
  { round: 4, label: "拍板", short: "拍板" },
];

export const roundLabel = (r: number) => ROUNDS.find((x) => x.round === r)?.label ?? `第 ${r + 1} 轮`;

export type RoundGroup = { round: Round; label: string; events: (NegotiationEvent & { index: number })[] };

/** 按轮次分组（保持原顺序；index 是事件在原数组里的位置，播放进度用它比较） */
export function groupByRound(events: NegotiationEvent[]): RoundGroup[] {
  const out: RoundGroup[] = [];
  events.forEach((e, index) => {
    let g = out.at(-1);
    if (!g || g.round !== e.round) {
      g = { round: e.round, label: roundLabel(e.round), events: [] };
      out.push(g);
    }
    g.events.push({ ...e, index });
  });
  return out;
}

/* ───────── 说话人 ───────── */
export const JUZHANG = "局长";

/** "分身 C" -> "C"；局长 / 不认识的说话人返回 undefined */
export function speakerLetter(speaker: string): string | undefined {
  const m = /^分身\s*([A-Z]{1,2})$/.exec(speaker.trim());
  return m ? m[1] : undefined;
}

function letterIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function indexLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 谈判桌上的座位：事件里出现过的代号 + 补齐到 seats 个（代号本身与身份无关，补出来的只是没发言的分身）。
 * 返回按字母顺序的代号，如 ["分身 A", …, "分身 H"]。
 */
export function seatCodes(events: NegotiationEvent[], seats = 0): string[] {
  let max = seats - 1;
  for (const e of events) {
    for (const code of [e.speaker, ...mentionedCodes(e)]) {
      const l = speakerLetter(code);
      if (l) max = Math.max(max, letterIndex(l));
    }
  }
  return Array.from({ length: Math.max(0, max + 1) }, (_, i) => `分身 ${indexLetter(i)}`);
}

/** 代号配色：深底（大屏）用 fg 发光，浅底（手机）用 bg 色块 + ink 字。同一代号永远同一色 */
const PALETTE: { fg: string; bg: string }[] = [
  { fg: "#7cc4ff", bg: "#cfe8ff" },
  { fg: "#c9b9f1", bg: "#e5e9ff" },
  { fg: "#3ecf8e", bg: "#c9f0dc" },
  { fg: "#c79bff", bg: "#eadcff" },
  { fg: "#ff8a78", bg: "#f2f2ff" },
  { fg: "#5ee0d8", bg: "#c8f3f0" },
  { fg: "#ffb86b", bg: "#ffe2c2" },
  { fg: "#f58bc8", bg: "#fbd9ec" },
  { fg: "#a8d86b", bg: "#e2f3c8" },
  { fg: "#9fb3ff", bg: "#dde3ff" },
];
const JUZHANG_TONE = { fg: "#ad93e0", bg: "#ad93e0" };

export function speakerTone(speaker: string): { fg: string; bg: string; letter: string } {
  const l = speakerLetter(speaker);
  if (!l) return { ...JUZHANG_TONE, letter: "局" };
  return { ...PALETTE[letterIndex(l) % PALETTE.length], letter: l };
}

/* ───────── 事件类别 ───────── */
export type KindStyle = { icon: string; label: string; color: string; soft: string };

/** 让步 / 交换 / 补偿各有自己的颜色和图标；color 深浅底都可读，soft 是浅底色块 */
export const KIND_STYLE: Record<NegotiationEvent["kind"], KindStyle> = {
  open: { icon: "📜", label: "交底", color: "#b4c6be", soft: "#dff4e9" },
  propose: { icon: "🧭", label: "方案", color: "#c9b9f1", soft: "#e5e9ff" },
  argue: { icon: "💬", label: "表态", color: "#ffd166", soft: "#fff1c9" },
  block: { icon: "⛔", label: "卡点", color: "#ff6b57", soft: "#f2f2ff" },
  concede: { icon: "🤝", label: "让步", color: "#7cc4ff", soft: "#cfe8ff" },
  trade: { icon: "⇄", label: "交换", color: "#c79bff", soft: "#eadcff" },
  compensate: { icon: "🎁", label: "补偿", color: "#3ecf8e", soft: "#c9f0dc" },
  ask: { icon: "✉️", label: "私下问", color: "#effbf5", soft: "#dff4e9" },
  decide: { icon: "⚖️", label: "拍板", color: "#ad93e0", soft: "#f2f2ff" },
};

/** 事件文字里点到的其他代号（交换时画两人之间的连线），不含说话人自己 */
export function mentionedCodes(e: NegotiationEvent): string[] {
  const out: string[] = [];
  for (const m of e.text.matchAll(/分身\s*([A-Z]{1,2})(?![A-Za-z])/g)) {
    const code = `分身 ${m[1]}`;
    if (code !== e.speaker && !out.includes(code)) out.push(code);
  }
  return out;
}

/** 谈判桌上每个座位的状态（只看公开事件，截至第 upto 条，含）：卡着没解 / 让过步 / 交换过 / 拿到补偿 */
export type SeatState = { blocked: boolean; marks: ("concede" | "trade" | "compensate")[] };

export function seatStates(events: NegotiationEvent[], upto: number): Record<string, SeatState> {
  const out: Record<string, SeatState> = {};
  const get = (c: string) => (out[c] ??= { blocked: false, marks: [] });
  const mark = (c: string, m: SeatState["marks"][number]) => {
    const s = get(c);
    if (!s.marks.includes(m)) s.marks.push(m);
  };
  events.slice(0, upto + 1).forEach((e) => {
    const self = speakerLetter(e.speaker) ? e.speaker : undefined;
    const others = mentionedCodes(e);
    if (self) {
      if (e.kind === "block") get(self).blocked = true;
      else if (e.kind === "concede" || e.kind === "trade") {
        get(self).blocked = false;
        mark(self, e.kind);
      } else if (e.kind === "compensate") mark(self, "compensate");
    }
    for (const c of others) {
      if (e.kind === "compensate") mark(c, "compensate");
      else if (e.kind === "trade") mark(c, "trade");
    }
    // 局长后续点到卡着的代号并说"卡点解除"，视为解了（只认同一句里的代号）
    if (!self && e.round >= 2 && e.kind !== "trade" && e.kind !== "compensate") {
      for (const clause of e.text.split(/[。；;！!]/)) {
        if (!/解除|解决|守住|满足|没问题/.test(clause)) continue;
        for (const c of mentionedCodes({ ...e, text: clause })) if (out[c]) out[c].blocked = false;
      }
    }
    if (e.kind === "decide") for (const s of Object.values(out)) s.blocked = false;
  });
  return out;
}

/* ───────── 结果卡 ───────── */
export type NegotiationStats = {
  cared?: number;
  total: number;
  autoConcessions: number;
  trades: number;
  asked: number;
  compensations: number;
  rounds: number;
};

export function negotiationStats(neg: Negotiation, p?: Proposal): NegotiationStats {
  const total = p?.experiences.length ?? 0;
  return {
    cared: p?.cared ?? (p ? p.experiences.filter((e) => e.status !== "absent").length : undefined),
    total,
    autoConcessions: neg.autoConcessions,
    trades: neg.trades,
    asked: neg.asked,
    compensations: neg.events.filter((e) => e.kind === "compensate").length,
    rounds: new Set(neg.events.map((e) => e.round)).size,
  };
}

/* ───────── 播放节奏 ───────── */
export const CHAR_MS = 18;

/** 一条发言打完后停多久（毫秒）：拍板和交换停得久一点，让人看清 */
export function holdMs(e: NegotiationEvent): number {
  const base = 380 + Math.min(520, e.text.length * 8);
  return e.kind === "decide" ? base + 500 : e.kind === "trade" || e.kind === "compensate" ? base + 250 : base;
}

/**
 * 播放时间表：入座 → （每轮开头的轮次横幅）→ 每条发言「预备 → 打字 → 停顿」。
 * 播放状态是时间的纯函数（playhead），暂停 / 重播 / 跳到结果只是改时间，不会乱序。
 */
export type Beat = {
  index: number;
  round: Round;
  banner: [number, number] | null;
  anticipate: [number, number];
  type: [number, number];
  hold: [number, number];
  /** 每个打字节拍出几个字（长句打快一点，别让大屏拖沓） */
  perTick: number;
};
export type Schedule = { intro: number; beats: Beat[]; total: number };

export const INTRO_MS = 800;
export const BANNER_MS = 700;
export const ANTICIPATE_MS = 160;

export function buildSchedule(events: NegotiationEvent[], opts: { reduced?: boolean } = {}): Schedule {
  const reduced = !!opts.reduced;
  const intro = reduced ? 300 : INTRO_MS;
  let cur = intro;
  const beats: Beat[] = events.map((e, index) => {
    let banner: [number, number] | null = null;
    if (index === 0 || events[index - 1].round !== e.round) {
      banner = [cur, cur + (reduced ? 700 : BANNER_MS)];
      cur = banner[1];
    }
    const anticipate: [number, number] = [cur, cur + (reduced ? 0 : ANTICIPATE_MS)];
    cur = anticipate[1];
    const perTick = e.text.length > 48 ? 2 : 1;
    const type: [number, number] = [cur, cur + (reduced ? 0 : Math.ceil(e.text.length / perTick) * CHAR_MS)];
    cur = type[1];
    // 不打字时多留一点阅读时间
    const hold: [number, number] = [cur, cur + holdMs(e) + (reduced ? 500 : 0)];
    cur = hold[1];
    return { index, round: e.round, banner, anticipate, type, hold, perTick };
  });
  return { intro, beats, total: cur };
}

export type Playhead = {
  /** 正在说话（或刚说完）的事件下标；-1 = 还在入座 */
  step: number;
  phase: "intro" | "banner" | "anticipate" | "typing" | "hold" | "done";
  /** 当前这条已经打出的字数 */
  typed: number;
  /** 当前所在轮次（入座时为 null） */
  round: Round | null;
};

export function playhead(s: Schedule, t: number, events: NegotiationEvent[]): Playhead {
  if (!s.beats.length) return { step: -1, phase: t >= s.intro ? "done" : "intro", typed: 0, round: null };
  if (t >= s.total) {
    const last = s.beats.at(-1)!;
    return { step: last.index, phase: "done", typed: events[last.index].text.length, round: last.round };
  }
  if (t < s.intro) return { step: -1, phase: "intro", typed: 0, round: null };
  for (const b of s.beats) {
    if (t >= b.hold[1]) continue;
    const len = events[b.index].text.length;
    if (b.banner && t < b.banner[1]) return { step: b.index - 1, phase: "banner", typed: b.index > 0 ? events[b.index - 1].text.length : 0, round: b.round };
    if (t < b.anticipate[1]) return { step: b.index, phase: "anticipate", typed: 0, round: b.round };
    if (t < b.type[1]) {
      const n = Math.min(len, Math.floor((t - b.type[0]) / CHAR_MS + 1) * b.perTick);
      return { step: b.index, phase: "typing", typed: n, round: b.round };
    }
    return { step: b.index, phase: "hold", typed: len, round: b.round };
  }
  const last = s.beats.at(-1)!;
  return { step: last.index, phase: "done", typed: events[last.index].text.length, round: last.round };
}

/* ───────── 撤回窗口 ───────── */
export const REVOKE_WINDOW_MS = 30 * 60_000;

/** 自动让步在 30 分钟内可以撤回（结果公布后；以记录时间为准） */
export function canRevoke(e: AvatarLogEntry, now = Date.now()): boolean {
  if (e.kind !== "concede" || !e.dim || e.revoked) return false;
  const t = Date.parse(e.at);
  if (!Number.isFinite(t)) return false;
  return now >= t - 60_000 && now - t < REVOKE_WINDOW_MS;
}

/** 还能撤回几分钟（向上取整；不能撤回时 0） */
export function revokeMinutesLeft(e: AvatarLogEntry, now = Date.now()): number {
  if (!canRevoke(e, now)) return 0;
  return Math.max(1, Math.ceil((Date.parse(e.at) + REVOKE_WINDOW_MS - now) / 60_000));
}

export const DIM_LABEL: Record<keyof Give, string> = {
  lateMin: "晚到",
  stayCutMin: "少待",
  budgetUp: "多花",
  commuteUp: "多走",
};

/* ───────── 我的分身 ───────── */
export const AVATAR_KIND: Record<AvatarLogEntry["kind"], { icon: string; label: string; cls: string }> = {
  concede: { icon: "🤝", label: "替你让了", cls: "bg-[#cfe8ff] text-ink" },
  held: { icon: "🛡️", label: "守住了", cls: "bg-ink text-mustard" },
  gained: { icon: "✨", label: "争取到了", cls: "bg-mustard text-ink" },
  ask: { icon: "✉️", label: "来问你", cls: "bg-paper-deep text-ink" },
  compensated: { icon: "🎁", label: "补偿", cls: "bg-jade text-white" },
};

/** "小橘" -> "你的小橘"；没有名字 -> "你的分身" */
export function avatarCall(name?: string | null): string {
  const n = name?.trim();
  return n ? `你的${n}` : "你的分身";
}

/** 分身记录的一句话前面接上称呼："替你让了…" -> "你的小橘替你让了…"；已经带主语的原样返回 */
export function avatarSentence(e: AvatarLogEntry, name?: string | null): string {
  const t = e.text.trim();
  if (/^(替你|帮你|为你|给你)/.test(t)) return `${avatarCall(name)}${t}`;
  return t;
}

export type MyExplain = {
  got: string[];
  gave: AvatarLogEntry[];
  why: string[];
};

/**
 * 决定书里的逐人解释：你得到了什么 / 你的分身替你让了什么 / 为什么。
 * 只用本人自己的 avatarLog + 本人的需求结果 + 公开理由，不推断别人。
 */
export function explainForMe(
  log: AvatarLogEntry[],
  metNeeds: string[],
  opts: { cared?: number; total?: number; why?: string[] } = {},
): MyExplain {
  const strip = (t: string) => t.replace(/^(守住了你的底线|争取到了|补偿)[：:]\s*/, "");
  const got: string[] = [];
  const add = (t: string) => {
    const s = t.trim();
    if (s && !got.some((g) => g === s || g.includes(s) || s.includes(g))) got.push(s);
  };
  for (const e of log) if (e.kind === "held" || e.kind === "gained" || e.kind === "compensated") add(strip(e.text));
  // 分身记录已经讲清楚时，需求清单只作补充（避免同一件事说两遍）
  if (got.length < 2) for (const n of metNeeds) add(n);
  const gave = log.filter((e) => e.kind === "concede");
  const why: string[] = [];
  const all = opts.total && opts.cared !== undefined ? (opts.cared >= opts.total ? `${opts.total} 个人都照顾到了` : `照顾到 ${opts.cared}/${opts.total} 人`) : "";
  if (gave.some((e) => !e.revoked)) {
    why.push(all ? `让这一步，换来${all}` : "让这一步，大家才凑得齐");
    why.push("只在你授权的范围内让，底线一条没碰");
  } else if (all) why.push(all);
  for (const w of opts.why ?? []) if (why.length < 3 && !why.includes(w)) why.push(w);
  return { got: got.slice(0, 4), gave, why };
}

/* ───────── 两段式时间线 ───────── */
/** ISO（带 +08:00 或 Z）→ 北京时间 HH:mm */
export function wallTime(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+08:00$/.test(iso)) return iso.slice(11, 16);
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(11, 16);
  return new Date(t + 8 * 3600_000).toISOString().slice(11, 16);
}

/** 两点之间的步行分钟数（直线距离 × 1.3 绕路，约 80 米 / 分钟） */
export function walkMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const m = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.max(1, Math.round((m * 1.3) / 80));
}

const ACT_EMOJI: [RegExp, string][] = [
  [/攀岩/, "🧗"],
  [/火锅/, "🍲"],
  [/烧烤|烤肉/, "🍢"],
  [/家常|中餐|小馆|饭/, "🥘"],
  [/日料|寿司/, "🍣"],
  [/西餐/, "🍝"],
  [/自助/, "🍱"],
  [/小吃/, "🥟"],
  [/咖啡/, "☕"],
  [/清吧|酒/, "🍸"],
  [/奶茶/, "🧋"],
  [/桌游/, "🎲"],
  [/剧本/, "🕵️"],
  [/密室/, "🔐"],
  [/KTV|唱/i, "🎤"],
  [/电玩/, "🕹️"],
  [/台球/, "🎱"],
  [/保龄/, "🎳"],
  [/射箭/, "🏹"],
  [/羽毛球/, "🏸"],
  [/展/, "🖼️"],
  [/电影/, "🎬"],
  [/Live|演出/i, "🎸"],
  [/徒步|爬山/, "🥾"],
  [/野餐|公园/, "🧺"],
  [/骑行/, "🚲"],
  [/露营/, "⛺"],
];

export function activityEmoji(name: string): string {
  for (const [re, e] of ACT_EMOJI) if (re.test(name)) return e;
  return "📍";
}

export type TimelineItem =
  | { t: "seg"; time: string; end: string; name: string; poi: string; emoji: string; activity: string }
  | { t: "walk"; minutes: number };

/** 有两段才算两段式；一段或没有时返回 undefined（界面照旧显示 slot / poi） */
export function segmentTimeline(segments?: Segment[]): { items: TimelineItem[]; endsAt: string } | undefined {
  if (!segments || segments.length < 2) return undefined;
  const items: TimelineItem[] = [];
  segments.forEach((s, i) => {
    if (i > 0) items.push({ t: "walk", minutes: walkMinutes(segments[i - 1].poi, s.poi) });
    items.push({ t: "seg", time: wallTime(s.start), end: wallTime(s.end), name: s.activityName, poi: s.poi.name, emoji: activityEmoji(s.activityName), activity: s.activity });
  });
  return { items, endsAt: wallTime(segments.at(-1)!.end) };
}

/** "15:00 攀岩 @ 岩时攀岩馆 → 步行 6 分钟 → 18:00 家常菜 @ 弄堂小馆，21:00 前结束" */
export function segmentsText(segments?: Segment[]): string | undefined {
  const tl = segmentTimeline(segments);
  if (!tl) return undefined;
  const parts = tl.items.map((x) => (x.t === "seg" ? `${x.time} ${x.name} @ ${x.poi}` : x.minutes <= 25 ? `步行 ${x.minutes} 分钟` : `路上约 ${x.minutes} 分钟`));
  return `${parts.join(" → ")}，${tl.endsAt} 前结束`;
}

/** 两段式的短标题："攀岩 → 家常菜" */
export function segmentsTitle(segments?: Segment[]): string | undefined {
  if (!segments || segments.length < 2) return undefined;
  return segments.map((s) => s.activityName).join(" → ");
}
