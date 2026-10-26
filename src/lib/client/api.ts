// 前端 API client —— 形状以 docs/CONTRACT.md 第五节、第十节与 src/lib/types.ts（v4）为准。
// 自动带 token：x-member-token / x-admin-token 按局 id 从 localStorage 取（见 storage.ts）。
import type {
  BillSplit,
  ChatReply,
  ChatScreenshotParse,
  CircleStep,
  DayAvailability,
  DietTag,
  Familiarity,
  GroupMessages,
  Itinerary,
  JuSpec,
  JuState,
  Member,
  Notice,
  Place,
  Poi,
  PrivacySelfTest,
  Profile,
  Receipt,
  RoundFeel,
  Slot,
  SocialEnergy,
  Stats,
  SwipeVerdict,
} from "@/lib/types";
import { store } from "./storage";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** member = 带 x-member-token；admin = 带 x-admin-token；both = 有什么带什么 */
type Auth = "member" | "admin" | "both";

type ReqOpts = {
  method?: string;
  body?: unknown;
  /** 需要带 token 时给出局 id */
  ju?: string;
  auth?: Auth;
  timeoutMs?: number;
};

function friendly(status: number, serverMsg?: string): string {
  if (serverMsg && /[一-龥]/.test(serverMsg)) return serverMsg; // 后端给了中文就直接用
  if (status === 404) return "这个局找不到了，可能链接不完整";
  if (status === 401) return "局长没认出你，刷新一下试试";
  if (status === 403) return "只有发起人才能这么做";
  if (status === 409) return "局的状态刚变了，刷新一下再试";
  if (status === 413) return "图片太大了，换一张试试";
  if (status === 429) return "手速太快啦，歇一秒再试";
  if (status >= 500) return "局长有点忙，服务器开小差了，再试一次";
  return serverMsg || "出了点小状况，再试一次";
}

function authHeaders(ju: string | undefined, auth: Auth | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (!ju || !auth) return h;
  if (auth === "member" || auth === "both") {
    const t = store.getMemberToken(ju);
    if (t) h["x-member-token"] = t;
  }
  if (auth === "admin" || auth === "both") {
    const t = store.getAdmin(ju);
    if (t) h["x-admin-token"] = t;
  }
  return h;
}

async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  const headers = authHeaders(opts.ju, opts.auth);
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : undefined;
      throw new ApiError(friendly(res.status, msg), res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError")
      throw new ApiError("网络有点慢，局长没等到回复，再试一次？", 0);
    throw new ApiError("网络开小差了，检查一下网络再试", 0);
  } finally {
    clearTimeout(timer);
  }
}

/* ───────── 请求 / 返回类型 ───────── */

export type ParseResult = { title: string; spec: JuSpec; slots: Slot[] };
export type ScreenshotParseResult = ChatScreenshotParse & { slots: Slot[] };
export type TierLink = { tier: number; label: string; token: string };
export type CreateResult = { id: string; adminToken: string; tierLinks: TierLink[] };

export type CreateBody = {
  prompt: string;
  organizerName: string;
  title?: string;
  spec?: JuSpec;
  deadline?: string;
  /** #1 门限成局 */
  quorum?: { min: number; deadline?: string };
  /** #2 名额 */
  capacity?: number;
  /** #2 分几圈邀请 1-3 */
  tiers?: number;
  /** #3 截图里识别出的人 */
  seeds?: ChatScreenshotParse["seeds"];
};

export type JoinBody = {
  name: string;
  avatar?: string;
  profileId?: string;
  isOrganizer?: boolean;
  /** #2 分层邀请链接里的 token */
  tierToken?: string;
  /** #3 认领的截图成员 */
  seedId?: string;
};
export type JoinResult = { memberId: string; memberToken: string; status: Member["status"]; opening: ChatReply };

/** 私聊：一句话，或者内联组件提交 */
export type ChatBody =
  | { text: string }
  | {
      rsvp?: "yes" | "no";
      location?: Place;
      availability?: Record<string, DayAvailability>;
      dietTags?: DietTag[];
      budgetMax?: number;
      /** #7 课表截图 data URL 或 "demo" */
      schedule?: string;
      /** #6 "都行"，让局长按档案预填 */
      autofill?: true;
    };
export type ChatResult = ChatReply & { me: Member };

export type DeckResult = { deck: Poi[]; predicted?: Record<string, SwipeVerdict> };
/** v4 私下标记：只有 interests 会给别人看 */
export type SocialBody = {
  know?: Record<string, Familiarity>;
  energy?: SocialEnergy;
  avoid?: string[];
  interests?: string[];
};
export type VerifyResult = { ok: boolean; inputHash: string; outputHash: string; recomputedOutputHash: string };
export type PaymentsResult = Record<string, { name: string; amount: number; paid: boolean }>;

const enc = encodeURIComponent;
const J = (id: string) => `/api/ju/${enc(id)}`;

