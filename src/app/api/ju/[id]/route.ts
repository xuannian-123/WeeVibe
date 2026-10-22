import { handle, json } from "@/lib/server/http";
import { getState } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(getState(id));
  });
}
