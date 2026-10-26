// 私聊局长（#4 #5 #6 #7）：按固定顺序问，问过的不重复问。
// 顺序：(#1 时) 来不来 → 从哪出发 → 时间 / 课表 → 忌口 → 预算（委婉）→ 还有什么想让局长知道的 → 刷卡。
// 规则版：脚本式问答 + quickReplies 引导；LLM 版：LLM 写回复 + 抽取 patch，规则结果做兜底和校验。
// 这里会看到本人的私密信息，但输出只回给本人；提示词里不放任何其他成员的信息。
import type { ChatAsk, ChatPatch, ChatReply, ChatWidget, DayAvailability, DietTag, Ju, Member, Place, Profile } from "../types";
import { NUM_RE_SRC, parseCnNumber } from "./cn-number";
import { callLlmJson, currentProvider } from "./provider";
import { ruleParseDiet } from "./rules";
import { budgetStrengthOf, extractNeeds, type ExtractedNeed } from "../planner/needs";
import { llmChatJsonSchema, llmChatSchema, type llmNeedSchema } from "./schemas";
import type { z } from "zod";
import { addDays, dowLabel, fromMinutes, isoDowOf, pad, shanghaiNow, toMinutes } from "./time";

export type ChatCtx = {
  ju: Ju;
  me: Member;
  profile?: Profile;
  userText: string | null;
  quorumPending: boolean;
  now: Date;
};

export type ChatStep = ChatAsk;
/** ask = 局长这一轮问的是哪一项（存进聊天记录，下一轮据此判断"问过什么"） */
export type ChatResult = ChatReply & { patch: ChatPatch; ask?: ChatStep };

// ================================================================ 地点（无 key 也能用的小词典，GCJ-02 近似坐标）

const PLACES: { re: RegExp; label: string; lat: number; lng: number }[] = [
  { re: /漕河泾/, label: "漕河泾", lat: 31.1689, lng: 121.3972 },
  { re: /交大闵行|闵行校区|交通大学闵行/, label: "上海交大闵行校区", lat: 31.0252, lng: 121.4337 },
  { re: /交大徐汇|交通大学徐汇|交大$|上海交大/, label: "上海交大徐汇校区", lat: 31.2003, lng: 121.4336 },
  { re: /徐家汇|徐汇/, label: "徐家汇", lat: 31.1950, lng: 121.4370 },
  { re: /漕宝路/, label: "漕宝路", lat: 31.1690, lng: 121.4310 },
  { re: /宜山路/, label: "宜山路", lat: 31.1860, lng: 121.4260 },
  { re: /田林/, label: "田林", lat: 31.1720, lng: 121.4210 },
  { re: /龙华/, label: "龙华", lat: 31.1750, lng: 121.4500 },
  { re: /上海南站|南站/, label: "上海南站", lat: 31.1550, lng: 121.4300 },
  { re: /衡山路/, label: "衡山路", lat: 31.2050, lng: 121.4450 },
  { re: /静安寺/, label: "静安寺", lat: 31.2230, lng: 121.4460 },
  { re: /中山公园/, label: "中山公园", lat: 31.2190, lng: 121.4180 },
  { re: /人民广场/, label: "人民广场", lat: 31.2330, lng: 121.4750 },
  { re: /南京西路/, label: "南京西路", lat: 31.2290, lng: 121.4590 },
  { re: /南京东路/, label: "南京东路", lat: 31.2380, lng: 121.4840 },
  { re: /新天地/, label: "新天地", lat: 31.2190, lng: 121.4750 },
  { re: /外滩/, label: "外滩", lat: 31.2400, lng: 121.4900 },
  { re: /陆家嘴/, label: "陆家嘴", lat: 31.2400, lng: 121.5050 },
  { re: /世纪大道/, label: "世纪大道", lat: 31.2290, lng: 121.5260 },
  { re: /张江/, label: "张江", lat: 31.2050, lng: 121.5900 },
  { re: /五角场/, label: "五角场", lat: 31.2995, lng: 121.5140 },
  { re: /复旦/, label: "复旦大学", lat: 31.2990, lng: 121.5030 },
  { re: /同济/, label: "同济大学", lat: 31.2830, lng: 121.5010 },
  { re: /江湾/, label: "江湾", lat: 31.3270, lng: 121.5000 },
  { re: /华师大|华东师范/, label: "华东师大", lat: 31.2280, lng: 121.4040 },
  { re: /上大|上海大学/, label: "上海大学", lat: 31.3170, lng: 121.3930 },
  { re: /松江大学城|松江/, label: "松江大学城", lat: 31.0510, lng: 121.2190 },
  { re: /虹桥/, label: "虹桥", lat: 31.1950, lng: 121.3200 },
  { re: /七宝/, label: "七宝", lat: 31.1560, lng: 121.3510 },
  { re: /莘庄/, label: "莘庄", lat: 31.1110, lng: 121.3850 },
  { re: /古美/, label: "古美", lat: 31.1500, lng: 121.3990 },
];

export function lookupPlace(text: string): Place | undefined {
  for (const p of PLACES) if (p.re.test(text)) return { lat: p.lat, lng: p.lng, label: p.label };
  return undefined;
}

// ================================================================ 规则抽取

const AUTOFILL_RE = /都行|都可以|随便|你定|你来定|你看着办|看着办|听你的|你安排|无所谓|都ok/i;
const NO_RSVP_RE =
  /来不了|不来了|我不来|这次不来|去不了|不去了|我不去|这次不去|没空去|不参加|参加不了|下次吧|下次再约|这次算了|这次不行|这次就不|这次先不|先不来|鸽了|缺席/;
