// #14 私下提醒没转的人；发起人只知道提醒了几个
import { remindPay } from "@/lib/server/after/actions";
import { handle, json, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await remindPay(id));
  });
}
