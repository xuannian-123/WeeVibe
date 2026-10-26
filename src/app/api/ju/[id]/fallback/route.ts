// v5 发起人一键切到备案（天气变坏时，同一时间换成室内的店）
import { switchToFallback } from "@/lib/server/after/reminders";
import { handle, json, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await switchToFallback(id, req.headers.get("x-admin-token") ?? ""));
  });
}