const CONDITIONAL_RE = /如果|要是|假如|万一|再(远|贵|晚|早)|太(远|贵|晚|早|吵)(的话)?.{0,3}就|超过.{0,6}就|不然.{0,2}就/;
const YES_RE = /^(来|去|能|可以|行|好|冲|没问题|ok|当然|必须|yes|嗯|对|是|没错|肯定|一定)/i;
const AFFIRM_RE = /^(对|是|嗯|没错|还是|对的|是的|yes|ok|好|老样子|一样|照旧|没变)/i;
const NOTHING_RE = /^(没有了?|没了|无|就这些|没啥了?|没什么了?|暂时没有|暂时没了|ok|好的?|不用了?|没事|啥也没有|nope|no)$/i;
const NOTE_RE = /减肥|别太油|太油|清淡点|安静|包间|腿|脚|过敏|怀孕|带娃|早点走|早走|先走|不想排队|排队|胃不好|拉肚子|感冒|嗓子/;
const NO_ALCOHOL_RE = /不喝酒|不能喝酒|喝不了酒|不喝了|开车|酒精过敏|戒酒|滴酒不沾|不碰酒|不沾酒|吃头孢/;
const SCHEDULE_RE = /课表|课程表|发.*截图|上传/;
/** 暗示手头紧：没明说预算，也要优先委婉确认 */
const POOR_RE = /穷|没钱|手头紧|手头有点紧|月底|吃土|省钱|拮据|破产|生活费|钱包|囊中羞涩|紧巴/;

const CLEAN_RE = /[\s，,。.!！?？~～、…]+/g;
const strip = (s: string) => s.replace(CLEAN_RE, "");

function isShortAutofill(text: string): boolean {
  if (!AUTOFILL_RE.test(text)) return false;
  const rest = strip(text)
    .replace(new RegExp(AUTOFILL_RE.source, "gi"), "")
    .replace(/[吧啊呀哈嘛呗啦了的我你都局长好嗯]/g, "");
  return rest.length <= 2;
}

/** 一个钟点：小时 + 分钟（半 / 一刻 / 数字） */
const CLOCK = `(${NUM_RE_SRC})\\s*(?:点|:|：|时)\\s*(半|一刻|三刻|\\d{1,2})?\\s*分?`;

function clockMinutes(hRaw: string, mRaw: string | undefined): { h: number; m: number } | undefined {
  const h = parseCnNumber(hRaw);
  if (h === undefined || !Number.isInteger(h) || h < 0 || h > 24) return undefined;
  let m = 0;
  if (mRaw === "半") m = 30;
  else if (mRaw === "一刻") m = 15;
  else if (mRaw === "三刻") m = 45;
  else if (mRaw) m = Math.min(59, Number(mRaw));
  return { h, m };
}

/** 晚上的局：“6 点”= 18:00；白天的局：“1 点”= 13:00。前面带“上午 / 早上”就不加 */
function toFrom(c: { h: number; m: number }, evening: boolean, morning: boolean): string {
  let h = c.h;
  if (!morning && h < 12) {
    if (evening && h >= 1) h += 12;
    else if (!evening && h >= 1 && h <= 6) h += 12;
  }
  return fromMinutes(h * 60 + c.m);
}

/** 几点前要回：凌晨的门禁（0-4 点）按 23:59 处理 */
function toHomeBy(c: { h: number; m: number }, evening: boolean): string {
  let h = c.h;
  if (h === 24 || (h >= 0 && h <= 4)) return "23:59";
  if (h < 12 && (evening || h <= 7)) h += 12;
  return fromMinutes(h * 60 + c.m);
}

const FROM_RES = [
  new RegExp(`(上午|早上|早晨|下午|晚上)?\\s*${CLOCK}\\s*(?:才)?(?:下班|下课|结束|忙完|收工|能走|能出发|出发|以后|之后|过后|后)`),
  new RegExp(`(?:加班|上班|上课|开会|忙|实验|培训)(?:要)?(?:到|至)\\s*(上午|早上|下午|晚上)?\\s*${CLOCK}`),
  new RegExp(`下班(?:是|要|得|大概)?\\s*(上午|早上|下午|晚上)?\\s*${CLOCK}`),
];
const HOME_RES = [
  new RegExp(`()${CLOCK}\\s*(?:之前|以前|前)\\s*(?:要|得|必须|需要|就)?\\s*(?:回|到家|走|离开|撤|赶)`),
  new RegExp(`(?:门禁|宵禁|关门)(?:是|在)?\\s*()${CLOCK}`),
  new RegExp(`()${CLOCK}\\s*(?:门禁|关门|宵禁)`),
  new RegExp(`末班(?:车|地铁)?(?:是|在)?\\s*()${CLOCK}`),
  new RegExp(`()${CLOCK}\\s*(?:要|得|必须|就得)\\s*(?:走|回|撤|离开)`),
];

const DOW_CH: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 };
const NEG_DAY_RE = /不行|不可以|没空|不方便|有事|去不了|来不了|不太行|没时间|排满|有课|不能|够呛/;
/** 光提到某天不算"那天能来"，要有肯定的说法或具体钟点 */
const POS_DAY_RE = /可以|行|有空|能来|能去|方便|都ok|没问题|最好|ok/i;

function clauseDows(clause: string, now: Date): number[] {
  const out = new Set<number>();
  for (const m of clause.matchAll(/(?:周|星期|礼拜)([一二三四五六日天七])/g)) out.add(DOW_CH[m[1]]);
  if (/周末/.test(clause)) [6, 7].forEach((d) => out.add(d));
  const sh = shanghaiNow(now);
  if (/今天|今晚/.test(clause)) out.add(sh.isoDow);
  if (/明天|明晚/.test(clause)) out.add(isoDowOf(addDays(sh.ymd, 1)));
  if (/(?<!大)后天/.test(clause)) out.add(isoDowOf(addDays(sh.ymd, 2)));
  return [...out];
}

