// route 层公共工具：统一错误格式 { error }、zod 入参校验、管理 token 校验。
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getAdminToken } from "../db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function zodMessage(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "参数不合法";
  const path = i.path.length ? `${i.path.join(".")}: ` : "";
  return `参数不合法：${path}${i.message}`;
}

/** 包一层：HttpError / ZodError → 4xx，其它 → 500，都返回 { error } */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError) return json({ error: zodMessage(e) }, 400);
    console.error("[api] 未处理的错误", e);
    return json({ error: "服务器开小差了，请稍后再试" }, 500);
  }
}

export async function readBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "请求体不是合法的 JSON");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, zodMessage(r.error));
  return r.data;
}

/** 校验 x-admin-token；局不存在 404，token 缺失/错误 401 */
export function requireAdmin(req: Request, juId: string): void {
  const expected = getAdminToken(juId);
  if (expected === null) throw new HttpError(404, "局不存在");
  const got = req.headers.get("x-admin-token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (!got || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, "需要发起人权限（x-admin-token）");
  }
}

/** 请求者的公网 IP（nginx 传 X-Real-IP / X-Forwarded-For）；内网 / 本机地址返回 undefined */
export function clientIpOf(req: Request): string | undefined {
  const raw = req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "";
  const ip = raw.trim();
  if (!ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|localhost)/i.test(ip)) return undefined;
  return ip;
}

/** 从请求头取出调用者身份（成员 token / 发起人 token），交给 firewall.publicState 判断 */
export function viewerOf(req: Request): { memberToken?: string; adminToken?: string } {
  const memberToken = req.headers.get("x-member-token") ?? undefined;
  const adminToken = req.headers.get("x-admin-token") ?? undefined;
  return { ...(memberToken ? { memberToken } : {}), ...(adminToken ? { adminToken } : {}) };
}
