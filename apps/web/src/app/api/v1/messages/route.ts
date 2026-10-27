import { handle, readJson } from '../../../../server/http';
import { requireActor } from '../../../../server/activities/transport';
import { getInbox, readInbox } from '../../../../server/inbox';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handle(async () => getInbox(await requireActor(request)), request); }
export function POST(request: Request) { return handle(async () => readInbox(await requireActor(request), await readJson(request)), request); }
