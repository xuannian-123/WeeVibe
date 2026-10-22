import { handle, json, readBody, requireAdmin } from "@/lib/server/http";
import { confirm } from "@/lib/server/ju";
import { confirmBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { poiId } = await readBody(req, confirmBody);
    return json(await confirm(id, poiId));
  });
}
