import { clientIpOf, handle, json, readBody } from "@/lib/server/http";
import { createJu } from "@/lib/server/ju";
import { createJuBody } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => json(await createJu(await readBody(req, createJuBody), { ip: clientIpOf(req) }), 201));
}
