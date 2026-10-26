// 演示用：被局长私下问到的演示成员一律回答"可以"（演示成员没有手机）
import { handle, json, requireAdmin, viewerOf } from "@/lib/server/http";
import { answerDemoAsks } from "@/lib/server/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await answerDemoAsks(id, viewerOf(req)));
  });
}
