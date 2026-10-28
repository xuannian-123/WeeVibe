import {handle} from '../../../../../server/http';
import {acknowledgeGatheringNotification} from '../../../../../server/gatherings/notification-delivery';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function POST(request:Request){return handle(()=>acknowledgeGatheringNotification(request));}
