import { handle, json, readBody, requireAdmin } from "@/lib/server/http";
import { seedBody } from "@/lib/server/schemas";
import { seedJu } from "@/lib/server/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const { count } = await readBody(req, seedBody);
    return json(await seedJu(id, count));
  });
}
