import { handle, json, readBody } from "@/lib/server/http";
import { settleJu } from "@/lib/server/ju";
import { settleBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const { total, payerName } = await readBody(req, settleBody);
    return json(await settleJu(id, total, payerName));
  });
}
