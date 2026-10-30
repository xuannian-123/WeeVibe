CREATE TABLE "GatheringWorkflow" (
 "gatheringId" UUID PRIMARY KEY REFERENCES "Gathering"("id") ON DELETE CASCADE,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "state" JSONB NOT NULL CHECK (jsonb_typeof("state")='object'),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "GatheringWorkflowCommand" (
 "gatheringId" UUID NOT NULL REFERENCES "Gathering"("id") ON DELETE CASCADE,
 "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "key" TEXT NOT NULL, "hash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("gatheringId","actorId","key")
);
-- Intake version and workflow version are separate counters. Keep intake replay
-- uniqueness without conflating it with subsequent lifecycle events.
DROP INDEX "GatheringSubmissionEvent_gatheringId_actorUserId_actorVersion_key";
CREATE UNIQUE INDEX "GatheringSubmissionEvent_intake_version_key" ON "GatheringSubmissionEvent"("gatheringId","actorUserId","actorVersion") WHERE "action" IN ('submitted','updated');
CREATE INDEX "GatheringSubmissionEvent_gatheringId_actorUserId_actorVersion_idx" ON "GatheringSubmissionEvent"("gatheringId","actorUserId","actorVersion");
ALTER TABLE "Gathering" DROP CONSTRAINT "Gathering_final_choice_check";
ALTER TABLE "Gathering" ADD CONSTRAINT "Gathering_final_choice_check" CHECK (
 ("finalGenerationId" IS NULL AND "finalPlanId" IS NULL AND "finalizedAt" IS NULL) OR
 ("kind" IN ('friend','team') AND "finalGenerationId" IS NOT NULL AND "finalPlanId" IS NOT NULL
  AND "finalizedAt" IS NOT NULL AND "currentGenerationId" IS NOT NULL
  AND "currentGenerationId"="finalGenerationId" AND "finalPlanId" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
ALTER TABLE "GatheringSubmissionEvent" DROP CONSTRAINT "GatheringSubmissionEvent_action_check";
ALTER TABLE "GatheringSubmissionEvent" ADD CONSTRAINT "GatheringSubmissionEvent_action_check" CHECK (
 ("action"='submitted' AND "actorVersion"=1) OR ("action"='updated' AND "actorVersion">1) OR
 ("action" IN ('plans_ready','selection_updated','confirmation_requested','confirmation_declined','completed') AND "actorVersion">0)
);
