import { handle, json, requireAdmin } from "@/lib/server/http";
import { makePlan } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    return json(await makePlan(id));
  });
}
