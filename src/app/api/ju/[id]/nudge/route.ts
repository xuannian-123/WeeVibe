// #11 局长去催：发起人只知道催了几个人
import { nudge } from "@/lib/server/after/actions";
import { handle, json, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await nudge(id));
  });
}
