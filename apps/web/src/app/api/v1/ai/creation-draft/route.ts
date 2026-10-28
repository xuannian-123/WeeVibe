import { identityService } from '../../../../../server/auth';
import { aiCreationProvider } from '../../../../../server/ai/creation';
import { createAiCreationHandler } from '../../../../../server/ai/creation-handler';
import {assertGatheringProfileActor} from '../../../../../server/gatherings/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAiCreationHandler(identityService,{generate:async(actor,input)=>{await assertGatheringProfileActor(actor);return aiCreationProvider.generate(actor,input);}});
