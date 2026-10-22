import { handle, json } from "@/lib/server/http";
import { getStats } from "@/lib/server/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => json(getStats()));
}
