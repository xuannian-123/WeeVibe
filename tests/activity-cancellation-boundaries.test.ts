import { describe, expect, it } from 'vitest';
import * as contracts from '../packages/contracts/src/activities';
import { createApiClient } from '../packages/api-client/src';
import { requirementSnapshotTx } from '../apps/web/src/server/requirements/service';
import type { Tx } from '../apps/web/src/server/activities/state';
import { coordinationSourceFixture, coordinationIds as ids } from './coordination-source-fixtures';
const now=new Date('2030-01-01T10:00:00Z');
function fixture(status:string,cancelled=true){
 const value=coordinationSourceFixture();
 const survey={...value.survey,status,deadlineAt:new Date('2030-01-01T11:00:00Z'),updatedAt:now,closedAt:null};
 const tx={requirementSurvey:{findUnique:async()=>survey},activity:{findUnique:async()=>({...value.activity,cancelledAt:cancelled?now:null})},requirementSubmission:{findUnique:async()=>null,findMany:async()=>[]},privateProfile:{findMany:async()=>[]},userAvatar:{findUnique:async()=>null}};
 return{tx:tx as unknown as Tx,survey};
}
describe('cancellation capability boundaries, actual requirement projector with read-only fixture',()=>{
 it('has a separate whole-activity cancellation contract and client operation',()=>{expect(contracts).toHaveProperty('cancelActivityInputSchema');expect(createApiClient(async()=>({status:500,body:{}}))).toHaveProperty('cancelActivity');});
 it('does not advertise draft editing after associated activity cancellation',async()=>{const f=fixture('draft');const result=await requirementSnapshotTx(f.tx,ids.collection,ids.manager,now);expect(result.viewer.can_edit).toBe(false);expect(result.viewer.can_publish).toBe(false);expect(result.viewer.blocked_reason).toBe('关联活动已取消');});
 it('does not advertise manual close after associated activity cancellation',async()=>{const f=fixture('open');const result=await requirementSnapshotTx(f.tx,ids.collection,ids.manager,now);expect(result.viewer.can_close).toBe(false);expect(result.viewer.can_respond).toBe(false);expect(result.viewer.can_finalize).toBe(false);});
 it('preserves the ordinary active activity draft/edit and open/close capabilities',async()=>{expect((await requirementSnapshotTx(fixture('draft',false).tx,ids.collection,ids.manager,now)).viewer.can_edit).toBe(true);expect((await requirementSnapshotTx(fixture('open',false).tx,ids.collection,ids.manager,now)).viewer.can_close).toBe(true);});
});
