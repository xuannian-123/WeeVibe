// #16 一键再约：同一拨人开新局
import { again } from "@/lib/server/after/actions";
import { againBody } from "@/lib/server/after/schemas";
import { handle, json, readBody, requireAdmin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { prompt } = await readBody(req, againBody);
    return json(await again(id, prompt));
  });
}