/** “6 点半下班，从漕河泾过来，11 点前回宿舍” → 每个候选日期的时间情况 */
export function ruleParseTimes(
  text: string,
  ctx: { ju: Ju; me: Member; profile?: Profile; now: Date },
): Record<string, DayAvailability> | undefined {
  const spec = ctx.ju.spec;
  const evening = toMinutes(spec.latest) >= 16 * 60;
  const all = spec.dates;
  const clauses = text.split(/[，,。；;！!？?\n]+/).filter(Boolean);
  let gFrom: string | undefined;
  let gHome: string | undefined;
  const per: Record<string, { from?: string; homeBy?: string; pref?: DayAvailability["pref"] }> = {};
  const pos = new Set<string>();
  const neg = new Set<string>();
  let mentioned = false;

  for (const clause of clauses) {
    let from: string | undefined;
    let home: string | undefined;
    for (const re of FROM_RES) {
      const m = clause.match(re);
      if (m) {
        const c = clockMinutes(m[2], m[3]);
        if (c) from = toFrom(c, evening || /下午|晚上/.test(m[1] ?? ""), /上午|早上|早晨/.test(m[1] ?? ""));
        if (from) break;
      }
    }
    for (const re of HOME_RES) {
      const m = clause.match(re);
      if (m) {
        const c = clockMinutes(m[2], m[3]);
        if (c) home = toHomeBy(c, evening);
        if (home) break;
      }
    }
    const dows = clauseDows(clause, ctx.now);
    const dates = all.filter((d) => dows.includes(isoDowOf(d)));
    const isNeg = NEG_DAY_RE.test(clause) && !from;
    const pref: DayAvailability["pref"] | undefined = /最好|最方便|更好|优先/.test(clause)
      ? "best"
      : /勉强|也行|也可以|凑合|实在不行/.test(clause)
        ? "meh"
        : undefined;
    if (dates.length) {
      for (const d of dates) {
        if (isNeg) {
          neg.add(d);
          mentioned = true;
          continue;
        }
        if (!from && !home && !pref && !POS_DAY_RE.test(clause)) continue;
        pos.add(d);
        mentioned = true;
        per[d] = { ...per[d], ...(from ? { from } : {}), ...(home ? { homeBy: home } : {}), ...(pref ? { pref } : {}) };
      }
    } else {
      if (from) gFrom ??= from;
      if (home) gHome ??= home;
    }
  }

  if (!gFrom && !gHome && !mentioned && Object.keys(per).length === 0) return undefined;
  const chosen = pos.size ? all.filter((d) => pos.has(d)) : all.filter((d) => !neg.has(d));
  if (chosen.length === 0) return undefined;

  const existing = ctx.me.private?.availability ?? {};
  const defaultFrom =
    ctx.profile?.usualFrom ?? fromMinutes(Math.max(8 * 60, toMinutes(spec.earliest) - 60));
  const out: Record<string, DayAvailability> = {};
  for (const d of chosen) {
    const e = existing[d];
    const homeBy = per[d]?.homeBy ?? gHome ?? e?.homeBy;
    out[d] = {
      from: per[d]?.from ?? gFrom ?? e?.from ?? defaultFrom,
      ...(homeBy ? { homeBy } : {}),
      pref: per[d]?.pref ?? e?.pref ?? "ok",
    };
  }
  return out;
}

/** 预算：“80” “一百以内” “100-150” → 人均上限；不在预算语境里时要有“预算 / 人均 / 块 / 以内”之类的词 */
export function ruleParseBudget(text: string, budgetStep: boolean): number | undefined {
  const t = text.replace(/\s+/g, "");
  if (!budgetStep && !/预算|人均|一个人|每人|以内|以下|之内|块|元|不超过|别超过|最多|控制在/.test(t)) return undefined;
  const re = new RegExp(`(?<![周期拜第])(${NUM_RE_SRC})(?![点:：号月分人个位周天小岁楼站节])`, "g");
  const nums: number[] = [];
  for (const m of t.matchAll(re)) {
    const v = parseCnNumber(m[1]);
    if (v !== undefined && v >= 15 && v <= 3000) nums.push(Math.round(v));
  }
  if (nums.length === 0) return undefined;
  // “100-150” “100 到 150” 取上限
  return /[-~到至—]/.test(t) && nums.length >= 2 ? Math.max(nums[0], nums[1]) : nums[0];
}

function ruleSkipItems(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:不吃|不碰|吃不了|不要)([一-龥]{2,4}?)(?=[，,。、和跟及;；!！]|$)/g)) {
    const item = m[1];
    if (/^(辣的?|肉|荤|东西|太多|牛肉|海鲜|内脏|太油|主食)$/.test(item)) continue;
    out.push(item);
  }
  return Array.from(new Set(out)).slice(0, 10);
}

/** 从一句话里抽出能确定的东西。pending = 上一轮局长问的是哪一步 */
export function ruleExtract(text: string, ctx: ChatCtx, pending: ChatStep | undefined): ChatPatch {
  const t = text.trim();
  const s = strip(t);
  const patch: ChatPatch = {};
  if (!s) return patch;

  // rsvp
  // "再远我就不去了""要是太贵就不来了"是条件，不是拒绝：条件句不算 rsvp=no
  const conditional = CONDITIONAL_RE.test(s);
  if ((NO_RSVP_RE.test(s) && !conditional) || (pending === "rsvp" && /^(不来|不去|没空|不行|来不了|去不了|算了|不了)/.test(s))) {
    patch.rsvp = "no";
    return patch;
  }
  if (pending === "rsvp" && (YES_RE.test(s) || AUTOFILL_RE.test(s))) patch.rsvp = "yes";

  // 都行 / 随便 / 你定 → 局长按档案预填
  if (pending !== "rsvp" && isShortAutofill(t)) {
    patch.wantsAutofill = true;
    return patch;
  }

  // 名字
  const nm = t.match(/(?:我叫|叫我)\s*([一-龥A-Za-z]{1,6})/);
  if (nm) patch.name = nm[1];

  // 地点：说了地名；或老朋友确认“还是那儿”
  const place = lookupPlace(t);
  if (place) patch.location = place;
  else if (pending === "location" && ctx.profile?.lastLocation && (AFFIRM_RE.test(s) || /还是那|老地方/.test(s))) {
    patch.location = { ...ctx.profile.lastLocation };
  }

  // 时间
  const avail = ruleParseTimes(t, ctx);
  if (avail) patch.availability = avail;

  // 忌口
  const diet = ruleParseDiet(t);
  if (diet.length) patch.dietTags = diet;
  else if (pending === "diet" && ctx.profile?.dietTags.length && AFFIRM_RE.test(s)) patch.dietTags = [...ctx.profile.dietTags];

  // 预算
  const budget = ruleParseBudget(t, pending === "budget");
  if (budget) patch.budgetMax = budget;
  else if (pending === "budget" && ctx.profile?.typicalBudget && AFFIRM_RE.test(s)) patch.budgetMax = ctx.profile.typicalBudget;

  // 分账相关
  const billFacts: NonNullable<ChatPatch["billFacts"]> = {};
  if (NO_ALCOHOL_RE.test(s)) billFacts.noAlcohol = true;
  const skip = ruleSkipItems(t);
  if (skip.length) billFacts.skipItems = skip;
  if (Object.keys(billFacts).length) patch.billFacts = billFacts;

  // v5：能算的其他需求（通勤、安静、清淡、不想去的品类…）+ 预算有多在意
  const needs = extractNeeds(t);
  if (needs.length) patch.needs = needs;
  const bs = budgetStrengthOf(t);
  if (bs) patch.budgetStrength = bs;

  // 备注：“还有什么想让局长知道的”这一问的回答，或者话里有明显的约束
  // “还有什么”这一问的回答记成备注；但回答的其实是预算 / 忌口 / 时间 / 地点时，已经进了对应字段，不再重复记
  const answeredOther = !!(patch.budgetMax || patch.dietTags || patch.availability || patch.location || patch.billFacts);
  if ((pending === "notes" && !NOTHING_RE.test(s) && !answeredOther) || NOTE_RE.test(s) || POOR_RE.test(s)) {
    patch.note = t.slice(0, 80);
  }
  return patch;
}

