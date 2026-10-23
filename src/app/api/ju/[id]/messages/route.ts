// #8 当前阶段可以直接复制到群里的话（公开 LLM 只拿 PublicFacts，输出再过一遍防火墙）
import { handle, json, requireAdmin } from "@/lib/server/http";
import { messagesFor } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await messagesFor(id));
  });
}
