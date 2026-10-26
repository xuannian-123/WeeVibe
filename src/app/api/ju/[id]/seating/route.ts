// #18 局长排座（定局后、第一轮开始前可以重排）
import { handle, json, readBody, requireAdmin, viewerOf } from "@/lib/server/http";
import { seatingBody } from "@/lib/server/schemas";
import { makeSeating } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    requireAdmin(req, id);
    const body = await readBody(req, seatingBody);
    return json(await makeSeating(id, body, viewerOf(req)));
  });
}