// ================================================================ 状态机

const STEP_RES: Record<ChatStep, RegExp> = {
  rsvp: /能来吗|来不来|能不能来|来吗|能到吗/,
  location: /从哪|哪儿出发|哪里出发|出发地|从.{1,10}出发[吗？?]|在哪/,
  time: /几点|哪天|什么时候|时间|课表/,
  diet: /忌口|不吃什么|不能吃/,
  budget: /预算|人均|价位|花多少/,
  notes: /还有什么|还有啥|其他想|别的想|想让我知道|想让局长知道/,
  swipe: /刷|右滑|左滑/,
};

/** 一句局长的话问的是哪一步：取最后出现的那个话题 */
export function classifyAsk(text: string): ChatStep | undefined {
  let best: { step: ChatStep; idx: number } | undefined;
  for (const step of Object.keys(STEP_RES) as ChatStep[]) {
    const re = new RegExp(STEP_RES[step].source, "g");
    let idx = -1;
    for (const m of text.matchAll(re)) idx = m.index!;
    if (idx >= 0 && (!best || idx > best.idx)) best = { step, idx };
  }
  return best?.step;
}

type View = {
  rsvp?: "yes" | "no";
  location?: Place;
  availability: Record<string, DayAvailability>;
  dietTags: DietTag[];
  budgetMax?: number;
  notes: string[];
  swipes: number;
  autoFilled: string[];
  wantsAutofill: boolean;
};

function viewOf(me: Member, patch: ChatPatch): View {
  const p = me.private;
  return {
    rsvp: patch.rsvp ?? p?.rsvp,
    location: patch.location ?? me.location,
    availability: { ...(p?.availability ?? {}), ...(patch.availability ?? {}) },
    dietTags: patch.dietTags ?? p?.dietTags ?? [],
    budgetMax: patch.budgetMax ?? p?.budgetMax,
    notes: [...(p?.notes ?? []), ...(patch.note ? [patch.note] : [])],
    swipes: Object.keys(p?.swipes ?? {}).length,
    autoFilled: p?.autoFilled ?? [],
    wantsAutofill: !!patch.wantsAutofill,
  };
}

function stepOrder(quorumPending: boolean): ChatStep[] {
  return [...(quorumPending ? (["rsvp"] as const) : []), "location", "time", "diet", "budget", "notes", "swipe"];
}

function isAnswered(step: ChatStep, v: View, asked: Set<ChatStep>): boolean {
  switch (step) {
    case "rsvp":
      return v.rsvp !== undefined;
    case "location":
      return !!v.location;
    case "time":
      return Object.keys(v.availability).length > 0 || v.autoFilled.includes("availability") || v.wantsAutofill;
    case "diet":
      return v.dietTags.length > 0 || v.autoFilled.includes("diet") || v.wantsAutofill || asked.has("diet");
    case "budget":
      return v.budgetMax !== undefined || v.autoFilled.includes("budget") || v.wantsAutofill || asked.has("budget");
    case "notes":
      return asked.has("notes");
    case "swipe":
      return v.swipes > 0;
  }
}

/** 对话历史：去掉“已经被 B2 追加进去的本轮用户消息”，算出上一问 + 已经被回答过的问题 */
function history(ctx: ChatCtx): { pending?: ChatStep; asked: Set<ChatStep>; opening: boolean } {
  let chat = ctx.me.private?.chat ?? [];
  const last = chat[chat.length - 1];
  if (ctx.userText !== null && last?.role === "me" && last.text.trim() === ctx.userText.trim()) chat = chat.slice(0, -1);
  const asked = new Set<ChatStep>();
  let pending: ChatStep | undefined;
  let lastAsk: ChatStep | undefined;
  for (const turn of chat) {
    if (turn.role === "juzhang") lastAsk = turn.ask ?? classifyAsk(turn.text);
    else if (lastAsk) asked.add(lastAsk);
  }
  const lastJz = [...chat].reverse().find((x) => x.role === "juzhang");
  const lastIsJz = chat.length > 0 && chat[chat.length - 1].role === "juzhang";
  if (lastJz && lastIsJz) pending = lastJz.ask ?? classifyAsk(lastJz.text);
  if (pending && ctx.userText !== null && ctx.userText.trim()) asked.add(pending);
  return { pending, asked, opening: chat.length === 0 };
}

