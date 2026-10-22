import { handle, json, readBody } from "@/lib/server/http";
import { createJu } from "@/lib/server/ju";
import { createJuBody } from "@/lib/server/schemas";
import type { JuSpec } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req, createJuBody);
    return json(await createJu({ ...body, spec: body.spec as JuSpec | undefined }), 201);
  });
}
