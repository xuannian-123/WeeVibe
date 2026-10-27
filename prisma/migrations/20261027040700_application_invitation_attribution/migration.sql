-- Additive only. Existing application provenance remains NULL; do not infer or backfill it.
ALTER TABLE "ActivityApplication" ADD COLUMN "invitationSourceId" UUID;
-- A UUID is already globally unique; this composite key enforces same-activity provenance.
CREATE UNIQUE INDEX "InvitationSource_activityId_id_key" ON "InvitationSource"("activityId", "id");
CREATE INDEX "ActivityApplication_activityId_invitationSourceId_idx" ON "ActivityApplication"("activityId", "invitationSourceId");
ALTER TABLE "ActivityApplication" ADD CONSTRAINT "ActivityApplication_activityId_invitationSourceId_fkey"
  FOREIGN KEY ("activityId", "invitationSourceId") REFERENCES "InvitationSource"("activityId", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