/** 还没问到 / 没答上的项，按顺序 */
function missingSteps(ctx: ChatCtx, v: View, asked: Set<ChatStep>): ChatStep[] {
  return stepOrder(ctx.quorumPending).filter((s) => !isAnswered(s, v, asked));
}

/** 下一问。对方暗示手头紧时，预算提到前面（来不来、出发地之后） */
function nextStep(ctx: ChatCtx, v: View, asked: Set<ChatStep>, text = ""): ChatStep | undefined {
  const missing = missingSteps(ctx, v, asked);
  if (missing.includes("budget") && POOR_RE.test(text)) {
    const first = missing[0];
    if (first !== "rsvp" && first !== "location") return "budget";
  }
  return missing[0];
}

// ================================================================ 规则版文案

function datesLabel(ju: Ju): string {
  const ds = ju.spec.dates.slice(0, 3).map((d) => dowLabel(isoDowOf(d)));
  return ds.length ? `${Array.from(new Set(ds)).join("、")}${ju.spec.dates.length > 3 ? "等几天" : ""}` : "那天";
}

function availabilityLabel(a: Record<string, DayAvailability>, ju: Ju): string {
  const days = Object.keys(a).sort();
  if (days.length === 0) return "";
  const first = a[days[0]];
  const same = days.every((d) => a[d].from === first.from && a[d].homeBy === first.homeBy);
  const dayPart = days.length === ju.spec.dates.length ? "" : `${days.map((d) => dowLabel(isoDowOf(d))).join("、")}，`;
  if (!same) return `${dayPart}每天的时间都记下了`;
  return `${dayPart}${first.from} 后能出发${first.homeBy ? `、${first.homeBy} 前要回` : ""}`;
}

function ackFor(patch: ChatPatch, ctx: ChatCtx): string[] {
  const out: string[] = [];
  if (patch.rsvp === "yes") out.push("太好了！");
  if (patch.wantsAutofill) {
    out.push(
      ctx.profile
        ? "好嘞，那我按你上次的习惯先帮你填上，待会儿在卡片里随时能改。"
        : "好嘞，那我先按大多数人的情况帮你填上，待会儿在卡片里随时能改。",
    );
  }
  const facts = [
    ...(patch.location ? [`从${patch.location.label}出发`] : []),
    ...(patch.availability ? [availabilityLabel(patch.availability, ctx.ju)] : []),
  ];
  if (facts.length) out.push(`${facts.join("，")}，记下了。`);
  if (patch.dietTags?.length) {
    const hotpot = /火锅|串串|冒菜/.test(ctx.ju.spec.category) && patch.dietTags.includes("不吃辣");
    out.push(`${patch.dietTags.join("、")}记下了，${hotpot ? "我会挑能点鸳鸯锅的店。" : "选店时会避开。"}`);
  }
  if (patch.budgetMax) out.push(`人均 ${patch.budgetMax} 以内，收到。这个数只有我知道。`);
  if (patch.billFacts?.noAlcohol) out.push("不喝酒记下了，到时候酒水不算你的。");
  else if (patch.billFacts?.skipItems?.length) out.push(`${patch.billFacts.skipItems.join("、")}不吃，记下了，分账时不算你的。`);
  if (patch.needs?.length) out.push(`记下了：${patch.needs.map((n) => n.text).join("；")}。排方案时会算进去，对外不会说是谁。`);
  else if (patch.note && !patch.billFacts?.noAlcohol && !patch.budgetMax) {
    out.push(POOR_RE.test(patch.note) ? "懂，月底谁不紧呢，这个我心里有数。" : "这个我记着，排方案时会考虑，对外不会说是谁。");
  }
  return out;
}

type Ask = { text: string; widget: ChatWidget; quickReplies: string[]; done: boolean };

function askFor(step: ChatStep, ctx: ChatCtx, pending: ChatStep | undefined, v: View): Ask {
  const p = ctx.profile;
  const again = pending === step && ctx.userText !== null; // 上一问没答上
  switch (step) {
    case "rsvp":
      return {
        text: "这次你能来吗？说来不了也没关系，只有我知道，群里不会显示。",
        widget: "rsvp",
        quickReplies: ["能来！", "这次来不了"],
        done: false,
      };
    case "location":
      if (p?.lastLocation && !again) {
        return {
          text: `还是从${p.lastLocation.label}出发吗？`,
          widget: "location",
          quickReplies: ["对，还是那儿", "换个地方"],
          done: false,
        };
      }
      return {
        text: again
          ? "这个地方我没找到～在下面搜一下具体位置吧，你从哪儿出发？"
          : "你从哪儿出发？在下面搜一下，或者直接告诉我（比如“从漕河泾过来”）。",
        widget: "location",
        quickReplies: [],
        done: false,
      };
    case "time": {
      if (ctx.userText && SCHEDULE_RE.test(ctx.userText)) {
        return { text: "好，把课表截图发我，我自己看哪天几点有空。", widget: "schedule", quickReplies: [], done: false };
      }
      const usual = p?.usualFrom ? `还是 ${p.usualFrom} 后出发${p.usualHomeBy ? `、${p.usualHomeBy} 前回` : ""}？` : "";
      return {
        text: again
          ? "没太听懂～可以说“6 点半下班，11 点前回宿舍”这样，或者直接发课表截图给我。"
          : `${datesLabel(ctx.ju)}你最早几点能出发？有没有几点前必须回去的（门禁、末班车都算）？${usual}也可以直接发课表截图给我。`,
        widget: "time",
        quickReplies: usual ? ["对，老样子", "上传课表", "都行，你定"] : ["6 点后都可以", "上传课表", "都行，你定"],
        done: false,
      };
    }
    case "diet":
      if (p?.dietTags.length) {
        return {
          text: `还是${p.dietTags.join("、")}对吧？还有别的忌口吗？`,
          widget: "diet",
          quickReplies: ["对，老样子", "没有忌口了"],
          done: false,
        };
      }
      return {
        text: "有什么忌口吗？",
        widget: "diet",
        quickReplies: ["没有忌口", "不吃辣", "不吃海鲜", "吃素"],
        done: false,
      };
    case "budget":
      return {
        text: `人均大概多少你会比较舒服？不方便在群里说的，可以悄悄告诉我——只有我知道，对外我只说“已按大家都舒服的价位筛选”。${p?.typicalBudget ? `还是 ${p.typicalBudget} 左右？` : ""}`,
        widget: "budget",
        quickReplies: p?.typicalBudget ? [`${p.typicalBudget} 左右`, "100 以内", "不太在意"] : ["100 以内", "150 以内", "不太在意"],
        done: false,
      };
    case "notes":
      return {
        text: "还有什么想让我知道的吗？比如不喝酒、想早点走、这周在减肥……都只有我知道。",
        widget: null,
        quickReplies: ["没有了", "我不喝酒", "可能要早点走"],
        done: false,
      };
    case "swipe":
      void v;
      return {
        text: "最后刷几家店：右滑想去，上滑超想去，左滑不想去。刷完就齐活了！",
        widget: "swipe",
        quickReplies: [],
        done: true,
      };
  }
}

