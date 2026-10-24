import { identityService } from '../../../../../server/auth';
import { amapProvider } from '../../../../../server/providers/amap';
import { createVenueHandler } from '../../../../../server/providers/amap/route-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createVenueHandler('search', identityService, amapProvider);
