// A2 的薄封装：发起页 / 发起人控制台 / 大屏 / 路演页用到的接口。
// 形状以 docs/CONTRACT.md 第五节与 src/lib/types.ts（v3）为准；不改 A1 的 src/lib/client/**。
import type {
  BillSplit,
  ChatScreenshotParse,
  GroupMessages,
  JuSpec,
  JuState,
  Member,
  PrivacySelfTest,
  Receipt,
  SeedMember,
  Slot,
  Stats,
} from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type ReqOpts = { method?: string; body?: unknown; admin?: string | null; timeoutMs?: number };

function friendly(status: number, serverMsg?: string): string {
  if (serverMsg && /[一-龥]/.test(serverMsg)) return serverMsg;
  if (status === 404) return "这个局找不到了，可能链接不完整";
  if (status === 401 || status === 403) return "只有发起人才能这么做";
  if (status === 409) return "局的状态刚变了，刷新一下再试";
  if (status === 413) return "图片太大了，换一张试试";
  if (status === 429) return "手速太快啦，歇一秒再试";
  if (status >= 500) return "局长有点忙，服务器开小差了，再试一次";
  return serverMsg || "出了点小状况，再试一次";
}

async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.admin) headers["x-admin-token"] = opts.admin;
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
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : undefined;
      throw new ApiError(friendly(res.status, msg), res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") throw new ApiError("网络有点慢，局长没等到回复，再试一次？", 0);
    throw new ApiError("网络开小差了，检查一下网络再试", 0);
  } finally {
    clearTimeout(timer);
  }
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && /[一-龥]/.test(e.message)) return e.message;
  return "出了点小状况，再试一次";
}

export type ParseResult = { title: string; spec: JuSpec; slots: Slot[] };
export type ScreenshotResult = ChatScreenshotParse & { slots: Slot[] };
export type TierLink = { tier: number; label: string; token: string };
export type CreateBody = {
  prompt: string;
  organizerName: string;
  title?: string;
  spec?: JuSpec;
  deadline?: string;
  quorum?: { min: number; deadline?: string };
  capacity?: number;
  tiers?: number;
  seeds?: Omit<SeedMember, "id" | "claimedBy">[];
};
export type CreateResult = { id: string; adminToken: string; tierLinks: TierLink[] };
export type VerifyResult = { ok: boolean; inputHash: string; outputHash: string; recomputedOutputHash: string };
export type Payments = Record<string, { name: string; amount: number; paid: boolean }>;

const enc = encodeURIComponent;
const ju = (id: string, rest = "") => `/api/ju/${enc(id)}${rest}`;

/** 发起人控制台用到的全部动作。gallery 里用假实现替换（见 OrganizerApiContext） */
export type OrganizerApi = {
  getJu: (id: string, admin?: string | null) => Promise<JuState>;
  setRole: (id: string, admin: string, mid: string, role: Member["role"]) => Promise<JuState>;
  openTier: (id: string, admin: string, tier: number) => Promise<JuState>;
  plan: (id: string, admin: string) => Promise<JuState>;
  confirm: (id: string, admin: string, proposalId: string) => Promise<JuState>;
  messages: (id: string, admin: string) => Promise<GroupMessages>;
  nudge: (id: string, admin: string) => Promise<{ nudged: number }>;
  reservation: (id: string, admin: string, body: { status?: "scripted" | "called" | "booked"; tableSize?: number }) => Promise<GroupMessages>;
  receipt: (id: string, admin: string, image: string) => Promise<{ receipt: Receipt; split: BillSplit }>;
  settle: (id: string, admin: string, body: { total?: number; payerName?: string; useReceipt?: boolean }) => Promise<JuState>;
  remindPay: (id: string, admin: string) => Promise<{ reminded: number }>;
  payments: (id: string, admin: string) => Promise<Payments>;
  recap: (id: string, admin: string) => Promise<JuState>;
  again: (id: string, admin: string, prompt?: string) => Promise<CreateResult>;
  devClock: (id: string, admin: string, offsetMin: number) => Promise<JuState>;
  /** scene = "club"：v4 社团团建演示（9 个半生不熟的朋友 + 前两局圈子历史） */
  devSeed: (id: string, admin: string, count?: number, scene?: "default" | "club" | "conflict") => Promise<JuState>;
  /** v5 演示：被局长私下问到的演示朋友（没有手机）回答"可以" */
  devAnswer: (id: string, admin: string) => Promise<JuState>;
  /** v4 #18 局长排座（第一轮开始前可以重排） */
  seating: (id: string, admin: string, body: { rounds?: number; tableSize?: number }) => Promise<JuState>;
  /** v4 #19 开始 / 下一轮 */
  nextRound: (id: string, admin: string) => Promise<JuState>;
  /** v4 #18 现场有人没到 / 又到了 */
  seatAbsent: (id: string, admin: string, memberId: string, absent: boolean) => Promise<JuState>;
  /** v4 #18 排座一键复算 */
  verifySeating: (id: string) => Promise<VerifyResult>;
  /** v5 天气变坏：一键切到备案（同一时间换成室内的店） */
  switchFallback: (id: string, admin: string) => Promise<JuState>;
  /** v6 分身谈判演示局（线 B 的 seed；见 AVATAR_DEMO）。可选：gallery 的假后端不实现时按钮不出现 */
  devSeedAvatar?: (id: string, admin: string) => Promise<JuState>;
};