const DECLINE_TEXT = "收到，这事只有我知道。群里不会显示你说了什么，下次有局我再叫你～";

function greeting(ctx: ChatCtx): string {
  const p = ctx.profile;
  const name = p?.name || ctx.me.name;
  if (p && (p.name || p.lastLocation || p.ledger.length)) {
    return `${name}又见面了！这次「${ctx.ju.title}」还是我来张罗。`;
  }
  const intro = `嗨${name}，我是局长，这次「${ctx.ju.title}」由我来张罗。`;
  return ctx.quorumPending ? intro : `${intro}你私下跟我说的话只有我知道，群里只会看到大家的聚合结论。`;
}

/** 规则版私聊：确定性、无网络 */
export function ruleChatTurn(ctx: ChatCtx): ChatResult {
  const h = history(ctx);
  const text = ctx.userText ?? "";
  const patch = ruleExtract(text, ctx, h.pending ?? (h.opening ? undefined : nextStep(ctx, viewOf(ctx.me, {}), h.asked)));
  return composeRule(ctx, patch, h);
}

function composeRule(ctx: ChatCtx, patch: ChatPatch, h: ReturnType<typeof history>): ChatResult {
  const v = viewOf(ctx.me, patch);
  if (v.rsvp === "no") {
    return { reply: DECLINE_TEXT, widget: null, quickReplies: patch.rsvp === "no" ? [] : ["其实我能来"], done: true, patch };
  }
  const intake = ctx.me.intake;
  if (intake !== "chatting") {
    const ack = ackFor(patch, ctx);
    const reply = ack.length
      ? `${ack.join("")}下次重算方案时我会一起考虑。`
      : intake === "swiping"
        ? "资料都齐了，接着刷卡就行～有变化随时跟我说。"
        : "都记着呢，有变化随时跟我说。";
    return { reply, widget: intake === "swiping" ? "swipe" : null, quickReplies: [], done: true, patch };
  }

  const step = nextStep(ctx, v, h.asked, ctx.userText ?? "");
  const head: string[] = [];
  if (ctx.userText === null && h.opening) head.push(greeting(ctx));
  const ack = ackFor(patch, ctx);
  // 收尾那一轮不复述一长串，一句“都记下了”就够
  head.push(...(step === "swipe" || !step ? (ack.length ? ["都记下了！"] : []) : ack));
  if (!step) {
    return { reply: [...head, "谢谢，有变化随时跟我说。"].join(""), widget: null, quickReplies: [], done: true, patch };
  }
  const ask = askFor(step, ctx, h.pending, v);
  return {
    reply: [...head, ask.text].join(""),
    widget: ask.widget,
    quickReplies: ask.quickReplies,
    done: ask.done,
    patch,
    ask: step,
  };
}

// ================================================================ LLM 版

function warn(e: unknown) {
  console.warn(`[llm] chatTurn 降级到规则：${(e as Error)?.message ?? e}`);
}

function describeMe(ctx: ChatCtx): string {
  const p = ctx.me.private;
  const lines: string[] = [`称呼：${ctx.me.name}`];
  if (ctx.me.location) lines.push(`出发地：${ctx.me.location.label}`);
  if (p?.rsvp) lines.push(`来不来：${p.rsvp === "yes" ? "来" : "不来"}`);
  const days = Object.entries(p?.availability ?? {});
  if (days.length) {
    lines.push(
      `时间：${days.map(([d, a]) => `${d}(${dowLabel(isoDowOf(d))}) ${a.from} 后出发${a.homeBy ? `，${a.homeBy} 前回` : ""}`).join("；")}`,
    );
  }
  if (p?.dietTags.length) lines.push(`忌口：${p.dietTags.join("、")}`);
  if (p?.budgetMax) lines.push(`预算：人均 ${p.budgetMax} 以内`);
  if (p?.notes.length) lines.push(`备注：${p.notes.join("；")}`);
  if (p?.autoFilled.length) lines.push(`局长已预填：${p.autoFilled.join("、")}`);
  return lines.join("\n");
}

function describeProfile(p: Profile | undefined): string {
  if (!p) return "（第一次见面）";
  const lines = ["老朋友，上次的档案："];
  if (p.name) lines.push(`称呼：${p.name}`);
  if (p.lastLocation) lines.push(`上次出发地：${p.lastLocation.label}`);
  if (p.dietTags.length) lines.push(`忌口：${p.dietTags.join("、")}`);
  if (p.typicalBudget) lines.push(`常用人均：${p.typicalBudget}`);
  if (p.usualFrom) lines.push(`通常 ${p.usualFrom} 后能出发${p.usualHomeBy ? `，${p.usualHomeBy} 前回` : ""}`);
  return lines.join("\n");
}

