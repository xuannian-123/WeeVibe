import {handle,readJson} from '../../../../../../server/http';
import {requireActor} from '../../../../../../server/activities/transport';
import {notificationSubscriptionStatus,recordNotificationSubscription} from '../../../../../../server/gatherings/notification-delivery';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handle(async()=>notificationSubscriptionStatus(await requireActor(request)),request);}
export function POST(request:Request){return handle(async()=>recordNotificationSubscription(await requireActor(request),await readJson(request,4096)),request);}
