import { handle, json, readBody } from "@/lib/server/http";
import { addMember } from "@/lib/server/ju";
import { addMemberBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody(req, addMemberBody);
    return json(await addMember(id, body), 201);
  });
}