const STEP_GOAL: Record<ChatStep, string> = {
  rsvp: "问这次能不能来（说来不了也没关系，只有局长知道）",
  location: "问从哪儿出发（老朋友就确认是不是还从上次的地方出发）",
  time: "问候选日期里最早几点能出发、有没有几点前必须回去（门禁 / 末班车），也可以发课表截图",
  diet: "问有没有忌口（老朋友就确认是不是还和上次一样）",
  budget: "委婉地问人均大概多少比较舒服，说明“不方便在群里说的，可以悄悄告诉我，只有我知道”",
  notes: "问还有什么想让局长知道的（比如不喝酒、想早点走、在减肥），说明只有局长知道",
  swipe: "告诉对方最后刷几家店：右滑想去、上滑超想去、左滑不想去，刷完就齐活",
};

/** 模型爱把之前说过的约束再总结一遍：和已有备注大面积重合的不再记 */
function isNewNote(note: string, ctx: ChatCtx): boolean {
  const old = strip((ctx.me.private?.notes ?? []).join(""));
  const n = strip(note);
  if (!n || old.includes(n)) return false;
  const grams = Array.from({ length: Math.max(0, n.length - 1) }, (_, i) => n.slice(i, i + 2));
  const seen = grams.filter((g) => old.includes(g)).length;
  return grams.length === 0 || seen / grams.length < 0.6;
}

/** 大模型的一条需求 → 校验 + 转成 NeedRule；参数不全的丢掉 */
export function toNeed(x: z.infer<typeof llmNeedSchema> | null): ExtractedNeed | undefined {
  if (!x) return undefined;
  const words = (x.words ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 6);
  let rule: ExtractedNeed["rule"];
  switch (x.type) {
    case "maxCommute":
      if (!x.minutes) return undefined;
      rule = { t: "maxCommute", minutes: Math.round(x.minutes) };
      break;
    case "leaveBy":
      if (!x.at) return undefined;
      rule = { t: "leaveBy", at: x.at };
      break;
    case "avoidCategory":
    case "preferCategory":
      if (!words.length) return undefined;
      rule = { t: x.type, words };
      break;
    default:
      rule = { t: x.type };
  }
  return { dim: x.dim, kind: x.kind, strength: x.strength, rule, text: x.text.slice(0, 40) };
}

/** 合并 LLM 抽取结果：规则抽到的优先，LLM 补规则没抽到的；全部做合法性校验 */
function mergePatch(rule: ChatPatch, llm: ReturnType<typeof llmChatSchema.parse>, ctx: ChatCtx, text: string): ChatPatch {
  const out: ChatPatch = { ...rule };
  if (!out.rsvp && llm.rsvp) {
    // LLM 说不来时要有否定词撑着，避免把“周五不行”当成整局不来
    if (llm.rsvp === "yes" || (/不|没|算了|下次|鸽/.test(text) && !CONDITIONAL_RE.test(strip(text)))) out.rsvp = llm.rsvp;
  }
  if (out.rsvp === "no") return { rsvp: "no" };
  if (!out.location && llm.placeName) {
    const place = lookupPlace(llm.placeName);
    if (place) out.location = place;
  }
  if (!out.availability && llm.availability?.length) {
    const avail: Record<string, DayAvailability> = {};
    for (const a of llm.availability) {
      if (!ctx.ju.spec.dates.includes(a.date) || !a.from) continue;
      avail[a.date] = { from: a.from, ...(a.homeBy ? { homeBy: a.homeBy } : {}), pref: a.pref };
    }
    if (Object.keys(avail).length) out.availability = avail;
  }
  if (llm.dietTags?.length) {
    const tags = Array.from(new Set([...(out.dietTags ?? []), ...llm.dietTags]));
    out.dietTags = tags;
  }
  if (out.budgetMax === undefined && llm.budgetMax !== undefined && new RegExp(NUM_RE_SRC).test(text)) {
    out.budgetMax = Math.round(llm.budgetMax);
  }
  if (!out.note && llm.note) {
    // 模型常把几条约束拼成一句：拆开，只留这次新冒出来的
    const fresh = llm.note.split(/[；;，,。]/).map((x) => x.trim()).filter((x) => x && isNewNote(x, ctx));
    if (fresh.length) out.note = fresh.join("，").slice(0, 80);
  }
  const noAlcohol = out.billFacts?.noAlcohol || llm.noAlcohol;
  const skip = Array.from(new Set([...(out.billFacts?.skipItems ?? []), ...(llm.skipItems ?? [])])).slice(0, 10);
  if (noAlcohol || skip.length) out.billFacts = { ...(noAlcohol ? { noAlcohol: true } : {}), ...(skip.length ? { skipItems: skip } : {}) };
  if (llm.wantsAutofill && !out.wantsAutofill && AUTOFILL_RE.test(text)) out.wantsAutofill = true;
  // v5 需求：规则抽到的为准，大模型补规则没抽到的（同一维度同一类规则只留一条）
  // 去重按规则类型：腿伤（body）和"别太远"（travel）都是通勤上限，只能算一次，不然同一件事扣两遍分
  const indifferent = /也行|都行|无所谓|随便|都可以|不挑/.test(text);
  const llmNeeds = (llm.needs ?? [])
    .map(toNeed)
    .filter((n): n is ExtractedNeed => !!n)
    // "唱歌也行，不唱也行"不是想去：说了无所谓的话，不收大模型推断的偏好
    .filter((n) => !(indifferent && n.rule.t === "preferCategory"));
  if (llmNeeds.length) {
    const key = (n: ExtractedNeed) => (n.rule.t === "custom" ? `custom|${n.text}` : n.rule.t);
    const have = new Set((out.needs ?? []).map(key));
    const extra: ExtractedNeed[] = [];
    for (const n of llmNeeds) {
      if (have.has(key(n))) continue;
      have.add(key(n));
      extra.push(n);
    }
    if (extra.length) out.needs = [...(out.needs ?? []), ...extra];
  }
  if (out.budgetStrength === undefined && llm.budgetStrength && /钱|价|贵|预算|人均|紧|穷|省|月底/.test(text)) out.budgetStrength = llm.budgetStrength;
  return out;
}

