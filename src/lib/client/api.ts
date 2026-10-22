// 前端 API client —— 形状以 docs/CONTRACT.md 与 src/lib/types.ts 为准
import type { JuSpec, JuState, Place, Slot, Stats } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type ReqOpts = {
  method?: string;
  body?: unknown;
  admin?: string | null;
  timeoutMs?: number;
};

function friendly(status: number, serverMsg?: string): string {
  if (serverMsg && /[一-龥]/.test(serverMsg)) return serverMsg; // 后端给了中文就直接用
  if (status === 404) return "这个局找不到了，可能链接不完整";
  if (status === 401 || status === 403) return "只有局长才能这么做";
  if (status === 409) return "局的状态刚变了，刷新一下再试";
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
      const msg =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : undefined;
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

export type ParseResult = { title: string; spec: JuSpec; slots: Slot[] };
export type CreateResult = { id: string; adminToken: string; organizerMemberId: string | null };

export type JoinBody = {
  name: string;
  avatar?: string;
  location: Place;
  availableSlotIds: string[];
  dietRaw: string;
  budgetMax?: number;
  isOrganizer?: boolean;
  /** 从表单首次渲染到提交的秒数（取整） */
  fillSeconds?: number;
};

export type PatchBody = Partial<JoinBody> | { status: "out" | "in" };

const enc = encodeURIComponent;

export const api = {
  parse: (prompt: string) =>
    request<ParseResult>("/api/parse", { body: { prompt }, timeoutMs: 20000 }),

  createJu: (body: { prompt: string; organizerName: string; title?: string; spec?: JuSpec }) =>
    request<CreateResult>("/api/ju", { body, timeoutMs: 20000 }),

  getJu: (id: string) => request<JuState>(`/api/ju/${enc(id)}`, { timeoutMs: 8000 }),

  join: (id: string, body: JoinBody) =>
    request<{ memberId: string }>(`/api/ju/${enc(id)}/members`, { body }),

  patchMember: (id: string, mid: string, body: PatchBody) =>
    request<{ ok: true }>(`/api/ju/${enc(id)}/members/${enc(mid)}`, { method: "PATCH", body }),

  plan: (id: string, admin: string) =>
    request<JuState>(`/api/ju/${enc(id)}/plan`, { body: {}, admin, timeoutMs: 30000 }),

  vote: (id: string, memberId: string, poiId: string) =>
    request<JuState>(`/api/ju/${enc(id)}/vote`, { body: { memberId, poiId } }),

  confirm: (id: string, admin: string, poiId: string) =>
    request<JuState>(`/api/ju/${enc(id)}/confirm`, { body: { poiId }, admin }),

  settle: (id: string, total: number, payerName?: string) =>
    request<JuState>(`/api/ju/${enc(id)}/settle`, { body: { total, payerName } }),

  seed: (id: string, admin: string, count?: number) =>
    request<JuState>(`/api/dev/seed/${enc(id)}`, { body: count ? { count } : {}, admin, timeoutMs: 30000 }),

  geoSearch: (q: string, city?: string) =>
    request<Place[]>(`/api/geo/search?q=${enc(q)}${city ? `&city=${enc(city)}` : ""}`, {
      timeoutMs: 8000,
    }),

  geoReverse: (lat: number, lng: number) =>
    request<Place>(`/api/geo/reverse?lat=${lat}&lng=${lng}&from=wgs84`, { timeoutMs: 8000 }),

  stats: () => request<Stats>("/api/stats", { timeoutMs: 8000 }),

  icsUrl: (id: string) => `/api/ju/${enc(id)}/ics`,
};

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && /[一-龥]/.test(e.message)) return e.message;
  return "出了点小状况，再试一次";
}
