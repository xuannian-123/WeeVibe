import { handle, json, readBody } from "@/lib/server/http";
import { updateMember } from "@/lib/server/ju";
import { patchMemberBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; mid: string }> };

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, mid } = await params;
    const body = await readBody(req, patchMemberBody);
    return json(await updateMember(id, mid, body));
  });
}
