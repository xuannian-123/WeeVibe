import { geoReverse } from "@/lib/server/geo";
import { handle, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => json(await geoReverse(new URL(req.url))));
}
