import {handle} from '../../../../../server/http';
import {claimGatheringNotifications} from '../../../../../server/gatherings/notification-delivery';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function POST(request:Request){return handle(()=>claimGatheringNotifications(request));}