/** 入局成功后把 token 存起来（按局分开） */
function rememberJoin(id: string, r: JoinResult) {
  store.setMember(id, r.memberId, r.memberToken);
}

export const api = {
  /* ───────── B2 ───────── */
  parse: (prompt: string) => request<ParseResult>("/api/parse", { body: { prompt }, timeoutMs: 25000 }),

  /** #3 群聊截图 → 需求 + 预填成员。image 是 data URL 或 "demo" */
  parseScreenshot: (image: string) =>
    request<ScreenshotParseResult>("/api/parse/screenshot", { body: { image }, timeoutMs: 45000 }),

  /** 创建成功会自动把 adminToken 存到本机 */
  createJu: async (body: CreateBody) => {
    const r = await request<CreateResult>("/api/ju", { body, timeoutMs: 25000 });
    store.setAdmin(r.id, r.adminToken);
    return r;
  },

  /** 有 member / admin token 就都带上 */
  getJu: (id: string) => request<JuState>(J(id), { ju: id, auth: "both", timeoutMs: 10000 }),

  patchJu: (id: string, body: { deadline?: string; title?: string; capacity?: number }) =>
    request<JuState>(J(id), { method: "PATCH", body, ju: id, auth: "admin" }),

  /** 入局成功会自动存 memberId + memberToken */
  join: async (id: string, body: JoinBody) => {
    const r = await request<JoinResult>(`${J(id)}/join`, { body, ju: id, auth: "admin", timeoutMs: 25000 });
    rememberJoin(id, r);
    return r;
  },

  chat: (id: string, body: ChatBody) =>
    request<ChatResult>(`${J(id)}/chat`, {
      body,
      ju: id,
      auth: "member",
      timeoutMs: "schedule" in body && body.schedule ? 60000 : 30000,
    }),

  deck: (id: string) => request<DeckResult>(`${J(id)}/deck`, { ju: id, auth: "member", timeoutMs: 20000 }),

  swipe: (id: string, poiId: string, verdict: SwipeVerdict) =>
    request<{ me: Member }>(`${J(id)}/swipe`, { body: { poiId, verdict }, ju: id, auth: "member" }),

  /** #2 想认识谁（私密） */
  wants: (id: string, memberIds: string[]) =>
    request<{ me: Member; matchNames: string[] }>(`${J(id)}/wants`, { body: { memberIds }, ju: id, auth: "member" }),

  /** v4 #17 #18 我和大家熟不熟 / 今天电量 / 悄悄回避 / 公开兴趣 */
  social: (id: string, body: SocialBody) =>
    request<{ me: Member }>(`${J(id)}/social`, { body, ju: id, auth: "member" }),

  /** v4 #19 这一轮感觉怎么样（私下） */
  feel: (id: string, round: number, feel: RoundFeel) =>
    request<{ me: Member }>(`${J(id)}/feel`, { body: { round, feel }, ju: id, auth: "member" }),

  /** v4 #20 局后：和谁聊得来（双方都选了才揭晓） */
  clicked: (id: string, memberIds: string[]) =>
    request<{ me: Member; clickNames: string[] }>(`${J(id)}/clicked`, { body: { memberIds }, ju: id, auth: "member" }),

  /** v4 #21 同一个圈子一局一局熟起来 */
  circle: (id: string) => request<CircleStep[]>(`${J(id)}/circle`, { timeoutMs: 10000 }),

  /** v4 #18 排座一键复算 */
  verifySeating: (id: string) => request<VerifyResult>(`${J(id)}/seating/verify`, { timeoutMs: 30000 }),

  /** 本人改自己的状态（退出 / 回来） */
  setMyStatus: (id: string, mid: string, status: "in" | "out") =>
    request<JuState>(`${J(id)}/members/${enc(mid)}`, { method: "PATCH", body: { status }, ju: id, auth: "member" }),

  /** 🔒 标主角 */
  setRole: (id: string, mid: string, role: Member["role"]) =>
    request<JuState>(`${J(id)}/members/${enc(mid)}`, { method: "PATCH", body: { role }, ju: id, auth: "admin" }),

  /** 🔒 #2 开放下一圈 */
  openTier: (id: string, tier: number) =>
    request<JuState>(`${J(id)}/tiers/${tier}/open`, { body: {}, ju: id, auth: "admin" }),

  /** 🔒 出方案（status → voting） */
  plan: (id: string) => request<JuState>(`${J(id)}/plan`, { body: {}, ju: id, auth: "admin", timeoutMs: 60000 }),

  /** #9 一键复算 */
  verifyPlan: (id: string) => request<VerifyResult>(`${J(id)}/plan/verify`, { timeoutMs: 30000 }),

  vote: (id: string, proposalId: string) =>
    request<JuState>(`${J(id)}/vote`, { body: { proposalId }, ju: id, auth: "both" }),

  /** 🔒 拍板 */
  confirm: (id: string, proposalId: string) =>
    request<JuState>(`${J(id)}/confirm`, { body: { proposalId }, ju: id, auth: "admin" }),

  /** 🔒 #8 群公告 / 催促 / 订位话术 */
  messages: (id: string) => request<GroupMessages>(`${J(id)}/messages`, { ju: id, auth: "admin", timeoutMs: 25000 }),

  icsUrl: (id: string) => `${J(id)}/ics`,

  profile: (pid: string) => request<Profile | null>(`/api/profile/${enc(pid)}`, { timeoutMs: 8000 }),

  geoSearch: (q: string, city?: string) =>
    request<Place[]>(`/api/geo/search?q=${enc(q)}${city ? `&city=${enc(city)}` : ""}`, { timeoutMs: 8000 }),

  /** 浏览器定位拿到的是 WGS84 */
  geoReverse: (lat: number, lng: number) =>
    request<Place>(`/api/geo/reverse?lat=${lat}&lng=${lng}&from=wgs84`, { timeoutMs: 8000 }),

  stats: () => request<Stats>("/api/stats", { timeoutMs: 8000 }),

  privacySelftest: () => request<PrivacySelfTest>("/api/privacy/selftest", { timeoutMs: 60000 }),

  /** 🔒 演示场景 */
  seed: (id: string, count?: number) =>
    request<JuState>(`/api/dev/seed/${enc(id)}`, { body: count ? { count } : {}, ju: id, auth: "admin", timeoutMs: 60000 }),

  /* ───────── B3 ───────── */
  itinerary: (id: string) => request<Itinerary>(`${J(id)}/itinerary`, { ju: id, auth: "member", timeoutMs: 15000 }),

  /** #11 只上传一次坐标换 ETA，服务端算完即丢 */
  eta: (id: string, lat: number, lng: number) =>
    request<{ eta: NonNullable<Member["eta"]> }>(`${J(id)}/eta`, {
      body: { lat, lng, from: "wgs84" },
      ju: id,
      auth: "member",
    }),

  inbox: (id: string) => request<Notice[]>(`${J(id)}/inbox`, { ju: id, auth: "member", timeoutMs: 8000 }),
  inboxRead: (id: string) => request<Notice[]>(`${J(id)}/inbox/read`, { body: {}, ju: id, auth: "member" }),

  /** 🔒 #11 局长去催（只返回人数） */
  nudge: (id: string) => request<{ nudged: number }>(`${J(id)}/nudge`, { body: {}, ju: id, auth: "admin" }),

  /** 🔒 #13 订位话术 / 模拟通话 */
  reservation: (id: string, body: { status?: "none" | "scripted" | "called" | "booked"; tableSize?: number } = {}) =>
    request<GroupMessages>(`${J(id)}/reservation`, { body, ju: id, auth: "admin", timeoutMs: 25000 }),

  /** 🔒 #15 拍小票 → 分账预览 */
  receipt: (id: string, image: string) =>
    request<{ receipt: Receipt; split: BillSplit }>(`${J(id)}/receipt`, {
      body: { image },
      ju: id,
      auth: "admin",
      timeoutMs: 60000,
    }),

  /** 🔒 #14 #15 结算 */
  settle: (id: string, body: { total?: number; payerName?: string; useReceipt?: boolean }) =>
    request<JuState>(`${J(id)}/settle`, { body, ju: id, auth: "admin" }),

  /** #14 我已转 */
  paid: (id: string) => request<{ me: Member }>(`${J(id)}/paid`, { body: {}, ju: id, auth: "member" }),

  /** 🔒 #14 私下提醒没转的人 */
  remindPay: (id: string) => request<{ reminded: number }>(`${J(id)}/remind-pay`, { body: {}, ju: id, auth: "admin" }),

  /** 🔒 #14 */
  payments: (id: string) => request<PaymentsResult>(`${J(id)}/payments`, { ju: id, auth: "admin" }),

  /** #16 上传照片 */
  uploadPhoto: (id: string, image: string) =>
    request<{ url: string }>(`${J(id)}/photos`, { body: { image }, ju: id, auth: "member", timeoutMs: 45000 }),

  photoUrl: (id: string, pid: string) => `${J(id)}/photos/${enc(pid)}`,

  /** 🔒 #16 生成回顾 */
  recap: (id: string) => request<JuState>(`${J(id)}/recap`, { body: {}, ju: id, auth: "admin", timeoutMs: 45000 }),

  /** 🔒 #16 一键再约：新局的 adminToken 会自动存到本机 */
  again: async (id: string, prompt?: string) => {
    const r = await request<CreateResult>(`${J(id)}/again`, {
      body: prompt ? { prompt } : {},
      ju: id,
      auth: "admin",
      timeoutMs: 30000,
    });
    store.setAdmin(r.id, r.adminToken);
    return r;
  },

  /** 🔒 演示快进 */
  devClock: (id: string, offsetMin: number) =>
    request<JuState>(`/api/dev/clock/${enc(id)}`, { body: { offsetMin }, ju: id, auth: "admin" }),
};

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && /[一-龥]/.test(e.message)) return e.message;
  return "出了点小状况，再试一次";
}
