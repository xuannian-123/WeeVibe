// #9 一键复算：同样的输入重跑一遍，比对 outputHash
import { handle, json } from "@/lib/server/http";
import { verifyPlan } from "@/lib/server/ju";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return json(await verifyPlan(id));
  });
}
