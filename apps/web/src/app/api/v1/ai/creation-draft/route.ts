import { identityService } from '../../../../../server/auth';
import { aiCreationProvider } from '../../../../../server/ai/creation';
import { createAiCreationHandler } from '../../../../../server/ai/creation-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAiCreationHandler(identityService, aiCreationProvider);