export async function chatTurn(ctx: ChatCtx): Promise<ChatResult> {
  const h = history(ctx);
  const pending = h.pending ?? (h.opening ? undefined : nextStep(ctx, viewOf(ctx.me, {}), h.asked));
  const text = ctx.userText ?? "";
  const rulePatch = ruleExtract(text, ctx, pending);
  const rule = composeRule(ctx, rulePatch, h);
  // 开场白走规则（入局要快）；没有 LLM、或用户什么都没说时也走规则
  if (currentProvider() === "rules" || ctx.userText === null || !text.trim()) return rule;
  // 说不来：体面结束，用固定文案（保证"这事只有我知道"一定说到）
  if (rulePatch.rsvp === "no") return rule;

  try {
    const sh = shanghaiNow(ctx.now);
    const missing = missingSteps(ctx, viewOf(ctx.me, rulePatch), h.asked);
    const poor = POOR_RE.test(text) && missing.includes("budget");
    const recent = (ctx.me.private?.chat ?? []).slice(-8).map((t) => `${t.role === "juzhang" ? "局长" : "我"}：${t.text}`);
    const system = [
      "你是「局长」，一个靠谱、温暖、有点幽默的组局朋友，正在和一位成员一对一私聊，帮大家定这次聚会。",
      "你要在自然的聊天里，把【还缺的信息】一项项问清楚。它们是排方案要用的，但你不是在填表：",
      "1. 先接住对方刚说的话：确认听到的信息；对方问了问题就先正面回答（只能用下面「这次的局」里的信息，不知道的就说人齐了我会出方案、到时候大家投票）；对方话里有暗示（手头紧、在减肥、明天早八、不能太晚）要接住，用一句话表示你懂了。",
      "2. 然后从【还缺的信息】里挑最自然的一项问，一轮只问一件事；通常按清单顺序。对方暗示手头紧时，优先委婉地问预算。",
      "3. 清单里只剩 swipe 时，用一句话收尾并请对方刷几家店（右滑想去、上滑超想去、左滑不想去），不要复述对方说过的内容。",
      "4. 1–3 句，≤80 字，口语，像微信私聊；不用列表，最多一个表情。",
      "隐私：对方告诉你的任何事（预算、门禁、忌口、不想去、手头紧）都只有你知道，对外只说聚合结论；可以让对方放心这一点。不要编造人名，不要提任何其他成员的情况，不要承诺具体店名或价格。",
      "askStep 填你这条回复最后问的那一项（必须是【还缺的信息】里的）；没有提问就填 null。",
      "needs：对方这句话里新说的、时间 / 预算数字 / 忌口之外、能落到规则的需求（路上别太久→maxCommute、想安静→quiet、不喝酒→noAlcohol、怕冷怕晒→indoor、清淡→lightFood、怕排队→noQueue、想早点结束→leaveBy、不想去 X→avoidCategory、想去 X→preferCategory，落不到规则的用 custom）。kind 只有对方明确说必须 / 绝对 / 最多 / 不然不去时才填 hard。门禁、末班车写进 availability.homeBy，不写进 needs。没有就给 null。",
      "budgetStrength：对方暗示手头紧填 3，说价格无所谓填 1，没提给 null。",
      "note 只写对方这句话里新冒出来的约束，之前已经记过的不要再写。抽取字段：只抽对方这句话里明确说了的，没说的给 null。availability 只能用候选日期，按每个候选日期一条；“6 点半下班”→ from 18:30；“11 点前回宿舍”→ homeBy 23:00。说“都行 / 随便 / 你定”→ wantsAutofill=true。暗示性的约束（手头紧、在减肥、想早点走）写进 note。",
      `现在是 ${sh.ymd}（${dowLabel(sh.isoDow)}）${pad(sh.hour)}:${pad(sh.minute)}。`,
      `这次的局：「${ctx.ju.title}」，${ctx.ju.spec.category}，${ctx.ju.spec.city}${ctx.ju.organizerName ? `，${ctx.ju.organizerName} 发起` : ""}；候选日期：${ctx.ju.spec.dates.map((d) => `${d}(${dowLabel(isoDowOf(d))})`).join("、")}；开始时间 ${ctx.ju.spec.earliest}–${ctx.ju.spec.latest}，大约 ${ctx.ju.spec.durationMinutes} 分钟。`,
    ].join("\n");
    const user = [
      `【对方目前告诉你的】\n${describeMe(ctx)}`,
      `【档案】\n${describeProfile(ctx.profile)}`,
      recent.length ? `【最近的对话】\n${recent.join("\n")}` : "",
      `【对方刚说】${text}`,
      `【规则抽取参考】${JSON.stringify(rulePatch)}`,
      missing.length
        ? `【还缺的信息】（按顺序）\n${missing.map((s) => `- ${s}：${STEP_GOAL[s]}`).join("\n")}${poor ? "\n（对方暗示手头紧，优先委婉问 budget）" : ""}`
        : "【还缺的信息】没有了，简短道谢收尾",
    ]
      .filter(Boolean)
      .join("\n\n");
    // v5 的输出结构多了 needs：700 token 会被截断成半截 JSON
    const raw = await callLlmJson({ system, user, schema: llmChatJsonSchema, maxTokens: 1200 });
    const out = llmChatSchema.parse(raw);
    const patch = mergePatch(rulePatch, out, ctx, text);
    const composed = composeRule(ctx, patch, h);
    if (patch.rsvp === "no") return composed;
    if (ctx.me.intake !== "chatting") return { ...composed, reply: out.reply };

    // 合并抽取结果后还缺什么：LLM 问的必须是其中一项，界面上的组件 / 快捷回复跟着它走
    const after = missingSteps(ctx, viewOf(ctx.me, patch), h.asked);
    const ask = out.askStep;
    if (ask && after.includes(ask)) {
      const a = askFor(ask, ctx, h.pending, viewOf(ctx.me, patch));
      return { reply: out.reply, widget: a.widget, quickReplies: a.quickReplies, done: a.done, patch, ask };
    }
    if (!ask && after.length === 0) return { ...composed, reply: out.reply };
    // 没问到该问的（或问了已经答过的）：用规则文案兜底，保证流程往前走
    return composed;
  } catch (e) {
    warn(e);
    return rule;
  }
}
