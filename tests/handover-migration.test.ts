import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const sql=readFileSync(new URL('../prisma/migrations/20261026191500_management_handover/migration.sql',import.meta.url),'utf8');
const schema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
describe('migration10 SQL static assertions ONLY — not execution or real PG uniqueness evidence',()=>{
 it('declares a partial unique pending-per-activity index, not uniqueness over all history',()=>{expect(sql).toMatch(/CREATE UNIQUE INDEX "ManagementHandover_one_pending_per_activity" ON "ManagementHandover"\("activityId"\) WHERE "status" = 'pending'/);});
 it('retains required identity foreign keys, distinct actors and state/revision checks',()=>{expect(sql).toContain('CHECK ("fromUserId" <> "toUserId")');expect(sql).toContain('CHECK ("fromManagementRevision" > 0)');expect(sql).toContain("\"status\" = 'pending' AND \"resolvedAt\" IS NULL");expect((sql.match(/ON DELETE RESTRICT/g)||[])).toHaveLength(3);});
 it('is additive only and does not reset managers, erase history or auto-expire offers',()=>{expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE "Activity")\b/im);expect(schema).toContain('@@unique([fromUserId, creationKey])');expect(schema).toContain('Partial unique index');});
});
