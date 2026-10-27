import { describe, expect, it } from 'vitest';
import { createInvitationSourceSchema, saveInvitationSchema } from '../packages/contracts/src/invitations';
import { checkMayCreateInvitation, publicInvitationName } from '../apps/web/src/server/activities/invitation-rules';
const now=new Date('2030-01-01T00:00:00Z');const activity={currentManagerId:'manager',cancelledAt:null,segments:[{cancelledAt:null,endsAt:new Date('2030-01-02T00:00:00Z'),participations:[{userId:'member',status:'joined' as const}]}]};
describe('invitation provenance not authorization',()=>{
 it('manager may create a source',()=>expect(()=>checkMayCreateInvitation(activity,'manager',now)).not.toThrow());
 it('joined active member may create a source',()=>expect(()=>checkMayCreateInvitation(activity,'member',now)).not.toThrow());
 it('outsider cannot mint a source',()=>expect(()=>checkMayCreateInvitation(activity,'outsider',now)).toThrow('只有'));
 it('exited member cannot mint a new source',()=>expect(()=>checkMayCreateInvitation({...activity,segments:[{...activity.segments[0],participations:[{userId:'member',status:'exited'}]}]},'member',now)).toThrow('只有'));
 it('cancelled activity cannot create new sources',()=>expect(()=>checkMayCreateInvitation({...activity,cancelledAt:now},'manager',now)).toThrow('取消'));
 it('cancelled or completed segments do not authorize a member',()=>{expect(()=>checkMayCreateInvitation({...activity,segments:[{...activity.segments[0],cancelledAt:now}]},'member',now)).toThrow();expect(()=>checkMayCreateInvitation(activity,'member',new Date('2030-01-03T00:00:00Z'))).toThrow();});
 it('public projection reads only explicit nickname',()=>{expect(publicInvitationName({nickname:' 小明 ',departure:'secret',birthday:'2000-01-01'})).toBe('小明');expect(publicInvitationName({birthday:'2000-01-01'})).toBeNull();});
 it('rejects arbitrary names and does not accept credential fields',()=>{expect(publicInvitationName({nickname:'a'.repeat(33)})).toBeNull();expect(createInvitationSourceSchema.safeParse({action:'create',inviter_user_id:'other'}).success).toBe(false);expect(saveInvitationSchema.safeParse({action:'save',activity_id:'00000000-0000-4000-8000-000000000001',user_id:'other'}).success).toBe(false);});
});
