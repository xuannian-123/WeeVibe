import { handle, json, readBody, viewerOf } from "@/lib/server/http";
import { patchMember } from "@/lib/server/ju";
import { patchMemberBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; mid: string }> };

/** 本人（x-member-token）：{ status: "in" | "out" }；发起人（x-admin-token）：{ role } */
export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, mid } = await params;
    return json(await patchMember(id, mid, await readBody(req, patchMemberBody), viewerOf(req)));
  });
}
