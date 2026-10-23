// #13 订位话术 + 模拟通话对白
import { reservation } from "@/lib/server/after/actions";
import { reservationBody } from "@/lib/server/after/schemas";
import { handle, json, readBody, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await reservation(id, await readBody(req, reservationBody)));
  });
}
