import { handle,readJson,ServiceError } from '../../../../../server/http';
import { requireActor,parseActivityId } from '../../../../../server/activities/transport';
import { gatheringAI } from '../../../../../server/gatherings/ai';
import { consumeRequirementBudget } from '../../../../../server/requirements/service';
import { gatheringOrganizeSchema } from '@weevibe/contracts';
import {assertGatheringProfileActor} from '../../../../../server/gatherings/profile';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function POST(request:Request){return handle(async()=>{const actor=await requireActor(request),parsed=gatheringOrganizeSchema.safeParse(await readJson(request,16384));if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'请检查公开的想法填写内容');await assertGatheringProfileActor(actor);await consumeRequirementBudget(actor);return gatheringAI.organize(actor,parsed.data.public);},request);}
