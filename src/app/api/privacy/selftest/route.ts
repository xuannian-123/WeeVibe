// 反事实泄露检验（CONTRACT 第二节第 7 条），结果缓存 10 分钟
import { handle, json } from "@/lib/server/http";
import { cachedSelfTest } from "@/lib/server/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => json(await cachedSelfTest()));
}