/**
 * v6 分身谈判演示的路由：POST /api/dev/seed/:id { scene: "avatar" }（server/seed.ts 的谈判演示局）。
 * 这个 seed 同一次调用里就出了方案，所以 plan = false；换成不出方案的 seed 时改成 true，seed 完再调一次出方案。
 */
export const AVATAR_DEMO = {
  path: (id: string) => `/api/dev/seed/${encodeURIComponent(id)}`,
  body: { scene: "avatar" } as Record<string, unknown>,
  plan: false,
};

export const api = {
  parse: (prompt: string) => request<ParseResult>("/api/parse", { body: { prompt }, timeoutMs: 25000 }),
  parseScreenshot: (image: string) => request<ScreenshotResult>("/api/parse/screenshot", { body: { image }, timeoutMs: 45000 }),
  createJu: (body: CreateBody) => request<CreateResult>("/api/ju", { body, timeoutMs: 20000 }),
  verify: (id: string) => request<VerifyResult>(ju(id, "/plan/verify"), { timeoutMs: 20000 }),
  selftest: () => request<PrivacySelfTest>("/api/privacy/selftest", { timeoutMs: 60000 }),
  stats: () => request<Stats>("/api/stats", { timeoutMs: 8000 }),
};

export const organizerApi: OrganizerApi = {
  getJu: (id, admin) => request<JuState>(ju(id), { admin, timeoutMs: 8000 }),
  setRole: (id, admin, mid, role) => request<JuState>(ju(id, `/members/${enc(mid)}`), { method: "PATCH", body: { role }, admin }),
  openTier: (id, admin, tier) => request<JuState>(ju(id, `/tiers/${tier}/open`), { body: {}, admin }),
  plan: (id, admin) => request<JuState>(ju(id, "/plan"), { body: {}, admin, timeoutMs: 60000 }),
  confirm: (id, admin, proposalId) => request<JuState>(ju(id, "/confirm"), { body: { proposalId }, admin }),
  messages: (id, admin) => request<GroupMessages>(ju(id, "/messages"), { admin, timeoutMs: 30000 }),
  nudge: (id, admin) => request<{ nudged: number }>(ju(id, "/nudge"), { body: {}, admin }),
  reservation: (id, admin, body) => request<GroupMessages>(ju(id, "/reservation"), { body, admin, timeoutMs: 30000 }),
  receipt: (id, admin, image) => request<{ receipt: Receipt; split: BillSplit }>(ju(id, "/receipt"), { body: { image }, admin, timeoutMs: 60000 }),
  settle: (id, admin, body) => request<JuState>(ju(id, "/settle"), { body, admin }),
  remindPay: (id, admin) => request<{ reminded: number }>(ju(id, "/remind-pay"), { body: {}, admin }),
  payments: (id, admin) => request<Payments>(ju(id, "/payments"), { admin }),
  recap: (id, admin) => request<JuState>(ju(id, "/recap"), { body: {}, admin, timeoutMs: 45000 }),
  again: (id, admin, prompt) => request<CreateResult>(ju(id, "/again"), { body: prompt ? { prompt } : {}, admin, timeoutMs: 20000 }),
  devClock: (id, admin, offsetMin) => request<JuState>(`/api/dev/clock/${enc(id)}`, { body: { offsetMin }, admin }),
  devSeed: (id, admin, count, scene) =>
    request<JuState>(`/api/dev/seed/${enc(id)}`, { body: { ...(count ? { count } : {}), ...(scene ? { scene } : {}) }, admin, timeoutMs: 45000 }),
  seating: (id, admin, body) => request<JuState>(ju(id, "/seating"), { body, admin, timeoutMs: 30000 }),
  nextRound: (id, admin) => request<JuState>(ju(id, "/seating/next"), { body: {}, admin, timeoutMs: 30000 }),
  seatAbsent: (id, admin, memberId, absent) => request<JuState>(ju(id, "/seating/absent"), { body: { memberId, absent }, admin, timeoutMs: 30000 }),
  verifySeating: (id) => request<VerifyResult>(ju(id, "/seating/verify"), { timeoutMs: 30000 }),
  switchFallback: (id, admin) => request<JuState>(ju(id, "/fallback"), { body: {}, admin, timeoutMs: 45000 }),
  devAnswer: (id, admin) => request<JuState>(`/api/dev/answer/${enc(id)}`, { body: {}, admin, timeoutMs: 60000 }),
  devSeedAvatar: async (id, admin) => {
    const s = await request<JuState>(AVATAR_DEMO.path(id), { body: AVATAR_DEMO.body, admin, timeoutMs: 45000 });
    if (!AVATAR_DEMO.plan || s.ju.plan) return s;
    return request<JuState>(ju(id, "/plan"), { body: {}, admin, timeoutMs: 60000 });
  },
};

/** 邀请链接里携带圈层 token 的查询参数名（A1 的局页读它，入局时作为 tierToken 提交） */
export const TIER_PARAM = "t";

export function tierUrl(origin: string, id: string, token?: string) {
  return `${origin}/j/${id}${token ? `?${TIER_PARAM}=${enc(token)}` : ""}`;
}
